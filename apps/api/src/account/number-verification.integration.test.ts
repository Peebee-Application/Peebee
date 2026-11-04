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

test("same number, any formatting", () => {
  assert.ok(samePhone("0772345678", "+256772345678"));
  assert.ok(samePhone("256772345678", "0772 345 678"));
  assert.ok(!samePhone("0772345678", "0772345679"));
});

test("saved numbers are verified by an SMS code, and cash-outs can require it", async (t) => {
  process.env.JWT_SECRET = "local-number-verification-test-secret";
  process.env.ENVIRONMENT = "development"; // no SMS provider here: the code comes back as devCode
  delete process.env.AFRICASTALKING_USERNAME;
  delete process.env.AFRICASTALKING_API_KEY;
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('rider', 'r', 'r', 'h', 'rider'), ('other', 'o', 'o', 'h', 'customer')");
  const app = new Hono().route("/v1", mobileNumberRoutes);
  const as = async (sub: string, role: string) => ({ Authorization: `Bearer ${await signToken({ sub, role: role as "customer" | "rider" | "admin" })}`, "Content-Type": "application/json" });
  const call = async (sub: string, role: string, method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: await as(sub, role), body: body ? JSON.stringify(body) : undefined });
  const setRequired = (on: boolean) => client.execute({ sql: "INSERT INTO settings (key, value) VALUES ('withdrawal_numbers_require_verification', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [on ? "1" : "0"] });

  const created = await (await call("rider", "rider", "POST", "/mobile-numbers", { purpose: "withdrawal", phone: "0772345678" })).json() as { number: { id: string; verified: boolean } };
  const id = created.number.id;
  assert.equal(created.number.verified, false);

  await t.test("nothing is required while the admin switch is off", async () => {
    assert.equal(await withdrawalNumberBlocked("rider", "0772345678"), null);
  });

  await t.test("once required, an unverified number is refused, with a clear reason", async () => {
    await setRequired(true);
    const blocked = await withdrawalNumberBlocked("rider", "0772345678");
    assert.equal(blocked?.error, "number_not_verified");
    const unsaved = await withdrawalNumberBlocked("rider", "0701111111");
    assert.equal(unsaved?.error, "number_not_verified", "a number that was never saved is refused too");
  });

  let devCode = "";
  await t.test("a code is texted to the number; only the owner can ask for it", async () => {
    assert.equal((await call("other", "customer", "POST", `/mobile-numbers/${id}/verify/send`)).status, 404);
    const res = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/send`);
    assert.equal(res.status, 200);
    devCode = String(((await res.json()) as { devCode?: string }).devCode);
    assert.match(devCode, /^\d{6}$/);
    assert.equal((await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/send`)).status, 429, "one code a minute");
  });

  await t.test("a wrong code is refused and counted; five wrong guesses lock the code", async () => {
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) assert.equal((await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/confirm`, { code: wrong })).status, 400);
    const locked = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/confirm`, { code: devCode });
    assert.equal(locked.status, 429, "even the right code is refused once guessing is exhausted");
  });

  await t.test("the right code verifies the number, and then the cash-out is allowed", async () => {
    await client.execute("UPDATE number_verification_codes SET created_at = datetime('now', '-2 minutes')");
    const res = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/send`);
    const code = String(((await res.json()) as { devCode?: string }).devCode);
    const ok = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/confirm`, { code });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { number: { verified: boolean } }).number.verified, true);
    assert.equal(await withdrawalNumberBlocked("rider", "+256772345678"), null, "any formatting of the verified number passes");
    assert.equal((await withdrawalNumberBlocked("rider", "0772345679"))?.error, "number_not_verified");
    assert.equal((await withdrawalNumberBlocked("other", "0772345678"))?.error, "number_not_verified", "someone else's verification doesn't count");
  });

  await t.test("changing the digits clears the proof", async () => {
    const res = await call("rider", "rider", "PATCH", `/mobile-numbers/${id}`, { phone: "0782345678" });
    assert.equal(((await res.json()) as { number: { verified: boolean } }).number.verified, false);
    assert.equal((await withdrawalNumberBlocked("rider", "0782345678"))?.error, "number_not_verified");
  });

  await t.test("a code for the old digits cannot verify the new ones", async () => {
    await client.execute("UPDATE number_verification_codes SET created_at = datetime('now', '-2 minutes')");
    const send = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/send`);
    const code = String(((await send.json()) as { devCode?: string }).devCode);
    await call("rider", "rider", "PATCH", `/mobile-numbers/${id}`, { phone: "0752345678" });
    const res = await call("rider", "rider", "POST", `/mobile-numbers/${id}/verify/confirm`, { code });
    assert.equal(res.status, 410);
  });
});
