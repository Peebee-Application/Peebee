import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment, type CarDealSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { dealOf, endAssignment, rentDue, type DealTerms } from "./service.js";
import { vehiclePhotoIds } from "./routes.js";

type Row = Record<string, unknown>;

/**
 * Drivers who need a car apply to owners' cars; the owner accepts and they are
 * connected on the agreed fee (a share of each ride, or a fixed rent). Closed
 * until an admin switches deals on.
 */
export const dealRoutes = new Hono();
dealRoutes.use("/car/deals/*", requireAuth);
dealRoutes.use("/car/deals/*", async (c, next) => {
  if (!(await hasTable("car_bookings")) || !(await hasTable("driver_requests")) || !(await hasColumn("vehicle_assignments", "fee_type"))) {
    return c.json({ error: "deals_unavailable", message: "This isn't ready yet." }, 503);
  }
  const s = await getCarSettings();
  if (!s.enabled || !s.deals.enabled) return c.json({ error: "deals_disabled", message: "Driver and owner agreements aren't available right now." }, 403);
  await next();
});

const fromDb = (ts: string) => new Date(`${ts.replace(" ", "T")}Z`);
const iso = (ts: unknown) => (ts ? fromDb(String(ts)).toISOString() : null);

/** Checks owner-proposed terms against the admin's limits. Returns the clean terms or an error message. */
export function validateTerms(
  input: { feeType: "share" | "rent"; ownerSharePercent?: number; rentAmount?: number; rentPeriod?: "day" | "week" },
  deals: CarDealSettings,
): { terms: DealTerms } | { error: string } {
  if (input.feeType === "share") {
    if (!deals.shareEnabled) return { error: "Sharing each ride isn't offered right now." };
    const pct = input.ownerSharePercent;
    if (pct == null || !Number.isInteger(pct)) return { error: "Set the owner's share." };
    if (pct < deals.minOwnerSharePercent || pct > deals.maxOwnerSharePercent) {
      return { error: `The owner's share must be between ${deals.minOwnerSharePercent}% and ${deals.maxOwnerSharePercent}%.` };
    }
    return { terms: { feeType: "share", ownerSharePercent: pct, rentAmount: null, rentPeriod: null } };
  }
  if (!deals.rentEnabled) return { error: "Fixed rent isn't offered right now." };
  const rent = input.rentAmount;
  const period = input.rentPeriod;
  if (!rent || !Number.isInteger(rent) || rent <= 0 || !period) return { error: "Set the rent and whether it is per day or per week." };
  if (deals.maxRentPerDay > 0) {
    const perDay = period === "week" ? rent / 7 : rent;
    if (perDay > deals.maxRentPerDay) return { error: `Rent can be at most UGX ${deals.maxRentPerDay.toLocaleString("en-UG")} a day.` };
  }
  return { terms: { feeType: "rent", ownerSharePercent: null, rentAmount: rent, rentPeriod: period } };
}

const termsSchema = z.object({
  open: z.boolean(),
  feeType: z.enum(["share", "rent"]),
  ownerSharePercent: z.number().int().min(0).max(100).optional(),
  rentAmount: z.number().int().min(1).max(1_000_000_000).optional(),
  rentPeriod: z.enum(["day", "week"]).optional(),
  notes: z.string().trim().max(300).optional(),
});

const termsView = (r: Row) => ({
  feeType: r.fee_type as string,
  ownerSharePercent: r.owner_share_percent != null ? Number(r.owner_share_percent) : null,
  rentAmount: r.rent_amount != null ? Number(r.rent_amount) : null,
  rentPeriod: (r.rent_period as string | null) ?? null,
});

// ---- Owner -----------------------------------------------------------------------------------

/** The owner offers a car to drivers on stated terms (or closes it to drivers). */
dealRoutes.put("/car/deals/terms/:vehicleId", async (c) => {
  const vehicleId = c.req.param("vehicleId") as string;
  const user = c.get("user");
  const parsed = termsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const vehicle = (await db.execute({ sql: "SELECT status FROM vehicles WHERE id = ? AND owner_id = ?", args: [vehicleId, user.sub] })).rows[0] as Row | undefined;
  if (!vehicle) return c.json({ error: "not_found" }, 404);
  const checked = validateTerms(parsed.data, (await getCarSettings()).deals);
  if ("error" in checked) return c.json({ error: "invalid_terms", message: checked.error }, 400);
  const t = checked.terms;
  await db.execute({
    sql: `INSERT INTO vehicle_terms (vehicle_id, open_to_drivers, fee_type, owner_share_percent, rent_amount, rent_period, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(vehicle_id) DO UPDATE SET open_to_drivers = excluded.open_to_drivers, fee_type = excluded.fee_type, owner_share_percent = excluded.owner_share_percent,
            rent_amount = excluded.rent_amount, rent_period = excluded.rent_period, notes = excluded.notes, updated_at = datetime('now')`,
    args: [vehicleId, parsed.data.open ? 1 : 0, t.feeType, t.ownerSharePercent, t.rentAmount, t.rentPeriod, parsed.data.notes ?? null],
  });
  return c.json({ ok: true });
});

/** The owner's cars with their terms and current driver, plus the applications waiting for an answer. */
dealRoutes.get("/car/deals/owner", async (c) => {
  const user = c.get("user");
  const vehicles = (await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.status, t.open_to_drivers, t.fee_type, t.owner_share_percent, t.rent_amount, t.rent_period, t.notes,
                 a.driver_id, d.name AS driver_name, a.assigned_at, a.fee_type AS deal_fee_type, a.owner_share_percent AS deal_share, a.rent_amount AS deal_rent,
                 a.rent_period AS deal_period, a.rent_paid_total
          FROM vehicles v
          LEFT JOIN vehicle_terms t ON t.vehicle_id = v.id
          LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.status = 'active'
          LEFT JOIN users d ON d.id = a.driver_id
          WHERE v.owner_id = ? ORDER BY v.created_at DESC`,
    args: [user.sub],
  })).rows as Row[];
  const requests = (await db.execute({
    sql: `SELECT r.id, r.vehicle_id, v.plate, r.driver_id, d.name AS driver_name, r.fee_type, r.owner_share_percent, r.rent_amount, r.rent_period, r.created_at,
                 p.licence_expiry,
                 (SELECT COUNT(*) FROM car_bookings b WHERE b.driver_id = r.driver_id AND b.status = 'completed') AS rides_done
          FROM driver_requests r JOIN vehicles v ON v.id = r.vehicle_id JOIN users d ON d.id = r.driver_id
          LEFT JOIN car_partners p ON p.user_id = r.driver_id
          WHERE r.owner_id = ? AND r.status = 'pending' ORDER BY r.created_at ASC`,
    args: [user.sub],
  })).rows as Row[];
  return c.json({
    vehicles: vehicles.map((v) => {
      const deal = v.driver_id
        ? dealOf({ fee_type: v.deal_fee_type, owner_share_percent: v.deal_share, rent_amount: v.deal_rent, rent_period: v.deal_period })
        : null;
      return {
        id: v.id, plate: v.plate, name: [v.make, v.model].filter(Boolean).join(" "), status: v.status,
        terms: v.fee_type ? { open: v.open_to_drivers === 1, ...termsView(v), notes: v.notes } : null,
        driver: v.driver_id
          ? {
              id: v.driver_id, name: v.driver_name, since: iso(v.assigned_at),
              deal,
              rentOwed: deal ? rentDue(deal, fromDb(String(v.assigned_at)), Number(v.rent_paid_total ?? 0)) : 0,
            }
          : null,
      };
    }),
    requests: requests.map((r) => ({
      id: r.id, vehicleId: r.vehicle_id, plate: r.plate, driverName: r.driver_name, ridesDone: Number(r.rides_done ?? 0), licenceExpiry: r.licence_expiry ?? null,
      terms: termsView(r), createdAt: iso(r.created_at),
    })),
  });
});

dealRoutes.post("/car/deals/requests/:id/decision", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ accept: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const req = (await db.execute({ sql: "SELECT * FROM driver_requests WHERE id = ? AND owner_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!req) return c.json({ error: "not_found" }, 404);
  if (req.status !== "pending") return c.json({ error: "invalid_status", message: "This application has already been answered." }, 409);

  if (!parsed.data.accept) {
    await db.execute({ sql: "UPDATE driver_requests SET status = 'declined', decided_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    notifyUser(String(req.driver_id), { title: "Your car application was declined", body: "You can apply to another owner's car.", url: "/find-car", tag: `deal-${id}` }).catch(() => {});
    return c.json({ ok: true });
  }

  // Connected straight away — but only if the driver and the car are both still approved and the car is free.
  const driver = (await db.execute({ sql: "SELECT driver_status FROM car_partners WHERE user_id = ?", args: [String(req.driver_id)] })).rows[0] as Row | undefined;
  if (driver?.driver_status !== "approved") return c.json({ error: "driver_not_approved", message: "This driver isn't approved by Tuma." }, 409);
  const vehicle = (await db.execute({ sql: "SELECT status FROM vehicles WHERE id = ?", args: [String(req.vehicle_id)] })).rows[0] as Row | undefined;
  if (vehicle?.status !== "approved") return c.json({ error: "vehicle_not_approved", message: "Your car needs Tuma's approval first." }, 409);
  // Re-check the terms still fit the admin's current limits (they may have changed since the application).
  const checked = validateTerms(
    { feeType: req.fee_type === "rent" ? "rent" : "share", ownerSharePercent: req.owner_share_percent != null ? Number(req.owner_share_percent) : undefined, rentAmount: req.rent_amount != null ? Number(req.rent_amount) : undefined, rentPeriod: req.rent_period === "week" ? "week" : req.rent_period === "day" ? "day" : undefined },
    (await getCarSettings()).deals,
  );
  if ("error" in checked) return c.json({ error: "invalid_terms", message: checked.error }, 409);
  const t = checked.terms;

  // The unique "one active driver per vehicle" index makes this atomic.
  const created = await db.execute({
    sql: `INSERT INTO vehicle_assignments (id, vehicle_id, driver_id, assigned_by, fee_type, owner_share_percent, rent_amount, rent_period)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM vehicle_assignments WHERE vehicle_id = ? AND status = 'active')`,
    args: [newId("vasg"), String(req.vehicle_id), String(req.driver_id), user.sub, t.feeType, t.ownerSharePercent, t.rentAmount, t.rentPeriod, String(req.vehicle_id)],
  });
  if (created.rowsAffected === 0) return c.json({ error: "has_driver", message: "This car already has a driver." }, 409);
  await db.execute({ sql: "UPDATE driver_requests SET status = 'accepted', decided_at = datetime('now') WHERE id = ?", args: [id] });
  await db.execute({ sql: "UPDATE driver_requests SET status = 'declined', decided_at = datetime('now') WHERE vehicle_id = ? AND status = 'pending'", args: [String(req.vehicle_id)] });
  notifyUser(String(req.driver_id), { title: "You can drive this car", body: "The owner accepted your application. Go online to start.", url: "/", tag: `deal-${id}` }).catch(() => {});
  return c.json({ ok: true });
});

/** The owner ends a driver's use of their car. */
dealRoutes.post("/car/deals/vehicles/:vehicleId/end", async (c) => {
  const vehicleId = c.req.param("vehicleId") as string;
  const user = c.get("user");
  const row = (await db.execute({
    sql: "SELECT a.driver_id FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.vehicle_id = ? AND v.owner_id = ? AND a.status = 'active'",
    args: [vehicleId, user.sub],
  })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  const driverId = String(row.driver_id);
  const busy = await db.execute({ sql: "SELECT 1 FROM orders WHERE rider_id = ? AND stage NOT IN ('Settle', 'Cancelled') LIMIT 1", args: [driverId] });
  if (busy.rows.length > 0) return c.json({ error: "ride_in_progress", message: "The driver is on a ride. Try again when it's finished." }, 409);
  await endAssignment(vehicleId, driverId, user.sub);
  notifyUser(driverId, { title: "Your car agreement has ended", body: "The owner ended it. You can apply to another car.", url: "/find-car", tag: `deal-end-${vehicleId}` }).catch(() => {});
  return c.json({ ok: true });
});

// ---- Driver ------------------------------------------------------------------------------------

/** Cars owners have opened to drivers: approved, with terms, and no driver yet. */
dealRoutes.get("/car/deals/cars", async (c) => {
  const user = c.get("user");
  const rows = (await db.execute({
    sql: `SELECT v.id, v.make, v.model, v.colour, v.year, cat.name AS category_name, cat.seats, o.name AS owner_name,
                 t.fee_type, t.owner_share_percent, t.rent_amount, t.rent_period, t.notes,
                 EXISTS (SELECT 1 FROM driver_requests r WHERE r.vehicle_id = v.id AND r.driver_id = ? AND r.status = 'pending') AS applied
          FROM vehicles v JOIN vehicle_terms t ON t.vehicle_id = v.id AND t.open_to_drivers = 1
          JOIN vehicle_categories cat ON cat.id = v.category_id JOIN users o ON o.id = v.owner_id
          WHERE v.status = 'approved' AND v.owner_id != ?
            AND NOT EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.status = 'active')
          ORDER BY t.updated_at DESC LIMIT 100`,
    args: [user.sub, user.sub],
  })).rows as Row[];
  const photos = await vehiclePhotoIds(rows.map((r) => String(r.id)));
  return c.json({
    cars: rows.map((r) => ({
      id: r.id, name: [r.colour, r.make, r.model, r.year].filter(Boolean).join(" ") || String(r.category_name), category: r.category_name, seats: r.seats, ownerName: r.owner_name,
      terms: termsView(r), notes: r.notes, applied: r.applied === 1, photos: photos[String(r.id)] ?? [],
    })),
  });
});

dealRoutes.post("/car/deals/cars/:vehicleId/request", async (c) => {
  const vehicleId = c.req.param("vehicleId") as string;
  const user = c.get("user");
  const partner = (await db.execute({ sql: "SELECT driver_status FROM car_partners WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  if (partner?.driver_status !== "approved") return c.json({ error: "not_a_driver", message: "You need to be an approved driver first." }, 403);
  const car = (await db.execute({
    sql: `SELECT v.owner_id, t.fee_type, t.owner_share_percent, t.rent_amount, t.rent_period FROM vehicles v JOIN vehicle_terms t ON t.vehicle_id = v.id AND t.open_to_drivers = 1
          WHERE v.id = ? AND v.status = 'approved' AND NOT EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.status = 'active')`,
    args: [vehicleId],
  })).rows[0] as Row | undefined;
  if (!car) return c.json({ error: "not_available", message: "That car isn't open to drivers right now." }, 404);
  if (car.owner_id === user.sub) return c.json({ error: "own_vehicle", message: "That's your own car." }, 409);
  const created = await db.execute({
    sql: `INSERT OR IGNORE INTO driver_requests (id, vehicle_id, driver_id, owner_id, fee_type, owner_share_percent, rent_amount, rent_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId("dreq"), vehicleId, user.sub, String(car.owner_id), String(car.fee_type), (car.owner_share_percent as number | null) ?? null, (car.rent_amount as number | null) ?? null, (car.rent_period as string | null) ?? null],
  });
  if (created.rowsAffected === 0) return c.json({ error: "already_applied", message: "You've already applied for this car." }, 409);
  notifyUser(String(car.owner_id), { title: "A driver wants to drive your car", body: "Review the application and accept or decline.", url: "/rentals", tag: `deal-req-${vehicleId}` }).catch(() => {});
  return c.json({ ok: true }, 201);
});

/** My applications and the cars I'm connected to, with rent owed. */
dealRoutes.get("/car/deals/my", async (c) => {
  const user = c.get("user");
  const requests = (await db.execute({
    sql: `SELECT r.id, r.vehicle_id, v.plate, v.make, v.model, o.name AS owner_name, r.status, r.fee_type, r.owner_share_percent, r.rent_amount, r.rent_period, r.created_at
          FROM driver_requests r JOIN vehicles v ON v.id = r.vehicle_id JOIN users o ON o.id = r.owner_id
          WHERE r.driver_id = ? ORDER BY r.created_at DESC LIMIT 30`,
    args: [user.sub],
  })).rows as Row[];
  const assignments = (await db.execute({
    sql: `SELECT a.id, a.vehicle_id, v.plate, v.make, v.model, o.name AS owner_name, v.owner_id, a.assigned_at, a.fee_type, a.owner_share_percent, a.rent_amount, a.rent_period, a.rent_paid_total
          FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id JOIN users o ON o.id = v.owner_id
          WHERE a.driver_id = ? AND a.status = 'active'`,
    args: [user.sub],
  })).rows as Row[];
  return c.json({
    requests: requests.map((r) => ({ id: r.id, vehicleId: r.vehicle_id, car: [r.make, r.model].filter(Boolean).join(" ") || r.plate, ownerName: r.owner_name, status: r.status, terms: termsView(r), createdAt: iso(r.created_at) })),
    connections: assignments.map((a) => {
      const deal = dealOf(a);
      return {
        assignmentId: a.id, vehicleId: a.vehicle_id, car: [a.make, a.model].filter(Boolean).join(" ") || a.plate, plate: a.plate, ownerName: a.owner_name, ownCar: a.owner_id === user.sub,
        terms: deal ? { feeType: deal.feeType, ownerSharePercent: deal.ownerSharePercent, rentAmount: deal.rentAmount, rentPeriod: deal.rentPeriod } : null,
        rentOwed: deal ? rentDue(deal, fromDb(String(a.assigned_at)), Number(a.rent_paid_total ?? 0)) : 0,
      };
    }),
  });
});

dealRoutes.post("/car/deals/requests/:id/withdraw", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const res = await db.execute({ sql: "UPDATE driver_requests SET status = 'withdrawn', decided_at = datetime('now') WHERE id = ? AND driver_id = ? AND status = 'pending'", args: [id, user.sub] });
  if (res.rowsAffected === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/** The driver pays rent owed straight from their wallet (otherwise it is taken from ride earnings). */
dealRoutes.post("/car/deals/rent/pay", async (c) => {
  const user = c.get("user");
  const parsed = z.object({ assignmentId: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const a = (await db.execute({
    sql: `SELECT a.*, v.owner_id FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.id = ? AND a.driver_id = ? AND a.status = 'active'`,
    args: [parsed.data.assignmentId, user.sub],
  })).rows[0] as Row | undefined;
  if (!a) return c.json({ error: "not_found" }, 404);
  const deal = dealOf(a);
  const owed = deal ? rentDue(deal, fromDb(String(a.assigned_at)), Number(a.rent_paid_total ?? 0)) : 0;
  if (owed <= 0) return c.json({ error: "nothing_owed", message: "No rent is owed right now." }, 409);
  const environment = (await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live";
  const balance = await debitWallet(user.sub, owed, { type: "adjustment", environment, actorId: user.sub, note: "Car rent paid" });
  if (balance === null) return c.json({ error: "insufficient_wallet", message: `You need UGX ${owed.toLocaleString("en-UG")} in your wallet. It is also taken from your next ride earnings.` }, 402);
  await creditWallet(String(a.owner_id), owed, { type: "adjustment", environment, actorId: user.sub, note: "Car rent received" });
  await db.execute({ sql: "UPDATE vehicle_assignments SET rent_paid_total = rent_paid_total + ? WHERE id = ?", args: [owed, String(a.id)] });
  return c.json({ ok: true, paid: owed });
});
