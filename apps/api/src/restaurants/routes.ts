/**
 * Restaurant accounts — Phase 1 of food ordering (see project discussion:
 * restaurants self-manage their own menu/orders/payouts, in later phases).
 * This phase is just the business record and the admin directory.
 *
 * Not yet a first-class users.role value — see
 * ../db/migrations/0032_restaurants.sql for why. A restaurant owner is a
 * normal customer-role account that also owns a row in `restaurants`;
 * every route here checks that ownership directly (via owner_id) rather
 * than a role claim.
 */

import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { isAdminRole, requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { hasColumn } from "../lib/schema.js";
import { newId } from "../lib/ids.js";
import { clientIp } from "../lib/ratelimit.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { reconcileFoodHours } from "./hours.js";

export const restaurantRoutes = new Hono();

type Row = Record<string, unknown>;

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour)");

const profileSchema = z.object({
  businessType: z.enum(["restaurant", "kitchen", "street_food", "bakery"]).optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  cuisine: z.string().max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
  address: z.string().max(240).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  // Scheduled opening hours, "HH:MM" local time. Both null/omitted means no
  // schedule — is_open below is a pure manual toggle in that case.
  openTime: timeOfDay.nullable().optional(),
  closeTime: timeOfDay.nullable().optional(),
});

/**
 * Registers a restaurant business for the signed-in account — one per
 * owner for now (a person running multiple restaurants isn't supported
 * yet). Starts `pending_approval`, invisible to customers until an admin
 * approves it, same shape as rider verification.
 */
restaurantRoutes.post("/restaurants/apply", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const existing = await db.execute({ sql: "SELECT id FROM restaurants WHERE owner_id = ?", args: [user.sub] });
  if (existing.rows.length > 0) {
    return c.json({ error: "already_registered", message: "You've already registered a restaurant" }, 409);
  }

  const id = newId("rst");
  const environment = await getPlatformEnvironment();
  const hasType = await hasColumn("restaurants", "business_type");
  if (!hasType && d.businessType && d.businessType !== "restaurant") return c.json({error:"food_categories_unavailable", message:"Food categories are being enabled. Please try again shortly."}, 503);
  await db.execute({
    sql: `INSERT INTO restaurants (id, owner_id, name, description, cuisine, phone, address, lat, lng, open_time, close_time, environment${hasType ? ", business_type" : ""})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasType ? ", ?" : ""})`,
    args: [
      id,
      user.sub,
      d.name,
      d.description ?? null,
      d.cuisine ?? null,
      d.phone ?? null,
      d.address ?? null,
      d.lat ?? null,
      d.lng ?? null,
      d.openTime ?? null,
      d.closeTime ?? null,
      environment,
      ...(hasType ? [d.businessType ?? "restaurant"] : []),
    ],
  });

  const res = await db.execute({ sql: "SELECT * FROM restaurants WHERE id = ?", args: [id] });
  return c.json({ restaurant: res.rows[0] }, 201);
});

/** The signed-in account's own restaurant, if they have one — 404 rather
 * than an empty object, so the restaurant app can tell "no restaurant yet"
 * apart from "restaurant with no fields set". */
restaurantRoutes.get("/restaurants/me", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM restaurants WHERE owner_id = ?", args: [user.sub] });
  const restaurant = res.rows[0] as Row | undefined;
  if (!restaurant) return c.json({ error: "not_found" }, 404);
  return c.json({ restaurant: await reconcileFoodHours(restaurant) });
});

const updateSchema = profileSchema.partial().extend({
  isOpen: z.boolean().optional(),
});

/** Everything except `status` (admin-only, see below) — a restaurant
 * manages its own profile and open/closed state freely. */
restaurantRoutes.patch("/restaurants/me", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const existing = await db.execute({ sql: "SELECT id FROM restaurants WHERE owner_id = ?", args: [user.sub] });
  if (existing.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const fields: Record<string, unknown> = {};
  if (d.businessType !== undefined) {
    if (await hasColumn("restaurants", "business_type")) fields.business_type = d.businessType;
    else if (d.businessType !== "restaurant") return c.json({error:"food_categories_unavailable", message:"Food categories are being enabled. Please try again shortly."}, 503);
  }
  if (d.name != null) fields.name = d.name;
  if (d.description != null) fields.description = d.description;
  if (d.cuisine != null) fields.cuisine = d.cuisine;
  if (d.phone != null) fields.phone = d.phone;
  if (d.address != null) fields.address = d.address;
  if (d.lat != null) fields.lat = d.lat;
  if (d.lng != null) fields.lng = d.lng;
  if (d.isOpen != null) fields.is_open = d.isOpen ? 1 : 0;
  if (d.openTime !== undefined) fields.open_time = d.openTime;
  if (d.closeTime !== undefined) fields.close_time = d.closeTime;

  const keys = Object.keys(fields);
  if (keys.length > 0) {
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    await db.execute({
      sql: `UPDATE restaurants SET ${setClause}, updated_at = datetime('now') WHERE owner_id = ?`,
      args: [...keys.map((k) => fields[k]), user.sub] as never,
    });
  }

  const res = await db.execute({ sql: "SELECT * FROM restaurants WHERE owner_id = ?", args: [user.sub] });
  return c.json({ restaurant: res.rows[0] });
});

// ---------------------------------------------------------------------------
// Admin directory — approve/suspend, same shape as rider verification.
// ---------------------------------------------------------------------------

restaurantRoutes.get("/admin/restaurants", requireAuth, requireRole("admin"), requirePermission("restaurants.view"), async (c) => {
  const status = c.req.query("status")?.trim();
  const conditions: string[] = [];
  const args: string[] = [];
  if (status) {
    conditions.push("r.status = ?");
    args.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const res = await db.execute({
    sql: `SELECT r.*, u.name as owner_name, u.phone as owner_phone, u.email as owner_email
          FROM restaurants r JOIN users u ON u.id = r.owner_id
          ${where}
          ORDER BY r.created_at DESC`,
    args,
  });
  return c.json({ restaurants: res.rows });
});

const statusSchema = z.object({ status: z.enum(["pending_approval", "active", "suspended"]) });

restaurantRoutes.post(
  "/admin/restaurants/:id/status",
  requireAuth,
  requireRole("admin"),
  requirePermission("restaurants.manage"),
  async (c) => {
    const id = c.req.param("id") as string;
    const admin = c.get("user");
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await db.execute({ sql: "SELECT * FROM restaurants WHERE id = ?", args: [id] });
    const restaurant = before.rows[0] as Row | undefined;
    if (!restaurant) return c.json({ error: "not_found" }, 404);

    await db.execute({
      sql: "UPDATE restaurants SET status = ?, updated_at = datetime('now') WHERE id = ?",
      args: [parsed.data.status, id],
    });

    await logActivity({
      actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
      action: "restaurant.status",
      entityType: "restaurant",
      entityId: id,
      summary: `${restaurant.name} — status changed from ${restaurant.status} to ${parsed.data.status}`,
      before: { status: restaurant.status },
      after: { status: parsed.data.status },
      ip: clientIp(c),
    });

    const updated = await db.execute({ sql: "SELECT * FROM restaurants WHERE id = ?", args: [id] });
    return c.json({ restaurant: updated.rows[0] });
  },
);
