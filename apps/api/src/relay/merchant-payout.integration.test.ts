import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { postLedgerTransaction, ledgerBalance } from "../ledger/service.js";
import { settleRelayPayouts } from "./service.js";

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

test("relay payouts on a merchant-funded store order move through the ledger and empty the escrow", async () => {
  const client = createClient({ url: "file::memory:" });
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    for (const [id, role] of [["customer", "customer"], ["first", "rider"], ["last", "rider"], ["op", "customer"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO riders (user_id, verified) VALUES ('first', 1), ('last', 1)");
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'Store order')");
    await client.execute(`INSERT INTO orders (id, list_id, customer_id, rider_id, stage, type, payment_rail, estimated_total, delivery_fee, environment, funds_model)
                          VALUES ('ord', 'list', 'customer', 'last', 'Handover', 'shopping', 'escrow', 14000, 9000, 'live', 'merchant_allocations_v1')`);
    await client.execute(`INSERT INTO relay_routes (id, name, stage_a_name, stage_a_lat, stage_a_lng, stage_b_name, stage_b_lat, stage_b_lng, parcel_fare)
                          VALUES ('r', 'Route', 'A', 0, 0, 'B', 0, 0, 5000)`);
    for (const [leg, kind, fee, provider] of [[1, "boda", 2000, "first"], [2, "matatu", 5000, "op"], [3, "boda", 2000, "last"]] as const) {
      await client.execute({
        sql: "INSERT INTO order_relay_legs (id, order_id, leg, kind, route_id, fee, provider_id, status) VALUES (?, 'ord', ?, ?, 'r', ?, ?, 'in_transit')",
        args: [`leg${leg}`, leg, kind, fee, provider],
      });
    }
    // The delivery part of the payment sits in the order's settlement escrow, as Fund leaves it.
    await postLedgerTransaction({
      kind: "test_funding", idempotencyKey: "test-funding", environment: "live", referenceType: "order", referenceId: "ord",
      postings: [
        { ownerType: "provider", ownerId: "collections", purpose: "clearing", environment: "live", amount: -9000 },
        { ownerType: "order", ownerId: "ord", purpose: "settlement_escrow", environment: "live", amount: 9000 },
      ],
    });
    const order = (await client.execute("SELECT * FROM orders WHERE id = 'ord'")).rows[0] as Record<string, unknown>;
    assert.equal(await settleRelayPayouts(order, 9000, "last"), true);

    const riders = Object.fromEntries((await client.execute("SELECT user_id, wallet_balance FROM riders")).rows.map((r) => [r.user_id, Number(r.wallet_balance)]));
    const opWallet = Number((await client.execute("SELECT balance FROM provider_wallets WHERE provider_type='relay' AND provider_id='op' AND environment='live'")).rows[0]?.balance ?? 0);
    assert.deepEqual([riders.first, opWallet, riders.last], [2000, 5000, 2000]);
    assert.equal(await ledgerBalance({ ownerType: "order", ownerId: "ord", purpose: "settlement_escrow", environment: "live" }), 0);
    assert.equal(await ledgerBalance({ ownerType: "rider", ownerId: "first", purpose: "earnings_available", environment: "live" }), 2000);
    assert.equal(await ledgerBalance({ ownerType: "provider", ownerId: "op", purpose: "relay_work_wallet", environment: "live" }), 5000);
    assert.equal(await ledgerBalance({ ownerType: "customer", ownerId: "op", purpose: "wallet_payable", environment: "live" }), 0);
  } finally {
    client.close();
  }
});
