import {hasColumn} from '../lib/schema.js';
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { newId } from "../lib/ids.js";

export const pushRoutes = new Hono();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** One row per browser/device a user has granted notification permission
 * on. Upserted by endpoint — the same URL a given browser install always
 * reuses — so re-subscribing (e.g. after a service worker update) just
 * refreshes the row instead of piling up duplicates. */
pushRoutes.post("/push/subscribe", requireAuth, async (c) => {
  const user = c.get("user");
  const parsed = subscribeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { endpoint, keys } = parsed.data;

  const sessions=await hasColumn('push_subscriptions','session_jti');
  await db.execute({
    sql: `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth${sessions?',session_jti':''})
          VALUES (?, ?, ?, ?, ?${sessions?',?':''})
          ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth${sessions?',session_jti=excluded.session_jti':''}`,
    args: [newId("push"), user.sub, endpoint, keys.p256dh, keys.auth,...(sessions?[user.jti]:[])],
  });

  return c.json({ ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

/** Requires auth mainly for consistency with subscribe — the endpoint
 * itself is an unguessable, single-use secret, so a stale/expired token
 * wouldn't make this meaningfully unsafe either way. Callers (each app's
 * lib/push.ts) capture the token before logout clears it, since the fetch
 * here otherwise races that removal. */
pushRoutes.post("/push/unsubscribe", requireAuth, async (c) => {
  const parsed = unsubscribeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", args: [parsed.data.endpoint,c.get("user").sub] });
  return c.json({ ok: true });
});
