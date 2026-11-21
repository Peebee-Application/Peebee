import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setRawSetting } from "../lib/settings.js";
import { attentionRoutes } from "./attention.js";

test("order attention authorization, gesture lifetime, messages and migration fallback", async () => {
  process.env.JWT_SECRET = "local-attention-test-secret-only";
  const client = createClient({ url: "file::memory:" });
  const dir = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({ sql, args: [] as unknown[], bind(...args: unknown[]) { this.args = args; return this; }, async all() {
    const r = await client.execute({ sql: this.sql, args: this.args as InArgs });
    return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } };
  } });
  setD1Binding({ prepare } as unknown as D1Database); resetSchemaCache();
  const tokens: Record<string, string> = {};
  for (const id of ["customer", "rider", "owner", "taxi", "stranger"]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, id === "rider" ? "rider" : "customer"] });
    tokens[id] = await signToken({ sub: id, role: id === "rider" ? "rider" : "customer" });
  }
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'Shopping list')");
  await client.execute("INSERT INTO restaurants (id, owner_id, name, business_type) VALUES ('food', 'owner', 'Pearl Kitchen', 'kitchen')");
  await client.execute("INSERT INTO merchants (id, legal_name, display_name) VALUES ('merchant', 'City Electronics', 'City Electronics')");
  await client.execute("INSERT INTO merchant_members (merchant_id, user_id, role) VALUES ('merchant', 'owner', 'owner')");
  await client.execute("INSERT INTO stores (id, merchant_id, name, slug, category) VALUES ('store', 'merchant', 'City Electronics', 'city', 'stores')");
  for (const id of ["list-order", "food-order", "store-order", "sandbox-order"]) await client.execute({ sql: "INSERT INTO orders (id, list_id, customer_id, rider_id, stage, environment, restaurant_id, store_id) VALUES (?, 'list', 'customer', 'rider', 'Deliver', ?, ?, ?)", args: [id, id === "sandbox-order" ? "sandbox" : "live", id === "food-order" ? "food" : null, id === "store-order" ? "store" : null] });
  await client.execute("INSERT INTO order_relay_legs (id, order_id, leg, kind, provider_id, fee, status) VALUES ('leg', 'store-order', 2, 'matatu', 'taxi', 1000, 'in_transit')");
  const app = new Hono().route("/v1", attentionRoutes);
  async function call(who: string, method: string, path: string, body?: unknown) {
    const response = await app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  try {
    const list = await call("customer", "GET", "/orders/list-order/follow-up");
    assert.deepEqual(list.body.parties.map((p: { role: string }) => p.role), ["rider"]);
    const food = await call("customer", "GET", "/orders/food-order/follow-up");
    assert.deepEqual(food.body.parties.map((p: { label: string }) => p.label), ["Rider", "Kitchen"]);
    const relay = await call("customer", "GET", "/orders/store-order/follow-up");
    assert.deepEqual(relay.body.parties.map((p: { label: string }) => p.label), ["Rider", "Taxi", "Store"]);
    await client.execute("UPDATE stores SET category = 'groceries' WHERE id = 'store'");
    await client.execute("UPDATE order_relay_legs SET status = 'done' WHERE id = 'leg'");
    const nearby = await call("customer", "GET", "/orders/store-order/follow-up");
    assert.deepEqual(nearby.body.parties.map((p: { label: string }) => p.label), ["Rider", "Grocer"]);
    await client.execute("UPDATE stores SET category = 'stores' WHERE id = 'store'");
    await client.execute("UPDATE order_relay_legs SET status = 'in_transit' WHERE id = 'leg'");
    assert.equal((await call("stranger", "GET", "/orders/food-order/follow-up")).status, 404);
    assert.equal((await call("customer", "GET", "/orders/sandbox-order/follow-up")).status, 404);
    const payload = { recipientId: "rider", reason: "Ask for an update", mode: "hold" };
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", { ...payload, recipientId: "owner" })).status, 403);
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", { ...payload, recipientId: "customer" })).status, 403);
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", { ...payload, mode: "infinite" })).status, 400);
    const started = await call("customer", "POST", "/orders/list-order/attention", payload);
    assert.equal(started.status, 201);
    const id = started.body.id;
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", payload)).status, 429);
    assert.equal((await call("rider", "GET", "/attention/incoming")).body.signal.id, id);
    assert.equal((await call("stranger", "POST", `/attention/${id}/stop`)).status, 404);
    assert.equal((await call("rider", "POST", `/attention/${id}/heartbeat`)).status, 403);
    assert.equal((await call("customer", "POST", `/attention/${id}/heartbeat`)).status, 200);
    assert.equal((await call("rider", "POST", `/attention/${id}/acknowledge`)).status, 200);
    assert.equal((await call("customer", "POST", `/attention/${id}/heartbeat`)).status, 409, "acknowledgement cannot be undone by a late heartbeat");
    assert.equal((await call("rider", "GET", "/attention/incoming")).body.signal, null);
    await client.execute("UPDATE order_attention SET stopped_at = NULL, started_at = 0, expires_at = 9999999999999");
    assert.equal((await call("customer", "POST", `/attention/${id}/heartbeat`)).status, 409, "maximum hold is measured from start, not extended by heartbeats");
    await client.execute("DELETE FROM order_attention");
    const tapped = await call("rider", "POST", "/orders/food-order/attention", { recipientId: "owner", reason: "I’m outside", mode: "tap" });
    assert.equal(tapped.status, 201);
    await client.execute("UPDATE orders SET rider_id = NULL WHERE id = 'food-order'");
    assert.equal((await call("owner", "GET", "/attention/incoming")).body.signal, null, "removed participants cannot keep calling");
    await client.execute("UPDATE orders SET rider_id = 'rider' WHERE id = 'food-order'");
    assert.equal((await call("customer", "POST", "/orders/store-order/follow-up/messages", { recipientId: "taxi", body: "Where should I meet you?" })).status, 201);
    assert.equal((await call("taxi", "GET", "/attention/messages/unread")).body.message.senderId, "customer");
    assert.equal((await call("taxi", "GET", "/orders/store-order/follow-up/messages/customer")).body.messages.length, 1);
    assert.equal((await call("rider", "GET", "/orders/store-order/follow-up/messages/customer")).body.messages.length, 0, "other order participants cannot read a private pair's messages");
    assert.equal((await call("stranger", "GET", "/orders/store-order/follow-up/messages/customer")).status, 404);
    await call("taxi", "POST", "/orders/store-order/follow-up/messages/customer/read");
    assert.equal((await call("taxi", "GET", "/attention/messages/unread")).body.message, null);
    await client.execute("UPDATE orders SET stage = 'Cancelled' WHERE id = 'store-order'");
    assert.equal((await call("customer", "POST", "/orders/store-order/attention", payload)).status, 409);
    await setRawSetting("order_attention", JSON.stringify({ enabled: false }));
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", payload)).status, 503);
    await setRawSetting("order_attention", "{}");
    await client.execute("DROP TABLE order_attention"); resetSchemaCache();
    assert.equal((await call("rider", "GET", "/attention/incoming")).body.signal, null);
    assert.equal((await call("customer", "POST", "/orders/list-order/attention", payload)).status, 503);
    assert.equal((await call("customer", "GET", "/orders/list-order/follow-up")).status, 200, "recipients still load before migration");
  } finally { setD1Binding(undefined); resetSchemaCache(); client.close(); }
});
