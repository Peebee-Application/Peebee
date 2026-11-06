import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { AI_FEATURES } from "@peebee/shared";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { aiKeyRoutes } from "../speech/ai-keys-routes.js";
import { translateToLuganda } from "../speech/gemini.js";
import { askAssistant } from "../support-chat/ai.js";
import { aiFeatureRoutes } from "./routes.js";

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

test("every AI feature has a distinct id and a label", () => {
  assert.equal(new Set(AI_FEATURES.map((f) => f.id)).size, AI_FEATURES.length);
  assert.ok(AI_FEATURES.every((f) => f.label && f.description));
});

test("AI features: shared keys, separating them, and keeping each feature to its own keys", async (t) => {
  process.env.JWT_SECRET = "local-ai-features-test-secret";
  process.env.CREDENTIALS_ENCRYPTION_KEY = "local-ai-features-test-encryption";
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
  const app = new Hono().route("/v1", aiKeyRoutes).route("/v1", aiFeatureRoutes);
  const tokens = { admin: await signToken({ sub: "admin", role: "admin" }), cust: await signToken({ sub: "cust", role: "customer" }) };
  const call = (method: string, path: string, who: "admin" | "cust", body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  // A fake Google: every key is real, and we record which key each generation used.
  const used: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get("x-goog-api-key") ?? "";
    if (String(url).includes("/models?pageSize=1")) return new Response("{}", { status: 200 });
    used.push(key);
    return Response.json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
  }) as typeof fetch;
  const K = (n: string) => `AIzaSy-test-key-${n}-padding-padding`;
  const { invalidateSettingsCache } = await import("../lib/settings.js");

  try {
    await t.test("only admins can manage AI features", async () => {
      assert.equal((await call("GET", "/admin/ai-features", "cust")).status, 403);
      assert.equal((await call("PUT", "/admin/ai-features/separate", "cust", { separate: true })).status, 403);
    });

    await t.test("by default one shared pool serves both features", async () => {
      await call("POST", "/admin/ai-keys", "admin", { keys: [{ label: "Shared", key: K("shared") }] });
      const o = await json(await call("GET", "/admin/ai-features", "admin"));
      assert.deepEqual([o.separate, o.separateAvailable, o.sharedKeys], [false, true, 1]);
      assert.deepEqual(o.features.map((f: any) => [f.id, f.pool]), [["translation", "shared"], ["support_chat", "shared"], ["learn_generation", "shared"], ["learn_tutor", "shared"]]);
      assert.ok(o.features.filter((f:any)=>f.id.startsWith("learn_")).every((f:any)=>!f.enabled));
      used.length = 0;
      await translateToLuganda("milk");
      await askAssistant([{ from: "user", text: "hi" }], "");
      assert.deepEqual(used, [K("shared"), K("shared")]);
    });

    await t.test("turning a feature on or off is saved and logged", async () => {
      assert.equal((await call("PUT", "/admin/ai-features/translation/enabled", "admin", { enabled: true })).status, 200);
      assert.equal((await json(await call("GET", "/admin/ai-features", "admin"))).features[0].enabled, true);
      assert.equal((await call("PUT", "/admin/ai-features/nope/enabled", "admin", { enabled: true })).status, 404);
      const log = await client.execute("SELECT action FROM admin_activity_log WHERE action = 'ai_features.enabled'");
      assert.equal(log.rows.length, 1);
    });

    await t.test("separating asks for a key for every feature that is on, and changes nothing until they are all there", async () => {
      const none = await call("PUT", "/admin/ai-features/separate", "admin", { separate: true });
      assert.equal(none.status, 400);
      const body = await json(none);
      assert.equal(body.error, "keys_required");
      assert.deepEqual(body.missing.map((m: any) => m.id), ["translation", "support_chat"]);
      assert.equal(body.overview.separate, false);

      const partial = await call("PUT", "/admin/ai-features/separate", "admin", { separate: true, keys: { translation: [K("tr")] } });
      assert.equal(partial.status, 400);
      assert.deepEqual((await json(partial)).missing.map((m: any) => m.id), ["support_chat"]);
      assert.equal((await json(await call("GET", "/admin/ai-features", "admin"))).separate, false, "still shared");
    });

    await t.test("a key cannot be reused for another feature", async () => {
      const res = await call("PUT", "/admin/ai-features/separate", "admin", { separate: true, keys: { support_chat: [K("tr")] } });
      assert.equal(res.status, 400);
      assert.equal((await json(res)).results.support_chat[0].status, "duplicate");
    });

    await t.test("with a key for each, the keys separate and each feature only ever uses its own", async () => {
      const res = await call("PUT", "/admin/ai-features/separate", "admin", { separate: true, keys: { support_chat: [K("sup")] } });
      assert.equal(res.status, 200);
      const o = (await json(res)).overview;
      assert.equal(o.separate, true);
      assert.deepEqual(o.features.map((f: any) => [f.id, f.pool, f.ownKeys]), [["translation", "own", 1], ["support_chat", "own", 1], ["learn_generation", "own", 0], ["learn_tutor", "own", 0]]);
      used.length = 0;
      await translateToLuganda("milk");
      await askAssistant([{ from: "user", text: "hi" }], "");
      await translateToLuganda("bread");
      assert.deepEqual(used, [K("tr"), K("sup"), K("tr")]);
    });

    await t.test("a pool's keys are listed apart from the shared ones", async () => {
      const shared = await json(await call("GET", "/admin/ai-keys", "admin"));
      assert.deepEqual(shared.keys.map((k: any) => k.hint), ["…" + K("shared").slice(-4)]);
      assert.deepEqual([shared.separate, shared.pool], [true, "shared"]);
      const sup = await json(await call("GET", "/admin/ai-keys?pool=support_chat", "admin"));
      assert.deepEqual(sup.keys.map((k: any) => k.feature), ["support_chat"]);
      assert.equal(JSON.stringify(sup).includes(K("sup")), false, "secrets never come back");
    });

    await t.test("no fallback: a feature without a key of its own does not borrow the shared one", async () => {
      const sup = await json(await call("GET", "/admin/ai-keys?pool=support_chat", "admin"));
      assert.equal((await call("DELETE", `/admin/ai-keys/${sup.keys[0].id}`, "admin")).status, 200);
      used.length = 0;
      await assert.rejects(() => askAssistant([{ from: "user", text: "hi" }], ""), /No Google AI key is set for support_chat/);
      assert.equal(used.length, 0);
      await translateToLuganda("milk");
      assert.deepEqual(used, [K("tr")], "the other feature is unaffected");
    });

    await t.test("a feature with no key of its own cannot be switched on", async () => {
      await call("PUT", "/admin/ai-features/support_chat/enabled", "admin", { enabled: false });
      const res = await call("PUT", "/admin/ai-features/support_chat/enabled", "admin", { enabled: true });
      assert.equal(res.status, 409);
      assert.equal((await json(res)).error, "keys_required");
      await call("POST", "/admin/ai-keys", "admin", { keys: [{ key: K("sup2") }], pool: "support_chat" });
      assert.equal((await call("PUT", "/admin/ai-features/support_chat/enabled", "admin", { enabled: true })).status, 200);
    });

    await t.test("paid mode needs a master for every pool in use, and a new pool's first key becomes it", async () => {
      const shared = await json(await call("GET", "/admin/ai-keys", "admin"));
      await call("PUT", `/admin/ai-keys/${shared.keys[0].id}/master`, "admin");
      const refused = await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "paid" });
      assert.equal(refused.status, 409, "the features' own pools have no master yet");
      assert.match((await json(refused)).message, /Luganda translation/);
      await call("POST", "/admin/ai-keys", "admin", { keys: [{ key: K("sup3") }], pool: "support_chat" });
      const sup = await json(await call("GET", "/admin/ai-keys?pool=support_chat", "admin"));
      assert.equal(sup.keys.filter((k: any) => k.isMaster).length, 0, "not paid yet, so nothing is auto-promoted");
      const tr = await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"));
      await call("PUT", `/admin/ai-keys/${tr.keys[0].id}/master`, "admin");
      await call("PUT", `/admin/ai-keys/${sup.keys[0].id}/master`, "admin");
      assert.equal((await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "paid" })).status, 200);
      used.length = 0;
      await translateToLuganda("milk");
      await askAssistant([{ from: "user", text: "hi" }], "");
      assert.equal(used[0], K("tr"), "translation uses its own master");
      assert.match(used[1], /^AIzaSy-test-key-sup\d-/, "support uses its own master, never the shared one");
      await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "test" });
      await call("DELETE", "/admin/ai-keys/none/master", "admin"); // the shared pool's master was only picked to allow paid mode
    });

    await t.test("each key shows what it serves now and what it has actually served", async () => {
      const shared = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys[0];
      assert.deepEqual(shared.serves, [], "separated, so the shared key serves nothing");
      assert.deepEqual(shared.usage.map((u: any) => [u.feature, u.uses]).sort(), [["support_chat", 1], ["translation", 1]], "it served both before the keys were separated");
      const tr = (await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys[0];
      assert.deepEqual(tr.serves.map((s: any) => s.id), ["translation"]);
      assert.deepEqual(tr.usage.map((u: any) => u.feature), ["translation"], "its own key only ever served its own feature");
      assert.ok(tr.usage[0].uses >= 2 && tr.usage[0].lastUsedAt);
      const pools = (await json(await call("GET", "/admin/ai-keys", "admin"))).pools;
      assert.deepEqual(pools.map((p: any) => [p.id, p.keys]), [["shared", 1], ["translation", 1], ["support_chat", 2], ["learn_generation", 0], ["learn_tutor", 0]]);
      const overview = (await json(await call("GET", "/admin/ai-features", "admin"))).features.find((f: any) => f.id === "translation");
      assert.deepEqual(overview.keys.map((k: any) => k.status), ["ready"]);
    });

    await t.test("a key can be given your own name", async () => {
      const key = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys[0];
      const res = await json(await call("PATCH", `/admin/ai-keys/${key.id}`, "admin", { label: "Spare key (Sharon)" }));
      assert.equal(res.keys[0].label, "Spare key (Sharon)");
      const log = await client.execute("SELECT summary FROM admin_activity_log WHERE action = 'ai_keys.update' ORDER BY rowid DESC LIMIT 1");
      assert.match(String(log.rows[0].summary), /renamed to "Spare key \(Sharon\)"/);
      await call("PATCH", `/admin/ai-keys/${key.id}`, "admin", { label: "Shared 1" });
    });

    await t.test("keys can be moved between roles, but not so a feature that is on is left without one", async () => {
      const shared = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys[0];
      const tr = (await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys[0];
      assert.equal((await call("PATCH", `/admin/ai-keys/${shared.id}`, "admin", { assignTo: "nope" })).status, 400);
      const only = await call("PATCH", `/admin/ai-keys/${tr.id}?pool=translation`, "admin", { assignTo: "shared" });
      assert.equal(only.status, 409, "the only working key of translation");
      assert.match((await json(only)).message, /only working key for Luganda translation/);

      // Move the shared key into translation: the reply shows the group being viewed, now empty.
      const moved = await json(await call("PATCH", `/admin/ai-keys/${shared.id}`, "admin", { assignTo: "translation" }));
      assert.equal(moved.keys.length, 0);
      assert.deepEqual((await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys.map((k: any) => k.label).sort(), ["Key 2", "Shared 1"], "the renamed key kept its name when it moved");
      assert.equal((await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys.length, 2);

      // With a second key, the master can move out; master status does not travel with it.
      const trNow = (await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys.find((k: any) => k.id === tr.id);
      assert.equal(trNow.isMaster, true);
      const out = await json(await call("PATCH", `/admin/ai-keys/${tr.id}?pool=translation`, "admin", { assignTo: "shared" }));
      assert.equal(out.keys.length, 1);
      const inShared = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys.find((k: any) => k.id === tr.id);
      assert.equal(inShared.isMaster, false);

      // Put everything back where it was.
      await call("PATCH", `/admin/ai-keys/${tr.id}`, "admin", { assignTo: "translation" });
      await call("PATCH", `/admin/ai-keys/${shared.id}?pool=translation`, "admin", { assignTo: "shared" });
      assert.deepEqual((await json(await call("GET", "/admin/ai-keys", "admin"))).pools.map((p: any) => [p.id, p.keys]), [["shared", 1], ["translation", 1], ["support_chat", 2], ["learn_generation", 0], ["learn_tutor", 0]]);
    });

    await t.test("a master key cannot be moved away while paid mode depends on it", async () => {
      const tr = (await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys[0];
      await call("PUT", `/admin/ai-keys/${tr.id}/master`, "admin");
      await call("POST", "/admin/ai-keys", "admin", { keys: [{ label: "Second translation key", key: K("tr2") }], pool: "translation" });
      const shared = (await json(await call("GET", "/admin/ai-keys", "admin"))).keys[0];
      await call("PUT", `/admin/ai-keys/${shared.id}/master`, "admin");
      const sup = (await json(await call("GET", "/admin/ai-keys?pool=support_chat", "admin"))).keys[0];
      await call("PUT", `/admin/ai-keys/${sup.id}/master`, "admin");
      assert.equal((await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "paid" })).status, 200);
      const refused = await call("PATCH", `/admin/ai-keys/${tr.id}?pool=translation`, "admin", { assignTo: "shared" });
      assert.equal(refused.status, 409);
      assert.match((await json(refused)).message, /Paid mode is on/);
      await call("PUT", "/admin/ai-keys-mode", "admin", { mode: "test" });
      // leave the shared pool as the next test expects: a plain key with no master, and no extra keys
      await call("DELETE", "/admin/ai-keys/none/master", "admin");
      const extra = (await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys.find((k: any) => k.label === "Second translation key");
      await call("DELETE", `/admin/ai-keys/${extra.id}`, "admin");
    });

    await t.test("putting the keys back together makes both use the shared pool again, and keeps the separate keys", async () => {
      const res = await call("PUT", "/admin/ai-features/separate", "admin", { separate: false });
      assert.equal(res.status, 200);
      assert.equal((await json(res)).overview.separate, false);
      used.length = 0;
      await translateToLuganda("milk");
      await askAssistant([{ from: "user", text: "hi" }], "");
      assert.deepEqual(used, [K("shared"), K("shared")]);
      assert.ok((await json(await call("GET", "/admin/ai-keys?pool=translation", "admin"))).keys.length >= 1, "separate keys are kept for next time");
      const log = await client.execute("SELECT action FROM admin_activity_log WHERE action = 'ai_features.separate'");
      assert.equal(log.rows.length, 2);
    });
  } finally {
    globalThis.fetch = realFetch;
    invalidateSettingsCache();
  }
});
