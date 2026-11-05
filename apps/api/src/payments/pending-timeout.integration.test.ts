import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { orderRoutes } from "../orders/routes.js";
import { reconcilePayment } from "./reconciliation.js";
import { providerUsesTestCredentials } from "./credentials.js";

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

test("a stuck customer payment times out, and a rider is never trapped at Fund", async (t) => {
  process.env.JWT_SECRET = "local-pending-timeout-test-secret";
  process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-abc";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const realFetch = globalThis.fetch;
  // Flutterwave never confirms: every status check says "pending".
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: "success", data: { status: "pending" } }), { status: 200 })) as typeof fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.FLUTTERWAVE_SECRET_KEY; });

  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer'), ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'a'), ('l2', 'cust', 'b'), ('l3', 'cust', 'c')");
  const order = (id: string, list: string) => client.execute(`INSERT INTO orders (id, list_id, customer_id, rider_id, stage) VALUES ('${id}', '${list}', 'cust', 'rider', 'Fund')`);
  const payment = (id: string, orderId: string, minutesAgo: number) => client.execute(
    `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status, created_at)
     VALUES ('${id}', '${orderId}', 'collection', 'flutterwave', 'ref_${id}', 5500, 'UGX', 'pending', datetime('now', '-${minutesAgo} minutes'))`);
  const stageOf = async (id: string) => String(((await client.execute(`SELECT stage FROM orders WHERE id = '${id}'`)).rows[0] as Record<string, unknown>).stage);
  const statusOf = async (id: string) => String(((await client.execute(`SELECT status FROM payments WHERE id = '${id}'`)).rows[0] as Record<string, unknown>).status);
  const riderOf = async (id: string) => (await client.execute(`SELECT rider_id FROM orders WHERE id = '${id}'`)).rows[0] as Record<string, unknown>;

  await t.test("a payment younger than the timeout keeps waiting", async () => {
    await order("o1", "l1");
    await payment("p1", "o1", 3);
    assert.equal(await reconcilePayment("p1", "test"), "pending");
    assert.equal(await statusOf("p1"), "pending");
    assert.equal(await stageOf("o1"), "Fund");
  });

  await t.test("past the timeout it fails, and the order returns to Match with its rider (not stuck at Fund)", async () => {
    await client.execute("UPDATE payments SET created_at = datetime('now', '-11 minutes') WHERE id = 'p1'");
    assert.equal(await reconcilePayment("p1", "test"), "failed");
    assert.equal(await statusOf("p1"), "failed");
    assert.equal(await stageOf("o1"), "Match");
  });

  await t.test("switching the timeout to 0 waits indefinitely", async () => {
    await client.execute("INSERT INTO settings (key, value) VALUES ('payments_pending_timeout_minutes', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
    await order("o2", "l2");
    await payment("p2", "o2", 600);
    assert.equal(await reconcilePayment("p2", "test"), "pending");
    assert.equal(await stageOf("o2"), "Fund");
    await client.execute("DELETE FROM settings WHERE key = 'payments_pending_timeout_minutes'");
  });

  await t.test("a rider can leave an order at Fund; with a payment in flight it stays at Fund without the rider", async () => {
    const app = new Hono().route("/v1", orderRoutes);
    const riderToken = await signToken({ sub: "rider", role: "rider" });
    await order("o3", "l3");
    await payment("p3", "o3", 1);
    const res = await app.request("/v1/orders/o3/cancel", { method: "POST", headers: { Authorization: `Bearer ${riderToken}` } });
    assert.equal(res.status, 200);
    assert.equal((await riderOf("o3")).rider_id, null);
    assert.equal(await stageOf("o3"), "Fund");
    // The customer's payment later fails: with no rider it goes back to Create, as for any order.
    await client.execute("UPDATE payments SET created_at = datetime('now', '-30 minutes') WHERE id = 'p3'");
    assert.equal(await reconcilePayment("p3", "test"), "failed");
    assert.equal(await stageOf("o3"), "Create");
  });

  await t.test("a rider leaving at Fund with no payment started rewinds to Create", async () => {
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l4', 'cust', 'd')");
    await order("o4", "l4");
    const app = new Hono().route("/v1", orderRoutes);
    const res = await app.request("/v1/orders/o4/cancel", { method: "POST", headers: { Authorization: `Bearer ${await signToken({ sub: "rider", role: "rider" })}` } });
    assert.equal(res.status, 200);
    assert.equal(await stageOf("o4"), "Create");
    assert.equal((await riderOf("o4")).rider_id, null);
  });

  await t.test("test keys are detected so Admin can warn", async () => {
    assert.equal(await providerUsesTestCredentials("flutterwave"), true);
    process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK-live-key-X";
    assert.equal(await providerUsesTestCredentials("flutterwave"), false);
  });

  await t.test("a telco's production environment is not mistaken for test keys", async () => {
    delete process.env.MOMO_TARGET_ENV;
    assert.equal(await providerUsesTestCredentials("mtn"), true, "blank defaults to sandbox");
    process.env.MOMO_TARGET_ENV = "sandbox";
    assert.equal(await providerUsesTestCredentials("mtn"), true);
    process.env.MOMO_TARGET_ENV = "mtnuganda"; // MTN's production target environment is country-specific
    assert.equal(await providerUsesTestCredentials("mtn"), false);
    process.env.MOMO_TARGET_ENV = "production";
    assert.equal(await providerUsesTestCredentials("mtn"), false);
    delete process.env.MOMO_TARGET_ENV;
  });
});
