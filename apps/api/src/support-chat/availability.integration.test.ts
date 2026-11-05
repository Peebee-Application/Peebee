import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { sweepSupportChats } from "./alerts.js";
import { computeAvailability, describeHours, withinHours, type AvailabilitySettings } from "./availability.js";
import { supportChatRoutes } from "./routes.js";

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

const base: AvailabilitySettings = { hoursEnabled: true, openHour: 8, closeHour: 20, days: ["mon", "tue", "wed", "thu", "fri", "sat"], utcOffset: 3, offlineMode: "leave_message", needsStaff: false };
// 2026-11-02 is a Monday. Uganda is UTC+3, so 08:00 there is 05:00 UTC.
const at = (day: number, hhmmUtc: string) => new Date(`2026-11-0${day}T${hhmmUtc}:00Z`);

test("the team's hours are read in the team's own time zone and described in plain words", () => {
  assert.equal(withinHours(base, at(2, "04:59")), false, "07:59 in Kampala");
  assert.equal(withinHours(base, at(2, "05:00")), true, "08:00 in Kampala");
  assert.equal(withinHours(base, at(2, "16:59")), true, "19:59 in Kampala");
  assert.equal(withinHours(base, at(2, "17:00")), false, "20:00 in Kampala");
  assert.equal(withinHours(base, at(1, "10:00")), false, "Sunday is not a working day");
  assert.equal(withinHours({ ...base, hoursEnabled: false }, at(1, "23:00")), true, "no hours set means always");
  assert.equal(describeHours(base), "Monday to Saturday, 8:00 to 20:00 (UTC+3)");
  assert.equal(describeHours({ ...base, days: ["mon", "wed", "fri"] }), "Monday, Wednesday, Friday, 8:00 to 20:00 (UTC+3)");
  assert.equal(describeHours({ ...base, days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }), "8:00 to 20:00 (UTC+3)");
  assert.equal(describeHours({ ...base, hoursEnabled: false }), null);
});

test("what a visitor is offered depends on the hours, who is online and what the admin chose", () => {
  const on = (s: Partial<AvailabilitySettings>, when: Date, online: number | null, human = true) => computeAvailability({ ...base, ...s }, when, online, human);
  assert.deepEqual([on({}, at(2, "08:00"), 2).state, on({}, at(2, "08:00"), 2).offer], ["online", "talk"]);
  const away = on({}, at(2, "18:00"), 2);
  assert.deepEqual([away.state, away.reason, away.offer, away.hours], ["offline", "hours", "message", "Monday to Saturday, 8:00 to 20:00 (UTC+3)"]);
  assert.equal(on({ offlineMode: "ai_only" }, at(2, "18:00"), 2).offer, "none");
  assert.equal(on({}, at(2, "08:00"), 0).offer, "talk", "within hours and nobody watching: still offered (staff are pushed)");
  assert.deepEqual([on({ needsStaff: true }, at(2, "08:00"), 0).reason, on({ needsStaff: true }, at(2, "08:00"), 0).offer], ["nobody", "message"]);
  assert.equal(on({ needsStaff: true }, at(2, "08:00"), null).offer, "talk", "unknown presence never blocks");
  assert.equal(on({}, at(2, "08:00"), 5, false).offer, "none", "the admin switch for talking to a person wins");
});

test("support chat while the team is away", async (t) => {
  process.env.JWT_SECRET = "local-support-availability-test-secret";
  delete process.env.GEMINI_API_KEY;
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES ('sup', 'sup', 'Ann', 'h', 'admin', 'support_manager')");
  const app = new Hono().route("/v1", supportChatRoutes);
  const supToken = await signToken({ sub: "sup", role: "admin" });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;
  const staff = (method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${supToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setting = async (key: string, value: string | null) => {
    await client.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [key] });
    if (value !== null) await client.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
    invalidateSettingsCache();
  };
  let ip = 0;
  const start = async () => {
    const res = await json(await app.request("/v1/support-chat", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `9.9.9.${++ip}` }, body: JSON.stringify({ app: "customer" }) }));
    const visitor = (method: string, path: string, body?: unknown) =>
      app.request(`/v1/support-chat${path}`, { method, headers: { "X-Chat-Secret": res.secret, "Content-Type": "application/json", "cf-connecting-ip": `9.9.9.${ip}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { id: res.id as string, visitor };
  };
  // Hours that are always closed right now: the team is only on a day that is not today (in the team's time zone, UTC+3).
  const closedAllDay = async () => {
    const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const today = new Date(Date.now() + 3 * 3_600_000).getUTCDay();
    await setting("support_chat_hours_enabled", "1"); await setting("support_chat_open_hour", "8"); await setting("support_chat_close_hour", "9");
    await setting("support_chat_utc_offset_hours", "3"); await setting("support_chat_open_days", JSON.stringify([names[(today + 3) % 7]]));
  };
  const sent: string[] = [];
  const send = async (_to: string, p: { title: string }) => { sent.push(p.title); };

  await t.test("with no hours set, a person is offered and the config says so", async () => {
    const cfg = await json(await app.request("/v1/support-chat/config"));
    assert.deepEqual([cfg.live, cfg.humanEnabled, cfg.availability.state, cfg.availability.offer], [true, true, "online", "talk"]);
  });

  await t.test("outside the hours, the visitor can leave a message with a contact, and it is kept for the team", async () => {
    await closedAllDay();
    const cfg = await json(await app.request("/v1/support-chat/config"));
    assert.deepEqual([cfg.availability.state, cfg.availability.reason, cfg.availability.offer], ["offline", "hours", "message"]);
    const chat = await start();
    const res = await json(await chat.visitor("POST", `/${chat.id}/handoff`, { contact: "0772 000 111" }));
    assert.deepEqual([res.status, res.leftOffline, res.availability.offer], ["waiting", true, "message"]);
    const poll = await json(await chat.visitor("GET", `/${chat.id}`));
    assert.equal(poll.leftOffline, true);
    assert.match(poll.messages.at(-1).text, /The team is away right now \(we are on [A-Z][a-z]+day, 8:00 to 9:00 \(UTC\+3\)\)\. Your message is saved/);
    const inbox = await json(await staff("GET", "/admin/support-chats"));
    const row = inbox.chats.find((c: any) => c.id === chat.id);
    assert.deepEqual([row.leftOffline, row.contact, row.status], [true, "0772 000 111", "waiting"]);
    assert.equal((await json(await staff("GET", `/admin/support-chats/${chat.id}`))).contact, "0772 000 111");

    // It survives the normal idle close, which would have closed a person standing by.
    await client.execute({ sql: "UPDATE support_chats SET updated_at = datetime('now', '-5 hours') WHERE id = ?", args: [chat.id] });
    await staff("GET", "/admin/support-chats");
    assert.equal((await client.execute({ sql: "SELECT status FROM support_chats WHERE id = ?", args: [chat.id] })).rows[0].status, "waiting");
    // ...but not forever.
    await client.execute({ sql: "UPDATE support_chats SET updated_at = datetime('now', '-80 hours') WHERE id = ?", args: [chat.id] });
    await staff("GET", "/admin/support-chats");
    assert.equal((await client.execute({ sql: "SELECT status FROM support_chats WHERE id = ?", args: [chat.id] })).rows[0].status, "closed");
  });

  await t.test("a left message is not nagged about while the team is away, and is once the team is on", async () => {
    const chat = await start();
    await chat.visitor("POST", `/${chat.id}/handoff`, {});
    await client.execute({ sql: "UPDATE support_chats SET alert_count = 1, alerted_at = datetime('now', '-10 minutes') WHERE id = ?", args: [chat.id] });
    sent.length = 0;
    await sweepSupportChats(send);
    assert.equal(sent.length, 0, "away: no reminder");
    await setting("support_chat_hours_enabled", null);
    await sweepSupportChats(send);
    assert.deepEqual(sent, ["A left message is still waiting"], "on: reminded");
  });

  await t.test("when the admin chooses assistant-only, a visitor is not offered a person while the team is away", async () => {
    await closedAllDay();
    await setting("support_chat_offline_mode", "ai_only");
    const cfg = await json(await app.request("/v1/support-chat/config"));
    assert.equal(cfg.availability.offer, "none");
    const chat = await start();
    const res = await chat.visitor("POST", `/${chat.id}/handoff`, {});
    assert.equal(res.status, 403);
    assert.equal((await json(res)).error, "team_away");
    await setting("support_chat_offline_mode", null);
    await setting("support_chat_hours_enabled", null);
  });

  await t.test("a signed-in person who comes back later finds their chat, and only they can", async () => {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('rita', 'rita', 'Rita', 'h', 'rider')");
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('sam', 'sam', 'Sam', 'h', 'rider')");
    const ritaToken = await signToken({ sub: "rita", role: "rider" });
    const samToken = await signToken({ sub: "sam", role: "rider" });
    const resume = (token: string | null, appName = "rider") =>
      app.request("/v1/support-chat/resume", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ app: appName }) });
    const made = await json(await app.request("/v1/support-chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ritaToken}`, "cf-connecting-ip": "7.7.7.7" }, body: JSON.stringify({ app: "rider" }) }));
    await client.execute({ sql: "INSERT INTO support_messages (chat_id, sender, body, agent_name) VALUES (?, 'agent', 'We found your payment, Rita.', 'Ann')", args: [made.id] });
    assert.equal((await resume(null)).status, 404, "needs a login");
    assert.equal((await resume(samToken)).status, 404, "someone else's chat is not theirs");
    assert.equal((await resume(ritaToken, "customer")).status, 404, "a different app has no chat");
    const back = await json(await resume(ritaToken));
    assert.equal(back.id, made.id);
    const read = await json(await app.request(`/v1/support-chat/${back.id}?after=0`, { headers: { "X-Chat-Secret": back.secret } }));
    assert.equal(read.messages.at(-1).text, "We found your payment, Rita.");
    const stale = await app.request(`/v1/support-chat/${made.id}?after=0`, { headers: { "X-Chat-Secret": made.secret } });
    assert.equal(stale.status, 404, "the earlier secret stopped working once a new one was issued");
  });

  await t.test("staff presence can be made to count: nobody online is treated as away only when the admin says so", async () => {
    await client.execute("DELETE FROM support_agent_presence");
    await setting("support_chat_online_needs_staff", "1");
    const cfg = await json(await app.request("/v1/support-chat/config"));
    assert.deepEqual([cfg.availability.state, cfg.availability.reason, cfg.availability.offer], ["offline", "nobody", "message"]);
    await staff("GET", "/admin/support-chats/summary");
    assert.equal((await json(await app.request("/v1/support-chat/config"))).availability.offer, "talk", "a staff member opened the admin app");
    await setting("support_chat_online_needs_staff", null);
  });
});
