import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { getMatchingSettings, setSetting } from "../lib/settings.js";
import { sweepStuckFunding, sweepUnpaidAssignments } from "./unpaid-release.js";

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

test("a rider matched to an order nobody pays for is released after the admin-set wait", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);

  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer'), ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  const minsAgo = (m: number) => `datetime('now', '-${m} minutes')`;
  let n = 0;
  const order = async (id: string, fields: { stage?: string; rider?: string | null; rail?: string; ageMin: number }) => {
    n += 1;
    await client.execute(`INSERT INTO lists (id, customer_id, title) VALUES ('l${n}', 'cust', 't')`);
    await client.execute({
      sql: `INSERT INTO orders (id, list_id, customer_id, stage, rider_id, payment_rail, created_at, updated_at) VALUES (?, ?, 'cust', ?, ?, ?, ${minsAgo(fields.ageMin)}, ${minsAgo(fields.ageMin)})`,
      args: [id, `l${n}`, fields.stage ?? "Match", fields.rider === undefined ? "rider" : fields.rider, fields.rail ?? "escrow"],
    });
  };
  const pay = (orderId: string, status: string, id = `p_${orderId}`) =>
    client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES (?, ?, 'collection', 'mtn', 2500, 'UGX', ?)", args: [id, orderId, status] });

  await order("stuck", { ageMin: 30 });
  await order("stuck_failed_payment", { ageMin: 30 }); await pay("stuck_failed_payment", "failed");
  await order("recent", { ageMin: 5 });
  await order("paying", { ageMin: 30 }); await pay("paying", "pending");
  await order("paid", { ageMin: 30, stage: "Shop" }); await pay("paid", "successful");
  await order("cash", { ageMin: 30, rail: "float" });
  await order("no_rider", { ageMin: 30, rider: null, stage: "Create" });
  await order("bundled", { ageMin: 30 });
  await client.execute("UPDATE orders SET delivery_bundle_id = 'b1' WHERE id = 'bundled'");

  await t.test("is on by default at 15 minutes, and does nothing at 0", async () => {
    assert.equal((await getMatchingSettings()).unpaidMatchReleaseMinutes, 15);
    await setSetting("unpaid_match_release_minutes", "0");
    assert.deepEqual(await sweepUnpaidAssignments(), { released: 0, skipped: 0 });
    assert.equal((await client.execute("SELECT rider_id FROM orders WHERE id = 'stuck'")).rows[0].rider_id, "rider");
    await setSetting("unpaid_match_release_minutes", "15");
  });

  await t.test("frees the rider only on old, unpaid, ordinary escrow orders", async () => {
    assert.deepEqual(await sweepUnpaidAssignments(), { released: 2, skipped: 0 });
    const rows = (await client.execute("SELECT id, stage, rider_id FROM orders ORDER BY id")).rows;
    const by = Object.fromEntries(rows.map((r) => [String(r.id), r]));
    for (const id of ["stuck", "stuck_failed_payment"]) {
      assert.equal(by[id].rider_id, null, `${id}: rider released`);
      assert.equal(by[id].stage, "Create", `${id}: back in the pool`);
    }
    assert.equal(by.recent.rider_id, "rider", "within the wait");
    assert.equal(by.paying.rider_id, "rider", "a payment in progress is never interrupted");
    assert.equal(by.paid.rider_id, "rider", "a paid order keeps its rider");
    assert.equal(by.cash.rider_id, "rider", "cash orders are left alone");
    assert.equal(by.bundled.rider_id, "rider", "combined deliveries are left for a person");
    const events = (await client.execute("SELECT order_id, note FROM order_events WHERE note LIKE 'Rider released%'")).rows;
    assert.equal(events.length, 2);
  });

  await t.test("running it again changes nothing", async () => {
    assert.deepEqual(await sweepUnpaidAssignments(), { released: 0, skipped: 0 });
  });
});

test("an order stuck at Funding is unlocked after the admin-set wait", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer'), ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  let n = 0;
  const order = async (id: string, rider: string | null, ageMin: number) => {
    n += 1;
    await client.execute(`INSERT INTO lists (id, customer_id, title) VALUES ('l${n}', 'cust', 't')`);
    await client.execute({
      sql: `INSERT INTO orders (id, list_id, customer_id, stage, rider_id, payment_rail, created_at, updated_at) VALUES (?, ?, 'cust', 'Fund', ?, 'escrow', datetime('now', '-${ageMin} minutes'), datetime('now', '-${ageMin} minutes'))`,
      args: [id, `l${n}`, rider],
    });
  };
  const pay = (orderId: string, status: string) =>
    client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES (?, ?, 'collection', 'mtn', 2500, 'UGX', ?)", args: [`p_${orderId}`, orderId, status] });

  await order("no_payment", "rider", 90);
  await order("failed_payment", "rider", 90); await pay("failed_payment", "failed");
  await order("paid_but_stuck", "rider", 90); await pay("paid_but_stuck", "successful");
  await order("no_payment_no_rider", null, 90);
  await order("recent", "rider", 5);
  await order("bundled", "rider", 90);
  await client.execute("UPDATE orders SET delivery_bundle_id = 'b1' WHERE id = 'bundled'");

  await t.test("does nothing at 0", async () => {
    await setSetting("stuck_funding_release_minutes", "0");
    assert.deepEqual(await sweepStuckFunding(), { released: 0, skipped: 0 });
    await setSetting("stuck_funding_release_minutes", "30");
  });

  await t.test("moves old stuck orders on and leaves the rest", async () => {
    assert.equal((await getMatchingSettings()).stuckFundingReleaseMinutes, 30);
    assert.deepEqual(await sweepStuckFunding(), { released: 4, skipped: 0 });
    const by = Object.fromEntries((await client.execute("SELECT id, stage, rider_id FROM orders")).rows.map((r) => [String(r.id), r]));
    assert.equal(by.no_payment.stage, "Match", "rider stays, customer can pay again");
    assert.equal(by.failed_payment.stage, "Match");
    assert.equal(by.paid_but_stuck.stage, "Shop", "a payment that did go through starts the job");
    assert.equal(by.no_payment_no_rider.stage, "Create");
    assert.equal(by.recent.stage, "Fund", "within the wait");
    assert.equal(by.bundled.stage, "Fund", "combined deliveries are left for a person");
  });

  await t.test("then the unpaid-assignment sweep frees the rider, and a second run changes nothing", async () => {
    assert.deepEqual(await sweepStuckFunding(), { released: 0, skipped: 0 });
    await client.execute("UPDATE orders SET updated_at = datetime('now', '-60 minutes') WHERE id IN ('no_payment', 'failed_payment')");
    const freed = await sweepUnpaidAssignments();
    assert.equal(freed.released, 2, "both unpaid orders lose their rider");
  });
});

test("a customer can cancel an order stuck at Funding, even with a payment still pending", async () => {
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'c', 'c', 'h', 'customer'), ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('rider', 1, 1)");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 't')");
  await client.execute("INSERT INTO orders (id, list_id, customer_id, stage, rider_id, payment_rail) VALUES ('o1', 'l1', 'cust', 'Fund', 'rider', 'escrow')");
  await client.execute("INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES ('p1', 'o1', 'collection', 'mtn', 2500, 'UGX', 'pending')");
  const { cancelCustomerOrder, getOrderTimeFees } = await import("./time-fees.js");
  const row = async () => (await client.execute("SELECT * FROM orders WHERE id = 'o1'")).rows[0] as Record<string, unknown>;

  assert.equal((await getOrderTimeFees(await row())).canCancel, false, "automatic expiry still leaves a payment in progress alone");
  assert.equal((await getOrderTimeFees(await row(), { customerInitiated: true })).canCancel, true);
  assert.deepEqual(await cancelCustomerOrder(await row(), "cust", 0, { customerInitiated: true }), { fee: 0 });
  const after = await row();
  assert.equal(after.stage, "Cancelled");
  assert.equal((await client.execute("SELECT status FROM payments WHERE id = 'p1'")).rows[0].status, "failed");
});
