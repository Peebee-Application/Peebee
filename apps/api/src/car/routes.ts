import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment } from "../lib/settings.js";
import { computeBidding, loadBiddingContext, validateBid } from "../orders/bidding.js";
import { currentVisibilityRadiusKm, orderMatchPoint } from "../orders/matching.js";
import { createOrderFromInput } from "../orders/routes.js";
import { checkPaymentStatus, initiateDisbursement, UnsupportedNetworkError } from "../payments/service.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { quoteFare } from "./service.js";

type Row = Record<string, unknown>;

/** Customer, owner and driver endpoints for Tuma Car. Everything stays closed
 * until an admin turns Car on (and migration 0065 has been applied). */
export const carRoutes = new Hono();
carRoutes.use("/car/*", requireAuth);

// 503 until the car tables exist, 403 while Car is switched off.
carRoutes.use("/car/*", async (c, next) => {
  if (!(await hasTable("car_bookings"))) return c.json({ error: "car_unavailable", message: "Tuma Car isn't ready yet." }, 503);
  const settings = await getCarSettings();
  if (!settings.enabled) return c.json({ error: "car_disabled", message: "Tuma Car isn't available right now." }, 403);
  await next();
});

carRoutes.get("/car/config", async (c) => {
  const settings = await getCarSettings();
  const categories = await db.execute(
    `SELECT id, kind, name, seats, cargo_type, size_label, reference_image_key, rate_per_km, minimum_fare
     FROM vehicle_categories WHERE active = 1 ORDER BY sort ASC, name ASC`,
  );
  return c.json({ onDemandEnabled: settings.onDemandEnabled, matchingMode: settings.matchingMode, categories: categories.rows });
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
  return c.json({
    ownerStatus: (partner?.owner_status as string) ?? "none",
    driverStatus: (partner?.driver_status as string) ?? "none",
    vehicles: vehicles.rows,
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
});

/** An approved owner puts a vehicle up for service; a manager approves it and assigns a driver. */
carRoutes.post("/car/vehicles", async (c) => {
  const user = c.get("user");
  const parsed = vehicleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const partner = (await db.execute({ sql: "SELECT owner_status FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  if (partner?.owner_status !== "approved") return c.json({ error: "not_an_owner", message: "You need to be an approved car owner first." }, 403);
  const category = (await db.execute({ sql: "SELECT 1 FROM vehicle_categories WHERE id = ? AND active = 1", args: [parsed.data.categoryId] })).rows[0];
  if (!category) return c.json({ error: "invalid_category" }, 400);
  const id = newId("veh");
  try {
    await db.execute({
      sql: "INSERT INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, user.sub, parsed.data.categoryId, parsed.data.plate, parsed.data.make ?? null, parsed.data.model ?? null, parsed.data.year ?? null, parsed.data.colour ?? null],
    });
  } catch {
    return c.json({ error: "plate_taken", message: "A vehicle with that number plate is already registered." }, 409);
  }
  return c.json({ id }, 201);
});

/** The owner's view of rides being taken in their vehicles, current first. */
carRoutes.get("/car/owner/rides", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT b.id, b.order_id, b.status, b.vehicle_id, v.plate, du.name AS driver_name, o.stage, o.pickup_address, o.destination_address,
                 o.estimated_total, o.final_total, b.owner_amount, b.settled_at, b.created_at
          FROM car_bookings b
          JOIN orders o ON o.id = b.order_id
          LEFT JOIN vehicles v ON v.id = b.vehicle_id
          LEFT JOIN users du ON du.id = b.driver_id
          WHERE b.owner_id = ? ORDER BY (b.status = 'requested') DESC, b.created_at DESC LIMIT 100`,
    args: [user.sub],
  });
  const earned = (await db.execute({ sql: "SELECT COALESCE(SUM(owner_amount), 0) AS total FROM car_bookings WHERE owner_id = ? AND status = 'completed'", args: [user.sub] })).rows[0] as Row;
  return c.json({ rides: res.rows, totalEarned: Number(earned.total) });
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
async function onlineDriver(userId: string): Promise<{ vehicleId: string; categoryId: string; lat: number | null; lng: number | null } | null> {
  const res = await db.execute({
    sql: `SELECT s.vehicle_id, s.lat, s.lng, v.category_id FROM car_driver_state s
          JOIN car_partners p ON p.user_id = s.driver_id AND p.driver_status = 'approved'
          JOIN vehicles v ON v.id = s.vehicle_id AND v.status = 'approved'
          JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.driver_id = s.driver_id AND a.status = 'active'
          WHERE s.driver_id = ? AND s.online = 1`,
    args: [userId],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row) return null;
  return { vehicleId: String(row.vehicle_id), categoryId: String(row.category_id), lat: row.lat as number | null, lng: row.lng as number | null };
}

/** Open car rides for the driver's vehicle category, nearest first. */
carRoutes.get("/car/driver/jobs", async (c) => {
  const user = c.get("user");
  const driver = await onlineDriver(user.sub);
  if (!driver) return c.json({ jobs: [] });
  const { maxPickupKm } = await getCarSettings();
  const environment = await getPlatformEnvironment();
  const res = await db.execute({
    sql: `SELECT o.*, b.category_id, cu.name AS customer_name FROM car_bookings b
          JOIN orders o ON o.id = b.order_id JOIN users cu ON cu.id = o.customer_id
          WHERE b.category_id = ? AND b.status = 'requested' AND o.rider_id IS NULL AND o.stage IN ('Create', 'Match')
          AND o.environment = ?
          AND o.id NOT IN (SELECT order_id FROM order_rider_exclusions WHERE rider_id = ?)`,
    args: [driver.categoryId, environment, user.sub],
  });
  const applied = new Set(
    ((await db.execute({ sql: "SELECT order_id FROM order_applications WHERE rider_id = ? AND status = 'pending'", args: [user.sub] })).rows as Row[]).map((r) => String(r.order_id)),
  );
  const bidCtx = await loadBiddingContext();
  const modes = [...new Set([...bidCtx.enabledModes, "customer_selects" as const])];
  const jobs = (res.rows as Row[])
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
          pickupDistanceKm: km != null ? Math.round(km * 10) / 10 : null,
          matchingMode: o.matching_mode,
          applied: applied.has(String(o.id)),
          bidding: bidding.active ? { appPrice: bidding.appPrice, min: bidding.min, max: bidding.max } : null,
        },
        visible: km == null || (km <= maxPickupKm && (radius == null || km <= radius)),
      };
    })
    .filter((e) => e.visible)
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return c.json({ jobs: jobs.map((e) => e.job) });
});

/** The driver's ride in progress (if any) and their recent finished rides. */
carRoutes.get("/car/driver/active", async (c) => {
  const user = c.get("user");
  const active = await db.execute({
    sql: `SELECT o.id, o.stage, o.estimated_total, o.final_total, o.pickup_address, o.pickup_lat, o.pickup_lng,
                 o.destination_address, o.destination_lat, o.destination_lng, o.distance_km, o.customer_id, cu.name AS customer_name
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

  const order = (await db.execute({ sql: "SELECT o.* FROM orders o JOIN car_bookings b ON b.order_id = o.id WHERE o.id = ? AND b.category_id = ?", args: [id, driver.categoryId] })).rows[0] as Row | undefined;
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id || !["Create", "Match"].includes(String(order.stage))) return c.json({ error: "already_claimed", message: "This ride has already been taken." }, 409);
  if (order.matching_mode !== "customer_selects") return c.json({ error: "wrong_mode", message: "This ride is assigned automatically." }, 409);
  const excluded = await db.execute({ sql: "SELECT 1 FROM order_rider_exclusions WHERE order_id = ? AND rider_id = ?", args: [id, user.sub] });
  if (excluded.rows.length > 0) return c.json({ error: "not_eligible", message: "You previously declined this ride." }, 403);

  const point = orderMatchPoint(order);
  const km = point && driver.lat != null && driver.lng != null ? haversineKm(point.lat, point.lng, driver.lat, driver.lng) : null;
  const { maxPickupKm } = await getCarSettings();
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

const tripSchema = z.object({
  categoryId: z.string().min(1),
  pickupArea: z.string().max(120).optional(),
  pickupAddress: z.string().max(240).optional(),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  destinationArea: z.string().max(120).optional(),
  destinationAddress: z.string().max(240).optional(),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
});

async function activeCategory(id: string): Promise<Row | undefined> {
  return (await db.execute({ sql: "SELECT * FROM vehicle_categories WHERE id = ? AND active = 1", args: [id] })).rows[0] as Row | undefined;
}

carRoutes.post("/car/quote", async (c) => {
  const parsed = tripSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const category = await activeCategory(parsed.data.categoryId);
  if (!category) return c.json({ error: "invalid_category" }, 400);
  const distanceKm = haversineKm(parsed.data.pickupLat, parsed.data.pickupLng, parsed.data.destinationLat, parsed.data.destinationLng);
  return c.json({ fare: quoteFare(category, distanceKm), distanceKm: Math.round(distanceKm * 10) / 10 });
});

/** Book a car now. Creates the ride's list and order (same payment, tracking,
 * chat and rating machinery as any ride) plus the car booking that links them. */
carRoutes.post("/car/bookings", async (c) => {
  const user = c.get("user");
  const settings = await getCarSettings();
  if (!settings.onDemandEnabled) return c.json({ error: "mode_disabled", message: "Booking a car right now isn't available." }, 403);
  const parsed = tripSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const category = await activeCategory(parsed.data.categoryId);
  if (!category) return c.json({ error: "invalid_category" }, 400);

  const t = parsed.data;
  const distanceKm = haversineKm(t.pickupLat, t.pickupLng, t.destinationLat, t.destinationLng);
  const fare = quoteFare(category, distanceKm);
  if (fare <= 0) return c.json({ error: "no_price", message: "This car type has no price set yet." }, 409);

  const environment = await getPlatformEnvironment();
  const listId = newId("list");
  await db.execute({
    sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'draft', ?)",
    args: [listId, user.sub, `${String(category.name)} ride`, environment],
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
      // Car rides are always paid through escrow (wallet or mobile money): the
      // owner/driver split is paid out of what escrow holds.
      paymentRail: "escrow",
    },
    { fare, matchingMode: settings.matchingMode },
  );
  if (response.status >= 400) return response;

  const body = (await response.clone().json()) as { order: Row };
  await db.execute({
    sql: "INSERT INTO car_bookings (id, order_id, customer_id, category_id, environment) VALUES (?, ?, ?, ?, ?)",
    args: [newId("cbk"), String(body.order.id), user.sub, parsed.data.categoryId, environment],
  });
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
  const withdrawn = Number(
    ((await db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) AS total FROM car_withdrawals WHERE user_id = ? AND environment = ? AND status IN ('pending', 'successful')",
      args: [userId, environment],
    })).rows[0] as Row)?.total ?? 0,
  );
  return { balance, earned, withdrawn, available: Math.max(0, Math.min(balance, earned - withdrawn)) };
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
