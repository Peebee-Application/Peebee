/**
 * Menu management — Phase 2 of food ordering (see restaurants/routes.ts
 * for Phase 1's business-account context). Owner-only CRUD for now;
 * customer-facing browsing and ordering come in a later phase, so nothing
 * here is exposed publicly yet.
 *
 * Options/choices ("Size: Regular/Large", "Add cheese +1500") are replaced
 * wholesale per item (PUT, not granular POST/PATCH/DELETE) — an item
 * rarely has more than a handful, and replacing the set atomically is
 * simpler than reconciling individual adds/edits/removals for something
 * this small.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { demoFoodImage } from "@peebee/shared/demo-food";
import { getPlatformEnvironment } from "../lib/settings.js";

export const menuRoutes = new Hono();

type Row = Record<string, unknown>;

async function ownedRestaurantId(userId: string): Promise<string | null> {
  const res = await db.execute({ sql: "SELECT id FROM restaurants WHERE owner_id = ?", args: [userId] });
  return (res.rows[0] as Row | undefined)?.id as string | undefined ?? null;
}

/** Full menu tree: every category (with its items) plus a bucket for
 * items that aren't in any category — each item carries its options and
 * their choices. Owner's own view, so unavailable items are included too
 * (they just show a badge client-side); a future public endpoint would
 * filter those out. */
menuRoutes.get("/restaurants/me/menu", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);

  const [categoriesRes, itemsRes, optionsRes, choicesRes] = await Promise.all([
    db.execute({
      sql: "SELECT * FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, name",
      args: [restaurantId],
    }),
    db.execute({
      sql: "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, name",
      args: [restaurantId],
    }),
    db.execute({
      sql: `SELECT o.* FROM menu_item_options o JOIN menu_items i ON i.id = o.menu_item_id
            WHERE i.restaurant_id = ? ORDER BY o.sort_order`,
      args: [restaurantId],
    }),
    db.execute({
      sql: `SELECT ch.* FROM menu_item_option_choices ch
            JOIN menu_item_options o ON o.id = ch.option_id
            JOIN menu_items i ON i.id = o.menu_item_id
            WHERE i.restaurant_id = ? ORDER BY ch.sort_order`,
      args: [restaurantId],
    }),
  ]);

  const choicesByOption = new Map<string, Row[]>();
  for (const choice of choicesRes.rows as Row[]) {
    const list = choicesByOption.get(choice.option_id as string) ?? [];
    list.push(choice);
    choicesByOption.set(choice.option_id as string, list);
  }
  const optionsByItem = new Map<string, Row[]>();
  for (const option of optionsRes.rows as Row[]) {
    const list = optionsByItem.get(option.menu_item_id as string) ?? [];
    list.push({ ...option, choices: choicesByOption.get(option.id as string) ?? [] });
    optionsByItem.set(option.menu_item_id as string, list);
  }
  const items: Row[] = (itemsRes.rows as Row[]).map((item) => ({ ...item, options: optionsByItem.get(item.id as string) ?? [] }));
  const itemsByCategory = new Map<string | null, Row[]>();
  for (const item of items) {
    const key = (item.category_id as string | null | undefined) ?? null;
    const list = itemsByCategory.get(key) ?? [];
    list.push(item);
    itemsByCategory.set(key, list);
  }

  const categories = (categoriesRes.rows as Row[]).map((cat) => ({
    ...cat,
    items: itemsByCategory.get(cat.id as string) ?? [],
  }));
  const uncategorized = itemsByCategory.get(null) ?? [];

  return c.json({ categories, uncategorizedItems: uncategorized });
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({ name: z.string().min(1).max(120), sortOrder: z.number().int().optional() });

menuRoutes.post("/restaurants/me/menu/categories", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const parsed = categorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const id = newId("cat");
  await db.execute({
    sql: "INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES (?, ?, ?, ?)",
    args: [id, restaurantId, parsed.data.name, parsed.data.sortOrder ?? 0],
  });
  const res = await db.execute({ sql: "SELECT * FROM menu_categories WHERE id = ?", args: [id] });
  return c.json({ category: res.rows[0] }, 201);
});

menuRoutes.patch("/restaurants/me/menu/categories/:id", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const parsed = categorySchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const owned = await db.execute({
    sql: "SELECT 1 FROM menu_categories WHERE id = ? AND restaurant_id = ?",
    args: [id, restaurantId],
  });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const fields: Record<string, unknown> = {};
  if (parsed.data.name != null) fields.name = parsed.data.name;
  if (parsed.data.sortOrder != null) fields.sort_order = parsed.data.sortOrder;
  const keys = Object.keys(fields);
  if (keys.length > 0) {
    await db.execute({
      sql: `UPDATE menu_categories SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      args: [...keys.map((k) => fields[k]), id] as never,
    });
  }
  const res = await db.execute({ sql: "SELECT * FROM menu_categories WHERE id = ?", args: [id] });
  return c.json({ category: res.rows[0] });
});

menuRoutes.delete("/restaurants/me/menu/categories/:id", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);

  const owned = await db.execute({
    sql: "SELECT 1 FROM menu_categories WHERE id = ? AND restaurant_id = ?",
    args: [id, restaurantId],
  });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);

  // Items in this category fall back to "uncategorized" rather than being
  // deleted along with it — a category is just a display grouping, not
  // ownership of the items in it.
  await db.execute({ sql: "UPDATE menu_items SET category_id = NULL WHERE category_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM menu_categories WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  price: z.number().int().nonnegative(),
  categoryId: z.string().nullable().optional(),
  available: z.boolean().optional(),
  prepTimeMinutes: z.number().int().positive().max(240).optional(),
  sortOrder: z.number().int().optional(),
  // Promotional pill shown on the customer-facing card — see
  // apps/customer/app/restaurants/[id]/page.tsx. Null clears it.
  badge: z.enum(["sale", "new", "trending"]).nullable().optional(),
});

async function assertCategoryOwnership(restaurantId: string, categoryId: string | null | undefined) {
  if (!categoryId) return true;
  const res = await db.execute({
    sql: "SELECT 1 FROM menu_categories WHERE id = ? AND restaurant_id = ?",
    args: [categoryId, restaurantId],
  });
  return res.rows.length > 0;
}

menuRoutes.post("/restaurants/me/menu/items", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (!(await assertCategoryOwnership(restaurantId, parsed.data.categoryId))) {
    return c.json({ error: "invalid_category" }, 400);
  }

  const id = newId("mit");
  await db.execute({
    sql: `INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price, available, prep_time_minutes, sort_order, badge)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      restaurantId,
      parsed.data.categoryId ?? null,
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.price,
      parsed.data.available === false ? 0 : 1,
      parsed.data.prepTimeMinutes ?? null,
      parsed.data.sortOrder ?? 0,
      parsed.data.badge ?? null,
    ],
  });
  const res = await db.execute({ sql: "SELECT * FROM menu_items WHERE id = ?", args: [id] });
  return c.json({ item: { ...(res.rows[0] as Row), options: [] } }, 201);
});

menuRoutes.patch("/restaurants/me/menu/items/:id", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const parsed = itemSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const owned = await db.execute({ sql: "SELECT 1 FROM menu_items WHERE id = ? AND restaurant_id = ?", args: [id, restaurantId] });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);
  if (parsed.data.categoryId !== undefined && !(await assertCategoryOwnership(restaurantId, parsed.data.categoryId))) {
    return c.json({ error: "invalid_category" }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (parsed.data.name != null) fields.name = parsed.data.name;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description ?? null;
  if (parsed.data.price != null) fields.price = parsed.data.price;
  if (parsed.data.categoryId !== undefined) fields.category_id = parsed.data.categoryId;
  if (parsed.data.available != null) fields.available = parsed.data.available ? 1 : 0;
  if (parsed.data.prepTimeMinutes !== undefined) fields.prep_time_minutes = parsed.data.prepTimeMinutes ?? null;
  if (parsed.data.sortOrder != null) fields.sort_order = parsed.data.sortOrder;
  if (parsed.data.badge !== undefined) fields.badge = parsed.data.badge;

  const keys = Object.keys(fields);
  if (keys.length > 0) {
    await db.execute({
      sql: `UPDATE menu_items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      args: [...keys.map((k) => fields[k]), id] as never,
    });
  }
  const [itemRes, optionsRes] = await Promise.all([
    db.execute({ sql: "SELECT * FROM menu_items WHERE id = ?", args: [id] }),
    db.execute({
      sql: `SELECT o.*, (
              SELECT json_group_array(json_object('id', ch.id, 'name', ch.name, 'price_delta', ch.price_delta, 'sort_order', ch.sort_order))
              FROM menu_item_option_choices ch WHERE ch.option_id = o.id
            ) as choices_json
            FROM menu_item_options o WHERE o.menu_item_id = ? ORDER BY o.sort_order`,
      args: [id],
    }),
  ]);
  const options = (optionsRes.rows as Row[]).map((o) => ({
    ...o,
    choices: JSON.parse((o.choices_json as string) ?? "[]"),
  }));
  return c.json({ item: { ...(itemRes.rows[0] as Row), options } });
});

menuRoutes.delete("/restaurants/me/menu/items/:id", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);

  const owned = await db.execute({ sql: "SELECT 1 FROM menu_items WHERE id = ? AND restaurant_id = ?", args: [id, restaurantId] });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const optionIds = await db.execute({ sql: "SELECT id FROM menu_item_options WHERE menu_item_id = ?", args: [id] });
  for (const row of optionIds.rows as Row[]) {
    await db.execute({ sql: "DELETE FROM menu_item_option_choices WHERE option_id = ?", args: [row.id as string] });
  }
  await db.execute({ sql: "DELETE FROM menu_item_options WHERE menu_item_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM menu_items WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Options + choices — replaced wholesale per item, see file doc comment.
// ---------------------------------------------------------------------------

const optionsSchema = z.object({
  options: z.array(
    z.object({
      name: z.string().min(1).max(80),
      required: z.boolean().optional(),
      multiSelect: z.boolean().optional(),
      choices: z.array(z.object({ name: z.string().min(1).max(80), priceDelta: z.number().int().min(0).default(0) })).max(30),
    }),
  ).max(10),
});

menuRoutes.put("/restaurants/me/menu/items/:id/options", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const parsed = optionsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const owned = await db.execute({ sql: "SELECT 1 FROM menu_items WHERE id = ? AND restaurant_id = ?", args: [itemId, restaurantId] });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const existing = await db.execute({ sql: "SELECT id FROM menu_item_options WHERE menu_item_id = ?", args: [itemId] });
  for (const row of existing.rows as Row[]) {
    await db.execute({ sql: "DELETE FROM menu_item_option_choices WHERE option_id = ?", args: [row.id as string] });
  }
  await db.execute({ sql: "DELETE FROM menu_item_options WHERE menu_item_id = ?", args: [itemId] });

  for (const [optionIndex, option] of parsed.data.options.entries()) {
    const optionId = newId("opt");
    await db.execute({
      sql: "INSERT INTO menu_item_options (id, menu_item_id, name, required, multi_select, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      args: [optionId, itemId, option.name, option.required ? 1 : 0, option.multiSelect ? 1 : 0, optionIndex],
    });
    for (const [choiceIndex, choice] of option.choices.entries()) {
      await db.execute({
        sql: "INSERT INTO menu_item_option_choices (id, option_id, name, price_delta, sort_order) VALUES (?, ?, ?, ?, ?)",
        args: [newId("chc"), optionId, choice.name, choice.priceDelta, choiceIndex],
      });
    }
  }

  const optionsRes = await db.execute({
    sql: `SELECT o.*, (
            SELECT json_group_array(json_object('id', ch.id, 'name', ch.name, 'price_delta', ch.price_delta, 'sort_order', ch.sort_order))
            FROM menu_item_option_choices ch WHERE ch.option_id = o.id
          ) as choices_json
          FROM menu_item_options o WHERE o.menu_item_id = ? ORDER BY o.sort_order`,
    args: [itemId],
  });
  const options = (optionsRes.rows as Row[]).map((o) => ({ ...o, choices: JSON.parse((o.choices_json as string) ?? "[]") }));
  return c.json({ options });
});

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

const MAX_ITEM_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

menuRoutes.post("/restaurants/me/menu/items/:id/photo", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const restaurantId = await ownedRestaurantId(user.sub);
  if (!restaurantId) return c.json({ error: "not_found" }, 404);
  const owned = await db.execute({ sql: "SELECT 1 FROM menu_items WHERE id = ? AND restaurant_id = ?", args: [id, restaurantId] });
  if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
  if (!ALLOWED_PHOTO_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
  if (file.size > MAX_ITEM_PHOTO_BYTES) return c.json({ error: "file_too_large" }, 400);

  const ext = extensionForMime(file.type, "jpg");
  const key = `menu-items/${id}/photo.${ext}`;
  const bucket = getR2Bucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  await db.execute({
    sql: "UPDATE menu_items SET photo_key = ?, updated_at = datetime('now') WHERE id = ?",
    args: [key, id],
  });
  return c.json({ ok: true });
});

/** Owner + admin only for now — see file doc comment on why nothing here
 * is public yet. */
menuRoutes.get("/restaurants/menu-items/:id/photo", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  if (id.startsWith("demo-food-") && await getPlatformEnvironment() === "sandbox") {
    const image = demoFoodImage(id);
    if (image) return c.body(image, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" });
  }
  const user = c.get("user");

  const res = await db.execute({
    sql: `SELECT i.photo_key, r.owner_id, r.status as restaurant_status
          FROM menu_items i JOIN restaurants r ON r.id = i.restaurant_id WHERE i.id = ?`,
    args: [id],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row?.photo_key) return c.json({ error: "not_found" }, 404);
  // The owner and admins always see it; anyone else only once the
  // restaurant is actually approved and visible for ordering from — a
  // pending/suspended restaurant's photos stay private until then.
  const isOwnerOrAdmin = row.owner_id === user.sub || user.role === "admin";
  if (!isOwnerOrAdmin && row.restaurant_status !== "active") return c.json({ error: "forbidden" }, 403);

  const bucket = getR2Bucket();
  const object = await bucket.get(row.photo_key as string);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: { ...uploadResponseHeaders(object.httpMetadata?.contentType, "image/jpeg"), "Cache-Control": "private, max-age=3600" },
  });
});
