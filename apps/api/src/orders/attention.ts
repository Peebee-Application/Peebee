import { notifyUser } from "../lib/webpush.js";
import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_ATTENTION_SETTINGS, type AttentionParty, type AttentionSettings } from "@peebee/shared";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, getRawSetting } from "../lib/settings.js";
import { newId } from "../lib/ids.js";

export const attentionSettingsSchema = z.object({
  arrivalRadiusMeters: z.number().int().min(10).max(500),
  holdDelayMilliseconds: z.number().int().min(100).max(1000),
  enabled: z.boolean(), maxHoldSeconds: z.number().int().min(1).max(60),
  cooldownSeconds: z.number().int().min(1).max(120),
  pollMilliseconds: z.number().int().min(250).max(2000),
  leaseMilliseconds: z.number().int().min(1000).max(5000), arrivalEnabled: z.boolean(),
}).refine((s) => s.leaseMilliseconds >= s.pollMilliseconds * 2, { message: "Lease must allow at least two polling intervals" });
export async function getAttentionSettings(): Promise<AttentionSettings> {
  try {
    const result = attentionSettingsSchema.safeParse({ ...DEFAULT_ATTENTION_SETTINGS, ...JSON.parse(await getRawSetting("order_attention") ?? "{}") });
    return result.success ? result.data : DEFAULT_ATTENTION_SETTINGS;
  } catch { return DEFAULT_ATTENTION_SETTINGS; }
}
type Row = Record<string, unknown>;
const terminal = (stage: unknown) => ["Settle", "Cancelled", "Expired", "Handover"].includes(String(stage));

/** Resolve recipients from the order itself, never from a caller-supplied account id.
 * A shopping list deliberately has no merchant recipients. */
export async function orderAttentionParties(id: string): Promise<{ order: Row; parties: AttentionParty[] } | null> {
  const order = (await db.execute({ sql: "SELECT * FROM orders WHERE id = ? AND environment = ?", args: [id, await getPlatformEnvironment()] })).rows[0] as Row | undefined;
  if (!order) return null;
  const parties: AttentionParty[] = [];
  async function person(userId: unknown, role: AttentionParty["role"], label: string, extra = {}) {
    if (!userId) return;
    const user = (await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [String(userId)] })).rows[0];
    if (user) parties.push({ userId: String(userId), role, label, name: String(user.name), ...extra });
  }
  await person(order.customer_id, "customer", "Customer");
  await person(order.rider_id, "rider", "Rider");
  if (order.restaurant_id && await hasTable("restaurants")) {
    const r = (await db.execute({ sql: "SELECT * FROM restaurants WHERE id = ?", args: [String(order.restaurant_id)] })).rows[0];
    const labels: Record<string, string> = { restaurant: "Restaurant", kitchen: "Kitchen", street_food: "Street vendor", bakery: "Bakery", juices: "Juice shop" };
    if (r) await person(r.owner_id, "business", labels[String(r.business_type)] ?? "Restaurant", { name: String(r.name), restaurantId: String(r.id) });
  }
  if (order.store_id && await hasTable("stores")) {
    const rows = await db.execute({ sql: `SELECT s.*, mm.user_id FROM stores s JOIN merchant_members mm ON mm.merchant_id = s.merchant_id
      WHERE s.id = ? AND mm.status = 'active' AND mm.role = 'owner' ORDER BY mm.created_at, mm.user_id LIMIT 1`, args: [String(order.store_id)] });
    const s = rows.rows[0];
    if (s) await person(s.user_id, "business", s.category === "groceries" ? "Grocer" : "Store", { name: String(s.name), storeId: String(s.id) });
  }
  if (await hasTable("order_relay_legs")) {
    const legs = await db.execute({ sql: "SELECT provider_id FROM order_relay_legs WHERE order_id = ? AND kind = 'matatu' AND provider_id IS NOT NULL AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY leg", args: [id] });
    for (const leg of legs.rows) await person(leg.provider_id, "taxi", "Taxi");
  }
  const orderOfRoles = { customer: 0, rider: 1, taxi: 2, business: 3 };
  parties.sort((a, b) => orderOfRoles[a.role] - orderOfRoles[b.role]);
  return { order, parties };
}
export const attentionRoutes = new Hono();
attentionRoutes.use("*", requireAuth);
attentionRoutes.get("/attention/settings", async (c) => c.json({ settings: await getAttentionSettings(), available: await hasTable("order_attention") }));
attentionRoutes.get("/orders/:id/follow-up", async (c) => {
  const data = await orderAttentionParties(c.req.param("id"));
  if (!data || !data.parties.some((p) => p.userId === c.get("user").sub)) return c.json({ error: "not_found" }, 404);
  const me = c.get("user").sub;
  return c.json({ parties: data.parties.filter((p) => p.userId !== me), active: !terminal(data.order.stage) });
});
const startSchema = z.object({ recipientId: z.string().min(1), reason: z.enum(["Ask for an update", "I’m outside", "Please check my order"]), mode: z.enum(["tap", "hold"]) });
attentionRoutes.post("/orders/:id/attention", async (c) => {
  const settings = await getAttentionSettings();
  if (!settings.enabled || !await hasTable("order_attention")) return c.json({ error: "attention_unavailable", message: "Follow-up calls are not available yet." }, 503);
  const parsed = startSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const data = await orderAttentionParties(c.req.param("id"));
  const sender = c.get("user").sub;
  if (!data || !data.parties.some((p) => p.userId === sender)) return c.json({ error: "not_found" }, 404);
  if (terminal(data.order.stage)) return c.json({ error: "order_closed", message: "This order is closed." }, 409);
  if (sender === parsed.data.recipientId || !data.parties.some((p) => p.userId === parsed.data.recipientId)) return c.json({ error: "invalid_recipient" }, 403);
  const now = Date.now();
  const id = newId("attention");
  // Conditional insert makes the sender cooldown atomic, including requests from two tabs.
  const result = await db.execute({ sql: `INSERT INTO order_attention (id, order_id, sender_id, recipient_id, reason, mode, started_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM order_attention WHERE sender_id = ? AND started_at > ?)`,
    args: [id, c.req.param("id"), sender, parsed.data.recipientId, parsed.data.reason, parsed.data.mode, now,
      now + (parsed.data.mode === "tap" ? settings.leaseMilliseconds * 2 : Math.min(settings.leaseMilliseconds, settings.maxHoldSeconds * 1000)), sender, now - settings.cooldownSeconds * 1000] });
  if (!result.rowsAffected) return c.json({ error: "cooldown", message: "Please wait a moment before calling again." }, 429);
  const recipient = data.parties.find((p) => p.userId === parsed.data.recipientId)!;
  const push = notifyUser(parsed.data.recipientId, {
    ttlSeconds: parsed.data.mode === "hold" ? settings.maxHoldSeconds : Math.ceil(settings.leaseMilliseconds * 2 / 1000),
    title: `${c.get("user").name} is following up`, body: parsed.data.reason, tag: `attention-${id}`,
    url: recipient.role === "customer" ? `/orders/${c.req.param("id")}` : recipient.role === "rider" ? `/jobs/${c.req.param("id")}` : "/",
  }).catch(() => {});
  try { c.executionCtx.waitUntil(push); } catch { void push; }
  return c.json({ id, settings }, 201);
});
attentionRoutes.post("/attention/:id/:action", async (c) => {
  if (!await hasTable("order_attention")) return c.json({ error: "unavailable" }, 503);
  const id = c.req.param("id"), action = c.req.param("action"), me = c.get("user").sub;
  const signal = (await db.execute({ sql: "SELECT * FROM order_attention WHERE id = ?", args: [id] })).rows[0];
  if (!signal || (signal.sender_id !== me && signal.recipient_id !== me)) return c.json({ error: "not_found" }, 404);
  if (action === "stop" || action === "acknowledge") {
    if (action === "stop" && signal.sender_id !== me || action === "acknowledge" && signal.recipient_id !== me) return c.json({ error: "forbidden" }, 403);
    await db.execute({ sql: "UPDATE order_attention SET stopped_at = ?, expires_at = ? WHERE id = ?", args: [Date.now(), Date.now(), id] });
    return c.json({ ok: true });
  }
  if (action !== "heartbeat" || signal.sender_id !== me || signal.mode !== "hold") return c.json({ error: "forbidden" }, 403);
  const settings = await getAttentionSettings();
  const data = await orderAttentionParties(String(signal.order_id));
  const now = Date.now();
  const allowed = settings.enabled && data && !terminal(data.order.stage) && data.parties.some((p) => p.userId === me) && data.parties.some((p) => p.userId === signal.recipient_id);
  const expires = Math.min(now + settings.leaseMilliseconds, Number(signal.started_at) + settings.maxHoldSeconds * 1000);
  if (!allowed || signal.stopped_at || Number(signal.expires_at) <= now || expires <= now) return c.json({ error: "ended" }, 409);
  await db.execute({ sql: "UPDATE order_attention SET expires_at = ? WHERE id = ? AND stopped_at IS NULL AND expires_at > ?", args: [expires, id, now] });
  return c.json({ ok: true });
});
attentionRoutes.get("/attention/incoming", async (c) => {
  const settings = await getAttentionSettings();
  if (!settings.enabled || !await hasTable("order_attention")) return c.json({ signal: null, settings });
  const result = await db.execute({ sql: `SELECT a.*, u.name AS sender_name FROM order_attention a JOIN users u ON u.id = a.sender_id
    JOIN orders o ON o.id = a.order_id WHERE a.recipient_id = ? AND a.expires_at > ? AND a.stopped_at IS NULL
    AND o.environment = ? AND o.stage NOT IN ('Settle', 'Cancelled', 'Expired', 'Handover') ORDER BY a.started_at DESC LIMIT 1`, args: [c.get("user").sub, Date.now(), await getPlatformEnvironment()] });
  const s = result.rows[0];
  if (!s) return c.json({ signal: null, settings });
  const data = await orderAttentionParties(String(s.order_id));
  if (!data?.parties.some((p) => p.userId === c.get("user").sub) || !data.parties.some((p) => p.userId === s.sender_id)) return c.json({ signal: null, settings });
  return c.json({ signal: { id: s.id, orderId: s.order_id, senderName: s.sender_name, senderId: s.sender_id, reason: s.reason, mode: s.mode, expiresAt: s.expires_at }, settings });
});

const messageSchema = z.object({ recipientId: z.string().min(1), body: z.string().trim().min(1).max(2000) });
attentionRoutes.get("/attention/messages/unread", async (c) => {
  if (!await hasTable("order_follow_up_messages")) return c.json({ message: null });
  const rows = await db.execute({ sql: `SELECT m.order_id, m.sender_id, u.name FROM order_follow_up_messages m JOIN users u ON u.id = m.sender_id
    JOIN orders o ON o.id = m.order_id WHERE m.recipient_id = ? AND m.read_at IS NULL AND o.environment = ? ORDER BY m.created_at DESC LIMIT 1`, args: [c.get("user").sub, await getPlatformEnvironment()] });
  const m = rows.rows[0];
  if (!m) return c.json({ message: null });
  const data = await orderAttentionParties(String(m.order_id));
  if (!data?.parties.some((p) => p.userId === c.get("user").sub)) return c.json({ message: null });
  return c.json({ message: { orderId: m.order_id, senderId: m.sender_id, senderName: m.name } });
});
attentionRoutes.get("/orders/:id/follow-up/messages/:recipient", async (c) => {
  if (!await hasTable("order_follow_up_messages")) return c.json({ error: "unavailable", message: "Order messages are not available yet." }, 503);
  const data = await orderAttentionParties(c.req.param("id")), me = c.get("user").sub, other = c.req.param("recipient");
  if (!data || !data.parties.some((p) => p.userId === me) || !data.parties.some((p) => p.userId === other) || other === me) return c.json({ error: "not_found" }, 404);
  const rows = await db.execute({ sql: `SELECT id, sender_id AS senderId, body, created_at AS createdAt FROM order_follow_up_messages
    WHERE order_id = ? AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) ORDER BY created_at DESC, id DESC LIMIT 100`, args: [c.req.param("id"), me, other, other, me] });
  return c.json({ messages: rows.rows.reverse() });
});
attentionRoutes.post("/orders/:id/follow-up/messages/:recipient/read", async (c) => {
  if (!await hasTable("order_follow_up_messages")) return c.json({ error: "unavailable" }, 503);
  const me = c.get("user").sub;
  const data = await orderAttentionParties(c.req.param("id"));
  if (!data?.parties.some((p) => p.userId === me)) return c.json({ error: "not_found" }, 404);
  await db.execute({ sql: "UPDATE order_follow_up_messages SET read_at = ? WHERE order_id = ? AND recipient_id = ? AND sender_id = ? AND read_at IS NULL", args: [Date.now(), c.req.param("id"), me, c.req.param("recipient")] });
  return c.json({ ok: true });
});
attentionRoutes.post("/orders/:id/follow-up/messages", async (c) => {
  if (!await hasTable("order_follow_up_messages")) return c.json({ error: "unavailable", message: "Order messages are not available yet." }, 503);
  const parsed = messageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const data = await orderAttentionParties(c.req.param("id")), me = c.get("user").sub;
  if (!data || !data.parties.some((p) => p.userId === me) || !data.parties.some((p) => p.userId === parsed.data.recipientId) || parsed.data.recipientId === me) return c.json({ error: "not_found" }, 404);
  if (terminal(data.order.stage)) return c.json({ error: "order_closed", message: "This order is closed." }, 409);
  await db.execute({ sql: "INSERT INTO order_follow_up_messages (id, order_id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", args: [newId("followup"), c.req.param("id"), me, parsed.data.recipientId, parsed.data.body, Date.now()] });
  return c.json({ ok: true }, 201);
});
