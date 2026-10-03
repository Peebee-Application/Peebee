import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditWallet, debitWallet } from "../wallet/service.js";

type Row = Record<string, unknown>;
type Env = "live" | "sandbox";

/** Self-drive hire. Closed until an admin enables it AND sets Tuma's percentage. */
export const selfDriveRoutes = new Hono();
selfDriveRoutes.use("/car/rentals/*", requireAuth);
selfDriveRoutes.use("/car/rentals/*", async (c, next) => {
  if (!(await hasTable("car_bookings")) || !(await hasTable("rentals"))) return c.json({ error: "selfdrive_unavailable", message: "Self-drive isn't ready yet." }, 503);
  const s = await getCarSettings();
  if (!s.enabled || !s.selfDrive.enabled || s.selfDrive.platformPercent == null) {
    return c.json({ error: "selfdrive_disabled", message: "Self-drive isn't available right now." }, 403);
  }
  await next();
});

const fromDb = (ts: string) => new Date(`${ts.replace(" ", "T")}Z`);
const toDb = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const ACTIVE = "('requested', 'approved', 'active', 'disputed')";

/** Rent days: whole 24-hour blocks, at least one. */
export function rentalDays(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

/** How a finished rental's held money is shared (deposit back minus any damage, Tuma's cut of the rent). Always adds up exactly. */
export function settleRental(input: { rent: number; deposit: number; platformPercent: number; damage: number }) {
  const damage = Math.min(Math.max(0, input.damage), input.deposit);
  const platform = Math.floor((input.rent * input.platformPercent) / 100);
  return { damage, platform, owner: input.rent - platform + damage, refund: input.deposit - damage };
}

async function envOf(rental: Row): Promise<Env> {
  return rental.environment === "sandbox" ? "sandbox" : "live";
}

async function refundAll(rental: Row, actorId: string, note: string) {
  await creditWallet(String(rental.renter_id), Number(rental.rent_amount) + Number(rental.deposit_amount), { type: "adjustment", environment: await envOf(rental), actorId, note });
}

/** Pays out a rental once: claims the status flip first, so a retry can never pay twice. */
export async function completeRental(rentalId: string, from: string[], damage: number, actorId: string): Promise<boolean> {
  const rental = (await db.execute({ sql: "SELECT * FROM rentals WHERE id = ?", args: [rentalId] })).rows[0] as Row | undefined;
  if (!rental || !from.includes(String(rental.status))) return false;
  const parts = settleRental({ rent: Number(rental.rent_amount), deposit: Number(rental.deposit_amount), platformPercent: Number(rental.platform_percent), damage });
  const placeholders = from.map(() => "?").join(", ");
  const claimed = await db.execute({
    sql: `UPDATE rentals SET status = 'completed', damage_final = ?, owner_amount = ?, platform_amount = ?, refund_amount = ?, settled_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND status IN (${placeholders})`,
    args: [parts.damage, parts.owner, parts.platform, parts.refund, rentalId, ...from],
  });
  if (claimed.rowsAffected === 0) return false;
  const environment = await envOf(rental);
  if (parts.owner > 0) await creditWallet(String(rental.owner_id), parts.owner, { type: "adjustment", environment, actorId, note: "Self-drive rental — owner payout" });
  if (parts.refund > 0) await creditWallet(String(rental.renter_id), parts.refund, { type: "adjustment", environment, actorId, note: "Self-drive deposit returned" });
  return true;
}

// ---- Owner: list a vehicle, answer requests, hand over, take back ------------------

const listingSchema = z.object({
  dailyPrice: z.number().int().min(1).max(100_000_000),
  depositAmount: z.number().int().min(0).max(1_000_000_000),
  notes: z.string().trim().max(300).optional(),
  active: z.boolean().default(true),
});

selfDriveRoutes.put("/car/rentals/listings/:vehicleId", async (c) => {
  const vehicleId = c.req.param("vehicleId") as string;
  const user = c.get("user");
  const parsed = listingSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { selfDrive } = await getCarSettings();
  const vehicle = (await db.execute({ sql: "SELECT status FROM vehicles WHERE id = ? AND owner_id = ?", args: [vehicleId, user.sub] })).rows[0] as Row | undefined;
  if (!vehicle) return c.json({ error: "not_found" }, 404);
  if (vehicle.status !== "approved") return c.json({ error: "vehicle_not_approved", message: "Only approved vehicles can be listed." }, 409);
  if (parsed.data.depositAmount < selfDrive.minDeposit) return c.json({ error: "deposit_too_low", message: `The deposit must be at least UGX ${selfDrive.minDeposit.toLocaleString("en-UG")}.` }, 400);
  await db.execute({
    sql: `INSERT INTO rental_listings (vehicle_id, daily_price, deposit_amount, notes, active) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(vehicle_id) DO UPDATE SET daily_price = excluded.daily_price, deposit_amount = excluded.deposit_amount, notes = excluded.notes, active = excluded.active, updated_at = datetime('now')`,
    args: [vehicleId, parsed.data.dailyPrice, parsed.data.depositAmount, parsed.data.notes ?? null, parsed.data.active ? 1 : 0],
  });
  return c.json({ ok: true });
});

selfDriveRoutes.get("/car/rentals/my-vehicles", async (c) => {
  const user = c.get("user");
  const vehicles = await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.status, l.daily_price, l.deposit_amount, l.active, l.notes
          FROM vehicles v LEFT JOIN rental_listings l ON l.vehicle_id = v.id WHERE v.owner_id = ? AND v.status = 'approved' ORDER BY v.created_at DESC`,
    args: [user.sub],
  });
  const rentals = await db.execute({
    sql: `SELECT r.*, v.plate, u.name AS renter_name FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN users u ON u.id = r.renter_id
          WHERE r.owner_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    args: [user.sub],
  });
  return c.json({ vehicles: vehicles.rows, rentals: rentals.rows.map(publicRental) });
});

function publicRental(r: Row) {
  return {
    id: r.id, vehicle_id: r.vehicle_id, plate: r.plate ?? null, renter_name: r.renter_name ?? null, owner_name: r.owner_name ?? null,
    starts_at: fromDb(String(r.starts_at)).toISOString(), ends_at: fromDb(String(r.ends_at)).toISOString(), days: r.days,
    rent_amount: r.rent_amount, deposit_amount: r.deposit_amount, status: r.status, damage_claim: r.damage_claim,
    licence_number: r.licence_number, licence_expiry: r.licence_expiry, owner_amount: r.owner_amount, refund_amount: r.refund_amount,
  };
}

selfDriveRoutes.post("/car/rentals/:id/decision", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ approve: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const rental = (await db.execute({ sql: "SELECT * FROM rentals WHERE id = ? AND owner_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!rental) return c.json({ error: "not_found" }, 404);
  const next = parsed.data.approve ? "approved" : "declined";
  const flipped = await db.execute({ sql: "UPDATE rentals SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'requested'", args: [next, id] });
  if (flipped.rowsAffected === 0) return c.json({ error: "invalid_status", message: "This request has already been answered." }, 409);
  if (!parsed.data.approve) await refundAll(rental, user.sub, "Self-drive request declined — returned");
  notifyUser(String(rental.renter_id), {
    title: parsed.data.approve ? "Your car rental was approved" : "Your car rental was declined",
    body: parsed.data.approve ? "Arrange the handover with the owner." : "Your payment has been returned to your wallet.",
    url: "/rent",
    tag: `rental-${id}`,
  }).catch(() => {});
  return c.json({ ok: true });
});

selfDriveRoutes.post("/car/rentals/:id/handover", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const flipped = await db.execute({ sql: "UPDATE rentals SET status = 'active', handed_over_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ? AND status = 'approved'", args: [id, user.sub] });
  if (flipped.rowsAffected === 0) return c.json({ error: "invalid_status", message: "Only an approved rental can be handed over." }, 409);
  return c.json({ ok: true });
});

/** The owner has the car back. No damage: everything is paid out. A damage claim holds the deposit for an admin to rule on. */
selfDriveRoutes.post("/car/rentals/:id/return", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ damageClaim: z.number().int().min(0).max(1_000_000_000).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const rental = (await db.execute({ sql: "SELECT * FROM rentals WHERE id = ? AND owner_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!rental) return c.json({ error: "not_found" }, 404);
  const claim = Math.min(parsed.data.damageClaim ?? 0, Number(rental.deposit_amount));
  if (claim > 0) {
    const flipped = await db.execute({
      sql: "UPDATE rentals SET status = 'disputed', damage_claim = ?, returned_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'active'",
      args: [claim, id],
    });
    if (flipped.rowsAffected === 0) return c.json({ error: "invalid_status", message: "Only a rental in progress can be returned." }, 409);
    notifyUser(String(rental.renter_id), { title: "Damage claim on your rental", body: "The owner reported damage. Tuma will review it before your deposit is settled.", url: "/rent", tag: `rental-${id}` }).catch(() => {});
    return c.json({ ok: true, status: "disputed" });
  }
  await db.execute({ sql: "UPDATE rentals SET returned_at = datetime('now') WHERE id = ? AND status = 'active'", args: [id] });
  const done = await completeRental(id, ["active"], 0, user.sub);
  if (!done) return c.json({ error: "invalid_status", message: "Only a rental in progress can be returned." }, 409);
  return c.json({ ok: true, status: "completed" });
});

// ---- Renter: browse, request, follow, cancel ----------------------------------------------

selfDriveRoutes.get("/car/rentals/listings", async (c) => {
  const q = z.object({ startsAt: z.string().max(40), endsAt: z.string().max(40), categoryId: z.string().optional() }).safeParse(c.req.query());
  if (!q.success) return c.json({ error: "invalid_query" }, 400);
  const start = new Date(q.data.startsAt);
  const end = new Date(q.data.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return c.json({ error: "invalid_dates", message: "Choose a valid pickup and return time." }, 400);
  const days = rentalDays(start, end);
  const user = c.get("user");
  const rows = (await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.colour, v.year, cat.name AS category_name, cat.seats, l.daily_price, l.deposit_amount, l.notes
          FROM rental_listings l JOIN vehicles v ON v.id = l.vehicle_id AND v.status = 'approved' JOIN vehicle_categories cat ON cat.id = v.category_id
          WHERE l.active = 1 AND v.owner_id != ? ${q.data.categoryId ? "AND v.category_id = ?" : ""}
            AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id AND r.status IN ${ACTIVE} AND r.starts_at < ? AND r.ends_at > ?)
          ORDER BY l.daily_price ASC LIMIT 100`,
    args: [user.sub, ...(q.data.categoryId ? [q.data.categoryId] : []), toDb(end), toDb(start)],
  })).rows as Row[];
  return c.json({
    days,
    vehicles: rows.map((v) => ({
      id: v.id, name: [v.colour, v.make, v.model, v.year].filter(Boolean).join(" ") || String(v.category_name), category: v.category_name, seats: v.seats,
      dailyPrice: Number(v.daily_price), deposit: Number(v.deposit_amount), rent: Number(v.daily_price) * days, notes: v.notes,
    })),
  });
});

const requestSchema = z.object({
  vehicleId: z.string().min(1),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  licenceNumber: z.string().trim().min(4).max(30),
  licenceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

selfDriveRoutes.post("/car/rentals", async (c) => {
  const user = c.get("user");
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const { selfDrive } = await getCarSettings();
  const start = new Date(d.startsAt);
  const end = new Date(d.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return c.json({ error: "invalid_dates", message: "Choose a valid pickup and return time." }, 400);
  if (start.getTime() < Date.now() - 5 * 60000) return c.json({ error: "invalid_dates", message: "The pickup time has passed." }, 400);
  const days = rentalDays(start, end);
  if (days > selfDrive.maxDays) return c.json({ error: "too_long", message: `You can rent for up to ${selfDrive.maxDays} days.` }, 400);
  // The licence must cover the whole rental.
  if (new Date(`${d.licenceExpiry}T23:59:59Z`).getTime() < end.getTime()) return c.json({ error: "licence_expires", message: "Your licence expires before the rental ends." }, 400);

  const listing = (await db.execute({
    sql: `SELECT l.daily_price, l.deposit_amount, v.owner_id FROM rental_listings l JOIN vehicles v ON v.id = l.vehicle_id AND v.status = 'approved' WHERE l.vehicle_id = ? AND l.active = 1`,
    args: [d.vehicleId],
  })).rows[0] as Row | undefined;
  if (!listing) return c.json({ error: "not_available", message: "That vehicle isn't available for hire." }, 404);
  if (listing.owner_id === user.sub) return c.json({ error: "own_vehicle", message: "You can't rent your own vehicle." }, 409);

  const rent = Number(listing.daily_price) * days;
  const deposit = Number(listing.deposit_amount);
  const environment = await getPlatformEnvironment();
  const id = newId("rnt");
  // Reserve the dates first (atomic against an overlapping request), then take the money.
  const reserved = await db.execute({
    sql: `INSERT INTO rentals (id, vehicle_id, owner_id, renter_id, starts_at, ends_at, days, daily_price, rent_amount, deposit_amount, platform_percent, licence_number, licence_expiry, environment)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = ? AND r.status IN ${ACTIVE} AND r.starts_at < ? AND r.ends_at > ?)`,
    args: [id, d.vehicleId, String(listing.owner_id), user.sub, toDb(start), toDb(end), days, Number(listing.daily_price), rent, deposit, selfDrive.platformPercent!, d.licenceNumber, d.licenceExpiry, environment,
      d.vehicleId, toDb(end), toDb(start)],
  });
  if (reserved.rowsAffected === 0) return c.json({ error: "not_available", message: "That vehicle was just booked for these dates." }, 409);
  const debited = await debitWallet(user.sub, rent + deposit, { type: "adjustment", environment, actorId: user.sub, note: "Self-drive rental — rent and deposit held" });
  if (debited === null) {
    await db.execute({ sql: "DELETE FROM rentals WHERE id = ?", args: [id] });
    return c.json({ error: "insufficient_wallet", message: `You need UGX ${(rent + deposit).toLocaleString("en-UG")} in your wallet (rent plus a refundable deposit). Top up and try again.` }, 402);
  }
  notifyUser(String(listing.owner_id), { title: "New car rental request", body: `${days} day${days === 1 ? "" : "s"} · UGX ${rent.toLocaleString("en-UG")}. Approve or decline it.`, url: "/rentals", tag: `rental-${id}` }).catch(() => {});
  return c.json({ id, days, rent, deposit }, 201);
});

selfDriveRoutes.get("/car/rentals/mine", async (c) => {
  const user = c.get("user");
  const rows = await db.execute({
    sql: `SELECT r.*, v.plate, v.make, v.model, u.name AS owner_name FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN users u ON u.id = r.owner_id
          WHERE r.renter_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    args: [user.sub],
  });
  return c.json({ rentals: rows.rows.map((r) => ({ ...publicRental(r as Row), vehicle: [(r as Row).make, (r as Row).model].filter(Boolean).join(" ") || (r as Row).plate })) });
});

selfDriveRoutes.post("/car/rentals/:id/cancel", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const rental = (await db.execute({ sql: "SELECT * FROM rentals WHERE id = ? AND renter_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!rental) return c.json({ error: "not_found" }, 404);
  const flipped = await db.execute({ sql: "UPDATE rentals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('requested', 'approved')", args: [id] });
  if (flipped.rowsAffected === 0) return c.json({ error: "invalid_status", message: "This rental can't be cancelled now." }, 409);
  await refundAll(rental, user.sub, "Self-drive rental cancelled — returned");
  return c.json({ ok: true });
});

/** Requests the owner never answered lose their hold and the renter's money is returned. */
export async function sweepRentalRequests(): Promise<number> {
  if (!(await hasTable("rentals"))) return 0;
  const { selfDrive } = await getCarSettings();
  const stale = await db.execute({
    sql: "SELECT * FROM rentals WHERE status = 'requested' AND created_at <= datetime('now', ?) LIMIT 100",
    args: [`-${selfDrive.approveWithinHours} hours`],
  });
  let n = 0;
  for (const rental of stale.rows as Row[]) {
    const flipped = await db.execute({ sql: "UPDATE rentals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'requested'", args: [String(rental.id)] });
    if (flipped.rowsAffected === 0) continue;
    await refundAll(rental, String(rental.renter_id), "Self-drive request expired — returned");
    n += 1;
  }
  return n;
}
