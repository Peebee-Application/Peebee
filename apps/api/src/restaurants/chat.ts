/**
 * Customer <-> restaurant messaging. Kept separate from ../orders chat
 * (chat_messages, hard-wired to customer/rider order pairs) — a restaurant
 * owner isn't a first-class role, and this thread isn't order-scoped: a
 * customer can ask a restaurant about a dish before ever ordering, and the
 * thread stays continuous across orders. See migrations/0037_restaurant_chat.sql
 * and 0038_restaurant_chat_voice.sql.
 *
 * Mirrors the order chat's own multipart convention (form fields "type"
 * ("image" | "voice") + "file") rather than inventing a different one, so
 * both composers behave identically.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { notifyUser } from "../lib/webpush.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";

export const restaurantChatRoutes = new Hono();

type Row = Record<string, unknown>;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_VOICE_BYTES = 5 * 1024 * 1024;
const ALLOWED_VOICE_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]);

function preview(type: string, body: string | null): string {
  if (type === "image") return "📷 Photo";
  if (type === "voice") return "🎤 Voice message";
  if (type === "call") return "📞 " + (body ?? "Call");
  return body && body.length > 60 ? `${body.slice(0, 60)}…` : body || "";
}

/** Every non-call message can quote an earlier one (reply_to_id) — joined
 * in here so the client always has the quoted preview without a second
 * round trip, mirroring orders/routes.ts's THREAD_SELECT for order chat. */
const THREAD_SELECT = `
  SELECT m.*,
         reply.body AS reply_to_body, reply.type AS reply_to_type,
         reply.sender_role AS reply_to_sender_role, reply.deleted_at AS reply_to_deleted_at
  FROM restaurant_chat_messages m
  LEFT JOIN restaurant_chat_messages reply ON reply.id = m.reply_to_id
`;

/** A reply must quote a message from this exact (restaurant, customer)
 * thread — otherwise a forged replyToId could leak a snippet of an
 * unrelated conversation via the quoted-preview join above. Returns null
 * (silently dropping the quote) rather than erroring, so a stale/deleted
 * quote target doesn't block sending the new message itself. */
async function resolveReplyToId(rawReplyToId: unknown, restaurantId: string, customerId: string): Promise<string | null> {
  if (typeof rawReplyToId !== "string" || !rawReplyToId) return null;
  const res = await db.execute({
    sql: "SELECT id FROM restaurant_chat_messages WHERE id = ? AND restaurant_id = ? AND customer_id = ?",
    args: [rawReplyToId, restaurantId, customerId],
  });
  return res.rows[0] ? rawReplyToId : null;
}

async function restaurantByOwner(ownerId: string): Promise<Row | undefined> {
  const res = await db.execute({ sql: "SELECT * FROM restaurants WHERE owner_id = ?", args: [ownerId] });
  return res.rows[0] as Row | undefined;
}

async function restaurantById(id: string): Promise<Row | undefined> {
  const res = await db.execute({ sql: "SELECT * FROM restaurants WHERE id = ?", args: [id] });
  return res.rows[0] as Row | undefined;
}

async function storeMedia(
  c: Context,
  keyPrefix: string,
): Promise<{ type: "image" | "voice"; key: string; replyToIdRaw: string | null } | { error: string; status: 400 }> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const type = form?.get("type");
  if (!(file instanceof File) || (type !== "image" && type !== "voice")) {
    return { error: "invalid_body", status: 400 };
  }
  const allowed = type === "image" ? ALLOWED_IMAGE_MIME : ALLOWED_VOICE_MIME;
  const maxBytes = type === "image" ? MAX_IMAGE_BYTES : MAX_VOICE_BYTES;
  if (!allowed.has(baseMimeType(file.type))) return { error: "unsupported_file_type", status: 400 };
  if (file.size > maxBytes) return { error: "file_too_large", status: 400 };

  const messageId = newId("rmsg");
  const ext = extensionForMime(file.type, type === "image" ? "jpg" : "webm");
  const key = `${keyPrefix}/${messageId}.${ext}`;
  const bucket = getR2Bucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const replyToIdRaw = form?.get("replyToId");
  return { type, key, replyToIdRaw: typeof replyToIdRaw === "string" && replyToIdRaw ? replyToIdRaw : null };
}

// ---------------------------------------------------------------------------
// Customer side — one thread per (restaurant, customer) pair.
// ---------------------------------------------------------------------------

restaurantChatRoutes.get("/restaurants/:id/chat", requireAuth, async (c) => {
  const restaurantId = c.req.param("id") as string;
  const user = c.get("user");
  const restaurant = await restaurantById(restaurantId);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  const res = await db.execute({
    sql: `${THREAD_SELECT} WHERE m.restaurant_id = ? AND m.customer_id = ? AND m.hidden_for_customer = 0
          ORDER BY m.created_at ASC`,
    args: [restaurantId, user.sub],
  });
  return c.json({
    restaurantName: restaurant.name,
    restaurantOwnerId: restaurant.owner_id,
    messages: res.rows,
  });
});

const sendSchema = z.object({
  body: z.string().min(1).max(2000),
  menuItemId: z.string().optional(),
  menuItemName: z.string().optional(),
  replyToId: z.string().optional(),
});

restaurantChatRoutes.post("/restaurants/:id/chat", requireAuth, requireRole("customer"), async (c) => {
  const restaurantId = c.req.param("id") as string;
  const user = c.get("user");
  const restaurant = await restaurantById(restaurantId);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    const stored = await storeMedia(c, `restaurants/${restaurantId}/chat/${user.sub}`);
    if ("error" in stored) return c.json({ error: stored.error }, stored.status);
    const replyToId = await resolveReplyToId(stored.replyToIdRaw, restaurantId, user.sub);

    const messageId = newId("rmsg");
    await db.execute({
      sql: `INSERT INTO restaurant_chat_messages (id, restaurant_id, customer_id, sender_role, type, media_key, reply_to_id)
            VALUES (?, ?, ?, 'customer', ?, ?, ?)`,
      args: [messageId, restaurantId, user.sub, stored.type, stored.key, replyToId],
    });
    notifyUser(restaurant.owner_id as string, {
      title: user.name || "New message",
      body: preview(stored.type, null),
      url: `/chat/${user.sub}`,
      tag: `restaurant-chat-${restaurantId}-${user.sub}`,
    }).catch(() => {});
    return c.json({ id: messageId }, 201);
  }

  const parsed = sendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const replyToId = await resolveReplyToId(parsed.data.replyToId, restaurantId, user.sub);

  const messageId = newId("rmsg");
  await db.execute({
    sql: `INSERT INTO restaurant_chat_messages (id, restaurant_id, customer_id, sender_role, body, menu_item_id, menu_item_name, reply_to_id)
          VALUES (?, ?, ?, 'customer', ?, ?, ?, ?)`,
    args: [
      messageId,
      restaurantId,
      user.sub,
      parsed.data.body,
      parsed.data.menuItemId ?? null,
      parsed.data.menuItemName ?? null,
      replyToId,
    ],
  });
  notifyUser(restaurant.owner_id as string, {
    title: user.name || "New message",
    body: preview("text", parsed.data.body),
    url: `/chat/${user.sub}`,
    tag: `restaurant-chat-${restaurantId}-${user.sub}`,
  }).catch(() => {});
  return c.json({ id: messageId }, 201);
});

restaurantChatRoutes.post("/restaurants/:id/chat/read", requireAuth, requireRole("customer"), async (c) => {
  const restaurantId = c.req.param("id") as string;
  const user = c.get("user");
  await db.execute({
    sql: `UPDATE restaurant_chat_messages SET read = 1
          WHERE restaurant_id = ? AND customer_id = ? AND sender_role = 'restaurant'`,
    args: [restaurantId, user.sub],
  });
  return c.json({ ok: true });
});

/** Every restaurant this customer has ever exchanged chat messages with,
 * most recent first — the restaurant-side counterpart to GET /chat/threads
 * (orders/routes.ts), so the Chat tab can show both in one list. */
restaurantChatRoutes.get("/restaurants/chats/mine", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");

  const res = await db.execute({
    sql: `SELECT m.restaurant_id, r.name as restaurant_name,
                 MAX(m.created_at) as last_at,
                 SUM(CASE WHEN m.sender_role = 'restaurant' AND m.read = 0 THEN 1 ELSE 0 END) as unread_count
          FROM restaurant_chat_messages m
          JOIN restaurants r ON r.id = m.restaurant_id
          WHERE m.customer_id = ?
          GROUP BY m.restaurant_id
          ORDER BY last_at DESC`,
    args: [user.sub],
  });

  const threads = await Promise.all(
    (res.rows as Row[]).map(async (row) => {
      const restaurantId = row.restaurant_id as string;
      const lastRes = await db.execute({
        sql: `SELECT type, body FROM restaurant_chat_messages WHERE restaurant_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 1`,
        args: [restaurantId, user.sub],
      });
      const last = lastRes.rows[0] as Row | undefined;
      return {
        restaurantId,
        restaurantName: row.restaurant_name as string,
        lastMessagePreview: preview((last?.type as string) ?? "text", (last?.body as string | null) ?? null),
        lastMessageAt: row.last_at as string,
        unread: Number(row.unread_count ?? 0) > 0,
      };
    }),
  );

  return c.json({ threads });
});

// ---------------------------------------------------------------------------
// Restaurant-owner side — threads with every customer who's messaged.
// ---------------------------------------------------------------------------

restaurantChatRoutes.get("/restaurants/me/chat/threads", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const restaurant = await restaurantByOwner(user.sub);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  const res = await db.execute({
    sql: `SELECT m.customer_id, u.name as customer_name,
                 MAX(m.created_at) as last_message_at,
                 SUM(CASE WHEN m.sender_role = 'customer' AND m.read = 0 THEN 1 ELSE 0 END) as unread_count
          FROM restaurant_chat_messages m
          JOIN users u ON u.id = m.customer_id
          WHERE m.restaurant_id = ?
          GROUP BY m.customer_id
          ORDER BY last_message_at DESC`,
    args: [restaurant.id as string],
  });
  return c.json({ threads: res.rows });
});

restaurantChatRoutes.get("/restaurants/me/chat/:customerId", requireAuth, requireRole("customer"), async (c) => {
  const customerId = c.req.param("customerId") as string;
  const user = c.get("user");
  const restaurant = await restaurantByOwner(user.sub);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  const res = await db.execute({
    sql: `${THREAD_SELECT} WHERE m.restaurant_id = ? AND m.customer_id = ? AND m.hidden_for_restaurant = 0
          ORDER BY m.created_at ASC`,
    args: [restaurant.id as string, customerId],
  });
  const nameRes = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [customerId] });
  return c.json({
    customerName: (nameRes.rows[0] as Row | undefined)?.name ?? null,
    messages: res.rows,
  });
});

restaurantChatRoutes.post("/restaurants/me/chat/:customerId", requireAuth, requireRole("customer"), async (c) => {
  const customerId = c.req.param("customerId") as string;
  const user = c.get("user");
  const restaurant = await restaurantByOwner(user.sub);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    const stored = await storeMedia(c, `restaurants/${restaurant.id}/chat/${customerId}`);
    if ("error" in stored) return c.json({ error: stored.error }, stored.status);
    const replyToId = await resolveReplyToId(stored.replyToIdRaw, restaurant.id as string, customerId);

    const messageId = newId("rmsg");
    await db.execute({
      sql: `INSERT INTO restaurant_chat_messages (id, restaurant_id, customer_id, sender_role, type, media_key, reply_to_id)
            VALUES (?, ?, ?, 'restaurant', ?, ?, ?)`,
      args: [messageId, restaurant.id as string, customerId, stored.type, stored.key, replyToId],
    });
    notifyUser(customerId, {
      title: (restaurant.name as string) || "New message",
      body: preview(stored.type, null),
      url: `/chat/${restaurant.id}`,
      tag: `restaurant-chat-${restaurant.id}-${customerId}`,
    }).catch(() => {});
    return c.json({ id: messageId }, 201);
  }

  const parsed = z
    .object({ body: z.string().min(1).max(2000), replyToId: z.string().optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const replyToId = await resolveReplyToId(parsed.data.replyToId, restaurant.id as string, customerId);

  const messageId = newId("rmsg");
  await db.execute({
    sql: `INSERT INTO restaurant_chat_messages (id, restaurant_id, customer_id, sender_role, body, reply_to_id)
          VALUES (?, ?, ?, 'restaurant', ?, ?)`,
    args: [messageId, restaurant.id as string, customerId, parsed.data.body, replyToId],
  });
  notifyUser(customerId, {
    title: (restaurant.name as string) || "New message",
    body: preview("text", parsed.data.body),
    url: `/chat/${restaurant.id}`,
    tag: `restaurant-chat-${restaurant.id}-${customerId}`,
  }).catch(() => {});
  return c.json({ id: messageId }, 201);
});

restaurantChatRoutes.post("/restaurants/me/chat/:customerId/read", requireAuth, requireRole("customer"), async (c) => {
  const customerId = c.req.param("customerId") as string;
  const user = c.get("user");
  const restaurant = await restaurantByOwner(user.sub);
  if (!restaurant) return c.json({ error: "not_found" }, 404);

  await db.execute({
    sql: `UPDATE restaurant_chat_messages SET read = 1
          WHERE restaurant_id = ? AND customer_id = ? AND sender_role = 'customer'`,
    args: [restaurant.id as string, customerId],
  });
  return c.json({ ok: true });
});

const deleteChatSchema = z.object({ scope: z.enum(["me", "everyone"]) });

/**
 * Two WhatsApp-style scopes: "me" only hides the message from the caller's
 * own view (hidden_for_customer/hidden_for_restaurant), "everyone" actually
 * clears the content for both sides and is restricted to the message's own
 * sender. `sender_role` on the row (not the caller's account role — an
 * owner's account is itself role "customer") is what determines who sent
 * it, matching how every other route here tells the two sides apart.
 */
restaurantChatRoutes.post("/restaurant-chat/:messageId/delete", requireAuth, async (c) => {
  const messageId = c.req.param("messageId") as string;
  const user = c.get("user");
  const parsed = deleteChatSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const res = await db.execute({
    sql: `SELECT m.*, r.owner_id FROM restaurant_chat_messages m
          JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ?`,
    args: [messageId],
  });
  const message = res.rows[0] as Row | undefined;
  if (!message) return c.json({ error: "not_found" }, 404);
  if (message.type === "call") return c.json({ error: "cannot_delete_call_log" }, 400);

  const isOwner = message.owner_id === user.sub;
  const isParticipant = message.customer_id === user.sub || isOwner || user.role === "admin";
  if (!isParticipant) return c.json({ error: "forbidden" }, 403);

  const isSender = (message.sender_role === "customer" && message.customer_id === user.sub) || (message.sender_role === "restaurant" && isOwner);

  if (parsed.data.scope === "everyone") {
    if (!isSender && user.role !== "admin") {
      return c.json({ error: "forbidden", message: "You can only delete your own messages for everyone." }, 403);
    }
    if (message.media_key) {
      await getR2Bucket()
        .delete(message.media_key as string)
        .catch(() => {});
    }
    await db.execute({
      sql: "UPDATE restaurant_chat_messages SET deleted_at = datetime('now'), deleted_by = ?, body = '', media_key = NULL WHERE id = ?",
      args: [user.sub, messageId],
    });
    return c.json({ ok: true, scope: "everyone" });
  }

  if (message.customer_id === user.sub) {
    await db.execute({ sql: "UPDATE restaurant_chat_messages SET hidden_for_customer = 1 WHERE id = ?", args: [messageId] });
  } else if (isOwner) {
    await db.execute({ sql: "UPDATE restaurant_chat_messages SET hidden_for_restaurant = 1 WHERE id = ?", args: [messageId] });
  }
  return c.json({ ok: true, scope: "me" });
});

// ---------------------------------------------------------------------------
// Media — access-checked against the message's own restaurant/customer ids,
// open to either party (or the restaurant's owner) in that conversation.
// ---------------------------------------------------------------------------

restaurantChatRoutes.get("/restaurant-chat/media/:messageId", requireAuth, async (c) => {
  const messageId = c.req.param("messageId") as string;
  const user = c.get("user");

  const res = await db.execute({
    sql: `SELECT m.media_key, m.restaurant_id, m.customer_id, r.owner_id
          FROM restaurant_chat_messages m JOIN restaurants r ON r.id = m.restaurant_id
          WHERE m.id = ?`,
    args: [messageId],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row || !row.media_key) return c.json({ error: "not_found" }, 404);
  if (row.customer_id !== user.sub && row.owner_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const bucket = getR2Bucket();
  const object = await bucket.get(row.media_key as string);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream"),
  });
});
