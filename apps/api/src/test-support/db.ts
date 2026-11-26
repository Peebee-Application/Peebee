import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { signToken } from "../auth/jwt.js";
import { invalidateSettingsCache } from "../lib/settings.js";

/** A fresh in-memory database with every migration applied, bound as the API's D1. */
export async function freshDatabase(): Promise<Client> {
  process.env.JWT_SECRET = "peebee-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations"))
    ? join(process.cwd(), "apps/api/src/db/migrations")
    : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
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
  return client;
}

export async function addUser(client: Client, id: string, role = "customer", extra: { phone?: string } = {}): Promise<string> {
  await client.execute({
    sql: "INSERT INTO users (id, phone, name, password_hash, role, status) VALUES (?, ?, ?, 'hash', ?, 'active')",
    args: [id, extra.phone ?? `+2567${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, id, role],
  });
  if (role === "customer") {
    await client.execute({ sql: "INSERT INTO personal_wallets (user_id) VALUES (?)", args: [id] });
  }
  return signToken({ sub: id, role } as never);
}

/** An owner with a merchant, a store and (optionally) products, ready for merchant-route tests. */
export async function addMerchantStore(client: Client, userId: string, opts: { slug?: string; status?: string } = {}) {
  const token = await addUser(client, userId);
  const merchantId = `m_${userId}`;
  await client.execute({ sql: "INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES (?, ?, ?, 'business', 'active', 'sandbox')", args: [merchantId, userId, userId] });
  await client.execute({ sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", args: [merchantId, userId] });
  const call = (path: string, method = "GET", body?: object) =>
    app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const res = await call("/merchants/me/store", "POST", { name: opts.slug ?? userId, category: "stores" });
  const { store } = (await res.json()) as { store: { id: string; slug: string } };
  if (opts.status) await client.execute({ sql: "UPDATE stores SET status = ? WHERE id = ?", args: [opts.status, store.id] });
  return { token, merchantId, storeId: store.id, slug: store.slug, call };
}

export const anonymous = (path: string, method = "GET", body?: object, headers: Record<string, string> = {}) =>
  app.request(`/v1${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

export { app };

/** Allow the built-in demo catalogue to be ordered from (tests that shop the demo stores while the platform is live). */
export async function allowDemoCatalog(client: Client): Promise<void> {
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('marketplace_demo_catalog', 'always')");
  invalidateSettingsCache();
}

/** A signed-in staff member (super admin) and a caller bound to their token. */
export async function addAdmin(client: Client, id = "adm_test") {
  await client.execute({
    sql: "INSERT INTO users (id, phone, name, password_hash, role, status, admin_role) VALUES (?, ?, 'Staff', 'hash', 'admin', 'active', 'super_admin')",
    args: [id, `+2567${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`],
  });
  const token = await signToken({ sub: id, role: "admin" } as never);
  const call = (path: string, method = "GET", body?: object) =>
    app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const setOptions = async (values: Record<string, unknown>) => {
    const res = await call("/admin/option-settings", "PATCH", { values });
    if (res.status !== 200) throw new Error(`option change refused: ${JSON.stringify(await res.json())}`);
  };
  return { token, call, setOptions };
}
