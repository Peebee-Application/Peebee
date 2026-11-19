import test from "node:test";
import assert from "node:assert/strict";
import { addAdmin, addMerchantStore, addUser, app, freshDatabase } from "../test-support/db.js";
import { invalidateSettingsCache } from "../lib/settings.js";

const json = async (res: Response) => (await res.json()) as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;

async function setSetting(client: Db, key: string, value: string) {
  await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
  invalidateSettingsCache();
}
const as = (token: string) => (path: string, method = "GET", body?: object) =>
  app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const wallet = async (client: Db, id: string) => Number((await client.execute({ sql: "SELECT wallet_balance FROM users WHERE id = ?", args: [id] })).rows[0].wallet_balance);

/** A store that has lost its free launch trial: a plain Merchant. */
async function plainMerchant(client: Db, id = "u_plan_owner") {
  const s = await addMerchantStore(client, id);
  await client.execute({ sql: "UPDATE stores SET pro_tier = 'free', pro_expires_at = NULL, elite_tier = 0, elite_expires_at = NULL WHERE id = ?", args: [s.storeId] });
  return s;
}
const me = async (s: { call: (p: string) => Response | Promise<Response> }) => (await json(await s.call("/merchants/me/store"))).store;

test("a store starts as a plain Merchant once its trial is over, with the admin's limits", async () => {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const s = await plainMerchant(client);
  const store = await me(s);
  assert.equal(store.plan.plan, "merchant");
  assert.equal(store.pro_tier, "free");
  assert.equal(store.plan.legacy, false);

  assert.equal((await s.call("/merchants/me/products")).status, 403, "Merchant defaults to payments only");
  await admin.setOptions({ merchant_plan_merchant_features: ["catalog"], merchant_plan_free_max_products: 2 });
  const add = (title: string) => s.call("/merchants/me/products", "POST", { title, price: 1000, inventory_quantity: 5 });
  assert.equal((await add("Mango")).status, 200);
  assert.equal((await add("Papaya")).status, 200);
  const third = await add("Guava");
  assert.equal(third.status, 409, "the Merchant plan stops at the admin's product limit");
  assert.equal((await json(third)).error, "product_limit_reached");
});

test("the Elite-only tools are refused without an active Elite plan, and open with one", async () => {
  const client = await freshDatabase();
  const s = await plainMerchant(client);
  const denied = await s.call("/merchants/me/pos-sales");
  assert.equal(denied.status, 403);
  const body = await json(denied);
  assert.equal(body.error, "plan_required");
  assert.equal(body.requiredPlan, "elite");
  for (const path of ["/merchants/me/stock-transfers", "/merchants/me/elite-analytics", "/merchants/me/suppliers", "/merchants/me/bundles", "/merchants/me/winback-campaigns"]) {
    assert.equal((await s.call(path)).status, 403, path);
  }
  assert.equal((await s.call("/merchants/me/products")).status, 403, "catalog requires an eligible plan too");

  const up = await s.call("/merchants/me/store/tier", "POST", { tier: "elite" }); // pricing is free by default
  assert.equal(up.status, 200);
  assert.equal((await s.call("/merchants/me/pos-sales")).status, 200);
});

test("with free pricing an upgrade costs nothing but is still the merchant's own choice", async () => {
  const client = await freshDatabase();
  const s = await plainMerchant(client);
  const pro = await json(await s.call("/merchants/me/store/tier", "POST", { tier: "pro_live" }));
  assert.equal(pro.amountPaid, 0);
  const store = await me(s);
  assert.equal(store.plan.plan, "pro_live");
  assert.ok(store.plan.daysLeft >= 29 && store.plan.daysLeft <= 30);
  const sub = (await client.execute("SELECT plan, amount_paid FROM store_subscriptions ORDER BY created_at DESC LIMIT 1")).rows[0] as any;
  assert.equal(sub.plan, "pro_live");
});

test("paid plans come out of the owner's wallet, once, with a balanced ledger entry", async () => {
  const client = await freshDatabase();
  await setSetting(client, "marketplace_pro_pricing_mode", "paid");
  await setSetting(client, "marketplace_elite_price_ugx", "150000");
  await setSetting(client, "marketplace_pro_live_price_ugx", "75000");
  const s = await plainMerchant(client);
  const buy = (tier: string) => s.call("/merchants/me/store/tier", "POST", { tier });

  const broke = await buy("elite");
  assert.equal(broke.status, 402);
  assert.equal((await json(broke)).neededUgx, 150000);
  assert.equal((await me(s)).plan.plan, "merchant", "no money, no plan");

  await client.execute("UPDATE users SET wallet_balance = 400000 WHERE id = 'u_plan_owner'");
  const ok = await json(await buy("elite"));
  assert.equal(ok.amountPaid, 150000);
  assert.equal(await wallet(client, "u_plan_owner"), 250000);
  assert.equal((await me(s)).plan.plan, "elite");

  const tx = (await client.execute("SELECT id FROM ledger_transactions WHERE kind = 'merchant_plan'")).rows;
  assert.equal(tx.length, 1);
  const sum = (await client.execute({ sql: "SELECT SUM(amount) AS t FROM ledger_entries WHERE transaction_id = ?", args: [String((tx[0] as any).id)] })).rows[0] as any;
  assert.equal(Number(sum.t), 0, "the ledger entry balances");

  // Renewing adds a month to the end of the current plan.
  const before = Date.parse((await me(s)).plan.expiresAt);
  await buy("elite");
  const after = Date.parse((await me(s)).plan.expiresAt);
  assert.ok(Math.abs(after - before - 30 * 86400000) < 5000, "renewal extends from the current end");
  assert.equal(await wallet(client, "u_plan_owner"), 100000);

  // A lower plan can't be bought on top of a higher one that is still running.
  const lower = await buy("pro_live");
  assert.equal(lower.status, 409);
  assert.equal((await json(lower)).error, "already_on_higher_plan");
  assert.equal(await wallet(client, "u_plan_owner"), 100000, "refused before any money moved");
});

test("only the owner can buy a plan", async () => {
  const client = await freshDatabase();
  await setSetting(client, "marketplace_pro_pricing_mode", "paid");
  const s = await plainMerchant(client);
  const mgr = await addUser(client, "u_plan_manager");
  await client.execute({ sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, 'u_plan_manager', 'manager', 'active')", args: [s.merchantId] });
  await client.execute("UPDATE users SET wallet_balance = 500000 WHERE id = 'u_plan_manager'");
  const res = await as(mgr)("/merchants/me/store/tier", "POST", { tier: "pro_live" });
  assert.equal(res.status, 403);
  assert.equal(await wallet(client, "u_plan_manager"), 500000);
});

test("when a plan ends the store drops back to Merchant, and the app is told before it does", async () => {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const s = await plainMerchant(client);
  await s.call("/merchants/me/store/tier", "POST", { tier: "elite" });
  assert.equal((await s.call("/merchants/me/pos-sales")).status, 200);

  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  await client.execute({ sql: "UPDATE stores SET elite_expires_at = ?, pro_expires_at = ? WHERE id = ?", args: [soon, soon, s.storeId] });
  const warn = (await me(s)).plan;
  assert.equal(warn.plan, "elite");
  assert.equal(warn.warn, true, "within the warning window");
  await admin.setOptions({ merchant_plan_warn_days: 1 });
  assert.equal((await me(s)).plan.warn, false, "admin chose when to warn");

  const past = new Date(Date.now() - 3600_000).toISOString();
  await client.execute({ sql: "UPDATE stores SET elite_expires_at = ?, pro_expires_at = ? WHERE id = ?", args: [past, past, s.storeId] });
  assert.equal((await me(s)).plan.plan, "merchant");
  assert.equal((await s.call("/merchants/me/pos-sales")).status, 403, "Elite tools close again");
});

test("legacy Merchant accounts do not receive Elite just because pricing is free", async () => {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const s = await plainMerchant(client);
  await client.execute({ sql: "UPDATE stores SET plan_legacy = 1 WHERE id = ?", args: [s.storeId] });
  const kept = await me(s);
  assert.equal(kept.plan.plan, "merchant");
  assert.equal(kept.plan.isElite, false, "free pricing does not assign a higher plan");
  assert.equal((await s.call("/merchants/me/pos-sales")).status, 403);

  await admin.setOptions({ merchant_plan_legacy_access: "follow_plan" });
  assert.equal((await me(s)).plan.plan, "merchant");
  assert.equal((await s.call("/merchants/me/pos-sales")).status, 403);
});

test("the plan options are admin-controlled, and mobile money is shown as not built yet", async () => {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const all = await json(await admin.call("/admin/option-settings?module=plans"));
  const keys = all.settings.map((x: any) => x.key);
  for (const k of ["merchant_plan_legacy_access", "merchant_plan_payment", "merchant_plan_free_max_products", "merchant_plan_warn_days"]) assert.ok(keys.includes(k), k);
  const pay = all.settings.find((x: any) => x.key === "merchant_plan_payment");
  assert.equal(pay.effective, "wallet");
  assert.equal(pay.options.find((o: any) => o.value === "mobile_money").available, false);
});

test("Elite-only store settings can't be changed without the plan, but an unchanged form still saves", async () => {
  const client = await freshDatabase();
  const s = await plainMerchant(client);
  const put = (body: object) => s.call("/merchants/me/store", "PUT", body);

  const theme = await put({ theme_layout: "editorial" });
  assert.equal(theme.status, 403);
  const body = await json(theme);
  assert.equal(body.error, "plan_required");
  assert.deepEqual(body.fields, ["theme_layout"]);
  assert.equal((await json(await put({ loyalty_enabled: true, b2b_wholesale_enabled: true }))).fields.length, 2);

  // The app sends the whole form: values that haven't changed, and ordinary fields, must not be refused.
  const same = await put({ name: "Better Name", theme_layout: "grid", theme_accent: "gold", loyalty_enabled: false, b2b_wholesale_enabled: false, hero_headline: "" });
  assert.equal(same.status, 200, JSON.stringify(await same.clone().json()));

  await s.call("/merchants/me/store/tier", "POST", { tier: "elite" });
  assert.equal((await put({ theme_layout: "editorial", loyalty_enabled: true })).status, 200);
  assert.equal((await me(s)).theme_layout, "editorial");
});

test("a custom domain stops being served when the Elite plan ends", async () => {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  await admin.setOptions({ storefront_domain_mode: "subdomain_plus_verified_custom_domains" });
  const s = await plainMerchant(client);
  await s.call("/merchants/me/store/tier", "POST", { tier: "elite" });
  await client.execute({ sql: "UPDATE stores SET custom_domain = 'shop.example.ug', domain_verified = 1 WHERE id = ?", args: [s.storeId] });

  const byDomain = () => app.request("/v1/marketplace/stores/shop.example.ug");
  assert.equal((await byDomain()).status, 200, "served while the plan is active");
  const past = new Date(Date.now() - 3600_000).toISOString();
  await client.execute({ sql: "UPDATE stores SET elite_expires_at = ?, pro_expires_at = ? WHERE id = ?", args: [past, past, s.storeId] });
  assert.notEqual((await byDomain()).status, 200, "not served once the plan has ended");
  assert.equal((await app.request(`/v1/marketplace/stores/${s.slug}`)).status, 404, "Merchant has no online storefront");
  await s.call("/merchants/me/store/tier", "POST", { tier: "pro_live" });
  assert.equal((await app.request(`/v1/marketplace/stores/${s.slug}`)).status, 200, "the Peebee address works with an active Pro plan");
});
