import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db, executeBatch } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment } from "../lib/settings.js";
import { createOrderFromInput } from "../orders/routes.js";
import { toDbTime } from "./scheduled.js";

type Row = Record<string, unknown>;

/** Carpool: a driver publishes a trip, passengers book seats. Closed until an admin switches it on. */
export const carpoolRoutes = new Hono();
carpoolRoutes.use("/car/carpool/*", requireAuth);
carpoolRoutes.use("/car/carpool/*", async (c, next) => {
  if (!(await hasTable("car_bookings")) || !(await hasTable("carpool_trips"))) return c.json({ error: "carpool_unavailable", message: "Carpool isn't ready yet." }, 503);
  const settings = await getCarSettings();
  if (!settings.enabled || !settings.carpool.enabled) return c.json({ error: "carpool_disabled", message: "Carpool isn't available right now." }, 403);
  await next();
});

const fromDb = (ts: string) => new Date(`${ts.replace(" ", "T")}Z`);

const DEMO_ROUTES = [
  { from: ["Entebbe City", 0.0612, 32.4637], to: ["Kampala", 0.3136, 32.5811], price: 15_000, driver: 1 },
  { from: ["Kampala", 0.3136, 32.5811], to: ["Entebbe City", 0.0612, 32.4637], price: 15_000, driver: 2 },
  { from: ["Kampala", 0.3136, 32.5811], to: ["Mukono", 0.3533, 32.7553], price: 10_000, driver: 4 },
  { from: ["Kampala", 0.3136, 32.5811], to: ["Jinja", 0.4244, 33.2042], price: 25_000, driver: 3 },
] as const;

const DEMO_NEARBY_DESTINATIONS = [
  { label: "City centre", lat: 0.05, lng: 0.02, price: 6_000, driver: 1 },
  { label: "Market district", lat: -0.04, lng: 0.06, price: 7_000, driver: 2 },
  { label: "Transit hub", lat: 0.07, lng: -0.03, price: 8_000, driver: 3 },
  { label: "Neighbouring town", lat: -0.06, lng: -0.06, price: 9_000, driver: 4 },
] as const;

const demoCoordinatePart = (value: number) => {
  const scaled = Math.round(value * 100);
  return `${scaled < 0 ? "n" : "p"}${String(Math.abs(scaled)).padStart(4, "0")}`;
};

/** Refresh shared, bookable sandbox trips without ever creating live listings. */
async function ensureDemoTrips(date: string | undefined, cutoffMinutes: number, near?: { lat: number; lng: number }): Promise<void> {
  const ready = (await db.execute({ sql: "SELECT 1 FROM vehicles WHERE id = 'demo-rideshare-car-1' LIMIT 1", args: [] })).rows.length > 0;
  if (!ready) return; // Migration 0088 can land after the code.
  const today = new Date().toISOString().slice(0, 10);
  const days = date ? [date] : [today, new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)];
  const existing = new Set((await db.execute({
    sql: "SELECT id FROM carpool_trips WHERE id LIKE 'demo-rideshare-%' AND depart_at >= ? AND depart_at < ?",
    args: [`${days[0]} 00:00:00`, `${new Date(Date.parse(`${days[days.length - 1]}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)} 00:00:00`],
  })).rows.map((row) => String(row.id)));
  const statements = [];
  for (const day of days) {
    const dayTime = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(dayTime) || dayTime < Date.now() - 86_400_000 || dayTime > Date.now() + 14 * 86_400_000) continue;
    for (const route of DEMO_ROUTES) for (const hour of [6, 9, 13, 16]) {
      const departure = new Date(dayTime + hour * 3_600_000);
      if (departure.getTime() <= Date.now() + cutoffMinutes * 60_000) continue;
      const n = route.driver;
      const id = `demo-rideshare-${day}-${n}-${hour}`;
      if (existing.has(id)) continue;
      statements.push({
        sql: `INSERT OR IGNORE INTO carpool_trips
          (id, driver_id, vehicle_id, category_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, distance_km, depart_at, seats_total, seat_price, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, 'sandbox')`,
        args: [id, `demo-rideshare-driver-${n}`, `demo-rideshare-car-${n}`, n === 3 ? "peebee-car-large" : "peebee-car-normal",
          route.from[0], route.from[1], route.from[2], route.to[0], route.to[1], route.to[2],
          haversineKm(route.from[1], route.from[2], route.to[1], route.to[2]), toDbTime(departure), route.price],
      });
    }
    if (near) {
      const originLat = Math.round(near.lat * 100) / 100;
      const originLng = Math.round(near.lng * 100) / 100;
      const locationKey = `${demoCoordinatePart(near.lat)}-${demoCoordinatePart(near.lng)}`;
      for (const [index, route] of DEMO_NEARBY_DESTINATIONS.entries()) for (const hour of [6, 9, 13, 16]) {
        const departure = new Date(dayTime + hour * 3_600_000);
        if (departure.getTime() <= Date.now() + cutoffMinutes * 60_000) continue;
        const id = `demo-rideshare-near-${day}-${locationKey}-${index}-${hour}`;
        if (existing.has(id)) continue;
        const destLat = originLat + route.lat;
        const destLng = originLng + route.lng;
        statements.push({
          sql: `INSERT OR IGNORE INTO carpool_trips
            (id, driver_id, vehicle_id, category_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, distance_km, depart_at, seats_total, seat_price, environment)
            VALUES (?, ?, ?, ?, 'Nearby area', ?, ?, ?, ?, ?, ?, ?, 3, ?, 'sandbox')`,
          args: [id, `demo-rideshare-driver-${route.driver}`, `demo-rideshare-car-${route.driver}`, route.driver === 3 ? "peebee-car-large" : "peebee-car-normal",
            originLat, originLng, route.label, destLat, destLng, haversineKm(originLat, originLng, destLat, destLng), toDbTime(departure), route.price],
        });
      }
    }
  }
  if (statements.length) await executeBatch(statements);
}

/**
 * Gives back seats held by bookings that were cancelled, or never paid in
 * time. Run before listing and from the scheduled sweep, so seat counts stay
 * right without touching the order cancellation code.
 */
export async function releaseStaleSeats(): Promise<number> {
  if (!(await hasTable("carpool_trips"))) return 0;
  const { carpool } = await getCarSettings();
  // Unpaid and past the pay window: cancel the order (nothing was collected).
  const unpaid = await db.execute({
    sql: `SELECT cs.order_id FROM carpool_seats cs JOIN orders o ON o.id = cs.order_id
          WHERE cs.status = 'booked' AND o.stage = 'Match' AND cs.created_at <= datetime('now', ?)
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)`,
    args: [`-${carpool.payWithinMinutes} minutes`],
  });
  for (const row of unpaid.rows as Row[]) {
    const cancelled = await db.execute({ sql: "UPDATE orders SET stage = 'Cancelled', updated_at = datetime('now') WHERE id = ? AND stage = 'Match'", args: [String(row.order_id)] });
    if (cancelled.rowsAffected > 0) {
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note) VALUES (?, ?, 'Cancelled', 'Seat released: not paid in time')",
        args: [newId("evt"), String(row.order_id)],
      });
    }
  }
  const stale = await db.execute({
    sql: `SELECT cs.id, cs.trip_id, cs.seats FROM carpool_seats cs JOIN orders o ON o.id = cs.order_id
          WHERE cs.status = 'booked' AND o.stage = 'Cancelled'`,
    args: [],
  });
  let released = 0;
  for (const row of stale.rows as Row[]) {
    // Only the request that flips booked -> cancelled returns the seats.
    const flipped = await db.execute({ sql: "UPDATE carpool_seats SET status = 'cancelled' WHERE id = ? AND status = 'booked'", args: [String(row.id)] });
    if (flipped.rowsAffected === 0) continue;
    await db.execute({
      sql: `UPDATE carpool_trips SET seats_taken = MAX(0, seats_taken - ?), status = CASE WHEN status = 'full' THEN 'open' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
      args: [Number(row.seats), String(row.trip_id)],
    });
    released += Number(row.seats);
  }
  return released;
}

// ---- Driver: publish and manage trips ---------------------------------------

const placeSchema = { label: z.string().trim().min(2).max(160), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };
const publishSchema = z.object({
  originLabel: placeSchema.label,
  originLat: placeSchema.lat,
  originLng: placeSchema.lng,
  destLabel: placeSchema.label,
  destLat: placeSchema.lat,
  destLng: placeSchema.lng,
  departAt: z.string().max(40),
  seats: z.number().int().min(1).max(60),
  seatPrice: z.number().int().min(1).max(10_000_000),
  repeatWeeks: z.number().int().min(0).max(52).optional(),
});

carpoolRoutes.post("/car/carpool/trips", async (c) => {
  const user = c.get("user");
  const parsed = publishSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const { carpool } = await getCarSettings();

  const car = (
    await db.execute({
      sql: `SELECT v.id AS vehicle_id, v.category_id, cat.kind, cat.seats FROM car_driver_state s
            JOIN car_partners p ON p.user_id = s.driver_id AND p.driver_status = 'approved'
            JOIN vehicles v ON v.id = s.vehicle_id AND v.status = 'approved'
            JOIN vehicle_categories cat ON cat.id = v.category_id
            JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.driver_id = s.driver_id AND a.status = 'active'
            WHERE s.driver_id = ?`,
      args: [user.sub],
    })
  ).rows[0] as Row | undefined;
  if (!car) return c.json({ error: "no_vehicle", message: "You need an approved driver account with an assigned vehicle." }, 409);
  if (car.kind !== "passenger") return c.json({ error: "not_a_passenger_vehicle", message: "Carpool needs a passenger car." }, 409);
  // The driver takes a seat: never offer more than the car holds minus one when its size is known.
  const maxSeats = car.seats != null ? Math.max(1, Number(car.seats) - 1) : 60;
  if (d.seats > maxSeats) return c.json({ error: "too_many_seats", message: `This vehicle can offer up to ${maxSeats} seats.` }, 400);

  const first = new Date(d.departAt);
  if (Number.isNaN(first.getTime())) return c.json({ error: "invalid_time", message: "That departure time isn't valid." }, 400);
  if (first.getTime() < Date.now() + carpool.cutoffMinutes * 60000) return c.json({ error: "invalid_time", message: "Pick a departure time further ahead." }, 400);
  const repeat = d.repeatWeeks ?? 0;
  if (repeat > carpool.maxRepeatWeeks) return c.json({ error: "repeat_not_allowed", message: carpool.maxRepeatWeeks === 0 ? "Repeating trips isn't available." : `You can repeat a trip for up to ${carpool.maxRepeatWeeks} weeks.` }, 400);

  const distanceKm = haversineKm(d.originLat, d.originLng, d.destLat, d.destLng);
  const environment = await getPlatformEnvironment();

  const ids: string[] = [];
  for (let week = 0; week <= repeat; week += 1) {
    const id = newId("cpt");
    ids.push(id);
    await db.execute({
      sql: `INSERT INTO carpool_trips (id, driver_id, vehicle_id, category_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng,
              distance_km, depart_at, seats_total, seat_price, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, user.sub, String(car.vehicle_id), String(car.category_id), d.originLabel, d.originLat, d.originLng, d.destLabel, d.destLat, d.destLng,
        distanceKm, toDbTime(new Date(first.getTime() + week * 7 * 86400000)), d.seats, d.seatPrice, environment],
    });
  }
  return c.json({ ids }, 201);
});

/** The driver's upcoming trips with who booked each. */
carpoolRoutes.get("/car/carpool/my-trips", async (c) => {
  const user = c.get("user");
  await releaseStaleSeats();
  const trips = (await db.execute({
    sql: `SELECT * FROM carpool_trips WHERE driver_id = ? AND (status IN ('open', 'full', 'departed') OR depart_at >= datetime('now', '-2 days')) ORDER BY depart_at ASC LIMIT 60`,
    args: [user.sub],
  })).rows as Row[];
  const out = [];
  for (const t of trips) {
    const seats = (await db.execute({
      sql: `SELECT cs.order_id, cs.seats, cs.amount, u.name, o.stage, o.pickup_lat, o.pickup_lng, o.destination_lat, o.destination_lng,
                   o.pickup_address, o.destination_address, o.estimated_total
            FROM carpool_seats cs JOIN users u ON u.id = cs.passenger_id JOIN orders o ON o.id = cs.order_id
            WHERE cs.trip_id = ? AND cs.status = 'booked'`,
      args: [String(t.id)],
    })).rows;
    out.push({ ...t, depart_at: fromDb(String(t.depart_at)).toISOString(), passengers: seats });
  }
  return c.json({ trips: out });
});

carpoolRoutes.post("/car/carpool/trips/:id/status", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ status: z.enum(["departed", "completed", "cancelled"]) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const trip = (await db.execute({ sql: "SELECT * FROM carpool_trips WHERE id = ? AND driver_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined;
  if (!trip) return c.json({ error: "not_found" }, 404);
  const next = parsed.data.status;
  const allowed: Record<string, string[]> = { open: ["departed", "cancelled"], full: ["departed", "cancelled"], departed: ["completed"] };
  if (!(allowed[String(trip.status)] ?? []).includes(next)) return c.json({ error: "invalid_status", message: `A ${trip.status} trip can't be marked ${next}.` }, 409);
  if (next === "cancelled" && Number(trip.seats_taken) > 0) {
    return c.json({ error: "has_passengers", message: "Passengers have booked this trip — please contact Peebee support to cancel it." }, 409);
  }
  await db.execute({ sql: "UPDATE carpool_trips SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [next, id] });
  return c.json({ ok: true });
});

// ---- Passenger: search and book ---------------------------------------------------

carpoolRoutes.get("/car/carpool/trips", async (c) => {
  const q = z.object({
    nearLat: z.coerce.number().min(-90).max(90).optional(),
    nearLng: z.coerce.number().min(-180).max(180).optional(),
    nearLabel: z.string().trim().max(120).optional(),
    fromLat: z.coerce.number().min(-90).max(90).optional(),
    fromLng: z.coerce.number().min(-180).max(180).optional(),
    toLat: z.coerce.number().min(-90).max(90).optional(),
    toLng: z.coerce.number().min(-180).max(180).optional(),
    date: z.string().max(10).optional(),
  }).refine((data) => (data.nearLat === undefined) === (data.nearLng === undefined), { path: ["nearLat"] })
    .refine((data) => (data.fromLat === undefined) === (data.fromLng === undefined), { path: ["fromLat"] })
    .refine((data) => (data.toLat === undefined) === (data.toLng === undefined), { path: ["toLat"] })
    .refine((data) => data.nearLat !== undefined || (data.fromLat !== undefined && data.toLat !== undefined), { path: ["nearLat"] })
    .refine((data) => data.nearLat !== undefined || (data.fromLat !== undefined && data.fromLng !== undefined && data.toLat !== undefined && data.toLng !== undefined), { path: ["fromLat"] })
    .safeParse(c.req.query());
  if (!q.success) return c.json({ error: "invalid_query" }, 400);
  const { carpool } = await getCarSettings();
  await releaseStaleSeats();
  const environment = await getPlatformEnvironment();
  if (q.data.date && (!/^\d{4}-\d{2}-\d{2}$/.test(q.data.date) || !Number.isFinite(Date.parse(`${q.data.date}T00:00:00Z`)))) return c.json({ error: "invalid_date" }, 400);
  const nearbySearch = q.data.nearLat !== undefined && q.data.nearLng !== undefined;
  if (environment === "sandbox") await ensureDemoTrips(q.data.date, carpool.cutoffMinutes, nearbySearch ? { lat: q.data.nearLat!, lng: q.data.nearLng! } : undefined);

  // A day (UTC) when asked, otherwise everything upcoming.
  const from = q.data.date ? `${q.data.date} 00:00:00` : toDbTime(new Date(Date.now() + carpool.cutoffMinutes * 60000));
  const to = q.data.date ? `${q.data.date} 23:59:59` : "9999-12-31 00:00:00";
  const rows = (await db.execute({
    sql: `SELECT t.*, u.name AS driver_name, v.make, v.model, v.colour, cat.name AS category_name
          FROM carpool_trips t JOIN users u ON u.id = t.driver_id JOIN vehicles v ON v.id = t.vehicle_id JOIN vehicle_categories cat ON cat.id = t.category_id
          WHERE t.status = 'open' AND t.seats_taken < t.seats_total AND t.environment = ?
            AND t.depart_at >= datetime('now', ?) AND t.depart_at >= ? AND t.depart_at <= ?
          ORDER BY t.depart_at ASC LIMIT 300`,
    args: [environment, `+${carpool.cutoffMinutes} minutes`, from, to],
  })).rows as Row[];
  const trips = rows
    .filter((t) => {
      const nearOrigin = nearbySearch
        ? haversineKm(q.data.nearLat!, q.data.nearLng!, Number(t.origin_lat), Number(t.origin_lng)) <= carpool.matchRadiusKm
        : haversineKm(q.data.fromLat!, q.data.fromLng!, Number(t.origin_lat), Number(t.origin_lng)) <= carpool.matchRadiusKm;
      const nearDestination = q.data.toLat === undefined || q.data.toLng === undefined ||
        haversineKm(q.data.toLat, q.data.toLng, Number(t.dest_lat), Number(t.dest_lng)) <= carpool.matchRadiusKm;
      return nearOrigin && nearDestination;
    })
    .map((t) => ({
      id: t.id,
      driverName: String(t.driver_name).replace(/\s*\(Demo\)$/i, ""),
      vehicle: [t.colour, t.make, t.model].filter(Boolean).join(" ") || t.category_name,
      originLabel: String(t.id).startsWith("demo-rideshare-near-") && q.data.nearLabel ? `Near ${q.data.nearLabel.replace(/[\u0000-\u001f]/g, " ").slice(0, 100)}` : t.origin_label,
      destLabel: t.dest_label,
      departAt: fromDb(String(t.depart_at)).toISOString(),
      seatsLeft: Number(t.seats_total) - Number(t.seats_taken),
      seatPrice: Number(t.seat_price),
    }));
  return c.json({ trips, maxSeatsPerBooking: carpool.maxSeatsPerBooking });
});

carpoolRoutes.post("/car/carpool/trips/:id/seats", async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsed = z.object({ seats: z.number().int().min(1).max(20) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { seats } = parsed.data;
  const { carpool } = await getCarSettings();
  if (seats > carpool.maxSeatsPerBooking) return c.json({ error: "too_many_seats", message: `You can book up to ${carpool.maxSeatsPerBooking} seats at a time.` }, 400);

  const trip = (await db.execute({ sql: "SELECT * FROM carpool_trips WHERE id = ?", args: [id] })).rows[0] as Row | undefined;
  if (!trip) return c.json({ error: "not_found" }, 404);
  if (trip.environment !== await getPlatformEnvironment()) return c.json({ error: "not_available" }, 404);
  if (trip.driver_id === user.sub) return c.json({ error: "own_trip", message: "You can't book a seat on your own trip." }, 409);

  // Race-safe: only one request can take the last seats, and only before the cut-off.
  const taken = await db.execute({
    sql: `UPDATE carpool_trips SET seats_taken = seats_taken + ?, status = CASE WHEN seats_taken + ? >= seats_total THEN 'full' ELSE status END, updated_at = datetime('now')
          WHERE id = ? AND status = 'open' AND seats_taken + ? <= seats_total AND depart_at > datetime('now', ?)`,
    args: [seats, seats, id, seats, `+${carpool.cutoffMinutes} minutes`],
  });
  if (taken.rowsAffected === 0) return c.json({ error: "not_available", message: "Those seats aren't available any more." }, 409);
  const release = () =>
    db.execute({ sql: "UPDATE carpool_trips SET seats_taken = MAX(0, seats_taken - ?), status = CASE WHEN status = 'full' THEN 'open' ELSE status END, updated_at = datetime('now') WHERE id = ?", args: [seats, id] });

  const environment = trip.environment === "sandbox" ? "sandbox" : "live";
  const amount = Number(trip.seat_price) * seats;
  const vehicle = (await db.execute({ sql: "SELECT owner_id FROM vehicles WHERE id = ?", args: [String(trip.vehicle_id)] })).rows[0] as Row | undefined;
  const listId = newId("list");
  try {
    await db.execute({
      sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'draft', ?)",
      args: [listId, user.sub, `Carpool: ${String(trip.origin_label)} → ${String(trip.dest_label)}`, environment],
    });
    const response = await createOrderFromInput(
      c,
      {
        listId,
        type: "parcel",
        isRide: true,
        pickupAddress: String(trip.origin_label),
        pickupLat: Number(trip.origin_lat),
        pickupLng: Number(trip.origin_lng),
        destinationAddress: String(trip.dest_label),
        destinationLat: Number(trip.dest_lat),
        destinationLng: Number(trip.dest_lng),
        paymentRail: "escrow",
      },
      { fare: amount, matchingMode: "first_to_claim" },
    );
    if (response.status >= 400) {
      await release();
      return response;
    }
    const order = ((await response.clone().json()) as { order: Row }).order;
    const orderId = String(order.id);
    await db.execute({
      sql: `INSERT INTO car_bookings (id, order_id, customer_id, category_id, vehicle_id, owner_id, driver_id, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId("cbk"), orderId, user.sub, String(trip.category_id), String(trip.vehicle_id), (vehicle?.owner_id as string | undefined) ?? null, String(trip.driver_id), environment],
    });
    await db.execute({
      sql: "INSERT INTO carpool_seats (id, trip_id, order_id, passenger_id, seats, amount) VALUES (?, ?, ?, ?, ?, ?)",
      args: [newId("cps"), id, orderId, user.sub, seats, amount],
    });
    // The seat belongs to this trip's driver from the start; the passenger pays next.
    await db.execute({ sql: "UPDATE orders SET rider_id = ?, stage = 'Match', updated_at = datetime('now') WHERE id = ? AND rider_id IS NULL", args: [String(trip.driver_id), orderId] });
    await db.execute({
      sql: "UPDATE chat_messages SET rider_id = ? WHERE order_id = ? AND rider_id IS NULL",
      args: [String(trip.driver_id), orderId],
    });
    await db.execute({
      sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Match', ?, ?)",
      args: [newId("evt"), orderId, `Booked ${seats} seat${seats === 1 ? "" : "s"} on a carpool trip`, user.sub],
    });
    return c.json({ order: { ...order, rider_id: trip.driver_id, stage: "Match" } }, 201);
  } catch (err) {
    await release();
    console.error("Carpool booking failed:", err);
    return c.json({ error: "booking_failed", message: "Couldn't book those seats. Please try again." }, 500);
  }
});
