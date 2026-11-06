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
  const income = (await incomeRes.json()) as { streams: { key: string; amount: number | null }[] };
  assert.ok(income.streams.length >= 20, "every income stream is listed");
  assert.equal(income.streams.find((s) => s.key === "channel_fees")?.amount, 1500);
  assert.equal(income.streams.find((s) => s.key === "digital_sales")?.amount, 0);
  assert.equal(income.streams.find((s) => s.key === "ride_boda")?.amount, null);
});
