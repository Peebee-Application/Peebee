import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "../db/client.js";
import { sendPlainEmail } from "../lib/email-gateway.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getSetting, type SettingKey } from "../lib/settings.js";
import { sendSms } from "../lib/sms-gateway.js";
import { notifyUser } from "../lib/webpush.js";

export type AlertChannel = "email" | "sms" | "chat" | "notifications" | "push";
export type AlertEvent = "sent" | "received";

export const ALERT_CHANNELS: AlertChannel[] = ["email", "sms", "chat", "notifications", "push"];
export const ALERT_EVENTS: AlertEvent[] = ["sent", "received"];

const ALERT_KEYS = {
  email: { sent: "wallet_alert_email_sent", received: "wallet_alert_email_received" },
  sms: { sent: "wallet_alert_sms_sent", received: "wallet_alert_sms_received" },
  chat: { sent: "wallet_alert_chat_sent", received: "wallet_alert_chat_received" },
  notifications: { sent: "wallet_alert_notifications_sent", received: "wallet_alert_notifications_received" },
  push: { sent: "wallet_alert_push_sent", received: "wallet_alert_push_received" },
} as const satisfies Record<AlertChannel, Record<AlertEvent, SettingKey>>;

export function alertSettingKey(channel: AlertChannel, event: AlertEvent): SettingKey {
  return ALERT_KEYS[channel][event];
}

export type WalletAlertSettings = Record<AlertChannel, Record<AlertEvent, boolean>>;

/** SMS defaults off (it is charged per message). Every other channel defaults on. */
export function alertSettingsFromValues(values: Record<string, string | undefined>): WalletAlertSettings {
  const on = (channel: AlertChannel, event: AlertEvent) => {
    const raw = values[alertSettingKey(channel, event)];
    return channel === "sms" ? raw === "1" : raw !== "0";
  };
  return {
    email: { sent: on("email", "sent"), received: on("email", "received") },
    sms: { sent: on("sms", "sent"), received: on("sms", "received") },
    chat: { sent: on("chat", "sent"), received: on("chat", "received") },
    notifications: { sent: on("notifications", "sent"), received: on("notifications", "received") },
    push: { sent: on("push", "sent"), received: on("push", "received") },
  };
}

export function channelsFor(settings: WalletAlertSettings, event: AlertEvent): AlertChannel[] {
  return ALERT_CHANNELS.filter((channel) => settings[channel][event]);
}

export async function getWalletAlertSettings(): Promise<WalletAlertSettings> {
  const pairs = await Promise.all(
    ALERT_CHANNELS.flatMap((channel) =>
      ALERT_EVENTS.map(async (event) => [alertSettingKey(channel, event), await getSetting(alertSettingKey(channel, event))] as const),
    ),
  );
  return alertSettingsFromValues(Object.fromEntries(pairs));
}

export type MoneyMove = {
  transferId: string;
  amount: number;
  fromUserId: string;
  toUserId: string;
  fromWalletId?: string;
  toWalletId?: string;
  /** Extra context, such as a cause or channel name. */
  context?: string;
};

type Party = { id: string; name: string; email: string | null; phone: string | null };

const memoryClaims = new Set<string>();

type WaitSlot = { waitUntil(promise: Promise<unknown>): void };
const alertWait = new AsyncLocalStorage<WaitSlot>();

/** Keeps alert work alive after the response on a Worker. */
export function withMoneyAlertWait<T>(waitUntil: (promise: Promise<unknown>) => void, run: () => Promise<T>): Promise<T> {
  return alertWait.run({ waitUntil }, run);
}

let deliveryOverride: ((input: MoneyMove) => Promise<void>) | null = null;
/** Test seam. A throwing stand-in must not fail the transfer. */
export function setMoneyAlertDeliveryForTests(fn: typeof deliveryOverride): void {
  deliveryOverride = fn;
}

export function alertText(input: {
  event: AlertEvent;
  amount: number;
  counterpartName: string;
  accountName: string;
  reference: string;
  at: string;
  context?: string;
}): { title: string; body: string } {
  const amount = `UGX ${Math.round(input.amount).toLocaleString("en-UG")}`;
  const when = new Date(input.at).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
  const context = input.context ? ` ${input.context}.` : "";
  if (input.event === "sent") {
    return {
      title: "Money sent",
      body: `You sent ${amount} to ${input.counterpartName} from ${input.accountName}.${context} Reference ${input.reference}. ${when}.`,
    };
  }
  return {
    title: "Money received",
    body: `You received ${amount} from ${input.counterpartName} into ${input.accountName}.${context} Reference ${input.reference}. ${when}.`,
  };
}

async function claim(transferId: string, userId: string, channel: string): Promise<boolean> {
  const key = `${transferId}\u0000${userId}\u0000${channel}`;
  if (memoryClaims.has(key)) return false;
  memoryClaims.add(key);
  if (!(await hasTable("wallet_alert_sends"))) return true;
  try {
    const res = await db.execute({
      sql: "INSERT OR IGNORE INTO wallet_alert_sends (transfer_id, user_id, channel) VALUES (?, ?, ?)",
      args: [transferId, userId, channel],
    });
    return (res.rowsAffected ?? 0) > 0;
  } catch (err) {
    console.error("wallet alert claim failed", err);
    return true;
  }
}

async function person(id: string): Promise<Party | null> {
  const row = (await db.execute({ sql: "SELECT id, name, email, phone FROM users WHERE id = ?", args: [id] })).rows[0] as unknown as
    | { id: string; name: string; email: string | null; phone: string | null }
    | undefined;
  if (!row) return null;
  return { id: String(row.id), name: String(row.name || "Someone"), email: row.email ? String(row.email) : null, phone: row.phone ? String(row.phone) : null };
}

async function accountName(userId: string, walletId?: string): Promise<string> {
  if (!walletId) return "Main account";
  const row = (await db.execute({ sql: "SELECT name FROM wallets WHERE id = ? AND owner_id = ?", args: [walletId, userId] })).rows[0] as
    | { name?: string }
    | undefined;
  const name = row?.name ? String(row.name).trim() : "";
  return name || "Main account";
}

async function deliverChannel(channel: AlertChannel, user: Party, event: AlertEvent, title: string, body: string, transferId: string, amount: number, counterpartName: string, account: string): Promise<void> {
  if (channel === "email") {
    if (!user.email) return;
    await sendPlainEmail(user.email, `Peebee: ${title}`, body);
    return;
  }
  if (channel === "sms") {
    if (!user.phone) return;
    await sendSms(user.phone, `Peebee: ${body}`);
    return;
  }
  if (channel === "push") {
    await notifyUser(user.id, { title, body, url: "/notifications", tag: `wallet-${transferId}-${event}` });
    return;
  }
  if (channel === "chat") {
    await db.execute({
      sql: `INSERT OR IGNORE INTO chat_messages (id, order_id, sender_id, sender_role, body, type, customer_id, rider_id)
            VALUES (?, NULL, ?, 'system', ?, 'text', ?, NULL)`,
      args: [`wmsg_${transferId}_${user.id}_${event}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 120), user.id, body, user.id],
    });
    return;
  }
  if (!(await hasTable("wallet_alerts"))) return;
  await db.execute({
    sql: `INSERT OR IGNORE INTO wallet_alerts
            (id, user_id, transfer_id, event, title, body, amount, counterpart_name, account_name, reference)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId("walt"), user.id, transferId, event, title, body, Math.round(amount), counterpartName, account, transferId],
  });
}

async function tell(input: MoneyMove, event: AlertEvent, user: Party, counterpartName: string, account: string, settings: WalletAlertSettings): Promise<void> {
  const at = new Date().toISOString();
  const { title, body } = alertText({ event, amount: input.amount, counterpartName, accountName: account, reference: input.transferId, at, context: input.context });
  for (const channel of channelsFor(settings, event)) {
    if (!(await claim(input.transferId, user.id, `${event}:${channel}`))) continue;
    try {
      await deliverChannel(channel, user, event, title, body, input.transferId, input.amount, counterpartName, account);
    } catch (err) {
      console.error(`wallet ${channel} alert failed`, err);
    }
  }
}

/** Best-effort alerts for both people. Never throws. */
export async function notifyMoneyMove(input: MoneyMove): Promise<void> {
  try {
    if (!input.transferId || input.fromUserId === input.toUserId || !(input.amount > 0)) return;
    if (deliveryOverride) {
      await deliveryOverride(input);
      return;
    }
    const [settings, from, to, fromAccount, toAccount] = await Promise.all([
      getWalletAlertSettings(),
      person(input.fromUserId),
      person(input.toUserId),
      accountName(input.fromUserId, input.fromWalletId),
      accountName(input.toUserId, input.toWalletId),
    ]);
    if (from && to) {
      await tell(input, "sent", from, to.name, fromAccount, settings);
      await tell(input, "received", to, from.name, toAccount, settings);
    }
  } catch (err) {
    console.error("wallet alert failed", err);
  }
}

let pending: Promise<void> = Promise.resolve();

/** Runs after the money has moved. Does not delay or fail the transfer. */
export function scheduleMoneyAlert(input: MoneyMove): void {
  const task = notifyMoneyMove(input);
  pending = Promise.all([pending, task]).then(() => undefined);
  const slot = alertWait.getStore();
  if (slot) slot.waitUntil(task);
  else void task;
}

/** Tests wait for the best-effort work that a transfer does not await. */
export function flushMoneyAlerts(): Promise<void> {
  return pending;
}

export type PeebeeThread = { preview: string; lastAt: string; unread: boolean } | null;

export async function loadPeebeeThread(userId: string): Promise<PeebeeThread> {
  if (await hasTable("wallet_alerts")) {
    const row = (await db.execute({
      sql: "SELECT body, created_at, read_at FROM wallet_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [userId],
    })).rows[0] as { body?: string; created_at?: string; read_at?: string | null } | undefined;
    if (!row) return null;
    const unreadRow = (await db.execute({
      sql: "SELECT 1 FROM wallet_alerts WHERE user_id = ? AND read_at IS NULL LIMIT 1",
      args: [userId],
    })).rows[0];
    return { preview: String(row.body ?? ""), lastAt: String(row.created_at ?? ""), unread: !!unreadRow };
  }
  const row = (await db.execute({
    sql: `SELECT body, created_at FROM chat_messages
          WHERE customer_id = ? AND sender_role = 'system' AND rider_id IS NULL AND order_id IS NULL
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId],
  })).rows[0] as { body?: string; created_at?: string } | undefined;
  if (!row) return null;
  return { preview: String(row.body ?? ""), lastAt: String(row.created_at ?? ""), unread: false };
}

export async function markWalletAlertsRead(userId: string): Promise<void> {
  if (!(await hasTable("wallet_alerts"))) return;
  await db.execute({ sql: "UPDATE wallet_alerts SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", args: [userId] });
}
