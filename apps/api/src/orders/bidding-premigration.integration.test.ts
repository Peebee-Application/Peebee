import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache, hasColumn } from "../lib/schema.js";
import { setBiddingSettings, setMatchingModesEnabled } from "../lib/settings.js";
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

// Production receives new code before a hand-applied migration. Until 0064 lands,
// riders must still be able to apply and customers to choose — only bids are held back.
test("bidding code is safe on a database that hasn't had migration 0064 yet", async (t) => {
  process.env.JWT_SECRET = "local-bidding-premigration-secret";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql") && !f.startsWith("0064")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  assert.equal(await hasColumn("order_applications", "bid_amount"), false);

  for (const [id, role] of [["cust", "customer"], ["r1", "rider"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, role] });
  }
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('r1', 1, 1)");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'ride')");
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, type, is_ride, matching_mode, estimated_total, delivery_fee)
                        VALUES ('ride', 'l1', 'cust', 'parcel', 1, 'customer_selects', 6500, 6500)`);
  await setMatchingModesEnabled(["customer_selects"]);
  await setBiddingSettings({ enabled: true, minPercent: 50, maxPercent: 150 });

  const app = new Hono().route("/v1", orderRoutes);
  const cust = await signToken({ sub: "cust", role: "customer" });
  const rider = await signToken({ sub: "r1", role: "rider" });
  const call = (path: string, token: string, method: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  await t.test("a bid is politely refused, plain applying still works", async () => {
    const bid = await call("/orders/ride/apply", rider, "POST", { bidAmount: 5500 });
    assert.equal(bid.status, 409);
    assert.equal(((await bid.json()) as { error: string }).error, "bidding_unavailable");
    assert.equal((await call("/orders/ride/apply", rider, "POST", {})).status, 200);
  });

  await t.test("the customer can still see applicants and choose one", async () => {
    const list = await call("/orders/ride/applicants", cust, "GET");
    assert.equal(list.status, 200);
    const { applicants } = (await list.json()) as { applicants: { riderId: string; bidAmount: number | null; price: number }[] };
    assert.deepEqual(applicants.map((a) => [a.riderId, a.bidAmount, a.price]), [["r1", null, 6500]]);
    assert.equal((await call("/orders/ride/applicants/r1/select", cust, "POST", {})).status, 200);
    const row = (await client.execute("SELECT rider_id, estimated_total FROM orders WHERE id = 'ride'")).rows[0];
    assert.equal(row.rider_id, "r1");
    assert.equal(row.estimated_total, 6500);
  });

  await t.test("once the migration is applied the feature switches on", async () => {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, "0064_bidding.sql"), "utf8"))) await client.execute(sql);
    resetSchemaCache();
    assert.equal(await hasColumn("order_applications", "bid_amount"), true);
  });
});
