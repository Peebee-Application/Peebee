import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { getJobExpirySettings, jobExpiryMinutes, setJobExpirySettings } from "../lib/settings.js";
import { sweepExpiredOrders } from "./expiry.js";
import { orderRoutes } from "./routes.js";

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

test("job expiry sweep", async (t) => {
  process.env.JWT_SECRET = "local-expiry-test-secret-only";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);

  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer'), ('other', 'o', 'o', 'h', 'customer'), ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'a'), ('l2', 'cust', 'b'), ('l3', 'cust', 'c'), ('l4', 'cust', 'd')");
  const hoursAgo = (h: number) => `datetime('now', '-${h} hours')`;
  // old + unserved (paid), old + unserved (unpaid), recent + unserved, old but a rider took it
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, stage, created_at) VALUES ('old_paid', 'l1', 'cust', 'Match', ${hoursAgo(13)})`);
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, stage, created_at) VALUES ('old_unpaid', 'l2', 'cust', 'Create', ${hoursAgo(13)})`);
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, stage, created_at) VALUES ('recent', 'l3', 'cust', 'Create', ${hoursAgo(2)})`);
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, stage, rider_id, created_at) VALUES ('served', 'l4', 'cust', 'Shop', 'rider', ${hoursAgo(13)})`);
  await client.execute("INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES ('p1', 'old_paid', 'collection', 'wallet', 7000, 'UGX', 'successful')");

  await t.test("duration converts minutes and hours", () => {
    assert.equal(jobExpiryMinutes({ enabled: true, value: 12, unit: "hours" }), 720);
    assert.equal(jobExpiryMinutes({ enabled: true, value: 45, unit: "minutes" }), 45);
  });

  await t.test("does nothing while switched off (the default)", async () => {
    assert.equal((await getJobExpirySettings()).enabled, false);
    assert.deepEqual(await sweepExpiredOrders(), { expired: 0, skipped: 0 });
    const stages = await client.execute("SELECT id, stage FROM orders ORDER BY id");
    assert.ok(stages.rows.every((r) => r.stage !== "Cancelled"));
  });

  await t.test("expires only old, unserved jobs and refunds what was paid", async () => {
    await setJobExpirySettings({ enabled: true, value: 12, unit: "hours" });
    assert.deepEqual(await sweepExpiredOrders(), { expired: 2, skipped: 0 });
    const stage = async (id: string) => (await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0].stage;
    assert.equal(await stage("old_paid"), "Cancelled");
    assert.equal(await stage("old_unpaid"), "Cancelled");
    assert.equal(await stage("recent"), "Create");
    assert.equal(await stage("served"), "Shop");
    const wallet = await client.execute("SELECT wallet_balance FROM users WHERE id = 'cust'");
    assert.equal(wallet.rows[0].wallet_balance, 7000);
    const events = await client.execute("SELECT note FROM order_events WHERE order_id = 'old_paid' AND stage = 'Cancelled'");
    assert.match(String(events.rows[0].note), /Expired: no rider took this job within 12 hours/);
  });

  await t.test("expired jobs go back to drafts the customer can resend", async () => {
    const lists = await client.execute("SELECT id, status FROM lists ORDER BY id");
    const status = (id: string) => lists.rows.find((r) => r.id === id)?.status;
    assert.equal(status("l1"), "draft");
    assert.equal(status("l2"), "draft");
    assert.equal(status("l3"), "draft", "untouched list stays as created");
    const app = new Hono().route("/v1", orderRoutes);
    const call = async (path: string, sub: string, method = "GET") =>
      app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${await signToken({ sub, role: "customer" })}` } });

    const detail = (await (await call("/lists/l1", "cust")).json()) as { resendOrderId: string | null };
    assert.equal(detail.resendOrderId, "old_paid");
    const recent = (await (await call("/lists/recent", "cust")).json()) as { lists: { id: string; expired: boolean }[] };
    assert.equal(recent.lists.find((l) => l.id === "l1")?.expired, true);

    assert.equal((await call("/orders/old_paid/resend", "other", "POST")).status, 403);
    assert.equal((await call("/orders/served/resend", "cust", "POST")).status, 409, "a running order can't be resent");
    const resent = await call("/orders/old_paid/resend", "cust", "POST");
    assert.equal(resent.status, 201);
    const created = (await resent.json()) as { order: { id: string; stage: string; list_id: string } };
    assert.equal(created.order.stage, "Create");
    assert.equal(created.order.list_id, "l1");
    assert.equal((await client.execute("SELECT status FROM lists WHERE id = 'l1'")).rows[0].status, "active");
    assert.equal((await call("/orders/old_paid/resend", "cust", "POST")).status, 409, "only once");
  });

  await t.test("running again is a no-op and a shorter limit expires the recent job", async () => {
    assert.deepEqual(await sweepExpiredOrders(), { expired: 0, skipped: 0 });
    await setJobExpirySettings({ enabled: true, value: 90, unit: "minutes" });
    assert.deepEqual(await sweepExpiredOrders(), { expired: 1, skipped: 0 });
    const wallet = await client.execute("SELECT wallet_balance FROM users WHERE id = 'cust'");
    assert.equal(wallet.rows[0].wallet_balance, 7000, "no double refund");
  });
});
