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
import { setLearnSettings } from "./settings.js";
import { resetStudioCache } from "./studio.js";

process.env.JWT_SECRET = "chat-test-only-secret";
process.env.PUBLIC_API_URL = "https://api.test";

type Json = Record<string, any>;

function bind(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const r = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({ prepare, async batch(st: { all(): Promise<unknown> }[]) { const o = []; for (const s of st) o.push(await s.all()); return o; } } as unknown as D1Database);
}

async function setup(skip: string[] = []) {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  const dir = join(process.cwd(), "src/db/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (skip.some((s) => f.startsWith(s))) continue;
    for (const sql of splitSqlStatements(readFileSync(join(dir, f), "utf8"))) await client.execute(sql);
  }
  bind(client);
  setR2Binding({ async put() {}, async get() { return null; }, async delete() {} } as unknown as R2Bucket);
  await setLearnSettings({ createsPerHour: 1000, quizAttemptsPerHour: 200 });
  let n = 0;
  const mk = async (id: string) => {
    n += 1;
    await client.execute({ sql: "INSERT INTO users (id, phone, name, role, password_hash, email_verified_at, wallet_balance) VALUES (?, ?, ?, 'customer', 'x', datetime('now'), 0)", args: [id, `+25676000${String(n).padStart(4, "0")}`, `Person ${id}`] });
    return signToken({ sub: id, role: "customer" });
  };
  const request = async (path: string, o: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(path, { method: o.method ?? (o.body !== undefined ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  return { client, mk, request };
}


async function pair(ctx: Awaited<ReturnType<typeof setup>>) {
  const teacher = await ctx.mk("t_1");
  const stranger = await ctx.mk("t_2");
  const parent = await ctx.mk("p_1");
  const student = await ctx.mk("s_1");
  const edu = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: teacher });
  const as = (token: string) => (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education/messages${p}`, { ...o, token });
  const school = (await edu("/studio/schools", { body: { name: "Bright school", kind: "school", streams: ["foundations"] } })).json.school;
  return { teacher, stranger, parent, student, school, T: as(teacher), X: as(stranger), P: as(parent), S: as(student), ctx };
}

test("messages: a parent writes to a school, the teacher replies, unread flags clear when read", async () => {
  const k = await pair(await setup());
  assert.equal((await k.P(`/schools/${k.school.id}`, { body: { body: "  Is the P.4 class still open?  " } })).status, 201);
  const threads = (await k.T("/studio")).json.threads;
  assert.equal(threads.length, 1);
  assert.equal(threads[0].customerId, "p_1");
  assert.equal(threads[0].unread, true);
  assert.equal(threads[0].lastMessagePreview, "Is the P.4 class still open?");
  assert.equal((await k.T(`/studio/${k.school.id}/p_1`, { body: { body: "Yes, three seats left." } })).status, 201);
  assert.equal((await k.T(`/studio/${k.school.id}/p_1/read`, { body: {} })).status, 200);
  assert.equal((await k.T("/studio")).json.threads[0].unread, false);
  const mine = (await k.P("/mine")).json.threads;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].unread, true);
  const thread = (await k.P(`/schools/${k.school.id}`)).json;
  assert.equal(thread.schoolOwnerId, "t_1");
  assert.deepEqual(thread.messages.map((m: Json) => [m.sender_role, m.body]), [["customer", "Is the P.4 class still open?"], ["school", "Yes, three seats left."]]);
  await k.P(`/schools/${k.school.id}/read`, { body: {} });
  assert.equal((await k.P("/mine")).json.threads[0].unread, false);
});

test("messages: threads are private to the school's owner and the person who wrote", async () => {
  const k = await pair(await setup());
  await k.P(`/schools/${k.school.id}`, { body: { body: "Hello" } });
  await k.S(`/schools/${k.school.id}`, { body: { body: "Hi from a student" } });
  // Someone else's thread shows only their own messages.
  assert.equal((await k.S(`/schools/${k.school.id}`)).json.messages.length, 1);
  // Another teacher can't read or answer it.
  assert.equal((await k.X(`/studio/${k.school.id}/p_1`)).status, 404);
  assert.equal((await k.X(`/studio/${k.school.id}/p_1`, { body: { body: "mine now" } })).status, 404);
  assert.equal((await k.X("/studio")).json.threads.length, 0);
  // The owner can't start a conversation with someone who never wrote, nor message their own school.
  assert.equal((await k.T(`/studio/${k.school.id}/t_2`, { body: { body: "hello?" } })).status, 404);
  assert.equal((await k.T(`/schools/${k.school.id}`, { body: { body: "me" } })).status, 400);
  assert.equal((await k.P("/schools/nope", { body: { body: "x" } })).status, 404);
});

test("messages: Admin controls them — off switch, longest message and the hourly limit", async () => {
  const k = await pair(await setup());
  await setLearnSettings({ maxMessageChars: 50 });
  assert.equal((await k.P(`/schools/${k.school.id}`, { body: { body: "x".repeat(51) } })).status, 400);
  await setLearnSettings({ maxMessageChars: 1000, messagesPerHour: 2 });
  assert.equal((await k.P(`/schools/${k.school.id}`, { body: { body: "one" } })).status, 201);
  assert.equal((await k.P(`/schools/${k.school.id}`, { body: { body: "two" } })).status, 201);
  assert.equal((await k.P(`/schools/${k.school.id}`, { body: { body: "three" } })).status, 429);
  await setLearnSettings({ messagingEnabled: false, messagesPerHour: 100 });
  const off = await k.P(`/schools/${k.school.id}`);
  assert.equal(off.status, 503);
  assert.equal(off.json.error, "messaging_off");
});

test("messages: before the migration is applied they say so instead of failing", async () => {
  const ctx = await setup(["0157"]);
  const k = await pair(ctx);
  const res = await k.P(`/schools/${k.school.id}`, { body: { body: "Hello" } });
  assert.equal(res.status, 503);
  assert.equal(res.json.error, "upgrade_pending");
  // Calls with no school behind them still work without it.
  const call = await ctx.request("/v1/calls", { token: k.parent, body: { calleeId: "t_1" } });
  assert.equal(call.status, 201);
});

test("calls: a call from a school conversation is logged in the thread, and Admin can switch calls off", async () => {
  const ctx = await setup();
  const k = await pair(ctx);
  await k.P(`/schools/${k.school.id}`, { body: { body: "Can we talk?" } });
  const placed = await ctx.request("/v1/calls", { token: k.teacher, body: { calleeId: "p_1", schoolId: k.school.id } });
  assert.equal(placed.status, 201);
  const ended = await ctx.request(`/v1/calls/${placed.json.call.id}/end`, { token: k.parent, body: { reason: "declined" } });
  assert.equal(ended.status, 200);
  const log = (await k.P(`/schools/${k.school.id}`)).json.messages.at(-1);
  assert.equal(log.type, "call");
  assert.equal(log.sender_role, "school");
  assert.equal(log.body, "Declined call");
  // Someone who isn't the school's owner or the callee can't hang a call on the school.
  assert.equal((await ctx.request("/v1/calls", { token: k.stranger, body: { calleeId: "s_1", schoolId: k.school.id } })).status, 404);
  await setLearnSettings({ callsEnabled: false });
  const off = await ctx.request("/v1/calls", { token: k.parent, body: { calleeId: "t_1", schoolId: k.school.id } });
  assert.equal(off.status, 503);
});
