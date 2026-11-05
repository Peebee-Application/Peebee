import { hasPermission, supportAppLabel, type AdminRole } from "@peebee/shared";
import { db } from "../db/client.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { notifyUser, type PushPayload } from "../lib/webpush.js";
import { getAvailability } from "./availability.js";

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

/**
 * Chats left with a person or in the queue and gone quiet are closed, so the queue never fills with abandoned chats.
 * A message left while the team was away waits much longer (it is a message, not a person standing by).
 */
export async function closeIdleChats(): Promise<void> {
  const o = await getOptions(["support_chat_idle_close_minutes", "support_chat_offline_keep_hours"]);
  const offline = await hasColumn("support_chats", "left_offline");
  await db.execute({
    sql: `UPDATE support_chats SET status = 'closed', closed_at = datetime('now') WHERE status IN ('waiting', 'human') ${offline ? "AND left_offline = 0 " : ""}AND updated_at < datetime('now', ?)`,
    args: [`-${Number(o.support_chat_idle_close_minutes)} minutes`],
  });
  if (offline) {
    await db.execute({
      sql: "UPDATE support_chats SET status = 'closed', closed_at = datetime('now') WHERE status IN ('waiting', 'human') AND left_offline = 1 AND updated_at < datetime('now', ?)",
      args: [`-${Number(o.support_chat_offline_keep_hours)} hours`],
    });
  }
}

/** Push to every staff device that can answer chats. Returns how many people it was sent to. */
export async function alertStaffAboutChat(chatId: string, kind: "new" | "reminder", send: Send = notifyUser): Promise<number> {
  const o = await getOptions(["support_chat_alerts_enabled"]);
  if (o.support_chat_alerts_enabled !== true) return 0;
  const identity = await hasColumn("support_chats", "app");
  const offlineCol = await hasColumn("support_chats", "left_offline");
  const chat = (await db.execute({
    sql: `SELECT id, status${identity ? ", app, user_name" : ""}${offlineCol ? ", left_offline" : ""}, (SELECT body FROM support_messages m WHERE m.chat_id = support_chats.id AND m.sender = 'user' ORDER BY m.id DESC LIMIT 1) AS last_text FROM support_chats WHERE id = ?`,
    args: [chatId],
  })).rows[0] as Row | undefined;
  if (!chat || chat.status !== "waiting") return 0;
  const who = chat.user_name ? String(chat.user_name) : "A visitor";
  const where = supportAppLabel((chat.app as string | null | undefined) ?? null);
  const left = Number(chat.left_offline) === 1;
  const payload: PushPayload = {
    title: left ? (kind === "new" ? "A message was left for support" : "A left message is still waiting") : kind === "new" ? "Someone is asking for support" : "A support chat is still waiting",
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
  // A message left while the team was away is not nagged about overnight: reminders start once someone can answer.
  const teamOn = (await getAvailability()).state === "online";
  const offlineCol = await hasColumn("support_chats", "left_offline");
  for (const r of due.rows as Row[]) {
    if (offlineCol && !teamOn) {
      const left = (await db.execute({ sql: "SELECT left_offline FROM support_chats WHERE id = ?", args: [String(r.id)] })).rows[0] as Row | undefined;
      if (Number(left?.left_offline) === 1) continue;
    }
    if ((await alertStaffAboutChat(String(r.id), "reminder", send)) > 0) reminded += 1;
  }
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

export { agentsOnline, touchAgentPresence } from "./presence.js";
