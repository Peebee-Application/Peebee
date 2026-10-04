import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { initiateCollection } from "../payments/service.js";
import { cancelCustomerOrder } from "./time-fees.js";
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

test("checkout methods preserve payment ownership and held funds", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "checkout-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    for (const [id, role] of [["customer", "customer"], ["other", "customer"], ["rider", "rider"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES (?, ?, ?, 'hash', ?, 20000)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO riders (user_id, verified) VALUES ('rider', 1)");
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'Test')");
    await client.execute("INSERT INTO wallets (id, owner_id, name, balance) VALUES ('family', 'customer', 'Family', 10000), ('shared', 'other', 'Office', 10000), ('private', 'other', 'Private', 10000)");
    await client.execute("INSERT INTO wallet_shares (id, owner_id, grantee_id, status, wallet_id) VALUES ('share', 'other', 'customer', 'active', 'shared')");
    const app = new Hono().route("/v1", orderRoutes);
    const token = await signToken({ sub: "customer", role: "customer" });
    const other = await signToken({ sub: "other", role: "customer" });
    const request = (path: string, body?: object, auth = token) => app.request(`/v1/orders/${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const order = async (id: string) => client.execute({
      sql: "INSERT INTO orders (id, list_id, customer_id, rider_id, stage, estimated_total, delivery_fee, environment, type) VALUES (?, 'list', 'customer', 'rider', 'Match', 2500, 2500, 'live', 'parcel')",
      args: [id],
    });

    await t.test("quotes include only the relevant fees and require ownership", async () => {
      await order("quote");
      for (const [key, value] of Object.entries({ monetization_service_fee_enabled: "1", monetization_service_fee_type: "flat", monetization_service_fee_value: "500", monetization_processing_fee_enabled: "1", monetization_processing_fee_percent: "20", monetization_processing_fee_mode: "customer" })) {
        await client.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
      }
      assert.deepEqual(await (await request("quote/checkout")).json(), { baseAmount: 2500, mobileMoney: 3500, wallet: 3000, cash: 2500 });
      assert.equal((await request("quote/checkout", undefined, other)).status, 403);
      assert.equal((await request("quote/fund", { paymentMethod: "wallet", useWallet: true, acceptedAmount: 2500 })).status, 409);
      assert.equal((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance, 20000);
      await client.execute("DELETE FROM settings WHERE key LIKE 'monetization_%'");
    });
    await t.test("main wallet is debited once and rider is not paid yet", async () => {
      await order("main");
      const input = { paymentMethod: "wallet", useWallet: true, walletId: "primary", acceptedAmount: 2500 };
      assert.equal((await request("main/fund", input)).status, 200);
      assert.equal((await request("main/fund", input)).status, 409);
      assert.equal((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance, 17500);
      const payments = (await client.execute("SELECT type, status, amount FROM payments WHERE order_id = 'main'")).rows;
      assert.deepEqual(payments.map((p) => [p.type, p.status, p.amount]), [["collection", "successful", 2500]]);
      assert.equal((await client.execute("SELECT payment_rail FROM orders WHERE id = 'main'")).rows[0].payment_rail, "escrow");
    });
    await t.test("named and shared wallets debit only the chosen wallet", async () => {
      for (const [id, walletId, walletOwnerId] of [["family-order", "family", undefined], ["shared-order", "shared", "other"]]) {
        await order(id!);
        assert.equal((await request(`${id}/fund`, { paymentMethod: "wallet", useWallet: true, walletId, walletOwnerId })).status, 200);
        assert.equal((await client.execute({ sql: "SELECT balance FROM wallets WHERE id = ?", args: [walletId!] })).rows[0].balance, 7500);
      }
      await order("private-order");
      assert.equal((await request("private-order/fund", { paymentMethod: "wallet", useWallet: true, walletId: "private", walletOwnerId: "other" })).status, 403);
    });
    await t.test("insufficient wallet can switch to cash with no wallet debit", async () => {
      await order("cash");
      await client.execute("UPDATE wallets SET balance = 0 WHERE id = 'family'");
      assert.equal((await request("cash/fund", { paymentMethod: "wallet", useWallet: true, walletId: "family" })).status, 409);
      assert.equal((await request("cash/fund", { paymentMethod: "cash", acceptedAmount: 2500 })).status, 200);
      const row = (await client.execute("SELECT stage, payment_rail FROM orders WHERE id = 'cash'")).rows[0];
      assert.equal(row.stage, "Shop");
      assert.equal(row.payment_rail, "float");
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM payments WHERE order_id = 'cash'")).rows[0].n, 0);
      assert.equal((await request("cash/fund", { paymentMethod: "cash" })).status, 409);
    });
    await t.test("pending payments and completed collections cannot become cash", async () => {
      for (const status of ["pending", "successful"]) {
        await order(status);
        await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES (?, ?, 'collection', 'yo_mock', 2500, 'UGX', ?)", args: [status, status, status] });
        assert.equal((await request(`${status}/fund`, { paymentMethod: "cash" })).status, 409);
      }
    });
    await t.test("captured Mobile Money returns to the main Peebee wallet on cancellation", async () => {
      await client.execute({
        sql: "INSERT INTO orders (id, list_id, customer_id, rider_id, stage, is_ride, estimated_total, delivery_fee, environment, type) VALUES ('mobile-cancel', 'list', 'customer', 'rider', 'Shop', 0, 2500, 2500, 'live', 'parcel')",
        args: [],
      });
      await client.execute({
        sql: "INSERT INTO payments (id, order_id, type, provider, provider_ref, msisdn, amount, currency, status) VALUES ('mobile-collection', 'mobile-cancel', 'collection', 'mtn', 'mtn-ref', '0772345678', 2500, 'UGX', 'successful')",
        args: [],
      });
      assert.deepEqual((await client.execute("SELECT id, stage, rider_id, rider_departed_at, rider_arrived_at FROM orders WHERE id = 'mobile-cancel'")).rows[0], {
        id: "mobile-cancel", stage: "Shop", rider_id: "rider", rider_departed_at: null, rider_arrived_at: null,
      });
      const before = Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance);
      const result = await cancelCustomerOrder({
        id: "mobile-cancel", customer_id: "customer", rider_id: "rider", stage: "Shop", is_ride: 0,
        environment: "live", list_id: "list", rider_departed_at: null, rider_arrived_at: null,
      }, "customer", 0);
      assert.equal(result.error, undefined);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance), before + 2500);
      assert.deepEqual((await client.execute("SELECT type, provider, amount, status FROM payments WHERE order_id = 'mobile-cancel' ORDER BY type")).rows.map((row) => [row.type, row.provider, row.amount, row.status]), [
        ["collection", "mtn", 2500, "successful"],
        ["refund", "wallet", 2500, "successful"],
      ]);
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM wallet_ledger WHERE order_id = 'mobile-cancel' AND type = 'refund'")).rows[0].n, 1);
    });
    await t.test("phone detection selects the matching direct provider or Yo", async () => {
      await client.execute("INSERT INTO settings (key, value) VALUES ('payments_active_providers', '[\"mtn\",\"airtel\"]')");
      for (const [msisdn, provider] of [["0772345678", "mtn_mock"], ["0702345678", "airtel_mock"]]) {
        const result = await initiateCollection({ referenceId: provider, msisdn, amount: 2500, forceMock: true });
        assert.equal(result.provider, provider);
      }
      await client.execute("UPDATE settings SET value = '[\"yo\"]' WHERE key = 'payments_active_providers'");
      assert.equal((await initiateCollection({ referenceId: "yo", msisdn: "0702345678", amount: 2500, forceMock: true })).provider, "yo_mock");
    });
  } finally {
    setD1Binding(undefined);
    client.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

