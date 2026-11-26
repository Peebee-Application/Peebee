import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";

process.env.JWT_SECRET ??= "channels-test-only-secret";
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "channels-test-encryption-key";

import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { invalidateSettingsCache, setSetting } from "../lib/settings.js";
import { setR2Binding, type R2Bucket } from "../storage/r2.js";

export type Json = Record<string, any>;

function bindDatabase(client: Client) {
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
}

/** An in-memory stand-in for the R2 bucket. */
function memoryBucket(): R2Bucket & { store: Map<string, { data: Uint8Array; type?: string }> } {
  const store = new Map<string, { data: Uint8Array; type?: string }>();
  return {
    store,
    async put(key, value, options) {
      const data = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array((value as ArrayBufferView).buffer as ArrayBuffer);
      store.set(key, { data, type: options?.httpMetadata?.contentType });
      return undefined;
    },
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return { body: new Response(hit.data as BodyInit).body!, httpMetadata: { contentType: hit.type }, size: hit.data.length };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

export async function setup(opts: { migrate?: boolean; sandbox?: boolean } = {}) {
  resetSchemaCache();
  invalidateSettingsCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (opts.migrate === false && /^(0135|0136|0142|0144|0176)_/.test(file)) continue;
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const bucket = memoryBucket();
  setR2Binding(bucket);
  // Sandbox keeps every payment on the simulated rails.
  await setSetting("platform_environment", opts.sandbox === false ? "live" : "sandbox");
  invalidateSettingsCache();

  let n = 0;
  const mkUser = async (id: string, role: "customer" | "admin" | "rider" = "customer", name = `User ${id}`) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, admin_role) VALUES (?, ?, ?, ?, 'x', ?)",
      args: [id, `+25677100${String(n).padStart(4, "0")}`, name, role, role === "admin" ? "super_admin" : null],
    });
    return signToken({ sub: id, role });
  };
  const fund = async (id: string, amount: number) => {
    await client.execute({ sql: "INSERT OR IGNORE INTO personal_wallets (user_id) VALUES (?)", args: [id] });
    await client.execute({ sql: "UPDATE users SET wallet_balance_sandbox = wallet_balance_sandbox + ?, wallet_balance = wallet_balance + ? WHERE id = ?", args: [amount, amount, id] });
  };
  const wallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance_sandbox AS b FROM users WHERE id = ?", args: [id] })).rows[0]!.b);
  const call = async (path: string, o: { method?: string; token?: string; body?: unknown; form?: FormData } = {}) => {
    const headers: Record<string, string> = o.token ? { Authorization: `Bearer ${o.token}` } : {};
    if (!o.form) headers["Content-Type"] = "application/json";
    const res = await app.request(`/v1${path}`, {
      // Action endpoints (like, subscribe, unlock...) are POSTs even without a body.
      method: o.method ?? (o.body !== undefined || o.form || /\/(like|subscribe|unlock|submit|close|refresh)$/.test(path) ? "POST" : "GET"),
      headers,
      body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    });
    const text = await res.text();
    let json: Json = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  /** Turns things on as an admin would. */
  const configure = async (adminToken: string, patch: Json) => {
    const r = await call("/admin/channels/config", { method: "PUT", token: adminToken, body: patch });
    if (r.status !== 200) throw new Error(`config failed: ${r.text}`);
  };
  const picture = (name = "pic.png") => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" }));
    return form;
  };
  return { client, call, mkUser, fund, wallet, configure, picture, bucket };
}

/** Sets a post's video up as a ready, locked asset owned by someone (the video layer is tested elsewhere). */
export async function addVideo(client: Client, ownerId: string, opts: { protectedVideo?: boolean; duration?: number } = {}) {
  const id = `vid_${Math.random().toString(36).slice(2, 12)}`;
  await client.execute({
    sql: `INSERT INTO video_assets (id, owner_id, provider, source, external_id, status, duration_seconds, visibility, environment)
          VALUES (?, ?, 'mock', 'platform', ?, 'ready', ?, ?, 'sandbox')`,
    args: [id, ownerId, `mock_1_${id}`, opts.duration ?? 120, opts.protectedVideo ? "protected" : "public"],
  });
  return id;
}
