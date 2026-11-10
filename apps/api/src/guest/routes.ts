import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { signToken, verifyToken } from "../auth/jwt.js";
import { toAuthUser } from "../auth/serialize.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { ensureAccountCode } from "../lib/profile-codes.js";
import { clientIp, consume, hashKey, tooManyRequests } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { DEMO_MARKETPLACE_PRODUCTS, DEMO_MARKETPLACE_STORES, marketplaceRoutes } from "../marketplace/routes.js";
import { paymentsIntegrationStatus } from "../payments/service.js";
import { notifyGuest } from "./notify.js";
import { getGuestSettings, guestSettingsPatch, setGuestSettings } from "./settings.js";
import { newTrackingCode, normalizeGuestPhone, normalizeTrackingCode } from "./service.js";

export const guestRoutes = new Hono();

type Row = Record<string, unknown>;

/** Cheap, indexed checks the whole feature stands on: the switch and the migration. */
async function guestReady(): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  if (!(await hasTable("guest_orders"))) return { ok: false, error: "guest_unavailable", message: "Guest checkout is being enabled. Please try again shortly." };
  if (!(await getGuestSettings()).enabled) return { ok: false, error: "guest_disabled", message: "Guest checkout is switched off. Please sign in to order." };
  return { ok: true };
}

guestRoutes.get("/guest/config", async (c) => {
  const [settings, ready] = await Promise.all([getGuestSettings(), guestReady()]);
  let cardAvailable = false;
  if (ready.ok && settings.cardEnabled) {
    try {
      const status = await paymentsIntegrationStatus();
      cardAvailable = status.providers.some((p) => p.key === "flutterwave" && p.active && p.configured) && status.collection.provider === "flutterwave";
    } catch {
      cardAvailable = false;
    }
  }
  return c.json({
    enabled: ready.ok,
    browsingEnabled: settings.browsingEnabled,
    cardAvailable,
    maxQuantity: settings.maxQuantity,
    suggestAccount: settings.suggestAccount,
    codeStatusEnabled: settings.codeStatusEnabled,
  });
});

const checkoutSchema = z.object({
  productId: z.string().min(1).max(120),
  variantId: z.string().min(1).max(120).optional(),
  quantity: z.number().int().min(1).max(50),
  name: z.string().trim().min(2).max(80),
  phone: z.string().min(6).max(20),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined), z.string().email().max(160).optional()),
  address: z.string().trim().min(3).max(240),
  area: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  createAccount: z.boolean().default(false),
  password: z.string().min(8).max(100).optional(),
}).refine((d) => !d.createAccount || !!d.password, { message: "Choose a password to create your account.", path: ["password"] });

type Priced = { productId: string; storeId: string; title: string; price: number; imageUrl?: string; variantId?: string; variantTitle?: string; stock: number | null; storeName: string };

/** The server decides what a guest pays: the product, its variant and price come from the catalogue, never the browser. */
async function priceProduct(productId: string, variantId: string | undefined): Promise<Priced | { error: string; status: 404 | 409; message: string }> {
  if (await hasTable("stores")) {
    const product = (await db.execute({ sql: "SELECT * FROM store_products WHERE id = ? OR slug = ?", args: [productId, productId] })).rows[0] as Row | undefined;
    if (product) {
      if (product.status !== "active") return { error: "unavailable", status: 409, message: "This product is not available right now." };
      const store = (await db.execute({ sql: "SELECT id, name, is_open, is_live FROM stores WHERE id = ?", args: [String(product.store_id)] })).rows[0] as Row | undefined;
      if (!store || Number(store.is_open ?? 1) === 0) return { error: "store_closed", status: 409, message: "This store is closed right now." };
      let price = Number(product.price);
      let stock: number | null = product.track_inventory ? Number(product.inventory_quantity ?? 0) : null;
      let variantTitle: string | undefined;
      if (Number(product.has_variants) === 1 || variantId) {
        const variant = variantId
          ? (await db.execute({ sql: "SELECT * FROM store_product_variants WHERE id = ? AND product_id = ?", args: [variantId, String(product.id)] })).rows[0] as Row | undefined
          : undefined;
        if (Number(product.has_variants) === 1 && !variant) return { error: "choose_option", status: 409, message: "Choose an option for this product." };
        if (variant) {
          price = Number(variant.price);
          variantTitle = String(variant.title);
          stock = product.track_inventory ? Number(variant.inventory_quantity ?? 0) : null;
        }
      }
      return { productId: String(product.id), storeId: String(product.store_id), title: String(product.title), price, imageUrl: (product.image_url as string | null) ?? undefined, variantId: variantId && variantTitle ? variantId : undefined, variantTitle, stock, storeName: String(store.name) };
    }
  }
  for (const [storeId, products] of Object.entries(DEMO_MARKETPLACE_PRODUCTS)) {
    const demo = products.find((p: Row) => p.id === productId || p.slug === productId);
    if (!demo) continue;
    const store = DEMO_MARKETPLACE_STORES.find((s) => s.id === storeId);
    return { productId: String(demo.id), storeId, title: String(demo.title), price: Number(demo.price), imageUrl: (demo.image_url as string | undefined) ?? undefined, stock: null, storeName: store?.name ?? "Marketplace Store" };
  }
  return { error: "product_not_found", status: 404, message: "We couldn't find that product." };
}

guestRoutes.post("/guest/checkout", async (c) => {
  const ready = await guestReady();
  if (!ready.ok) return c.json({ error: ready.error, message: ready.message }, 403);
  const limit = await consume(`ip:guest-checkout:${await hashKey(clientIp(c))}`, 8, 600);
  if (!limit.allowed) return tooManyRequests(c, limit, "Too many orders from this connection. Please wait a few minutes.");

  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const phone = normalizeGuestPhone(d.phone);
  if (!phone) return c.json({ error: "invalid_phone", message: "Enter a valid phone number, like 0772 123 456." }, 400);

  const [settings, marketplace] = await Promise.all([getGuestSettings(), getMarketplaceSettings()]);
  if (!marketplace.enabled) return c.json({ error: "marketplace_disabled", message: "The marketplace is closed right now." }, 403);
  if (d.quantity > settings.maxQuantity) return c.json({ error: "quantity_too_high", message: `You can order up to ${settings.maxQuantity} of an item as a guest.` }, 400);

  const priced = await priceProduct(d.productId, d.variantId);
  if ("error" in priced) return c.json({ error: priced.error, message: priced.message }, priced.status);
  if (priced.stock != null && d.quantity > priced.stock) return c.json({ error: "out_of_stock", message: "There isn't enough stock for that quantity." }, 409);
  if (priced.price * d.quantity < marketplace.minOrderAmountUgx) {
    return c.json({ error: "below_minimum", message: `The minimum order is UGX ${marketplace.minOrderAmountUgx.toLocaleString("en-UG")}.` }, 400);
  }

  // The shadow customer: a real account when this phone already has one (the order lands there), else a new one.
  const existing = (await db.execute({ sql: "SELECT id, role, status FROM users WHERE phone = ?", args: [phone] })).rows[0] as Row | undefined;
  if (existing && existing.role !== "customer") return c.json({ error: "phone_in_use", message: "This number belongs to a Peebee partner account. Sign in, or use another number." }, 409);
  if (existing && existing.status === "suspended") return c.json({ error: "account_suspended", message: "This number can't place orders." }, 403);
  let userId: string;
  let accountCreated = false;
  if (existing) {
    userId = String(existing.id);
  } else {
    userId = crypto.randomUUID();
    const emailTaken = d.email ? (await db.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [d.email] })).rows.length > 0 : false;
    const secret = d.createAccount && d.password ? d.password : crypto.randomUUID() + crypto.randomUUID();
    accountCreated = d.createAccount;
    await db.execute({
      sql: `INSERT INTO users (id, phone, email, name, password_hash, role, password_set_at)
            VALUES (?, ?, ?, ?, ?, 'customer', ${accountCreated ? "datetime('now')" : "NULL"})`,
      args: [userId, phone, emailTaken ? null : d.email ?? null, d.name, await bcrypt.hash(secret, 10)],
    });
    await ensureAccountCode(userId);
  }

  // The order itself goes through the same checkout every signed-in customer uses, with the price we just looked up.
  const internalToken = await signToken({ sub: userId, role: "customer", phone });
  const res = await marketplaceRoutes.request("/marketplace/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${internalToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId: priced.productId, storeId: priced.storeId, title: priced.title, price: priced.price, quantity: d.quantity, variantId: priced.variantId, variantTitle: priced.variantTitle, imageUrl: priced.imageUrl }],
      paymentRail: "escrow",
      paymentMethod: "momo",
      destinationAddress: d.address,
      destinationArea: d.area,
      destinationLat: d.lat,
      destinationLng: d.lng,
    }),
  });
  const placed = (await res.json().catch(() => ({}))) as { orders?: Row[]; order?: Row; error?: string; message?: string };
  if (!res.ok || !placed.order) {
    if (!existing) await db.execute({ sql: "DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM orders WHERE customer_id = ?)", args: [userId, userId] }).catch(() => {});
    return c.json({ error: placed.error ?? "checkout_failed", message: placed.message ?? "We couldn't place your order. Please try again." }, res.status === 201 ? 502 : (res.status as 400 | 409 | 422 | 500 | 502));
  }
  const orderId = String(placed.order.id);

  let trackingCode = newTrackingCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await db.execute({
      sql: `INSERT OR IGNORE INTO guest_orders (order_id, user_id, tracking_code, name, phone, email, address, wants_account, existing_account, account_activated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${accountCreated ? "datetime('now')" : "NULL"})`,
      args: [orderId, userId, trackingCode, d.name, phone, d.email ?? null, d.address, d.createAccount ? 1 : 0, existing ? 1 : 0],
    });
    if (inserted.rowsAffected > 0) break;
    trackingCode = newTrackingCode();
  }

  const token = await signToken({ sub: userId, role: "customer", phone, guestOrderId: orderId });
  void notifyGuest(orderId, "placed");
  // Choosing to create an account signs them in, exactly as registering does.
  const account = accountCreated
    ? {
        sessionToken: await signToken({ sub: userId, role: "customer", phone }),
        user: toAuthUser((await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [userId] })).rows[0]),
      }
    : {};
  return c.json({
    ...account,
    orderId,
    trackingCode,
    token,
    total: Number(placed.order.estimated_total ?? 0),
    accountCreated,
    existingAccount: !!existing,
  }, 201);
});

/** The user id behind a normal (not guest-scoped) sign-in token that still points at a live account, else null. */
async function registeredViewer(header: string | undefined): Promise<string | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifyToken(token);
    if (payload.guestOrderId) return null;
    const row = (await db.execute({ sql: "SELECT status FROM users WHERE id = ?", args: [payload.sub] })).rows[0] as Row | undefined;
    return row && row.status !== "suspended" ? payload.sub : null;
  } catch {
    return null;
  }
}

guestRoutes.get("/guest/track/:code", async (c) => {
  if (!(await hasTable("guest_orders"))) return c.json({ error: "not_found" }, 404);
  const limit = await consume(`ip:guest-track:${await hashKey(clientIp(c))}`, 30, 60);
  if (!limit.allowed) return tooManyRequests(c, limit, "Too many lookups. Please wait a moment.");
  const code = normalizeTrackingCode(c.req.param("code"));
  const row = (await db.execute({
    sql: `SELECT g.tracking_code, g.user_id, g.order_id, g.existing_account, g.account_activated_at, g.created_at, o.stage, o.rider_id, o.environment,
                 (SELECT li.name FROM list_items li WHERE li.list_id = o.list_id LIMIT 1) AS item_name
          FROM guest_orders g JOIN orders o ON o.id = g.order_id WHERE g.tracking_code = ?`,
    args: [code],
  })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found", message: "We couldn't find that tracking code." }, 404);
  const settings = await getGuestSettings();
  // A signed-in Peebee user can follow any code in the app, whatever the public-status switch says.
  const viewer = await registeredViewer(c.req.header("Authorization"));
  const base = {
    trackingCode: String(row.tracking_code),
    placedAt: String(row.created_at),
    canCreateAccount: !row.account_activated_at && !row.existing_account,
    hasAccount: !!row.account_activated_at || !!row.existing_account,
    codeStatusEnabled: settings.codeStatusEnabled,
    ...(viewer === String(row.user_id) ? { orderId: String(row.order_id) } : {}),
  };
  if (!settings.codeStatusEnabled && !viewer) return c.json(base);
  const stage = String(row.stage);
  const status = stage === "Settle" ? "delivered" : stage === "Arrived" || stage === "Handover" ? "arrived" : stage === "Deliver" ? "on_the_way" : stage === "Shop" ? "preparing" : stage === "Cancelled" ? "cancelled" : "received";
  return c.json({ ...base, item: row.item_name ? String(row.item_name) : null, status });
});

const accountSchema = z.object({ phone: z.string().min(6).max(20), password: z.string().min(8).max(100) });

/** Turns a guest's saved details into a real sign-in. The code and the phone number used must both match. */
guestRoutes.post("/guest/track/:code/account", async (c) => {
  if (!(await hasTable("guest_orders"))) return c.json({ error: "not_found" }, 404);
  const code = normalizeTrackingCode(c.req.param("code"));
  const limit = await consume(`ip:guest-account:${await hashKey(clientIp(c))}:${await hashKey(code)}`, 6, 600);
  if (!limit.allowed) return tooManyRequests(c, limit, "Too many attempts. Please wait a few minutes.");
  const parsed = accountSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const phone = normalizeGuestPhone(parsed.data.phone);
  const row = (await db.execute({ sql: "SELECT user_id, phone, existing_account, account_activated_at FROM guest_orders WHERE tracking_code = ?", args: [code] })).rows[0] as Row | undefined;
  if (!row || !phone || row.phone !== phone) return c.json({ error: "not_found", message: "That code and phone number don't match." }, 404);
  if (row.existing_account) return c.json({ error: "has_account", message: "This number already has a Peebee account. Please sign in." }, 409);
  if (row.account_activated_at) return c.json({ error: "has_account", message: "An account was already created for this order. Please sign in." }, 409);
  const claimed = await db.execute({
    sql: "UPDATE users SET password_hash = ?, password_set_at = datetime('now') WHERE id = ?",
    args: [await bcrypt.hash(parsed.data.password, 10), String(row.user_id)],
  });
  if (!claimed.rowsAffected) return c.json({ error: "not_found" }, 404);
  await db.execute({ sql: "UPDATE guest_orders SET account_activated_at = datetime('now') WHERE user_id = ? AND account_activated_at IS NULL", args: [String(row.user_id)] });
  const user = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [String(row.user_id)] })).rows[0] as Row;
  return c.json({ token: await signToken({ sub: String(user.id), role: "customer", phone }), user: toAuthUser(user) });
});

guestRoutes.get("/admin/guest-settings", requireAuth, requireRole("admin"), requirePermission("settings.view"), async (c) => {
  return c.json({ guest: await getGuestSettings() });
});

guestRoutes.patch("/admin/guest-settings", requireAuth, requireRole("admin"), requirePermission("settings.manage"), async (c) => {
  const parsed = guestSettingsPatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const before = await getGuestSettings();
  await setGuestSettings(parsed.data);
  const after = await getGuestSettings();
  await logActivity({ actor: c.get("user"), action: "settings.update", entityType: "settings", summary: "Updated guest access settings", before: { guest: before }, after: { guest: after }, ip: clientIp(c) });
  return c.json({ guest: after });
});
