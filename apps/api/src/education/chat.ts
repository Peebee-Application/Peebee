/**
 * School messaging: learners and parents talk to a school, and the school's owner replies. The same model as restaurant
 * chat (../restaurants/chat.ts): one continuous thread per (school, person), a learner or parent is any signed-in customer
 * account, and the teacher side is the school owner. Calls placed from a thread are logged in it (../calls/routes.ts).
 *
 * Admin controls it (Learn settings): messaging and calls on or off, the longest message and messages per hour.
 * Needs migration 0157; until it is applied every route answers 503 "upgrade_pending" and the apps hide the button.
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { notifyUser } from "../lib/webpush.js";
import { getLearnSettings } from "./settings.js";
import { body as readBody, fail, isResponse, one } from "./studio.js";

type Row = Record<string, unknown>;

export const schoolChatRoutes = new Hono();

const chatReady = () => hasTable("school_chat_messages");

const clean = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().min(1).max(max));

function preview(type: string, body: string | null): string {
  if (type === "call") return "📞 " + (body ?? "Call");
  return body && body.length > 60 ? `${body.slice(0, 60)}…` : body || "";
}

/** Settings and table checks every route starts with. Returns a response to send back, or the settings. */
async function ready(c: Parameters<typeof fail>[0]) {
  const settings = await getLearnSettings();
  if (!settings.messagingEnabled) return fail(c, { status: 503, error: "messaging_off", message: "School messages are switched off right now." });
  if (!(await chatReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Messages aren't available yet. Try again shortly." });
  return settings;
}

async function schoolById(id: string): Promise<Row | null> {
  return one("SELECT id, owner_id, name, status FROM edu_schools WHERE id = ?", [id]);
}

async function quota(c: Parameters<typeof tooManyRequests>[0], userId: string, perHour: number) {
  const q = await consume(`learn-msg:${userId}`, perHour, 60 * 60);
  return q.allowed ? null : tooManyRequests(c, q, "You're sending a lot of messages. Take a short break and try again.");
}

const messagesOf = async (schoolId: string, customerId: string) =>
  (
    await db.execute({
      sql: `SELECT id, sender_role, body, type, call_id, call_status, call_duration_seconds, read, created_at
            FROM school_chat_messages WHERE school_id = ? AND customer_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 500`,
      args: [schoolId, customerId],
    })
  ).rows;

async function send(schoolId: string, customerId: string, role: "customer" | "school", body: string): Promise<string> {
  const id = newId("scm");
  await db.execute({
    sql: "INSERT INTO school_chat_messages (id, school_id, customer_id, sender_role, body) VALUES (?, ?, ?, ?, ?)",
    args: [id, schoolId, customerId, role, body],
  });
  return id;
}

// ---------------------------------------------------------------------------
// Learner or parent side: one thread per school.
// ---------------------------------------------------------------------------

schoolChatRoutes.get("/schools/:id", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const user = c.get("user");
  const school = await schoolById(c.req.param("id"));
  if (!school || school.status === "suspended") return fail(c, { status: 404, error: "not_found", message: "That school wasn't found." });
  return c.json({
    ok: true,
    schoolName: school.name,
    schoolOwnerId: school.owner_id,
    callsEnabled: g.callsEnabled,
    maxMessageChars: g.maxMessageChars,
    messages: await messagesOf(school.id as string, user.sub),
  });
});

schoolChatRoutes.post("/schools/:id", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const user = c.get("user");
  const school = await schoolById(c.req.param("id"));
  if (!school || school.status === "suspended") return fail(c, { status: 404, error: "not_found", message: "That school wasn't found." });
  if (school.owner_id === user.sub) return fail(c, { status: 400, error: "own_school", message: "This is your own school. Reply to messages from the Students tab." });
  const parsed = await readBody(c, z.object({ body: clean(g.maxMessageChars) }));
  if (!parsed.ok) return parsed.res;
  const slow = await quota(c, user.sub, g.messagesPerHour);
  if (slow) return slow;
  const text = (parsed.data as { body: string }).body;
  const id = await send(school.id as string, user.sub, "customer", text);
  notifyUser(school.owner_id as string, { title: user.name || "New message", body: preview("text", text), url: `/chat/${school.id}/${user.sub}`, tag: `school-chat-${school.id}-${user.sub}` }).catch(() => {});
  return c.json({ ok: true, id }, 201);
});

schoolChatRoutes.post("/schools/:id/read", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  await db.execute({ sql: "UPDATE school_chat_messages SET read = 1 WHERE school_id = ? AND customer_id = ? AND sender_role = 'school'", args: [c.req.param("id"), c.get("user").sub] });
  return c.json({ ok: true });
});

/** Every school this person has messaged, most recent first. */
schoolChatRoutes.get("/mine", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const user = c.get("user");
  const rows = (
    await db.execute({
      sql: `SELECT m.school_id, s.name AS school_name, MAX(m.created_at) AS last_at,
                   SUM(CASE WHEN m.sender_role = 'school' AND m.read = 0 THEN 1 ELSE 0 END) AS unread_count
            FROM school_chat_messages m JOIN edu_schools s ON s.id = m.school_id
            WHERE m.customer_id = ? GROUP BY m.school_id ORDER BY last_at DESC LIMIT 100`,
      args: [user.sub],
    })
  ).rows as Row[];
  const threads = await Promise.all(
    rows.map(async (r) => {
      const last = (await one("SELECT type, body FROM school_chat_messages WHERE school_id = ? AND customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [r.school_id, user.sub])) ?? {};
      return { schoolId: r.school_id, schoolName: r.school_name, lastMessagePreview: preview(String(last.type ?? "text"), (last.body as string | null) ?? null), lastMessageAt: r.last_at, unread: Number(r.unread_count ?? 0) > 0 };
    }),
  );
  return c.json({ ok: true, threads });
});

// ---------------------------------------------------------------------------
// Teacher side: the school owner sees every person who has messaged any of their schools.
// ---------------------------------------------------------------------------

schoolChatRoutes.get("/studio", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const user = c.get("user");
  const rows = (
    await db.execute({
      sql: `SELECT m.school_id, s.name AS school_name, m.customer_id, u.name AS customer_name, MAX(m.created_at) AS last_at,
                   SUM(CASE WHEN m.sender_role = 'customer' AND m.read = 0 THEN 1 ELSE 0 END) AS unread_count
            FROM school_chat_messages m
            JOIN edu_schools s ON s.id = m.school_id
            JOIN users u ON u.id = m.customer_id
            WHERE s.owner_id = ? GROUP BY m.school_id, m.customer_id ORDER BY last_at DESC LIMIT 200`,
      args: [user.sub],
    })
  ).rows as Row[];
  const threads = await Promise.all(
    rows.map(async (r) => {
      const last = (await one("SELECT type, body FROM school_chat_messages WHERE school_id = ? AND customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [r.school_id, r.customer_id])) ?? {};
      return { schoolId: r.school_id, schoolName: r.school_name, customerId: r.customer_id, customerName: r.customer_name, lastMessagePreview: preview(String(last.type ?? "text"), (last.body as string | null) ?? null), lastMessageAt: r.last_at, unread: Number(r.unread_count ?? 0) > 0 };
    }),
  );
  return c.json({ ok: true, threads });
});

/** The owner's own school, or a 404 (a school that belongs to someone else looks like it doesn't exist). */
async function ownSchool(c: Parameters<typeof fail>[0], schoolId: string): Promise<Row | Response> {
  const school = await one("SELECT id, owner_id, name FROM edu_schools WHERE id = ? AND owner_id = ?", [schoolId, c.get("user").sub]);
  return school ?? fail(c, { status: 404, error: "not_found", message: "That school wasn't found." });
}

schoolChatRoutes.get("/studio/:schoolId/:customerId", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const school = await ownSchool(c, c.req.param("schoolId"));
  if (isResponse(school)) return school;
  const customerId = c.req.param("customerId");
  const person = await one("SELECT name FROM users WHERE id = ?", [customerId]);
  return c.json({ ok: true, schoolName: school.name, customerName: person?.name ?? null, callsEnabled: g.callsEnabled, maxMessageChars: g.maxMessageChars, messages: await messagesOf(school.id as string, customerId) });
});

schoolChatRoutes.post("/studio/:schoolId/:customerId", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const school = await ownSchool(c, c.req.param("schoolId"));
  if (isResponse(school)) return school;
  const customerId = c.req.param("customerId");
  // A teacher answers people who wrote first; they can't start conversations with anyone.
  if (!(await one("SELECT 1 AS y FROM school_chat_messages WHERE school_id = ? AND customer_id = ? LIMIT 1", [school.id, customerId]))) {
    return fail(c, { status: 404, error: "not_found", message: "That conversation wasn't found." });
  }
  const parsed = await readBody(c, z.object({ body: clean(g.maxMessageChars) }));
  if (!parsed.ok) return parsed.res;
  const slow = await quota(c, c.get("user").sub, g.messagesPerHour);
  if (slow) return slow;
  const text = (parsed.data as { body: string }).body;
  const id = await send(school.id as string, customerId, "school", text);
  notifyUser(customerId, { title: String(school.name), body: preview("text", text), url: `/learn/messages/${school.id}`, tag: `school-chat-${school.id}-${customerId}` }).catch(() => {});
  return c.json({ ok: true, id }, 201);
});

schoolChatRoutes.post("/studio/:schoolId/:customerId/read", async (c) => {
  const g = await ready(c);
  if (isResponse(g)) return g;
  const school = await ownSchool(c, c.req.param("schoolId"));
  if (isResponse(school)) return school;
  await db.execute({ sql: "UPDATE school_chat_messages SET read = 1 WHERE school_id = ? AND customer_id = ? AND sender_role = 'customer'", args: [school.id as string, c.req.param("customerId")] });
  return c.json({ ok: true });
});
