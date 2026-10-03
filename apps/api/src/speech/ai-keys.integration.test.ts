import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { classifyFailure, cooldownFor, nextPacificMidnight } from "./ai-keys.js";
import { aiKeyRoutes } from "./ai-keys-routes.js";
import { translateToLuganda } from "./gemini.js";

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

const dayBody = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });
const minuteBody = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] } });

test("reading Google's answers and working out when a key comes back", () => {
  assert.equal(classifyFailure(429, dayBody), "quota_day");
  assert.equal(classifyFailure(429, minuteBody), "quota_minute");
  assert.equal(classifyFailure(429, "{}"), "quota_unknown");
  assert.equal(classifyFailure(400, "API key not valid. Please pass a valid API key."), "invalid_key");
  assert.equal(classifyFailure(503, "overloaded"), "other");

  // 20:00 UTC on a summer day is 13:00 Pacific: the reset is 07:00 UTC next day.
  assert.equal(nextPacificMidnight(new Date("2026-07-10T20:00:00Z")).toISOString(), "2026-07-11T07:00:00.000Z");
  // In winter Pacific is UTC-8.
  assert.equal(nextPacificMidnight(new Date("2026-01-10T20:00:00Z")).toISOString(), "2026-01-11T08:00:00.000Z");
  const now = new Date("2026-07-10T20:00:00Z");
  assert.equal(cooldownFor("quota_minute", now)?.until.getTime(), now.getTime() + 90_000);
  assert.equal(cooldownFor("other", now), null);
});

test("google ai keys: add, rotate on quota, master + paid mode", async (t) => {
  process.env.JWT_SECRET = "local-ai-keys-test-secret-only";
  process.env.CREDENTIALS_ENCRYPTION_KEY = "local-ai-keys-test-encryption";
  delete process.env.GEMINI_API_KEY;
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES ('admin', 'admin', 'admin', 'h', 'admin', 'super_admin')");
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'cust', 'h', 'customer')");
  const app = new Hono().route("/v1", aiKeyRoutes);
  const tokens = { admin: await signToken({ sub: "admin", role: "admin" }), cust: await signToken({ sub: "cust", role: "customer" }) };
  const call = (method: string, path: string, who: "admin" | "cust", body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  // Fake Google: every key is "good" for the ping; generation answers per key.
  const behaviour: Record<string, { status: number; body?: string }> = {};
  const used: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get("x-goog-api-key") ?? "";
    if (String(url).includes("/models?pageSize=1")) return key.startsWith("BAD") ? new Response("API key not valid", { status: 400 }) : new Response("{}", { status: 200 });
    used.push(key);
    const b = behaviour[key] ?? { status: 200 };
    return b.status === 200 ? Response.json({ candidates: [{ content: { parts: [{ text: `ok:${key}` }] } }] }) : new Response(b.body ?? "", { status: b.status });
  }) as typeof fetch;
  const K = (n: string) => `AIzaSy-test-key-${n}-padding-padding`;

  try {
    await t.test("only admins can see or change keys", async () => {
      assert.equal((await call("GET", "/admin/ai-keys", "cust")).status, 403);
      assert.equal((await call("POST", "/admin/ai-keys", "cust", { keys: [{ key: K("a") }] })).status, 403);
    });

    await t.test("with no saved keys the secret is used, as before", async () => {
      await assert.rejects(() => translateToLuganda("milk"), /No Google AI key is set/);
      process.env.GEMINI_API_KEY = "ENV-SECRET-KEY-padding-padding";
      assert.equal(await translateToLuganda("milk"), "ok:ENV-SECRET-KEY-padding-padding");
      delete process.env.GEMINI_API_KEY;
      used.length = 0;
    });

    await t.test("many keys can be added at once; bad and repeated ones are refused; secrets never come back", async () => {
      const res = await call("POST", "/admin/ai-keys", "admin", { keys: [{ label: "A", key: K("a") }, { label: "B", key: K("b") }, { label: "C", key: K("c") }, { key: "BAD-key-padding-padding-padding" }, { key: K("a") }, { key: "short" }] });
      assert.equal(res.status, 201);
      const body = await json(res);
      assert.deepEqual(body.results.map((r: any) => r.status), ["added", "added", "added", "rejected", "duplicate", "rejected"]);
      assert.equal(body.keys.length, 3);
      assert.ok(!JSON.stringify(body).includes("AIzaSy"), "no secret in the response");
      assert.equal(body.keys[0].hint, "…ding");
      const stored = (await client.execute("SELECT key_encrypted FROM ai_api_keys")).rows.map((r) => String(r.key_encrypted));
      assert.ok(stored.every((s) => !s.includes("AIzaSy")), "encrypted at rest");
    });

    await t.test("test mode rotates when a key hits its daily limit, and sets it aside", async () => {
      behaviour[K("a")] = { status: 429, body: dayBody };
      used.length = 0;
      const out = await translateToLuganda("milk");
      assert.ok(out.startsWith("ok:"));
      assert.equal(used[0], K("a"), "oldest-unused tried first");
      assert.notEqual(used[used.length - 1], K("a"));
      const keys = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys;
      const a = keys.find((k: any) => k.label === "A");
      assert.equal(a.status, "cooling");
      assert.match(a.cooldownReason, /Daily limit/);
      used.length = 0;
      await translateToLuganda("rice");
      assert.ok(!used.includes(K("a")), "a cooling key isn't tried again");
    });

    await t.test("when every key is at its limit it says so, and a reset brings one back", async () => {
      behaviour[K("b")] = { status: 429, body: minuteBody };
      behaviour[K("c")] = { status: 429, body: minuteBody };
      await assert.rejects(() => translateToLuganda("beans"), /limit/i);
      const keys = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys;
      assert.ok(keys.every((k: any) => k.status === "cooling"));
      behaviour[K("a")] = { status: 200 };
      const a = keys.find((k: any) => k.label === "A");
      await call("POST", `/admin/ai-keys/${a.id}/reset`, "admin");
      assert.equal(await translateToLuganda("beans"), `ok:${K("a")}`);
    });

    await t.test("a busy Google (not a quota error) doesn't burn through the keys", async () => {
      for (const k of ["a", "b", "c"]) behaviour[K(k)] = { status: 503, body: "overloaded" };
      await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "test" });
      const before = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys;
      await client.execute("UPDATE ai_api_keys SET cooldown_until = NULL, cooldown_reason = NULL");
      await assert.rejects(() => translateToLuganda("x"), /503/);
      const after = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys;
      assert.ok(after.every((k: any) => k.status === "ready"), "none set aside");
      assert.equal(before.length, after.length);
      for (const k of ["a", "b", "c"]) behaviour[K(k)] = { status: 200 };
    });

    let masterId = "";
    await t.test("paid mode needs a master key; the master is kept out of test rotation", async () => {
      assert.equal((await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "paid" })).status, 409, "no master yet");
      await call("POST", "/admin/ai-keys", "admin", { keys: [{ label: "Paid", key: K("paid") }] });
      masterId = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys.find((k: any) => k.label === "Paid").id;
      assert.equal((await call("PUT", `/admin/ai-keys/${masterId}/master`, "admin")).status, 200);
      used.length = 0;
      for (let i = 0; i < 6; i++) await translateToLuganda("t" + i);
      assert.ok(!used.includes(K("paid")), "test mode never spends the master key");
    });

    await t.test("paid mode uses only the master key and doesn't rotate", async () => {
      assert.equal((await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "paid" })).status, 200);
      used.length = 0;
      await translateToLuganda("milk");
      assert.deepEqual(used, [K("paid")]);
      behaviour[K("paid")] = { status: 429, body: dayBody };
      used.length = 0;
      await assert.rejects(() => translateToLuganda("milk"), /429/);
      assert.deepEqual(used, [K("paid")], "no fallback to test keys");
      behaviour[K("paid")] = { status: 200 };
      await call("POST", `/admin/ai-keys/${masterId}/reset`, "admin");
    });

    await t.test("the master key can't be removed or disabled while paid mode is on", async () => {
      assert.equal((await call("DELETE", `/admin/ai-keys/${masterId}`, "admin")).status, 409);
      assert.equal((await call("PATCH", `/admin/ai-keys/${masterId}`, "admin", { enabled: false })).status, 409);
      assert.equal((await call("DELETE", `/admin/ai-keys/${masterId}/master`, "admin")).status, 409);
      assert.equal((await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "test" })).status, 200);
      assert.equal((await call("DELETE", `/admin/ai-keys/${masterId}`, "admin")).status, 200);
    });

    await t.test("changes are written to the activity log without secrets", async () => {
      const log = (await client.execute("SELECT action, summary FROM admin_activity_log WHERE action LIKE 'ai_keys.%'")).rows;
      assert.ok(log.some((r) => r.action === "ai_keys.add"));
      assert.ok(log.some((r) => r.action === "ai_keys.mode"));
      assert.ok(log.every((r) => !String(r.summary).includes("AIzaSy")));
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
