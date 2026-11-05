import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { mobileNumberRoutes } from "./mobile-numbers.js";
import { samePhone, withdrawalNumberBlocked } from "./number-verification.js";

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

test("before migration 0155 is applied nothing breaks and nothing is blocked", async () => {
  process.env.JWT_SECRET = "local-number-verification-test-secret";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql") && !f.startsWith("0155_")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('rider', 'r', 'r', 'h', 'rider')");
  await client.execute("INSERT INTO settings (key, value) VALUES ('withdrawal_numbers_require_verification', '1')");
  const app = new Hono().route("/v1", mobileNumberRoutes);
  const headers = { Authorization: `Bearer ${await signToken({ sub: "rider", role: "rider" })}`, "Content-Type": "application/json" };

  // Saving, listing and editing numbers still work without the new column.
  const created = await app.request("/v1/mobile-numbers", { method: "POST", headers, body: JSON.stringify({ purpose: "withdrawal", phone: "0772345678" }) });
  assert.equal(created.status, 201);
  const id = ((await created.json()) as { number: { id: string } }).number.id;
  const edited = await app.request(`/v1/mobile-numbers/${id}`, { method: "PATCH", headers, body: JSON.stringify({ phone: "0782345678" }) });
  assert.equal(edited.status, 200);
  assert.equal((await app.request("/v1/mobile-numbers?purpose=withdrawal", { headers })).status, 200);

  // The cash-out rule stays off even though the setting says on; verification endpoints say why.
  assert.equal(await withdrawalNumberBlocked("rider", "0782345678"), null);
  const send = await app.request(`/v1/mobile-numbers/${id}/verify/send`, { method: "POST", headers });
  assert.equal(send.status, 503);
  assert.equal(((await send.json()) as { error: string }).error, "migration_pending");
});
