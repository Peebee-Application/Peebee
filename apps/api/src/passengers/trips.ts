import { Hono } from "hono";
import type { SharedTrip } from "@peebee/shared";
import { db } from "../db/client.js";
import { hasColumn } from "../lib/schema.js";

/**
 * The passenger's trip page, for a ride someone booked for them. Public: the
 * unguessable token in the link is the only credential, so this returns just
 * what the passenger needs — the driver's first name, where they're going,
 * live progress — and never the booker's
 * details, price or payment.
 */
export const tripRoutes = new Hono();

tripRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (token.length < 24 || !(await hasColumn("orders", "share_token"))) return c.json({ error: "not_found" }, 404);
  const res = await db.execute({
    sql: `SELECT o.stage, o.passenger_name, o.pickup_area, o.pickup_address, o.pickup_lat, o.pickup_lng,
                 o.destination_area, o.destination_address, o.rider_lat, o.rider_lng, o.rider_location_updated_at,
                 o.eta_minutes, r.name AS rider_name
          FROM orders o LEFT JOIN users r ON r.id = o.rider_id
          WHERE o.share_token = ?`,
    args: [token],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);

  // A live pin is only trustworthy while it's fresh; a frozen one reads as offline.
  const reported = row.rider_location_updated_at ? Date.parse(`${String(row.rider_location_updated_at).replace(" ", "T")}Z`) : NaN;
  const fresh = Number.isFinite(reported) && Date.now() - reported < 2 * 60_000;
  const trip: SharedTrip = {
    stage: String(row.stage),
    passengerName: (row.passenger_name as string | null) ?? null,
    driverName: row.rider_name ? String(row.rider_name).trim().split(/\s+/)[0] : null,
    pickupArea: (row.pickup_area as string | null) ?? null,
    pickupAddress: (row.pickup_address as string | null) ?? null,
    destinationArea: (row.destination_area as string | null) ?? null,
    destinationAddress: (row.destination_address as string | null) ?? null,
    pickupLat: (row.pickup_lat as number | null) ?? null,
    pickupLng: (row.pickup_lng as number | null) ?? null,
    riderLat: fresh ? ((row.rider_lat as number | null) ?? null) : null,
    riderLng: fresh ? ((row.rider_lng as number | null) ?? null) : null,
    etaMinutes: (row.eta_minutes as number | null) ?? null,
  };
  c.header("Cache-Control", "no-store");
  return c.json({ trip });
});
