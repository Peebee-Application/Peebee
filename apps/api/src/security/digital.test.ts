import test from "node:test";
import assert from "node:assert/strict";
import { addAdmin, addMerchantStore, addUser, anonymous, app, freshDatabase } from "../test-support/db.js";
import { setSmsSenderForTests } from "../lib/sms-gateway.js";
import { setR2Binding, type R2Bucket } from "../storage/r2.js";
import { sha256Hex } from "../marketplace/digital-sales.js";

const json = async (res: Response) => (await res.json()) as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;

async function shopper(client: Db, id: string, wallet: number, phone = `+2567${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`) {
  const token = await addUser(client, id, "customer", { phone });
  await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = ?", args: [wallet, id] });
  const call = (path: string, method = "GET", body?: object) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { id, token, phone, call };
}
const wallet = async (client: Db, id: string) => Number((await client.execute({ sql: "SELECT wallet_balance FROM users WHERE id = ?", args: [id] })).rows[0].wallet_balance);

async function setup() {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const seller = await addMerchantStore(client, "u_dig_seller");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const make = async (body: object) => json(await seller.call("/merchants/me/digital-products", "POST", body));
  return { client, admin, seller, make };
}

test("buying a download: wallet -> merchant balance and ledger, a hashed token, a counted download", async () => {
  const { client, admin, seller, make } = await setup();
  await admin.setOptions({ digital_proxy_trusted_hosts: ["files.example"] });
  const { product } = await make({ title: "Hydroponics Guide", price_ugx: 20000, file_url: "https://files.example/guide.pdf", max_downloads: 2, expiry_days: 10 });
  const buyer = await shopper(client, "u_buy1", 50000);

  const res = await buyer.call(`/marketplace/digital/${product.id}/buy`, "POST");
  assert.equal(res.status, 201);
  const bought = await json(res);
  assert.equal(await wallet(client, buyer.id), 30000, "the buyer paid once");
  assert.equal(bought.pricePaidUgx, 20000);
  assert.match(bought.accessUrl, /\/d\/[0-9a-f]{64}$/);

  const merchantId = seller.merchantId;
  const bal = (await client.execute({ sql: "SELECT available FROM merchant_balances WHERE merchant_id = ?", args: [merchantId] })).rows[0];
  assert.equal(Number(bal.available), 19000, "5% platform share is kept (default), the rest is the merchant's");
  const tx = await client.execute("SELECT kind FROM ledger_transactions WHERE kind = 'digital_sale'");
  assert.equal(tx.rows.length, 1);
  const sum = await client.execute("SELECT COALESCE(SUM(e.amount), 0) AS s FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE t.kind = 'digital_sale'");
  assert.equal(Number(sum.rows[0].s), 0, "the sale balances to zero");

  const row = (await client.execute("SELECT access_token, status, price_paid_ugx, commission_ugx FROM store_digital_fulfillments")).rows[0];
  assert.equal(row.access_token, await sha256Hex(bought.token), "only the hash is stored");
  assert.equal(Number(row.commission_ugx), 1000);

  assert.equal((await buyer.call(`/marketplace/digital/${product.id}/buy`, "POST")).status, 409, "no accidental second purchase");
  assert.equal(await wallet(client, buyer.id), 30000);

  const token = bought.token;
  const page = await json(await anonymous(`/marketplace/digital-fulfillments/${token}`));
  assert.equal(page.purchase.title, "Hydroponics Guide");
  assert.equal(page.purchase.downloadsLeft, 2);
  const d1 = await json(await anonymous(`/marketplace/digital-fulfillments/${token}/download`, "POST", {}));
  assert.equal(d1.via, "peebee", "by default Peebee serves the file, so the merchant's address is not handed out");
  assert.ok(!JSON.stringify(d1).includes("files.example"));
  await admin.setOptions({ digital_storage_backend: "external_url_via_redirect" });
  const d2 = await json(await anonymous(`/marketplace/digital-fulfillments/${token}/download`, "POST", {}));
  assert.equal(d2.downloadUrl, "https://files.example/guide.pdf", "the redirect option: the merchant's own address behind the token");

  const mine = await json(await buyer.call("/me/digital-purchases"));
  assert.equal(mine.purchases.length, 1);
  const merchantView = await json(await seller.call("/merchants/me/digital-fulfillments"));
  assert.equal(merchantView.fulfillments[0].token_hint, bought.token.slice(-4));
  assert.ok(!JSON.stringify(merchantView).includes(bought.token), "the merchant never sees a working token");
});

test("not enough money: nothing is charged, nothing is issued, the key goes back", async () => {
  const { client, make } = await setup();
  const { product } = await make({ title: "POS Licence", kind: "license_key", price_ugx: 75000, license_keys_pool: ["KEY-1"] });
  const poor = await shopper(client, "u_poor", 1000);
  const res = await poor.call(`/marketplace/digital/${product.id}/buy`, "POST");
  assert.equal(res.status, 402);
  assert.equal(await wallet(client, poor.id), 1000);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM store_digital_fulfillments")).rows[0].n, 0);
  assert.equal((await client.execute("SELECT status FROM store_license_keys")).rows[0].status, "available", "the key was released");
  assert.equal((await anonymous("/marketplace/digital/ghost/buy", "POST")).status, 401);
  assert.equal((await poor.call("/marketplace/digital/ghost/buy", "POST")).status, 404);
});

test("licence keys: one buyer each, never twice, even when everyone buys at once", async () => {
  const { client, make } = await setup();
  const { product } = await make({ title: "Software Key", kind: "license_key", price_ugx: 10000, license_keys_pool: ["K-A", "K-B", "K-C"] });
  const buyers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => shopper(client, `u_race_${i}`, 10000)));
  const results = await Promise.all(buyers.map((b) => b.call(`/marketplace/digital/${product.id}/buy`, "POST")));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 201, 409, 409, 409], "three keys, three sales");
  const issued = (await client.execute("SELECT license_key FROM store_license_keys WHERE status = 'issued'")).rows.map((r) => r.license_key).sort();
  assert.deepEqual(issued, ["K-A", "K-B", "K-C"]);
  const given = (await client.execute("SELECT license_key_issued FROM store_digital_fulfillments")).rows.map((r) => r.license_key_issued);
  assert.equal(new Set(given).size, 3, "no key reached two buyers");
  for (const b of buyers.filter((_, i) => results[i].status === 409)) assert.equal(await wallet(client, b.id), 10000, "the ones who missed out were not charged");

  const pub = await json(await anonymous(`/marketplace/stores/${(await client.execute("SELECT slug FROM stores")).rows[0].slug}`));
  assert.equal(pub.digitalProducts[0].sold_out, true, "the store shows it as sold out");
});

test("running out of keys follows the admin option", async () => {
  const { client, admin, seller, make } = await setup();
  const { product } = await make({ title: "Last Key", kind: "license_key", price_ugx: 5000, license_keys_pool: [] });
  const b1 = await shopper(client, "u_out1", 10000);
  assert.equal((await b1.call(`/marketplace/digital/${product.id}/buy`, "POST")).status, 409, "default: stop the sale");

  await admin.setOptions({ digital_license_exhausted_action: "allow_backorder_manual_fulfil" });
  const bought = await b1.call(`/marketplace/digital/${product.id}/buy`, "POST");
  assert.equal(bought.status, 201);
  assert.equal((await json(bought)).needsManualFulfilment, true);
  assert.equal(await wallet(client, "u_out1"), 5000);
  const f = (await json(await seller.call("/merchants/me/digital-fulfillments"))).fulfillments[0];
  assert.equal(f.needs_manual_fulfilment, true);
  assert.equal((await seller.call(`/merchants/me/digital-fulfillments/${f.id}/license`, "POST", { license_key: "HAND-1" })).status, 200);
  assert.equal((await client.execute("SELECT license_key_issued FROM store_digital_fulfillments")).rows[0].license_key_issued, "HAND-1");

  await admin.setOptions({ digital_license_exhausted_action: "auto_hide_product" });
  const b2 = await shopper(client, "u_out2", 10000);
  assert.equal((await b2.call(`/marketplace/digital/${product.id}/buy`, "POST")).status, 409);
  assert.equal((await client.execute({ sql: "SELECT status FROM store_digital_products WHERE id = ?", args: [product.id] })).rows[0].status, "draft", "the product comes off sale");
});

test("licence reveal: on the page, after a phone check, or by SMS only", async () => {
  const { client, admin, make } = await setup();
  const { product } = await make({ title: "Keyed", kind: "license_key", price_ugx: 1000, license_keys_pool: ["SECRET-1", "SECRET-2", "SECRET-3"] });
  const texts: string[] = [];
  setSmsSenderForTests(async (_to, body) => { texts.push(body); return { status: "sent", provider: "africas_talking", externalId: "m" }; });
  try {
    // Real SMS exists, so the recommended default (phone check) is in force.
    const b1 = await shopper(client, "u_rev1", 5000, "+256700123001");
    const bought = await json(await b1.call(`/marketplace/digital/${product.id}/buy`, "POST"));
    assert.equal(bought.licenseKey, "SECRET-1", "the buyer sees their key on the confirmation they just paid for");
    assert.ok(texts.some((t) => t.includes(bought.token)), "the link is texted");
    assert.ok(!texts.some((t) => t.includes("SECRET-1")), "the key is not in the SMS by default");

    const locked = await json(await anonymous(`/marketplace/digital-fulfillments/${bought.token}`));
    assert.equal(locked.purchase.licenseKey, null);
    assert.equal(locked.purchase.licenseLocked, "phone");
    const code = await json(await anonymous(`/marketplace/digital-fulfillments/${bought.token}/phone-code`, "POST", {}));
    const sentCode = /(\d{6})/.exec(texts[texts.length - 1])![1];
    const proof = await json(await anonymous("/public/phone-proof/verify", "POST", { challenge: code.challenge, code: sentCode }));
    const open = await json(await anonymous(`/marketplace/digital-fulfillments/${bought.token}`, "GET", undefined, { "x-phone-proof": proof.proof }));
    assert.equal(open.purchase.licenseKey, "SECRET-1");

    await admin.setOptions({ digital_license_reveal: "on_token_page" });
    const b2 = await shopper(client, "u_rev2", 5000, "+256700123002");
    const t2 = (await json(await b2.call(`/marketplace/digital/${product.id}/buy`, "POST"))).token;
    assert.equal((await json(await anonymous(`/marketplace/digital-fulfillments/${t2}`))).purchase.licenseKey, "SECRET-2");

    await admin.setOptions({ digital_license_reveal: "sms_only" });
    const b3 = await shopper(client, "u_rev3", 5000, "+256700123003");
    const r3 = await json(await b3.call(`/marketplace/digital/${product.id}/buy`, "POST"));
    assert.equal(r3.licenseKey, null);
    assert.ok(texts.some((t) => t.includes("SECRET-3")), "the key arrives by SMS");
    assert.equal((await json(await anonymous(`/marketplace/digital-fulfillments/${r3.token}`))).purchase.licenseLocked, "sms");
  } finally {
    setSmsSenderForTests(null);
  }
});

test("a course purchase is a seat in the course; refunds return the money and end access", async () => {
  const { client, seller, make } = await setup();
  const course = await json(await seller.call("/merchants/me/lms/courses", "POST", { title: "Poultry Masterclass", price_ugx: 40000, modules: [{ title: "M1", lessons: [{ title: "L1" }] }] }));
  const buyer = await shopper(client, "u_course", 100000);
  const bought = await buyer.call(`/marketplace/digital/dig_crs_${course.course.id}/buy`, "POST");
  assert.equal(bought.status, 201);
  const enrol = (await client.execute({ sql: "SELECT status, user_id FROM edu_enrollments WHERE course_id = ?", args: [course.course.id] })).rows[0];
  assert.equal(enrol.user_id, "u_course", "the seat is the buyer's, not the merchant's");
  assert.equal(enrol.status, "active");

  const { product } = await make({ title: "Refundable Guide", price_ugx: 10000, file_url: "https://files.example/r.pdf" });
  const b2 = await shopper(client, "u_refund", 10000);
  const got = await json(await b2.call(`/marketplace/digital/${product.id}/buy`, "POST"));
  const fid = got.fulfillmentId;
  assert.equal(await wallet(client, "u_refund"), 0);
  const before = Number((await client.execute({ sql: "SELECT available FROM merchant_balances WHERE merchant_id = ?", args: [seller.merchantId] })).rows[0].available);

  const refund = await seller.call(`/merchants/me/digital-fulfillments/${fid}/refund`, "POST", {});
  assert.equal(refund.status, 200);
  assert.equal(await wallet(client, "u_refund"), 10000, "the buyer has their money back");
  const after = Number((await client.execute({ sql: "SELECT available FROM merchant_balances WHERE merchant_id = ?", args: [seller.merchantId] })).rows[0].available);
  assert.equal(before - after, 9500, "the merchant's share comes back out");
  assert.equal((await seller.call(`/merchants/me/digital-fulfillments/${fid}/refund`, "POST", {})).status, 200);
  assert.equal(await wallet(client, "u_refund"), 10000, "refunding twice pays once");
  const page = await anonymous(`/marketplace/digital-fulfillments/${got.token}`);
  assert.equal(page.status, 403, "access ended with the refund");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind = 'digital_refund'")).rows[0].n, 1);

  // A merchant who has already withdrawn the money cannot refund it out of thin air.
  const b3 = await shopper(client, "u_refund2", 10000);
  const got3 = await json(await b3.call(`/marketplace/digital/${product.id}/buy`, "POST"));
  await client.execute({ sql: "UPDATE merchant_balances SET available = 0 WHERE merchant_id = ?", args: [seller.merchantId] });
  const refused = await seller.call(`/merchants/me/digital-fulfillments/${got3.fulfillmentId}/refund`, "POST", {});
  assert.equal(refused.status, 409);
  assert.equal(await wallet(client, "u_refund2"), 0);
});

test("private files: upload checks, signed short-lived links, and the merchant's own address stays hidden", async () => {
  const { client, admin, seller, make } = await setup();
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  setR2Binding({
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const chunks: Uint8Array[] = [];
      if (value instanceof ReadableStream) { const r = value.getReader(); for (;;) { const x = await r.read(); if (x.done) break; chunks.push(x.value); } }
      store.set(key, { bytes: Uint8Array.from(chunks.flatMap((c) => [...c])), type: opts?.httpMetadata?.contentType });
    },
    async get(key: string) { const o = store.get(key); return o ? { body: new Blob([o.bytes as unknown as BlobPart]).stream(), size: o.bytes.length, httpMetadata: { contentType: o.type } } : null; },
    async delete(key: string) { store.delete(key); },
  } as unknown as R2Bucket);
  try {
    const { product } = await make({ title: "Preset Pack", price_ugx: 3000 });
    const put = (name: string, bytes: Uint8Array, type = "application/zip") =>
      app.request(`/v1/merchants/me/digital-products/${product.id}/file`, { method: "PUT", headers: { Authorization: `Bearer ${seller.token}`, "content-type": type, "content-length": String(bytes.length), "x-file-name": name }, body: bytes as unknown as BodyInit });

    assert.equal((await put("tool.exe", new Uint8Array([1, 2, 3]))).status, 400, "program files are blocked by name");
    assert.equal((await put("tool.zip", new Uint8Array([0x4d, 0x5a, 0, 0]))).status, 400, "and by their first bytes, whatever they are called");
    assert.equal((await put("tool.zip", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).status, 400);
    await admin.setOptions({ digital_max_file_mb: 1 });
    assert.equal((await put("big.zip", new Uint8Array(1024 * 1024 + 1))).status, 413);
    await admin.setOptions({ digital_max_file_mb: 200 });
    const ok = await put("presets.zip", Uint8Array.from([0x50, 0x4b, 3, 4, 9, 9, 9]));
    assert.equal(ok.status, 201);
    const row = (await client.execute({ sql: "SELECT file_key, file_url FROM store_digital_products WHERE id = ?", args: [product.id] })).rows[0];
    assert.ok(String(row.file_key).startsWith(`digital/${seller.storeId}/${product.id}/`));

    const other = await addMerchantStore(client, "u_other_up");
  assert.equal((await other.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
    assert.equal((await app.request(`/v1/merchants/me/digital-products/${product.id}/file`, { method: "PUT", headers: { Authorization: `Bearer ${other.token}`, "content-length": "3" }, body: new Uint8Array([1, 2, 3]) as unknown as BodyInit })).status, 404, "not another store's product");

    const buyer = await shopper(client, "u_file", 5000);
    const bought = await json(await buyer.call(`/marketplace/digital/${product.id}/buy`, "POST"));
    const dl = await json(await anonymous(`/marketplace/digital-fulfillments/${bought.token}/download`, "POST", {}));
    assert.equal(dl.via, "peebee");
    const path = new URL(dl.downloadUrl).pathname.replace(/^\/v1/, "");
    const file = await anonymous(path);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.match(file.headers.get("content-disposition") ?? "", /attachment/);
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [0x50, 0x4b, 3, 4, 9, 9, 9]);

    assert.equal((await anonymous(path.replace(/\.\d+\./, ".1."))).status, 410, "a tampered or expired link is refused");
    await seller.call(`/merchants/me/digital-fulfillments/${bought.fulfillmentId}/revoke`, "POST", {});
    assert.equal((await anonymous(path)).status, 403, "revoking ends even a fresh link");
  } finally {
    setR2Binding(undefined);
  }
});

test("a link can be replaced: the buyer or the store gets a new one and the old one dies", async () => {
  const { client, seller, make } = await setup();
  const { product } = await make({ title: "Relinkable", price_ugx: 0, file_url: "https://files.example/x.pdf" });
  const buyer = await shopper(client, "u_relink", 0);
  const bought = await json(await buyer.call(`/marketplace/digital/${product.id}/buy`, "POST"));
  assert.equal(bought.pricePaidUgx, 0, "free items need no wallet");
  const fresh = await json(await buyer.call(`/me/digital-purchases/${bought.fulfillmentId}/link`, "POST", {}));
  assert.equal((await anonymous(`/marketplace/digital-fulfillments/${bought.token}`)).status, 404);
  const newToken = fresh.accessUrl.split("/d/")[1];
  assert.equal((await anonymous(`/marketplace/digital-fulfillments/${newToken}`)).status, 200);
  const other = await shopper(client, "u_nosy", 0);
  assert.equal((await other.call(`/me/digital-purchases/${bought.fulfillmentId}/link`, "POST", {})).status, 404, "only the buyer");

  setSmsSenderForTests(async () => ({ status: "failed", provider: "twilio", error: "no credit" }));
  try {
    const resend = await json(await seller.call(`/merchants/me/digital-fulfillments/${bought.fulfillmentId}/resend`, "POST", {}));
    assert.equal(resend.ok, false);
    assert.equal(resend.sms, "failed", "a failed text is reported as failed");
  } finally {
    setSmsSenderForTests(null);
  }
});
