import assert from "node:assert/strict";
import { turnOffIncentives } from "../test-support/no-incentives.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { DEFAULT_CREDIT_CONFIG, DEFAULT_MONEY_FLOW_CONFIG, DEFAULT_PRICING_CONFIG, waterfallBalances } from "@peebee/shared";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { getSetting, setPlatformEnvironment, setSetting } from "../lib/settings.js";
import { getCreditConfig, saveConfig } from "../offers/config.js";
import { offersAdminRoutes } from "../offers/admin-routes.js";
import { getCreditBalance, grantCredit } from "../offers/credit.js";
import { planTopup } from "../offers/topup.js";
import { orderRoutes } from "../orders/routes.js";
import { customerWithdrawalAdminRoutes, customerWithdrawalRoutes } from "../wallet/customer-withdrawals.js";
import { payFromWalletWithCredit } from "../wallet/service.js";
import { costingAdminRoutes } from "./admin-routes.js";

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
  process.env.JWT_SECRET = "costing-test-secret";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const dir = existsSync(join(process.cwd(), "src/db/migrations")) ? join(process.cwd(), "src/db/migrations") : join(process.cwd(), "apps/api/src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  }
  bind(client);
  await setPlatformEnvironment("live");
  await turnOffIncentives();
  for (const [id, role] of [["cust", "customer"], ["rider", "rider"], ["admin", "admin"]] as const) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance, phone_verified_at) VALUES (?, ?, ?, 'h', ?, 100000, datetime('now'))", args: [id, id, id, role] });
  }
  await client.execute("UPDATE users SET admin_role = 'super_admin', created_at = datetime('now', '-300 days') WHERE id IN ('admin', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  return client;
}

const tokens = async () => ({
  cust: await signToken({ sub: "cust", role: "customer" }),
  rider: await signToken({ sub: "rider", role: "rider" }),
  admin: await signToken({ sub: "admin", role: "admin" }),
});

function caller(app: Hono, toks: Record<string, string>) {
  return async (who: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${toks[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
}

const trip = { pickupLat: 0.3136, pickupLng: 32.5811, destinationLat: 0.3476, destinationLng: 32.6 };

test("migration 0148 applies; pricing defaults are the car fare the business uses", async () => {
  await freshDb();
  assert.equal(await getSetting("car_convenient_rate_per_km"), "5000");
  assert.equal(await getSetting("car_convenient_minimum_fare"), "10000");
  assert.equal((await import("./config.js").then((m) => m.getPricingConfig())).multipliers.maxMultiplier, 2.5);
});

test("admin pricing: save rates and a fuel adjustment, quotes follow, the order keeps its breakdown", async () => {
  const client = await freshDb();
  const toks = await tokens();
  const app = new Hono().route("/v1", orderRoutes).route("/v1", costingAdminRoutes);
  const call = caller(app, toks);
  await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'ride')", args: [] });

  const q = `/rides/quote?pickupLat=${trip.pickupLat}&pickupLng=${trip.pickupLng}&destinationLat=${trip.destinationLat}&destinationLng=${trip.destinationLng}`;
  const before = (await call("cust", "GET", q)).body.quote as number;

  const current = await call("admin", "GET", "/admin/pricing");
  assert.equal(current.status, 200);
  assert.equal(current.body.rates.car.ratePerKm, 5000);
  const pricing = structuredClone(current.body.pricing);
  pricing.multipliers.fuel.percent = 20;
  const saved = await call("admin", "PUT", "/admin/pricing", { pricing, rates: { ...current.body.rates, boda: { ratePerKm: 1800, minimumFare: 3000 } } });
  assert.equal(saved.status, 200);
  assert.equal(await getSetting("ride_rate_per_km"), "1800");

  const after = (await call("cust", "GET", q)).body.quote as number;
  assert.ok(after > before * 1.2, `quote rose from ${before} to ${after}`);

  const created = await call("cust", "POST", "/orders", { listId: "l1", type: "parcel", isRide: true, ...trip, pickupArea: "A", destinationArea: "B" });
  assert.equal(created.status, 201);
  assert.equal(created.body.order.estimated_total, after, "the order is charged the quoted fare");
  const row = (await client.execute({ sql: "SELECT fare_breakdown FROM orders WHERE id = ?", args: [created.body.order.id] })).rows[0];
  const breakdown = JSON.parse(String(row.fare_breakdown));
  assert.equal(breakdown.multiplier, 1.2);
  assert.equal(breakdown.total, after);

  // Bad values are refused, and the change is on the activity log.
  assert.equal((await call("admin", "PUT", "/admin/pricing", { pricing: { ...pricing, multipliers: { ...pricing.multipliers, maxMultiplier: 99 } }, rates: current.body.rates })).status, 400);
  assert.equal((await call("cust", "GET", "/admin/pricing")).status, 403);
  assert.ok(Number((await client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action = 'pricing.update'")).rows[0].n) >= 1);
});

test("fare calculator previews unsaved settings", async () => {
  await freshDb();
  const toks = await tokens();
  const call = caller(new Hono().route("/v1", costingAdminRoutes), toks);
  const base = await call("admin", "POST", "/admin/pricing/preview", { service: "car_convenient", distanceKm: 3 });
  assert.equal(base.body.total, 15000);
  const draft = structuredClone(DEFAULT_PRICING_CONFIG);
  draft.multipliers.fuel.percent = 10;
  const preview = await call("admin", "POST", "/admin/pricing/preview", { service: "car_convenient", distanceKm: 3, pricing: draft });
  assert.equal(preview.body.total, 16500);
  const comfort = await call("admin", "POST", "/admin/pricing/preview", { service: "car_comfort", distanceKm: 3 });
  assert.equal(comfort.body.total, 19500, "30% comfort premium");
});

test("money flow: save rates and a commission, calculator splits a 10,000 payment", async () => {
  await freshDb();
  const toks = await tokens();
  const call = caller(new Hono().route("/v1", costingAdminRoutes), toks);
  const cfg = structuredClone(DEFAULT_MONEY_FLOW_CONFIG);
  for (const r of cfg.providerFees) r.enabled = true;
  cfg.modules.ride_car.commission.percent = 12;
  cfg.taxes = [{ id: "vat", name: "VAT on commission", enabled: true, percent: 18, appliesTo: "commission", mode: "inclusive", bearer: "platform", modules: [], effectiveFrom: "2026-01-01" }];
  assert.equal((await call("admin", "PUT", "/admin/money-flow", cfg)).status, 200);
  const w = await call("admin", "POST", "/admin/money-flow/preview", { module: "ride_car", gross: 10000, rail: "mobile_money", provider: "yo" });
  assert.equal(w.body.commission, 1000, "12% of 10,000 is 1,200, kept to a whole 500 (nearest)");
  assert.equal(w.body.gatewayFee, 250);
  assert.equal(w.body.providerShare, 9000);
  assert.equal(w.body.taxTotal, 153, "18% VAT inside a 1,000 commission");
  assert.equal(w.body.customerPays, 10000);
  assert.ok(waterfallBalances(w.body as never));
  assert.equal((await call("admin", "PUT", "/admin/money-flow", { ...cfg, maintenance: { enabled: true, percent: 500, of: "gross" } })).status, 400);
});

test("settling a ride records where the money went, and takes any extra commission the admin set", async () => {
  const client = await freshDb();
  const toks = await tokens();
  const flow = structuredClone(DEFAULT_MONEY_FLOW_CONFIG);
  for (const r of flow.providerFees) r.enabled = true;
  flow.modules.ride_boda.commission.percent = 10;
  await setSetting("money_flow_config", JSON.stringify(flow));

  await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'ride')", args: [] });
  await client.execute({
    sql: `INSERT INTO orders (id, list_id, customer_id, rider_id, stage, payment_rail, estimated_total, final_total, is_ride, type, environment) VALUES ('o1', 'l1', 'cust', 'rider', 'Handover', 'escrow', 6000, 6000, 1, 'parcel', 'live')`,
    args: [],
  });
  await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, network, amount, status) VALUES ('p1', 'o1', 'collection', 'yo', 'mtn', 6000, 'successful')", args: [] });
  const call = caller(new Hono().route("/v1", orderRoutes), toks);
  const res = await call("rider", "POST", "/orders/o1/settle");
  assert.equal(res.status, 200);

  // 6,000 collected, 10% commission = 600, kept to a whole 500 = 500 taken from the rider.
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM riders WHERE user_id = 'rider'")).rows[0].b, 5500);
  const split = (await client.execute("SELECT * FROM payment_splits WHERE order_id = 'o1'")).rows[0];
  assert.equal(split.module, "ride_boda");
  assert.equal(split.rail, "mobile_money");
  assert.deepEqual([split.gross, split.commission, split.gateway_fee, split.provider_share, split.platform_net], [6000, 500, 150, 5500, 350]);
  assert.equal(split.extra_commission, 500);
  assert.equal(split.customer_pays, 6000);

  // A second settle never records or charges twice.
  await client.execute("UPDATE orders SET stage = 'Handover' WHERE id = 'o1'");
  await call("rider", "POST", "/orders/o1/settle");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM payment_splits")).rows[0].n), 1);

  // The report adds it up.
  const report = await caller(new Hono().route("/v1", costingAdminRoutes), toks)("admin", "GET", "/admin/money-flow/report?days=30");
  assert.equal(report.body.totals.commission, 500);
  assert.equal(report.body.byModule[0].module, "ride_boda");
});

test("with no extra commission set, settlement pays the rider exactly as before and still records the split", async () => {
  const client = await freshDb();
  const toks = await tokens();
  await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'ride')", args: [] });
  await client.execute({ sql: `INSERT INTO orders (id, list_id, customer_id, rider_id, stage, payment_rail, estimated_total, final_total, is_ride, type, environment) VALUES ('o1', 'l1', 'cust', 'rider', 'Handover', 'escrow', 4000, 4000, 1, 'parcel', 'live')`, args: [] });
  await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, status) VALUES ('p1', 'o1', 'collection', 'wallet', 4000, 'successful')", args: [] });
  await caller(new Hono().route("/v1", orderRoutes), toks)("rider", "POST", "/orders/o1/settle");
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM riders WHERE user_id = 'rider'")).rows[0].b, 4000);
  const split = (await client.execute("SELECT * FROM payment_splits WHERE order_id = 'o1'")).rows[0];
  assert.deepEqual([split.rail, split.commission, split.gateway_fee, split.provider_share], ["wallet", 0, 0, 4000]);
});

test("top-up plan: nothing changes without a gateway rate; customer pays or Peebee covers, with caps", () => {
  const credit = structuredClone(DEFAULT_CREDIT_CONFIG);
  const flow = structuredClone(DEFAULT_MONEY_FLOW_CONFIG);
  const none = { coverUsedByCustomer: 0, coverUsedByEveryone: 0 };
  const topup = { amount: 10_000, provider: "yo", network: "mtn" };
  const on = new Date("2026-10-29");
  assert.deepEqual(planTopup(credit, flow, topup, none, on), { amount: 10_000, gatewayFee: 0, taxOnFee: 0, cash: 10_000, feeCover: 0, customerBears: 0 });

  for (const r of flow.providerFees) r.enabled = true;
  assert.deepEqual(planTopup(credit, flow, topup, none, on), { amount: 10_000, gatewayFee: 250, taxOnFee: 0, cash: 9_750, feeCover: 250, customerBears: 0 }, "make whole: the wallet shows 10,000");
  credit.topup.feeMode = "customer_pays";
  assert.deepEqual(planTopup(credit, flow, topup, none, on), { amount: 10_000, gatewayFee: 250, taxOnFee: 0, cash: 9_750, feeCover: 0, customerBears: 250 });

  credit.topup.feeMode = "make_whole";
  credit.topup.makeWholeMonthlyCapPerCustomer = 400;
  assert.equal(planTopup(credit, flow, topup, { coverUsedByCustomer: 300, coverUsedByEveryone: 0 }, on).feeCover, 100, "only what is left of the monthly cap");
  credit.topup.makeWholeMonthlyCapPerCustomer = 0;
  credit.topup.makeWholeMonthlyBudget = 1_000;
  assert.equal(planTopup(credit, flow, topup, { coverUsedByCustomer: 0, coverUsedByEveryone: 900 }, on).feeCover, 100, "and the platform budget");
  credit.topup.makeWholeMonthlyBudget = 0;
  credit.topup.makeWholeMinTopup = 20_000;
  assert.equal(planTopup(credit, flow, topup, none, on).feeCover, 0, "below the minimum top-up");
  credit.topup.makeWholeMinTopup = 0;

  flow.taxes = [{ id: "ex", name: "Excise on fees", enabled: true, percent: 20, appliesTo: "gateway_fee", mode: "on_top", bearer: "platform", modules: [], effectiveFrom: "2026-01-01" }];
  const withTax = planTopup(credit, flow, topup, none, on);
  assert.deepEqual([withTax.taxOnFee, withTax.cash, withTax.feeCover, withTax.customerBears], [50, 9_700, 250, 50], "tax is not covered unless the admin says so");
  credit.topup.makeWholeIncludesTax = true;
  const covered = planTopup(credit, flow, topup, none, on);
  assert.deepEqual([covered.feeCover, covered.customerBears], [300, 0]);
  credit.enabled = false;
  assert.equal(planTopup(credit, flow, topup, none, on).feeCover, 0);
});

test("fee-cover credit works for any order, other bonus credit only where allowed, and neither can be withdrawn", async () => {
  const client = await freshDb();
  await grantCredit({ userId: "cust", amount: 400, kind: "fee_cover", env: "live", expiryDays: 0 });
  await grantCredit({ userId: "cust", amount: 600, kind: "bonus", env: "live", expiryDays: 0 });
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'x')");
  await client.execute("INSERT INTO orders (id, list_id, customer_id, stage, type, environment) VALUES ('o1', 'l1', 'cust', 'Match', 'parcel', 'live')");
  // Pharmacy does not accept bonus credit by default, but the covered fee still works there.
  assert.ok(await payFromWalletWithCredit({ userId: "cust", amount: 5000, orderId: "o1", environment: "live", creditModule: "pharmacy" }));
  assert.equal(await getCreditBalance("cust", "live"), 600, "only the fee-cover credit was used");
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).rows[0].b, 100000 - 4600);
});

test("customer withdrawals: off by default, then locked deposits, per-request share, daily limit, review and approval", async () => {
  const client = await freshDb();
  await setPlatformEnvironment("sandbox");
  await client.execute("UPDATE users SET wallet_balance_sandbox = 100000 WHERE id = 'cust'");
  const toks = await tokens();
  const app = new Hono().route("/v1", customerWithdrawalRoutes).route("/v1", customerWithdrawalAdminRoutes);
  const call = caller(app, toks);
  const body = { amount: 10000, msisdn: "0772000001" };

  assert.equal((await call("cust", "POST", "/wallet/withdraw", body)).status, 403, "closed-loop until an admin opens it");

  const cfg = await getCreditConfig();
  await saveConfig("credit", { ...cfg, withdrawal: { ...cfg.withdrawal, enabled: true, lockDays: 3, maxPercentPerRequest: 50, minAmount: 5000, dailyLimit: 60000, reviewIfWithinDays: 3 } });

  // 60,000 of the balance arrived yesterday: it is locked, so only 40,000 can go, capped at 50% = 50,000.
  await client.execute("INSERT INTO wallet_topups (id, user_id, amount, provider, status, environment, created_at) VALUES ('t1', 'cust', 60000, 'mock', 'successful', 'sandbox', datetime('now', '-1 day'))");
  const info = await call("cust", "GET", "/wallet/withdrawals");
  assert.deepEqual([info.body.cash, info.body.locked, info.body.allowed], [100000, 60000, 40000]);
  const tooMuch = await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 45000 });
  assert.equal(tooMuch.status, 409);
  assert.match(String(tooMuch.body.message), /last 3 days/);
  assert.equal((await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 1000 })).status, 409, "below the minimum");

  const ok = await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 30000 });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.status, "pending");
  assert.equal((await client.execute("SELECT wallet_balance_sandbox AS b FROM users WHERE id = 'cust'")).rows[0].b, 70000, "debited at once");
  // The daily limit counts what was already requested today.
  assert.equal((await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 35000 })).status, 409);

  // After a bonus, a withdrawal waits for an admin; declining returns the money, approving sends it.
  await grantCredit({ userId: "cust", amount: 500, kind: "bonus", env: "sandbox", expiryDays: 0 });
  const held = await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 6000 });
  assert.equal(held.status, 202);
  assert.equal(held.body.status, "review");
  const pending = await call("admin", "GET", "/admin/wallet-withdrawals?status=review");
  assert.equal(pending.body.withdrawals.length, 1);
  const before = Number((await client.execute("SELECT wallet_balance_sandbox AS b FROM users WHERE id = 'cust'")).rows[0].b);
  assert.equal((await call("admin", "POST", `/admin/wallet-withdrawals/${held.body.id}/reject`)).status, 200);
  assert.equal((await client.execute("SELECT wallet_balance_sandbox AS b FROM users WHERE id = 'cust'")).rows[0].b, before + 6000);
  assert.equal((await call("admin", "POST", `/admin/wallet-withdrawals/${held.body.id}/reject`)).status, 404, "already handled");

  const held2 = await call("cust", "POST", "/wallet/withdraw", { ...body, amount: 6000 });
  assert.equal(held2.body.status, "review");
  assert.equal((await call("admin", "POST", `/admin/wallet-withdrawals/${held2.body.id}/approve`)).status, 202);
  assert.equal((await client.execute({ sql: "SELECT status FROM customer_withdrawals WHERE id = ?", args: [held2.body.id] })).rows[0].status, "pending");
  assert.equal((await call("cust", "GET", "/admin/wallet-withdrawals")).status, 403);
});

test("reversing a top-up takes the cash back and, when chosen, the bonus it earned", async () => {
  const client = await freshDb();
  const toks = await tokens();
  const call = caller(new Hono().route("/v1", offersAdminRoutes), toks);
  await client.execute("INSERT INTO wallet_topups (id, user_id, amount, provider, status, environment) VALUES ('topup1', 'cust', 50000, 'mock', 'successful', 'live')");
  await grantCredit({ userId: "cust", amount: 1000, kind: "bonus", env: "live", topupId: "topup1", expiryDays: 0 });
  const res = await call("admin", "POST", "/admin/offers/credit/reverse-topup", { topupId: "topup1" });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.cashReversed, res.body.creditClawedBack], [50000, 1000]);
  assert.equal((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).rows[0].b, 50000);
  assert.equal(await getCreditBalance("cust", "live"), 0);
  assert.equal((await call("admin", "POST", "/admin/offers/credit/reverse-topup", { topupId: "topup1" })).status, 404, "a reversed top-up is not successful any more");
});

test("the rounding switch: saved by the admin, applied to quotes, previewed before saving", async () => {
  const client = await freshDb();
  const toks = await tokens();
  const { applyRounding, getRoundingConfig } = await import("./config.js");
  const { getRoundingRule, setRoundingRule, DEFAULT_ROUNDING_RULE } = await import("@peebee/shared");
  try {
    const call = caller(new Hono().route("/v1", costingAdminRoutes), toks);
    const current = await call("admin", "GET", "/admin/pricing");
    assert.deepEqual(current.body.rounding, { enabled: true, step: 500, roundUpAfter: 100 }, "ships as: whole 500s, round up after 100");

    // A 4.46 km boda ride at 1,500/km is 6,690: not a round figure, so the rounding rule shows.
    const preview = (rounding?: unknown) => call("admin", "POST", "/admin/pricing/preview", { service: "boda", distanceKm: 4.46, rates: { ...current.body.rates, boda: { ratePerKm: 1_500, minimumFare: 2_500 } }, ...(rounding ? { rounding } : {}) });
    const raw = 4.46 * 1_500; // 6,690
    assert.equal((await preview()).body.total, 7_000, `${raw} is 190 into the step, so it rounds up`);
    // Try a different rule without saving it.
    assert.equal((await preview({ enabled: true, step: 500, roundUpAfter: 249 })).body.total, 6_500, "plain nearest 500");
    assert.equal((await preview({ enabled: true, step: 1000, roundUpAfter: 500 })).body.total, 7_000);
    assert.equal((await preview({ enabled: false, step: 500, roundUpAfter: 100 })).body.total, 6_690, "rounding off: exact");
    assert.deepEqual(await getRoundingConfig(), { enabled: true, step: 500, roundUpAfter: 100 }, "previewing saved nothing");

    // Save it, and the next request uses it.
    const saved = await call("admin", "PUT", "/admin/pricing", { pricing: current.body.pricing, rates: current.body.rates, rounding: { enabled: true, step: 1000, roundUpAfter: 500 } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.rounding, { enabled: true, step: 1000, roundUpAfter: 500 });
    setRoundingRule(DEFAULT_ROUNDING_RULE);
    await applyRounding();
    assert.deepEqual(getRoundingRule(), { enabled: true, step: 1000, roundUpAfter: 500 });
    // A step smaller than 500 is refused.
    assert.equal((await call("admin", "PUT", "/admin/pricing", { pricing: current.body.pricing, rates: current.body.rates, rounding: { enabled: true, step: 100, roundUpAfter: 50 } })).status, 400);
    assert.ok(Number((await client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action = 'pricing.update'")).rows[0].n) >= 1);
  } finally {
    setRoundingRule(DEFAULT_ROUNDING_RULE);
  }
});

test("financial model snapshot requires Admin access and reads only live aggregates", async () => {
  const client = await freshDb();
  await setSetting("monetization_delivery_commission_enabled", "1");
  await setSetting("monetization_delivery_commission_parcel_percent", "12");
  await client.execute(`INSERT INTO payment_splits
    (id, order_id, module, rail, environment, gross, commission, service_fee, created_at)
    VALUES ('live1', 'order1', 'delivery_parcel', 'cash', 'live', 25000, 3000, 1000, datetime('now', '-1 day')),
           ('sandbox1', 'order2', 'delivery_parcel', 'cash', 'sandbox', 99999, 9999, 0, datetime('now', '-1 day')),
           ('old1', 'order3', 'delivery_parcel', 'cash', 'live', 99999, 9999, 0, datetime('now', '-31 days'))`);
  const { adminRoutes } = await import("../admin/routes.js");
  const app = new Hono().route("/v1", adminRoutes);
  const request = caller(app, await tokens());
  const url = "/admin/financial-model";
  assert.equal((await app.request(`/v1${url}`)).status, 401);
  assert.equal((await request("cust", "GET", url)).status, 403);
  const response = await request("admin", "GET", url);
  assert.equal(response.status, 200);
  assert.equal(response.body.rates.find((rate: { name: string }) => rate.name === "Parcel delivery commission").value, 12);
  assert.deepEqual(response.body.activity[0].rows, [{ name: "delivery_parcel", orders: 1, volume: 25000, fees: 4000 }]);
  await client.execute("DROP TABLE payment_splits");
  resetSchemaCache();
  const withoutSplits = await request("admin", "GET", url);
  assert.equal(withoutSplits.status, 200);
  assert.equal(withoutSplits.body.activity[0].available, false);
});

test("shared forecast requires finance permissions and rejects stale writes", async () => {
  const client = await freshDb();
  const { adminRoutes } = await import("../admin/routes.js");
  const app = new Hono().route("/v1", adminRoutes);
  const request = caller(app, await tokens());
  const path = "/admin/financial-model/draft";
  const answers = { company: "Peebee", tax: "30" };
  assert.equal((await app.request(`/v1${path}`)).status, 401);
  assert.equal((await request("cust", "GET", path)).status, 403);
  assert.equal((await request("admin", "PUT", path, { revision: null, answers: { company: [] } })).status, 400);
  const empty = await request("admin", "GET", path);
  assert.deepEqual(empty.body, { draft: null });
  const first = await request("admin", "PUT", path, { revision: null, answers });
  assert.equal(first.status, 200);
  const revision = first.body.draft.revision;
  assert.equal((await request("admin", "PUT", path, { revision: null, answers })).status, 409);
  const update = { ...answers, tax: "28" };
  assert.equal((await request("admin", "PUT", path, { revision, answers: update })).status, 200);
  assert.equal((await request("admin", "PUT", path, { revision, answers })).status, 409);
  const latest = await request("admin", "GET", path);
  assert.deepEqual(latest.body.draft.answers, update);
  await client.execute("UPDATE users SET admin_role = NULL WHERE id = 'admin'");
  assert.equal((await request("admin", "GET", path)).status, 403);
  assert.equal((await request("admin", "PUT", path, { revision, answers })).status, 403);
});
