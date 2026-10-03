import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { clientIp } from "../lib/ratelimit.js";

type Row = Record<string, unknown>;

/** Tuma managers' side of Tuma Car: what can be booked, who may drive/own,
 * which vehicles are on the road and who drives them. */
export const carAdminRoutes = new Hono();
carAdminRoutes.use("/admin/car/*", requireAuth, requireRole("admin"));

const shareField = z.number().int().min(0).max(100).nullable().optional();
const categorySchema = z
  .object({
    kind: z.enum(["passenger", "cargo"]),
    name: z.string().trim().min(1).max(80),
    seats: z.number().int().min(1).max(60).nullable().optional(),
    cargoType: z.string().trim().max(80).nullable().optional(),
    sizeLabel: z.string().trim().max(80).nullable().optional(),
    referenceImageKey: z.string().max(300).nullable().optional(),
    ratePerKm: z.number().int().min(0).max(1_000_000),
    minimumFare: z.number().int().min(0).max(10_000_000),
    ownerSharePercent: shareField,
    driverSharePercent: shareField,
    platformSharePercent: shareField,
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (c) => {
      const given = [c.ownerSharePercent, c.driverSharePercent, c.platformSharePercent].filter((n) => n != null);
      if (given.length === 0) return true;
      return given.length === 3 && c.ownerSharePercent! + c.driverSharePercent! + c.platformSharePercent! === 100;
    },
    { message: "Set all three shares totalling 100%, or leave them all empty to use the default split." },
  );

const categoryArgs = (c: z.infer<typeof categorySchema>) => [
  c.kind,
  c.name,
  c.seats ?? null,
  c.cargoType ?? null,
  c.sizeLabel ?? null,
  c.referenceImageKey ?? null,
  c.ratePerKm,
  c.minimumFare,
  c.ownerSharePercent ?? null,
  c.driverSharePercent ?? null,
  c.platformSharePercent ?? null,
  c.active ? 1 : 0,
  c.sort,
];

carAdminRoutes.get("/admin/car/categories", requirePermission("car.view"), async (c) => {
  const res = await db.execute("SELECT * FROM vehicle_categories ORDER BY sort ASC, name ASC");
  return c.json({ categories: res.rows });
});

carAdminRoutes.post("/admin/car/categories", requirePermission("car.manage"), async (c) => {
  const parsed = categorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const id = newId("vcat");
  await db.execute({
    sql: `INSERT INTO vehicle_categories (id, kind, name, seats, cargo_type, size_label, reference_image_key, rate_per_km, minimum_fare,
            owner_share_percent, driver_share_percent, platform_share_percent, active, sort)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, ...categoryArgs(parsed.data)],
  });
  await logActivity({ actor: c.get("user"), action: "car.category.create", entityType: "vehicle_category", entityId: id, summary: `Added car category ${parsed.data.name}`, after: parsed.data, ip: clientIp(c) });
  return c.json({ id }, 201);
});

carAdminRoutes.put("/admin/car/categories/:id", requirePermission("car.manage"), async (c) => {
  const id = c.req.param("id") as string;
  const parsed = categorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const res = await db.execute({
    sql: `UPDATE vehicle_categories SET kind = ?, name = ?, seats = ?, cargo_type = ?, size_label = ?, reference_image_key = ?,
            rate_per_km = ?, minimum_fare = ?, owner_share_percent = ?, driver_share_percent = ?, platform_share_percent = ?,
            active = ?, sort = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [...categoryArgs(parsed.data), id],
  });
  if (res.rowsAffected === 0) return c.json({ error: "not_found" }, 404);
  await logActivity({ actor: c.get("user"), action: "car.category.update", entityType: "vehicle_category", entityId: id, summary: `Updated car category ${parsed.data.name}`, after: parsed.data, ip: clientIp(c) });
  return c.json({ ok: true });
});

// ---- Owners & drivers -----------------------------------------------------

carAdminRoutes.get("/admin/car/partners", requirePermission("car.view"), async (c) => {
  const status = c.req.query("status");
  const res = await db.execute({
    sql: `SELECT p.*, u.name, u.phone FROM car_partners p JOIN users u ON u.id = p.user_id
          ${status ? "WHERE p.owner_status = ? OR p.driver_status = ?" : ""} ORDER BY p.updated_at DESC LIMIT 200`,
    args: status ? [status, status] : [],
  });
  return c.json({ partners: res.rows });
});

const decisionSchema = z.object({
  role: z.enum(["owner", "driver"]),
  status: z.enum(["approved", "rejected", "suspended"]),
  notes: z.string().max(500).optional(),
});

carAdminRoutes.post("/admin/car/partners/:userId/decision", requirePermission("car.manage"), async (c) => {
  const userId = c.req.param("userId") as string;
  const user = c.get("user");
  const parsed = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const column = parsed.data.role === "owner" ? "owner_status" : "driver_status";
  const res = await db.execute({
    sql: `UPDATE car_partners SET ${column} = ?, notes = COALESCE(?, notes), reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
          WHERE user_id = ? AND ${column} != 'none'`,
    args: [parsed.data.status, parsed.data.notes ?? null, user.sub, userId],
  });
  if (res.rowsAffected === 0) return c.json({ error: "not_found" }, 404);
  // A driver who is no longer approved stops taking rides and loses their vehicle.
  if (parsed.data.role === "driver" && parsed.data.status !== "approved") {
    await db.execute({ sql: "UPDATE car_driver_state SET online = 0, updated_at = datetime('now') WHERE driver_id = ?", args: [userId] });
    await db.execute({ sql: "UPDATE vehicle_assignments SET status = 'ended', ended_at = datetime('now') WHERE driver_id = ? AND status = 'active'", args: [userId] });
  }
  await logActivity({ actor: user, action: "car.partner.decision", entityType: "car_partner", entityId: userId, summary: `Car ${parsed.data.role} ${parsed.data.status}`, after: parsed.data, ip: clientIp(c) });
  return c.json({ ok: true });
});

// ---- Vehicles & assignments ----------------------------------------------

carAdminRoutes.get("/admin/car/vehicles", requirePermission("car.view"), async (c) => {
  const status = c.req.query("status");
  const res = await db.execute({
    sql: `SELECT v.*, o.name AS owner_name, cat.name AS category_name,
                 a.driver_id, d.name AS driver_name
          FROM vehicles v
          JOIN users o ON o.id = v.owner_id
          JOIN vehicle_categories cat ON cat.id = v.category_id
          LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.status = 'active'
          LEFT JOIN users d ON d.id = a.driver_id
          ${status ? "WHERE v.status = ?" : ""} ORDER BY v.created_at DESC LIMIT 200`,
    args: status ? [status] : [],
  });
  return c.json({ vehicles: res.rows });
});

carAdminRoutes.post("/admin/car/vehicles/:id/decision", requirePermission("car.manage"), async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ status: z.enum(["approved", "rejected", "suspended"]), notes: z.string().max(500).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const res = await db.execute({
    sql: "UPDATE vehicles SET status = ?, notes = COALESCE(?, notes), reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    args: [parsed.data.status, parsed.data.notes ?? null, user.sub, id],
  });
  if (res.rowsAffected === 0) return c.json({ error: "not_found" }, 404);
  if (parsed.data.status !== "approved") {
    await db.execute({ sql: "UPDATE car_driver_state SET online = 0, updated_at = datetime('now') WHERE vehicle_id = ?", args: [id] });
  }
  await logActivity({ actor: user, action: "car.vehicle.decision", entityType: "vehicle", entityId: id, summary: `Vehicle ${parsed.data.status}`, after: parsed.data, ip: clientIp(c) });
  return c.json({ ok: true });
});

carAdminRoutes.post("/admin/car/vehicles/:id/assign", requirePermission("car.manage"), async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ driverId: z.string().min(1).nullable() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const vehicle = (await db.execute({ sql: "SELECT status FROM vehicles WHERE id = ?", args: [id] })).rows[0] as Row | undefined;
  if (!vehicle) return c.json({ error: "not_found" }, 404);

  // Unassigning (driverId null) just ends the current assignment.
  if (parsed.data.driverId === null) {
    await db.execute({ sql: "UPDATE vehicle_assignments SET status = 'ended', ended_at = datetime('now') WHERE vehicle_id = ? AND status = 'active'", args: [id] });
    await db.execute({ sql: "UPDATE car_driver_state SET online = 0, vehicle_id = NULL, updated_at = datetime('now') WHERE vehicle_id = ?", args: [id] });
    await logActivity({ actor: user, action: "car.vehicle.unassign", entityType: "vehicle", entityId: id, summary: "Driver removed from vehicle", ip: clientIp(c) });
    return c.json({ ok: true });
  }

  if (vehicle.status !== "approved") return c.json({ error: "vehicle_not_approved", message: "Approve the vehicle before assigning a driver." }, 409);
  const driver = (await db.execute({ sql: "SELECT driver_status FROM car_partners WHERE user_id = ?", args: [parsed.data.driverId] })).rows[0] as Row | undefined;
  if (driver?.driver_status !== "approved") return c.json({ error: "driver_not_approved", message: "That person isn't an approved driver." }, 409);

  await db.execute({ sql: "UPDATE vehicle_assignments SET status = 'ended', ended_at = datetime('now') WHERE vehicle_id = ? AND status = 'active'", args: [id] });
  await db.execute({ sql: "UPDATE car_driver_state SET online = 0, vehicle_id = NULL, updated_at = datetime('now') WHERE vehicle_id = ?", args: [id] });
  await db.execute({
    sql: "INSERT INTO vehicle_assignments (id, vehicle_id, driver_id, assigned_by) VALUES (?, ?, ?, ?)",
    args: [newId("vasg"), id, parsed.data.driverId, user.sub],
  });
  await logActivity({ actor: user, action: "car.vehicle.assign", entityType: "vehicle", entityId: id, summary: "Driver assigned to vehicle", after: parsed.data, ip: clientIp(c) });
  return c.json({ ok: true });
});

// ---- Bookings overview -----------------------------------------------------

carAdminRoutes.get("/admin/car/bookings", requirePermission("car.view"), async (c) => {
  const res = await db.execute(`SELECT b.*, o.stage, o.estimated_total, o.final_total, cat.name AS category_name,
                                       cu.name AS customer_name, du.name AS driver_name, ou.name AS owner_name
                                FROM car_bookings b
                                JOIN orders o ON o.id = b.order_id
                                JOIN vehicle_categories cat ON cat.id = b.category_id
                                JOIN users cu ON cu.id = b.customer_id
                                LEFT JOIN users du ON du.id = b.driver_id
                                LEFT JOIN users ou ON ou.id = b.owner_id
                                ORDER BY b.created_at DESC LIMIT 200`);
  return c.json({ bookings: res.rows });
});
