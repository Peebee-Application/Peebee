import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db, executeBatch, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { getOptions } from "../lib/option-settings.js";
import { getR2Bucket } from "../storage/r2.js";
import { planLimits, storePlan } from "./plans.js";
import { VariationError, getProductVariationSettings, variationsSchema, writeProductVariations } from "./variations.js";

/**
 * The add-item wizard's server side: photo/video upload for products, and publishing a physical product in one call
 * (photos, variants, per-outlet stock for Elite, delivery, where it shows, live or draft). Digital items keep using the
 * digital-products routes and services the services platform; this file only owns what those don't cover.
 */
export const storeItemRoutes = new Hono();

type Row = Record<string, unknown>;

/** Public prefix for product pictures and videos, served by the public media route. */
export const STORE_MEDIA_PREFIX = "store-media/";

async function merchantStore(c: Context): Promise<{ merchantId: string; store: Row } | Response> {
  const user = c.get("user");
  const header = c.req.header("X-Merchant-Id") ?? null;
  const member = (await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, header, header],
  })).rows[0] as Row | undefined;
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);
  const merchantId = String(member.merchant_id);
  const store = (await db.execute({ sql: "SELECT * FROM stores WHERE merchant_id = ? LIMIT 1", args: [merchantId] })).rows[0] as Row | undefined;
  if (!store) return c.json({ error: "no_store", message: "Open your store first." }, 404);
  return { merchantId, store };
}

/** Magic-byte check so the stored type is what the file really is, whatever the browser claimed. */
export function detectMedia(bytes: Uint8Array): { kind: "image" | "video"; ext: string; type: string } | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: "image", ext: "jpg", type: "image/jpeg" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { kind: "image", ext: "png", type: "image/png" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { kind: "image", ext: "webp", type: "image/webp" };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return { kind: "video", ext: "mp4", type: "video/mp4" }; // ....ftyp (mp4 / mov)
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: "video", ext: "webm", type: "video/webm" };
  return null;
}

async function mediaLimits() {
  const o = await getOptions(["store_media_max_image_mb", "store_media_max_video_mb", "store_media_max_photos"]);
  return {
    imageMb: Math.max(1, Number(o.store_media_max_image_mb ?? 8)),
    videoMb: Math.max(1, Number(o.store_media_max_video_mb ?? 60)),
    photos: Math.max(1, Number(o.store_media_max_photos ?? 8)),
  };
}

storeItemRoutes.get("/merchants/me/store/media-limits", requireAuth, async (c) => c.json(await mediaLimits()));

/** One product photo or video, from the camera or gallery. Returns a public https address. */
storeItemRoutes.post(
  "/merchants/me/store/media",
  requireAuth,
  bodyLimit({ maxSize: 201 * 1024 * 1024, onError: (c) => c.json({ error: "file_too_large", message: "That file is too large." }, 413) }),
  async (c) => {
    const ctx = await merchantStore(c);
    if (ctx instanceof Response) return ctx;
    const limit = await consume(`store-media:${String(ctx.store.id)}`, 120, 3600);
    if (!limit.allowed) return c.json({ error: "rate_limited", message: "Too many uploads. Try again shortly." }, 429);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || !file.size) return c.json({ error: "missing_file", message: "Choose a photo or video." }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectMedia(bytes);
    if (!detected) return c.json({ error: "unsupported_file_type", message: "Use a JPG, PNG or WebP photo, or an MP4 or WebM video." }, 400);
    const limits = await mediaLimits();
    const maxMb = detected.kind === "video" ? limits.videoMb : limits.imageMb;
    if (bytes.byteLength > maxMb * 1024 * 1024) return c.json({ error: "file_too_large", message: `Up to ${maxMb} MB.` }, 413);
    const key = `${STORE_MEDIA_PREFIX}${String(ctx.store.id)}/${newId(detected.kind === "video" ? "vid" : "img")}.${detected.ext}`;
    await getR2Bucket().put(key, bytes, { httpMetadata: { contentType: detected.type } });
    const path = `/v1/public/media/${key}`;
    const origin = new URL(c.req.url).origin.replace(/^http:\/\/(?!localhost|127\.)/, "https://");
    return c.json({ key, kind: detected.kind, path, url: `${origin}${path}` }, 201);
  },
);

const httpsUrl = z.string().trim().url().max(500).refine((v) => /^https:\/\//.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(v), "Use an https address.");

const itemSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(2000).optional(),
  category_name: z.string().trim().max(60).optional(),
  badge: z.string().trim().max(30).optional(),
  images: z.array(httpsUrl).max(20).default([]),
  video_url: httpsUrl.or(z.literal("")).optional(),
  price: z.number().int().positive(),
  compare_at_price: z.number().int().positive().nullish(),
  cost_price: z.number().int().nonnegative().nullish(),
  sku: z.string().trim().max(40).optional(),
  track_inventory: z.boolean().default(true),
  inventory_quantity: z.number().int().nonnegative().default(0),
  options: variationsSchema.shape.options.optional(),
  variants: variationsSchema.shape.variants.optional(),
  outlets: z.array(z.object({ outletId: z.string().min(1).max(80), quantity: z.number().int().nonnegative() })).max(100).optional(),
  delivery: z.object({
    delivery: z.boolean().default(true),
    pickup: z.boolean().default(true),
    sameDay: z.boolean().default(false),
    readyInDays: z.number().int().min(0).max(60).default(0),
    readyIn: z.enum(["now", "1h", "same_day", "2_days"]).optional(),
    returnsDays: z.number().int().min(0).max(30).default(0),
    weightKg: z.number().min(0).max(1000).nullish(),
    size: z.enum(["small", "medium", "large"]).optional(),
  }).optional(),
  show_in_app: z.boolean().default(true),
  show_on_web: z.boolean().default(true),
  status: z.enum(["active", "draft"]).default("active"),
});

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-");
}

/** Publish (or save as a draft) a physical product from the wizard in one call. */
storeItemRoutes.post("/merchants/me/store/items", requireAuth, async (c) => {
  const ctx = await merchantStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, merchantId } = ctx;
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Check the details.", issues: parsed.error.issues }, 400);
  const item = parsed.data;
  const limits = await mediaLimits();
  if (item.images.length > limits.photos) return c.json({ error: "too_many_photos", message: `Up to ${limits.photos} photos.` }, 400);
  if (!item.show_in_app && !item.show_on_web && item.status === "active") {
    return c.json({ error: "nowhere_to_show", message: "Turn on Buy or your website, or save it as a draft." }, 400);
  }

  const settings = await getMarketplaceSettings();
  const plan = await storePlan(store, settings);
  const maxProducts = (await planLimits(plan, settings)).products;
  const count = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM store_products WHERE store_id = ? AND status != 'archived'", args: [String(store.id)] })).rows[0] as Row)?.n ?? 0);
  if (count >= maxProducts) {
    return c.json({ error: "product_limit_reached", message: `Your plan allows up to ${maxProducts} products.`, upgrade: true }, 409);
  }

  const outlets = (item.outlets ?? []).filter((o) => o.outletId);
  if (outlets.length) {
    if (!plan.isElite) return c.json({ error: "elite_required", message: "Stock per outlet is on Merchant Elite.", upgrade: true }, 403);
    if (!(await hasTable("store_outlet_inventory"))) return c.json({ error: "migration_pending", message: "Outlet stock isn't ready yet." }, 503);
    const ids = [...new Set(outlets.map((o) => o.outletId))];
    const owned = await db.execute({ sql: `SELECT id FROM merchant_outlets WHERE merchant_id = ? AND id IN (${ids.map(() => "?").join(",")})`, args: [merchantId, ...ids] });
    if (owned.rows.length !== ids.length) return c.json({ error: "not_found", message: "Outlet not found in this business." }, 404);
  }

  const hasVariants = Boolean(item.variants?.length);
  const variantStock = (item.variants ?? []).reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0);
  const outletStock = outlets.reduce((sum, o) => sum + o.quantity, 0);
  const quantity = outlets.length ? outletStock : hasVariants ? variantStock : item.inventory_quantity;

  const [imagesCol, appCol, webCol, deliveryCol] = await Promise.all([
    hasColumn("store_products", "images_json"), hasColumn("store_products", "show_in_app"),
    hasColumn("store_products", "show_on_web"), hasColumn("store_products", "delivery_json"),
  ]);
  const productId = newId("prod");
  const columns = ["id", "store_id", "title", "slug", "description", "price", "compare_at_price", "cost_price", "sku", "track_inventory", "inventory_quantity", "category_name", "badge", "image_url", "video_url", "has_variants", "status"];
  const values: (string | number | null)[] = [
    productId, String(store.id), item.title, slugify(item.title), item.description ?? "", item.price, item.compare_at_price ?? null,
    item.cost_price ?? null, item.sku ?? "", item.track_inventory ? 1 : 0, quantity, item.category_name || "General", item.badge ?? "",
    item.images[0] ?? "", item.video_url ?? "", hasVariants ? 1 : 0, item.status,
  ];
  if (imagesCol) { columns.push("images_json"); values.push(JSON.stringify(item.images)); }
  if (appCol) { columns.push("show_in_app"); values.push(item.show_in_app ? 1 : 0); }
  if (webCol) { columns.push("show_on_web"); values.push(item.show_on_web ? 1 : 0); }
  if (deliveryCol && item.delivery) { columns.push("delivery_json"); values.push(JSON.stringify(item.delivery)); }
  await db.execute({ sql: `INSERT INTO store_products (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, args: values });

  try {
    if (hasVariants) {
      await writeProductVariations(productId, [], { options: item.options ?? [], variants: item.variants ?? [] }, await getProductVariationSettings());
    }
    if (outlets.length) {
      const statements: DbStatement[] = outlets.map((o) => ({
        sql: `INSERT INTO store_outlet_inventory (id, store_id, product_id, outlet_id, quantity, low_stock_threshold, updated_at)
              VALUES (?, ?, ?, ?, ?, 5, datetime('now'))
              ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = excluded.quantity, updated_at = datetime('now')`,
        args: [newId("inv"), String(store.id), productId, o.outletId, o.quantity],
      }));
      await executeBatch(statements);
    }
  } catch (err) {
    // Take the half-made product back so a rejected variant set or outlet write doesn't leave a broken item.
    await db.execute({ sql: "DELETE FROM store_product_variants WHERE product_id = ?", args: [productId] }).catch(() => undefined);
    await db.execute({ sql: "DELETE FROM store_products WHERE id = ?", args: [productId] });
    if (err instanceof VariationError) return c.json({ error: err.code, message: err.message }, 400);
    throw err;
  }

  return c.json({
    ok: true,
    productId,
    status: item.status,
    storeId: String(store.id),
    storeSlug: String(store.slug ?? ""),
    showInApp: item.show_in_app,
    showOnWeb: item.show_on_web,
    ...(imagesCol ? {} : { migrationPending: true }),
  }, 201);
});

/**
 * Save changes to a physical product from the wizard's edit mode. The product keeps its id and address. Variants are
 * matched to the existing ones by their option values, so carts and past orders keep pointing at the same rows. Leave
 * `variants` out to keep the current options and variants as they are.
 */
storeItemRoutes.put("/merchants/me/store/items/:id", requireAuth, async (c) => {
  const ctx = await merchantStore(c);
  if (ctx instanceof Response) return ctx;
  const { store } = ctx;
  const productId = c.req.param("id")!;
  const current = (await db.execute({ sql: "SELECT id FROM store_products WHERE id = ? AND store_id = ? AND status != 'archived'", args: [productId, String(store.id)] })).rows[0];
  if (!current) return c.json({ error: "not_found", message: "Item not found." }, 404);
  const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Check the details.", issues: parsed.error.issues }, 400);
  const item = parsed.data;
  const limits = await mediaLimits();
  if (item.images.length > limits.photos) return c.json({ error: "too_many_photos", message: `Up to ${limits.photos} photos.` }, 400);
  if (!item.show_in_app && !item.show_on_web && item.status === "active") {
    return c.json({ error: "nowhere_to_show", message: "Turn on Buy or your website, or save it as a draft." }, 400);
  }

  const touchVariants = Array.isArray(raw.variants);
  const existing = (await db.execute({ sql: "SELECT id, option1_value, option2_value FROM store_product_variants WHERE product_id = ?", args: [productId] })).rows as Row[];
  let hasVariants = existing.length > 0;
  let quantity = item.inventory_quantity;
  if (touchVariants) {
    const byValues = new Map(existing.map((v) => [[v.option1_value, v.option2_value].filter((x) => x != null && x !== "").map(String).sort().join("\u0001"), String(v.id)]));
    const variants = (item.variants ?? []).map((v) => ({ ...v, id: v.id ?? byValues.get([...v.values].sort().join("\u0001")) }));
    try {
      await writeProductVariations(productId, existing.map((v) => String(v.id)), { options: variants.length ? item.options ?? [] : [], variants }, await getProductVariationSettings());
    } catch (err) {
      if (err instanceof VariationError) return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }
    hasVariants = variants.length > 0;
    if (hasVariants) quantity = variants.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0);
  } else if (hasVariants) {
    quantity = Number(((await db.execute({ sql: "SELECT COALESCE(SUM(inventory_quantity), 0) AS n FROM store_product_variants WHERE product_id = ?", args: [productId] })).rows[0] as Row)?.n ?? quantity);
  }

  const [imagesCol, appCol, webCol, deliveryCol, updatedCol] = await Promise.all([
    hasColumn("store_products", "images_json"), hasColumn("store_products", "show_in_app"),
    hasColumn("store_products", "show_on_web"), hasColumn("store_products", "delivery_json"), hasColumn("store_products", "updated_at"),
  ]);
  const sets: Record<string, string | number | null> = {
    title: item.title, description: item.description ?? "", price: item.price, compare_at_price: item.compare_at_price ?? null,
    inventory_quantity: quantity, category_name: item.category_name || "General", badge: item.badge ?? "",
    image_url: item.images[0] ?? "", video_url: item.video_url ?? "", has_variants: hasVariants ? 1 : 0, status: item.status,
  };
  if (item.cost_price != null) sets.cost_price = item.cost_price;
  if (item.sku != null) sets.sku = item.sku;
  if (imagesCol) sets.images_json = JSON.stringify(item.images);
  if (appCol) sets.show_in_app = item.show_in_app ? 1 : 0;
  if (webCol) sets.show_on_web = item.show_on_web ? 1 : 0;
  if (deliveryCol && item.delivery) sets.delivery_json = JSON.stringify(item.delivery);
  const cols = Object.keys(sets);
  await db.execute({
    sql: `UPDATE store_products SET ${cols.map((k) => `${k} = ?`).join(", ")}${updatedCol ? ", updated_at = datetime('now')" : ""} WHERE id = ? AND store_id = ?`,
    args: [...cols.map((k) => sets[k]), productId, String(store.id)],
  });
  return c.json({ ok: true, productId, status: item.status, storeId: String(store.id), storeSlug: String(store.slug ?? "") });
});
