import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, addMerchantStore, addUser, addAdmin, app } from "../test-support/db.js";
import { resetSchemaCache } from "../lib/schema.js";

const json = async (r: Response) => await r.json() as any;
async function setup() {
  const db = await freshDatabase(); const merchant = await addMerchantStore(db, "refund-review-owner");
  const admin = await addAdmin(db); const buyer = await addUser(db, "review-buyer");
  await merchant.call("/merchants/me/store/tier", "POST", {tier: "elite"});
  await db.execute("UPDATE users SET wallet_balance=10000 WHERE id='review-buyer'");
  const product = (await json(await merchant.call("/merchants/me/digital-products", "POST", {title: "Review product", kind: "download", price_ugx: 1000, file_url: "https://files.example.test/review.pdf"}))).product;
  const purchase = await json(await app.request(`/v1/marketplace/digital/${product.id}/buy`, {method: "POST", headers: {Authorization: `Bearer ${buyer}`}}));
  assert.ok(purchase.fulfillmentId);
  return {db, merchant, admin, purchase, path: `/admin/refund-reconciliation/${purchase.fulfillmentId}`};
}

test("refund reconciliation restricts staff access and exposes evidence without purchase credentials", async () => {
  const {db, merchant, admin, purchase, path} = await setup();
  assert.equal((await merchant.call(path)).status, 403);
  assert.equal((await app.request(`/v1${path}`)).status, 401);
  await db.execute({sql: "UPDATE store_digital_fulfillments SET refunded_at=datetime('now') WHERE id=?", args: [purchase.fulfillmentId]});
  const detail = await json(await admin.call(path));
  assert.equal(detail.classification, "review_required"); assert.equal(detail.moneyMovement, false);
  assert.equal(detail.purchase.sale_environment, "live");
  assert.ok(detail.transactions.length >= 2);
  const serialized = JSON.stringify(detail);
  assert.ok(!serialized.includes(purchase.token)); assert.ok(!serialized.includes("license_key_issued"));
  const list = await json(await admin.call("/admin/refund-reconciliation?limit=1"));
  assert.equal(list.items.length, 1); assert.equal(list.items[0].id, purchase.fulfillmentId);
  assert.equal((await admin.call("/admin/refund-reconciliation?limit=999")).status, 400);
});

test("review records an immutable decision without moving funds and refuses stale evidence", async () => {
  const {db, merchant, admin, purchase, path} = await setup();
  await merchant.call(`/merchants/me/digital-fulfillments/${purchase.fulfillmentId}/refund`, "POST", {});
  const evidence = await json(await admin.call(path));
  assert.equal(evidence.classification, "evidence_present");
  const before = (await db.execute("SELECT wallet_balance FROM users WHERE id='review-buyer'")).rows[0].wallet_balance;
  const review = {fingerprint: evidence.fingerprint, decision: "investigate", note: "Check the original payment evidence."};
  assert.equal((await admin.call(`${path}/reviews`, "POST", review)).status, 200);
  const updated = await json(await admin.call(path));
  assert.equal(updated.reviews.length, 1); assert.equal(updated.fingerprint, evidence.fingerprint);
  assert.equal((await db.execute("SELECT wallet_balance FROM users WHERE id='review-buyer'")).rows[0].wallet_balance, before);
  assert.equal((await admin.call(`${path}/reviews`, "POST", {...review, decision: "externally_reconciled"})).status, 400);
  await db.execute({sql: "UPDATE wallet_ledger SET amount=999 WHERE id=?", args: [`wl_digital_refund_${purchase.fulfillmentId}`]});
  assert.equal((await admin.call(`${path}/reviews`, "POST", review)).status, 409);
  assert.equal((await json(await admin.call(path))).classification, "review_required");
});

test("unlinked same-amount legacy credits remain candidates and never prove completion", async () => {
  const {db, admin, purchase, path} = await setup();
  await db.execute({sql: "UPDATE store_digital_fulfillments SET refunded_at=datetime('now') WHERE id=?", args: [purchase.fulfillmentId]});
  await db.execute("INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment) VALUES ('legacy-refund','review-buyer','refund',1000,10000,'Historical credit','live')");
  const result = await json(await admin.call(path));
  assert.equal(result.classification, "review_required"); assert.equal(result.legacyCreditCandidates.length, 1);
  assert.equal(result.purchase.refund_wallet_entry_id, null);
});

test("missing digital-sale migrations return unavailable instead of breaking unrelated routes", async () => {
  const db = await freshDatabase(); const admin = await addAdmin(db);
  await db.execute("DROP TABLE store_digital_fulfillments"); resetSchemaCache();
  assert.equal((await admin.call("/admin/refund-reconciliation")).status, 503);
});
