import { Hono } from "hono";
import { z } from "zod";
import { CAR_MODEL_CATALOG } from "@peebee/shared";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";

type Row = Record<string, unknown>;
type Env = "live" | "sandbox";

/** Self-drive hire. Closed until an admin enables it AND sets Peebee's percentage. */
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

export function rentalHourlyPrice(dailyPrice: number): number { return Math.round(dailyPrice * 1.2 / 24); }
export function rentalPrice(dailyPrice: number, start: Date, end: Date, period: "hourly" | "half_day" | "full_day"): number {
  const hours = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3_600_000));
  if (period === "hourly") return rentalHourlyPrice(dailyPrice) * hours;
  if (period === "half_day") return Math.round(dailyPrice * 0.6);
  return dailyPrice * Math.max(1, Math.ceil(hours / 24));
}

/** How a finished rental's held money is shared (deposit back minus any damage, Peebee's cut of the rent). Always adds up exactly. */
export function settleRental(input: { rent: number; deposit: number; platformPercent: number; damage: number; overtime?: number }) {
  const overtime = Math.min(Math.max(0, input.overtime ?? 0), input.deposit);
  const damage = Math.min(Math.max(0, input.damage), input.deposit - overtime);
  const platform = Math.floor(((input.rent + overtime) * input.platformPercent) / 100);
  return { damage, ...(input.overtime == null ? {} : { overtime }), platform, owner: input.rent + overtime - platform + damage, refund: input.deposit - damage - overtime };
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
  const endedAt = rental.returned_at ? fromDb(String(rental.returned_at)) : new Date();
  const bookedEnd = fromDb(String(rental.ends_at));
  const { selfDrive } = await getCarSettings();
  const overtimeHours = Math.max(0, Math.ceil((endedAt.getTime() - bookedEnd.getTime() - selfDrive.overtimeGraceHours * 3_600_000) / 3_600_000));
  const overtime = Math.min(Number(rental.deposit_amount), overtimeHours * (Number(rental.hourly_price) || rentalHourlyPrice(Number(rental.daily_price))));
  const parts = settleRental({ rent: Number(rental.rent_amount), deposit: Number(rental.deposit_amount), platformPercent: Number(rental.platform_percent), damage, overtime });
  const placeholders = from.map(() => "?").join(", ");
  const claimed = await db.execute({
    sql: `UPDATE rentals SET status = 'completed', damage_final = ?, owner_amount = ?, platform_amount = ?, refund_amount = ?, ${await hasColumn("rentals", "overtime_amount") ? "overtime_amount = ?, " : ""}settled_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND status IN (${placeholders})`,
    args: [parts.damage, parts.owner, parts.platform, parts.refund, ...(await hasColumn("rentals", "overtime_amount") ? [parts.overtime ?? 0] : []), rentalId, ...from],
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
  hourlyEnabled: z.boolean().default(true),
  halfDayEnabled: z.boolean().default(true),
  fullDayEnabled: z.boolean().default(true),
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
  const hasPeriods = await hasColumn("rental_listings", "hourly_enabled");
  const hasEnvironment = await hasColumn("rental_listings", "environment");
  if (hasPeriods) {
    await db.execute({
      sql: `INSERT INTO rental_listings (vehicle_id, daily_price, deposit_amount, notes, active, hourly_enabled, half_day_enabled, full_day_enabled${hasEnvironment ? ", environment" : ""}) VALUES (?, ?, ?, ?, ?, ?, ?, ?${hasEnvironment ? ", ?" : ""})
            ON CONFLICT(vehicle_id) DO UPDATE SET daily_price = excluded.daily_price, deposit_amount = excluded.deposit_amount, notes = excluded.notes, active = excluded.active, hourly_enabled = excluded.hourly_enabled, half_day_enabled = excluded.half_day_enabled, full_day_enabled = excluded.full_day_enabled${hasEnvironment ? ", environment = excluded.environment" : ""}, updated_at = datetime('now')`,
      args: [vehicleId, parsed.data.dailyPrice, parsed.data.depositAmount, parsed.data.notes ?? null, parsed.data.active ? 1 : 0, parsed.data.hourlyEnabled ? 1 : 0, parsed.data.halfDayEnabled ? 1 : 0, parsed.data.fullDayEnabled ? 1 : 0, ...(hasEnvironment ? [await getPlatformEnvironment()] : [])],
    });
  } else {
    await db.execute({ sql: `INSERT INTO rental_listings (vehicle_id, daily_price, deposit_amount, notes, active) VALUES (?, ?, ?, ?, ?) ON CONFLICT(vehicle_id) DO UPDATE SET daily_price = excluded.daily_price, deposit_amount = excluded.deposit_amount, notes = excluded.notes, active = excluded.active, updated_at = datetime('now')`, args: [vehicleId, parsed.data.dailyPrice, parsed.data.depositAmount, parsed.data.notes ?? null, parsed.data.active ? 1 : 0] });
  }
  return c.json({ ok: true });
});

selfDriveRoutes.get("/car/rentals/my-vehicles", async (c) => {
  const user = c.get("user");
  const hasProfiles = await hasColumn("vehicles", "model_catalog_id") && await hasColumn("vehicles", "service_class") && await hasColumn("vehicles", "condition_grade") && await hasColumn("vehicles", "seat_capacity") && await hasColumn("vehicles", "features_json");
  const hasServiceDate = await hasColumn("vehicles", "last_service_date");
  const vehicles = await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.status, l.daily_price, l.deposit_amount, l.active, l.notes${hasProfiles ? ", v.model_catalog_id, v.service_class, v.condition_grade, v.seat_capacity" : ""}${hasServiceDate ? ", v.last_service_date" : ""}${await hasColumn("rental_listings", "hourly_enabled") ? ", l.hourly_enabled, l.half_day_enabled, l.full_day_enabled" : ""}
          FROM vehicles v LEFT JOIN rental_listings l ON l.vehicle_id = v.id${await hasColumn("rental_listings", "environment") ? " AND l.environment = ?" : ""} WHERE v.owner_id = ? AND v.status = 'approved' ORDER BY v.created_at DESC`,
    args: [...(await hasColumn("rental_listings", "environment") ? [await getPlatformEnvironment()] : []), user.sub],
  });
  const rentals = await db.execute({
    sql: `SELECT r.*, v.plate, u.name AS renter_name FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN users u ON u.id = r.renter_id
          WHERE r.owner_id = ? AND r.environment = ? ORDER BY r.created_at DESC LIMIT 100`,
    args: [user.sub, await getPlatformEnvironment()],
  });
  return c.json({ vehicles: (vehicles.rows as Row[]).map((v) => ({ ...v, ...(hasProfiles ? { standard_daily_price: CAR_MODEL_CATALOG.find((m) => m.id === v.model_catalog_id)?.standardDailyUgx ?? null } : {}) })), rentals: rentals.rows.map(publicRental) });
});

const RENTER_KYC_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const RENTER_KYC_MAX_BYTES = 8 * 1024 * 1024;

selfDriveRoutes.get("/car/rentals/renter-profile", requireRole("customer"), async (c) => {
  if (await getPlatformEnvironment() === "sandbox") return c.json({ status: "approved", isSimulated: true, ninMasked: "••••••••••0000", residentialAddress: "Practice address · Entebbe", residenceMethod: "bill", hasNationalId: true, hasRentReceipt: false, hasLandlordLetter: false, hasResidenceBill: true, tenancyStart: null, tenancyEnd: null, reviewNotes: null });
  if (!(await hasTable("selfdrive_renter_kyc"))) return c.json({ error: "verification_unavailable", message: "Renter verification is being set up. Please try again later." }, 503);
  const user = c.get("user");
  const row = (await db.execute({ sql: "SELECT nin, residential_address, residence_method, rent_receipt_key, landlord_letter_key, residence_bill_key, tenancy_start, tenancy_end, status, review_notes FROM selfdrive_renter_kyc WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  const nin = String(row?.nin ?? "");
  return c.json({ status: row?.status ?? "incomplete", isSimulated: false, ninMasked: nin ? `••••••••••${nin.slice(-4)}` : null, residentialAddress: row?.residential_address ?? null, residenceMethod: row?.residence_method ?? null, hasNationalId: Boolean(row?.nin), hasRentReceipt: Boolean(row?.rent_receipt_key), hasLandlordLetter: Boolean(row?.landlord_letter_key), hasResidenceBill: Boolean(row?.residence_bill_key), tenancyStart: row?.tenancy_start ?? null, tenancyEnd: row?.tenancy_end ?? null, reviewNotes: row?.status === "rejected" ? row?.review_notes ?? null : null });
});

/** National ID and residence proofs are private: only the customer and authorised Car admins can retrieve them. */
selfDriveRoutes.post("/car/rentals/renter-profile", requireRole("customer"), async (c) => {
  if (await getPlatformEnvironment() === "sandbox") return c.json({ ok: true, status: "approved" }, 201);
  if (!(await hasTable("selfdrive_renter_kyc"))) return c.json({ error: "verification_unavailable", message: "Renter verification is being set up. Please try again later." }, 503);
  const user = c.get("user");
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "invalid_body", message: "Complete the identity and residence form." }, 400);
  const nin = String(form.get("nin") ?? "").trim().toUpperCase();
  const residentialAddress = String(form.get("residentialAddress") ?? "").trim();
  const method = form.get("residenceMethod");
  if (!/^[A-Z0-9]{14}$/.test(nin)) return c.json({ error: "invalid_nin", message: "Enter the 14-character NIN shown on your National ID." }, 400);
  if (residentialAddress.length < 5 || residentialAddress.length > 250) return c.json({ error: "invalid_residential_address", message: "Enter your current area, street or village, and house or landmark details." }, 400);
  if (method !== "rent_and_landlord_letter" && method !== "bill") return c.json({ error: "invalid_residence_method" }, 400);
  const files: Array<{ field: string; file: FormDataEntryValue | null }> = [{ field: "national_id", file: form.get("nationalId") }];
  let tenancyStart: string | null = null;
  let tenancyEnd: string | null = null;
  if (method === "rent_and_landlord_letter") {
    tenancyStart = String(form.get("tenancyStart") ?? "");
    tenancyEnd = String(form.get("tenancyEnd") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tenancyStart) || !/^\d{4}-\d{2}-\d{2}$/.test(tenancyEnd) || tenancyStart > tenancyEnd || tenancyEnd < new Date().toISOString().slice(0, 10)) return c.json({ error: "invalid_tenancy_dates", message: "Enter the start and current end date of your tenancy agreement." }, 400);
    files.push({ field: "rent_receipt", file: form.get("rentReceipt") }, { field: "landlord_letter", file: form.get("landlordLetter") });
  } else files.push({ field: "residence_bill", file: form.get("residenceBill") });
  for (const item of files) {
    if (!(item.file instanceof File)) return c.json({ error: "missing_document", message: `Upload the ${item.field.replaceAll("_", " ")} document.` }, 400);
    if (!RENTER_KYC_MIME.has(baseMimeType(item.file.type))) return c.json({ error: "unsupported_file_type", message: "Documents must be JPG, PNG, WebP or PDF." }, 400);
    if (item.file.size > RENTER_KYC_MAX_BYTES) return c.json({ error: "file_too_large", message: "Each document must be 8 MB or smaller." }, 400);
  }
  const bucket = getR2Bucket();
  const keys: Record<string, string> = {};
  const uploaded: string[] = [];
  try {
    for (const item of files) {
      const file = item.file as File;
      const key = `selfdrive-renter-kyc/${user.sub}/${newId("doc")}.${extensionForMime(file.type, "bin")}`;
      await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      keys[item.field] = key;
      uploaded.push(key);
    }
    const previous = (await db.execute({ sql: "SELECT national_id_key, rent_receipt_key, landlord_letter_key, residence_bill_key FROM selfdrive_renter_kyc WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
    await db.execute({
      sql: `INSERT INTO selfdrive_renter_kyc (user_id, nin, residential_address, national_id_key, residence_method, rent_receipt_key, landlord_letter_key, residence_bill_key, tenancy_start, tenancy_end, status, review_notes, reviewed_by, reviewed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET nin = excluded.nin, residential_address = excluded.residential_address, national_id_key = excluded.national_id_key, residence_method = excluded.residence_method, rent_receipt_key = excluded.rent_receipt_key, landlord_letter_key = excluded.landlord_letter_key, residence_bill_key = excluded.residence_bill_key, tenancy_start = excluded.tenancy_start, tenancy_end = excluded.tenancy_end, status = 'pending', review_notes = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now')`,
      args: [user.sub, nin, residentialAddress, keys.national_id, method, keys.rent_receipt ?? null, keys.landlord_letter ?? null, keys.residence_bill ?? null, tenancyStart, tenancyEnd],
    });
    for (const key of [previous?.national_id_key, previous?.rent_receipt_key, previous?.landlord_letter_key, previous?.residence_bill_key]) if (key) await bucket.delete(String(key)).catch(() => undefined);
  } catch (err) {
    await Promise.all(uploaded.map((key) => bucket.delete(key).catch(() => undefined)));
    console.error("Self-drive renter verification upload failed:", err);
    return c.json({ error: "upload_failed", message: "We couldn't save your verification documents. Please retry." }, 502);
  }
  return c.json({ ok: true, status: "pending" }, 201);
});

function publicRental(r: Row) {
  return {
    id: r.id, vehicle_id: r.vehicle_id, plate: r.plate ?? null, renter_name: r.renter_name ?? null, owner_name: r.owner_name ?? null,
    starts_at: fromDb(String(r.starts_at)).toISOString(), ends_at: fromDb(String(r.ends_at)).toISOString(), days: r.days,
    rent_amount: r.rent_amount, deposit_amount: r.deposit_amount, status: r.status, damage_claim: r.damage_claim, period_type: r.period_type, handed_over_at: r.handed_over_at ? fromDb(String(r.handed_over_at)).toISOString() : null, overtime_amount: r.overtime_amount,
    licence_number: r.licence_number, licence_expiry: r.licence_expiry, owner_amount: r.owner_amount, refund_amount: r.refund_amount, hourly_price: r.hourly_price,
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
  const rental = (await db.execute({ sql: "SELECT starts_at, ends_at FROM rentals WHERE id = ? AND owner_id = ? AND status = 'approved'", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!rental) return c.json({ error: "invalid_status", message: "Only an approved rental can be handed over." }, 409);
  const duration = fromDb(String(rental.ends_at)).getTime() - fromDb(String(rental.starts_at)).getTime();
  const handedOver = new Date();
  const flipped = await db.execute({ sql: "UPDATE rentals SET status = 'active', starts_at = ?, ends_at = ?, handed_over_at = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ? AND status = 'approved'", args: [toDb(handedOver), toDb(new Date(handedOver.getTime() + duration)), toDb(handedOver), id, user.sub] });
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
    notifyUser(String(rental.renter_id), { title: "Damage claim on your rental", body: "The owner reported damage. Peebee will review it before your deposit is settled.", url: "/rent", tag: `rental-${id}` }).catch(() => {});
    return c.json({ ok: true, status: "disputed" });
  }
  await db.execute({ sql: "UPDATE rentals SET returned_at = datetime('now') WHERE id = ? AND status = 'active'", args: [id] });
  const done = await completeRental(id, ["active"], 0, user.sub);
  if (!done) return c.json({ error: "invalid_status", message: "Only a rental in progress can be returned." }, 409);
  const settled = (await db.execute({ sql: `SELECT ${await hasColumn("rentals", "overtime_amount") ? "overtime_amount" : "0 AS overtime_amount"} FROM rentals WHERE id = ?`, args: [id] })).rows[0] as Row | undefined;
  return c.json({ ok: true, status: "completed", overtime: Number(settled?.overtime_amount ?? 0) });
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
  const hasPeriods = await hasColumn("rental_listings", "hourly_enabled");
  const hasEnvironment = await hasColumn("rental_listings", "environment");
  const hasProfiles = await hasColumn("vehicles", "model_catalog_id") && await hasColumn("vehicles", "service_class") && await hasColumn("vehicles", "condition_grade") && await hasColumn("vehicles", "seat_capacity") && await hasColumn("vehicles", "features_json");
  const hasServiceDate = await hasColumn("vehicles", "last_service_date");
  const rows = (await db.execute({
    sql: `SELECT v.id, v.plate, v.make, v.model, v.colour, v.year, cat.name AS category_name, cat.seats, l.daily_price, l.deposit_amount, l.notes, u.name AS owner_name${hasPeriods ? ", l.hourly_enabled, l.half_day_enabled, l.full_day_enabled" : ""}${hasProfiles ? ", v.model_catalog_id, v.service_class, v.condition_grade, v.seat_capacity, v.features_json" : ""}${hasServiceDate ? ", v.last_service_date" : ""}
          FROM rental_listings l JOIN vehicles v ON v.id = l.vehicle_id AND v.status = 'approved' JOIN vehicle_categories cat ON cat.id = v.category_id
          JOIN users u ON u.id = v.owner_id
          WHERE l.active = 1 ${hasEnvironment ? "AND l.environment = ?" : ""} AND v.owner_id != ? ${q.data.categoryId ? "AND v.category_id = ?" : ""}
            AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id AND r.status IN ${ACTIVE} AND r.starts_at < ? AND r.ends_at > ?)
          ORDER BY l.daily_price ASC LIMIT 100`,
    args: [...(hasEnvironment ? [await getPlatformEnvironment()] : []), user.sub, ...(q.data.categoryId ? [q.data.categoryId] : []), toDb(end), toDb(start)],
  })).rows as Row[];
  const photoMap: Record<string, string[]> = {};
  if (await hasTable("vehicle_photos")) {
    const photos = await db.execute({ sql: `SELECT p.vehicle_id, p.id FROM vehicle_photos p JOIN rental_listings l ON l.vehicle_id = p.vehicle_id WHERE l.active = 1${hasEnvironment ? " AND l.environment = ?" : ""} ORDER BY p.sort`, args: hasEnvironment ? [await getPlatformEnvironment()] : [] });
    for (const p of photos.rows as Row[]) (photoMap[String(p.vehicle_id)] ??= []).push(String(p.id));
  }
  return c.json({
    days,
    vehicles: rows.map((v) => ({
      id: v.id, name: [v.colour, v.make, v.model, v.year].filter(Boolean).join(" ") || String(v.category_name), category: v.category_name, seats: hasProfiles ? Number(v.seat_capacity) || v.seats : v.seats,
      ownerName: String(v.owner_name ?? "Vehicle owner"), dailyPrice: Number(v.daily_price), hourlyPrice: rentalHourlyPrice(Number(v.daily_price)), halfDayPrice: Math.round(Number(v.daily_price) * 0.6), deposit: Number(v.deposit_amount), rent: Number(v.daily_price) * days, notes: v.notes,
      ...(hasProfiles ? (() => { const model = CAR_MODEL_CATALOG.find((m) => m.id === v.model_catalog_id); let features: string[] = []; try { features = JSON.parse(String(v.features_json ?? "[]")); } catch { /* ignore malformed owner data */ } return { serviceClass: v.service_class, condition: v.condition_grade, modelCatalogId: v.model_catalog_id, fuelLitresPerKm: model?.fuelLitresPerKm ?? null, luggageLitres: model?.luggageLitres ?? null, luggageNote: model?.luggageNote ?? null, standardDailyPrice: model?.standardDailyUgx ?? null, features }; })() : {}),
      ...(hasServiceDate ? { lastServiceDate: v.last_service_date } : {}),
      photos: photoMap[String(v.id)] ?? [],
      hourlyEnabled: !hasPeriods || Number(v.hourly_enabled) === 1, halfDayEnabled: !hasPeriods || Number(v.half_day_enabled) === 1, fullDayEnabled: !hasPeriods || Number(v.full_day_enabled) === 1,
    })),
  });
});

const requestSchema = z.object({
  vehicleId: z.string().min(1),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  licenceNumber: z.string().trim().min(4).max(30),
  licenceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodType: z.enum(["hourly", "half_day", "full_day"]).default("full_day"),
});

selfDriveRoutes.post("/car/rentals", requireRole("customer"), async (c) => {
  const user = c.get("user");
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const { selfDrive } = await getCarSettings();
  const start = new Date(d.startsAt);
  const end = new Date(d.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return c.json({ error: "invalid_dates", message: "Choose a valid pickup and return time." }, 400);
  if (start.getTime() < Date.now() - 5 * 60000) return c.json({ error: "invalid_dates", message: "The pickup time has passed." }, 400);
  const period = d.periodType;
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  if ((period === "hourly" && (durationHours < 1 || durationHours > 24.1)) || (period === "half_day" && Math.abs(durationHours - 6) > 0.1) || (period === "full_day" && (durationHours < 24 || Math.abs(durationHours / 24 - Math.round(durationHours / 24)) > 0.1 / 24))) return c.json({ error: "invalid_period", message: "Hourly bookings are 1–24 hours; half-day is 6 hours and full-day rentals use whole 24-hour blocks." }, 400);
  const days = rentalDays(start, end);
  if (days > selfDrive.maxDays) return c.json({ error: "too_long", message: `You can rent for up to ${selfDrive.maxDays} days.` }, 400);
  const environment = await getPlatformEnvironment();
  const isSandboxDemo = environment === "sandbox" && d.vehicleId.startsWith("demo-rent-");
  if (!isSandboxDemo) {
    if (!(await hasTable("selfdrive_renter_kyc"))) return c.json({ error: "verification_unavailable", message: "Renter verification is being set up. Please try again later." }, 503);
    const renterProfile = (await db.execute({ sql: "SELECT status FROM selfdrive_renter_kyc WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
    if (renterProfile?.status !== "approved") return c.json({ error: "verification_required", message: renterProfile?.status === "pending" ? "Your renter identity and residence documents are under review. You can book after approval." : renterProfile?.status === "rejected" ? "Update your renter identity and residence documents before booking." : "Complete your renter identity and residence profile before booking." }, 409);
  }
  // The licence must cover the whole rental.
  if (new Date(`${d.licenceExpiry}T23:59:59Z`).getTime() < end.getTime()) return c.json({ error: "licence_expires", message: "Your licence expires before the rental ends." }, 400);

  const listing = (await db.execute({
    sql: `SELECT l.daily_price, l.deposit_amount, v.owner_id${await hasColumn("rental_listings", "hourly_enabled") ? ", l.hourly_enabled, l.half_day_enabled, l.full_day_enabled" : ""} FROM rental_listings l JOIN vehicles v ON v.id = l.vehicle_id AND v.status = 'approved' WHERE l.vehicle_id = ? AND l.active = 1${await hasColumn("rental_listings", "environment") ? " AND l.environment = ?" : ""}`,
    args: [d.vehicleId, ...(await hasColumn("rental_listings", "environment") ? [await getPlatformEnvironment()] : [])],
  })).rows[0] as Row | undefined;
  if (!listing) return c.json({ error: "not_available", message: "That vehicle isn't available for hire." }, 404);
  if (listing.owner_id === user.sub) return c.json({ error: "own_vehicle", message: "You can't rent your own vehicle." }, 409);
  if (await hasColumn("rental_listings", "hourly_enabled")) {
    const enabled = period === "hourly" ? listing.hourly_enabled : period === "half_day" ? listing.half_day_enabled : listing.full_day_enabled;
    if (Number(enabled) !== 1) return c.json({ error: "period_unavailable", message: "This owner does not offer that rental period." }, 409);
  }

  const rent = rentalPrice(Number(listing.daily_price), start, end, period);
  const hourlyPrice = rentalHourlyPrice(Number(listing.daily_price));
  const deposit = Number(listing.deposit_amount);
  const id = newId("rnt");
  // Reserve the dates first (atomic against an overlapping request), then take the money.
  const rentalHasPeriods = await hasColumn("rentals", "period_type");
  const rentalStart = isSandboxDemo ? new Date() : start;
  const rentalEnd = isSandboxDemo ? new Date(rentalStart.getTime() + end.getTime() - start.getTime()) : end;
  const reserved = await db.execute({
    sql: `INSERT INTO rentals (id, vehicle_id, owner_id, renter_id, starts_at, ends_at, days, daily_price, rent_amount, deposit_amount, platform_percent, licence_number, licence_expiry, environment${rentalHasPeriods ? ", period_type, hourly_price" : ""}${isSandboxDemo ? ", status, handed_over_at" : ""})
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${rentalHasPeriods ? ", ?, ?" : ""}${isSandboxDemo ? ", 'active', datetime('now')" : ""}
          WHERE NOT EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = ? AND r.status IN ${ACTIVE} AND r.starts_at < ? AND r.ends_at > ?)`,
    args: [id, d.vehicleId, String(listing.owner_id), user.sub, toDb(rentalStart), toDb(rentalEnd), days, Number(listing.daily_price), rent, deposit, selfDrive.platformPercent!, d.licenceNumber, d.licenceExpiry, environment, ...(rentalHasPeriods ? [period, hourlyPrice] : []),
      d.vehicleId, toDb(end), toDb(start)],
  });
  if (reserved.rowsAffected === 0) return c.json({ error: "not_available", message: "That vehicle was just booked for these dates." }, 409);
  const debited = await debitWallet(user.sub, rent + deposit, { type: "adjustment", environment, actorId: user.sub, note: "Self-drive rental — rent and deposit held" });
  if (debited === null) {
    await db.execute({ sql: "DELETE FROM rentals WHERE id = ?", args: [id] });
    return c.json({ error: "insufficient_wallet", message: `You need UGX ${(rent + deposit).toLocaleString("en-UG")} in your wallet (rent plus a refundable deposit). Top up and try again.` }, 402);
  }
  if (!isSandboxDemo) notifyUser(String(listing.owner_id), { title: "New car rental request", body: `${period.replace("_", " ")} · UGX ${rent.toLocaleString("en-UG")}. Approve or decline it.`, url: "/rentals", tag: `rental-${id}` }).catch(() => {});
  return c.json({ id, days, rent, deposit, periodType: period, status: isSandboxDemo ? "active" : "requested" }, 201);
});

selfDriveRoutes.get("/car/rentals/mine", async (c) => {
  const user = c.get("user");
  const rows = await db.execute({
    sql: `SELECT r.*, v.plate, v.make, v.model, u.name AS owner_name FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN users u ON u.id = r.owner_id
          WHERE r.renter_id = ? AND r.environment = ? ORDER BY r.created_at DESC LIMIT 50`,
    args: [user.sub, await getPlatformEnvironment()],
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

// Sandbox fleet owners are simulated; let the renter complete the demo journey.
selfDriveRoutes.post("/car/rentals/:id/demo-return", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  if ((await getPlatformEnvironment()) !== "sandbox") return c.json({ error: "not_found" }, 404);
  const rental = (await db.execute({ sql: "SELECT r.* FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = ? AND r.renter_id = ? AND v.id LIKE 'demo-rent-%'", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!rental) return c.json({ error: "not_found" }, 404);
  const returned = await db.execute({ sql: "UPDATE rentals SET returned_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'active'", args: [id] });
  if (returned.rowsAffected === 0) return c.json({ error: "invalid_status", message: "This demo rental is not in progress." }, 409);
  const done = await completeRental(id, ["active"], 0, user.sub);
  if (!done) return c.json({ error: "invalid_status", message: "This demo rental has already ended." }, 409);
  return c.json({ ok: true, status: "completed" });
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
