import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { DEFAULT_HOME_TEMPLATES, resolveHomeTemplates, type HomeTemplatesSettings } from "@peebee/shared";
import { homeTemplatesSchema, getHomeTemplatesSettings } from "./home-templates.js";
import { settingsRoutes } from "./routes.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";
import { revertActivity } from "../admin/activity.js";

test("template schema rejects unknown IDs, duplicate entries, reversed intervals and ineligible priorities", () => {
  assert.equal(homeTemplatesSchema.safeParse(DEFAULT_HOME_TEMPLATES).success, true);
  for (const patch of [
    { templates: [] }, { templates: ["04", "04"] }, { templates: ["01"] }, { eligibleShortcuts: [] },
    { preferredShortcuts: ["boda", "boda"] }, { eligibleShortcuts: ["parcel"], preferredShortcuts: ["boda"] },
    { minIntervalSeconds: 120, maxIntervalSeconds: 30 }, { minIntervalSeconds: 0 },
    { preferredWeight: 0 }, { shortcutCount: 7 }, { interactionPauseSeconds: 0 },
    { exploreTypeMs: 0 }, { exploreTypeMs: 301 }, { exploreHoldSeconds: 1 }, { exploreHoldSeconds: 31 },
  ]) assert.equal(homeTemplatesSchema.safeParse({ ...DEFAULT_HOME_TEMPLATES, ...patch }).success, false, JSON.stringify(patch));
});

test("older home settings keep their selections and acquire Explore timing defaults", () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_HOME_TEMPLATES, templates: ["07"], minIntervalSeconds: 240, maxIntervalSeconds: 240 };
  delete legacy.exploreTypeMs;
  delete legacy.exploreHoldSeconds;
  const expected = { ...legacy, exploreTypeMs: 65, exploreHoldSeconds: 5 };
  assert.deepEqual(resolveHomeTemplates(legacy), expected);
  assert.deepEqual(homeTemplatesSchema.parse(legacy), expected);
  const custom = { ...expected, exploreTypeMs: 90, exploreHoldSeconds: 8 };
  assert.deepEqual(resolveHomeTemplates(homeTemplatesSchema.parse(custom)), custom);
});

test("settings persist in existing settings table, require permission, reach customers and record before/after", async () => {
  process.env.JWT_SECRET = "local-home-template-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const r = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }; },
  });
  try {
    for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
      for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
    }
    setD1Binding({ prepare, async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((r) => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
    } } as unknown as D1Database);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role,admin_role) VALUES ('ht-admin','ht-admin','Admin','h','admin','super_admin'),('ht-customer','ht-customer','Sarah','h','customer',NULL),('ht-support','ht-support','Support','h','admin','support_manager')");
    const app = new Hono().route("/v1", settingsRoutes);
    const token = async (id: string, role: "admin" | "customer") => signToken({ sub: id, role });
    const admin = await token("ht-admin", "admin"); const customer = await token("ht-customer", "customer"); const support = await token("ht-support", "admin");
    const put = (auth: string, config: unknown) => app.request("/v1/admin/settings", { method: "PUT", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ homeTemplates: config }) });
    assert.deepEqual(await getHomeTemplatesSettings(), DEFAULT_HOME_TEMPLATES);
    assert.equal((await put(customer, DEFAULT_HOME_TEMPLATES)).status, 403);
    assert.equal((await put(support, DEFAULT_HOME_TEMPLATES)).status, 403);
    assert.equal((await put(admin, { ...DEFAULT_HOME_TEMPLATES, templates: [] })).status, 400);
    const changed: HomeTemplatesSettings = { ...structuredClone(DEFAULT_HOME_TEMPLATES), templates: ["11", "20"], eligibleShortcuts: ["boda", "parcel", "shopping"], preferredShortcuts: ["shopping"], preferredWeight: 5, minIntervalSeconds: 30, maxIntervalSeconds: 90 };
    const response = await put(admin, changed);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await getHomeTemplatesSettings(), changed);
    const seen = await app.request("/v1/settings", { headers: { Authorization: `Bearer ${customer}` } });
    assert.deepEqual((await seen.json() as { settings: { homeTemplates: HomeTemplatesSettings } }).settings.homeTemplates, changed);
    const row = (await client.execute("SELECT value FROM settings WHERE key = 'home_templates_config'")).rows[0]!;
    assert.deepEqual(JSON.parse(String(row.value)), changed);
    const log = (await client.execute("SELECT id, before_json, after_json FROM admin_activity_log WHERE action = 'settings.update'")).rows[0]!;
    assert.deepEqual(JSON.parse(String(log.before_json)).homeTemplates, DEFAULT_HOME_TEMPLATES);
    assert.deepEqual(JSON.parse(String(log.after_json)).homeTemplates, changed);
    assert.deepEqual(await revertActivity(String(log.id), { sub: "ht-admin", name: "Admin", adminRole: "super_admin" }), { ok: true });
    assert.deepEqual(await getHomeTemplatesSettings(), DEFAULT_HOME_TEMPLATES, "activity undo restores the home template setting");
    const only = { ...changed, templates: ["07"] };
    assert.equal((await put(admin, only)).status, 200);
    const single = await app.request("/v1/settings", { headers: { Authorization: `Bearer ${customer}` } });
    assert.deepEqual((await single.json() as { settings: { homeTemplates: HomeTemplatesSettings } }).settings.homeTemplates.templates, ["07"], "only the selected design reaches customer settings");
    await setSetting("home_templates_config", '{"templates":[]}');
    assert.deepEqual(await getHomeTemplatesSettings(), DEFAULT_HOME_TEMPLATES);
  } finally { setD1Binding(undefined); client.close(); }
});
