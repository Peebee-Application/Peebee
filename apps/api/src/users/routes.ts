/**
 * A profile photo for any signed-in account — customers primarily (the
 * point: a rider sees who they're delivering to, the same trust signal the
 * rider's own photo already gives customers), but usable by staff for
 * their own avatar too. Riders keep their existing, separate
 * riders.profile_photo_key — this doesn't touch that.
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";

export const userRoutes = new Hono();
userRoutes.use("*", requireAuth);

userRoutes.patch("/users/me/profile", async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter a display name between 1 and 80 characters." }, 400);
  await db.execute({ sql: "UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?", args: [parsed.data.name, c.get("user").sub] });
  return c.json({ name: parsed.data.name });
});

const MAX_PROFILE_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

userRoutes.post("/users/me/profile-photo", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
  if (!ALLOWED_PHOTO_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
  if (file.size > MAX_PROFILE_PHOTO_BYTES) return c.json({ error: "file_too_large" }, 400);

  const ext = extensionForMime(file.type, "jpg");
  const key = `users/${user.sub}/profile-photo.${ext}`;
  const bucket = getR2Bucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  await db.execute({
    sql: "UPDATE users SET profile_photo_key = ?, updated_at = datetime('now') WHERE id = ?",
    args: [key, user.sub],
  });

  return c.json({ hasProfilePhoto: true });
});

userRoutes.delete("/users/me/profile-photo", async (c) => {
  const user = c.get("user");
  await db.execute({
    sql: "UPDATE users SET profile_photo_key = NULL, updated_at = datetime('now') WHERE id = ?",
    args: [user.sub],
  });
  return c.json({ hasProfilePhoto: false });
});

/**
 * Streams a user's photo. Visible to: the user themself, any staff
 * account, or a rider who has (or has had) an order matched to this
 * customer — the same relationship that already lets a customer see their
 * rider's photo, just in the other direction.
 */
userRoutes.get("/users/:userId/photo", async (c) => {
  const userId = c.req.param("userId") as string;
  const user = c.get("user");

  if (user.sub !== userId && user.role !== "admin") {
    const related = await db.execute({
      sql: "SELECT 1 FROM orders WHERE customer_id = ? AND rider_id = ? LIMIT 1",
      args: [userId, user.sub],
    });
    if (related.rows.length === 0) return c.json({ error: "forbidden" }, 403);
  }

  const res = await db.execute({ sql: "SELECT profile_photo_key FROM users WHERE id = ?", args: [userId] });
  const key = res.rows[0]?.profile_photo_key as string | null | undefined;
  if (!key) return c.json({ error: "not_found" }, 404);

  const bucket = getR2Bucket();
  const object = await bucket.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: { ...uploadResponseHeaders(object.httpMetadata?.contentType, "image/jpeg"), "Cache-Control": "private, max-age=3600" },
  });
});
