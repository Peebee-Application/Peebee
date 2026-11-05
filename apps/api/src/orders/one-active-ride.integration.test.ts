import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setMatchingModesEnabled, setSetting } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "./routes.js";
import { riderRoutes } from "../riders/routes.js";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

const pickup = { pickupLat: 0.3136, pickupLng: 32.5811, pickupArea: "Kololo" };
const destination = { destinationLat: 0.3476, destinationLng: 32.6, destinationArea: "Ntinda" };

test("one active ride per customer, and a rider may close an unpaid ride", async (t) => {
  process.env.JWT_SECRET = "local-one-ride-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  for (const [id, role] of [["cust", "customer"], ["r1", "rider"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, role] });
  }
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('r1', 1, 1)");
  for (const id of ["l1", "l2", "l3", "l4"]) await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'cust', 'ride')", args: [id] });
  await setMatchingModesEnabled(["first_to_claim"]);
  const app = new Hono().route("/v1", orderRoutes).route("/v1", riderRoutes);
  const tokens = { cust: await signToken({ sub: "cust", role: "customer" }), r1: await signToken({ sub: "r1", role: "rider" }) };
  const call = async (method: string, path: string, who: keyof typeof tokens, body?: unknown) => {
    const res = await app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const ride = (listId: string, extra: Record<string, unknown> = {}) => ({ listId, type: "parcel", isRide: true, ...pickup, ...destination, ...extra });

  let first = "";
  await t.test("a second ride is refused while the first (for yourself) is active", async () => {
    const a = await call("POST", "/orders", "cust", ride("l1"));
    assert.equal(a.status, 201);
    first = a.body.order.id;
    const b = await call("POST", "/orders", "cust", ride("l2"));
    assert.equal(b.status, 409);
    assert.equal(b.body.error, "active_ride");
    assert.equal(b.body.orderId, first);
  });

  await t.test("cancelling the first frees the customer to book again", async () => {
    await client.execute({ sql: "UPDATE orders SET stage = 'Cancelled' WHERE id = ?", args: [first] });
    assert.equal((await call("POST", "/orders", "cust", ride("l2"))).status, 201);
    await client.execute("UPDATE orders SET stage = 'Settle' WHERE list_id = 'l2'");
  });

  await t.test("a ride booked for someone else does not block", async () => {
    const other = await call("POST", "/orders", "cust", ride("l3", { passenger: { name: "Mum", phone: "0700000001" } }));
    assert.equal(other.status, 201);
    assert.equal((await call("POST", "/orders", "cust", ride("l4"))).status, 201, "own ride allowed while the other ride is active");
    await client.execute("UPDATE orders SET stage = 'Cancelled'");
  });

  await t.test("the rule can be switched off by admin", async () => {
    await call("POST", "/orders", "cust", ride("l1"));
    await setSetting("one_active_ride_enabled", "0");
    assert.equal((await call("POST", "/orders", "cust", ride("l2"))).status, 201);
    await setSetting("one_active_ride_enabled", "1");
    await client.execute("UPDATE orders SET stage = 'Cancelled'");
  });

  await t.test("a rider can close a ride the customer has not paid for, after the wait", async () => {
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l5', 'cust', 'ride')");
    const o = (await call("POST", "/orders", "cust", ride("l5"))).body.order.id as string;
    await client.execute({ sql: "UPDATE orders SET stage = 'Match', rider_id = 'r1', updated_at = datetime('now') WHERE id = ?", args: [o] });
    const early = await call("POST", `/orders/${o}/close-unpaid`, "r1");
    assert.equal(early.status, 409);
    assert.equal(early.body.error, "too_early");
    await client.execute({ sql: "UPDATE orders SET updated_at = datetime('now', '-10 minutes') WHERE id = ?", args: [o] });
    await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES ('p1', ?, 'collection', 'mtn', 5000, 'UGX', 'pending')", args: [o] });
    assert.equal((await call("POST", `/orders/${o}/close-unpaid`, "r1")).body.error, "payment_started");
    await client.execute("UPDATE payments SET status = 'failed' WHERE id = 'p1'");
    const closed = await call("POST", `/orders/${o}/close-unpaid`, "r1");
    assert.equal(closed.status, 200);
    assert.equal(closed.body.order.stage, "Cancelled");
    assert.equal((await client.execute({ sql: "SELECT status FROM lists WHERE id = 'l5'", args: [] })).rows[0].status, "cancelled");
  });
});
