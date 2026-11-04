import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setR2Binding, type R2Bucket } from "../storage/r2.js";
import { MAX_KEPT_VERSIONS, addVersion, decideCheck, parseRegistry, safeEqual } from "./logic.js";
import { appUpdatesAdminRoutes, appUpdatesRoutes } from "./routes.js";

const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");

test("the update decision: who is told what", () => {
  const v = { id: "v-2", label: "two", files: 3, size: 10, minNative: 2, note: "", publishedAt: "2026-10-28T10:00:00Z" };
  const reg = { live: "v-2", versions: [v] };
  assert.equal(decideCheck(true, reg, { versionName: "builtin", versionCode: "2" }).kind, "update");
  assert.equal(decideCheck(true, reg, { versionName: "v-2", versionCode: "2" }).kind, "up_to_date", "already on it");
  assert.equal(decideCheck(true, reg, { versionName: "builtin", versionCode: "1" }).kind, "blocked", "app too old for this bundle");
  assert.equal(decideCheck(false, reg, { versionName: "builtin", versionCode: "2" }).kind, "up_to_date", "paused");
  assert.equal(decideCheck(true, { live: null, versions: [v] }, { versionName: "builtin" }).kind, "up_to_date", "nothing live");
  assert.equal(decideCheck(true, reg, { versionName: "builtin" }).kind, "update", "unknown build number is not blocked");
});

test("registry parsing drops what is malformed, and retention keeps the live version", () => {
  assert.deepEqual(parseRegistry("not json"), { live: null, versions: [] });
  assert.deepEqual(parseRegistry(JSON.stringify({ live: "ghost", versions: [{ id: "BAD ID" }] })), { live: null, versions: [] });
  let reg = parseRegistry("{}");
  const removedAll: string[] = [];
  for (let i = 0; i < MAX_KEPT_VERSIONS + 3; i++) {
    const out = addVersion(reg, { id: `v-${String(i).padStart(2, "0")}`, label: "", files: 1, size: 1, minNative: 1, note: "", publishedAt: `2026-10-28T10:${String(i).padStart(2, "0")}:00Z` }, i === 0 ? true : false);
    reg = out.registry; removedAll.push(...out.removed);
  }
  assert.equal(reg.live, "v-00", "later versions did not take over");
  assert.equal(reg.versions.length, MAX_KEPT_VERSIONS + 1, "the newest ten plus the live one");
  assert.ok(reg.versions.some((v) => v.id === "v-00"), "the live version is never dropped");
  assert.equal(removedAll.length, 2);
  assert.equal(safeEqual("secret-token", "secret-token"), true);
  assert.equal(safeEqual("secret-token", "secret-tokeX"), false);
  assert.equal(safeEqual("short", "longer-value"), false);
});

test("publish, check, download, roll back: what a phone and the build pipeline do", async () => {
  process.env.JWT_SECRET = "app-updates-test-secret";
  process.env.APP_UPDATES_PUBLISH_TOKEN = "";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const dir = join(process.cwd(), "src/db/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) for (const sql of splitSqlStatements(readFileSync(join(dir, f), "utf8"))) await client.execute(sql);
  const prepare = (sql: string) => ({ sql, args: [] as unknown[], bind(...a: unknown[]) { this.args = a; return this; }, async all() { const r = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }; } });
  setD1Binding({ prepare, async batch(s: ReturnType<typeof prepare>[]) { const r = await client.batch(s.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write"); return r.map((x) => ({ results: x.rows, success: true, meta: { changes: x.rowsAffected, last_row_id: Number(x.lastInsertRowid ?? 0) } })); } } as unknown as D1Database);
  const files = new Map<string, Uint8Array>();
  const bucket: R2Bucket = {
    async put(key, value) { files.set(key, typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)); },
    async get(key) { const v = files.get(key); return v ? { body: new Blob([v as BlobPart]).stream(), size: v.length } : null; },
    async delete(key) { files.delete(key); },
    async head(key) { const v = files.get(key); return v ? { size: v.length } : null; },
  };
  setR2Binding(bucket);
  await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES ('adm', 'adm', 'adm', 'h', 'admin', 'super_admin')", args: [] });
  // Exercise the real mount order too: another /v1 router must not intercept phones.
  const { default: fullApp } = await import("../app.js");
  const phoneCheck = await fullApp.request("/v1/app-updates/customer/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version_name: "builtin", version_code: "2" }) });
  assert.equal(phoneCheck.status, 200, "update checks need no signed-in user");
  assert.equal((await phoneCheck.json() as { kind: string }).kind, "up_to_date");
  assert.equal((await fullApp.request("/v1/app-updates/customer/files/missing", { method: "POST", body: "{}" })).status, 503, "publisher token gate handles uploads, not user sign-in");
  assert.equal((await fullApp.request("/v1/orders/active")).status, 401, "orders still require sign-in");
  assert.equal((await fullApp.request("/v1/admin/app-updates")).status, 401, "update administration still requires sign-in");
  const app = new Hono().route("/v1", appUpdatesRoutes).route("/v1", appUpdatesAdminRoutes);
  const admin = { Authorization: `Bearer ${await signToken({ sub: "adm", role: "admin" })}`, "Content-Type": "application/json" };
  const TOKEN = "publish-token-of-at-least-24-chars";
  const check = async (device: Record<string, unknown>) => (await app.request("/v1/app-updates/customer/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "android", device_id: "d1", app_id: "online.peebee.customer", ...device }) })).json() as Promise<Record<string, unknown>>;
  const enc = new TextEncoder();
  const auth = (token: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
  const upload = async (text: string, token: string | null = TOKEN) => {
    const bytes = enc.encode(text);
    const hash = await sha(bytes);
    const res = await app.request(`/v1/app-updates/customer/files/${hash}`, { method: "PUT", headers: auth(token), body: bytes });
    return { hash, size: bytes.length, res };
  };
  const missing = async (hashes: string[]) => (await (await app.request("/v1/app-updates/customer/files/missing", { method: "POST", headers: { ...auth(TOKEN), "Content-Type": "application/json" }, body: JSON.stringify({ hashes }) })).json()) as { missing: string[] };
  /** Uploads whatever the server lacks, then publishes: what the build pipeline does. */
  const release = async (id: string, content: Record<string, string>, extra: Record<string, unknown> = {}, token: string | null = TOKEN) => {
    const items = await Promise.all(Object.entries(content).map(async ([path, text]) => ({ path, text, sha256: await sha(enc.encode(text)), size: enc.encode(text).length })));
    const entries = items.map(({ path, sha256, size }) => ({ path, sha256, size }));
    for (const m of (await missing(entries.map((e) => e.sha256))).missing) await upload(items.find((i) => i.sha256 === m)!.text);
    return app.request("/v1/app-updates/customer/publish", { method: "POST", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify({ id, files: entries, ...extra }) });
  };
  const adminPut = (body: unknown) => app.request("/v1/admin/app-updates", { method: "PUT", headers: admin, body: JSON.stringify(body) });
  const adminGet = async () => (await (await app.request("/v1/admin/app-updates", { headers: admin })).json()) as { enabled: boolean; autoLive: boolean; publishConfigured: boolean; apps: { customer: { live: string | null; versions: Array<{ id: string }> } } };

  // Nothing published yet.
  const none = await check({ version_name: "builtin", version_code: "2" });
  assert.equal(none.error, "no_new_version_available");
  assert.equal(none.kind, "up_to_date");
  assert.equal((await app.request("/v1/app-updates/rider/check", { method: "POST", body: "{}" })).status, 404, "only known apps");

  // Publishing is refused until a token is set, and then only with the right one.
  const v1 = { "index.html": "<html>one</html>", "_next/app.js": "console.log(1)", "logo.svg": "<svg/>" };
  assert.equal((await upload("x")).res.status, 503, "no token configured");
  process.env.APP_UPDATES_PUBLISH_TOKEN = TOKEN;
  assert.equal((await upload("x", null)).res.status, 401, "no token sent");
  assert.equal((await upload("x", "wrong-token-but-long-enough-xxxxxxx")).res.status, 401);
  assert.equal((await app.request("/v1/app-updates/customer/publish", { method: "POST", body: "{}" })).status, 401, "publishing needs the token");
  assert.equal((await app.request("/v1/app-updates/customer/files/missing", { method: "POST", body: "{}" })).status, 401);
  const wrongBody = await app.request(`/v1/app-updates/customer/files/${await sha(enc.encode("a"))}`, { method: "PUT", headers: auth(TOKEN), body: enc.encode("b") });
  assert.equal(wrongBody.status, 400, "a body that does not match its checksum");
  assert.equal(files.size, 0, "nothing stored by a refused upload");

  // Publishing before the files are uploaded, or with unsafe input, is refused.
  const h = async (t: string) => ({ sha256: await sha(enc.encode(t)), size: t.length });
  const raw = (body: unknown) => app.request("/v1/app-updates/customer/publish", { method: "POST", headers: { ...auth(TOKEN), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await raw({ id: "v-one", files: [{ path: "index.html", ...(await h("<html>one</html>")) }] })).status, 409, "files not uploaded yet");
  assert.equal((await raw({ id: "v-one", files: [{ path: "../index.html", ...(await h("a")) }] })).status, 400, "path escaping the app");
  assert.equal((await raw({ id: "BAD ID!", files: [{ path: "index.html", ...(await h("a")) }] })).status, 400, "unsafe id");
  assert.equal((await raw({ id: "v-one", files: [{ path: "readme.txt", ...(await h("a")) }] })).status, 400, "no index.html");
  assert.equal((await raw({ id: "v-one", files: [{ path: "a.js", ...(await h("a")) }, { path: "a.js", ...(await h("a")) }, { path: "index.html", ...(await h("a")) }] })).status, 400, "duplicate path");

  // A good release goes live by itself (the default) and a phone is told about it.
  const ok = await release("v-one", v1, { minNative: 2, label: "first" });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { live: boolean }).live, true);
  assert.equal(files.size, 3 + 1, "three files and the list");
  const update = await check({ version_name: "builtin", version_code: "2", version_build: "1.1" }) as { version: string; url: string; manifest: Array<{ file_name: string; file_hash: string; download_url: string }> };
  assert.equal(update.version, "v-one", JSON.stringify(update));
  assert.match(update.url, /^https?:\/\//, "the updater needs a link");
  assert.deepEqual(update.manifest.map((e) => e.file_name).sort(), Object.keys(v1).sort());
  for (const entry of update.manifest) {
    assert.equal(entry.file_hash, await sha(enc.encode(v1[entry.file_name as keyof typeof v1]!)), "the phone verifies each file by this checksum");
    const download = await app.request(new URL(entry.download_url).pathname);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("Cache-Control") ?? "", /immutable/);
    assert.equal(await download.text(), v1[entry.file_name as keyof typeof v1]);
  }
  assert.equal((await app.request(`/v1/app-updates/customer/files/${"0".repeat(64)}`)).status, 404);

  // Already on it, or too old to run it.
  assert.equal((await check({ version_name: "v-one", version_code: "2" })).kind, "up_to_date");
  const blocked = await check({ version_name: "builtin", version_code: "1" });
  assert.equal(blocked.kind, "blocked");
  assert.equal(blocked.error, "native_update_required");

  // Publishing the same version again is harmless; with different contents it is refused.
  assert.equal(((await (await release("v-one", v1)).json()) as { alreadyPublished?: boolean }).alreadyPublished, true);
  assert.equal((await release("v-one", { ...v1, "index.html": "<html>changed</html>" })).status, 409);

  // Admin sees it, and can pause updating.
  const state = await adminGet();
  assert.equal(state.publishConfigured, true);
  assert.equal(state.apps.customer.live, "v-one");
  assert.equal((await adminPut({ enabled: false })).status, 200);
  assert.equal((await check({ version_name: "builtin", version_code: "2" })).kind, "up_to_date", "paused: phones keep what they have");
  assert.equal((await adminPut({ enabled: true })).status, 200);

  // With "go live by themselves" off, a new version waits for Admin; rolling back is one change.
  assert.equal((await adminPut({ autoLive: false })).status, 200);
  const v2 = { ...v1, "index.html": "<html>two</html>" };
  assert.equal(((await (await release("v-two", v2)).json()) as { live: boolean }).live, false, "held back");
  assert.deepEqual((await missing([await sha(enc.encode("<svg/>"))])).missing, [], "files shared between versions are stored once");
  assert.equal((await check({ version_name: "builtin", version_code: "2" })).version, "v-one", "phones still get the live one");
  assert.equal((await adminPut({ live: { customer: "v-two" } })).status, 200);
  assert.equal((await check({ version_name: "v-one", version_code: "2" })).version, "v-two");
  assert.equal((await adminPut({ live: { customer: "v-one" } })).status, 200, "rollback");
  assert.equal((await check({ version_name: "v-two", version_code: "2" })).version, "v-one", "a phone on the bad version is moved back");

  // Admin cannot point at a version that does not exist, or delete the live one; deleting an old one removes its file.
  assert.equal((await adminPut({ live: { customer: "v-ghost" } })).status, 400);
  assert.equal((await adminPut({ remove: [{ app: "customer", id: "v-one" }] })).status, 400, "the live one stays");
  assert.equal((await adminPut({ remove: [{ app: "customer", id: "v-two" }] })).status, 200);
  assert.equal([...files.keys()].some((k) => k.endsWith("/manifests/v-two.json")), false, "its list is gone");
  assert.equal(files.size, 3 + 1 + 1, "its own page is gone, files shared with v-one stay (plus the one upload of the refused change)");
  assert.equal((await adminGet()).apps.customer.versions.length, 1);

  // Every change was recorded for the activity log.
  const log = await client.execute("SELECT summary FROM admin_activity_log WHERE action = 'app_updates.update' ORDER BY created_at");
  assert.ok(log.rows.length >= 5, `activity log rows: ${log.rows.length}`);
  assert.ok(log.rows.some((r) => String(r.summary).includes("live version v-one")));

  // Only an admin with the settings permission can change any of it.
  assert.equal((await app.request("/v1/admin/app-updates", { method: "PUT", body: "{}", headers: { "Content-Type": "application/json" } })).status, 401);
});
