import { ApplicationServerKeys, generatePushHTTPRequest } from "webpush-webcrypto";
import { db } from "../db/client.js";

/** Contact the push services can reach if a subscription is misbehaving —
 * required by the VAPID spec, doesn't need to be a monitored inbox. */
const VAPID_CONTACT = "mailto:support@peebee.online";

let cachedKeys: ApplicationServerKeys | null = null;

async function getVapidKeys(): Promise<ApplicationServerKeys | null> {
  if (cachedKeys) return cachedKeys;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  cachedKeys = await ApplicationServerKeys.fromJSON({ publicKey, privateKey });
  return cachedKeys;
}

type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushPayload = { title: string; body: string; url: string; tag: string };

/**
 * Sends one push notification. Returns false (never throws) on any failure —
 * a notification is a nice-to-have, not something that should break the
 * request that triggered it. A 404/410 means the browser unsubscribed
 * without telling us; the caller is expected to delete that row.
 */
async function sendOne(sub: PushSubscriptionRow, payload: PushPayload, keys: ApplicationServerKeys): Promise<"ok" | "gone" | "error"> {
  try {
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: keys,
      payload: JSON.stringify(payload),
      target: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      adminContact: VAPID_CONTACT,
      ttl: 60 * 60 * 24,
      urgency: "high",
    });
    const res = await fetch(endpoint, { method: "POST", headers, body });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      console.error(`Push send failed (${res.status}) for subscription ${sub.id}`);
      return "error";
    }
    return "ok";
  } catch (err) {
    console.error("Push send threw:", err);
    return "error";
  }
}

/**
 * Best-effort fan-out to every device a user has subscribed from. Silently
 * does nothing if VAPID keys aren't configured (e.g. local dev) or the user
 * has no subscriptions. Prunes subscriptions the browser itself dropped.
 */
export async function notifyUser(userId: string, payload: PushPayload): Promise<void> {
  const keys = await getVapidKeys();
  if (!keys) return;

  const res = await db.execute({
    sql: "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    args: [userId],
  });
  const subs = res.rows as unknown as PushSubscriptionRow[];
  if (subs.length === 0) return;

  const results = await Promise.all(subs.map((sub) => sendOne(sub, payload, keys)));
  const goneIds = subs.filter((_, i) => results[i] === "gone").map((s) => s.id);
  await Promise.all(
    goneIds.map((id) => db.execute({ sql: "DELETE FROM push_subscriptions WHERE id = ?", args: [id] })),
  );
}
