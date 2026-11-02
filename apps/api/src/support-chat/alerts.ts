import { hasPermission, supportAppLabel, type AdminRole } from "@peebee/shared";
import { db } from "../db/client.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { notifyUser, type PushPayload } from "../lib/webpush.js";

/**
 * Telling people about support chats: staff when someone is waiting (and again if nobody has answered), and the visitor
 * when staff reply and they are not looking at the chat. Every part is best effort: a push that cannot be sent never
 * breaks the chat. How often and whether is an admin setting (Admin → Support chat → Settings).
 */

type Row = Record<string, unknown>;
type Send = (userId: string, payload: PushPayload) => Promise<void>;

const preview = (text: unknown, max = 90) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Active staff whose role can answer support chats. */
export async function supportStaffIds(): Promise<string[]> {
  const res = await db.execute("SELECT id, admin_role FROM users WHERE admin_role IS NOT NULL AND status = 'active'");
  return (res.rows as Row[]).filter((r) => hasPermission(r.admin_role as AdminRole, "chat.view_support")).map((r) => String(r.id));
}

/** Chats left with a person or in the queue and gone quiet are closed, so the queue never fills with abandoned chats. */
export async function closeIdleChats(): Promise<void> {
  const minutes = Number((await getOptions(["support_chat_idle_close_minutes"])).support_chat_idle_close_minutes);
  await db.execute({
    sql: "UPDATE support_chats SET status = 'closed', closed_at = datetime('now') WHERE status IN ('waiting', 'human') AND updated_at < datetime('now', ?)",
    args: [`-${minutes} minutes`],
  });
}

/** Push to every staff device that can answer chats. Returns how many people it was sent to. */
export async function alertStaffAboutChat(chatId: string, kind: "new" | "reminder", send: Send = notifyUser): Promise<number> {
  const o = await getOptions(["support_chat_alerts_enabled"]);
  if (o.support_chat_alerts_enabled !== true) return 0;
  const identity = await hasColumn("support_chats", "app");
  const chat = (await db.execute({
    sql: `SELECT id, status${identity ? ", app, user_name" : ""}, (SELECT body FROM support_messages m WHERE m.chat_id = support_chats.id AND m.sender = 'user' ORDER BY m.id DESC LIMIT 1) AS last_text FROM support_chats WHERE id = ?`,
    args: [chatId],
  })).rows[0] as Row | undefined;
  if (!chat || chat.status !== "waiting") return 0;
  const who = chat.user_name ? String(chat.user_name) : "A visitor";
  const where = supportAppLabel((chat.app as string | null | undefined) ?? null);
  const payload: PushPayload = {
    title: kind === "new" ? "Someone is asking for support" : "A support chat is still waiting",
    body: chat.last_text ? `${who} · ${where}: ${preview(chat.last_text)}` : `${who} · ${where} is waiting for a person`,
    url: "/support-chat",
    tag: `support-chat-${chatId}`,
  };
  const staff = await supportStaffIds();
  await Promise.all(staff.map((id) => send(id, payload).catch((err) => console.error("Support alert failed:", err instanceof Error ? err.message : err))));
  if (await hasColumn("support_chats", "alerted_at")) {
    await db.execute({ sql: "UPDATE support_chats SET alerted_at = datetime('now'), alert_count = alert_count + 1 WHERE id = ?", args: [chatId] });
  }
  return staff.length;
}

/** The scheduled job (every 2 minutes): close abandoned chats, and remind staff about chats nobody has answered. */
export async function sweepSupportChats(send: Send = notifyUser): Promise<{ closed: boolean; reminded: number }> {
  if (!(await hasTable("support_chats"))) return { closed: false, reminded: 0 };
  await closeIdleChats();
  if (!(await hasColumn("support_chats", "alerted_at"))) return { closed: true, reminded: 0 };
  const o = await getOptions(["support_chat_alerts_enabled", "support_chat_alert_repeat_minutes", "support_chat_alert_max_reminders"]);
  const every = Number(o.support_chat_alert_repeat_minutes);
  if (o.support_chat_alerts_enabled !== true || every <= 0) return { closed: true, reminded: 0 };
  // alert_count includes the first alert, so reminders sent = alert_count - 1.
  const due = await db.execute({
    sql: `SELECT id FROM support_chats WHERE status = 'waiting' AND alert_count >= 1 AND alert_count <= ? AND alerted_at <= datetime('now', ?) LIMIT 20`,
    args: [Number(o.support_chat_alert_max_reminders), `-${every} minutes`],
  });
  let reminded = 0;
  for (const r of due.rows as Row[]) if ((await alertStaffAboutChat(String(r.id), "reminder", send)) > 0) reminded += 1;
  return { closed: true, reminded };
}

/** Tell a signed-in visitor that staff replied, unless they have the chat open right now. */
export async function notifyVisitorOfReply(chatId: string, text: string, send: Send = notifyUser): Promise<boolean> {
  if (!(await hasColumn("support_chats", "visitor_seen_at"))) return false;
  const chat = (await db.execute({
    sql: "SELECT user_id, (visitor_seen_at IS NOT NULL AND visitor_seen_at > datetime('now', '-25 seconds')) AS watching FROM support_chats WHERE id = ?",
    args: [chatId],
  })).rows[0] as Row | undefined;
  if (!chat?.user_id || Number(chat.watching) === 1) return false;
  await send(String(chat.user_id), { title: "Peebee Support replied", body: preview(text, 120), url: "/help", tag: `support-reply-${chatId}` }).catch(() => undefined);
  return true;
}

/** Records that a staff member has the admin app open, so visitors can be told whether anyone is there. At most one write per 30 seconds each. */
export async function touchAgentPresence(userId: string, name: string): Promise<void> {
  if (!(await hasTable("support_agent_presence"))) return;
  await db.execute({
    sql: `INSERT INTO support_agent_presence (user_id, name, last_seen_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, last_seen_at = datetime('now') WHERE last_seen_at < datetime('now', '-30 seconds')`,
    args: [userId, name],
  });
}

/** Staff who had the admin app open in the last 90 seconds. Null when it cannot be told (migration 0154 not applied). */
export async function agentsOnline(): Promise<number | null> {
  if (!(await hasTable("support_agent_presence"))) return null;
  const res = await db.execute("SELECT COUNT(*) AS n FROM support_agent_presence WHERE last_seen_at > datetime('now', '-90 seconds')");
  return Number((res.rows[0] as Row).n) || 0;
}
