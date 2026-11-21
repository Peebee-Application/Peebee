import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setEmailSenderForTests } from "../lib/email-gateway.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { setSmsSenderForTests } from "../lib/sms-gateway.js";
import { flushMoneyAlerts, notifyMoneyMove, setMoneyAlertDeliveryForTests } from "./alerts.js";
import { walletRoutes } from "./routes.js";

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
  resetSchemaCache();
}

async function migrated() {
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute(`INSERT INTO users (id, phone, email, name, password_hash, role, wallet_balance) VALUES
    ('ada', '0772000412', 'ada@peebee.test', 'Nakato Sarah', 'x', 'customer', 10000),
    ('ben', '0772111000', 'ben@peebee.test', 'Ben Okello', 'x', 'customer', 80000)`);
  return client;
}

test("a transfer succeeds even when the money-alert notifier throws", async () => {
  process.env.JWT_SECRET = "wallet-alert-test-secret";
  const client = await migrated();
  const app = new Hono();
  app.route("/v1", walletRoutes);
  const token = await signToken({ sub: "ben", role: "customer", phone: "0772111000" });
  setMoneyAlertDeliveryForTests(async () => { throw new Error("notifier down"); });
  try {
    const res = await app.request("/v1/wallet/transfer", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "ada", amount: 1500, idempotencyKey: "alert-throw-0001" }),
    });
    assert.equal(res.status, 201);
    await flushMoneyAlerts();
    assert.equal(Number((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'ben'")).rows[0].b), 78500);
    assert.equal(Number((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'ada'")).rows[0].b), 11500);
  } finally {
    setMoneyAlertDeliveryForTests(null);
  }
});

test("money alerts follow the admin switches and do not send twice for one transfer", async () => {
  process.env.JWT_SECRET = "wallet-alert-test-secret";
  const client = await migrated();
  const emails: string[] = [];
  const texts: string[] = [];
  setEmailSenderForTests(async (to) => { emails.push(to); });
  setSmsSenderForTests(async (to) => { texts.push(to); return { status: "sent", provider: "africas_talking", externalId: "1" }; });
  try {
    await notifyMoneyMove({ transferId: "transfer:ben:once", amount: 2000, fromUserId: "ben", toUserId: "ada" });
    await notifyMoneyMove({ transferId: "transfer:ben:once", amount: 2000, fromUserId: "ben", toUserId: "ada" });
    assert.deepEqual(emails.sort(), ["ada@peebee.test", "ben@peebee.test"]);
    assert.deepEqual(texts, []);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM wallet_alerts")).rows[0].n), 2);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM chat_messages WHERE sender_role = 'system'")).rows[0].n), 2);

    emails.length = 0;
    await setSetting("wallet_alert_email_sent", "0");
    await setSetting("wallet_alert_email_received", "0");
    await setSetting("wallet_alert_sms_received", "1");
    await notifyMoneyMove({ transferId: "transfer:ben:sms", amount: 500, fromUserId: "ben", toUserId: "ada" });
    assert.deepEqual(emails, []);
    assert.deepEqual(texts, ["0772000412"]);
  } finally {
    setEmailSenderForTests(null);
    setSmsSenderForTests(null);
  }
});
