import test from "node:test";
import assert from "node:assert/strict";
import { setup, type Json } from "./test-harness.js";

/** A store owner and a shopper, with Channels and going live switched on, and a store on Pro Live with two items. */
async function world() {
  const t = await setup();
  const admin = await t.mkUser("admin1", "admin");
  const owner = await t.mkUser("owner", "customer", "Sarah Namubiru");
  const fan = await t.mkUser("fan", "customer", "Joseph Okello");
  const stranger = await t.mkUser("stranger", "customer", "Other Owner");
  await t.configure(admin, { enabled: true, moderation: { reviewFirstPosts: 0 }, live: { enabled: true } });
  for (const [u, m] of [["owner", "m_owner"], ["stranger", "m_other"]] as const) {
    await t.client.execute({ sql: "INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES (?, 'Shop Ltd', 'Shop', 'business', 'active', 'sandbox')", args: [m] });
    await t.client.execute({ sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", args: [m, u] });
  }
  const made = await t.call("/merchants/me/store", { token: owner, body: { name: "SneakerHub", category: "stores", sub_category: "fashion", address: "Kampala" } });
  assert.equal(made.status, 200, made.text);
  await t.call("/merchants/me/store", { token: stranger, body: { name: "Other", category: "stores", sub_category: "fashion", address: "Kampala" } });
  const store = (await t.client.execute("SELECT id FROM stores WHERE merchant_id = 'm_owner'")).rows[0]!.id as string;
  const item = async (title: string, price: number) => {
    const r = await t.call("/merchants/me/store/items", { token: owner, body: { title, description: "", category_name: "Shoes", images: ["https://example.com/a.jpg"], price, inventory_quantity: 5, show_in_app: true, show_on_web: true, status: "active" } });
    assert.equal(r.status, 201, r.text);
    return r.json.productId as string;
  };
  const a = await item("Canvas sneakers", 85000);
  const b = await item("Retro runners", 140000);
  return { ...t, admin, owner, fan, stranger, store, a, b };
}

const proLive = (w: Awaited<ReturnType<typeof world>>) =>
  w.client.execute({ sql: "UPDATE stores SET pro_tier = 'pro_live', pro_expires_at = datetime('now', '+30 days') WHERE id = ?", args: [w.store] });

test("store live: needs Pro Live or Elite, then goes live from the camera into the Spotlight with items to buy, and leaves when ended", async () => {
  const w = await world();
  await w.client.execute({ sql: "UPDATE stores SET plan_legacy = 0, pro_tier = 'free', elite_tier = 0 WHERE id = ?", args: [w.store] });
  const before = await w.call("/merchants/me/store/live/camera", { token: w.owner });
  assert.equal(before.status, 200);
  assert.equal(before.json.available, false, "a free store cannot go live");
  assert.equal(before.json.reason, "plan_required");
  assert.equal((await w.call("/merchants/me/store/live/camera/start", { token: w.owner, body: {} })).status, 403);

  await proLive(w);
  assert.equal((await w.call("/merchants/me/store/live/camera", { token: w.owner })).json.available, true);

  const start = await w.call("/merchants/me/store/live/camera/start", { token: w.owner, body: { title: "New sneakers just in", productIds: [w.a, "not-mine"] } });
  assert.equal(start.status, 200, start.text);
  const id = start.json.live.id as string;
  assert.ok(start.json.live.publishUrl, "the phone gets the address its camera sends to");
  assert.deepEqual(start.json.productIds, [w.a], "only the store's own items");
  assert.deepEqual((await w.call("/spotlight/feed", { token: w.fan })).json.posts, [], "nothing public before the camera connects");

  assert.equal((await w.call(`/merchants/me/store/live/camera/${id}/go`, { token: w.stranger, method: "POST", body: { productIds: [] } })).status, 404, "another store cannot touch it");
  const go = await w.call(`/merchants/me/store/live/camera/${id}/go`, { token: w.owner, method: "POST", body: { productIds: [w.a, w.b] } });
  assert.equal(go.status, 200, go.text);
  assert.equal(go.json.live.status, "live");

  const feed = (await w.call("/spotlight/feed", { token: w.fan })).json.posts as Json[];
  assert.equal(feed.length, 1);
  assert.equal(feed[0]!.liveStatus, "live");
  assert.equal(feed[0]!.publisher.type, "store");
  assert.equal(feed[0]!.publisher.id, w.store);
  assert.deepEqual(feed[0]!.productRef, { type: "product", id: w.a });
  assert.ok(!JSON.stringify(feed).includes(start.json.live.publishUrl), "the private camera address never reaches viewers");

  const items = await w.call(`/marketplace/live/${feed[0]!.id}/items`);
  assert.equal(items.status, 200, items.text);
  assert.equal(items.json.status, "live");
  assert.equal(items.json.store.name, "SneakerHub");
  assert.deepEqual((items.json.items as Json[]).map((i) => i.title), ["Canvas sneakers", "Retro runners"]);
  assert.equal(items.json.items[0].price, 85000);

  const storeRow = (await w.client.execute({ sql: "SELECT is_live, live_stream_url FROM stores WHERE id = ?", args: [w.store] })).rows[0]!;
  assert.equal(Number(storeRow.is_live), 1);
  assert.ok(storeRow.live_stream_url);

  const pin = await w.call(`/merchants/me/store/live/camera/${id}/items`, { token: w.owner, method: "PUT", body: { productIds: [w.b] } });
  assert.deepEqual(pin.json.productIds, [w.b]);
  assert.deepEqual(((await w.call(`/marketplace/live/${id}/items`)).json.items as Json[]).map((i) => i.id), [w.b]);
  const resumed = await w.call("/merchants/me/store/live/camera", { token: w.owner });
  assert.equal(resumed.json.live.id, id, "a reopened app can pick the stream up");
  assert.deepEqual(resumed.json.productIds, [w.b]);

  const end = await w.call(`/merchants/me/store/live/camera/${id}/end`, { token: w.owner, method: "POST" });
  assert.equal(end.status, 200, end.text);
  assert.equal(end.json.status, "ended");
  assert.deepEqual((await w.call("/spotlight/feed", { token: w.fan })).json.posts, [], "gone from the Spotlight once ended");
  assert.equal((await w.call(`/marketplace/live/${id}/items`)).json.items.length, 0);
  const after = (await w.client.execute({ sql: "SELECT s.is_live, l.status FROM stores s JOIN store_live_sessions l ON l.store_id = s.id WHERE l.id = ?", args: [id] })).rows[0]!;
  assert.equal(Number(after.is_live), 0);
  assert.equal(after.status, "ended");
});

test("store live: the server's sweep (lost phone) also ends the store listing", async () => {
  const w = await world();
  await proLive(w);
  const start = await w.call("/merchants/me/store/live/camera/start", { token: w.owner, body: { productIds: [w.a] } });
  const id = start.json.live.id as string;
  await w.call(`/merchants/me/store/live/camera/${id}/go`, { token: w.owner, method: "POST", body: { productIds: [w.a] } });
  await w.client.execute({ sql: "UPDATE live_sessions SET host_seen_at = datetime('now', '-1 hour') WHERE id = ?", args: [id] });
  const { sweepLive } = await import("./live.js");
  assert.ok((await sweepLive()) >= 1);
  const row = (await w.client.execute({ sql: "SELECT s.is_live, l.status FROM stores s JOIN store_live_sessions l ON l.store_id = s.id WHERE l.id = ?", args: [id] })).rows[0]!;
  assert.equal(Number(row.is_live), 0);
  assert.equal(row.status, "ended");
});
