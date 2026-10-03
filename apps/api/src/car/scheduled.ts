import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, type CarScheduledSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";

type Row = Record<string, unknown>;

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC), the format every timestamp here uses. */
export function toDbTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function fromDbTime(ts: string): Date {
  return new Date(`${ts.replace(" ", "T")}Z`);
}

/** Scheduled rides can only be used when the admin set a window and the columns exist. */
export async function scheduledAvailable(s: CarScheduledSettings): Promise<boolean> {
  return s.enabled && s.maxAdvanceHours != null && (await hasTable("car_bookings")) && (await hasColumn("car_bookings", "scheduled_for"));
}

/**
 * SQL that hides a scheduled ride from drivers until it opens (shortly before
 * pickup), for queries over `orders o`. Empty when scheduling isn't set up.
 */
export async function openForDriversSql(openMinutes: number): Promise<string> {
  if (!(await hasTable("car_bookings")) || !(await hasColumn("car_bookings", "scheduled_for"))) return "";
  return `AND NOT EXISTS (SELECT 1 FROM car_bookings sb WHERE sb.order_id = o.id AND sb.scheduled_for IS NOT NULL AND sb.scheduled_for > datetime('now', '+${Math.floor(openMinutes)} minutes'))`;
}

/** Validates a requested pickup time against the admin's window. Returns the DB-format time or an error. */
export function validateScheduledFor(iso: string, s: CarScheduledSettings, now = new Date()): { at: string } | { error: string } {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { error: "That pickup time isn't valid." };
  const lead = (when.getTime() - now.getTime()) / 60000;
  if (lead < s.minLeadMinutes) return { error: `Please book at least ${s.minLeadMinutes} minutes ahead.` };
  if (s.maxAdvanceHours != null && lead > s.maxAdvanceHours * 60) return { error: `Rides can be booked up to ${s.maxAdvanceHours} hours ahead.` };
  return { at: toDbTime(when) };
}

/** Straight-line judgement: can the driver reach the pickup in time at the average speed? */
export function judgeDriver(input: { distanceKm: number | null; minutesToPickup: number; avgSpeedKmh: number; lastPingAgeMinutes: number | null; noSignalMinutes: number }): {
  verdict: "on_track" | "late_risk" | "no_signal";
  etaMinutes: number | null;
} {
  if (input.distanceKm == null || input.lastPingAgeMinutes == null || input.lastPingAgeMinutes > input.noSignalMinutes) return { verdict: "no_signal", etaMinutes: null };
  const eta = (input.distanceKm / input.avgSpeedKmh) * 60;
  return { verdict: eta > Math.max(0, input.minutesToPickup) + 5 ? "late_risk" : "on_track", etaMinutes: Math.round(eta * 10) / 10 };
}

/**
 * Every couple of minutes: for assigned scheduled car rides inside the watch
 * window that haven't started yet, check where the driver is. If they look
 * late (or went silent) tell the customer once, so they can re-match. Opening
 * the job to drivers needs no sweep — it's a filter on when they can see it.
 * Straight-line distance only: there's no routing/ETA provider in the app.
 */
export async function sweepScheduledRides(): Promise<{ checked: number; warned: number; opened: number }> {
  const settings = await getCarSettings();
  if (!(await scheduledAvailable(settings.scheduled))) return { checked: 0, warned: 0, opened: 0 };
  const s = settings.scheduled;
  const hasChecks = await hasTable("scheduled_checks");
  let warned = 0;
  let opened = 0;

  // Customers hear when their ride opens to drivers (once).
  const toOpen = await db.execute({
    sql: `SELECT b.order_id, b.customer_id FROM car_bookings b JOIN orders o ON o.id = b.order_id
          WHERE b.scheduled_for IS NOT NULL AND b.scheduled_opened_at IS NULL AND b.status = 'requested'
            AND b.scheduled_for <= datetime('now', ?) AND o.stage IN ('Create', 'Match') AND o.rider_id IS NULL`,
    args: [`+${s.openMinutes} minutes`],
  }).catch(() => ({ rows: [] as Row[] }));
  for (const row of toOpen.rows as Row[]) {
    const claimed = await db.execute({ sql: "UPDATE car_bookings SET scheduled_opened_at = datetime('now') WHERE order_id = ? AND scheduled_opened_at IS NULL", args: [String(row.order_id)] });
    if (claimed.rowsAffected > 0) {
      opened += 1;
      notifyUser(String(row.customer_id), {
        title: "Your scheduled ride is open to drivers",
        body: "Drivers can now apply. Pick one when they do.",
        url: `/orders/${row.order_id}`,
        tag: `sched-open-${row.order_id}`,
      }).catch(() => {});
    }
  }

  const due = await db.execute({
    sql: `SELECT b.order_id, b.customer_id, b.driver_id, b.scheduled_for, b.scheduled_notified_at, o.pickup_lat, o.pickup_lng
          FROM car_bookings b JOIN orders o ON o.id = b.order_id
          WHERE b.scheduled_for IS NOT NULL AND b.status = 'requested' AND o.rider_id IS NOT NULL
            AND o.stage IN ('Match', 'Shop', 'Substitute', 'Approve')
            AND b.scheduled_for <= datetime('now', ?)
          LIMIT 200`,
    args: [`+${s.watchMinutes} minutes`],
  });
  let checked = 0;
  for (const row of due.rows as Row[]) {
    checked += 1;
    const state = (await db.execute({ sql: "SELECT lat, lng, updated_at FROM car_driver_state WHERE driver_id = ?", args: [String(row.driver_id)] })).rows[0] as Row | undefined;
    const now = Date.now();
    const minutesToPickup = (fromDbTime(String(row.scheduled_for)).getTime() - now) / 60000;
    const distanceKm =
      state?.lat != null && state?.lng != null && row.pickup_lat != null && row.pickup_lng != null
        ? haversineKm(Number(row.pickup_lat), Number(row.pickup_lng), Number(state.lat), Number(state.lng))
        : null;
    const ageMinutes = state?.updated_at ? (now - fromDbTime(String(state.updated_at)).getTime()) / 60000 : null;
    const { verdict, etaMinutes } = judgeDriver({ distanceKm, minutesToPickup, avgSpeedKmh: s.avgSpeedKmh, lastPingAgeMinutes: ageMinutes, noSignalMinutes: s.noSignalMinutes });

    if (hasChecks) {
      const last = (await db.execute({ sql: "SELECT verdict FROM scheduled_checks WHERE order_id = ? ORDER BY checked_at DESC LIMIT 1", args: [String(row.order_id)] })).rows[0] as Row | undefined;
      if (last?.verdict !== verdict) {
        await db.execute({
          sql: `INSERT INTO scheduled_checks (id, order_id, driver_lat, driver_lng, distance_to_pickup_km, eta_minutes, minutes_to_pickup, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [newId("sck"), String(row.order_id), (state?.lat as number | null) ?? null, (state?.lng as number | null) ?? null, distanceKm, etaMinutes, Math.round(minutesToPickup * 10) / 10, verdict],
        });
      }
    }
    if (verdict !== "on_track" && !row.scheduled_notified_at) {
      const claimed = await db.execute({ sql: "UPDATE car_bookings SET scheduled_notified_at = datetime('now') WHERE order_id = ? AND scheduled_notified_at IS NULL", args: [String(row.order_id)] });
      if (claimed.rowsAffected > 0) {
        warned += 1;
        notifyUser(String(row.customer_id), {
          title: "Your driver may be late",
          body: verdict === "no_signal" ? "We can't see your driver's location. You can keep them or choose another driver." : "Your driver may not make it in time. You can keep them or choose another driver.",
          url: `/orders/${row.order_id}`,
          tag: `sched-late-${row.order_id}`,
        }).catch(() => {});
      }
    }
  }
  return { checked, warned, opened };
}
