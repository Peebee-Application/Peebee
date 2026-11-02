import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, addMerchantStore, addUser, app } from "../test-support/db.js";
import { invalidateSettingsCache } from "../lib/settings.js";

const json = async (r: Response) => await r.json() as any;
async function elite(db: Awaited<ReturnType<typeof freshDatabase>>, name: string) {
  const merchant = await addMerchantStore(db, name);
  assert.equal((await merchant.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  return merchant;
}
async function outlet(db: Awaited<ReturnType<typeof freshDatabase>>, merchantId: string, id: string) {
  await db.execute({sql: "INSERT INTO merchant_outlets(id,merchant_id,category_id,name,code,lat,lng,status) SELECT ?,?,id,?,?,0,0,'active' FROM merchant_categories LIMIT 1", args: [id, merchantId, id, id]});
}

test("inventory writes cannot overwrite another merchant's stock", async () => {
  const db = await freshDatabase(); const a = await elite(db, "stock-a"); const b = await elite(db, "stock-b");
  await outlet(db, b.merchantId, "victim-outlet");
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('victim-product',?,'Victim',1000,4)", args: [b.storeId]});
  await db.execute({sql: "INSERT INTO store_outlet_inventory(id,store_id,product_id,outlet_id,quantity) VALUES ('victim-stock',?,'victim-product','victim-outlet',4)", args: [b.storeId]});
  assert.equal((await a.call("/merchants/me/outlet-inventory", "PUT", {productId: "victim-product", outletId: "victim-outlet", quantity: 999})).status, 404);
  assert.equal((await db.execute("SELECT quantity FROM store_outlet_inventory WHERE id='victim-stock'")).rows[0].quantity, 4);
});

test("competing transfers conserve stock and roll back the losing request", async () => {
  const db = await freshDatabase(); const s = await elite(db, "transfer-owner");
  for (const id of ["source", "destination"]) await outlet(db, s.merchantId, id);
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('transfer-product',?,'Stock',1000,5)", args: [s.storeId]});
  await db.execute({sql: "INSERT INTO store_outlet_inventory(id,store_id,product_id,outlet_id,quantity) VALUES ('source-stock',?,'transfer-product','source',5)", args: [s.storeId]});
  const results = await Promise.all([1, 2].map(() => s.call("/merchants/me/stock-transfers", "POST", {productId: "transfer-product", fromOutletId: "source", toOutletId: "destination", quantity: 4})));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await db.execute("SELECT SUM(quantity) AS quantity FROM store_outlet_inventory WHERE product_id='transfer-product'")).rows[0].quantity, 5);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM store_stock_transfers")).rows[0].n, 1);
});

test("cashiers cannot read licence pools through either endpoint; ordinary lists omit secrets", async () => {
  const db = await freshDatabase(); const s = await elite(db, "key-owner"); const token = await addUser(db, "key-cashier");
  await db.execute({sql: "INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES (?,'key-cashier','cashier','active')", args: [s.merchantId]});
  const made = await json(await s.call("/merchants/me/digital-products", "POST", {title: "Secret licence", kind: "license_key", price_ugx: 1000, license_keys_pool: ["UNSOLD-SECRET"]}));
  for (const path of ["/merchants/me/digital-products", `/merchants/me/digital-products/${made.product.id}/license-pool`]) {
    assert.equal((await app.request("/v1" + path, {headers: {Authorization: `Bearer ${token}`}})).status, 403);
  }
  assert.ok(!JSON.stringify(await json(await s.call("/merchants/me/digital-products"))).includes("UNSOLD-SECRET"));
});

test("base plans cannot create digital goods and live start respects the admin off switch", async () => {
  const db = await freshDatabase(); const s = await addMerchantStore(db, "plain-owner");
  await db.execute({sql: "UPDATE stores SET pro_tier='free',pro_expires_at=NULL,elite_tier=0,elite_expires_at=NULL,plan_legacy=0 WHERE id=?", args: [s.storeId]});
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('marketplace_live_enabled','0')"); invalidateSettingsCache();
  assert.equal((await s.call("/merchants/me/digital-products", "POST", {title: "Base digital", price_ugx: 1000})).status, 403);
  assert.equal((await s.call("/merchants/me/store/live/start", "POST", {title: "Disabled", streamUrl: "https://example.invalid/video.mp4"})).status, 403);
});

test("POS rejects overselling, duplicate-line overselling and manual price changes without changing stock", async () => {
  const db = await freshDatabase(); const s = await elite(db, "pos-owner");
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('pos-product',?,'Product',1000,1)", args: [s.storeId]});
  const item = {productId: "pos-product", title: "Product", unitPrice: 1000, quantity: 1};
  for (const items of [[{...item, quantity: 20}], [item, item], [{...item, unitPrice: 1}]]) {
    assert.equal((await s.call("/merchants/me/pos-sales", "POST", {items, payment_method: "cash"})).status, 409);
  }
  assert.equal((await db.execute("SELECT inventory_quantity FROM store_products WHERE id='pos-product'")).rows[0].inventory_quantity, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM store_pos_sales")).rows[0].n, 0);
  assert.equal((await s.call("/merchants/me/pos-sales", "POST", {items: [item], payment_method: "cash"})).status, 201);
  assert.equal((await db.execute("SELECT inventory_quantity FROM store_products WHERE id='pos-product'")).rows[0].inventory_quantity, 0);
});

test("refund credit failure rolls back completion, balances and ledger; retry credits once in the original environment", async () => {
  const db = await freshDatabase(); const s = await elite(db, "refund-owner"); const token = await addUser(db, "refund-buyer");
  await db.execute("UPDATE users SET wallet_balance=10000 WHERE id='refund-buyer'");
  const product = (await json(await s.call("/merchants/me/digital-products", "POST", {title: "Refund item", price_ugx: 10000}))).product;
  const bought = await app.request(`/v1/marketplace/digital/${product.id}/buy`, {method: "POST", headers: {Authorization: `Bearer ${token}`}});
  assert.equal(bought.status, 201); const id = (await json(bought)).fulfillmentId;
  await db.execute({sql: "UPDATE stores SET elite_expires_at='2000-01-01',pro_tier='free',plan_legacy=0 WHERE id=?", args: [s.storeId]});
  // Expiry stops new sales, but must never prevent servicing an existing buyer's refund.
  const secondBuyer = await addUser(db, "expired-plan-buyer");
  assert.equal((await app.request(`/v1/marketplace/digital/${product.id}/buy`, {method: "POST", headers: {Authorization: `Bearer ${secondBuyer}`}})).status, 403);
  const before = (await db.execute({sql: "SELECT available FROM merchant_balances WHERE merchant_id=? AND environment='live'", args: [s.merchantId]})).rows[0].available;
  await db.execute("CREATE TRIGGER fail_refund BEFORE UPDATE OF wallet_balance ON users WHEN NEW.id = 'refund-buyer' AND NEW.wallet_balance > OLD.wallet_balance BEGIN SELECT RAISE(ABORT, 'simulated credit failure'); END");
  assert.equal((await s.call(`/merchants/me/digital-fulfillments/${id}/refund`, "POST", {})).status, 500);
  assert.equal((await db.execute({sql: "SELECT refunded_at FROM store_digital_fulfillments WHERE id=?", args: [id]})).rows[0].refunded_at, null);
  assert.equal((await db.execute({sql: "SELECT available FROM merchant_balances WHERE merchant_id=? AND environment='live'", args: [s.merchantId]})).rows[0].available, before);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind='digital_refund'")).rows[0].n, 0);
  // Historical partial refunds must not be reported as successful or paid twice by guessing.
  await db.execute({sql: "UPDATE store_digital_fulfillments SET refunded_at=datetime('now') WHERE id=?", args: [id]});
  const historical = await s.call(`/merchants/me/digital-fulfillments/${id}/refund`, "POST", {});
  assert.equal(historical.status, 409); assert.equal((await json(historical)).error, "refund_review_required");
  await db.execute({sql: "UPDATE store_digital_fulfillments SET refunded_at=NULL WHERE id=?", args: [id]});
  await db.execute("DROP TRIGGER fail_refund");
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('platform_environment','sandbox')"); invalidateSettingsCache();
  const results = await Promise.all([1, 2].map(() => s.call(`/merchants/me/digital-fulfillments/${id}/refund`, "POST", {})));
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const balance = (await db.execute("SELECT wallet_balance,wallet_balance_sandbox FROM users WHERE id='refund-buyer'")).rows[0];
  assert.equal(balance.wallet_balance, 10000); assert.equal(balance.wallet_balance_sandbox, 0);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind='digital_refund'")).rows[0].n, 1);
});

test("selected business controls both target and permissions, never another business's owner role", async () => {
  const db = await freshDatabase(); const a = await elite(db, "multi-owner"); const b = await elite(db, "other-owner");
  await db.execute({sql: "INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES (?,'multi-owner','cashier','active')", args: [b.merchantId]});
  const headers = {Authorization: `Bearer ${a.token}`, "X-Merchant-Id": b.merchantId};
  const selected = await json(await app.request("/v1/merchants/me/store", {headers})); assert.equal(selected.store.id, b.storeId);
  assert.equal((await app.request("/v1/merchants/me/store/tier", {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify({tier: "elite"})})).status, 403);
  assert.equal((await app.request("/v1/merchants/me/store", {headers: {...headers, "X-Merchant-Id": "not-a-membership"}})).status, 403);
});

test("empty digital catalogs stay empty and unsold inventory never becomes reported revenue", async () => {
  const db = await freshDatabase(); const s = await elite(db, "empty-owner");
  assert.deepEqual((await json(await s.call("/merchants/me/digital-products"))).products, []);
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('unsold',?,'Unsold',1000,10)", args: [s.storeId]});
  const report = (await json(await s.call("/merchants/me/elite-analytics"))).analytics;
  assert.equal(report.grossRevenueUgx, 0); assert.equal(report.netMarginUgx, 0);
});

test("POS retries reuse a receipt without taking stock twice; missing costs stay unavailable and losses stay negative", async () => {
  const db = await freshDatabase(); const s = await elite(db, "retry-owner");
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('retry-product',?,'Product',1000,2)", args: [s.storeId]});
  const body = {requestId: crypto.randomUUID(), items: [{productId: "retry-product", title: "Product", unitPrice: 1000, quantity: 1}], payment_method: "cash"};
  const first = await json(await s.call("/merchants/me/pos-sales", "POST", body));
  const retry = await json(await s.call("/merchants/me/pos-sales", "POST", body));
  assert.equal(retry.saleId, first.saleId);
  assert.equal((await db.execute("SELECT inventory_quantity FROM store_products WHERE id='retry-product'")).rows[0].inventory_quantity, 1);
  assert.equal((await json(await s.call("/merchants/me/elite-analytics"))).analytics.netMarginUgx, null);
  await db.execute("UPDATE store_products SET cost_price=2000 WHERE id='retry-product'");
  assert.ok((await json(await s.call("/merchants/me/elite-analytics"))).analytics.netMarginUgx < 0);
});

test("stock transfer retries do not move stock twice", async () => {
  const db = await freshDatabase(); const s = await elite(db, "retry-transfer");
  for (const id of ["retry-source", "retry-destination"]) await outlet(db, s.merchantId, id);
  await db.execute({sql: "INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('retry-stock',?,'Stock',1000,5)", args: [s.storeId]});
  await db.execute({sql: "INSERT INTO store_outlet_inventory(id,store_id,product_id,outlet_id,quantity) VALUES ('retry-source-stock',?,'retry-stock','retry-source',5)", args: [s.storeId]});
  const body = {requestId: crypto.randomUUID(), productId: "retry-stock", fromOutletId: "retry-source", toOutletId: "retry-destination", quantity: 4};
  assert.equal((await s.call("/merchants/me/stock-transfers", "POST", body)).status, 201);
  assert.equal((await s.call("/merchants/me/stock-transfers", "POST", body)).status, 200);
  assert.equal((await db.execute("SELECT quantity FROM store_outlet_inventory WHERE id='retry-source-stock'")).rows[0].quantity, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM store_stock_transfers")).rows[0].n, 1);
});
