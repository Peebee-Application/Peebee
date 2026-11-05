import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { webcrypto } from "node:crypto";
import { ApplicationServerKeys, setWebCrypto } from "webpush-webcrypto";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { agentsOnline, alertStaffAboutChat, notifyVisitorOfReply, supportStaffIds, sweepSupportChats } from "./alerts.js";
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

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

test("support chat alerts: staff are told, reminded, and visitors hear back", async (t) => {
  process.env.JWT_SECRET = "local-support-alerts-test-secret";
  delete process.env.GEMINI_API_KEY;
  setWebCrypto(webcrypto as never);
  const vapid = await ApplicationServerKeys.generate();
  const vapidJson = await vapid.toJSON();
  process.env.VAPID_PUBLIC_KEY = vapidJson.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidJson.privateKey;
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const user = (id: string, role: string | null, adminRole: string | null, name = id) =>
    client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, admin_role) VALUES (?, ?, ?, 'h', ?, ?)", args: [id, id, name, role, adminRole] });
  await user("sup", "admin", "support_manager", "Ann");
  await user("cm", "admin", "customer_manager", "Cara");
  await user("boss", "admin", "super_admin", "Boss");
  await user("fin", "admin", "finance_manager", "Fin");
  await user("rid", "rider", null);
  await user("cust", "customer", null, "Chris");
  const app = new Hono().route("/v1", supportChatRoutes);
  const tokens = Object.fromEntries(await Promise.all(["sup", "boss", "fin", "cust"].map(async (id) => [id, await signToken({ sub: id, role: id === "cust" ? "customer" : "admin" })])));
  const staff = (who: string, method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  const newChat = async (id: string, status = "waiting", extra: { app?: string; userId?: string; userName?: string; text?: string } = {}) => {
    await client.execute({ sql: "INSERT INTO support_chats (id, secret_hash, status, handoff_at, app, user_id, user_name) VALUES (?, 'x', ?, datetime('now'), ?, ?, ?)", args: [id, status, extra.app ?? "rider", extra.userId ?? null, extra.userName ?? null] });
    if (extra.text) await client.execute({ sql: "INSERT INTO support_messages (chat_id, sender, body) VALUES (?, 'user', ?)", args: [id, extra.text] });
  };
  const sent: Array<{ to: string; title: string; body: string; url: string; tag: string }> = [];
  const send = async (to: string, p: { title: string; body: string; url: string; tag: string }) => { sent.push({ to, ...p }); };

  await t.test("only staff whose role can answer chats are alerted", async () => {
    assert.deepEqual((await supportStaffIds()).sort(), ["boss", "cm", "sup"]);
  });

  await t.test("a new waiting chat alerts them with who, where and what", async () => {
    await newChat("c1", "waiting", { app: "rider", userName: "Moses", text: "My payment never arrived and the job is closed" });
    assert.equal(await alertStaffAboutChat("c1", "new", send), 3);
    assert.deepEqual(sent.map((s) => s.to).sort(), ["boss", "cm", "sup"]);
    assert.equal(sent[0].title, "Someone is asking for support");
    assert.equal(sent[0].body, "Moses · Rider app: My payment never arrived and the job is closed");
    assert.equal(sent[0].url, "/support-chat");
    assert.equal(sent[0].tag, "support-chat-c1");
    const row = (await client.execute("SELECT alert_count, alerted_at FROM support_chats WHERE id = 'c1'")).rows[0];
    assert.equal(Number(row.alert_count), 1);
    assert.ok(row.alerted_at);
  });

  await t.test("a chat that is not waiting is never alerted about", async () => {
    sent.length = 0;
    await newChat("c2", "human");
    assert.equal(await alertStaffAboutChat("c2", "new", send), 0);
    assert.equal(sent.length, 0);
  });

  await t.test("the admin can turn alerts off", async () => {
    await client.execute("INSERT INTO settings (key, value) VALUES ('support_chat_alerts_enabled', '0')");
    invalidateSettingsCache();
    sent.length = 0;
    assert.equal(await alertStaffAboutChat("c1", "reminder", send), 0);
    assert.deepEqual(await sweepSupportChats(send), { closed: true, reminded: 0 });
    await client.execute("DELETE FROM settings WHERE key = 'support_chat_alerts_enabled'");
    invalidateSettingsCache();
    assert.equal(sent.length, 0);
  });

  await t.test("a chat nobody has answered is reminded after the set time, a limited number of times", async () => {
    sent.length = 0;
    assert.equal((await sweepSupportChats(send)).reminded, 0, "not yet: it was alerted a moment ago");
    await client.execute("UPDATE support_chats SET alerted_at = datetime('now', '-6 minutes') WHERE id = 'c1'");
    assert.equal((await sweepSupportChats(send)).reminded, 1);
    assert.equal(sent[0].title, "A support chat is still waiting");
    assert.equal(sent[0].tag, "support-chat-c1", "replaces the earlier notification instead of stacking");
    // 4 reminders at most (alert_count counts the first alert too, so 5)
    for (let i = 0; i < 6; i++) {
      await client.execute("UPDATE support_chats SET alerted_at = datetime('now', '-6 minutes') WHERE id = 'c1'");
      await sweepSupportChats(send);
    }
    assert.equal(Number((await client.execute("SELECT alert_count FROM support_chats WHERE id = 'c1'")).rows[0].alert_count), 5);
  });

  await t.test("once someone takes the chat, the reminders stop", async () => {
    await newChat("c3", "waiting", { text: "Hello" });
    await alertStaffAboutChat("c3", "new", send);
    await client.execute("UPDATE support_chats SET status = 'human', alerted_at = datetime('now', '-30 minutes') WHERE id = 'c3'");
    sent.length = 0;
    await sweepSupportChats(send);
    assert.equal(sent.filter((s) => s.tag === "support-chat-c3").length, 0);
  });

  await t.test("the sweep also closes abandoned chats", async () => {
    await newChat("c4", "waiting");
    await client.execute("UPDATE support_chats SET updated_at = datetime('now', '-3 hours') WHERE id = 'c4'");
    await sweepSupportChats(send);
    assert.equal((await client.execute("SELECT status FROM support_chats WHERE id = 'c4'")).rows[0].status, "closed");
  });

  await t.test("a signed-in visitor is told when staff reply, unless they are looking at the chat", async () => {
    await newChat("c5", "human", { userId: "rid", userName: "Rita" });
    sent.length = 0;
    assert.equal(await notifyVisitorOfReply("c5", "Hello Rita, I have found your payment.", send), true);
    assert.deepEqual([sent[0].to, sent[0].title, sent[0].url], ["rid", "Peebee Support replied", "/help"]);
    await client.execute("UPDATE support_chats SET visitor_seen_at = datetime('now') WHERE id = 'c5'");
    sent.length = 0;
    assert.equal(await notifyVisitorOfReply("c5", "Another message", send), false, "they have the chat open");
    await newChat("c6", "human");
    assert.equal(await notifyVisitorOfReply("c6", "Hi", send), false, "an anonymous visitor cannot be pushed");
    assert.equal(sent.length, 0);
  });

  await t.test("the staff summary counts waiting chats, marks staff online and is for chat staff only", async () => {
    assert.equal((await staff("cust", "GET", "/admin/support-chats/summary")).status, 403);
    assert.equal((await staff("fin", "GET", "/admin/support-chats/summary")).status, 403);
    assert.equal(await agentsOnline(), 0);
    await client.execute("UPDATE support_chats SET status = 'closed'");
    await newChat("w1", "waiting");
    await client.execute("UPDATE support_chats SET handoff_at = datetime('now', '-4 minutes') WHERE id = 'w1'");
    await newChat("w2", "waiting");
    const res = await json(await staff("sup", "GET", "/admin/support-chats/summary"));
    assert.deepEqual([res.ready, res.waiting, res.mine, res.agentsOnline, res.alertsEnabled], [true, 2, 0, 1, true]);
    assert.ok(res.newestWaitingAt >= res.oldestWaitingAt);
    await staff("boss", "GET", "/admin/support-chats/summary");
    assert.equal(await agentsOnline(), 2);
    await client.execute("UPDATE support_agent_presence SET last_seen_at = datetime('now', '-5 minutes') WHERE user_id = 'sup'");
    assert.equal(await agentsOnline(), 1, "staff who stopped polling drop off");
  });

  await t.test("a real push goes to every device staff subscribed, when a visitor asks for a person", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    for (const [id, endpoint] of [["sup", "https://push.example/sup-phone"], ["sup", "https://push.example/sup-laptop"], ["fin", "https://push.example/fin-phone"]]) {
      await client.execute({ sql: "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)", args: [`p-${endpoint.slice(-8)}`, id, endpoint, p256dh, b64url(crypto.getRandomValues(new Uint8Array(16)))] });
    }
    const hits: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => { hits.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
    try {
      const made = await json(await app.request("/v1/support-chat", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "8.8.8.8" }, body: JSON.stringify({ app: "customer" }) }));
      await app.request(`/v1/support-chat/${made.id}/handoff`, { method: "POST", headers: { "X-Chat-Secret": made.secret, "Content-Type": "application/json", "cf-connecting-ip": "8.8.8.8" } });
    } finally { globalThis.fetch = realFetch; }
    assert.deepEqual(hits.sort(), ["https://push.example/sup-laptop", "https://push.example/sup-phone"], "the support manager's two devices, not finance");
  });
});
