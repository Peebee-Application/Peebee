import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setPlatformEnvironment } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { DEMO_ACCOUNTS, DEMO_WALLET_UGX } from "./demo.js";
import { resetWorkSchemaCache } from "./service.js";
import { setWorkSettings } from "./settings.js";

process.env.JWT_SECRET = "work-demo-test-only-secret";

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

type Json = Record<string, any>;

test("work demo: Entebbe sandbox accounts can run a laundry job from booking to payout", async () => {
  resetSchemaCache();
  resetWorkSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await setWorkSettings({ enabled: true, serviceTypes: ["clean", "laundry", "fix"], requireApproval: true, commissionPercent: 15, radiusKm: 15, minLeadMinutes: 30 });
  await client.execute("INSERT INTO users (id, phone, name, role, password_hash, admin_role) VALUES ('adm', '+256700000001', 'Admin', 'admin', 'x', 'super_admin')");
  const adminToken = await signToken({ sub: "adm", role: "admin" });
  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1/work${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };

  // Live platform: refused. Sandbox: installed.
  const refused = await call("/admin/demo/install", { token: adminToken, body: { password: "demopass123" } });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, "not_sandbox");
  await setPlatformEnvironment("sandbox");
  assert.equal((await call("/admin/demo/install", { token: adminToken, body: { password: "short" } })).status, 400);
  const installed = await call("/admin/demo/install", { token: adminToken, body: { password: "demopass123" } });
  assert.equal(installed.status, 200, JSON.stringify(installed.json));
  assert.equal(installed.json.count, DEMO_ACCOUNTS.length);
  assert.equal((await call("/admin/demo/install", { token: adminToken, body: { password: "demopass123" } })).status, 200, "installing again is harmless");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'wdemo_%'")).rows[0].n), DEMO_ACCOUNTS.length);

  // A real person's account is never overwritten.
  const customer = await signToken({ sub: "wdemo_customer", role: "customer" });
  const nearby = await call("/nearby?lat=0.0512&lng=32.4637", { token: customer });
  assert.ok(nearby.json.counts.laundry >= 1 && nearby.json.counts.clean >= 2 && nearby.json.counts.fix >= 1, JSON.stringify(nearby.json.counts));

  // Customer books laundry in Entebbe; the laundry company owner does it; money moves in the sandbox wallets.
  const booked = await call("/jobs", { token: customer, body: { serviceId: "wsv_laundry_wash_kg", quantity: 4, address: "Church Road, Entebbe", area: "Entebbe", lat: 0.0521, lng: 32.4642, details: "Collect from the gate" } });
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  assert.equal(booked.json.job.environment ?? "sandbox", "sandbox");
  const jobId = booked.json.job.id as string;
  const sandboxWallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance_sandbox AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
  assert.equal(await sandboxWallet("wdemo_customer"), DEMO_WALLET_UGX - 20000, "4 kg × 5,000 held from the sandbox wallet");

  const owner = await signToken({ sub: "wdemo_laundry", role: "customer" });
  const open = await call("/provider/jobs/open", { token: owner });
  assert.equal(open.json.jobs.length, 1);
  assert.equal((await call("/provider/jobs/open", { token: await signToken({ sub: "wdemo_fix", role: "customer" }) })).json.jobs.length, 0, "a fixer isn't offered laundry");
  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: owner, body: {} })).status, 200);
  assert.equal((await call(`/provider/jobs/${jobId}/start`, { token: owner, body: {} })).status, 200);
  assert.equal((await call(`/provider/jobs/${jobId}/complete`, { token: owner, body: {} })).status, 200);
  assert.equal((await call(`/jobs/${jobId}/confirm`, { token: customer, body: {} })).status, 200);
  const laundryEarnings = await client.execute("SELECT w.balance FROM provider_wallets w JOIN work_providers p ON p.id=w.provider_id WHERE w.provider_type='work' AND w.environment='sandbox' AND p.user_id='wdemo_laundry'");
  assert.equal(laundryEarnings.rows[0]?.balance, 17000, "20,000 less 15% commission");

  // Removing keeps accounts that have history, locked.
  const removed = await call("/admin/demo", { method: "DELETE", token: adminToken });
  assert.equal(removed.json.locked, DEMO_ACCOUNTS.length);
  const login = (await client.execute("SELECT status FROM users WHERE id = 'wdemo_laundry'")).rows[0];
  assert.equal(login.status, "suspended");
});
