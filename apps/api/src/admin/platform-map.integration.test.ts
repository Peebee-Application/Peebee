import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { platformMapRoutes } from "./platform-map.js";

test("Platform map lists every kind of person and income stream, reads real tables, and is admin-only", async () => {
  process.env.JWT_SECRET = "platform-map-tests-only";
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

  await client.execute("INSERT INTO users(id,name,password_hash,role,admin_role,email) VALUES('admin','Admin','h','admin','super_admin','a@example.test'),('c1','Alice','h','customer',NULL,'c1@example.test'),('c2','Bob','h','customer',NULL,'c2@example.test')");
  await client.execute("INSERT INTO ledger_accounts(id,owner_type,owner_id,purpose,environment) VALUES('la1','platform','platform','channel_fees','live')");
  await client.execute("INSERT INTO ledger_transactions(id,kind,idempotency_key,environment) VALUES('lt1','channel_sale','k1','live')");
  await client.execute("INSERT INTO ledger_entries(id,transaction_id,account_id,amount) VALUES('le1','lt1','la1',1500)");

  await client.execute("PRAGMA foreign_keys = OFF");
  await client.execute("INSERT INTO edu_fee_payments(id,invoice_id,payer_id,amount_ugx,commission_ugx,environment) VALUES('p1','i1','c1',10000,1000,'live'),('p2','i1','c1',5000,500,'sandbox')");
  const app = new Hono().route("/v1", platformMapRoutes);
  const admin = await signToken({ sub: "admin", role: "admin" });
  const customer = await signToken({ sub: "c1", role: "customer" });
  const get = (path: string, bearer: string) => app.request("/v1" + path, { headers: { Authorization: `Bearer ${bearer}` } });

  assert.equal((await get("/admin/platform/people", customer)).status, 403);

  const peopleRes = await get("/admin/platform/people", admin);
  assert.equal(peopleRes.status, 200);
  const people = (await peopleRes.json()) as { people: { key: string; total: number | null }[]; groups: { id: string }[] };
  assert.ok(people.people.length >= 25, "every kind of person is listed");
  assert.ok((people.people.find((p) => p.key === "customers")?.total ?? 0) >= 2);
  assert.ok((people.people.find((p) => p.key === "admins")?.total ?? 0) >= 1);
  // Every count must read a real column: a null here means a table or column name is wrong.
  const unreadable = people.people.filter((p) => p.total === null).map((p) => p.key);
  assert.deepEqual(unreadable, []);

  const incomeRes = await get("/admin/platform/income?range=all", admin);
  assert.equal(incomeRes.status, 200);
  const income = (await incomeRes.json()) as { streams: { key: string; amount: number | null; partial?: boolean }[] };
  // Streams read from their own tables: every table must be readable (a wrong column makes it "partial" or null).
  for (const key of ["ride_car", "taxipress", "learn_courses", "learn_fees", "learn_plans", "work", "talent", "rider_pro", "wallet_fees"]) {
    const stream = income.streams.find((x) => x.key === key);
    assert.ok(stream && typeof stream.amount === "number" && !stream.partial, `${key} should read every table it sums`);
  }
  assert.equal(income.streams.find((x) => x.key === "learn_fees")?.amount, 1000, "only the live environment's commission counts");
  assert.ok(income.streams.length >= 20, "every income stream is listed");
  assert.equal(income.streams.find((s) => s.key === "channel_fees")?.amount, 1500);
  assert.equal(income.streams.find((s) => s.key === "digital_sales")?.amount, 0);
  assert.equal(income.streams.find((s) => s.key === "ride_boda")?.amount, null);
});

test("Every kind with an approval step lists its people from real columns, and the new status endpoint changes only its own kinds", async () => {
  process.env.JWT_SECRET = "platform-map-tests-only";
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
  await client.execute("INSERT INTO users(id,name,password_hash,role,admin_role,email) VALUES('admin','Admin','h','admin','super_admin','a@example.test'),('viewer','Viewer','h','admin','finance_manager','v@example.test'),('emp','Employer Eve','h','customer',NULL,'e@example.test')");
  await client.execute("INSERT INTO talent_employers(user_id) VALUES('emp')");
  const app = new Hono().route("/v1", platformMapRoutes);
  const admin = await signToken({ sub: "admin", role: "admin" });
  const send = (method: string, path: string, body?: unknown, bearer = admin) =>
    app.request("/v1" + path, { method, headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  const keys = ["customers", "boda_riders", "car_owners", "car_drivers", "taxipress", "relay", "restaurants", "merchants", "work_providers", "workers", "service_businesses", "channels", "schools", "fuel_stations", "fuel_managers", "fuel_attendants", "employers", "sales_agents", "learners", "subscribers", "stage_members", "merchant_staff"];
  for (const key of keys) {
    const res = await send("GET", `/admin/platform/people/${key}/list?status=all&q=a`);
    assert.equal(res.status, 200, `${key} list should read real columns`);
    const body = (await res.json()) as { items: unknown[]; counts: Record<string, number> };
    assert.ok(Array.isArray(body.items), key);
  }
  assert.equal((await send("GET", "/admin/platform/people/guests/list")).status, 404);

  const emp = (await (await send("GET", "/admin/platform/people/employers/list")).json()) as { items: { id: string; status: string; name: string }[] };
  assert.equal(emp.items[0]?.status, "active");
  assert.equal(emp.items[0]?.name, "Employer Eve");

  // Changing status: validated, logged, reversible, and gated by the kind's own permission.
  assert.equal((await send("POST", "/admin/platform/people/employers/emp/status", { status: "bogus" })).status, 400);
  assert.equal((await send("POST", "/admin/platform/people/boda_riders/emp/status", { status: "suspended" })).status, 404);
  assert.equal((await send("POST", "/admin/platform/people/employers/emp/status", { status: "suspended" })).status, 200);
  assert.equal((await client.execute("SELECT status FROM talent_employers WHERE user_id='emp'")).rows[0]!.status, "suspended");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action='people.employers.suspended'")).rows[0]!.n), 1);
  assert.equal((await send("POST", "/admin/platform/people/employers/emp/status", { status: "active" })).status, 200);
  assert.equal((await client.execute("SELECT status FROM talent_employers WHERE user_id='emp'")).rows[0]!.status, "active");
  const viewer = await signToken({ sub: "viewer", role: "admin" });
  assert.equal((await send("POST", "/admin/platform/people/employers/emp/status", { status: "suspended" }, viewer)).status, 403);
  assert.equal((await send("POST", "/admin/platform/people/employers/missing/status", { status: "suspended" })).status, 404);
});
