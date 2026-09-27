import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { assignAvailableRider } from "./assignment.js";
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

test("applicant profiles and assignment lifecycle", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-applicant-test-secret-only";
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    for (const [id, role] of [["customer", "customer"], ["other", "customer"], ["rider", "rider"], ["second", "rider"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO riders (user_id, verified, is_online, created_at) VALUES ('rider', 1, 1, '2024-01-01 00:00:00'), ('second', 1, 1, '2024-01-01 00:00:00')");
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'List')");
    for (const id of ["a", "b", "c", "sandbox"]) {
      await client.execute({
        sql: "INSERT INTO orders (id, list_id, customer_id, environment, matching_mode) VALUES (?, 'list', 'customer', ?, 'customer_selects')",
        args: [id, id === "sandbox" ? "sandbox" : "live"],
      });
      await client.execute({ sql: "INSERT INTO order_applications (id, order_id, rider_id) VALUES (?, ?, 'rider')", args: [id, id] });
    }
    await client.execute("INSERT INTO order_applications (id, order_id, rider_id) VALUES ('b-second', 'b', 'second')");
    const app = new Hono().route("/v1", orderRoutes);
    const token = await signToken({ sub: "customer", role: "customer" });
    const request = (path: string, method = "GET", auth = token) => app.request(`/v1/orders/${path}`, { method, headers: { Authorization: `Bearer ${auth}` } });

    await t.test("selecting B removes the rider from A and C, without affecting sandbox applications", async () => {
      assert.equal((await request("b/applicants/rider/select", "POST")).status, 200);
      const statuses = await client.execute("SELECT id, status FROM order_applications ORDER BY id");
      assert.deepEqual(statuses.rows.map(({ id, status }) => [id, status]), [["a", "declined"], ["b", "selected"], ["b-second", "declined"], ["c", "declined"], ["sandbox", "pending"]]);
      assert.deepEqual((await (await request("a/applicants")).json()).applicants, []);
      // Simulate a stale pending row from an older release: busy riders must still be hidden and unselectable.
      await client.execute("UPDATE order_applications SET status = 'pending' WHERE id = 'a'");
      assert.deepEqual((await (await request("a/applicants")).json()).applicants, []);
      assert.equal((await request("a/applicants/rider/select", "POST")).status, 409);
      const riderToken = await signToken({ sub: "rider", role: "rider" });
      assert.equal((await request("a/apply", "POST", riderToken)).status, 409);
      assert.equal(await assignAvailableRider("c", "rider", "Match", false, "live"), false);
    });

    await t.test("competing assignments reserve the rider only once and completed work releases them", async () => {
      await client.execute("UPDATE orders SET stage = 'Settle' WHERE id = 'b'");
      const results = await Promise.all([
        assignAvailableRider("a", "rider", "Match", false, "live"),
        assignAvailableRider("c", "rider", "Match", false, "live"),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM orders WHERE rider_id = 'rider' AND stage = 'Match'")).rows[0].n), 1);
      await client.execute("UPDATE orders SET stage = 'Cancelled' WHERE rider_id = 'rider' AND stage = 'Match'");
      const remaining = results[0] ? "c" : "a";
      assert.equal(await assignAvailableRider(remaining, "rider", "Match", false, "live"), true);
      await client.execute("UPDATE orders SET stage = 'Cancelled' WHERE stage = 'Match'");
    });

    await t.test("profiles count completed categories, paginate every review, and enforce customer access", async () => {
      // Restaurant IDs are nullable references; use a real restaurant for food history.
      await client.execute("INSERT INTO restaurants (id, name, owner_id) VALUES ('restaurant', 'Cafe', 'other')");
      for (let i = 0; i < 25; i++) {
        await client.execute({
          sql: `INSERT INTO orders (id, list_id, customer_id, rider_id, stage, type, is_ride, restaurant_id, environment)
                VALUES (?, 'list', 'customer', 'rider', 'Settle', ?, ?, ?, 'live')`,
          args: [`history-${i}`, i < 2 ? "parcel" : "shopping", i === 0 ? 1 : 0, i === 2 ? "restaurant" : null],
        });
        await client.execute({
          sql: "INSERT INTO order_ratings (id, order_id, rider_id, customer_id, rating, comment, recommended) VALUES (?, ?, 'rider', 'customer', 5, ?, 1)",
          args: [`review-${i.toString().padStart(2, "0")}`, `history-${i}`, i === 0 ? "   " : `Review ${i}`],
        });
      }
      await client.execute("INSERT INTO orders (id, list_id, customer_id, rider_id, stage, environment) VALUES ('practice', 'list', 'customer', 'rider', 'Settle', 'sandbox')");
      await client.execute("INSERT INTO order_ratings (id, order_id, rider_id, customer_id, rating, comment) VALUES ('practice', 'practice', 'rider', 'customer', 1, 'Practice review')");
      const response = await request("b/applicants/rider/profile");
      assert.equal(response.status, 200);
      const profile = await response.json();
      assert.deepEqual(profile.completed, { total: 26, rides: 1, parcels: 1, food: 1, shopping: 23 });
      assert.equal(profile.joinedAt, "2024-01-01 00:00:00");
      assert.equal(profile.reviews.length, 20);
      assert.equal(profile.nextOffset, 20);
      const second = await (await request("b/applicants/rider/profile?offset=20")).json();
      assert.equal(second.reviews.length, 5);
      assert.equal(second.nextOffset, null);
      assert.equal(new Set([...profile.reviews, ...second.reviews].map((review) => review.id)).size, 25);
      assert.equal((await request("b/applicants/rider/profile?offset=-1")).status, 400);
      assert.equal((await request("b/applicants/rider/profile", "GET", await signToken({ sub: "other", role: "customer" }))).status, 403);
      assert.equal((await request("c/applicants/second/profile")).status, 404);
      await client.execute("UPDATE orders SET rider_id = NULL, stage = 'Create' WHERE id = 'a'");
      await client.execute("UPDATE order_applications SET status = 'pending' WHERE id = 'a'");
      const list = await (await request("a/applicants")).json();
      assert.equal(list.applicants[0].commentCount, 24);
      assert.equal(list.applicants[0].reviewCount, 25);
      assert.equal(list.applicants[0].recommendCount, 25);
      assert.equal(list.applicants[0].avgRating, 5);
    });
  } finally {
    setD1Binding(undefined);
    client.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
