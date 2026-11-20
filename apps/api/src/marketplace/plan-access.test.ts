import assert from "node:assert/strict";
import test from "node:test";
import { addAdmin, addMerchantStore, addUser, app, freshDatabase } from "../test-support/db.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { planLimits, storePlan } from "./plans.js";
import { priceCheckoutItems } from "./pricing.js";

const json = async (r: Response) => await r.json() as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;
async function setup() {
  const db = await freshDatabase(); invalidateSettingsCache();
  const merchant = await addMerchantStore(db, "access-owner");
  const row = async () => (await db.execute({ sql: "SELECT * FROM stores WHERE id=?", args: [merchant.storeId] })).rows[0];
  const tier = async (plan: "merchant" | "pro" | "elite") => {
    await db.execute({ sql: "UPDATE stores SET plan_legacy=0,pro_tier=?,pro_expires_at=NULL,elite_tier=?,elite_expires_at=NULL WHERE id=?", args: [plan === "merchant" ? "free" : "pro_live", plan === "elite" ? 1 : 0, merchant.storeId] });
  };
  return { db, merchant, row, tier };
}

test("Merchant exposes payments-only capabilities and rejects every catalog entry point", async () => {
  const { db, merchant, tier, row } = await setup(); await tier("merchant");
  const metadata = await json(await merchant.call("/merchants/me/store"));
  assert.equal(metadata.store.plan.plan, "merchant");
  assert.deepEqual(metadata.store.plan.features, { catalog: false, live: false, ads: false });
  assert.equal((await planLimits(await storePlan(await row()))).products, 0);
  for (const [path, method] of [
    ["/products", "GET"], ["/products", "POST"], ["/products/starter-pack", "POST"], ["/products/old/variations", "PUT"],
    ["/collections", "GET"], ["/discounts", "GET"], ["/storefront-sections", "GET"],
    ["/store/items", "POST"], ["/store/items/old", "PUT"], ["/store/media", "POST"],
    ["/store/live/start", "POST"], ["/store/live/camera/start", "POST"],
  ]) {
    const response = await merchant.call(`/merchants/me${path}`, method, method === "GET" ? undefined : {});
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal((await json(response)).error, "plan_required");
  }
  assert.equal((await merchant.call("/merchants/me/store/plans")).status, 200);
  assert.equal((await merchant.call(`/merchants/${merchant.merchantId}/balance`)).status, 200);
  assert.equal((await merchant.call(`/merchants/${merchant.merchantId}/payments`)).status, 200);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM store_products")).rows[0].n, 0);
});

test("Pro and Elite retain their tools while free pricing cannot promote a legacy Merchant", async () => {
  const { db, merchant, tier, row } = await setup();
  const admin = await addAdmin(db);
  for (const plan of ["pro", "elite"] as const) {
    await tier(plan);
    const metadata = await json(await merchant.call("/merchants/me/store"));
    assert.deepEqual(metadata.store.plan.features, { catalog: true, live: true, ads: true });
    assert.equal((await merchant.call("/merchants/me/products")).status, 200);
    assert.equal((await merchant.call("/merchants/me/pos-sales")).status, plan === "elite" ? 200 : 403);
  }
  await tier("merchant");
  await db.execute({ sql: "UPDATE stores SET plan_legacy=1 WHERE id=?", args: [merchant.storeId] });
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('marketplace_pro_pricing_mode','free')"); invalidateSettingsCache();
  assert.equal((await storePlan(await row())).plan, "merchant");
  assert.equal((await merchant.call("/merchants/me/products")).status, 403);
  await admin.setOptions({ merchant_plan_legacy_access: "keep_access" });
  assert.equal((await storePlan(await row())).isElite, false);
  await db.execute("ALTER TABLE stores DROP COLUMN plan_legacy"); resetSchemaCache();
  assert.equal((await storePlan(await row())).plan, "merchant", "missing migrations also fail closed");
});

test("admin controls plan features and limits; another business's subscription cannot unlock them", async () => {
  const { db, merchant, tier } = await setup(); await tier("merchant");
  const other = await addMerchantStore(db, "other-access");
  await db.execute({ sql: "UPDATE stores SET elite_tier=1 WHERE id=?", args: [other.storeId] });
  await db.execute({ sql: "INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES (?,'access-owner','manager','active')", args: [other.merchantId] });
  const headers = { Authorization: `Bearer ${merchant.token}`, "X-Merchant-Id": merchant.merchantId };
  assert.equal((await app.request("/v1/merchants/me/products", { headers })).status, 403);
  const admin = await addAdmin(db);
  await admin.setOptions({ merchant_plan_merchant_features: ["catalog"], merchant_plan_free_max_products: 2 });
  assert.equal((await app.request("/v1/merchants/me/products", { headers })).status, 200);
  const metadata = await json(await app.request("/v1/merchants/me/store", { headers }));
  assert.deepEqual(metadata.store.plan.features, { catalog: true, live: false, ads: false });
  await tier("pro"); await admin.setOptions({ merchant_plan_pro_features: ["catalog"] });
  assert.equal((await merchant.call("/merchants/me/store/live/start", "POST", {})).status, 403);
  await admin.setOptions({ merchant_plan_pro_features: [] });
  assert.deepEqual((await json(await merchant.call("/merchants/me/store"))).store.plan.features, { catalog: false, live: false, ads: false });
  assert.equal((await merchant.call("/merchants/me/products")).status, 403, "an empty admin choice never falls back to granting catalog");
});

test("a zero-day trial stays off, and an expired or downgraded catalog cannot accept new online orders", async () => {
  const { db, merchant, tier } = await setup();
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('marketplace_pro_trial_days','0')"); invalidateSettingsCache();
  const noTrial = await addMerchantStore(db, "no-trial");
  const metadata = await json(await noTrial.call("/merchants/me/store"));
  assert.equal(metadata.store.plan.plan, "merchant"); assert.equal(metadata.store.plan.isPaidTier, false);
  await tier("pro");
  await db.execute({ sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('old-item',?,'Old item',1000,4)", args: [merchant.storeId] });
  const buyer = await addUser(db, "access-buyer");
  await tier("merchant");
  const publicStore = await app.request(`/v1/marketplace/stores/${merchant.storeId}`);
  assert.notEqual(publicStore.status, 200);
  const calculated = await priceCheckoutItems([{storeId:merchant.storeId,productId:"old-item",quantity:1,title:"Untrusted",price:1}], {});
  assert.equal(calculated.ok, false);
  if (!calculated.ok) assert.equal(calculated.error, "store_unavailable");
  const quoted = await app.request("/v1/marketplace/checkout/quote", { method: "POST", headers: { Authorization: `Bearer ${buyer}`, "Content-Type": "application/json" }, body: JSON.stringify({items:[{storeId:merchant.storeId,productId:"old-item",quantity:1}]}) });
  assert.notEqual(quoted.status, 200);
  assert.equal((await db.execute("SELECT inventory_quantity FROM store_products WHERE id='old-item'")).rows[0].inventory_quantity, 4);
  assert.equal((await merchant.call("/merchants/me/digital-fulfillments")).status, 200, "past purchases remain serviceable");
  await tier("elite");
  await db.execute({ sql: "UPDATE stores SET pro_expires_at='2000-01-01',elite_expires_at='2000-01-01' WHERE id=?", args: [merchant.storeId] });
  assert.equal((await json(await merchant.call("/merchants/me/store"))).store.plan.plan, "merchant");
});

test("downgrade denies a new broadcast but keeps termination of an existing broadcast available", async () => {
  const { db, merchant, tier } = await setup(); await tier("pro");
  const started = await merchant.call("/merchants/me/store/live/start", "POST", { title: "Earlier broadcast", streamUrl: "https://example.test/live.m3u8" });
  assert.equal(started.status, 200, JSON.stringify(await started.clone().json()));
  await tier("merchant");
  assert.equal((await merchant.call("/merchants/me/store/live/start", "POST", {})).status, 403);
  assert.equal((await merchant.call("/merchants/me/store/live/end", "POST", {})).status, 200);
  assert.equal((await db.execute({ sql: "SELECT is_live FROM stores WHERE id=?", args: [merchant.storeId] })).rows[0].is_live, 0);
});
