import { Hono, type Context } from "hono";
import { z } from "zod";
import { isSupportApp, supportAppLabel } from "@peebee/shared";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { verifyToken } from "../auth/jwt.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { migrationPending, publicRateLimit } from "../lib/guards.js";
import { newId } from "../lib/ids.js";
import { getOptions } from "../lib/option-settings.js";
import { clientIp, hashKey } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getRawSetting, setRawSetting } from "../lib/settings.js";
import { AI_UNAVAILABLE_REPLY, AI_OFF_REPLY, askAssistant, type ChatTurn } from "./ai.js";
import { agentsOnline, alertStaffAboutChat, closeIdleChats, notifyVisitorOfReply, touchAgentPresence } from "./alerts.js";
import { getAvailability, hasOfflineColumn } from "./availability.js";
import { SUPPORT_KNOWLEDGE } from "./knowledge.js";

/**
 * Website support chat. A visitor starts in "ai" with the assistant; "Talk to a person" moves the chat to "waiting"
 * (the admin inbox queue), a staff member claims it ("human"), and either side can end it. The browser polls, so it
 * works on plain Workers with no socket server. Everything that defines behaviour is an admin setting (module "support").
 */

export const supportChatRoutes = new Hono();
type Row = Record<string, unknown>;

const NOTES_KEY = "support_chat_ai_notes";
const MAX_TEXT = 1000;
const TABLES = ["support_chats", "support_messages"] as const;

const shaHex = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((b) => b.toString(16).padStart(2, "0")).join("");

const idOf = (c: Context) => c.req.param("id") ?? "";
/** Which apps may show the chat (Admin → Support chat → Settings). A call with no app is the website. */
async function appEnabled(app: string | null): Promise<boolean> {
  const apps = (await getOptions(["support_chat_apps"])).support_chat_apps as string[];
  return apps.includes(app ?? "website");
}

/** Who is signed in, if the request carries a valid token. Never fails the request: a bad or missing token is just an anonymous visitor. */
async function signedInPerson(c: Context): Promise<{ id: string; name: string; role: string } | null> {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = await verifyToken(header.slice(7));
    if (payload.practice || payload.guestOrderId) return null;
    const row = (await db.execute({ sql: "SELECT name, role, admin_role FROM users WHERE id = ? AND status = 'active'", args: [payload.sub] })).rows[0] as Row | undefined;
    return row ? { id: payload.sub, name: String(row.name ?? ""), role: row.admin_role ? "staff" : String(row.role) } : null;
  } catch {
    return null;
  }
}

const tablesReady = async () => (await Promise.all(TABLES.map(hasTable))).every(Boolean);

export type PublicMessage = { id: number; from: "user" | "ai" | "agent" | "system"; text: string; at: string; agentName?: string };
const toMessage = (r: Row): PublicMessage => ({
  id: Number(r.id), from: r.sender as PublicMessage["from"], text: String(r.body), at: String(r.created_at),
  ...(r.agent_name ? { agentName: String(r.agent_name) } : {}),
});

async function addMessage(chatId: string, sender: PublicMessage["from"], body: string, agentName?: string | null): Promise<PublicMessage> {
  const res = await db.execute({
    sql: "INSERT INTO support_messages (chat_id, sender, body, agent_name) VALUES (?, ?, ?, ?) RETURNING *",
    args: [chatId, sender, body, agentName ?? null],
  });
  await db.execute({ sql: "UPDATE support_chats SET updated_at = datetime('now') WHERE id = ?", args: [chatId] });
  return toMessage(res.rows[0] as Row);
}

async function messagesAfter(chatId: string, after: number, limit = 100): Promise<PublicMessage[]> {
  const res = await db.execute({ sql: "SELECT * FROM support_messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT ?", args: [chatId, after, limit] });
  return (res.rows as Row[]).map(toMessage);
}

/** What the visitor is told when they leave a message while nobody can answer. */
const awayNotice = (hours: string | null) =>
  `The team is away right now${hours ? ` (we are on ${hours})` : ""}. Your message is saved, and the team will reply here as soon as someone is back.`;

/** Runs best-effort work (a push) without making the visitor wait; on a Worker it is kept alive after the reply is sent. */
async function background(c: Context, work: Promise<unknown>): Promise<void> {
  const safe = work.catch((err) => console.error("Support chat background task failed:", err instanceof Error ? err.message : err));
  try { c.executionCtx.waitUntil(safe); } catch { await safe; }
}

async function queuePosition(chat: Row): Promise<number | null> {
  if (chat.status !== "waiting") return null;
  const res = await db.execute({ sql: "SELECT COUNT(*) AS n FROM support_chats WHERE status = 'waiting' AND handoff_at <= ?", args: [String(chat.handoff_at)] });
  return Number((res.rows[0] as Row).n) || 1;
}

// --------------------------------------------------------------------------------------------- visitor

async function loadOwnChat(c: Context): Promise<{ chat: Row } | { error: Response }> {
  const id = idOf(c);
  const secret = c.req.header("x-chat-secret") ?? "";
  const res = await db.execute({ sql: "SELECT * FROM support_chats WHERE id = ?", args: [id] });
  const chat = res.rows[0] as Row | undefined;
  // One answer for "no such chat" and "wrong secret" so ids cannot be probed.
  if (!chat || !secret || (await shaHex(secret)) !== chat.secret_hash) return { error: c.json({ error: "not_found" }, 404) };
  return { chat };
}

supportChatRoutes.get("/support-chat/config", async (c) => {
  const o = await getOptions(["support_chat_enabled", "support_chat_ai_enabled", "support_chat_human_enabled"]);
  const app = c.req.query("app") ?? null;
  const ready = o.support_chat_enabled === true && (await tablesReady()) && (await appEnabled(app));
  const availability = ready ? await getAvailability() : null;
  return c.json({ live: ready, aiEnabled: ready && o.support_chat_ai_enabled === true, humanEnabled: ready && o.support_chat_human_enabled === true, availability });
});

supportChatRoutes.post("/support-chat", async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  const o = await getOptions(["support_chat_enabled", "support_chat_ai_enabled", "support_chat_human_enabled"]);
  if (o.support_chat_enabled !== true) return c.json({ error: "disabled", message: "Chat is switched off." }, 503);
  const limited = await publicRateLimit(c, "support_chat_start", null, "rate_limit_support_chat_starts_per_hour", 3600);
  if (limited) return limited;
  const body = z.object({ page: z.string().trim().max(200).optional(), app: z.string().trim().max(30).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const app = body.success && isSupportApp(body.data.app) ? body.data.app : null;
  if (!(await appEnabled(app))) return c.json({ error: "disabled", message: "Chat is switched off here." }, 503);
  const person = await signedInPerson(c);
  const id = newId("sch");
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  // A chat with the assistant switched off starts in the queue.
  const availability = await getAvailability();
  const toQueue = o.support_chat_ai_enabled !== true && availability.offer !== "none";
  await db.execute({
    sql: `INSERT INTO support_chats (id, secret_hash, status, page, ip_hash, handoff_at) VALUES (?, ?, ?, ?, ?, ${toQueue ? "datetime('now')" : "NULL"})`,
    args: [id, await shaHex(secret), toQueue ? "waiting" : "ai", body.success ? (body.data.page ?? null) : null, await hashKey(clientIp(c))],
  });
  // Which app and who: written separately so chats still start before migration 0151 is applied.
  if (await hasColumn("support_chats", "app")) {
    await db.execute({ sql: "UPDATE support_chats SET app = ?, user_id = ?, user_name = ?, user_role = ? WHERE id = ?", args: [app, person?.id ?? null, person?.name ?? null, person?.role ?? null, id] });
  }
  if (toQueue) {
    const away = availability.offer === "message";
    if (away && (await hasOfflineColumn())) await db.execute({ sql: "UPDATE support_chats SET left_offline = 1 WHERE id = ?", args: [id] });
    await addMessage(id, "system", away ? awayNotice(availability.hours) : "Connecting you to a support agent…");
    await background(c, alertStaffAboutChat(id, "new"));
  }
  return c.json({ id, secret, status: toQueue ? "waiting" : "ai", aiEnabled: o.support_chat_ai_enabled === true, humanEnabled: o.support_chat_human_enabled === true }, 201);
});

/**
 * A signed-in person coming back to Help & support (a new tab, another device, the next day) picks up their latest chat from
 * their login, so a reply left while they were away is waiting for them. The chat's secret is only ever stored as a hash, so a
 * fresh one is issued, which means any older browser copy stops working: only the signed-in owner can do this.
 */
supportChatRoutes.post("/support-chat/resume", async (c) => {
  const person = await signedInPerson(c);
  if (!person || !(await tablesReady()) || !(await hasColumn("support_chats", "user_id"))) return c.json({ error: "none" }, 404);
  const body = z.object({ app: z.string().trim().max(30).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const app = body.success && isSupportApp(body.data.app) ? body.data.app : null;
  const row = (await db.execute({
    sql: `SELECT id FROM support_chats WHERE user_id = ? AND ${app ? "app = ?" : "1 = 1"} AND updated_at > datetime('now', '-7 days')
          ORDER BY CASE status WHEN 'closed' THEN 1 ELSE 0 END, updated_at DESC LIMIT 1`,
    args: app ? [person.id, app] : [person.id],
  })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "none" }, 404);
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await db.execute({ sql: "UPDATE support_chats SET secret_hash = ? WHERE id = ?", args: [await shaHex(secret), String(row.id)] });
  return c.json({ id: String(row.id), secret });
});

/** The poll: new messages since `after`, plus who the visitor is talking to. */
supportChatRoutes.get("/support-chat/:id", async (c) => {
  const own = await loadOwnChat(c);
  if ("error" in own) return own.error;
  const after = Math.max(0, Number(c.req.query("after")) || 0);
  const chat = own.chat;
  // So a reply is only pushed to someone who is not already looking at the chat (at most one write per 15 seconds).
  if (await hasColumn("support_chats", "visitor_seen_at")) {
    await db.execute({ sql: "UPDATE support_chats SET visitor_seen_at = datetime('now') WHERE id = ? AND (visitor_seen_at IS NULL OR visitor_seen_at < datetime('now', '-15 seconds'))", args: [String(chat.id)] });
  }
  return c.json({
    status: chat.status, agentName: chat.agent_name ?? null, position: await queuePosition(chat),
    leftOffline: Number(chat.left_offline) === 1,
    // So the waiting card can say honestly whether someone is there right now.
    availability: chat.status === "waiting" ? await getAvailability() : null,
    messages: await messagesAfter(String(chat.id), after),
  });
});

supportChatRoutes.post("/support-chat/:id/messages", async (c) => {
  const own = await loadOwnChat(c);
  if ("error" in own) return own.error;
  const parsed = z.object({ text: z.string().trim().min(1).max(MAX_TEXT) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: `Messages are 1 to ${MAX_TEXT} characters.` }, 400);
  const limited = await publicRateLimit(c, "support_chat_message", String(own.chat.id), "rate_limit_support_chat_messages_per_minute", 60);
  if (limited) return limited;

  const chatId = String(own.chat.id);
  const o = await getOptions(["support_chat_ai_enabled", "support_chat_max_messages", "support_chat_ai_context_messages"]);
  const sent = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM support_messages WHERE chat_id = ? AND sender = 'user'", args: [chatId] })).rows[0] as Row).n);
  if (sent >= Number(o.support_chat_max_messages)) return c.json({ error: "chat_full", message: "This chat has reached its message limit. Please start a new one." }, 429);

  // Writing to a chat a person has ended starts a fresh turn with the assistant.
  if (own.chat.status === "closed") await db.execute({ sql: "UPDATE support_chats SET status = 'ai', agent_id = NULL, agent_name = NULL, closed_at = NULL WHERE id = ?", args: [chatId] });
  const status = own.chat.status === "closed" ? "ai" : String(own.chat.status);

  const mine = await addMessage(chatId, "user", parsed.data.text);
  const created: PublicMessage[] = [mine];
  if (status === "ai") {
    if (o.support_chat_ai_enabled !== true) {
      created.push(await addMessage(chatId, "ai", AI_OFF_REPLY));
    } else {
      const recent = await db.execute({
        sql: "SELECT sender, body FROM support_messages WHERE chat_id = ? AND sender IN ('user', 'ai', 'agent') ORDER BY id DESC LIMIT ?",
        args: [chatId, Number(o.support_chat_ai_context_messages)],
      });
      // The "trouble answering" and "switched off" notices are not things the assistant said: leave them out so it never learns from its own errors.
      const history: ChatTurn[] = (recent.rows as Row[]).reverse()
        .filter((r) => r.body !== AI_UNAVAILABLE_REPLY && r.body !== AI_OFF_REPLY)
        .map((r) => ({ from: r.sender as ChatTurn["from"], text: String(r.body) }));
      let reply = AI_UNAVAILABLE_REPLY;
      try {
        reply = await askAssistant(history, (await getRawSetting(NOTES_KEY)) ?? "", supportAppLabel(own.chat.app as string | null));
      } catch (err) {
        console.error("support chat AI failed", err instanceof Error ? err.message : err);
      }
      created.push(await addMessage(chatId, "ai", reply));
    }
  }
  return c.json({ status, messages: created });
});

supportChatRoutes.post("/support-chat/:id/handoff", async (c) => {
  const own = await loadOwnChat(c);
  if ("error" in own) return own.error;
  const o = await getOptions(["support_chat_human_enabled"]);
  if (o.support_chat_human_enabled !== true) return c.json({ error: "disabled", message: "Talking to a person is not available right now." }, 403);
  const availability = await getAvailability();
  if (availability.offer === "none") {
    return c.json({ error: "team_away", message: `The team is away right now${availability.hours ? ` (we are on ${availability.hours})` : ""}. The assistant can keep helping you.` }, 403);
  }
  const body = z.object({ contact: z.string().trim().min(3).max(120).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const contact = body.success ? body.data.contact?.replace(/[\u0000-\u001f]/g, "") : undefined;
  const chatId = String(own.chat.id);
  if (own.chat.status === "ai" || own.chat.status === "closed") {
    const away = availability.offer === "message";
    await db.execute({ sql: "UPDATE support_chats SET status = 'waiting', agent_id = NULL, agent_name = NULL, closed_at = NULL, handoff_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [chatId] });
    if (await hasOfflineColumn()) await db.execute({ sql: "UPDATE support_chats SET left_offline = ?, contact = COALESCE(?, contact) WHERE id = ?", args: [away ? 1 : 0, contact ?? null, chatId] });
    await addMessage(chatId, "system", away ? awayNotice(availability.hours) : "Connecting you to a support agent…");
    await background(c, alertStaffAboutChat(chatId, "new"));
  }
  const chat = (await db.execute({ sql: "SELECT * FROM support_chats WHERE id = ?", args: [chatId] })).rows[0] as Row;
  return c.json({ status: chat.status, position: await queuePosition(chat), leftOffline: Number(chat.left_offline) === 1, availability });
});

/** Visitor leaves the person (or the queue) and goes back to the assistant. */
supportChatRoutes.post("/support-chat/:id/end", async (c) => {
  const own = await loadOwnChat(c);
  if ("error" in own) return own.error;
  const chatId = String(own.chat.id);
  if (own.chat.status === "waiting" || own.chat.status === "human" || own.chat.status === "closed") {
    await db.execute({ sql: "UPDATE support_chats SET status = 'ai', agent_id = NULL, agent_name = NULL, closed_at = NULL, updated_at = datetime('now') WHERE id = ?", args: [chatId] });
    if (own.chat.status === "human") await addMessage(chatId, "system", "The visitor went back to the AI assistant");
  }
  return c.json({ status: "ai" });
});

// --------------------------------------------------------------------------------------------- staff

const gate = [requireAuth, requireRole("admin"), requirePermission("chat.view_support")] as const;
const staffName = (c: Context) => String(c.get("user").name || "Support agent");

supportChatRoutes.get("/admin/support-chats", ...gate, async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  await closeIdleChats();
  const view = c.req.query("view") === "all" ? "all" : "open";
  const identity = await hasColumn("support_chats", "app");
  const offlineCol = await hasOfflineColumn();
  const res = await db.execute(
    `SELECT c.id, c.status, c.agent_id, c.agent_name, c.page, c.handoff_at, c.created_at, c.updated_at, ${identity ? "c.app, c.user_name, c.user_role," : "NULL AS app, NULL AS user_name, NULL AS user_role,"} ${offlineCol ? "c.contact, c.left_offline," : "NULL AS contact, 0 AS left_offline,"}
            (SELECT body FROM support_messages m WHERE m.chat_id = c.id AND m.sender != 'system' ORDER BY m.id DESC LIMIT 1) AS last_text,
            (SELECT sender FROM support_messages m WHERE m.chat_id = c.id AND m.sender != 'system' ORDER BY m.id DESC LIMIT 1) AS last_from,
            (SELECT COUNT(*) FROM support_messages m WHERE m.chat_id = c.id AND m.sender = 'user') AS visitor_messages
       FROM support_chats c
      WHERE ${view === "all" ? "1 = 1" : "c.status IN ('waiting', 'human')"}
      ORDER BY CASE c.status WHEN 'waiting' THEN 0 WHEN 'human' THEN 1 ELSE 2 END, COALESCE(c.handoff_at, c.updated_at) ASC
      LIMIT 100`,
  );
  const me = c.get("user").sub;
  return c.json({
    chats: (res.rows as Row[]).map((r) => ({
      id: r.id, status: r.status, agentName: r.agent_name ?? null, mine: r.agent_id === me, page: r.page ?? null,
      contact: r.contact ?? null, leftOffline: Number(r.left_offline) === 1,
      app: r.app ?? null, appLabel: supportAppLabel(r.app as string | null), person: r.user_name ? `${r.user_name}${r.user_role ? ` (${r.user_role})` : ""}` : null,
      waitingSince: r.handoff_at ?? null, startedAt: r.created_at, updatedAt: r.updated_at,
      lastText: r.last_text ?? null, lastFrom: r.last_from ?? null, visitorMessages: Number(r.visitor_messages),
    })),
  });
});

/**
 * What the admin app polls to show a badge, play a sound and tell visitors someone is here: how many chats are waiting, which
 * is the newest, and how many staff have the admin app open. Calling it also marks this staff member as online.
 */
supportChatRoutes.get("/admin/support-chats/summary", ...gate, async (c) => {
  if (!(await tablesReady())) return c.json({ ready: false, waiting: 0, mine: 0, newestWaitingAt: null, oldestWaitingAt: null, agentsOnline: null });
  const user = c.get("user");
  await touchAgentPresence(user.sub, staffName(c));
  const res = await db.execute({
    sql: `SELECT SUM(status = 'waiting') AS waiting, SUM(status = 'human' AND agent_id = ?) AS mine,
                 MAX(CASE WHEN status = 'waiting' THEN handoff_at END) AS newest, MIN(CASE WHEN status = 'waiting' THEN handoff_at END) AS oldest
            FROM support_chats WHERE status IN ('waiting', 'human')`,
    args: [user.sub],
  });
  const r = res.rows[0] as Row;
  const o = await getOptions(["support_chat_alerts_enabled"]);
  return c.json({ ready: true, waiting: Number(r.waiting) || 0, mine: Number(r.mine) || 0, newestWaitingAt: r.newest ?? null, oldestWaitingAt: r.oldest ?? null, agentsOnline: await agentsOnline(), alertsEnabled: o.support_chat_alerts_enabled === true });
});

supportChatRoutes.get("/admin/support-chats/:id", ...gate, async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  const chat = (await db.execute({ sql: "SELECT * FROM support_chats WHERE id = ?", args: [idOf(c)] })).rows[0] as Row | undefined;
  if (!chat) return c.json({ error: "not_found" }, 404);
  const after = Math.max(0, Number(c.req.query("after")) || 0);
  return c.json({
    id: chat.id, status: chat.status, agentName: chat.agent_name ?? null, mine: chat.agent_id === c.get("user").sub, page: chat.page ?? null,
    contact: chat.contact ?? null, leftOffline: Number(chat.left_offline) === 1,
    appLabel: supportAppLabel((chat.app as string | null) ?? null), person: chat.user_name ? `${chat.user_name}${chat.user_role ? ` (${chat.user_role})` : ""}` : null,
    messages: await messagesAfter(String(chat.id), after, 500),
  });
});

supportChatRoutes.post("/admin/support-chats/:id/claim", ...gate, async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  const user = c.get("user");
  // Only a waiting chat can be claimed, and only once: the first agent to press the button wins.
  const res = await db.execute({
    sql: "UPDATE support_chats SET status = 'human', agent_id = ?, agent_name = ?, updated_at = datetime('now') WHERE id = ? AND status = 'waiting' RETURNING id",
    args: [user.sub, staffName(c), idOf(c)],
  });
  if (res.rows.length === 0) return c.json({ error: "not_waiting", message: "Someone else already took this chat, or the visitor left." }, 409);
  await addMessage(idOf(c), "system", `${staffName(c)} joined the chat`);
  return c.json({ ok: true });
});

supportChatRoutes.post("/admin/support-chats/:id/messages", ...gate, async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  const parsed = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const chat = (await db.execute({ sql: "SELECT * FROM support_chats WHERE id = ?", args: [idOf(c)] })).rows[0] as Row | undefined;
  if (!chat) return c.json({ error: "not_found" }, 404);
  if (chat.status !== "human" || chat.agent_id !== c.get("user").sub) return c.json({ error: "not_yours", message: "Claim this chat before replying." }, 409);
  const message = await addMessage(String(chat.id), "agent", parsed.data.text, String(chat.agent_name ?? staffName(c)));
  await background(c, notifyVisitorOfReply(String(chat.id), parsed.data.text));
  return c.json({ message }, 201);
});

supportChatRoutes.post("/admin/support-chats/:id/close", ...gate, async (c) => {
  const pending = await migrationPending(c, "0150_support_chat.sql", ...TABLES);
  if (pending) return pending;
  const res = await db.execute({
    sql: "UPDATE support_chats SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status IN ('waiting', 'human') RETURNING id",
    args: [idOf(c)],
  });
  if (res.rows.length === 0) return c.json({ error: "not_open" }, 409);
  await addMessage(idOf(c), "system", "The support agent ended the chat");
  return c.json({ ok: true });
});

// What the assistant is told beyond its built-in prompt (policies, opening hours, links). Plain text kept by the team.
const notesGate = [requireAuth, requireRole("admin"), requirePermission("settings.manage")] as const;
supportChatRoutes.get("/admin/support-chat/ai-notes", ...notesGate, async (c) => c.json({ notes: (await getRawSetting(NOTES_KEY)) ?? "", maxLength: 6000, builtIn: SUPPORT_KNOWLEDGE }));

/**
 * "Try the assistant": ask it a question exactly as a visitor would, using the notes as typed (saved or not), without
 * starting a chat. This is how the team checks what their notes change before saving them.
 */
supportChatRoutes.post("/admin/support-chat/ai-test", ...notesGate, async (c) => {
  const parsed = z.object({
    question: z.string().trim().min(1).max(MAX_TEXT),
    notes: z.string().max(6000).optional(),
    app: z.string().trim().max(30).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const notes = parsed.data.notes ?? (await getRawSetting(NOTES_KEY)) ?? "";
  try {
    const reply = await askAssistant([{ from: "user", text: parsed.data.question }], notes, supportAppLabel(isSupportApp(parsed.data.app) ? parsed.data.app : null));
    return c.json({ reply });
  } catch (err) {
    return c.json({ error: "ai_failed", message: err instanceof Error ? err.message.slice(0, 300) : "The assistant could not answer." }, 502);
  }
});
supportChatRoutes.put("/admin/support-chat/ai-notes", ...notesGate, async (c) => {
  const parsed = z.object({ notes: z.string().max(6000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Notes can be up to 6000 characters." }, 400);
  const before = (await getRawSetting(NOTES_KEY)) ?? "";
  await setRawSetting(NOTES_KEY, parsed.data.notes);
  await logActivity({ actor: c.get("user"), action: "support_chat.ai_notes", entityType: "settings", summary: "Updated what the support chat assistant knows", before: { notes: before }, after: { notes: parsed.data.notes }, ip: clientIp(c) });
  return c.json({ notes: parsed.data.notes });
});
