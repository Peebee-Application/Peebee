import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setR2Binding, type R2Bucket } from "../storage/r2.js";
import { resetAutopilotCache } from "./autopilot.js";
import { freeSessionCode, resetLiveCache } from "./classroom.js";
import { DEMO_STEPS } from "./demo.js";
import { DEMO_TRIALS } from "./demo/index.js";
import { setLearnSettings } from "./settings.js";
import { resetStudioCache } from "./studio.js";

process.env.JWT_SECRET = "tv-pro-test-only-secret";
process.env.PUBLIC_API_URL = "https://api.test";
process.env.CUSTOMER_APP_URL = "https://customer.test";

type Json = Record<string, any>;

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
    // Statements in a batch run in order, as they do on D1.
    async batch(statements: { all(): Promise<unknown> }[]) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database);
}

async function setup(skip: string[] = []) {
  resetSchemaCache();
  resetStudioCache();
  resetLiveCache();
  resetAutopilotCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (skip.some((s) => file.startsWith(s))) continue;
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const store = new Map<string, Uint8Array>();
  setR2Binding({
    async put(k: string, v: unknown) { store.set(k, new Uint8Array(await new Response(v as BodyInit).arrayBuffer())); },
    async get(k: string) { const b = store.get(k); return b ? { body: new Blob([b as BlobPart]).stream(), httpMetadata: { contentType: "video/mp4" }, size: b.length } : null; },
    async delete(k: string | string[]) { for (const key of Array.isArray(k) ? k : [k]) store.delete(key); },
  } as unknown as R2Bucket);
  await setLearnSettings({ trialClassesEnabled: true, trialCodeA: "111222", trialCodeB: "222111", demoContentVisible: true, liveEnabled: true });

  let n = 0;
  const mkUser = async (id: string, role: "customer" | "admin" = "customer", wallet = 0) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, email_verified_at, admin_role, wallet_balance) VALUES (?, ?, ?, ?, 'x', datetime('now'), ?, ?)",
      args: [id, `+25674000${String(n).padStart(4, "0")}`, `${id.split("_")[0]} Person${n}`, role, role === "admin" ? "super_admin" : null, wallet],
    });
    if (role === "customer") await client.execute({ sql: "INSERT INTO personal_wallets (user_id) VALUES (?)", args: [id] });
    return signToken({ sub: id, role });
  };
  const wallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0]!.b);
  const request = async (path: string, o: { method?: string; token?: string; device?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.device ? { Authorization: `Device ${o.device}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  const admin = await mkUser("admin_d", "admin");
  const demo = (o: { method?: string; body?: unknown } = {}) => request("/v1/admin/learn-demo", { ...o, token: admin });
  const installAll = async (password?: string) => {
    for (let step = 0; step < DEMO_STEPS; step += 1) {
      const res = await request("/v1/admin/learn-demo/install", { token: admin, body: { step, ...(password ? { password } : {}) } });
      assert.equal(res.status, 200, `step ${step}: ${JSON.stringify(res.json)}`);
    }
  };
  const count = async (sql: string, args: unknown[] = []) => Number((await client.execute({ sql, args: args as InArgs })).rows[0]!.n);
  return { client, store, mkUser, wallet, request, admin, demo, installAll, count };
}

/** Seconds into the first trial class's loop at which its first lesson starts. */
function lessonPosition(): number {
  const cues = DEMO_TRIALS[0]!.cues;
  let t = 0;
  for (const c of cues) {
    if (c.kind === "lesson") return t;
    t += c.open + (c.kind === "question" ? c.reveal : 0);
  }
  return 0;
}
const loopLength = () => DEMO_TRIALS[0]!.cues.reduce((n, c) => n + c.open + (c.kind === "question" ? c.reveal : 0), 0);

/** A school, a paired TV and a tutor who owns them. */
async function educatorWithTv(ctx: Awaited<ReturnType<typeof setup>>, id: string, wallet = 0) {
  const token = await ctx.mkUser(id, "customer", wallet);
  const edu = (path: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${path}`, { ...o, token });
  const school = (await edu("/studio/schools", { body: { name: `${id} school`, kind: "school", streams: ["foundations"] } })).json.school;
  return { token, edu, school };
}

async function pairTv(ctx: Awaited<ReturnType<typeof setup>>, ownerToken: string | null) {
  const started = await ctx.request("/v1/tv/pair/start", { body: {} });
  assert.equal(started.status, 201);
  if (ownerToken) {
    const claim = await ctx.request("/v1/tv/pair", { token: ownerToken, body: { code: started.json.code, name: "Hall TV" } });
    return { deviceId: started.json.deviceId as string, secret: started.json.secret as string, claim };
  }
  return { deviceId: started.json.deviceId as string, secret: started.json.secret as string, claim: null };
}

test("TV is free for every educator by default, and says so", async () => {
  const ctx = await setup();
  const { token, edu, school } = await educatorWithTv(ctx, "free_e");

  const status = await ctx.request("/v1/education/pro", { token });
  assert.deepEqual({ required: status.json.tv.required, allowed: status.json.tv.allowed, pro: status.json.tv.pro }, { required: false, allowed: true, pro: false });

  const tv = await pairTv(ctx, token);
  assert.equal(tv.claim!.status, 201, "pairing works without Pro");
  const made = await ctx.request("/v1/education/classroom/sessions", { token, body: { title: "With a screen", schoolId: school.id, screenDeviceId: tv.deviceId, autoCues: false } });
  assert.equal(made.status, 201, "a session on the TV works without Pro");
  void edu;

  const buy = await ctx.request("/v1/education/pro/subscribe", { token, body: {} });
  assert.equal(buy.status, 409);
  assert.equal(buy.json.error, "not_needed", "nothing to buy while TV is free");
});

test("TV as a Pro feature: gated when staff switch it on, bought from the wallet, and renewable", async () => {
  const ctx = await setup();
  const { token, school } = await educatorWithTv(ctx, "pro_e", 50_000);
  const tvFree = await pairTv(ctx, token);
  assert.equal(tvFree.claim!.status, 201);

  const patch = (body: Record<string, unknown>) => ctx.request("/v1/admin/learn-settings", { method: "PATCH", token: ctx.admin, body });
  assert.equal((await patch({ tvProRequired: true, proPriceUgx: 30_000, proDays: 30 })).status, 200);

  const status = (await ctx.request("/v1/education/pro", { token })).json;
  assert.deepEqual({ required: status.tv.required, allowed: status.tv.allowed }, { required: true, allowed: false });
  assert.equal(status.priceUgx, 30_000);

  // Every TV action is refused with a 402 that says what to do; phones-only teaching is untouched.
  const another = await pairTv(ctx, null);
  const pair = await ctx.request("/v1/tv/pair", { token, body: { code: (await ctx.request("/v1/tv/me", { device: another.secret })).json.code, name: "Second" } });
  assert.equal(pair.status, 402);
  assert.equal(pair.json.error, "pro_required");
  assert.equal(pair.json.priceUgx, 30_000);
  const withScreen = await ctx.request("/v1/education/classroom/sessions", { token, body: { title: "TV", schoolId: school.id, screenDeviceId: tvFree.deviceId, autoCues: false } });
  assert.equal(withScreen.status, 402);
  const phonesOnly = await ctx.request("/v1/education/classroom/sessions", { token, body: { title: "Phones", schoolId: school.id, autoCues: false } });
  assert.equal(phonesOnly.status, 201, "teaching to phones needs no Pro");
  const sid = phonesOnly.json.session.id;
  const cue = (await ctx.request(`/v1/education/classroom/sessions/${sid}/cues`, { token, body: { kind: "announcement", payload: { text: "Hello" } } })).json.cueId;
  assert.equal((await ctx.request(`/v1/education/classroom/cues/${cue}/push`, { token, body: { target: "phones" } })).status, 200);
  assert.equal((await ctx.request(`/v1/education/classroom/cues/${cue}/push`, { token, body: { target: "both" } })).status, 402, "pushing to a screen needs Pro");
  assert.equal((await ctx.request(`/v1/education/classroom/sessions/${sid}`, { method: "PATCH", token, body: { screenDeviceId: tvFree.deviceId } })).status, 402);

  // Buying: not enough money changes nothing; enough takes the price once and switches the TV on.
  const poor = await educatorWithTv(ctx, "poor_e", 1000);
  const refused = await ctx.request("/v1/education/pro/subscribe", { token: poor.token, body: {} });
  assert.equal(refused.status, 402);
  assert.equal(refused.json.error, "insufficient_wallet");
  assert.equal(await ctx.wallet("poor_e"), 1000);

  const bought = await ctx.request("/v1/education/pro/subscribe", { token, body: {} });
  assert.equal(bought.status, 200, JSON.stringify(bought.json));
  assert.equal(await ctx.wallet("pro_e"), 20_000, "the price was taken from the wallet, once");

  // Now everything that was refused works.
  assert.equal((await ctx.request("/v1/education/pro", { token })).json.tv.allowed, true);
  assert.equal((await ctx.request("/v1/tv/pair", { token, body: { code: (await ctx.request("/v1/tv/me", { device: another.secret })).json.code, name: "Second" } })).status, 201);
  assert.equal((await ctx.request(`/v1/education/classroom/cues/${cue}/push`, { token, body: { target: "both" } })).status, 409, "now it only needs a screen on the session");
  assert.equal((await ctx.request(`/v1/education/classroom/sessions/${sid}`, { method: "PATCH", token, body: { screenDeviceId: tvFree.deviceId } })).status, 200);
  assert.equal((await ctx.request(`/v1/education/classroom/cues/${cue}/push`, { token, body: { target: "both" } })).status, 200);
});

test("Pro: a renewal adds to the days left, staff can grant and revoke, and it can lapse", async () => {
  const ctx = await setup();
  const { token } = await educatorWithTv(ctx, "renew_e", 100_000);
  await ctx.request("/v1/admin/learn-settings", { method: "PATCH", token: ctx.admin, body: { tvProRequired: true, proPriceUgx: 10_000, proDays: 30 } });
  const day = 86_400_000;

  const first = await ctx.request("/v1/education/pro/subscribe", { token, body: {} });
  assert.equal(first.status, 200);
  const firstEnds = Date.parse(first.json.expiresAt);
  assert.ok(Math.abs(firstEnds - (Date.now() + 30 * day)) < 60_000);
  const second = await ctx.request("/v1/education/pro/subscribe", { token, body: {} });
  assert.ok(Math.abs(Date.parse(second.json.expiresAt) - (firstEnds + 30 * day)) < 1000, "renewing early loses no days");
  assert.equal(await ctx.wallet("renew_e"), 100_000 - 20_000);
  assert.equal((await ctx.request("/v1/education/pro", { token })).json.tv.allowed, true);

  // It lapses on its own.
  await ctx.client.execute({ sql: "UPDATE edu_educator_plans SET expires_at = ? WHERE user_id = 'renew_e'", args: [new Date(Date.now() - 1000).toISOString()] });
  assert.equal((await ctx.request("/v1/education/pro", { token })).json.tv.allowed, false);

  // Staff: grant by phone or email, no end date, then revoke.
  const phone = String((await ctx.client.execute("SELECT phone FROM users WHERE id = 'renew_e'")).rows[0]!.phone);
  assert.equal((await ctx.request("/v1/admin/learn-pro/grant", { token, body: { identifier: phone } })).status, 403, "only staff can grant");
  assert.equal((await ctx.request("/v1/admin/learn-pro/grant", { token: ctx.admin, body: { identifier: "+256000000000" } })).status, 404);
  const grant = await ctx.request("/v1/admin/learn-pro/grant", { token: ctx.admin, body: { identifier: phone, note: "Launch partner" } });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.equal(grant.json.expiresAt, null);
  assert.equal((await ctx.request("/v1/education/pro", { token })).json.tv.allowed, true);
  assert.equal((await ctx.request("/v1/education/pro/subscribe", { token, body: {} })).json.error, "already_pro", "no need to buy with no end date");
  const list = await ctx.request("/v1/admin/learn-pro", { token: ctx.admin });
  assert.equal(list.json.educators.length, 1);
  assert.equal(list.json.educators[0].active, true);
  assert.equal((await ctx.request("/v1/admin/learn-pro/renew_e", { method: "DELETE", token: ctx.admin })).status, 200);
  assert.equal((await ctx.request("/v1/education/pro", { token })).json.tv.allowed, false);
  assert.equal((await ctx.request("/v1/admin/learn-pro/renew_e", { method: "DELETE", token: ctx.admin })).status, 404);
});

test("TV practice classes: a TV shows one, even unpaired and even when TV is Pro, and phones join the same class", async (t) => {
  const ctx = await setup();
  await ctx.installAll();
  // TV is a Pro feature, and this TV belongs to nobody: practice classes are still open to it.
  await ctx.request("/v1/admin/learn-settings", { method: "PATCH", token: ctx.admin, body: { tvProRequired: true } });
  const tv = await pairTv(ctx, null);
  const student = await ctx.mkUser("tv_stu");

  const list = await ctx.request("/v1/tv/trial");
  assert.equal(list.status, 200, "the list is public");
  assert.deepEqual(list.json.classes.map((c: Record<string, string>) => [c.slot, c.code]), [["a", "111222"], ["b", "222111"]]);

  assert.equal((await ctx.request("/v1/tv/trial", { body: { slot: "a" } })).status, 401, "starting one needs the TV's own secret");
  assert.equal((await ctx.request("/v1/tv/trial", { device: tv.secret, body: { slot: "z" } })).status, 400);
  const before = await ctx.request("/v1/tv/screen/state", { device: tv.secret });
  assert.equal(before.status, 409, "an unpaired TV with no practice class is still waiting to be paired");

  assert.equal((await ctx.request("/v1/tv/trial", { device: tv.secret, body: { slot: "a" } })).status, 200);
  assert.equal((await ctx.request("/v1/tv/me", { device: tv.secret })).json.trial, "a");

  const total = loopLength();
  const base = Math.floor(Date.now() / (total * 1000)) * total * 1000;
  t.mock.timers.enable({ apis: ["Date"], now: base });
  t.mock.timers.setTime(base + (lessonPosition() + 2) * 1000);

  const screen = await ctx.request("/v1/tv/screen/state", { device: tv.secret });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(screen.json.session.trial, true);
  assert.equal(screen.json.session.code, "111222", "the TV shows the code phones type");
  assert.match(screen.json.session.joinUrl, /\/learn\/live\?code=111222$/);
  assert.equal(screen.json.cue.kind, "lesson");
  assert.match(screen.json.cue.media.url, /\/v1\/education\/media\//, "the placeholder video is on the TV");

  // A phone joins the same class and the TV sees the room fill.
  const joined = await ctx.request("/v1/education/classroom/join", { token: student, body: { code: "111222" } });
  assert.equal(joined.status, 200);
  const phone = await ctx.request(`/v1/education/classroom/sessions/${joined.json.session.id}/state`, { token: student });
  assert.equal(phone.json.cue.kind, "lesson", "the phone and the TV follow the same item");
  assert.equal((await ctx.request("/v1/tv/screen/state", { device: tv.secret })).json.session.participants, 1);

  // A quiz question: the TV shows the choices and no answer until the reveal.
  const cues = DEMO_TRIALS[0]!.cues;
  let at = 0;
  let q = 0;
  for (let i = 0; i < cues.length; i += 1) {
    const c = cues[i]!;
    if (c.kind === "question" && !c.poll) { q = at; break; }
    at += c.open + (c.kind === "question" ? c.reveal : 0);
  }
  t.mock.timers.setTime(base + (q + 2) * 1000);
  const open = (await ctx.request("/v1/tv/screen/state", { device: tv.secret })).json.cue;
  assert.equal(open.kind, "question");
  assert.ok(!JSON.stringify(open).includes("correctIndex") && open.correctIndex === undefined, "no answer on the TV before the reveal");
  t.mock.timers.setTime(base + (q + cues.find((c) => c.kind === "question" && !c.poll)!.open + 1) * 1000);
  const revealed = (await ctx.request("/v1/tv/screen/state", { device: tv.secret })).json.cue;
  assert.equal(revealed.revealed, true);
  assert.equal(revealed.correctIndex, 0);

  // Leaving puts the TV back to waiting; switching practice classes off does the same.
  assert.equal((await ctx.request("/v1/tv/trial", { method: "DELETE", device: tv.secret })).status, 200);
  assert.equal((await ctx.request("/v1/tv/screen/state", { device: tv.secret })).status, 409);
  await ctx.request("/v1/tv/trial", { device: tv.secret, body: { slot: "b" } });
  await ctx.request("/v1/admin/learn-settings", { method: "PATCH", token: ctx.admin, body: { trialClassesEnabled: false } });
  assert.equal((await ctx.request("/v1/tv/screen/state", { device: tv.secret })).status, 409);
  assert.deepEqual((await ctx.request("/v1/tv/trial")).json.classes, []);
  assert.equal((await ctx.request("/v1/tv/trial", { device: tv.secret, body: { slot: "a" } })).status, 404, "can't start one that is switched off");
});
