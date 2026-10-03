import { roundFare } from "@tuma/shared";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { hasTable } from "../lib/schema.js";
import { getCarSettings, type CarShares } from "../lib/settings.js";
import { creditWallet } from "../wallet/service.js";
import { newId } from "../lib/ids.js";

type Row = Record<string, unknown>;

/** True when this order is the commercial side of a Tuma Car booking. */
export async function isCarOrder(orderId: string): Promise<boolean> {
  if (!(await hasTable("car_bookings"))) return false;
  const res = await db.execute({ sql: "SELECT 1 FROM car_bookings WHERE order_id = ?", args: [orderId] });
  return res.rows.length > 0;
}

/** A category's own split if it sets a complete one that totals 100, otherwise the admin default. */
export function resolveShares(category: Row | null | undefined, defaults: CarShares): CarShares {
  const o = category?.owner_share_percent;
  const d = category?.driver_share_percent;
  const p = category?.platform_share_percent;
  if (o != null && d != null && p != null) {
    const own = { owner: Number(o), driver: Number(d), platform: Number(p) };
    if (Object.values(own).every((n) => Number.isInteger(n) && n >= 0) && own.owner + own.driver + own.platform === 100) return own;
  }
  return defaults;
}

/** Splits a settled ride's pool. Owner and driver are rounded down; the platform keeps the remainder so the parts always add up exactly. */
export function splitPool(pool: number, shares: CarShares): { owner: number; driver: number; platform: number } {
  const owner = Math.floor((pool * shares.owner) / 100);
  const driver = Math.floor((pool * shares.driver) / 100);
  return { owner, driver, platform: pool - owner - driver };
}

/** The app's own price: distance × the category's rate, never below its minimum. */
export function quoteFare(category: Row, distanceKm: number | null): number {
  const rate = Number(category.rate_per_km) || 0;
  const minimum = Number(category.minimum_fare) || 0;
  return roundFare(distanceKm != null ? distanceKm * rate : 0, minimum);
}

/**
 * The nearest eligible driver for an auto-assigned car ride: approved driver,
 * online with an approved vehicle of the booked category, actively assigned
 * to it, not already on a job, not one who declined, and within the admin's
 * pickup radius when both locations are known.
 */
export async function findCarCandidate(
  orderId: string,
  order: Row,
): Promise<{ riderId: string; riderName: string; outOfRange: boolean } | null> {
  const booking = (await db.execute({ sql: "SELECT category_id FROM car_bookings WHERE order_id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (!booking) return null;
  const { maxPickupKm } = await getCarSettings();
  const eligible = await db.execute({
    sql: `SELECT u.id, u.name, s.lat, s.lng FROM car_driver_state s
          JOIN users u ON u.id = s.driver_id
          JOIN car_partners p ON p.user_id = s.driver_id AND p.driver_status = 'approved'
          JOIN vehicles v ON v.id = s.vehicle_id AND v.status = 'approved' AND v.category_id = ?
          JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.driver_id = s.driver_id AND a.status = 'active'
          WHERE s.online = 1
          AND u.id NOT IN (SELECT rider_id FROM orders WHERE rider_id IS NOT NULL AND stage NOT IN ('Settle', 'Cancelled') AND environment = ?)
          AND u.id NOT IN (SELECT rider_id FROM order_rider_exclusions WHERE order_id = ?)`,
    args: [String(booking.category_id), String(order.environment), orderId],
  });
  const lat = order.pickup_lat as number | null;
  const lng = order.pickup_lng as number | null;
  let best: { row: Row; km: number | null } | null = null;
  for (const row of eligible.rows as Row[]) {
    const km = lat != null && lng != null && row.lat != null && row.lng != null ? haversineKm(lat, lng, Number(row.lat), Number(row.lng)) : null;
    if (km != null && km > maxPickupKm) continue;
    if (!best || (km != null && (best.km == null || km < best.km))) best = { row, km };
  }
  return best ? { riderId: String(best.row.id), riderName: String(best.row.name), outOfRange: false } : null;
}

/**
 * Pays out a settled car ride. `pool` is what the platform would have paid a
 * boda rider (the escrow released minus fees). It goes to the owner's and
 * driver's wallet balances by the percentages stamped on the booking now;
 * the platform's part stays with Tuma. Runs once — a booking already settled
 * is left alone.
 */
export async function settleCarBooking(order: Row, pool: number, actorId: string): Promise<void> {
  const orderId = String(order.id);
  const booking = (await db.execute({ sql: "SELECT * FROM car_bookings WHERE order_id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (!booking || booking.settled_at) return;

  const category = (await db.execute({ sql: "SELECT * FROM vehicle_categories WHERE id = ?", args: [String(booking.category_id)] })).rows[0] as Row | undefined;
  const shares = resolveShares(category, (await getCarSettings()).shares);
  const parts = splitPool(pool, shares);
  const driverId = String(order.rider_id);
  const assignment = (
    await db.execute({
      sql: `SELECT v.id, v.owner_id FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id
            WHERE a.driver_id = ? AND a.status = 'active' ORDER BY (v.id = ?) DESC LIMIT 1`,
      args: [driverId, String(booking.vehicle_id ?? "")],
    })
  ).rows[0] as Row | undefined;
  const vehicleId = (booking.vehicle_id as string | null) ?? (assignment ? String(assignment.id) : null);
  const ownerId = (booking.owner_id as string | null) ?? (assignment ? String(assignment.owner_id) : null);
  // No owner on record (shouldn't happen): the owner's part goes to the driver rather than being lost.
  const environment = order.environment === "sandbox" ? "sandbox" : "live";
  const ownerAmount = ownerId ? parts.owner : 0;
  const driverAmount = parts.driver + (ownerId ? 0 : parts.owner);

  // Claim the booking first so a retry can never pay twice.
  const claimed = await db.execute({
    sql: `UPDATE car_bookings SET status = 'completed', settled_at = datetime('now'), updated_at = datetime('now'),
            vehicle_id = ?, owner_id = ?, driver_id = ?, share_owner_percent = ?, share_driver_percent = ?, share_platform_percent = ?,
            pool_amount = ?, owner_amount = ?, driver_amount = ?, platform_amount = ?
          WHERE order_id = ? AND settled_at IS NULL`,
    args: [vehicleId, ownerId, driverId, shares.owner, shares.driver, shares.platform, pool, ownerAmount, driverAmount, parts.platform, orderId],
  });
  if (claimed.rowsAffected === 0) return;

  if (driverAmount > 0) await creditWallet(driverId, driverAmount, { type: "adjustment", environment, orderId, actorId, note: "Tuma Car ride — driver share" });
  if (ownerId && ownerAmount > 0) await creditWallet(ownerId, ownerAmount, { type: "adjustment", environment, orderId, actorId, note: "Tuma Car ride — owner share" });
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Settle', ?, ?)",
    args: [
      newId("evt"),
      orderId,
      `Car ride split — owner ${ownerAmount.toLocaleString("en-UG")}, driver ${driverAmount.toLocaleString("en-UG")}, platform ${parts.platform.toLocaleString("en-UG")} (UGX)`,
      actorId,
    ],
  });
}

/** Records which vehicle and owner a car ride was given to, the moment a driver is assigned — so the owner sees it live. */
export async function stampCarBooking(orderId: string, driverId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE car_bookings SET
            vehicle_id = (SELECT s.vehicle_id FROM car_driver_state s WHERE s.driver_id = ?),
            owner_id = (SELECT v.owner_id FROM car_driver_state s JOIN vehicles v ON v.id = s.vehicle_id WHERE s.driver_id = ?),
            driver_id = ?, updated_at = datetime('now')
          WHERE order_id = ?`,
    args: [driverId, driverId, driverId, orderId],
  });
}
