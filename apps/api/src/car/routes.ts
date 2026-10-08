import { Hono } from "hono";
import { z } from "zod";
import { CAR_MODEL_CATALOG } from "@peebee/shared";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, getMatchingSettings, getPlatformEnvironment, isServiceEnabled } from "../lib/settings.js";
import { servicePaused } from "../lib/service-gate.js";
import { computeBidding, loadBiddingContext, validateBid } from "../orders/bidding.js";
import { currentVisibilityRadiusKm, orderMatchPoint } from "../orders/matching.js";
import { createOrderFromInput } from "../orders/routes.js";
import { checkPaymentStatus, initiateDisbursement, UnsupportedNetworkError } from "../payments/service.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { passengerSchema } from "../passengers/routes.js";
import { endAssignment, quoteFare } from "./service.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { openForDriversSql, scheduledAvailable, toDbTime, validateScheduledFor } from "./scheduled.js";
import { acceptsTier, nearbyTierCounts, tierFare, type CarServiceTier } from "./tiers.js";

type Row = Record<string, unknown>;

/** Customer, owner and driver endpoints for Peebee Car. Everything stays closed
 * until an admin turns Car on (and migration 0065 has been applied). */
export const carRoutes = new Hono();
carRoutes.use("/car/*", requireAuth);

// 503 until the car tables exist, 403 while Car is switched off.
carRoutes.use("/car/*", async (c, next) => {
  if (!(await hasTable("car_bookings"))) return c.json({ error: "car_unavailable", message: "Peebee Car isn't ready yet." }, 503);
  const settings = await getCarSettings();
  if (!settings.enabled) return c.json({ error: "car_disabled", message: "Peebee Car isn't available right now." }, 403);
  await next();
});

carRoutes.get("/car/config", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const settings = await getCarSettings();
  const categories = await db.execute(
    `SELECT id, kind, name, seats, cargo_type, size_label, reference_image_key, rate_per_km, minimum_fare
     FROM vehicle_categories WHERE active = 1 ORDER BY sort ASC, name ASC`,
  );
  const scheduled = (await scheduledAvailable(settings.scheduled))
    ? { maxAdvanceHours: settings.scheduled.maxAdvanceHours, minLeadMinutes: settings.scheduled.minLeadMinutes }
    : null;
  const carpool = settings.carpool.enabled && (await hasTable("carpool_trips"))
    ? { maxSeatsPerBooking: settings.carpool.maxSeatsPerBooking, maxRepeatWeeks: settings.carpool.maxRepeatWeeks }
    : null;
  const selfDrive = settings.selfDrive.enabled && settings.selfDrive.platformPercent != null && (await hasTable("rentals")) ? { maxDays: settings.selfDrive.maxDays } : null;
  const serviceTiers = await hasColumn("car_bookings", "service_tier") && await hasColumn("car_bookings", "vehicle_size") && await hasColumn("vehicles", "accepts_convenient") ? settings.servicePricing : null;
  return c.json({ onDemandEnabled: settings.onDemandEnabled, matchingMode: settings.matchingMode, scheduled, carpool, selfDrive, serviceTiers, vehiclePhotos: settings.vehiclePhotos, kyc: settings.kyc, deals: settings.deals.enabled && (await hasTable("driver_requests")) && (await hasColumn("vehicle_assignments", "fee_type")) ? { shareEnabled: settings.deals.shareEnabled, rentEnabled: settings.deals.rentEnabled, minOwnerSharePercent: settings.deals.minOwnerSharePercent, maxOwnerSharePercent: settings.deals.maxOwnerSharePercent, maxRentPerDay: settings.deals.maxRentPerDay } : null, categories: categories.rows });
});

carRoutes.get("/car/service-options", async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (!(await hasColumn("car_bookings", "service_tier")) || !(await hasColumn("vehicles", "accepts_convenient"))) return c.json({ error: "tiers_unavailable" }, 503);
  if (!(await hasColumn("car_bookings", "vehicle_size"))) return c.json({ error: "vehicle_sizes_unavailable" }, 503);
  const parsed = z.object({ pickupLat: z.coerce.number().min(-90).max(90), pickupLng: z.coerce.number().min(-180).max(180), destinationLat: z.coerce.number().min(-90).max(90), destinationLng: z.coerce.number().min(-180).max(180) }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_location" }, 400);
  const settings = await getCarSettings();
  const pricing = settings.servicePricing!;
  const t = parsed.data;
  const distanceKm = haversineKm(t.pickupLat, t.pickupLng, t.destinationLat, t.destinationLng);
  const counts = await nearbyTierCounts(t.pickupLat, t.pickupLng, settings.maxPickupKm, pricing.xlMinSeats);
  const options = (["normal", "large"] as const).flatMap((size) => (["convenient", "comfort"] as const).map((tier) => ({ size, tier, fare: tierFare(distanceKm, tier, pricing, size), nearby: counts[size][tier] })));
  return c.json({ distanceKm: Math.round(distanceKm * 10) / 10, options });
});

// ---- Who am I: owner / driver status, vehicles, current car -----------------

carRoutes.get("/car/me", async (c) => {
  const user = c.get("user");
  const partner = (await db.execute({ sql: "SELECT * FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  const vehicles = await db.execute({
    sql: `SELECT v.*, cat.name AS category_name, a.driver_id, d.name AS driver_name
          FROM vehicles v JOIN vehicle_categories cat ON cat.id = v.category_id
          LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.status = 'active'
          LEFT JOIN users d ON d.id = a.driver_id
          WHERE v.owner_id = ? ORDER BY v.created_at DESC`,
    args: [user.sub],
  });
  const driving = await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.category_id, v.status, cat.name AS category_name
          FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id JOIN vehicle_categories cat ON cat.id = v.category_id
          WHERE a.driver_id = ? AND a.status = 'active'`,
    args: [user.sub],
  });
  const state = (await db.execute({ sql: "SELECT * FROM car_driver_state WHERE driver_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  const photoIds = await vehiclePhotoIds(vehicles.rows.map((v) => String((v as Row).id)));
  const documents = await documentKinds(user.sub);
  return c.json({
    needsVehicle: partner?.needs_vehicle === 1,
    documents,
    ownerStatus: (partner?.owner_status as string) ?? "none",
    driverStatus: (partner?.driver_status as string) ?? "none",
    vehicles: vehicles.rows.map((v) => ({ ...v, photos: photoIds[String((v as Row).id)] ?? [] })),
    assignedVehicles: driving.rows,
    online: state?.online === 1,
    activeVehicleId: (state?.vehicle_id as string | null) ?? null,
  });
});

const applySchema = z.object({
  as: z.enum(["owner", "driver"]),
  licenceExpiry: z.string().max(20).optional(),
  idDocumentKey: z.string().max(300).optional(),
  licenceKey: z.string().max(300).optional(),
  /** A driver who doesn't have a car: Peebee or an owner can provide one. */
  needsVehicle: z.boolean().optional(),
});

/** Apply to be a car owner and/or a driver. A manager approves it in Admin. */
carRoutes.post("/car/partner/apply", async (c) => {
  const user = c.get("user");
  const parsed = applySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const column = parsed.data.as === "owner" ? "owner_status" : "driver_status";
  await db.execute({ sql: "INSERT OR IGNORE INTO car_partners (user_id) VALUES (?)", args: [user.sub] });
  const res = await db.execute({
    sql: `UPDATE car_partners SET ${column} = 'pending',
            id_document_key = COALESCE(?, id_document_key), licence_key = COALESCE(?, licence_key), licence_expiry = COALESCE(?, licence_expiry),
            updated_at = datetime('now')
          WHERE user_id = ? AND ${column} IN ('none', 'rejected')`,
    args: [parsed.data.idDocumentKey ?? null, parsed.data.licenceKey ?? null, parsed.data.licenceExpiry ?? null, user.sub],
  });
  if (res.rowsAffected === 0) return c.json({ error: "already_applied", message: "You've already applied — we'll tell you when it's reviewed." }, 409);
  if (parsed.data.as === "driver" && parsed.data.needsVehicle != null && (await hasColumn("car_partners", "needs_vehicle"))) {
    await db.execute({ sql: "UPDATE car_partners SET needs_vehicle = ? WHERE user_id = ?", args: [parsed.data.needsVehicle ? 1 : 0, user.sub] });
  }
  return c.json({ ok: true }, 201);
});

// ---- Owner -----------------------------------------------------------------

const vehicleSchema = z.object({
  categoryId: z.string().min(1),
  plate: z.string().trim().toUpperCase().min(3).max(16),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  year: z.number().int().min(1980).max(2100).optional(),
  colour: z.string().trim().max(40).optional(),
  modelCatalogId: z.string().max(80).optional(),
  serviceClass: z.enum(["convenient", "comfort"]).default("convenient"),
  acceptsConvenient: z.boolean().default(false),
  conditionGrade: z.enum(["excellent", "good", "fair"]).default("good"),
  seatCapacity: z.number().int().min(1).max(50).optional(),
  lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  features: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

/** An approved owner puts a vehicle up for service; a manager approves it and assigns a driver. */
carRoutes.post("/car/vehicles", async (c) => {
  const user = c.get("user");
  const parsed = vehicleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (parsed.data.lastServiceDate && parsed.data.lastServiceDate > new Date().toISOString().slice(0, 10)) return c.json({ error: "invalid_service_date", message: "Last service date cannot be in the future." }, 400);
  // Owners can add vehicles; so can drivers (their own car). A driver who isn't an owner yet
  // becomes one, pending, so the car and the owner profile are vetted on their own.
  const partner = (await db.execute({ sql: "SELECT owner_status, driver_status FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  const isOwner = partner?.owner_status === "approved";
  const isDriver = partner?.driver_status === "approved" || partner?.driver_status === "pending";
  if (!isOwner && !isDriver && partner?.owner_status !== "pending") return c.json({ error: "not_a_partner", message: "Apply to be an owner or a driver first." }, 403);
  if (partner?.owner_status === "none" || partner?.owner_status === "rejected") {
    await db.execute({ sql: "UPDATE car_partners SET owner_status = 'pending', updated_at = datetime('now') WHERE user_id = ?", args: [user.sub] });
  }
  const category = (await db.execute({ sql: "SELECT 1 FROM vehicle_categories WHERE id = ? AND active = 1", args: [parsed.data.categoryId] })).rows[0];
  if (!category) return c.json({ error: "invalid_category" }, 400);
  const id = newId("veh");
  const model = parsed.data.modelCatalogId ? CAR_MODEL_CATALOG.find((m) => m.id === parsed.data.modelCatalogId) : undefined;
  if (parsed.data.modelCatalogId && !model) return c.json({ error: "invalid_model" }, 400);
  try {
    const profileColumns = ["model_catalog_id", "service_class", "condition_grade", "seat_capacity", "features_json", "last_service_date"];
    const profileReady = (await Promise.all(profileColumns.map((column) => hasColumn("vehicles", column)))).every(Boolean);
    const make = model?.make ?? parsed.data.make ?? null;
    const modelName = model ? `${model.model}${model.variant ? ` ${model.variant}` : ""}` : parsed.data.model ?? null;
    if (profileReady) {
      const allowsConvenient = parsed.data.serviceClass === "comfort" && parsed.data.acceptsConvenient;
      const hasPreference = await hasColumn("vehicles", "accepts_convenient");
      await db.execute({
        sql: `INSERT INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour, model_catalog_id, service_class, condition_grade, seat_capacity, features_json, last_service_date${hasPreference ? ", accepts_convenient" : ""}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasPreference ? ", ?" : ""})`,
        args: [id, user.sub, parsed.data.categoryId, parsed.data.plate, make, modelName, parsed.data.year ?? null, parsed.data.colour ?? null, model?.id ?? null, parsed.data.serviceClass, parsed.data.conditionGrade, parsed.data.seatCapacity ?? model?.seats ?? null, JSON.stringify(parsed.data.features), parsed.data.lastServiceDate ?? null, ...(hasPreference ? [allowsConvenient ? 1 : 0] : [])],
      });
    } else {
      await db.execute({ sql: "INSERT INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [id, user.sub, parsed.data.categoryId, parsed.data.plate, make, modelName, parsed.data.year ?? null, parsed.data.colour ?? null] });
    }
  } catch {
    return c.json({ error: "plate_taken", message: "A vehicle with that number plate is already registered." }, 409);
  }
  return c.json({ id }, 201);
});

carRoutes.patch("/car/vehicles/:id/ride-service", async (c) => {
  if (!(await hasColumn("vehicles", "accepts_convenient"))) return c.json({ error: "tiers_unavailable" }, 503);
  const parsed = z.object({ serviceClass: z.enum(["convenient", "comfort"]), acceptsConvenient: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const owner = c.get("user");
  const updated = await db.execute({ sql: "UPDATE vehicles SET service_class = ?, accepts_convenient = ? WHERE id = ? AND owner_id = ?", args: [parsed.data.serviceClass, parsed.data.serviceClass === "comfort" && parsed.data.acceptsConvenient ? 1 : 0, c.req.param("id"), owner.sub] });
  return updated.rowsAffected ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/** The owner's view of rides being taken in their vehicles, current first. */
carRoutes.get("/car/owner/rides", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT b.id, b.order_id, b.status, b.vehicle_id, v.plate, du.name AS driver_name, o.stage, o.pickup_address, o.destination_address,
                 o.estimated_total, o.final_total, b.owner_amount, b.driver_amount, b.platform_amount, b.pool_amount, b.settled_at, b.created_at
          FROM car_bookings b
          JOIN orders o ON o.id = b.order_id
          LEFT JOIN vehicles v ON v.id = b.vehicle_id
          LEFT JOIN users du ON du.id = b.driver_id
          WHERE b.owner_id = ? ORDER BY (b.status = 'requested') DESC, b.created_at DESC LIMIT 100`,
    args: [user.sub],
  });
  const earned = (await db.execute({ sql: "SELECT COALESCE(SUM(owner_amount), 0) AS total FROM car_bookings WHERE owner_id = ? AND status = 'completed'", args: [user.sub] })).rows[0] as Row;
  // What each of their drivers has earned from rides in the owner's cars.
  const drivers = (await db.execute({
    sql: `SELECT b.driver_id, du.name, COUNT(*) AS rides, COALESCE(SUM(b.driver_amount), 0) AS driver_earned, COALESCE(SUM(b.owner_amount), 0) AS owner_earned
          FROM car_bookings b JOIN users du ON du.id = b.driver_id
          WHERE b.owner_id = ? AND b.status = 'completed' AND b.driver_id != ? GROUP BY b.driver_id, du.name ORDER BY driver_earned DESC`,
    args: [user.sub, user.sub],
  })).rows as Row[];
  return c.json({
    rides: res.rows,
    totalEarned: Number(earned.total),
    drivers: drivers.map((d) => ({ driverId: d.driver_id, name: d.name, rides: Number(d.rides), driverEarned: Number(d.driver_earned), ownerEarned: Number(d.owner_earned) })),
  });
});

// ---- Driver ----------------------------------------------------------------

const onlineSchema = z.object({
  online: z.boolean(),
  vehicleId: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

carRoutes.post("/car/driver/online", async (c) => {
  const user = c.get("user");
  const parsed = onlineSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const partner = (await db.execute({ sql: "SELECT driver_status FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  if (partner?.driver_status !== "approved") return c.json({ error: "not_a_driver", message: "You need to be an approved driver first." }, 403);

  let vehicleId: string | null = null;
  if (parsed.data.online) {
    const assigned = await db.execute({
      sql: `SELECT v.id FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id
            WHERE a.driver_id = ? AND a.status = 'active' AND v.status = 'approved' ${parsed.data.vehicleId ? "AND v.id = ?" : ""}
            ORDER BY a.assigned_at DESC LIMIT 1`,
      args: parsed.data.vehicleId ? [user.sub, parsed.data.vehicleId] : [user.sub],
    });
    vehicleId = (assigned.rows[0]?.id as string | undefined) ?? null;
    if (!vehicleId) return c.json({ error: "no_vehicle", message: "No approved vehicle has been assigned to you yet." }, 409);
  }
  await db.execute({
    sql: `INSERT INTO car_driver_state (driver_id, vehicle_id, online, lat, lng) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(driver_id) DO UPDATE SET vehicle_id = excluded.vehicle_id, online = excluded.online,
            lat = COALESCE(excluded.lat, lat), lng = COALESCE(excluded.lng, lng), updated_at = datetime('now')`,
    args: [user.sub, vehicleId, parsed.data.online ? 1 : 0, parsed.data.lat ?? null, parsed.data.lng ?? null],
  });
  return c.json({ ok: true, online: parsed.data.online, vehicleId });
});

carRoutes.post("/car/driver/location", async (c) => {
  const user = c.get("user");
  const parsed = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await db.execute({ sql: "UPDATE car_driver_state SET lat = ?, lng = ?, updated_at = datetime('now') WHERE driver_id = ?", args: [parsed.data.lat, parsed.data.lng, user.sub] });
  return c.json({ ok: true });
});

/** The driver's own state: online with an approved, assigned vehicle. */
async function onlineDriver(userId: string): Promise<{ vehicleId: string; categoryId: string; categoryKind: unknown; serviceClass: unknown; acceptsConvenient: unknown; seatCapacity: unknown; lat: number | null; lng: number | null } | null> {
  const preference = await hasColumn("vehicles", "accepts_convenient");
  const res = await db.execute({
    sql: `SELECT s.vehicle_id, s.lat, s.lng, v.category_id, cat.kind AS category_kind, v.service_class, v.seat_capacity, ${preference ? "v.accepts_convenient" : "0 AS accepts_convenient"} FROM car_driver_state s
          JOIN car_partners p ON p.user_id = s.driver_id AND p.driver_status = 'approved'
          JOIN vehicles v ON v.id = s.vehicle_id AND v.status = 'approved'
          JOIN vehicle_categories cat ON cat.id = v.category_id
          JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.driver_id = s.driver_id AND a.status = 'active'
          WHERE s.driver_id = ? AND s.online = 1`,
    args: [userId],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row) return null;
  return { vehicleId: String(row.vehicle_id), categoryId: String(row.category_id), categoryKind: row.category_kind, serviceClass: row.service_class, acceptsConvenient: row.accepts_convenient, seatCapacity: row.seat_capacity, lat: row.lat as number | null, lng: row.lng as number | null };
}

/** Open car rides for the driver's vehicle category, nearest first. */
carRoutes.get("/car/driver/jobs", async (c) => {
  const user = c.get("user");
  const driver = await onlineDriver(user.sub);
  if (!driver) return c.json({ jobs: [] });
  const carSettings = await getCarSettings();
  const { maxPickupKm } = carSettings;
  const environment = await getPlatformEnvironment();
  const openSql = await openForDriversSql(carSettings.scheduled.openMinutes);
  const scheduledSelect = (await hasColumn("car_bookings", "scheduled_for")) ? "b.scheduled_for" : "NULL";
  const tiersReady = await hasColumn("car_bookings", "service_tier");
  const sizesReady = await hasColumn("car_bookings", "vehicle_size");
  const res = await db.execute({
    sql: `SELECT o.*, b.category_id, ${tiersReady ? "b.service_tier" : "NULL AS service_tier"}, ${sizesReady ? "b.vehicle_size" : "'normal' AS vehicle_size"}, ${scheduledSelect} AS scheduled_for, cu.name AS customer_name FROM car_bookings b
          JOIN orders o ON o.id = b.order_id JOIN users cu ON cu.id = o.customer_id
          WHERE ${tiersReady ? "(b.category_id = ? OR b.service_tier IS NOT NULL)" : "b.category_id = ?"} AND b.status = 'requested' AND o.rider_id IS NULL AND o.stage IN ('Create', 'Match')
          AND o.environment = ? ${openSql}
          AND o.id NOT IN (SELECT order_id FROM order_rider_exclusions WHERE rider_id = ?)`,
    args: [driver.categoryId, environment, user.sub],
  });
  const applied = new Set(
    ((await db.execute({ sql: "SELECT order_id FROM order_applications WHERE rider_id = ? AND status = 'pending'", args: [user.sub] })).rows as Row[]).map((r) => String(r.order_id)),
  );
  const bidCtx = await loadBiddingContext();
  const modes = [...new Set([...bidCtx.enabledModes, "customer_selects" as const])];
  const jobs = (res.rows as Row[])
    .filter((o) => !o.service_tier || (driver.categoryKind === "passenger" && driver.lat != null && driver.lng != null && acceptsTier({ service_class: driver.serviceClass, accepts_convenient: driver.acceptsConvenient, seat_capacity: driver.seatCapacity, lat: driver.lat, lng: driver.lng }, o.service_tier as CarServiceTier, carSettings.servicePricing!.xlMinSeats, o.service_tier === "xl" ? "large" : o.vehicle_size === "large" ? "large" : "normal")))
    .map((o) => {
      const point = orderMatchPoint(o);
      const km = point && driver.lat != null && driver.lng != null ? haversineKm(point.lat, point.lng, driver.lat, driver.lng) : null;
      const radius = currentVisibilityRadiusKm(o.updated_at as string);
      const bidding = computeBidding(o, bidCtx.settings, modes);
      return {
        km,
        job: {
          id: o.id,
          customerName: o.customer_name,
          pickupAddress: o.pickup_address,
          destinationAddress: o.destination_address,
          distanceKm: o.distance_km,
          fare: o.estimated_total,
          serviceTier: o.service_tier ?? null,
          vehicleSize: o.vehicle_size ?? "normal",
          pickupDistanceKm: km != null ? Math.round(km * 10) / 10 : null,
          matchingMode: o.matching_mode,
          scheduledFor: o.scheduled_for ? new Date(`${String(o.scheduled_for).replace(" ", "T")}Z`).toISOString() : null,
          applied: applied.has(String(o.id)),
          bidding: bidding.active ? { appPrice: bidding.appPrice, min: bidding.min, max: bidding.max } : null,
        },
        visible: km == null || (km <= maxPickupKm && (radius == null || km <= radius)),
      };
    })
    .filter((e) => e.visible)
    .sort((a, b) => (driver.serviceClass === "comfort" ? Number(b.job.serviceTier === "comfort") - Number(a.job.serviceTier === "comfort") : 0) || (a.km ?? Infinity) - (b.km ?? Infinity));
  return c.json({ jobs: jobs.map((e) => e.job) });
});

/** The driver's ride in progress (if any) and their recent finished rides. */
carRoutes.get("/car/driver/active", async (c) => {
  const user = c.get("user");
  // A ride booked for someone else: the driver meets the passenger, not the booker.
  const passengerSelect = (await hasColumn("orders", "passenger_name")) ? "o.passenger_name, o.passenger_phone" : "NULL AS passenger_name, NULL AS passenger_phone";
  const active = await db.execute({
    sql: `SELECT o.id, o.stage, o.estimated_total, o.final_total, o.pickup_address, o.pickup_lat, o.pickup_lng,
                 o.destination_address, o.destination_lat, o.destination_lng, o.distance_km, o.customer_id, cu.name AS customer_name,
                 ${passengerSelect}
          FROM orders o JOIN car_bookings b ON b.order_id = o.id JOIN users cu ON cu.id = o.customer_id
          WHERE o.rider_id = ? AND o.stage NOT IN ('Settle', 'Cancelled') LIMIT 1`,
    args: [user.sub],
  });
  const recent = await db.execute({
    sql: `SELECT b.order_id, b.driver_amount, b.settled_at, o.pickup_address, o.destination_address
          FROM car_bookings b JOIN orders o ON o.id = b.order_id
          WHERE b.driver_id = ? AND b.status = 'completed' ORDER BY b.settled_at DESC LIMIT 20`,
    args: [user.sub],
  });
  const earned = (await db.execute({ sql: "SELECT COALESCE(SUM(driver_amount), 0) AS total FROM car_bookings WHERE driver_id = ? AND status = 'completed'", args: [user.sub] })).rows[0] as Row;
  return c.json({ active: active.rows[0] ?? null, recent: recent.rows, totalEarned: Number(earned.total) });
});

const driverApplySchema = z.object({ bidAmount: z.number().int().positive().optional() });

/** A driver offers to take a car ride — at the app's fare, or with their own price when bidding is on. */
carRoutes.post("/car/orders/:id/apply", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = driverApplySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const driver = await onlineDriver(user.sub);
  if (!driver) return c.json({ error: "not_online", message: "Go online with your assigned vehicle first." }, 409);

  const tierColumn = await hasColumn("car_bookings", "service_tier");
  const sizeColumn = await hasColumn("car_bookings", "vehicle_size");
  const booking = (await db.execute({ sql: `SELECT o.*, b.category_id${tierColumn ? ", b.service_tier" : ""}${sizeColumn ? ", b.vehicle_size" : ""} FROM orders o JOIN car_bookings b ON b.order_id = o.id WHERE o.id = ?`, args: [id] })).rows[0] as Row | undefined;
  const settings = await getCarSettings();
  const eligible = booking && (booking.service_tier
    ? driver.categoryKind === "passenger" && driver.lat != null && driver.lng != null && acceptsTier({ service_class: driver.serviceClass, accepts_convenient: driver.acceptsConvenient, seat_capacity: driver.seatCapacity, lat: driver.lat, lng: driver.lng }, booking.service_tier as CarServiceTier, settings.servicePricing!.xlMinSeats, booking.service_tier === "xl" ? "large" : booking.vehicle_size === "large" ? "large" : "normal")
    : booking.category_id === driver.categoryId);
  const order = eligible ? booking : undefined;
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id || !["Create", "Match"].includes(String(order.stage))) return c.json({ error: "already_claimed", message: "This ride has already been taken." }, 409);
  if (order.matching_mode !== "customer_selects") return c.json({ error: "wrong_mode", message: "This ride is assigned automatically." }, 409);
  const excluded = await db.execute({ sql: "SELECT 1 FROM order_rider_exclusions WHERE order_id = ? AND rider_id = ?", args: [id, user.sub] });
  if (excluded.rows.length > 0) return c.json({ error: "not_eligible", message: "You previously declined this ride." }, 403);

  const point = orderMatchPoint(order);
  const km = point && driver.lat != null && driver.lng != null ? haversineKm(point.lat, point.lng, driver.lat, driver.lng) : null;
  const applySettings = await getCarSettings();
  const { maxPickupKm } = applySettings;
  if (await hasColumn("car_bookings", "scheduled_for")) {
    const sched = (await db.execute({ sql: "SELECT scheduled_for FROM car_bookings WHERE order_id = ?", args: [id] })).rows[0] as Row | undefined;
    if (sched?.scheduled_for && new Date(`${String(sched.scheduled_for).replace(" ", "T")}Z`).getTime() > Date.now() + applySettings.scheduled.openMinutes * 60000) {
      return c.json({ error: "not_open_yet", message: "This scheduled ride opens to drivers closer to pickup time." }, 409);
    }
  }
  if (km != null && km > maxPickupKm) return c.json({ error: "too_far", message: "This pickup is too far from you." }, 409);

  let bidAmount: number | null = null;
  if (parsed.data.bidAmount != null) {
    if (!(await hasColumn("order_applications", "bid_amount"))) return c.json({ error: "bidding_unavailable", message: "Bidding isn't ready yet — apply at the app price." }, 409);
    const ctx = await loadBiddingContext();
    const bidding = computeBidding(order, ctx.settings, [...new Set([...ctx.enabledModes, "customer_selects" as const])]);
    const checked = validateBid(bidding, parsed.data.bidAmount);
    if ("error" in checked) return c.json({ error: "bid_not_allowed", message: checked.error }, 400);
    bidAmount = checked.bid === bidding.appPrice ? null : checked.bid;
  }

  const bidColumn = await hasColumn("order_applications", "bid_amount");
  const result = await db.execute({
    sql: `INSERT INTO order_applications (id, order_id, rider_id, distance_km, status${bidColumn ? ", bid_amount" : ""})
          SELECT ?, ?, ?, ?, 'pending'${bidColumn ? ", ?" : ""}
          WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND rider_id IS NULL AND stage IN ('Create', 'Match'))
            AND NOT EXISTS (SELECT 1 FROM orders WHERE rider_id = ? AND environment = ? AND stage NOT IN ('Settle', 'Cancelled'))
          ON CONFLICT(order_id, rider_id) DO UPDATE SET distance_km = excluded.distance_km, status = 'pending'${bidColumn ? ", bid_amount = excluded.bid_amount" : ""}`,
    args: [newId("app"), id, user.sub, km, ...(bidColumn ? [bidAmount] : []), id, user.sub, String(order.environment)],
  });
  if (result.rowsAffected === 0) return c.json({ error: "driver_unavailable", message: "This ride is no longer available or you already have an active ride." }, 409);

  // Stamp which vehicle (and so which owner) is taking the ride.
  return c.json({ ok: true });
});

// ---- Customer: quote and book --------------------------------------------------

const tripFields = z.object({
  categoryId: z.string().min(1).optional(),
  serviceTier: z.enum(["convenient", "comfort", "xl"]).optional(),
  vehicleSize: z.enum(["normal", "large"]).optional(),
  pickupArea: z.string().max(120).optional(),
  pickupAddress: z.string().max(240).optional(),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  destinationArea: z.string().max(120).optional(),
  destinationAddress: z.string().max(240).optional(),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
});
const oneService = (t: { categoryId?: string; serviceTier?: CarServiceTier }) => Boolean(t.categoryId) !== Boolean(t.serviceTier);
const tripSchema = tripFields.refine(oneService, { message: "Choose one car service." });

/** Booking-only: who rides, when it isn't the booker. */
const bookingSchema = tripFields.extend({ scheduledFor: z.string().max(40).optional(), passenger: passengerSchema.optional() }).refine(oneService, { message: "Choose one car service." });

async function activeCategory(id: string): Promise<Row | undefined> {
  return (await db.execute({ sql: "SELECT * FROM vehicle_categories WHERE id = ? AND active = 1", args: [id] })).rows[0] as Row | undefined;
}

carRoutes.post("/car/quote", async (c) => {
  const parsed = tripSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const distanceKm = haversineKm(parsed.data.pickupLat, parsed.data.pickupLng, parsed.data.destinationLat, parsed.data.destinationLng);
  if (parsed.data.serviceTier) {
    if (!(await hasColumn("car_bookings", "service_tier")) || !(await hasColumn("vehicles", "accepts_convenient"))) return c.json({ error: "tiers_unavailable" }, 503);
    if (!(await hasColumn("car_bookings", "vehicle_size"))) return c.json({ error: "vehicle_sizes_unavailable" }, 503);
    const pricing = (await getCarSettings()).servicePricing!;
    const size = parsed.data.vehicleSize ?? (parsed.data.serviceTier === "xl" ? "large" : "normal");
    return c.json({ fare: tierFare(distanceKm, parsed.data.serviceTier, pricing, size), distanceKm: Math.round(distanceKm * 10) / 10 });
  }
  const category = await activeCategory(parsed.data.categoryId!);
  if (!category) return c.json({ error: "invalid_category" }, 400);
  return c.json({ fare: quoteFare(category, distanceKm), distanceKm: Math.round(distanceKm * 10) / 10 });
});

/** Book a car now. Creates the ride's list and order (same payment, tracking,
 * chat and rating machinery as any ride) plus the car booking that links them. */
carRoutes.post("/car/bookings", async (c) => {
  const user = c.get("user");
  if (!(await isServiceEnabled("ride"))) return servicePaused(c, "ride");
  const settings = await getCarSettings();
  const parsed = bookingSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const isTier = Boolean(parsed.data.serviceTier);
  if (isTier && (!(await hasColumn("car_bookings", "service_tier")) || !(await hasColumn("vehicles", "accepts_convenient")))) return c.json({ error: "tiers_unavailable" }, 503);
  if (isTier && !(await hasColumn("car_bookings", "vehicle_size"))) return c.json({ error: "vehicle_sizes_unavailable" }, 503);
  const vehicleSize = parsed.data.vehicleSize ?? (parsed.data.serviceTier === "xl" ? "large" : "normal");
  const category = isTier
    ? (await db.execute({ sql: `SELECT * FROM vehicle_categories WHERE active = 1 AND kind = 'passenger' AND ${vehicleSize === "large" ? "seats >= 5" : "seats < 5"} ORDER BY sort ASC LIMIT 1`, args: [] })).rows[0] as Row | undefined
    : await activeCategory(parsed.data.categoryId!);
  if (!category) return c.json({ error: "invalid_category" }, 400);

  // "Later": a pickup time inside the admin's window. "Now": needs book-now switched on.
  let scheduledAt: string | null = null;
  if (parsed.data.scheduledFor) {
    if (!(await scheduledAvailable(settings.scheduled))) return c.json({ error: "scheduling_unavailable", message: "Scheduling a car isn't available right now." }, 403);
    const checked = validateScheduledFor(parsed.data.scheduledFor, settings.scheduled);
    if ("error" in checked) return c.json({ error: "invalid_time", message: checked.error }, 400);
    scheduledAt = checked.at;
  } else if (!settings.onDemandEnabled) {
    return c.json({ error: "mode_disabled", message: "Booking a car right now isn't available." }, 403);
  }

  const t = parsed.data;
  const distanceKm = haversineKm(t.pickupLat, t.pickupLng, t.destinationLat, t.destinationLng);
  const fare = isTier ? tierFare(distanceKm, parsed.data.serviceTier!, settings.servicePricing!, vehicleSize) : quoteFare(category, distanceKm);
  if (fare <= 0) return c.json({ error: "no_price", message: "This car type has no price set yet." }, 409);
  if (isTier && !parsed.data.scheduledFor) {
    const counts = await nearbyTierCounts(t.pickupLat, t.pickupLng, settings.maxPickupKm, settings.servicePricing!.xlMinSeats);
    if (counts[vehicleSize][parsed.data.serviceTier as "convenient" | "comfort"] === 0 && parsed.data.serviceTier !== "xl") return c.json({ error: "no_nearby_car", message: "No car in this service is nearby. Choose an available service." }, 409);
  }

  const environment = await getPlatformEnvironment();
  const listId = newId("list");
  await db.execute({
    sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'draft', ?)",
    args: [listId, user.sub, `${isTier ? `${parsed.data.serviceTier![0].toUpperCase()}${parsed.data.serviceTier!.slice(1)}` : String(category.name)} ride`, environment],
  });

  const response = await createOrderFromInput(
    c,
    {
      listId,
      type: "parcel",
      isRide: true,
      pickupArea: t.pickupArea,
      pickupAddress: t.pickupAddress,
      pickupLat: t.pickupLat,
      pickupLng: t.pickupLng,
      destinationArea: t.destinationArea,
      destinationAddress: t.destinationAddress,
      destinationLat: t.destinationLat,
      destinationLng: t.destinationLng,
      passenger: t.passenger,
      // Car rides are always paid through escrow (wallet or mobile money): the
      // owner/driver split is paid out of what escrow holds.
      paymentRail: "escrow",
    },
    {
      fare,
      matchingMode: settings.matchingMode,
      // The customer's pick window starts when the ride opens to drivers, not at booking.
      matchingDeadlineAt:
        scheduledAt && settings.matchingMode === "customer_selects"
          ? new Date(new Date(`${scheduledAt.replace(" ", "T")}Z`).getTime() - settings.scheduled.openMinutes * 60000 + (await getMatchingSettings()).maxAssignmentMinutes * 60000).toISOString()
          : undefined,
    },
  );
  if (response.status >= 400) return response;

  const body = (await response.clone().json()) as { order: Row };
  await db.execute({
    sql: `INSERT INTO car_bookings (id, order_id, customer_id, category_id, environment${isTier ? ", service_tier, vehicle_size" : ""}) VALUES (?, ?, ?, ?, ?${isTier ? ", ?, ?" : ""})`,
    args: [newId("cbk"), String(body.order.id), user.sub, String(category.id), environment, ...(isTier ? [parsed.data.serviceTier!, vehicleSize] : [])],
  });
  if (scheduledAt) {
    await db.execute({ sql: "UPDATE car_bookings SET scheduled_for = ? WHERE order_id = ?", args: [scheduledAt, String(body.order.id)] });
  }
  return response;
});

// ---- Earnings wallet: cash-out to mobile money -------------------------------

/**
 * What a person may cash out: only what they EARNED from car rides (their
 * owner and driver shares), minus what they've already withdrawn or have
 * pending — and never more than the wallet holds. Money they topped up
 * themselves is closed-loop store credit and stays that way.
 */
async function withdrawable(userId: string, environment: string): Promise<{ balance: number; earned: number; withdrawn: number; available: number }> {
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const balance = Number(((await db.execute({ sql: `SELECT ${column} AS b FROM users WHERE id = ?`, args: [userId] })).rows[0] as Row)?.b ?? 0);
  const earned = Number(
    ((await db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN owner_id = ? THEN owner_amount ELSE 0 END), 0)
                 + COALESCE(SUM(CASE WHEN driver_id = ? THEN driver_amount ELSE 0 END), 0) AS total
            FROM car_bookings WHERE status = 'completed' AND environment = ? AND (owner_id = ? OR driver_id = ?)`,
      args: [userId, userId, environment, userId, userId],
    })).rows[0] as Row)?.total ?? 0,
  );
  // Owner payouts from self-drive rentals count as earnings too.
  const rentalEarned = (await hasTable("rentals"))
    ? Number(((await db.execute({ sql: "SELECT COALESCE(SUM(owner_amount), 0) AS total FROM rentals WHERE owner_id = ? AND status = 'completed' AND environment = ?", args: [userId, environment] })).rows[0] as Row)?.total ?? 0)
    : 0;
  const withdrawn = Number(
    ((await db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) AS total FROM car_withdrawals WHERE user_id = ? AND environment = ? AND status IN ('pending', 'successful')",
      args: [userId, environment],
    })).rows[0] as Row)?.total ?? 0,
  );
  return { balance, earned: earned + rentalEarned, withdrawn, available: Math.max(0, Math.min(balance, earned + rentalEarned - withdrawn)) };
}

carRoutes.get("/car/wallet", async (c) => {
  const user = c.get("user");
  const settings = await getCarSettings();
  const environment = await getPlatformEnvironment();
  const ready = await hasTable("car_withdrawals");
  const figures = await withdrawable(user.sub, environment);
  const history = ready
    ? (await db.execute({ sql: "SELECT id, amount, status, msisdn, created_at FROM car_withdrawals WHERE user_id = ? AND environment = ? ORDER BY created_at DESC LIMIT 20", args: [user.sub, environment] })).rows
    : [];
  return c.json({
    balance: figures.balance,
    withdrawable: ready ? figures.available : 0,
    withdrawalsEnabled: settings.withdrawalsEnabled && ready,
    minAmount: settings.withdrawalMinAmount,
    history,
  });
});

const withdrawSchema = z.object({ amount: z.number().int().positive(), mobileNumberId: z.string().optional() });

carRoutes.post("/car/wallet/withdraw", async (c) => {
  const user = c.get("user");
  const parsed = withdrawSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const settings = await getCarSettings();
  if (!settings.withdrawalsEnabled) return c.json({ error: "withdrawals_off", message: "Cash-out isn't open yet." }, 403);
  if (!(await hasTable("car_withdrawals"))) return c.json({ error: "withdrawals_unavailable", message: "Cash-out isn't ready yet." }, 503);

  const { amount } = parsed.data;
  if (amount < settings.withdrawalMinAmount) {
    return c.json({ error: "below_minimum", message: `The smallest withdrawal is UGX ${settings.withdrawalMinAmount.toLocaleString("en-UG")}.` }, 400);
  }
  const environment = await getPlatformEnvironment();
  const figures = await withdrawable(user.sub, environment);
  if (amount > figures.available) {
    return c.json({ error: "amount_too_high", message: `You can withdraw up to UGX ${figures.available.toLocaleString("en-UG")} of your ride earnings.` }, 409);
  }

  const numbers = (await db.execute({ sql: "SELECT id, phone FROM saved_mobile_numbers WHERE owner_id = ? AND purpose = 'withdrawal' ORDER BY is_primary DESC, created_at ASC", args: [user.sub] })).rows as Row[];
  let msisdn: string | null = null;
  if (numbers.length >= 2) {
    if (!parsed.data.mobileNumberId) return c.json({ error: "mobile_number_required", message: "Choose which mobile money number to withdraw to." }, 400);
    msisdn = (numbers.find((n) => n.id === parsed.data.mobileNumberId)?.phone as string | undefined) ?? null;
    if (!msisdn) return c.json({ error: "invalid_mobile_number" }, 400);
  } else if (numbers.length === 1) {
    msisdn = numbers[0].phone as string;
  }
  if (!msisdn) return c.json({ error: "no_mobile_money", message: "Save a mobile money number for withdrawals first." }, 409);

  // Debit first (atomic: refuses if the balance dropped meanwhile), then pay out, and give the money back if the payout can't start.
  const withdrawalId = newId("cwd");
  const debited = await debitWallet(user.sub, amount, { type: "adjustment", environment, actorId: user.sub, note: "Withdrawal to mobile money" });
  if (debited === null) return c.json({ error: "balance_changed", message: "Your balance just changed — reopen and try again." }, 409);

  let initiated;
  try {
    initiated = await initiateDisbursement({ referenceId: withdrawalId, msisdn, amount, forceMock: environment === "sandbox" });
  } catch (err) {
    await creditWallet(user.sub, amount, { type: "adjustment", environment, actorId: user.sub, note: "Withdrawal could not start — returned" });
    if (err instanceof UnsupportedNetworkError) return c.json({ error: "unsupported_network", message: err.message }, 400);
    console.error("Car withdrawal request failed:", err);
    return c.json({ error: "withdrawal_request_failed", message: "Couldn't reach mobile money. Please try again." }, 502);
  }
  await db.execute({
    sql: `INSERT INTO car_withdrawals (id, user_id, amount, provider, provider_ref, msisdn, network, status, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [withdrawalId, user.sub, amount, initiated.provider, initiated.providerRef, msisdn, initiated.network, environment],
  });
  return c.json({ withdrawalId, amount, status: "pending" }, 201);
});

/** Polled by the app until the payout settles; a failed payout returns the money to the wallet. */
carRoutes.get("/car/wallet/withdrawals/:id/refresh", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const row = (await db.execute({ sql: "SELECT * FROM car_withdrawals WHERE id = ? AND user_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "pending") return c.json({ withdrawal: row });
  try {
    const status = await checkPaymentStatus({ provider: String(row.provider), provider_ref: row.provider_ref as string | null, created_at: String(row.created_at) });
    if (status === "successful" || status === "failed") {
      // Only the request that flips pending -> final may refund, so a double poll can't pay twice.
      const flipped = await db.execute({ sql: "UPDATE car_withdrawals SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [status, id] });
      if (status === "failed" && flipped.rowsAffected > 0) {
        await creditWallet(user.sub, Number(row.amount), { type: "adjustment", environment: row.environment === "sandbox" ? "sandbox" : "live", actorId: user.sub, note: "Withdrawal failed — returned" });
      }
    }
    return c.json({ withdrawal: (await db.execute({ sql: "SELECT * FROM car_withdrawals WHERE id = ?", args: [id] })).rows[0] });
  } catch (err) {
    console.error("Car withdrawal status check failed:", err);
    return c.json({ error: "status_check_failed", message: "Couldn't check the payout just now. Please try again." }, 502);
  }
});

/**
 * The customer swaps the driver on a ride that hasn't started yet (typically
 * after a "your driver may be late" warning). The driver is excluded, the ride
 * goes back to the pool — keeping any payment already made — and drivers can
 * apply again.
 */
carRoutes.post("/car/bookings/:orderId/rematch", async (c) => {
  const orderId = c.req.param("orderId") as string;
  const user = c.get("user");
  const order = (await db.execute({ sql: "SELECT o.* FROM orders o JOIN car_bookings b ON b.order_id = o.id WHERE o.id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  if (!order.rider_id || !["Match", "Shop", "Substitute", "Approve"].includes(String(order.stage))) {
    return c.json({ error: "invalid_stage", message: "You can only change the driver before the trip starts." }, 409);
  }
  const driverId = String(order.rider_id);
  await db.execute({ sql: "INSERT OR IGNORE INTO order_rider_exclusions (order_id, rider_id) VALUES (?, ?)", args: [orderId, driverId] });
  const paid = await db.execute({ sql: "SELECT id FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful' LIMIT 1", args: [orderId] });
  const next = paid.rows.length > 0 ? "Match" : "Create";
  const released = await db.execute({
    sql: `UPDATE orders SET rider_id = NULL, stage = ?, matched_out_of_range = 0, updated_at = datetime('now')
          WHERE id = ? AND rider_id = ? AND stage IN ('Match', 'Shop', 'Substitute', 'Approve')`,
    args: [next, orderId, driverId],
  });
  if (released.rowsAffected === 0) return c.json({ error: "invalid_stage", message: "The ride just changed. Refresh and try again." }, 409);
  await db.execute({ sql: "DELETE FROM rider_order_locks WHERE rider_id = ? AND order_id = ?", args: [driverId, orderId] });
  await db.execute({ sql: "UPDATE car_bookings SET driver_id = NULL, vehicle_id = NULL, owner_id = NULL, updated_at = datetime('now') WHERE order_id = ?", args: [orderId] });
  if (await hasColumn("car_bookings", "scheduled_for")) {
    await db.execute({ sql: "UPDATE car_bookings SET scheduled_notified_at = NULL WHERE order_id = ?", args: [orderId] });
  }
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, ?, 'Customer chose another driver — ride returned to the pool', ?)",
    args: [newId("evt"), orderId, next, user.sub],
  });
  return c.json({ ok: true });
});

/** Whether this is the customer's car ride, and when it's scheduled for (so the app can offer "choose another driver"). */
carRoutes.get("/car/bookings/:orderId/info", async (c) => {
  const orderId = c.req.param("orderId") as string;
  const user = c.get("user");
  const withSchedule = await hasColumn("car_bookings", "scheduled_for");
  const row = (await db.execute({ sql: `SELECT customer_id, ${withSchedule ? "scheduled_for" : "NULL AS scheduled_for"} FROM car_bookings WHERE order_id = ?`, args: [orderId] })).rows[0] as Row | undefined;
  if (!row || row.customer_id !== user.sub) return c.json({ error: "not_found" }, 404);
  const at = row.scheduled_for ? new Date(`${String(row.scheduled_for).replace(" ", "T")}Z`).toISOString() : null;
  return c.json({ car: true, scheduledFor: at });
});

// ---- Vehicle photos ----------------------------------------------------------

/** Photo ids per vehicle (empty until the photos table exists). */
export async function vehiclePhotoIds(vehicleIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (vehicleIds.length === 0 || !(await hasTable("vehicle_photos"))) return out;
  const marks = vehicleIds.map(() => "?").join(", ");
  const rows = (await db.execute({ sql: `SELECT id, vehicle_id FROM vehicle_photos WHERE vehicle_id IN (${marks}) ORDER BY sort ASC, created_at ASC`, args: vehicleIds })).rows as Row[];
  for (const r of rows) (out[String(r.vehicle_id)] ??= []).push(String(r.id));
  return out;
}

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The owner adds a photo of their vehicle (one image per request, up to the admin's maximum). */
carRoutes.post("/car/vehicles/:id/photos", async (c) => {
  const vehicleId = c.req.param("id") as string;
  const user = c.get("user");
  if (!(await hasTable("vehicle_photos"))) return c.json({ error: "photos_unavailable", message: "Vehicle photos aren't ready yet." }, 503);
  const vehicle = (await db.execute({ sql: "SELECT id FROM vehicles WHERE id = ? AND owner_id = ?", args: [vehicleId, user.sub] })).rows[0];
  if (!vehicle) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "invalid_body", message: "Choose a photo to upload." }, 400);
  if (!PHOTO_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type", message: "Photos must be JPEG, PNG or WebP." }, 400);
  if (file.size > MAX_PHOTO_BYTES) return c.json({ error: "file_too_large", message: "That photo is too large (6 MB at most)." }, 400);

  const { vehiclePhotos } = await getCarSettings();
  const id = newId("vph");
  const key = `vehicles/${vehicleId}/photos/${id}.${extensionForMime(file.type, "jpg")}`;
  // Reserve the slot first so two uploads at once can't go past the maximum.
  const reserved = await db.execute({
    sql: `INSERT INTO vehicle_photos (id, vehicle_id, object_key, sort)
          SELECT ?, ?, ?, COALESCE((SELECT MAX(sort) + 1 FROM vehicle_photos WHERE vehicle_id = ?), 0)
          WHERE (SELECT COUNT(*) FROM vehicle_photos WHERE vehicle_id = ?) < ?`,
    args: [id, vehicleId, key, vehicleId, vehicleId, vehiclePhotos.max],
  });
  if (reserved.rowsAffected === 0) return c.json({ error: "too_many_photos", message: `A vehicle can have up to ${vehiclePhotos.max} photos.` }, 409);
  try {
    await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  } catch (err) {
    await db.execute({ sql: "DELETE FROM vehicle_photos WHERE id = ?", args: [id] });
    console.error("Vehicle photo upload failed:", err);
    return c.json({ error: "upload_failed", message: "Couldn't save that photo. Please try again." }, 502);
  }
  return c.json({ id }, 201);
});

carRoutes.delete("/car/vehicles/:id/photos/:photoId", async (c) => {
  const vehicleId = c.req.param("id") as string;
  const photoId = c.req.param("photoId") as string;
  const user = c.get("user");
  if (!(await hasTable("vehicle_photos"))) return c.json({ error: "photos_unavailable" }, 503);
  const row = (await db.execute({
    sql: `SELECT p.object_key FROM vehicle_photos p JOIN vehicles v ON v.id = p.vehicle_id WHERE p.id = ? AND p.vehicle_id = ? AND v.owner_id = ?`,
    args: [photoId, vehicleId, user.sub],
  })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  await db.execute({ sql: "DELETE FROM vehicle_photos WHERE id = ?", args: [photoId] });
  await getR2Bucket().delete(String(row.object_key)).catch(() => undefined);
  return c.json({ ok: true });
});

/** A vehicle photo: visible to its owner, assigned driver, staff, or renter browsing an active listing. */
carRoutes.get("/car/vehicles/:id/photos/:photoId", async (c) => {
  const vehicleId = c.req.param("id") as string;
  const photoId = c.req.param("photoId") as string;
  const user = c.get("user");
  if (!(await hasTable("vehicle_photos"))) return c.json({ error: "photos_unavailable" }, 503);
  const rentalEnvironment = await hasColumn("rental_listings", "environment");
  const row = (await db.execute({
    sql: `SELECT p.object_key, v.owner_id,
                 EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.driver_id = ? AND a.status = 'active') AS is_driver,
                 EXISTS (SELECT 1 FROM rental_listings l WHERE l.vehicle_id = v.id AND l.active = 1${rentalEnvironment ? " AND l.environment = ?" : ""}) AS is_listed
          FROM vehicle_photos p JOIN vehicles v ON v.id = p.vehicle_id WHERE p.id = ? AND p.vehicle_id = ?`,
    args: [user.sub, ...(rentalEnvironment ? [await getPlatformEnvironment()] : []), photoId, vehicleId],
  })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.owner_id !== user.sub && !row.is_driver && !row.is_listed && user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const object = await getR2Bucket().get(String(row.object_key));
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream") });
});

// ---- A driver who owns a car drives it ------------------------------------------------

/** An approved driver puts themselves in the seat of their own approved vehicle. */
carRoutes.post("/car/vehicles/:id/drive", async (c) => {
  const vehicleId = c.req.param("id") as string;
  const user = c.get("user");
  const partner = (await db.execute({ sql: "SELECT driver_status FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  if (partner?.driver_status !== "approved") return c.json({ error: "not_a_driver", message: "You need to be an approved driver first." }, 403);
  const vehicle = (await db.execute({ sql: "SELECT status FROM vehicles WHERE id = ? AND owner_id = ?", args: [vehicleId, user.sub] })).rows[0] as Row | undefined;
  if (!vehicle) return c.json({ error: "not_found" }, 404);
  if (vehicle.status !== "approved") return c.json({ error: "vehicle_not_approved", message: "Your vehicle needs Peebee's approval before you can drive it." }, 409);
  const current = (await db.execute({ sql: "SELECT driver_id FROM vehicle_assignments WHERE vehicle_id = ? AND status = 'active'", args: [vehicleId] })).rows[0] as Row | undefined;
  if (current && current.driver_id !== user.sub) return c.json({ error: "has_driver", message: "Another driver is using this vehicle. End that first." }, 409);
  if (!current) {
    await db.execute({ sql: "INSERT INTO vehicle_assignments (id, vehicle_id, driver_id, assigned_by) VALUES (?, ?, ?, ?)", args: [newId("vasg"), vehicleId, user.sub, user.sub] });
  }
  return c.json({ ok: true });
});

/** Stops driving a vehicle (own car or another owner's): ends the assignment, and goes offline if this was the active car. */
carRoutes.post("/car/vehicles/:id/release", async (c) => {
  const vehicleId = c.req.param("id") as string;
  const user = c.get("user");
  const busy = await db.execute({ sql: "SELECT 1 FROM orders WHERE rider_id = ? AND stage NOT IN ('Settle', 'Cancelled') LIMIT 1", args: [user.sub] });
  if (busy.rows.length > 0) return c.json({ error: "ride_in_progress", message: "Finish your current ride first." }, 409);
  if (!(await endAssignment(vehicleId, user.sub, user.sub))) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ---- Identity documents ----------------------------------------------------------------------

/** Which document kinds a person has on file (never the files themselves). */
export async function documentKinds(userId: string): Promise<{ national_id: boolean; licence: boolean }> {
  const out = { national_id: false, licence: false };
  if (!(await hasTable("car_partner_documents"))) return out;
  const rows = (await db.execute({ sql: "SELECT DISTINCT kind FROM car_partner_documents WHERE user_id = ?", args: [userId] })).rows as Row[];
  for (const r of rows) out[String(r.kind) as "national_id" | "licence"] = true;
  return out;
}

/** The person uploads a photo of their national ID or driving licence (replacing the previous one). */
carRoutes.post("/car/partner/documents", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("car_partner_documents"))) return c.json({ error: "documents_unavailable", message: "Document upload isn't ready yet." }, 503);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || (kind !== "national_id" && kind !== "licence")) return c.json({ error: "invalid_body", message: "Choose a photo and what it is." }, 400);
  if (!PHOTO_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type", message: "The photo must be JPEG, PNG or WebP." }, 400);
  if (file.size > MAX_PHOTO_BYTES) return c.json({ error: "file_too_large", message: "That photo is too large (6 MB at most)." }, 400);
  const partner = (await db.execute({ sql: "SELECT 1 FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0];
  if (!partner) return c.json({ error: "not_a_partner", message: "Apply to be an owner or a driver first." }, 403);

  const id = newId("doc");
  const key = `partners/${user.sub}/${kind}-${id}.${extensionForMime(file.type, "jpg")}`;
  await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const previous = (await db.execute({ sql: "SELECT id, object_key FROM car_partner_documents WHERE user_id = ? AND kind = ?", args: [user.sub, kind] })).rows as Row[];
  await db.execute({ sql: "INSERT INTO car_partner_documents (id, user_id, kind, object_key) VALUES (?, ?, ?, ?)", args: [id, user.sub, kind, key] });
  for (const old of previous) {
    await db.execute({ sql: "DELETE FROM car_partner_documents WHERE id = ?", args: [String(old.id)] });
    await getR2Bucket().delete(String(old.object_key)).catch(() => undefined);
  }
  return c.json({ id }, 201);
});

/** A person's own document, or any partner's for staff. */
carRoutes.get("/car/partner/documents/:userId/:kind", async (c) => {
  const userId = c.req.param("userId") as string;
  const kind = c.req.param("kind") as string;
  const user = c.get("user");
  if (user.sub !== userId && user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  if (!(await hasTable("car_partner_documents"))) return c.json({ error: "documents_unavailable" }, 503);
  const row = (await db.execute({ sql: "SELECT object_key FROM car_partner_documents WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1", args: [userId, kind] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  const object = await getR2Bucket().get(String(row.object_key));
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream") });
});
