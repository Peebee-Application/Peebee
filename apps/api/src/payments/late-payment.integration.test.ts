import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { paymentRoutes } from "./routes.js";
import { reconcilePayment, sweepProviderOperations } from "./reconciliation.js";

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

test("a customer who approves after the timeout is credited once, and watching has an end", async (t) => {
  process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK-test-secret-X";
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = "whsec";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const realFetch = globalThis.fetch;
  let providerStatus: "pending" | "successful" | "failed" = "pending";
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: "success", data: { status: providerStatus, id: 1 } }), { status: 200 })) as typeof fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.FLUTTERWAVE_SECRET_KEY; delete process.env.FLUTTERWAVE_WEBHOOK_SECRET; });

  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer')");
  const setSetting = (key: string, value: string) => client.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, value] });
  let n = 0;
  async function stuckPayment(minutesAgo: number) {
    n += 1;
    await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'cust', 'x')", args: [`l${n}`] });
    await client.execute({ sql: "INSERT INTO orders (id, list_id, customer_id, stage) VALUES (?, ?, 'cust', 'Fund')", args: [`o${n}`, `l${n}`] });
    await client.execute({
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status, created_at)
            VALUES (?, ?, 'collection', 'flutterwave', ?, 5500, 'UGX', 'pending', datetime('now', ?))`,
      args: [`p${n}`, `o${n}`, `ref${n}`, `-${minutesAgo} minutes`],
    });
    await client.execute({
      sql: `INSERT INTO provider_operations (id, operation_type, business_type, business_id, provider, provider_ref, idempotency_key, amount, environment, status)
            VALUES (?, 'collection', 'payment', ?, 'flutterwave', ?, ?, 5500, 'live', 'pending')`,
      args: [`op${n}`, `p${n}`, `ref${n}`, `idem${n}`],
    });
    return { payment: `p${n}`, op: `op${n}`, order: `o${n}` };
  }
  const row = async (sql: string) => (await client.execute(sql)).rows[0] as Record<string, unknown>;
  const balance = async () => Number((await row("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).b);
  const credits = async () => Number((await row("SELECT COUNT(*) AS c FROM wallet_ledger WHERE user_id = 'cust'")).c);

  await t.test("a timeout keeps the operation open so a late approval can still be found", async () => {
    const s = await stuckPayment(20);
    providerStatus = "pending";
    assert.equal(await reconcilePayment(s.payment, "test"), "failed");
    const op = await row(`SELECT status, failure_code FROM provider_operations WHERE id = '${s.op}'`);
    assert.equal(op.status, "unknown");
    assert.equal(op.failure_code, "timed_out");
    assert.equal(await balance(), 0);
  });

  await t.test("approved late: the wallet is credited once, even if checked again", async () => {
    providerStatus = "successful";
    await client.execute("UPDATE provider_operations SET next_check_at = datetime('now', '-1 minutes') WHERE id = 'op1'");
    await sweepProviderOperations();
    assert.equal(await balance(), 5500);
    assert.equal(await credits(), 1);
    const op = await row("SELECT status, failure_code FROM provider_operations WHERE id = 'op1'");
    assert.equal(op.status, "successful");
    assert.equal(op.failure_code, "late_credited");
    assert.equal(String((await row("SELECT status FROM payments WHERE id = 'p1'")).status), "failed", "the customer-facing payment stays failed");

    await reconcilePayment("p1", "again");
    await sweepProviderOperations();
    assert.equal(await balance(), 5500, "no second credit");
    assert.equal(await credits(), 1);
  });

  await t.test("the Flutterwave webhook also finds a late approval", async () => {
    providerStatus = "pending";
    const s = await stuckPayment(20);
    await reconcilePayment(s.payment, "test");
    providerStatus = "successful";
    const app = new Hono().route("/v1", paymentRoutes);
    const res = await app.request("/v1/payments/flutterwave/callback", {
      method: "POST",
      headers: { "verif-hash": "whsec", "Content-Type": "application/json" },
      body: JSON.stringify({ data: { tx_ref: `ref${n}` } }),
    });
    assert.equal(res.status, 200);
    assert.equal(await balance(), 11000);
    assert.equal(await credits(), 2);
  });

  await t.test("a provider that says failed ends the watch without a credit", async () => {
    providerStatus = "pending";
    const s = await stuckPayment(20);
    await reconcilePayment(s.payment, "test");
    providerStatus = "failed";
    await reconcilePayment(s.payment, "test");
    const op = await row(`SELECT status, failure_code FROM provider_operations WHERE id = '${s.op}'`);
    assert.equal(op.status, "failed");
    assert.equal(await balance(), 11000);
  });

  await t.test("the watch ends once the window has passed", async () => {
    providerStatus = "pending";
    await setSetting("payments_late_watch_hours", "24");
    const s = await stuckPayment(20);
    await reconcilePayment(s.payment, "test");
    await client.execute(`UPDATE payments SET created_at = datetime('now', '-30 hours') WHERE id = '${s.payment}'`);
    await reconcilePayment(s.payment, "test");
    const op = await row(`SELECT status, failure_code FROM provider_operations WHERE id = '${s.op}'`);
    assert.equal(op.status, "failed");
    assert.equal(op.failure_code, "late_window_closed");
  });

  await t.test("watching switched off (0 hours) ends the operation at the timeout", async () => {
    providerStatus = "pending";
    await setSetting("payments_late_watch_hours", "0");
    const s = await stuckPayment(20);
    await reconcilePayment(s.payment, "test");
    const op = await row(`SELECT status, failure_code FROM provider_operations WHERE id = '${s.op}'`);
    assert.equal(op.status, "failed");
    assert.equal(op.failure_code, "timed_out");
    providerStatus = "successful";
    await reconcilePayment(s.payment, "test");
    assert.equal(await balance(), 11000, "nothing is credited when watching is off");
  });
});
