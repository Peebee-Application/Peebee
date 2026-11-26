import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { walletAccountRoutes } from "./accounts-routes.js";
import { walletRoutes } from "./routes.js";
import { walletsRoutes } from "./wallets.js";

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

test("wallet accounts: freeze, send source, contacts, requests and idempotency", async () => {
  process.env.JWT_SECRET = "wallet-accounts-test-secret";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const app = new Hono();
  app.route("/v1", walletRoutes);
  app.route("/v1", walletAccountRoutes);
  app.route("/v1", walletsRoutes);

  await client.execute(`INSERT INTO users (id, phone, email, name, password_hash, role, wallet_balance) VALUES
    ('ada', '0772000412', 'ada@peebee.test', 'Nakato Sarah', 'x', 'customer', 50000),
    ('ben', '0772111000', 'ben@peebee.test', 'Ben Okello', 'x', 'customer', 940000)`);
  await client.execute(`INSERT INTO wallets (id, owner_id, name, balance) VALUES ('home', 'ben', 'Home', 120000)`);
  const token = async (sub: string) => signToken({ sub, role: "customer", phone: sub === "ben" ? "0772111000" : "0772000412" });
  const call = async (who: "ada" | "ben", path: string, method = "GET", body?: unknown) => {
    const res = await app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(who)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const balance = async (id: string, wallet?: string) => {
    if (!wallet) return Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
    return Number((await client.execute({ sql: "SELECT balance AS b FROM wallets WHERE id = ?", args: [wallet] })).rows[0].b);
  };

  assert.equal((await call("ben", "/wallet")).body.personalWalletActive, false);
  assert.equal((await call("ben", "/wallet/transfer", "POST", {})).status, 409);
  assert.equal((await call("ben", "/personal-wallet/activate", "POST")).status, 200);
  assert.equal((await call("ada", "/personal-wallet/activate", "POST")).status, 200);

  const byName = await call("ben", "/wallet/transfer", "POST", { recipient: "Nakato Sarah", amount: 1000, idempotencyKey: "name-is-not-an-id" });
  assert.equal(byName.status, 404, "a display name is not a phone or email");

  const lookup = await call("ben", "/wallet/lookup?q=0772000412");
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.maskedPhone, "07•• ••• 412");
  assert.equal(lookup.body.name, "Nakato Sarah");
  assert.equal("phone" in lookup.body, false);
  assert.equal(JSON.stringify(lookup.body).includes("0772000412"), false);

  const saved = await call("ben", "/wallet/contacts", "POST", { recipientId: lookup.body.recipientId, nickname: "Sarah" });
  assert.equal(saved.status, 201);
  assert.equal((saved.body.contact as { maskedPhone: string }).maskedPhone, "07•• ••• 412");

  const frozen = await call("ben", "/wallets/home", "PATCH", { frozen: true });
  assert.equal(frozen.status, 200);
  const blocked = await call("ben", "/wallet/transfer", "POST", { recipientId: "ada", amount: 5000, fromWalletId: "home", idempotencyKey: "frozen-send-1" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "account_frozen");
  assert.equal(await balance("home", "home"), 120000);

  const unfreeze = await call("ben", "/wallets/home", "PATCH", { frozen: false });
  assert.equal(unfreeze.status, 400);
  assert.equal((await call("ben", "/wallets/home", "PATCH", { frozen: false, confirm: true })).status, 200);

  const key = "send-once-please-001";
  const sent = await call("ben", "/wallet/transfer", "POST", { recipientId: "ada", amount: 25000, fromWalletId: "home", idempotencyKey: key, note: "Rent share" });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.recipientName, "Nakato Sarah");
  assert.equal(await balance("home", "home"), 95000);
  assert.equal(await balance("ada"), 75000);
  const again = await call("ben", "/wallet/transfer", "POST", { recipientId: "ada", amount: 25000, fromWalletId: "home", idempotencyKey: key });
  assert.equal(again.status, 201);
  assert.equal(await balance("home", "home"), 95000, "the same key does not send twice");

  const request = await call("ada", "/wallet/requests", "POST", { recipientId: "ben", amount: 4000, note: "Lunch" });
  assert.equal(request.status, 201);
  const payKey = "pay-request-once-01";
  const paid = await call("ben", `/wallet/requests/${request.body.id}/pay`, "POST", { fromWalletId: "primary", idempotencyKey: payKey });
  assert.equal(paid.status, 200);
  assert.equal(await balance("ben"), 936000);
  const paidAgain = await call("ben", `/wallet/requests/${request.body.id}/pay`, "POST", { idempotencyKey: payKey });
  assert.equal(paidAgain.body.status ?? "paid", "paid");
  assert.equal(await balance("ben"), 936000);

  await client.execute(`INSERT INTO restaurants (id, owner_id, name, status, logo_key) VALUES ('grill', 'ada', 'Kampala Grill', 'active', 'restaurants/grill/logos/a.jpg')`);
  await client.execute(`INSERT INTO lists (id, customer_id, title) VALUES ('list1', 'ben', 'Lunch')`);
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, restaurant_id) VALUES ('ord1', 'list1', 'ben', 'grill')`);
  await client.execute(`INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, environment) VALUES ('wl1', 'ben', 'order_payment', -8000, 100, 'ord1', 'live')`);
  const home = await call("ben", "/wallet");
  const ledger = home.body.ledger as Array<Record<string, unknown>>;
  const row = ledger.find((entry) => entry.id === "wl1");
  assert.equal(row?.merchant_name, "Kampala Grill");
  assert.equal(row?.merchant_logo, "/v1/restaurants/grill/logo");
});
