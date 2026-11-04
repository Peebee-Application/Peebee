import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, setPracticeD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { invalidateSettingsCache } from "../lib/settings.js";

export function shim(client: Client): D1Database {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database;
}

export async function freshDatabase(): Promise<Client> {
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "src/db/migrations")) ? join(process.cwd(), "src/db/migrations") : join(process.cwd(), "apps/api/src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  return client;
}

/** A platform that is live, with practice on offer and a few real people, and helpers to act as anyone. */
export async function practiceHarness() {
  process.env.JWT_SECRET = "local-practice-world-test-secret-only";
  resetSchemaCache();
  const db = await freshDatabase();
  setD1Binding(shim(db));
  // PRACTICE_SEPARATE_DB=1 runs these flows with the practice world in its own database, as in production.
  const practiceDb = process.env.PRACTICE_SEPARATE_DB === "1" ? await freshDatabase() : null;
  setPracticeD1Binding(practiceDb ? shim(practiceDb) : undefined);
  await db.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES ('real_rider', '0771', 'Real Rider', 'h', 'rider'), ('real_cust', '0772', 'Real Customer', 'h', 'customer'), ('real_admin', '0773', 'Real Admin', 'h', 'admin')", args: [] });
  await db.execute({ sql: "UPDATE users SET admin_role = 'super_admin' WHERE id = 'real_admin'", args: [] });
  await db.execute({ sql: "INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('real_rider', 1, 1, 0.0612, 32.4637)", args: [] });
  await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('user_practice_mode_enabled', '1') ON CONFLICT(key) DO UPDATE SET value='1'", args: [] });
  await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('practice_shared_world', '1') ON CONFLICT(key) DO UPDATE SET value='1'", args: [] });
  invalidateSettingsCache();
  const tokens = {
    rider: await signToken({ sub: "real_rider", role: "rider" }),
    customer: await signToken({ sub: "real_cust", role: "customer" }),
    admin: await signToken({ sub: "real_admin", role: "admin" }),
  };
  const call = (token: string, path: string, init: RequestInit = {}) => app.request(`/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const json = async <T = Record<string, any>>(res: Response) => (await res.json()) as T;
  const post = (token: string, path: string, body: unknown = {}) => call(token, path, { method: "POST", body: JSON.stringify(body) });
  const start = async (role: string, as: "customer" | "rider" = "customer") => json<{ token: string; user: { id: string } }>(await post(tokens[as], "/practice/session", { role }));
  // With a separate practice database the tests look at the demo world through it; `mainDb` is the platform's own.
  return { db: practiceDb ?? db, mainDb: db, tokens, call, json, post, start };
}
