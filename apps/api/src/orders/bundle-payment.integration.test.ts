import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { reconcilePayment } from "../payments/reconciliation.js";
import { riderRoutes } from "../riders/routes.js";
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

// The Yo! mock settles from a hash of the provider reference; pick references that do / don't succeed.
function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}
function refWithOutcome(succeeds: boolean): string {
  for (let i = 0; i < 1000; i++) {
    const ref = `bundle-test-${i}`;
    if ((stableHash(ref) % 100 < 8) !== succeeds) return ref;
  }
  throw new Error("no reference found");
}

test("a combined delivery is paid once and every pickup is funded together", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "bundle-payment-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    for (const [id, role] of [["customer", "customer"], ["other", "customer"], ["rider", "rider"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance, wallet_balance_sandbox) VALUES (?, ?, ?, 'hash', ?, 100000, 100000)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('customer')");
    await client.execute("INSERT INTO riders (user_id, verified) VALUES ('rider', 1)");
    await client.execute("INSERT INTO restaurants (id, owner_id, name, status, is_open, environment) VALUES ('rest-a', 'other', 'Kitchen A', 'active', 1, 'live'), ('rest-b', 'other', 'Kitchen B', 'active', 1, 'live')");
    const app = new Hono().route("/v1", orderRoutes).route("/v1", riderRoutes);
    const riderToken = await signToken({ sub: "rider", role: "rider" });
    const token = await signToken({ sub: "customer", role: "customer" });
    const request = (path: string, body?: object) => app.request(`/v1/orders/${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let n = 0;
    /** A matched combined delivery: first pickup (lead) 30,000 incl. 10,000 delivery, second 20,000 incl. 2,000 extra delivery. */
    const bundle = async (environment: "live" | "sandbox") => {
      const lead = `lead${++n}`, second = `second${n}`;
      await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'customer', 'A'), (?, 'customer', 'B')", args: [`la${n}`, `lb${n}`] });
      for (const [id, listId, restaurant, total, fee] of [[lead, `la${n}`, "rest-a", 30000, 10000], [second, `lb${n}`, "rest-b", 20000, 2000]] as const) {
        await client.execute({
          sql: `INSERT INTO orders (id, list_id, customer_id, rider_id, stage, estimated_total, delivery_fee, environment, type, restaurant_id, delivery_bundle_id, delivery_bundle_hold)
                VALUES (?, ?, 'customer', 'rider', 'Match', ?, ?, ?, 'shopping', ?, ?, 0)`,
          args: [id, listId, total, fee, environment, restaurant, lead],
        });
      }
      return { lead, second };
    };
    const stages = async (...ids: string[]) => (await Promise.all(ids.map(async (id) => (await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0].stage)));
    const setSettings = async (values: Record<string, string>) => {
      for (const [key, value] of Object.entries(values)) await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
    };

    await t.test("the first pickup quotes the total for every pickup; a later pickup must be paid from the first", async () => {
      await setSettings({ monetization_service_fee_enabled: "1", monetization_service_fee_type: "flat", monetization_service_fee_value: "500" });
      const { lead, second } = await bundle("live");
      const quote = await (await request(`${lead}/checkout`)).json() as { baseAmount: number; mobileMoney: number; wallet: number; cash: number; bundle: { deliveryFee: number; orders: Array<{ id: string; restaurantName: string }> } };
      assert.equal(quote.baseAmount, 50000);
      assert.equal(quote.cash, 50000);
      assert.equal(quote.wallet, 51000, "one service fee per order, as for separate orders");
      assert.equal(quote.mobileMoney, 51000);
      assert.equal(quote.bundle.deliveryFee, 12000);
      assert.deepEqual(quote.bundle.orders.map((o) => o.restaurantName), ["Kitchen A", "Kitchen B"]);
      const blocked = await request(`${second}/fund`, { paymentMethod: "wallet", useWallet: true });
      assert.equal(blocked.status, 409);
      assert.equal(((await blocked.json()) as { payWithOrderId: string }).payWithOrderId, lead);
      assert.deepEqual(await stages(lead, second), ["Match", "Match"]);
      await client.execute("DELETE FROM settings WHERE key LIKE 'monetization_%'");
    });

    await t.test("one wallet payment funds both pickups with a payment, ledger line and fee record each", async () => {
      await setSettings({ monetization_service_fee_enabled: "1", monetization_service_fee_type: "flat", monetization_service_fee_value: "500" });
      const { lead, second } = await bundle("live");
      const before = Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance);
      assert.equal((await request(`${lead}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: 50000 })).status, 409, "a stale total is refused");
      assert.deepEqual(await stages(lead, second), ["Match", "Match"]);
      const paid = await request(`${lead}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: 51000 });
      assert.equal(paid.status, 200, JSON.stringify(await paid.clone().json()));
      assert.deepEqual(await stages(lead, second), ["Shop", "Shop"]);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance), before - 51000);
      const payments = (await client.execute({ sql: "SELECT order_id, provider, status, amount FROM payments WHERE order_id IN (?, ?) ORDER BY order_id", args: [lead, second] })).rows;
      assert.deepEqual(payments.map((p) => [p.order_id, p.provider, p.status, p.amount]), [[lead, "wallet", "successful", 30500], [second, "wallet", "successful", 20500]]);
      const ledger = (await client.execute({ sql: "SELECT order_id, amount, balance_after FROM wallet_ledger WHERE type = 'order_payment' AND order_id IN (?, ?) ORDER BY amount DESC", args: [lead, second] })).rows;
      assert.deepEqual(ledger.map((l) => [l.order_id, l.amount]), [[second, -20500], [lead, -30500]]);
      assert.deepEqual(ledger.map((l) => Number(l.balance_after)), [before - 51000, before - 30500], "balances step down line by line and the last one is the real balance");
      const fees = (await client.execute({ sql: "SELECT order_id, service_fee FROM order_fees WHERE order_id IN (?, ?) ORDER BY order_id", args: [lead, second] })).rows;
      assert.deepEqual(fees.map((f) => [f.order_id, f.service_fee]), [[lead, 500], [second, 500]]);
      assert.equal((await request(`${lead}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: 51000 })).status, 409, "no second charge");
      await client.execute("DELETE FROM settings WHERE key LIKE 'monetization_%'");
    });

    await t.test("an insufficient wallet changes nothing", async () => {
      const { lead, second } = await bundle("live");
      await client.execute("UPDATE users SET wallet_balance = 40000 WHERE id = 'customer'");
      const res = await request(`${lead}/fund`, { paymentMethod: "wallet", useWallet: true });
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { error: string }).error, "insufficient_wallet_balance");
      assert.deepEqual(await stages(lead, second), ["Match", "Match"]);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'customer'")).rows[0].wallet_balance), 40000);
      assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM payments WHERE order_id IN (?, ?)", args: [lead, second] })).rows[0].n, 0);
      await client.execute("UPDATE users SET wallet_balance = 100000 WHERE id = 'customer'");
    });

    await t.test("the rider sees every restaurant of a combined delivery in order", async () => {
      const { lead } = await bundle("live");
      const res = await app.request("/v1/riders/me/orders", { headers: { Authorization: `Bearer ${riderToken}` } });
      assert.equal(res.status, 200);
      const orders = ((await res.json()) as { orders: Array<{ id: string; bundle_pickups: string | null }> }).orders;
      assert.equal(orders.find((o) => o.id === lead)?.bundle_pickups, "Kitchen A → Kitchen B");
    });

    await t.test("cash on delivery starts both pickups", async () => {
      const { lead, second } = await bundle("live");
      const res = await request(`${lead}/fund`, { paymentMethod: "cash", acceptedAmount: 50000 });
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      assert.deepEqual(await stages(lead, second), ["Shop", "Shop"]);
      assert.deepEqual((await client.execute({ sql: "SELECT payment_rail FROM orders WHERE id IN (?, ?)", args: [lead, second] })).rows.map((r) => r.payment_rail), ["float", "float"]);
    });

    await t.test("one Mobile Money request covers the total and both pickups follow its result", async () => {
      const { lead, second } = await bundle("sandbox");
      const res = await request(`${lead}/fund`, { paymentMethod: "mobile_money", msisdn: "256772123456", acceptedAmount: 50000 });
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      const { payment } = await res.json() as { payment: { id: string; status: string } };
      assert.equal(payment.status, "pending");
      assert.deepEqual(await stages(lead, second), ["Fund", "Fund"]);
      const rows = (await client.execute({ sql: "SELECT id, order_id, provider, status, amount FROM payments WHERE order_id IN (?, ?) ORDER BY order_id", args: [lead, second] })).rows;
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => [r.order_id, r.status, r.amount]), [[lead, "pending", 30000], [second, "pending", 20000]]);
      assert.equal(rows.find((r) => r.order_id === second)?.provider, "bundle_child");
      const operations = (await client.execute({ sql: "SELECT business_id, amount FROM provider_operations WHERE business_type = 'payment'", args: [] })).rows.filter((o) => rows.some((r) => r.id === o.business_id));
      assert.deepEqual(operations.map((o) => [o.business_id, o.amount]), [[payment.id, 50000]], "the provider is asked once, for the total");
      // The provider confirms the single collection.
      await client.execute({ sql: "UPDATE payments SET provider_ref = ?, created_at = datetime('now', '-1 hour') WHERE id = ?", args: [refWithOutcome(true), payment.id] });
      const childId = String(rows.find((r) => r.order_id === second)?.id);
      assert.equal(await reconcilePayment(childId, "test"), "successful", "checking the second pickup's payment resolves the whole collection");
      assert.deepEqual(await stages(lead, second), ["Shop", "Shop"]);
      assert.deepEqual((await client.execute({ sql: "SELECT status FROM payments WHERE order_id IN (?, ?) ORDER BY order_id", args: [lead, second] })).rows.map((r) => r.status), ["successful", "successful"]);
      assert.equal(await reconcilePayment(payment.id, "test"), "successful", "repeat checks are harmless");
      assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND stage = 'Shop'", args: [second] })).rows[0].n, 1);
    });

    await t.test("a failed Mobile Money request fails the linked payment of every pickup", async () => {
      const { lead, second } = await bundle("sandbox");
      const res = await request(`${lead}/fund`, { paymentMethod: "mobile_money", msisdn: "256772123456" });
      const { payment } = await res.json() as { payment: { id: string } };
      await client.execute({ sql: "UPDATE payments SET provider_ref = ?, created_at = datetime('now', '-1 hour') WHERE id = ?", args: [refWithOutcome(false), payment.id] });
      assert.equal(await reconcilePayment(payment.id, "test"), "failed");
      assert.deepEqual((await client.execute({ sql: "SELECT status FROM payments WHERE order_id IN (?, ?) ORDER BY order_id", args: [lead, second] })).rows.map((r) => r.status), ["failed", "failed"]);
    });

    await t.test("a combined delivery that was part-paid under the old flow still pays pickup by pickup", async () => {
      const { lead, second } = await bundle("live");
      await client.execute({ sql: "UPDATE orders SET stage = 'Shop' WHERE id = ?", args: [lead] });
      const res = await request(`${second}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: 20000 });
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      assert.deepEqual(await stages(lead, second), ["Shop", "Shop"]);
      assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM payments WHERE order_id = ?", args: [lead] })).rows[0].n, 0);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
