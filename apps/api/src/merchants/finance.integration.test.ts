import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client } from "@libsql/client/node";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { ensureLedgerAccount, ledgerBalance, postLedgerTransaction, reverseLedgerTransaction } from "../ledger/service.js";
import { finalizeMerchantPayment, merchantPaymentsEnabled, settleMerchantOrderFinancials } from "./service.js";

type Prepared = {
  sql: string;
  args: unknown[];
  bind(...values: unknown[]): Prepared;
  all(): Promise<{ results: Record<string, unknown>[]; success: true; meta: { changes: number; last_row_id: number } }>;
};

function d1Binding(client: Client): D1Database {
  const prepare = (sql: string): Prepared => {
    const statement: Prepared = {
      sql,
      args: [],
      bind(...values: unknown[]) {
        this.args = values;
        return this;
      },
      async all() {
        const result = await client.execute({ sql: this.sql, args: this.args as never });
        return {
          results: result.rows as unknown as Record<string, unknown>[],
          success: true,
          meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) },
        };
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: unknown[]) {
      const results = await client.batch(
        (statements as unknown as Prepared[]).map((statement) => ({ sql: statement.sql, args: statement.args as never })),
        "write",
      );
      return results.map((result) => ({
        results: result.rows as unknown as Record<string, unknown>[],
        success: true,
        meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) },
      }));
    },
  } as unknown as D1Database;
}

async function migrate(client: Client) {
  const migrations = join(process.cwd(), "src", "db", "migrations");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
}

test("platform ledger history survives a brand change without moving funds", async () => {
  const client = createClient({ url: "file::memory:" });
  await migrate(client);
  setD1Binding(d1Binding(client));
  try {
    const platform = { ownerType: "platform" as const, ownerId: "peebee", purpose: "order_revenue", environment: "sandbox" as const };
    await client.execute(`INSERT INTO ledger_accounts (id, owner_type, owner_id, purpose, environment)
      VALUES ('legacy-platform-account', 'platform', 'previous-brand', 'order_revenue', 'sandbox')`);
    assert.equal(await ensureLedgerAccount(platform), "legacy-platform-account");

    const transaction = await postLedgerTransaction({
      kind: "brand_continuity_test", idempotencyKey: "brand-continuity", environment: "sandbox",
      postings: [
        { ...platform, amount: 500 },
        { ownerType: "order", ownerId: "order-1", purpose: "principal", environment: "sandbox", amount: -500 },
      ],
    });
    assert.equal(await ledgerBalance(platform), 500);
    assert.equal(await ledgerBalance({ ...platform, environment: "live" }), 0);
    assert.equal(await ledgerBalance({ ...platform, purpose: "settlement_fee_revenue" }), 0);
    assert.equal(await ledgerBalance({ ownerType: "order", ownerId: "order-2", purpose: "principal", environment: "sandbox" }), 0);
    const accounts = await client.execute("SELECT COUNT(*) AS count FROM ledger_accounts WHERE owner_type = 'platform'");
    assert.equal(Number(accounts.rows[0].count), 1);

    await reverseLedgerTransaction({ transactionId: transaction.id, idempotencyKey: "brand-continuity-reversal" });
    assert.equal(await ledgerBalance(platform), 0);
  } finally {
    setD1Binding(undefined);
    client.close();
  }
});

test("merchant onboarding exposes the approved taxonomy and excludes restaurants", async () => {
  const client = createClient({ url: "file::memory:" });
  await migrate(client);
  try {
    const active = await client.execute(
      "SELECT name FROM merchant_categories WHERE active = 1 ORDER BY sort_order, name",
    );
    assert.deepEqual(
      active.rows.map((row) => row.name),
      [
        "Supermarket",
        "Retail Shop",
        "Boutique",
        "Convenience Store / Mini-Mart",
        "Pharmacy & Health",
        "Electronics & Appliances",
        "Beauty & Cosmetics",
        "Bakery & Confectionery",
        "Butchery & Fresh Meat",
        "Liquor, Wine & Spirits",
        "Hardware & Home Improvement",
        "Stationery & Bookstore",
        "Furniture & Home Decor",
        "Pet Store & Agrovet",
        "Jewelry & Accessories",
        "Auto Parts & Accessories",
        "Florist & Gift Shop",
      ],
    );

    const restaurant = await client.execute(
      "SELECT active FROM merchant_categories WHERE id = 'mcat_restaurant'",
    );
    assert.equal(Number(restaurant.rows[0]?.active), 0);
  } finally {
    client.close();
  }
});

test("merchant allocation preserves principal and cannot double-credit", async () => {
  const client = createClient({ url: "file::memory:" });
  await migrate(client);
  setD1Binding(d1Binding(client));
  try {
    assert.equal(await merchantPaymentsEnabled("sandbox"), true, "sandbox merchant testing is enabled by default");
    assert.equal(await merchantPaymentsEnabled("live"), false, "live merchant payments remain fail-closed");
    for (const user of [
      ["customer-1", "+256700000001", "Customer", "customer"],
      ["rider-1", "+256700000002", "Rider", "rider"],
      ["owner-1", "+256700000003", "Merchant Owner", "customer"],
    ]) {
      await client.execute({
        sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)",
        args: user,
      });
    }
    await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider-1', 1, 1)");
    await client.execute("INSERT INTO lists (id, customer_id, title, status, environment) VALUES ('list-1', 'customer-1', 'Shop', 'active', 'sandbox')");
    await client.execute(`INSERT INTO orders
      (id, list_id, customer_id, rider_id, stage, payment_rail, estimated_total, final_total, delivery_fee, environment, funds_model)
      VALUES ('order-1', 'list-1', 'customer-1', 'rider-1', 'Shop', 'escrow', 14000, 14000, 3000, 'sandbox', 'merchant_allocations_v1')`);
    await client.execute(`INSERT INTO payments
      (id, order_id, type, provider, provider_ref, amount, status)
      VALUES ('payment-1', 'order-1', 'collection', 'yo_mock', 'provider-1', 14000, 'successful')`);
    await client.execute(`INSERT INTO merchants
      (id, legal_name, display_name, status, trust_tier, environment, approved_at)
      VALUES ('merchant-1', 'Merchant Ltd', 'Merchant', 'active', 'standard', 'sandbox', datetime('now'))`);
    await client.execute(`INSERT INTO merchant_outlets
      (id, merchant_id, category_id, name, code, lat, lng)
      VALUES ('outlet-1', 'merchant-1', 'mcat_retail', 'Merchant Main', 'PEEBEE-TEST', 0.347596, 32.58252)`);
    await client.execute("INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES ('merchant-1', 'owner-1', 'owner', 'active')");
    await client.execute("INSERT INTO merchant_balances (merchant_id, environment) VALUES ('merchant-1', 'sandbox')");
    await client.execute(`INSERT INTO merchant_payments
      (id, order_id, merchant_id, outlet_id, amount, confirmation_mode, rider_id, initiated_by,
       rider_confirmed_at, merchant_confirmed_at, risk_state, policy_version, idempotency_key, environment)
      VALUES ('merchant-payment-1', 'order-1', 'merchant-1', 'outlet-1', 11000, 'dual_confirm',
              'rider-1', 'rider-1', datetime('now'), datetime('now'), 'passed', 1, 'purchase-1', 'sandbox')`);

    await finalizeMerchantPayment("merchant-payment-1", "owner-1");
    await finalizeMerchantPayment("merchant-payment-1", "owner-1");

    const balance = await client.execute("SELECT * FROM merchant_balances WHERE merchant_id = 'merchant-1'");
    assert.equal(Number(balance.rows[0].available), 11_000);
    assert.equal(Number(balance.rows[0].held), 0);
    const budget = await client.execute("SELECT * FROM order_budgets WHERE order_id = 'order-1'");
    assert.equal(Number(budget.rows[0].principal_allocated), 11_000);
    const purchases = await client.execute("SELECT COUNT(*) AS count FROM ledger_transactions WHERE kind = 'merchant_purchase'");
    assert.equal(Number(purchases.rows[0].count), 1);
    const unbalanced = await client.execute(`SELECT COUNT(*) AS count FROM (
      SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) != 0
    )`);
    assert.equal(Number(unbalanced.rows[0].count), 0);

    await settleMerchantOrderFinancials({ orderId: "order-1", actorId: "rider-1", riderPayout: 2_500 });
    const rider = await client.execute("SELECT wallet_balance_sandbox FROM riders WHERE user_id = 'rider-1'");
    assert.equal(Number(rider.rows[0].wallet_balance_sandbox), 2_500);
  } finally {
    setD1Binding(undefined);
    client.close();
  }
});
