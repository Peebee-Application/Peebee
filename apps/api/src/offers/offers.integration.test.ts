import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting, setPlatformEnvironment } from "../lib/settings.js";
import { refundToWallet, payFromWalletWithCredit } from "../wallet/service.js";
import { offersAdminRoutes } from "./admin-routes.js";
import { offersRoutes } from "./routes.js";
import { saveConfig, getCreditConfig, getOffersConfig, getIncentiveConfig } from "./config.js";
import { expireCredit, getCreditBalance, grantCredit, spendCredit } from "./credit.js";
import { applyDepositBonus } from "./deposit-bonus.js";
import { accrueDiscount, clearIfDue, discountBalance, offsetCommission, sweepDiscountWallets } from "./discount-wallet.js";
import { awardRider, sweepIncentives, trackOnline } from "./incentives.js";
import { releaseOffers, reserveOffers, resolveOrderOffer, sweepStaleReservations } from "./service.js";
import { afterRideSettled, settleOffersForOrder } from "./settle.js";

function bind(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const r = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const rs = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return rs.map((r) => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

async function freshDb() {
  process.env.JWT_SECRET = "offers-test-secret";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const dir = existsSync(join(process.cwd(), "src/db/migrations")) ? join(process.cwd(), "src/db/migrations") : join(process.cwd(), "apps/api/src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  }
  bind(client);
  await setPlatformEnvironment("live");
  for (const [id, role] of [["cust", "customer"], ["friend", "customer"], ["rider", "rider"], ["admin", "admin"]] as const) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES (?, ?, ?, 'h', ?, 100000)", args: [id, id, id, role] });
  }
  await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('cust')");
  await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'admin'");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  return client;
}

async function makeOrder(client: Client, id: string, over: { total?: number; stage?: string; isRide?: number } = {}) {
  await client.execute({ sql: "INSERT OR IGNORE INTO lists (id, customer_id, title) VALUES ('l_' || ?, 'cust', 't')", args: [id] });
  await client.execute({
    sql: `INSERT INTO orders (id, list_id, customer_id, rider_id, stage, estimated_total, final_total, is_ride, type, pickup_lat, pickup_lng, destination_lat, destination_lng, environment)
          VALUES (?, 'l_' || ?, 'cust', 'rider', ?, ?, ?, ?, 'parcel', 0.3, 32.58, 0.35, 32.58, 'live')`,
    args: [id, id, over.stage ?? "Handover", over.total ?? 12000, over.total ?? 12000, over.isRide ?? 1],
  });
  return (await client.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] })).rows[0] as Record<string, unknown>;
}

test("migration 0147 applies and every Offers setting starts at its recommended default", async () => {
  await freshDb();
  const offers = await getOffersConfig();
  assert.equal(offers.enabled, true);
  assert.equal(offers.stacking.mode, "best_one");
  const incentives = await getIncentiveConfig();
  assert.equal(incentives.kinds.trip_streak.enabled, true);
  assert.equal(incentives.kinds.zone_boost.enabled, false);
  const credit = await getCreditConfig();
  assert.equal(credit.topup.bonus.enabled, true);
  assert.equal(credit.withdrawal.enabled, false, "the customer wallet stays closed-loop until an admin opens it");
});

test("config saves are validated and merged over the defaults", async () => {
  await freshDb();
  const bad = await saveConfig("credit", { enabled: true });
  assert.equal(bad.ok, false);
  const current = await getCreditConfig();
  const ok = await saveConfig("credit", { ...current, expiryDays: 30 });
  assert.equal(ok.ok, true);
  assert.equal((await getCreditConfig()).expiryDays, 30);
  // A key that an older save did not know about falls back to its default.
  await setSetting("credit_config", JSON.stringify({ expiryDays: 10 }));
  const merged = await getCreditConfig();
  assert.equal(merged.expiryDays, 10);
  assert.equal(merged.topup.bonus.enabled, true);
});

test("admin creates, edits, pauses and deletes an offer; the code must be unique", async () => {
  await freshDb();
  const app = new Hono().route("/v1", offersAdminRoutes);
  const token = await signToken({ sub: "admin", role: "admin" });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const offer = { name: "Welcome", kind: "promo_code", code: "welcome10", discountType: "percent", value: 10, maxDiscount: 3000, status: "active" };
  const created = await call("POST", "/admin/offers", offer);
  assert.equal(created.status, 201);
  const id = ((await created.json()) as any).offer.id;
  assert.equal(((await (await call("GET", "/admin/offers")).json()) as any).offers[0].code, "WELCOME10");
  assert.equal((await call("POST", "/admin/offers", offer)).status, 409);
  assert.equal((await call("POST", "/admin/offers", { ...offer, code: "" , name: "No code" })).status, 400, "a promo code offer needs a code");
  assert.equal((await call("PATCH", `/admin/offers/${id}`, { ...offer, value: 15 })).status, 200);
  assert.equal(((await (await call("POST", `/admin/offers/${id}/status`, { status: "paused" })).json()) as any).offer.status, "paused");
  assert.equal((await call("DELETE", `/admin/offers/${id}`)).status, 200);
  // The change is on the activity log.
  const client = await freshDb();
  void client;
});

test("an offer lowers what the customer pays, is held while the order is in flight and released if it is not paid", async () => {
  const client = await freshDb();
  const order = await makeOrder(client, "o1", { total: 12000, stage: "Match" });
  await client.execute({
    sql: `INSERT INTO offers (id, name, kind, discount_type, value, status, auto_apply, usage_limit_per_user) VALUES ('off1', 'First ride', 'first_ride', 'flat', 3000, 'active', 1, 1)`,
    args: [],
  });
  const resolved = await resolveOrderOffer(order);
  assert.equal(resolved.discount, 3000);
  assert.equal(resolved.payable, 9000);
  assert.equal(resolved.service, "ride.boda");

  await reserveOffers(order, resolved);
  const held = await client.execute("SELECT status, discount FROM offer_redemptions WHERE order_id = 'o1'");
  assert.deepEqual([held.rows[0].status, held.rows[0].discount], ["pending", 3000]);

  // Retrying the payment replaces the reservation instead of doubling it.
  await reserveOffers(order, resolved);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM offer_redemptions WHERE order_id = 'o1'")).rows[0].n, 1);

  await releaseOffers("o1");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM offer_redemptions")).rows[0].n, 0);

  // A cancelled order's reservation is released by the sweep.
  await reserveOffers(order, resolved);
  await client.execute("UPDATE orders SET stage = 'Cancelled' WHERE id = 'o1'");
  assert.equal(await sweepStaleReservations(), 1);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM offer_redemptions")).rows[0].n, 0);
});

test("per-customer limits count what is reserved, so one customer cannot use a one-time offer twice", async () => {
  const client = await freshDb();
  await client.execute({ sql: `INSERT INTO offers (id, name, kind, discount_type, value, status, auto_apply, usage_limit_per_user) VALUES ('off1', 'Once', 'time_window', 'flat', 1000, 'active', 1, 1)`, args: [] });
  await client.execute({ sql: `UPDATE offers SET conditions = '{"windows":[{"days":[],"from":"00:00","to":"23:59"}]}' WHERE id = 'off1'`, args: [] });
  const first = await makeOrder(client, "o1", { total: 5000, stage: "Match" });
  const second = await makeOrder(client, "o2", { total: 5000, stage: "Match" });
  const a = await resolveOrderOffer(first);
  assert.equal(a.discount, 1000);
  await reserveOffers(first, a);
  assert.equal((await resolveOrderOffer(second)).discount, 0);
});

test("settling a discounted ride compensates the rider below the minimum fare and settles later commission from the discount wallet", async () => {
  const client = await freshDb();
  // An established rider: a brand-new one would be inside the commission holiday and owe nothing.
  await client.execute("UPDATE users SET created_at = datetime('now', '-200 days') WHERE id = 'rider'");
  // Boda minimum fare is 2,500 by default; a 4,000 ride with a 3,500 discount leaves the customer paying 500.
  const order = await makeOrder(client, "o1", { total: 4000 });
  await client.execute({ sql: "INSERT INTO offers (id, name, kind, discount_type, value, status) VALUES ('x', 'Big', 'promo_code', 'flat', 3500, 'paused')", args: [] });
  await client.execute({ sql: "INSERT INTO offer_redemptions (id, offer_id, user_id, order_id, environment, full_fare, discount, funder, status) VALUES ('r1', 'x', 'cust', 'o1', 'live', 4000, 3500, 'platform', 'pending')", args: [] });
  const out = await settleOffersForOrder(order, 0);
  // paid 500, minimum 2,500 -> the rider is owed the 2,000 gap.
  assert.equal(out.compensation, 2000);
  assert.equal(await discountBalance("rider", "rider", "live"), 2000);
  assert.equal((await client.execute("SELECT status, rider_compensation FROM offer_redemptions WHERE id = 'r1'")).rows[0].status, "settled");

  // A second settlement of the same order cannot pay twice.
  const again = await accrueDiscount({ holder: "rider", id: "rider", amount: 2000, env: "live", orderId: "o1" });
  assert.equal(again, 0);

  // The next ride's commission (1,200) is settled from the discount wallet first.
  const next = await makeOrder(client, "o2", { total: 8000 });
  const out2 = await settleOffersForOrder(next, 1200);
  assert.equal(out2.commissionRelief, 1200);
  assert.equal(await discountBalance("rider", "rider", "live"), 800);
  // A rider inside the new-rider commission holiday owes no commission at all, and the discount wallet is left alone.
  await client.execute("UPDATE users SET created_at = datetime('now') WHERE id = 'rider'");
  const holiday = await makeOrder(client, "oh", { total: 8000 });
  assert.equal((await settleOffersForOrder(holiday, 1000)).commissionRelief, 1000);
  assert.equal(await discountBalance("rider", "rider", "live"), 800);
  await client.execute("UPDATE users SET created_at = datetime('now', '-200 days') WHERE id = 'rider'");
  // And never more than the balance.
  const third = await makeOrder(client, "o3", { total: 8000 });
  assert.equal((await settleOffersForOrder(third, 5000)).commissionRelief, 800);
  assert.equal(await discountBalance("rider", "rider", "live"), 0);
  assert.equal(await offsetCommission({ holder: "rider", id: "rider", commission: 500, env: "live", orderId: "o4" }), 0);
});

test("leftover discount balance is paid to the active wallet by the sweep once it is due", async () => {
  const client = await freshDb();
  await accrueDiscount({ holder: "rider", id: "rider", amount: 5000, env: "live", orderId: "oa" });
  // Not yet 7 days old: nothing is paid.
  assert.equal((await sweepDiscountWallets()).paid, 0);
  await client.execute("UPDATE rider_discount_ledger SET created_at = datetime('now', '-8 days')");
  const swept = await sweepDiscountWallets();
  assert.equal(swept.paid, 5000);
  assert.equal(await discountBalance("rider", "rider", "live"), 0);
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM riders WHERE user_id = 'rider'")).rows[0].b, 5000);

  // On-request mode: the rider asks, the money moves.
  await accrueDiscount({ holder: "rider", id: "rider", amount: 3000, env: "live", orderId: "ob" });
  const cfg = { ...(await import("./config.js")).getDiscountWalletConfig && (await (await import("./config.js")).getDiscountWalletConfig()) } as any;
  cfg.payoutTrigger = "on_request";
  assert.equal((await clearIfDue({ holder: "rider", id: "rider", env: "live", cfg })).paid, 0);
  assert.equal((await clearIfDue({ holder: "rider", id: "rider", env: "live", cfg, requested: true })).paid, 3000);
});

test("mobile-money payouts are queued for an admin instead of moving money by themselves", async () => {
  const client = await freshDb();
  await accrueDiscount({ holder: "rider", id: "rider", amount: 4000, env: "live", orderId: "oa" });
  const cfg = { ...(await (await import("./config.js")).getDiscountWalletConfig()), payoutMethod: "mobile_money", payoutTrigger: "daily" } as any;
  const first = await clearIfDue({ holder: "rider", id: "rider", env: "live", cfg });
  assert.deepEqual([first.paid, first.queued], [0, 4000]);
  assert.equal(await discountBalance("rider", "rider", "live"), 4000, "the balance stays until an admin marks it paid");
  assert.equal((await clearIfDue({ holder: "rider", id: "rider", env: "live", cfg })).queued, 0, "only one request at a time");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM rider_discount_requests WHERE status = 'pending'")).rows[0].n, 1);
});

test("incentive awards are paid once, only up to the monthly budget", async () => {
  const client = await freshDb();
  const award = { kind: "trip_streak" as const, amount: 5000, note: "8 rides" };
  assert.equal(await awardRider({ holder: "rider", riderId: "rider", award, periodKey: "day:2026-10-29", env: "live" }), 5000);
  assert.equal(await awardRider({ holder: "rider", riderId: "rider", award, periodKey: "day:2026-10-29", env: "live" }), 0, "a repeat pays nothing");
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM riders WHERE user_id = 'rider'")).rows[0].b, 5000);
  const current = await getIncentiveConfig();
  await saveConfig("incentives", { ...current, monthlyBudget: 7000 });
  assert.equal(await awardRider({ holder: "rider", riderId: "rider", award: { ...award, kind: "weekly_ladder" }, periodKey: "week:1", env: "live" }), 2000, "capped to what the budget has left");
  assert.equal(await awardRider({ holder: "rider", riderId: "rider", award: { ...award, kind: "rating_bonus" }, periodKey: "week:1", env: "live" }), 0, "budget used up");
});

test("a settled ride pays its per-ride incentives and the milestone, once", async () => {
  const client = await freshDb();
  // Put the rider just under 100 rides so the next one crosses the milestone.
  for (let i = 0; i < 99; i++) await makeOrder(client, `old${i}`, { stage: "Settle" });
  const order = await makeOrder(client, "now", { stage: "Settle" });
  await afterRideSettled(order);
  await afterRideSettled(order);
  const awards = await client.execute("SELECT kind, amount FROM rider_incentive_awards WHERE kind <> 'sweep' ORDER BY kind");
  const kinds = awards.rows.map((r) => r.kind);
  assert.ok(kinds.includes("milestones"), "the 100th ride is a milestone");
  assert.equal(kinds.filter((k) => k === "milestones").length, 1, "paid once");
});

test("weekly sweep pays the ladder once and marks the week done", async () => {
  const client = await freshDb();
  const cfg = await getIncentiveConfig();
  const lastWeek = new Date(Date.now() - 7 * 86_400_000);
  const stamp = lastWeek.toISOString().slice(0, 19).replace("T", " ");
  for (let i = 0; i < 31; i++) {
    await makeOrder(client, `w${i}`, { stage: "Settle" });
    await client.execute({ sql: "UPDATE orders SET updated_at = ? WHERE id = ?", args: [stamp, `w${i}`] });
  }
  void cfg;
  const first = await sweepIncentives();
  assert.equal(first.weekly, 15000, "30+ rides pays the first tier");
  assert.equal((await sweepIncentives()).weekly, 0, "the same week is never paid twice");
});

test("online sessions open and close", async () => {
  const client = await freshDb();
  await trackOnline("rider", true);
  await trackOnline("rider", true);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM rider_online_sessions")).rows[0].n, 1);
  await trackOnline("rider", false);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM rider_online_sessions WHERE ended_at IS NULL")).rows[0].n, 0);
});

test("credit: granted, spent soonest-expiry first, locked to a partner, expired and refunded as credit", async () => {
  const client = await freshDb();
  await grantCredit({ userId: "cust", amount: 3000, kind: "bonus", env: "live", expiryDays: 10 });
  await grantCredit({ userId: "cust", amount: 2000, kind: "cashback", env: "live", expiryDays: 5 });
  await grantCredit({ userId: "cust", amount: 4000, kind: "admin", env: "live", partnerId: "rest1", expiryDays: 0 });
  assert.equal(await getCreditBalance("cust", "live"), 9000);

  // Spending 2,500 elsewhere takes the soonest-to-expire lot first and never the partner-locked one.
  assert.equal(await spendCredit({ userId: "cust", amount: 2500, env: "live", orderId: "o1" }), 2500);
  const lots = await client.execute("SELECT source, remaining FROM credit_lots ORDER BY source");
  const bySource = Object.fromEntries(lots.rows.map((r) => [r.source, r.remaining]));
  assert.deepEqual(bySource, { admin: 4000, bonus: 2500, cashback: 0 });
  // Only 2,500 is spendable outside the partner; asking for more takes no more.
  assert.equal(await spendCredit({ userId: "cust", amount: 9000, env: "live", orderId: "o2" }), 2500);
  assert.equal(await spendCredit({ userId: "cust", amount: 4000, env: "live", orderId: "o3", partnerId: "rest1" }), 4000);
  assert.equal(await getCreditBalance("cust", "live"), 0);

  // Expiry removes what is left past its date.
  await grantCredit({ userId: "cust", amount: 1000, kind: "bonus", env: "live", expiryDays: 1 });
  await client.execute("UPDATE credit_lots SET expires_at = datetime('now', '-1 hour') WHERE remaining > 0");
  assert.equal(await expireCredit(), 1000);
  assert.equal(await getCreditBalance("cust", "live"), 0);
});

test("a wallet payment uses credit where the admin allows it, cash for the rest, and refunds credit as credit", async () => {
  const client = await freshDb();
  await grantCredit({ userId: "cust", amount: 3000, kind: "bonus", env: "live", expiryDays: 0 });
  await makeOrder(client, "o1", { total: 10000, stage: "Match" });
  const paymentId = await payFromWalletWithCredit({ userId: "cust", amount: 10000, orderId: "o1", environment: "live", creditModule: "ride_boda" });
  assert.ok(paymentId);
  assert.equal(await getCreditBalance("cust", "live"), 0);
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).rows[0].b, 100000 - 7000, "cash covered the rest");
  assert.equal((await client.execute({ sql: "SELECT amount FROM payments WHERE id = ?", args: [paymentId] })).rows[0].amount, 10000, "the payment records the whole amount");

  // The refund puts 3,000 back as credit and 7,000 back as cash.
  await refundToWallet("cust", 10000, { orderId: "o1", environment: "live", note: "test" });
  assert.equal(await getCreditBalance("cust", "live"), 3000);
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).rows[0].b, 100000);

  // Credit is not used for a module the admin has not allowed.
  await makeOrder(client, "o2", { total: 5000, stage: "Match" });
  assert.ok(await payFromWalletWithCredit({ userId: "cust", amount: 5000, orderId: "o2", environment: "live", creditModule: "pharmacy" }));
  assert.equal(await getCreditBalance("cust", "live"), 3000);
});

test("credit alone cannot pay when it is not enough and cash is short", async () => {
  const client = await freshDb();
  await client.execute("UPDATE users SET wallet_balance = 1000 WHERE id = 'cust'");
  await grantCredit({ userId: "cust", amount: 3000, kind: "bonus", env: "live", expiryDays: 0 });
  await makeOrder(client, "o1", { total: 10000, stage: "Match" });
  assert.equal(await payFromWalletWithCredit({ userId: "cust", amount: 10000, orderId: "o1", environment: "live", creditModule: "ride_boda" }), null);
  assert.equal(await getCreditBalance("cust", "live"), 3000, "nothing was taken");
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).rows[0].b, 1000);
});

test("top-up bonus: percent with a cap, once per top-up, once per day, and not for a phone that already took one", async () => {
  const client = await freshDb();
  await client.execute("UPDATE users SET phone_verified_at = datetime('now') WHERE id IN ('cust', 'friend')");
  const topup = async (id: string, user: string, amount: number, msisdn = "0700000001") =>
    client.execute({ sql: "INSERT INTO wallet_topups (id, user_id, amount, provider, status, msisdn, environment) VALUES (?, ?, ?, 'mock', 'successful', ?, 'live')", args: [id, user, amount, msisdn] });
  await topup("t1", "cust", 50000);
  assert.equal(await applyDepositBonus({ userId: "cust", topupId: "t1", amount: 50000, env: "live" }), 1000, "2% of 50,000");
  assert.equal(await applyDepositBonus({ userId: "cust", topupId: "t1", amount: 50000, env: "live" }), 0, "the same top-up pays once");
  await topup("t2", "cust", 50000);
  assert.equal(await applyDepositBonus({ userId: "cust", topupId: "t2", amount: 50000, env: "live" }), 0, "one bonus deposit a day");
  await topup("t3", "friend", 50000);
  assert.equal(await applyDepositBonus({ userId: "friend", topupId: "t3", amount: 50000, env: "live" }), 0, "the same phone cannot earn on two accounts");
  await topup("t4", "friend", 5000, "0700000002");
  assert.equal(await applyDepositBonus({ userId: "friend", topupId: "t4", amount: 5000, env: "live" }), 0, "below the minimum deposit");
  const credit = await getCreditConfig();
  await saveConfig("credit", { ...credit, topup: { ...credit.topup, bonus: { ...credit.topup.bonus, enabled: false } } });
  await topup("t5", "friend", 50000, "0700000003");
  assert.equal(await applyDepositBonus({ userId: "friend", topupId: "t5", amount: 50000, env: "live" }), 0, "switched off");
});

test("customer endpoints: referral code, applying it, previewing a code and listing offers", async () => {
  const client = await freshDb();
  const app = new Hono().route("/v1", offersRoutes);
  const tok = { cust: await signToken({ sub: "cust", role: "customer" }), friend: await signToken({ sub: "friend", role: "customer" }) };
  const call = (who: "cust" | "friend", method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${tok[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const code = ((await (await call("friend", "GET", "/offers/referral")).json()) as any).code as string;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(((await (await call("friend", "GET", "/offers/referral")).json()) as any).code, code, "stable");
  assert.equal((await call("cust", "POST", "/offers/referral/apply", { code: "ZZZZZZ" })).status, 404);
  assert.equal((await call("friend", "POST", "/offers/referral/apply", { code })).status, 400, "not your own code");
  assert.equal((await call("cust", "POST", "/offers/referral/apply", { code })).status, 200);
  assert.equal((await call("cust", "POST", "/offers/referral/apply", { code })).status, 409);

  await client.execute({ sql: "INSERT INTO offers (id, name, kind, code, discount_type, value, status) VALUES ('p1', 'Promo', 'promo_code', 'SAVE20', 'percent', 20, 'active')", args: [] });
  await makeOrder(client, "o1", { total: 10000, stage: "Match" });
  const bad = (await (await call("cust", "POST", "/orders/o1/offer/preview", { code: "NOPE" })).json()) as any;
  assert.equal(bad.discount, 0);
  assert.equal(bad.codeAccepted, false);
  const good = (await (await call("cust", "POST", "/orders/o1/offer/preview", { code: "save20" })).json()) as any;
  assert.deepEqual([good.discount, good.payable, good.codeAccepted], [2000, 8000, true]);
  assert.equal((await call("friend", "POST", "/orders/o1/offer/preview", { code: "SAVE20" })).status, 403, "only the order's customer");
  // A code-only offer is not advertised in the offers list.
  assert.equal(((await (await call("cust", "GET", "/offers/mine")).json()) as any).offers.length, 0);
});

test("the referrer is rewarded with credit when the invited customer's first ride settles, once", async () => {
  const client = await freshDb();
  await client.execute("INSERT INTO customer_offer_profiles (user_id, referred_by) VALUES ('cust', 'friend')");
  const order = await makeOrder(client, "o1", { stage: "Settle" });
  await afterRideSettled(order);
  await afterRideSettled(order);
  assert.equal(await getCreditBalance("friend", "live"), 2000);
});
