import { setPlatformEnvironment } from "../lib/settings.js";
import test from "node:test";
import assert from "node:assert/strict";
import { addAdmin, addMerchantStore, addUser, anonymous, app, freshDatabase } from "../test-support/db.js";
import { sha256Hex } from "../marketplace/digital-sales.js";

const json = async (res: Response) => (await res.json()) as any;

test("checkout prices every item from the catalogue, never from the request", async () => {
  const client = await freshDatabase();
  const seller = await addMerchantStore(client, "u_seller_price");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  await client.execute({ sql: "INSERT INTO store_products (id, store_id, title, price, inventory_quantity) VALUES ('p_real', ?, 'Real Kettle', 50000, 3)", args: [seller.storeId] });
  await client.execute({ sql: "INSERT INTO store_products (id, store_id, title, price, status) VALUES ('p_draft', ?, 'Draft Item', 1000, 'draft')", args: [seller.storeId] });
  const shopper = await addUser(client, "u_shopper_price");
  const post = (path: string, body: object) => app.request(`/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${shopper}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const item = (over: object = {}) => ({ productId: "p_real", storeId: seller.storeId, title: "Free kettle", price: 1, quantity: 2, ...over });

  const quote = await json(await post("/marketplace/checkout/quote", { items: [item()] }));
  assert.equal(quote.itemsTotal, 100000, "the quote uses the catalogue price (50000 x 2), not the client's 1");

  const order = await post("/marketplace/checkout", { items: [item()], paymentRail: "escrow" });
  assert.equal(order.status, 201);
  const { orders } = await json(order);
  assert.equal(orders[0].estimated_total - orders[0].delivery_fee, 100000);
  const listItem = await client.execute({ sql: "SELECT name, unit_price FROM list_items WHERE list_id = ?", args: [orders[0].list_id] });
  assert.equal(Number(listItem.rows[0].unit_price), 50000);
  assert.equal(String(listItem.rows[0].name), "Real Kettle", "the title is the catalogue's too");

  assert.equal((await post("/marketplace/checkout", { items: [item({ productId: "p_missing" })] })).status, 400, "unknown product");
  assert.equal((await post("/marketplace/checkout", { items: [item({ productId: "p_draft" })] })).status, 400, "draft product");
  const other = await addMerchantStore(client, "u_seller_other");
  assert.equal((await other.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  assert.equal((await post("/marketplace/checkout", { items: [item({ storeId: other.storeId })] })).status, 400, "another store's catalogue");
  const tooMany = await post("/marketplace/checkout", { items: [item({ quantity: 4 })] });
  assert.equal(tooMany.status, 409, "more than the stock on hand");
  assert.equal((await json(tooMany)).error, "out_of_stock");
  assert.equal((await post("/marketplace/checkout", { items: [item({ quantity: 2 }), item({ quantity: 2 })] })).status, 409, "two lines cannot both take the last units");
});

test("public store reads are allow-lists and only serve live stores", async () => {
  const client = await freshDatabase();
  const live = await addMerchantStore(client, "u_pub_live");
  assert.equal((await live.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const gone = await addMerchantStore(client, "u_pub_gone", { status: "suspended" });
  assert.equal((await gone.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  await client.execute({ sql: "INSERT INTO store_products (id, store_id, title, price, cost_price) VALUES ('p_pub', ?, 'Shown', 9000, 4000)", args: [live.storeId] });
  await client.execute({ sql: "INSERT INTO store_products (id, store_id, title, price) VALUES ('p_gone', ?, 'Hidden', 9000)", args: [gone.storeId] });
  await client.execute({ sql: "INSERT INTO store_discounts (id, store_id, code, title, kind, value, status, is_automatic) VALUES ('d_secret', ?, 'VIPONLY', 'Secret', 'percent', 50, 'active', 0), ('d_auto', ?, 'AUTO5', 'Auto', 'percent', 5, 'active', 1)", args: [live.storeId, live.storeId] });
  await client.execute({ sql: "INSERT INTO store_digital_products (id, store_id, title, price_ugx, file_url, delivery_instructions, license_keys_pool) VALUES ('dig_pub', ?, 'Guide', 5000, 'https://files.example/paid.pdf', 'secret how-to', '[\"KEY-1\"]')", args: [live.storeId] });

  const body = await json(await anonymous(`/marketplace/stores/${live.slug}`));
  assert.equal(body.store.slug, live.slug);
  for (const key of ["merchant_id", "status", "environment", "pro_expires_at", "elite_expires_at", "learn_school_id", "meta_pixel_id"]) {
    assert.ok(!(key in body.store), `${key} must not be public`);
  }
  assert.deepEqual(body.discounts.map((d: any) => d.code), ["AUTO5"], "private promo codes are not published");
  assert.ok(!JSON.stringify(body).includes("paid.pdf"), "the paid file link is never public");
  assert.ok(!JSON.stringify(body).includes("KEY-1"));
  assert.ok(!JSON.stringify(body).includes("secret how-to"));

  const products = await json(await anonymous(`/marketplace/stores/${live.slug}/products`));
  assert.equal(products.products.length, 1);
  assert.ok(!("cost_price" in products.products[0]), "cost price is private");

  assert.equal((await anonymous(`/marketplace/stores/${gone.slug}`)).status, 410, "suspended stores are not served (they say so)");
  assert.deepEqual((await json(await anonymous(`/marketplace/stores/${gone.slug}/products`))).products, []);
  assert.equal((await anonymous("/marketplace/products/p_gone")).status, 404, "nor their products");
  assert.equal((await anonymous("/marketplace/products/p_pub")).status, 200);

  const digital = await json(await anonymous(`/marketplace/stores/${live.slug}/digital-products`));
  assert.equal(digital.digitalProducts.length, 1);
  assert.equal(digital.digitalProducts[0].file_url, null);
  assert.equal(digital.digitalProducts[0].license_keys_pool, null);
  assert.deepEqual((await json(await anonymous(`/marketplace/stores/${gone.slug}/digital-products`))).digitalProducts, []);
});

test("B2B inquiries are priced from the catalogue", async () => {
  const client = await freshDatabase();
  const seller = await addMerchantStore(client, "u_b2b_seller");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  await client.execute({ sql: "INSERT INTO store_products (id, store_id, title, price) VALUES ('p_b2b', ?, 'Bulk Rice', 20000)", args: [seller.storeId] });
  await client.execute("UPDATE settings SET value = '1' WHERE key = 'marketplace_elite_b2b_enabled'");
  const res = await anonymous(`/marketplace/stores/${seller.slug}/b2b-inquiry`, "POST", {
    customer_name: "Acme Ltd", customer_phone: "+256700000001", payment_terms: "net_14",
    items: [{ productId: "p_b2b", title: "Rice", unitPrice: 1, quantity: 10 }],
  });
  if (res.status === 201) assert.equal((await json(res)).total, 200000);
  else assert.ok([403, 503].includes(res.status), `unexpected ${res.status}`);
  const bad = await anonymous(`/marketplace/stores/${seller.slug}/b2b-inquiry`, "POST", {
    customer_name: "Acme Ltd", customer_phone: "+256700000001",
    items: [{ productId: "not_mine", title: "x", unitPrice: 1, quantity: 1 }],
  });
  assert.notEqual(bad.status, 201);
});

test("digital download tokens: viewing is free, the file request is counted atomically, expiry, unlimited, revoke", async () => {
  const client = await freshDatabase();
  await (await addAdmin(client)).setOptions({ digital_proxy_trusted_hosts: ["files.example"] });
  const seller = await addMerchantStore(client, "u_dl_seller");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  await client.execute({ sql: "INSERT INTO store_digital_products (id, store_id, title, price_ugx, file_url) VALUES ('dig_dl', ?, 'Guide', 5000, 'https://files.example/a.pdf')", args: [seller.storeId] });
  const make = async (id: string, max: number, expires: string | null, status = "active") =>
    client.execute({ sql: "INSERT INTO store_digital_fulfillments (id, store_id, digital_product_id, customer_phone, access_token, max_downloads, expires_at, status) VALUES (?, ?, 'dig_dl', '+256700000009', ?, ?, ?, ?)", args: [id, seller.storeId, await sha256Hex(`tok_${id}`), max, expires, status] });
  await make("f_cap", 2, null);
  await make("f_exp", 5, new Date(Date.now() - 1000).toISOString());
  await make("f_unl", 0, null);
  await make("f_rev", 5, null, "revoked");
  const view = (t: string) => anonymous(`/marketplace/digital-fulfillments/tok_${t}`);
  const take = (t: string) => anonymous(`/marketplace/digital-fulfillments/tok_${t}/download`, "POST", {});

  for (let i = 0; i < 5; i++) assert.equal((await view("f_cap")).status, 200);
  assert.equal(Number((await client.execute("SELECT download_count FROM store_digital_fulfillments WHERE id = 'f_cap'")).rows[0].download_count), 0, "looking at the page uses nothing up");
  assert.equal((await take("f_cap")).status, 200);
  assert.equal((await take("f_cap")).status, 200);
  const third = await take("f_cap");
  assert.equal(third.status, 403);
  assert.equal((await json(third)).error, "limit_reached");
  assert.equal(Number((await client.execute("SELECT download_count FROM store_digital_fulfillments WHERE id = 'f_cap'")).rows[0].download_count), 2);

  const burst = await Promise.all([1, 2, 3, 4].map(() => take("f_unl")));
  assert.ok(burst.every((r) => r.status === 200), "0 means unlimited");
  const raced = await Promise.all([1, 2, 3, 4, 5, 6].map(() => take("f_cap2")));
  assert.ok(raced.every((r) => r.status === 404), "unknown links are not found");

  assert.equal((await take("f_exp")).status, 403, "expired");
  assert.equal((await json(await view("f_rev"))).error, "revoked");
  const info = await json(await view("f_unl"));
  assert.ok(!JSON.stringify(info).includes("+256700000009"), "the buyer's phone is not echoed to whoever holds the link");
  assert.ok(!JSON.stringify(info).includes("files.example"), "the merchant's file address is not on the page");

  const stored = (await client.execute("SELECT access_token FROM store_digital_fulfillments WHERE id = 'f_cap'")).rows[0].access_token;
  assert.notEqual(stored, "tok_f_cap", "tokens are stored only as a hash");

  // A burst against a limit of 1 lets exactly one through.
  await make("f_one", 1, null);
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => take("f_one")));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
});

test("a merchant cannot overwrite another store's course or product, or enrol onto it", async () => {
  const client = await freshDatabase();
  const a = await addMerchantStore(client, "u_tenant_a");
  assert.equal((await a.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const b = await addMerchantStore(client, "u_tenant_b");
  assert.equal((await b.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const made = await a.call("/merchants/me/digital-products", "POST", { title: "A's Guide", priceUgx: 1000 });
  const prodId = (await json(made)).product.id;
  const stolen = await b.call("/merchants/me/digital-products", "POST", { id: prodId, title: "B hijack", priceUgx: 1 });
  assert.equal(stolen.status, 403);
  const row = await client.execute({ sql: "SELECT title FROM store_digital_products WHERE id = ?", args: [prodId] });
  assert.equal(String(row.rows[0].title), "A's Guide");

  const course = await json(await a.call("/merchants/me/lms/courses", "POST", { title: "A's Course", price_ugx: 5000 }));
  const hijack = await b.call("/merchants/me/lms/courses", "POST", { id: course.course.id, title: "B hijack" });
  assert.equal(hijack.status, 403);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status) VALUES ('stu_eve', '+256700000003', 'Eve', 'h', 'customer', 'active'), ('stu_ann', '+256700000004', 'Ann', 'h', 'customer', 'active')");
  const enrol = await b.call("/merchants/me/lms/enrollments", "POST", { courseId: course.course.id, studentName: "Eve", studentPhone: "+256700000003" });
  assert.equal(enrol.status, 403);
  const own = await a.call("/merchants/me/lms/enrollments", "POST", { courseId: course.course.id, studentName: "Ann", studentPhone: "+256700000004" });
  assert.equal(own.status, 200);
});

test("service bookings: tenant-scoped, never paid on request, public site is an allow-list", async () => {
  const client = await freshDatabase();
  await setPlatformEnvironment("sandbox"); // payments go through the simulator
  const ownerA = await addUser(client, "u_svc_a");
  const ownerB = await addUser(client, "u_svc_b");
  const as = (token: string) => (path: string, method = "GET", body?: object) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const a = as(ownerA);
  const b = as(ownerB);
  const biz = (name: string) => ({ name, category: "consultation", phone: "+256700123456" });
  const bizA = (await json(await a("/services-platform/my-business", "POST", biz("Alpha Advisory")))).business;
  const bizB = (await json(await b("/services-platform/my-business", "POST", biz("Beta Advisory")))).business;
  await client.execute("UPDATE service_businesses SET status = 'active'");
  const offerB = (await json(await b("/services-platform/offerings", "POST", { title: "Beta Call", price_ugx: 90000, deposit_ugx: 30000 }))).offering;
  const offerA = (await json(await a("/services-platform/offerings", "POST", { title: "Alpha Call", price_ugx: 40000 }))).offering;
  const staffB = (await json(await b("/services-platform/staff", "POST", { name: "Bea Specialist", phone: "+256700555555" }))).staff;
  const slot = { scheduled_date: "2030-01-15", scheduled_time: "10:00", customer_name: "Carol", customer_phone: "+256772777777", payment_rail: "momo_mtn" };

  const cross = await anonymous(`/services-platform/public/${bizA.slug}/book`, "POST", { ...slot, service_id: offerB.id });
  assert.equal(cross.status, 400, "another business's service cannot be booked here");
  const ghost = await anonymous(`/services-platform/public/${bizA.slug}/book`, "POST", { ...slot, service_id: "sofr_nope" });
  assert.equal(ghost.status, 400);

  const okRes = await anonymous(`/services-platform/public/${bizA.slug}/book`, "POST", { ...slot, service_id: offerA.id });
  const ok = await json(okRes);
  assert.equal(ok.booking.payment_status, "unpaid", "a mobile-money booking is not paid until the provider says so");
  assert.equal(ok.booking.status, "pending");

  const manualCross = await a("/services-platform/bookings", "POST", { ...slot, service_id: offerB.id });
  assert.equal(manualCross.status, 400);
  const staffCross = await a("/services-platform/bookings", "POST", { ...slot, service_id: offerA.id, staff_id: staffB.id });
  assert.equal(staffCross.status, 400, "another business's specialist cannot be assigned");
  const patchCross = await a(`/services-platform/bookings/${ok.booking.id}/status`, "PATCH", { staff_id: staffB.id });
  assert.equal(patchCross.status, 400);

  const pub = await json(await anonymous(`/services-platform/public/${bizA.slug}`));
  assert.ok(!("owner_id" in pub.business) && !("custom_domain" in pub.business) && !("status" in pub.business));
  await client.execute({ sql: "UPDATE service_businesses SET status = 'paused' WHERE id = ?", args: [bizA.id] });
  assert.equal((await anonymous(`/services-platform/public/${bizA.slug}`)).status, 404, "paused businesses are not public");
  assert.equal((await anonymous(`/services-platform/public/${bizA.slug}/book`, "POST", { ...slot, service_id: offerA.id })).status, 404);
});
