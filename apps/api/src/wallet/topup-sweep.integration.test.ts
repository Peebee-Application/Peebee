import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { paymentRoutes } from "../payments/routes.js";
import { settleCustomerTopup, sweepPendingTopups } from "./topup-settle.js";

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

test("a top-up that was paid is credited without the customer's screen asking", async (t) => {
  process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK-live-test-X";
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = "whsec";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const realFetch = globalThis.fetch;
  let flutterwave: "pending" | "successful" | "failed" | "weird" = "pending";
  let verifyCalls = 0;
  globalThis.fetch = (async () => {
    verifyCalls += 1;
    return new Response(JSON.stringify({ status: "success", data: { status: flutterwave, id: 1 } }), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.FLUTTERWAVE_SECRET_KEY; delete process.env.FLUTTERWAVE_WEBHOOK_SECRET; });

  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES ('cust', 'c', 'c', 'h', 'customer', -500), ('rider', 'r', 'r', 'h', 'rider', 0)");
  await client.execute("INSERT INTO riders (user_id, wallet_balance) VALUES ('rider', 0)");
  let n = 0;
  async function customerTopup(minutesAgo = 5) {
    n += 1;
    await client.execute({
      sql: `INSERT INTO wallet_topups (id, user_id, amount, provider, provider_ref, status, environment, created_at, updated_at)
            VALUES (?, 'cust', 1000, 'flutterwave', ?, 'pending', 'live', datetime('now', ?), datetime('now', ?))`,
      args: [`wtu${n}`, `wtu${n}`, `-${minutesAgo} minutes`, `-${minutesAgo} minutes`],
    });
    return `wtu${n}`;
  }
  const row = async (sql: string) => (await client.execute(sql)).rows[0] as Record<string, unknown>;
  const balance = async () => Number((await row("SELECT wallet_balance AS b FROM users WHERE id = 'cust'")).b);
  const statusOf = async (id: string) => String((await row(`SELECT status FROM wallet_topups WHERE id = '${id}'`)).status);

  await t.test("still pending at Flutterwave: nothing credited, status kept", async () => {
    const id = await customerTopup();
    flutterwave = "pending";
    const result = await sweepPendingTopups();
    assert.equal(result.checked, 1);
    assert.equal(await statusOf(id), "pending");
    assert.equal(await balance(), -500);
  });

  await t.test("paid at Flutterwave: the sweep credits the wallet once", async () => {
    flutterwave = "successful";
    await client.execute("UPDATE wallet_topups SET updated_at = datetime('now', '-20 minutes') WHERE id = 'wtu1'");
    const result = await sweepPendingTopups();
    assert.equal(result.credited, 1);
    assert.equal(await statusOf("wtu1"), "successful");
    assert.equal(await balance(), 500, "-500 + 1000");
    await sweepPendingTopups();
    await settleCustomerTopup((await row("SELECT * FROM wallet_topups WHERE id = 'wtu1'")));
    assert.equal(await balance(), 500, "checked again: not credited twice");
    assert.equal(Number((await row("SELECT COUNT(*) AS c FROM wallet_ledger WHERE user_id = 'cust' AND type = 'topup'")).c), 1);
  });

  await t.test("failed at Flutterwave: the top-up is marked failed, nothing credited", async () => {
    const id = await customerTopup();
    flutterwave = "failed";
    const result = await sweepPendingTopups();
    assert.equal(result.failed, 1);
    assert.equal(await statusOf(id), "failed");
    assert.equal(await balance(), 500);
  });

  await t.test("an answer that is not clearly 'successful' is never treated as paid", async () => {
    const id = await customerTopup();
    flutterwave = "weird";
    await sweepPendingTopups();
    assert.equal(await statusOf(id), "pending");
    assert.equal(await balance(), 500);
  });

  await t.test("the sweep backs off: a top-up checked a minute ago is left alone, an old abandoned one is not re-checked every run", async () => {
    flutterwave = "pending";
    const recent = await customerTopup(120); // two hours old
    await client.execute(`UPDATE wallet_topups SET updated_at = datetime('now', '-2 minutes') WHERE id = '${recent}'`);
    verifyCalls = 0;
    await client.execute("UPDATE wallet_topups SET status = 'failed' WHERE status = 'pending' AND id != '" + recent + "'");
    await sweepPendingTopups();
    assert.equal(verifyCalls, 0, "checked 2 minutes ago and older than an hour: not due yet");
    await client.execute(`UPDATE wallet_topups SET updated_at = datetime('now', '-15 minutes') WHERE id = '${recent}'`);
    await sweepPendingTopups();
    assert.equal(verifyCalls, 1, "due again after 10 minutes");
    await client.execute(`UPDATE wallet_topups SET status = 'failed' WHERE id = '${recent}'`);
  });

  await t.test("a rider's top-up is credited by the sweep too", async () => {
    await client.execute("INSERT INTO rider_wallet_topups (id, rider_id, amount, provider, provider_ref, status, environment, created_at, updated_at) VALUES ('rtu1', 'rider', 2000, 'flutterwave', 'rtu1', 'pending', 'live', datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))");
    flutterwave = "successful";
    await sweepPendingTopups();
    assert.equal(Number((await row("SELECT wallet_balance AS b FROM riders WHERE user_id = 'rider'")).b), 2000);
    assert.equal(String((await row("SELECT status FROM rider_wallet_topups WHERE id = 'rtu1'")).status), "successful");
  });

  await t.test("the Flutterwave webhook settles a top-up", async () => {
    const id = await customerTopup();
    flutterwave = "successful";
    const app = new Hono().route("/v1", paymentRoutes);
    const res = await app.request("/v1/payments/flutterwave/callback", {
      method: "POST",
      headers: { "verif-hash": "whsec", "Content-Type": "application/json" },
      body: JSON.stringify({ data: { tx_ref: id } }),
    });
    assert.equal(res.status, 200);
    assert.equal(await statusOf(id), "successful");
    assert.equal(await balance(), 1500);
  });
});
