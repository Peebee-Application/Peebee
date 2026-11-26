import { signToken } from "../auth/jwt.js";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getCarSettings, getPlatformEnvironment } from "../lib/settings.js";
import { standardCategoryOnly } from "./tiers.js";

/**
 * Sandbox car demo. With no real drivers online, a sandbox Car ride would never
 * find anyone. Demo drivers (a small fleet of saloons and minivans, Convenient
 * and Comfort) wait a few hundred metres from whichever pickup a tester asks
 * about, take the ride the way the matcher would, and play every driver step
 * (set off, arrive, pick up, settle) after the admin's step delay. They go
 * through the same matching and order routes real drivers use. The passenger
 * still confirms the trip with their PIN.
 *
 * Kept out of live: every demo action needs the platform in sandbox, the demo
 * accounts can't sign in, and demo drivers are only moved when they are free.
 */

type Row = Record<string, unknown>;

const DEMO_PASSWORD = "sandbox-demo-car-account-disabled";
const DEMO_OWNER_ID = "demo-car-owner";
const DEMO_PREFIX = "demo-car-driver-";

type DemoDriver = { id: string; name: string; make: string; model: string; plate: string; size: "normal" | "large"; tier: "convenient" | "comfort"; north: number; east: number };
/** Offsets are in km from the pickup, so a few drivers are always close and none is on top of another. */
const DEMO_DRIVERS: readonly DemoDriver[] = [
  { id: `${DEMO_PREFIX}01`, name: "Demo driver Kato", make: "Toyota", model: "Corolla", plate: "SBX 001D", size: "normal", tier: "convenient", north: 0.4, east: 0.3 },
  { id: `${DEMO_PREFIX}02`, name: "Demo driver Namusoke", make: "Honda", model: "Civic", plate: "SBX 002D", size: "normal", tier: "comfort", north: -0.5, east: 0.4 },
  { id: `${DEMO_PREFIX}03`, name: "Demo driver Okello", make: "Toyota", model: "Noah", plate: "SBX 003D", size: "large", tier: "convenient", north: 0.7, east: -0.5 },
  { id: `${DEMO_PREFIX}04`, name: "Demo driver Nankya", make: "Toyota", model: "Voxy", plate: "SBX 004D", size: "large", tier: "comfort", north: -0.6, east: -0.7 },
  { id: `${DEMO_PREFIX}05`, name: "Demo driver Ssemanda", make: "Nissan", model: "Sylphy", plate: "SBX 005D", size: "normal", tier: "convenient", north: 0.9, east: 0.8 },
  { id: `${DEMO_PREFIX}06`, name: "Demo driver Akello", make: "Mazda", model: "Axela", plate: "SBX 006D", size: "normal", tier: "comfort", north: -1.0, east: -0.2 },
  { id: `${DEMO_PREFIX}07`, name: "Demo driver Mugisha", make: "Nissan", model: "Serena", plate: "SBX 007D", size: "large", tier: "convenient", north: 0.2, east: 1.1 },
  { id: `${DEMO_PREFIX}08`, name: "Demo driver Atim", make: "Toyota", model: "Noah", plate: "SBX 008D", size: "large", tier: "comfort", north: -0.3, east: -1.2 },
];

export const isDemoCarDriver = (id: unknown) => typeof id === "string" && id.startsWith(DEMO_PREFIX);

/** True when the demo is on and the platform is in sandbox. */
export async function sandboxCarDemoOn(): Promise<boolean> {
  if ((await getPlatformEnvironment()) !== "sandbox") return false;
  return (await getCarSettings()).sandboxDemo !== false;
}

async function tablesReady(): Promise<boolean> {
  return (await hasTable("car_partners")) && (await hasColumn("vehicles", "accepts_convenient")) && (await hasColumn("vehicles", "seat_capacity")) && (await hasColumn("vehicles", "service_class"));
}

async function ensureUser(id: string, name: string) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, ?, 'customer')",
    args: [id, id, name, DEMO_PASSWORD],
  });
}

let fleetReady = false;
/** The demo owner, drivers, vehicles and assignments. Needs a standard passenger category of each size to exist. */
async function ensureFleet(): Promise<boolean> {
  if (fleetReady) return true;
  const standardOnly = await standardCategoryOnly("cat");
  const categories = (await db.execute(`SELECT id, seats FROM vehicle_categories cat WHERE cat.active = 1 AND cat.kind = 'passenger'${standardOnly} ORDER BY cat.sort ASC`)).rows as Row[];
  const small = categories.find((c) => Number(c.seats) < 5);
  const large = categories.find((c) => Number(c.seats) >= 5);
  if (!small || !large) return false;

  await ensureUser(DEMO_OWNER_ID, "Demo car owner");
  await db.execute({
    sql: "INSERT OR IGNORE INTO car_partners (user_id, owner_status, driver_status) VALUES (?, 'approved', 'none')",
    args: [DEMO_OWNER_ID],
  });
  for (const d of DEMO_DRIVERS) {
    await ensureUser(d.id, d.name);
    await db.execute({
      sql: "INSERT OR IGNORE INTO car_partners (user_id, owner_status, driver_status) VALUES (?, 'none', 'approved')",
      args: [d.id],
    });
    const vehicleId = `demo-car-vehicle-${d.id.slice(DEMO_PREFIX.length)}`;
    await db.execute({
      sql: `INSERT OR IGNORE INTO vehicles (id, owner_id, category_id, plate, make, model, status, service_class, seat_capacity, accepts_convenient)
            VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
      args: [vehicleId, DEMO_OWNER_ID, String((d.size === "large" ? large : small).id), d.plate, d.make, d.model, d.tier, d.size === "large" ? 7 : 4, d.tier === "comfort" ? 0 : 1],
    });
    await db.execute({
      sql: `INSERT INTO vehicle_assignments (id, vehicle_id, driver_id, status)
            SELECT ?, ?, ?, 'active' WHERE NOT EXISTS (SELECT 1 FROM vehicle_assignments WHERE vehicle_id = ? AND status = 'active')`,
      args: [`demo-car-assign-${d.id.slice(DEMO_PREFIX.length)}`, vehicleId, d.id, vehicleId],
    });
  }
  fleetReady = true;
  return true;
}

/**
 * Puts the free demo drivers online a short way from a pickup point, so the nearby counts and the matcher
 * see them. A driver already on a ride is left where it is. Returns false when the demo is off or not ready.
 */
export async function ensureSandboxCarDrivers(lat: number, lng: number): Promise<boolean> {
  try {
    if (!(await sandboxCarDemoOn()) || !(await tablesReady()) || !(await ensureFleet())) return false;
    const busy = new Set(((await db.execute({
      sql: `SELECT rider_id FROM orders WHERE environment = 'sandbox' AND rider_id LIKE ? AND stage NOT IN ('Settle', 'Cancelled')`,
      args: [`${DEMO_PREFIX}%`],
    })).rows as Row[]).map((row) => String(row.rider_id)));
    const states = new Map(((await db.execute({ sql: "SELECT driver_id, online, lat, lng FROM car_driver_state WHERE driver_id LIKE ?", args: [`${DEMO_PREFIX}%`] })).rows as Row[]).map((row) => [String(row.driver_id), row]));
    for (const d of DEMO_DRIVERS) {
      if (busy.has(d.id)) continue;
      const at = { lat: lat + d.north / 111, lng: lng + d.east / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))) };
      const state = states.get(d.id);
      // Already online close to this pickup: nothing to write.
      if (state && Number(state.online) === 1 && state.lat != null && state.lng != null && haversineKm(Number(state.lat), Number(state.lng), at.lat, at.lng) < 0.2) continue;
      await db.execute({
        sql: `INSERT INTO car_driver_state (driver_id, vehicle_id, online, lat, lng, updated_at) VALUES (?, ?, 1, ?, ?, datetime('now'))
              ON CONFLICT(driver_id) DO UPDATE SET vehicle_id = excluded.vehicle_id, online = 1, lat = excluded.lat, lng = excluded.lng, updated_at = datetime('now')`,
        args: [d.id, `demo-car-vehicle-${d.id.slice(DEMO_PREFIX.length)}`, at.lat, at.lng],
      });
    }
    return true;
  } catch (error) {
    console.warn("Sandbox car demo drivers could not be placed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** An order route called as a demo driver, so its checks and side effects are the real ones. */
async function asDriver(userId: string, path: string): Promise<boolean> {
  const { default: app } = await import("../app.js");
  const token = await signToken({ sub: userId, role: "customer" });
  const res = await app.request(`/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return res.ok;
}

/**
 * One demo step for a sandbox car ride, if one is due: a demo driver takes the ride, sets off, arrives, picks the
 * passenger up and, once the passenger has confirmed with their PIN, settles. Returns what was done (for tests and
 * logs), or null when the ride waits on the passenger, a real person acted recently, or the demo is off.
 */
export async function stepSandboxCar(orderId: string, opts: { force?: boolean } = {}): Promise<string | null> {
  if (!(await sandboxCarDemoOn()) || !(await hasTable("car_bookings"))) return null;
  const order = (await db.execute({
    sql: `SELECT o.*, (SELECT MAX(created_at) FROM order_events e WHERE e.order_id = o.id) AS last_event_at
          FROM orders o JOIN car_bookings b ON b.order_id = o.id
          WHERE o.id = ? AND o.environment = 'sandbox' AND o.stage NOT IN ('Settle', 'Cancelled')`,
    args: [orderId],
  })).rows[0] as Row | undefined;
  if (!order) return null;

  // Give a real person the step delay to act first.
  if (!opts.force) {
    const { sandboxDemoStepSeconds } = await getCarSettings();
    const last = [order.updated_at, order.last_event_at].filter(Boolean).map((t) => Date.parse(`${String(t).replace(" ", "T")}Z`)).filter(Number.isFinite);
    if (last.length && Date.now() - Math.max(...last) < (sandboxDemoStepSeconds ?? 12) * 1000) return null;
  }

  const rider = order.rider_id ? String(order.rider_id) : null;
  const stage = String(order.stage);
  try {
    // 1. A demo driver takes the ride, if the matcher's pick is one of them (a real driver is left to take it).
    if (!rider && ["Create", "Match"].includes(stage)) {
      if (order.pickup_lat == null || order.pickup_lng == null || order.fare_offer != null) return null;
      if (!(await ensureSandboxCarDrivers(Number(order.pickup_lat), Number(order.pickup_lng)))) return null;
      const { findCarCandidate } = await import("./service.js");
      const pick = await findCarCandidate(orderId, order);
      if (!pick || !isDemoCarDriver(pick.riderId)) return null;
      const { assignRider } = await import("../orders/routes.js");
      return (await assignRider(orderId, order, pick.riderId, pick.riderName, pick.outOfRange)) ? "driver assigned" : null;
    }
    if (!isDemoCarDriver(rider)) return null;
    // 2. Paid: the driver sets off, arrives (the passenger gets the "here" alert and call), then picks them up.
    if (stage === "Shop") return (await asDriver(rider!, `/orders/${orderId}/deliver`)) ? "driver set off" : null;
    if (stage === "Deliver") return (await asDriver(rider!, `/orders/${orderId}/arrived`)) ? "driver arrived" : null;
    if (stage === "Arrived") return (await asDriver(rider!, `/orders/${orderId}/picked-up`)) ? "passenger picked up" : null;
    // 3. The passenger confirmed the trip with their PIN: the driver closes the job.
    if (stage === "Handover") return (await asDriver(rider!, `/orders/${orderId}/settle`)) ? "settled" : null;
  } catch (err) {
    // A real person got there first, or the order changed: the next step will see the new state.
    console.warn(`Sandbox car demo step skipped for ${orderId}:`, err instanceof Error ? err.message : err);
  }
  return null;
}

/** Every open sandbox car ride gets its next due step (the cron heartbeat). */
export async function sweepSandboxCar(): Promise<number> {
  if (!(await sandboxCarDemoOn()) || !(await hasTable("car_bookings"))) return 0;
  const open = (await db.execute(`SELECT o.id FROM orders o JOIN car_bookings b ON b.order_id = o.id
                                  WHERE o.environment = 'sandbox' AND o.stage NOT IN ('Settle', 'Cancelled')
                                  ORDER BY o.created_at DESC LIMIT 50`)).rows as Row[];
  let steps = 0;
  for (const row of open) if (await stepSandboxCar(String(row.id))) steps += 1;
  return steps;
}
