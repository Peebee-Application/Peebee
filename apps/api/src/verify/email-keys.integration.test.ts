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
import { emailKeyRoutes } from "./email-key-routes.js";
import { emailProviderConfigured, sendResendEmail } from "./email-keys.js";
import { createAndSendOtp } from "./service.js";
import { sendStaffInviteEmail, sendVerificationEmail } from "./email.js";

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

test("email keys: admin access, encrypted storage, timed rotation and delivery safety", async (t) => {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const client = createClient({ url: "file::memory:" });
  resetSchemaCache();
  bindDatabase(client);
  process.env.JWT_SECRET = "email-keys-test-jwt";
  process.env.CREDENTIALS_ENCRYPTION_KEY = "email-keys-test-encryption";
  process.env.RESEND_API_KEY = "re_legacy_test_only_padding";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql") && !f.startsWith("0076")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES ('admin', 'admin', 'admin', 'h', 'admin', 'super_admin')");
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES ('viewer', 'viewer', 'viewer', 'h', 'admin', 'support_manager')");
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'cust', 'h', 'customer')");
  const app = new Hono().route("/v1", emailKeyRoutes);
  const tokens = { admin: await signToken({ sub: "admin", role: "admin" }), cust: await signToken({ sub: "cust", role: "customer" }), viewer: await signToken({ sub: "viewer", role: "admin" }) };
  const call = (method: string, path: string, body?: unknown, who: keyof typeof tokens = "admin") => app.request(`/v1/admin/email-keys${path}`, {
    method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (response: Response) => await response.json() as Record<string, any>;
  const used: Array<{ key: string; payload: Record<string, any>; idempotency: string | null }> = [];
  const behaviours: Record<string, () => Response | never> = {};
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const key = headers.get("authorization")!.replace("Bearer ", "");
    used.push({ key, payload: JSON.parse(String(init.body)), idempotency: headers.get("idempotency-key") });
    return behaviours[key]?.() ?? Response.json({ id: "sent" });
  }) as typeof fetch;
  const payload = { to: ["customer@example.com"], subject: "Test", html: "<p>Test</p>", text: "Test" };
  const K = (letter: string) => `re_${letter}_test_only_padding_padding`;
  let keys: any[] = [];
  const settings = { mode: "test", rotationSeconds: 60, windowRequests: 0, windowSeconds: 86400, quotaRetrySeconds: 3600 };
  try {
    await t.test("before migration existing emails work and writes are unavailable", async () => {
      assert.equal((await json(await call("GET", ""))).tableReady, false);
      assert.equal((await call("POST", "", { keys: [] })).status, 503);
      await sendVerificationEmail("customer@example.com", "123456");
      assert.equal(used.at(-1)?.key, process.env.RESEND_API_KEY);
      assert.equal(used.at(-1)?.payload.subject, "Your Tuma password reset code");
      for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations/0076_email_api_keys.sql"), "utf8"))) await client.execute(sql);
      resetSchemaCache();
    });
    await t.test("customers and admins without settings permission cannot manage keys", async () => {
      for (const who of ["cust", "viewer"] as const) {
        assert.equal((await call("GET", "", undefined, who)).status, 403);
        assert.equal((await call("PUT", "/settings", settings, who)).status, 403);
        assert.equal((await call("POST", "", { keys: [] }, who)).status, 403);
      }
    });
    await t.test("input validation, encryption, duplicate detection and masked responses", async () => {
      assert.equal((await call("POST", "", { keys: [{ label: "bad", key: "bad", accountTag: "x", fromAddress: "x" }] })).status, 400);
      assert.equal((await call("PUT", "/settings", { ...settings, rotationSeconds: 0 })).status, 400);
      const entries = ["a", "b", "live"].map((letter) => ({ label: letter, key: K(letter), accountTag: letter === "live" ? "production" : "same-team", fromAddress: "Peebee <hello@example.com>" }));
      const added = await json(await call("POST", "", { keys: entries }));
      assert.deepEqual(added.results.map((r: any) => r.status), ["added", "added", "added"]);
      keys = added.keys;
      const stored = await client.execute("SELECT key_encrypted FROM email_api_keys");
      assert.ok(stored.rows.every((r) => !String(r.key_encrypted).includes("re_")));
      assert.ok(!JSON.stringify(added).includes(K("a")));
      const logs = await client.execute("SELECT summary, before_json, after_json FROM admin_activity_log");
      assert.ok(!JSON.stringify(logs.rows).includes(K("a")));
      assert.equal((await json(await call("POST", "", { keys: [entries[0]] }))).results[0].status, "duplicate");
      assert.equal((await call("PUT", `/${keys[2].id}/live`)).status, 200);
      assert.equal((await call("PUT", "/missing/live")).status, 404);
      assert.equal((await json(await call("GET", ""))).keys.find((k: any) => k.isLive).id, keys[2].id);
      assert.equal((await call("PUT", "/settings", settings)).status, 200);
    });
    await t.test("testing holds a key within a time slot, switches on time and never uses live", async () => {
      const slot = Math.floor(realNow() / 120000) * 120000;
      Date.now = () => slot + 1000;
      used.length = 0;
      await sendResendEmail(payload);
      Date.now = () => slot + 59000;
      await sendResendEmail(payload);
      assert.deepEqual(used.map((u) => u.key), [K("a"), K("a")]);
      Date.now = () => slot + 61000;
      await sendResendEmail(payload);
      assert.equal(used.at(-1)?.key, K("b"));
      assert.ok(used.every((u) => u.key !== K("live")));
      Date.now = realNow;
    });
    await t.test("quota pauses the whole team without trying sibling keys or leaking provider text", async () => {
      behaviours[K("a")] = behaviours[K("b")] = () => Response.json({ name: "daily_quota_exceeded", message: `secret: ${K("a")}` }, { status: 429 });
      used.length = 0;
      await assert.rejects(() => sendResendEmail(payload), /No Resend keys available/);
      assert.equal(used.length, 1);
      const overview = await json(await call("GET", ""));
      assert.equal(overview.keys.filter((k: any) => !k.isLive && k.status === "cooling").length, 2);
      assert.ok(overview.keys[0].cooldownUntil.endsWith("T00:00:00.000Z"));
      assert.ok(!JSON.stringify(overview).includes(K("a")));
      delete behaviours[K("a")]; delete behaviours[K("b")];
      await client.execute("UPDATE email_api_usage SET cooldown_until = NULL, request_count = 0");
    });
    await t.test("atomic account budget bounds concurrent requests and resumes after the window", async () => {
      await call("PUT", "/settings", { ...settings, windowRequests: 1 });
      used.length = 0;
      const results = await Promise.allSettled([sendResendEmail(payload), sendResendEmail(payload), sendResendEmail(payload)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(used.length, 1);
      await client.execute("UPDATE email_api_usage SET window_start = 0");
      await sendResendEmail(payload);
      assert.equal(used.length, 2);
      await call("PUT", "/settings", settings);
    });
    await t.test("live uses only the selected key and guards removal/disable", async () => {
      await call("PUT", "/settings", { ...settings, mode: "live" });
      used.length = 0;
      await sendVerificationEmail("customer@example.com", "123456", "https://example.com/verify");
      await sendStaffInviteEmail("staff@example.com", "Staff", "Support", "temporary", "https://example.com/login");
      assert.deepEqual(used.map((u) => u.key), [K("live"), K("live")]);
      assert.ok(used.every((u) => u.idempotency));
      assert.equal(used[0].payload.from, "Peebee <hello@example.com>");
      assert.equal((await call("PATCH", `/${keys[2].id}`, { enabled: false })).status, 409);
      assert.equal((await call("DELETE", `/${keys[2].id}`)).status, 409);
      behaviours[K("live")] = () => Response.json({ name: "rate_limit_exceeded" }, { status: 429, headers: { "retry-after": "60" } });
      used.length = 0;
      await assert.rejects(() => sendResendEmail(payload), /Resend delivery failed/);
      assert.deepEqual(used.map((u) => u.key), [K("live")]);
      delete behaviours[K("live")];
    });
    await t.test("network failures are not replayed against another key", async () => {
      await call("PUT", "/settings", settings);
      behaviours[K("a")] = behaviours[K("b")] = () => { throw new Error("Network interrupted"); };
      used.length = 0;
      await assert.rejects(() => sendResendEmail(payload), /Network interrupted/);
      assert.equal(used.length, 1);
      delete behaviours[K("a")]; delete behaviours[K("b")];
    });
    await t.test("testing can use an independent account while the limited team honors Retry-After", async () => {
      const added = await json(await call("POST", "", { keys: [{ label: "independent", key: K("c"), accountTag: "independent-team", fromAddress: "other@example.com" }] }));
      const independent = added.keys.find((k: any) => k.label === "independent");
      behaviours[K("a")] = behaviours[K("b")] = () => Response.json({ name: "rate_limit_exceeded" }, { status: 429, headers: { "retry-after": "120" } });
      const slot = Math.floor(realNow() / 180000) * 180000;
      Date.now = () => slot + 1000;
      used.length = 0;
      try {
        await sendResendEmail(payload);
        assert.deepEqual(used.map((u) => u.key), [K("a"), K("c")]);
        assert.equal(used[0].idempotency, used[1].idempotency);
        assert.equal(used[1].payload.from, "other@example.com");
        const usage = (await client.execute("SELECT cooldown_until FROM email_api_usage WHERE account_tag = 'same-team'")).rows[0];
        assert.ok(Date.parse(String(usage.cooldown_until)) >= realNow() + 115000);
      } finally {
        Date.now = realNow;
        delete behaviours[K("a")]; delete behaviours[K("b")];
        await client.execute("UPDATE email_api_usage SET cooldown_until = NULL");
        await call("DELETE", `/${independent.id}`);
      }
    });
    await t.test("a bookkeeping failure after successful delivery does not send another email", async () => {
      const original = client.execute.bind(client);
      const mock = t.mock.method(client, "execute", async (statement: Parameters<Client["execute"]>[0]) => {
        if (typeof statement !== "string" && statement.sql.startsWith("UPDATE email_api_keys SET use_count")) throw new Error("Bookkeeping failed");
        return original(statement);
      });
      used.length = 0;
      try {
        await assert.rejects(() => sendResendEmail(payload), /Bookkeeping failed/);
        assert.equal(used.length, 1);
      } finally {
        mock.mock.restore();
      }
    });
    await t.test("disabled keys do not turn real OTP delivery into a dev-code response", async () => {
      delete process.env.RESEND_API_KEY;
      await client.execute("UPDATE email_api_keys SET enabled = 0");
      assert.equal(await emailProviderConfigured(), true);
      await assert.rejects(() => createAndSendOtp("cust", "email", "customer@example.com"), /No Resend keys available/);
    });
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
    for (const name of ["JWT_SECRET", "CREDENTIALS_ENCRYPTION_KEY", "RESEND_API_KEY"]) {
      if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
    }
    setD1Binding(undefined);
    resetSchemaCache();
    client.close();
  }
});
