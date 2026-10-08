import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client } from "@libsql/client/node";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "./schema.js";
import { ensureAccountCode, ensureMerchantCode, ensureRiderCode } from "./profile-codes.js";

type Prepared = { sql: string; args: unknown[]; bind(...values: unknown[]): Prepared; all(): Promise<{ results: Record<string, unknown>[]; success: true; meta: { changes: number; last_row_id: number } }> };
function binding(client: Client): D1Database {
  const prepare = (sql: string): Prepared => {
    const statement: Prepared = {
      sql, args: [], bind(...values) { this.args = values; return this; },
      async all() {
        const result = await client.execute({ sql: this.sql, args: this.args as never });
        return { results: result.rows as unknown as Record<string, unknown>[], success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: unknown[]) {
      const results = await client.batch((statements as Prepared[]).map(({ sql, args }) => ({ sql, args: args as never })), "write");
      return results.map(result => ({ results: result.rows as unknown as Record<string, unknown>[], success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database;
}

test("profile codes backfill existing people and are assigned to new account, rider, and merchant records", async () => {
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src", "db", "migrations");
  const files = readdirSync(migrations).filter(file => file.endsWith(".sql")).sort();
  for (const file of files.filter(name => name !== "0081_profile_codes.sql")) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  await client.execute("INSERT INTO users (id,name,password_hash,role) VALUES ('legacy-user','Legacy User','h','customer'),('legacy-rider','Legacy Rider','h','rider')");
  await client.execute("INSERT INTO riders (user_id) VALUES ('legacy-rider')");
  await client.execute("INSERT INTO merchants (id,legal_name,display_name) VALUES ('legacy-merchant','Legacy Ltd','Legacy')");
  setD1Binding(binding(client));
  resetSchemaCache();
  try {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, "0081_profile_codes.sql"), "utf8"))) await client.execute(sql);
    assert.equal((await client.execute("SELECT account_code FROM users WHERE id='legacy-user'")).rows[0]?.account_code, "PB-LEGACYUSER");
    assert.equal((await client.execute("SELECT rider_code FROM riders WHERE user_id='legacy-rider'")).rows[0]?.rider_code, "RDR-LEGACYRIDER");
    assert.equal((await client.execute("SELECT merchant_code FROM merchants WHERE id='legacy-merchant'")).rows[0]?.merchant_code, "MER-LEGACYMERCHANT");

    await client.execute("INSERT INTO users (id,name,password_hash,role) VALUES ('new-account','New Account','h','customer'),('new-rider','New Rider','h','rider')");
    await ensureAccountCode("new-account");
    await client.execute("INSERT INTO riders (user_id) VALUES ('new-rider')");
    await ensureAccountCode("new-rider");
    await ensureRiderCode("new-rider");
    await client.execute("INSERT INTO merchants (id,legal_name,display_name) VALUES ('new-merchant','New Ltd','New')");
    await ensureMerchantCode("new-merchant");

    assert.equal((await client.execute("SELECT account_code FROM users WHERE id='new-account'")).rows[0]?.account_code, "PB-NEWACCOUNT");
    assert.equal((await client.execute("SELECT account_code FROM users WHERE id='new-rider'")).rows[0]?.account_code, "PB-NEWRIDER");
    assert.equal((await client.execute("SELECT rider_code FROM riders WHERE user_id='new-rider'")).rows[0]?.rider_code, "RDR-NEWRIDER");
    assert.equal((await client.execute("SELECT merchant_code FROM merchants WHERE id='new-merchant'")).rows[0]?.merchant_code, "MER-NEWMERCHANT");
  } finally {
    resetSchemaCache();
    setD1Binding(undefined);
    client.close();
  }
});
