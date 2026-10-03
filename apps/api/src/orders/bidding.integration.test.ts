import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
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

test("price bidding on rides", async (t) => {
  process.env.JWT_SECRET = "local-bidding-test-secret-only";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);

  for (const [id, role] of [["cust", "customer"], ["r1", "rider"], ["r2", "rider"], ["r3", "rider"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, role] });
  }
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('r1', 1, 1), ('r2', 1, 1), ('r3', 1, 1)");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('l1', 'cust', 'ride'), ('l2', 'cust', 'shop')");
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, type, is_ride, matching_mode, estimated_total, delivery_fee, time_fee_policy)
                        VALUES ('ride', 'l1', 'cust', 'parcel', 1, 'customer_selects', 6500, 6500, '{"cancellationFee":999}')`);
  await client.execute(`INSERT INTO orders (id, list_id, customer_id, type, is_ride, matching_mode, estimated_total, delivery_fee)
                        VALUES ('shop', 'l2', 'cust', 'shopping', 0, 'customer_selects', 20000, 2000)`);

  const app = new Hono().route("/v1", orderRoutes);
  const tokens = {
    cust: await signToken({ sub: "cust", role: "customer" }),
    r1: await signToken({ sub: "r1", role: "rider" }),
    r2: await signToken({ sub: "r2", role: "rider" }),
    r3: await signToken({ sub: "r3", role: "rider" }),
  };
  const call = (path: string, who: keyof typeof tokens, body?: unknown) =>
    app.request(`/v1${path}`, {
      method: body === undefined && path.includes("applicants") && !path.endsWith("select") ? "GET" : "POST",
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  await t.test("a bid is refused while bidding is off, but plain applying still works", async () => {
    await setMatchingModesEnabled(["customer_selects"]);
    assert.equal((await call("/orders/ride/apply", "r1", { bidAmount: 5500 })).status, 400);
    assert.equal((await call("/orders/ride/apply", "r1", {})).status, 200);
  });

  await t.test("bids are refused unless 'customer selects' (several applications) is an enabled mode", async () => {
    await setBiddingSettings({ enabled: true, minPercent: 50, maxPercent: 150 });
    await setMatchingModesEnabled(["first_to_claim"]);
    assert.equal((await call("/orders/ride/apply", "r2", { bidAmount: 5500 })).status, 400);
    await setMatchingModesEnabled(["customer_selects"]);
  });

  await t.test("bids must stay within the admin's limits and shopping orders never bid", async () => {
    assert.equal((await call("/orders/ride/apply", "r2", { bidAmount: 2500 })).status, 400, "below the 50% floor (UGX 3,000 after fare rounding)");
    assert.equal((await call("/orders/ride/apply", "r2", { bidAmount: 13098 })).status, 400, "above 150%");
    assert.equal((await call("/orders/shop/apply", "r2", { bidAmount: 15000 })).status, 400, "shopping can't bid");
    assert.equal((await call("/orders/ride/apply", "r2", { bidAmount: 5500 })).status, 200);
    assert.equal((await call("/orders/ride/apply", "r3", { bidAmount: 6500 })).status, 200, "naming the app price is just applying");
    assert.equal((await call("/orders/ride/apply", "r1", { bidAmount: 7000 })).status, 200, "a re-apply replaces the earlier (no) bid");
  });

  await t.test("the customer sees every bid beside the app price, best price first", async () => {
    const res = await call("/orders/ride/applicants", "cust");
    const { applicants } = (await res.json()) as { applicants: { riderId: string; price: number; bidAmount: number | null; appPrice: number }[] };
    assert.deepEqual(applicants.map((a) => [a.riderId, a.price]), [["r2", 5500], ["r3", 6500], ["r1", 7000]]);
    assert.equal(applicants[0].bidAmount, 5500);
    assert.equal(applicants[1].bidAmount, null);
    assert.ok(applicants.every((a) => a.appPrice === 6500));
  });

  await t.test("choosing a bid makes it the price, keeps the app price, and resets the fee policy", async () => {
    const res = await call("/orders/ride/applicants/r2/select", "cust", {});
    assert.equal(res.status, 200);
    const row = (await client.execute("SELECT rider_id, estimated_total, delivery_fee, app_price, time_fee_policy FROM orders WHERE id = 'ride'")).rows[0];
    assert.equal(row.rider_id, "r2");
    assert.equal(row.estimated_total, 5500);
    assert.equal(row.delivery_fee, 5500);
    assert.equal(row.app_price, 6500);
    assert.notEqual(row.time_fee_policy, '{"cancellationFee":999}');
    assert.ok(row.time_fee_policy);
    const note = (await client.execute("SELECT note FROM order_events WHERE order_id = 'ride' AND note LIKE 'Price agreed%'")).rows[0];
    assert.match(String(note.note), /5,500.*app price UGX 6,500/);
    const others = (await client.execute("SELECT rider_id, status FROM order_applications WHERE order_id = 'ride' ORDER BY rider_id")).rows;
    assert.deepEqual(others.map((r) => [r.rider_id, r.status]), [["r1", "declined"], ["r2", "selected"], ["r3", "declined"]]);
  });

  await t.test("picking an applicant who didn't bid leaves the app price alone", async () => {
    await client.execute(`INSERT INTO orders (id, list_id, customer_id, type, is_ride, matching_mode, estimated_total, delivery_fee)
                          VALUES ('ride2', 'l1', 'cust', 'parcel', 1, 'customer_selects', 8000, 8000)`);
    assert.equal((await call("/orders/ride2/apply", "r1", {})).status, 200);
    assert.equal((await call("/orders/ride2/applicants/r1/select", "cust", {})).status, 200);
    const row = (await client.execute("SELECT estimated_total, app_price FROM orders WHERE id = 'ride2'")).rows[0];
    assert.equal(row.estimated_total, 8000);
    assert.equal(row.app_price, null);
  });
});
