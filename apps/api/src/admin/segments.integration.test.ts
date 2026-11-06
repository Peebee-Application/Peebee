import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { segmentRoutes } from "./segments.js";

test("Segments cover every audience, read only real columns, count what each kind did, and are admin-only", async () => {
  process.env.JWT_SECRET = "segments-tests-only";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort())
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected } };
    },
  });
  setD1Binding({ prepare } as unknown as D1Database);
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.execute("INSERT INTO users(id,name,password_hash,role,admin_role,email) VALUES('admin','Admin','h','admin','super_admin','a@example.test'),('c1','Shopper','h','customer',NULL,'c1@example.test'),('c2','Diner','h','customer',NULL,'c2@example.test')");
  // c1 shops on the marketplace; c2 orders food. One old order is outside the 30 days.
  await client.execute("INSERT INTO orders(id,list_id,customer_id,store_id,type,environment) VALUES('o1','l','c1','s1','shopping','live')");
  await client.execute("INSERT INTO orders(id,list_id,customer_id,restaurant_id,type,environment) VALUES('o2','l','c2','r1','shopping','live')");
  await client.execute("INSERT INTO orders(id,list_id,customer_id,store_id,type,environment,created_at) VALUES('o3','l','c2','s1','shopping','live','2020-01-01 00:00:00')");

  const app = new Hono().route("/v1", segmentRoutes);
  const admin = await signToken({ sub: "admin", role: "admin" });
  const customer = await signToken({ sub: "c1", role: "customer" });
  const get = (bearer: string) => app.request("/v1/admin/platform/segments", { headers: { Authorization: `Bearer ${bearer}` } });

  assert.equal((await get(customer)).status, 403);
  const res = await get(admin);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { groups: { id: string }[]; segments: { key: string; group: string; total: number | null; active: number | null; failed: boolean; notReady: boolean }[] };
  assert.deepEqual(body.groups.map((g) => g.id), ["customers", "learn", "creators", "merchants", "riders", "hive"]);
  assert.ok(body.segments.length >= 38, "every audience and merchant/school kind is a segment");
  // A wrong column or table name makes a figure fail; none may.
  assert.deepEqual(body.segments.filter((s) => s.failed).map((s) => s.key), []);
  assert.deepEqual(body.segments.filter((s) => s.notReady).map((s) => s.key), []);
  const by = (k: string) => body.segments.find((s) => s.key === k)!;
  assert.equal(by("shoppers").total, 2, "two people have bought from a store");
  assert.equal(by("shoppers").active, 1, "only one did in the last 30 days");
  assert.equal(by("food_customers").total, 1);
  assert.equal(by("food_customers").active, 1);
  assert.ok((by("customers").total ?? 0) >= 2);
});
