import { visibleHere } from "../practice/people.js";
import { db, executeBatch } from "../db/client.js";
import { SEAT_LABELS, cleanupSeatHolds, heldSeatCount, seatingReady,walkUpSeatNumbers } from './seats.js';
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { hasColumn,hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { getTaxipressSettings } from "./settings.js";
import { taxipressReady } from "./service.js";

type Row = Record<string, unknown>;

export class TaxipressError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 503, public code: string, message: string) {
    super(message);
  }
}

const ACTIVE = "('in_line', 'boarding', 'on_road')";

/** Until migration 0124 is applied (after 0123) there are no taxis and no line. */
export async function queueReady(): Promise<boolean> {
  return (await taxipressReady()) && (await hasTable("taxipress_taxis")) && (await hasTable("taxipress_queue"));
}

async function requireReady() {
  if (!(await queueReady())) throw new TaxipressError(503, "taxipress_unavailable", "Taxipress isn't set up yet.");
}

// ---------------------------------------------------------------------------
// Taxis
// ---------------------------------------------------------------------------

export type TaxipressTaxi = {
  id: string;
  userId: string;
  relayRouteId: string;
  routeName: string | null;
  plate: string;
  seatLayout: "14" | "18";
  serviceClass?: "standard" | "vip";
  seats: number;
  passengersEnabled: boolean;
  parcelsEnabled: boolean;
  numberedSeatsEnabled?: boolean;
  status: "pending" | "approved" | "suspended";
  driverName?: string | null;
  driverPhone?: string | null;
};

function toTaxi(row: Row): TaxipressTaxi {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    relayRouteId: String(row.relay_route_id),
    routeName: (row.route_name as string | null | undefined) ?? null,
    plate: String(row.plate),
    seatLayout: row.seat_layout === "18" ? "18" : "14",
    serviceClass: row.service_class === "vip" ? "vip" : "standard",
    seats: Number(row.seats),
    passengersEnabled: Number(row.passengers_enabled) === 1,
    parcelsEnabled: Number(row.parcels_enabled) === 1,
    numberedSeatsEnabled: Number(row.numbered_seats_enabled) === 1,
    status: row.status === "approved" || row.status === "suspended" ? row.status : "pending",
    ...(row.driver_name !== undefined ? { driverName: row.driver_name as string | null, driverPhone: (row.driver_phone as string | null) ?? null } : {}),
  };
}

const TAXI_SQL = `SELECT x.*, rr.name AS route_name FROM taxipress_taxis x LEFT JOIN relay_routes rr ON rr.id = x.relay_route_id`;

export async function taxiOf(userId: string): Promise<TaxipressTaxi | null> {
  if (!(await queueReady())) return null;
  const row = (await db.execute({ sql: `${TAXI_SQL} WHERE x.user_id = ?`, args: [userId] })).rows[0] as Row | undefined;
  return row ? toTaxi(row) : null;
}

export async function listTaxis(): Promise<TaxipressTaxi[]> {
  if (!(await queueReady())) return [];
  const rows = (await db.execute(`SELECT x.*, rr.name AS route_name, u.name AS driver_name, u.phone AS driver_phone
    FROM taxipress_taxis x LEFT JOIN relay_routes rr ON rr.id = x.relay_route_id LEFT JOIN users u ON u.id = x.user_id
    ORDER BY CASE x.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, x.created_at DESC`)).rows as Row[];
  return rows.map(toTaxi);
}

/** A driver's application. A change of route, plate or seats sends an approved taxi back for approval. */
export async function applyTaxi(userId: string, input: { relayRouteId: string; plate: string; seatLayout: "14" | "18" }): Promise<void> {
  await requireReady();
  const route = (await db.execute({ sql: "SELECT id FROM relay_routes WHERE id = ? AND active = 1", args: [input.relayRouteId] })).rows[0];
  if (!route) throw new TaxipressError(404, "route_not_found", "That route isn't available.");
  const existing = await taxiOf(userId);
  if (existing?.status === "suspended") throw new TaxipressError(403, "suspended", "Your taxi is suspended. Contact support.");
  if (existing && (await activeEntry(userId))) throw new TaxipressError(409, "in_line", "Leave the line before changing your taxi.");
  const plate = input.plate.trim().toUpperCase();
  const seats = Number(input.seatLayout);
  if (existing) {
    const changed = existing.relayRouteId !== input.relayRouteId || existing.plate !== plate || existing.seatLayout !== input.seatLayout;
    const resetLayout = changed && await hasColumn('taxipress_taxis','numbered_seats_enabled');
    const vipColumn = await hasColumn('taxipress_taxis','service_class');
    await db.execute({
      sql: `UPDATE taxipress_taxis SET relay_route_id = ?, plate = ?, seat_layout = ?, seats = ${vipColumn ? "CASE WHEN service_class='vip' AND ?=0 THEN 13 ELSE ? END" : "?"}, ${vipColumn && changed ? "service_class = 'standard'," : ""} ${changed ? "status = 'pending', approved_by = NULL, approved_at = NULL," : ""} ${resetLayout ? 'numbered_seats_enabled = 0,' : ''} updated_at = datetime('now') WHERE user_id = ?`,
      args: [input.relayRouteId, plate, input.seatLayout, ...(vipColumn ? [changed ? 1 : 0, seats] : [seats]), userId],
    });
    return;
  }
  await db.execute({
    sql: "INSERT INTO taxipress_taxis (id, user_id, relay_route_id, plate, seat_layout, seats) VALUES (?, ?, ?, ?, ?, ?)",
    args: [newId("txi"), userId, input.relayRouteId, plate, input.seatLayout, seats],
  });
}

/** Staff: approve, suspend, or change what an approved taxi may do. */
export async function updateTaxi(
  id: string,
  actorId: string,
  patch: Partial<{ status: "pending" | "approved" | "suspended"; passengersEnabled: boolean; parcelsEnabled: boolean; numberedSeatsEnabled: boolean; serviceClass: "standard" | "vip" }>,
): Promise<TaxipressTaxi> {
  await requireReady();
  const before = (await db.execute({ sql: `${TAXI_SQL} WHERE x.id = ?`, args: [id] })).rows[0] as Row | undefined;
  if (!before) throw new TaxipressError(404, "not_found", "That taxi doesn't exist.");
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.serviceClass != null) {
    if (!(await hasColumn("taxipress_taxis", "service_class"))) throw new TaxipressError(503, "migration_pending", "Apply VIP Highroof migration 0174 first.");
    if (patch.serviceClass === "vip" && before.seat_layout !== "18") throw new TaxipressError(400, "vip_requires_highroof", "VIP service is only available for a Highroof van.");
    if (patch.serviceClass !== (before.service_class === "vip" ? "vip" : "standard")) {
      const [queue, scheduled] = await Promise.all([
        db.execute({ sql: "SELECT 1 FROM taxipress_queue WHERE taxi_id=? AND status IN ('in_line','boarding','on_road') LIMIT 1", args: [id] }),
        (await hasColumn("taxipress_departures", "service_class")) ? db.execute({ sql: "SELECT 1 FROM taxipress_departures WHERE taxi_id=? AND state IN ('published','active') LIMIT 1", args: [id] }) : Promise.resolve({ rows: [] as Row[] }),
      ]);
      if (queue.rows.length || scheduled.rows.length) throw new TaxipressError(409, "taxi_in_service", "Change VIP service only when this taxi has no active or booked departure.");
    }
    if (patch.serviceClass === "vip" && await hasColumn("taxipress_taxis", "numbered_seats_enabled")) sets.push("numbered_seats_enabled = 0");
    sets.push("service_class = ?", "seats = ?");
    args.push(patch.serviceClass, patch.serviceClass === "vip" ? 13 : Number(before.seat_layout));
  }
  if (patch.status) {
    sets.push("status = ?");
    args.push(patch.status);
    if (patch.status === "approved") { sets.push("approved_by = ?", "approved_at = datetime('now')"); args.push(actorId); }
  }
  if (patch.passengersEnabled != null) { sets.push("passengers_enabled = ?"); args.push(patch.passengersEnabled ? 1 : 0); }
  if (patch.parcelsEnabled != null) { sets.push("parcels_enabled = ?"); args.push(patch.parcelsEnabled ? 1 : 0); }
  if (patch.numberedSeatsEnabled != null) {
    if (patch.numberedSeatsEnabled && patch.serviceClass === "vip") throw new TaxipressError(409, "vip_seat_map_unavailable", "Numbered seats are not offered on the current 13-seat VIP Highroof layout.");
    if (patch.numberedSeatsEnabled && before.service_class === "vip") throw new TaxipressError(409, "vip_seat_map_unavailable", "Numbered seats are not offered on the current 13-seat VIP Highroof layout.");
    if (!(await hasColumn('taxipress_taxis','numbered_seats_enabled'))) throw new TaxipressError(503,'migration_pending','Apply numbered-seat migration 0168 first.');
    sets.push('numbered_seats_enabled = ?'); args.push(patch.numberedSeatsEnabled ? 1 : 0);
  }
  if (sets.length) await db.execute({ sql: `UPDATE taxipress_taxis SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...args, id] });
  // Not working any more: it leaves any line it is in (a taxi already On Road finishes its trip).
  const after = (await db.execute({ sql: `${TAXI_SQL} WHERE x.id = ?`, args: [id] })).rows[0] as Row;
  if (after.status !== "approved" || Number(after.passengers_enabled) !== 1) {
    const leaving = (await db.execute({ sql: "SELECT id FROM taxipress_queue WHERE taxi_id = ? AND status IN ('in_line', 'boarding')", args: [id] })).rows as Row[];
    await db.execute({
      sql: `UPDATE taxipress_queue SET status = 'cancelled', ended_reason = 'taxi_not_approved', updated_at = datetime('now') WHERE taxi_id = ? AND status IN ('in_line', 'boarding')`,
      args: [id],
    });
    for (const entry of leaving) await afterTaxiLeft(String(entry.id));
  }
  return toTaxi(after);
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

export type LineEntry = {
  id: string;
  taxiId: string;
  driverId: string;
  status: "in_line" | "boarding" | "on_road" | "arrived" | "cancelled";
  /** 1 for the taxi at the front. Only taxis still in line or boarding have one. */
  position: number | null;
  plate: string;
  seatLayout: "14" | "18";
  serviceClass?: "standard" | "vip";
  seatsTotal: number;
  seatsBooked: number;
  walkUpSeats: number;
  seatsTaken: number;
  seatsLeft: number;
  fullyBooked: boolean;
  joinedAt: string;
  boardingAt: string | null;
  departedAt: string | null;
  driverName: string | null;
  /** Served by GET /v1/taxipress/queue/:id/driver-photo while the taxi is in the line. */
  driverPhotoUrl?: string | null;
};

async function entrySql() {
  const taxiServiceClass = await hasColumn("taxipress_taxis", "service_class") ? "x.service_class" : "'standard'";
  return `SELECT q.*, x.plate, x.seat_layout, ${taxiServiceClass} AS taxi_service_class, u.name AS driver_name,
  COALESCE(rd.profile_photo_key, u.profile_photo_key) AS driver_photo_key
  FROM taxipress_queue q JOIN taxipress_taxis x ON x.id = q.taxi_id LEFT JOIN users u ON u.id = q.driver_id
  LEFT JOIN riders rd ON rd.user_id = q.driver_id`;
}

async function toEntry(row: Row, position: number | null): Promise<LineEntry> {
  const total = Number(row.seats_total);
  const taken = Number(row.seats_booked) + Number(row.walk_up_seats);
  return {
    id: String(row.id),
    taxiId: String(row.taxi_id),
    driverId: String(row.driver_id),
    status: row.status as LineEntry["status"],
    position,
    plate: String(row.plate),
    seatLayout: row.seat_layout === "18" ? "18" : "14",
    serviceClass: row.taxi_service_class === "vip" ? "vip" : "standard",
    seatsTotal: total,
    seatsBooked: Number(row.seats_booked),
    walkUpSeats: Number(row.walk_up_seats),
    seatsTaken: taken,
    seatsLeft: Math.max(0, total - taken - await heldSeatCount(String(row.id))),
    fullyBooked: taken >= total,
    joinedAt: String(row.joined_at),
    boardingAt: (row.boarding_at as string | null) ?? null,
    departedAt: (row.departed_at as string | null) ?? null,
    driverName: (row.driver_name as string | null) ?? null,
    driverPhotoUrl: row.driver_photo_key ? `/v1/taxipress/queue/${String(row.id)}/driver-photo` : null,
  };
}

/** The taxis waiting on a route, the one Boarding Now first, then in the order they joined. */
export async function lineOf(taxipressRouteId: string): Promise<LineEntry[]> {
  if (!(await queueReady())) return [];
  const rows = (await db.execute({
    sql: `${await entrySql()} WHERE q.taxipress_route_id = ? AND q.status IN ('boarding', 'in_line')
          ORDER BY CASE q.status WHEN 'boarding' THEN 0 ELSE 1 END, q.joined_at, q.id`,
    args: [taxipressRouteId],
  })).rows as Row[];
  return Promise.all(rows.map((row, index) => toEntry(row, index + 1)));
}

export async function onRoadOf(taxipressRouteId: string): Promise<LineEntry[]> {
  if (!(await queueReady())) return [];
  const rows = (await db.execute({
    sql: `${await entrySql()} WHERE q.taxipress_route_id = ? AND q.status = 'on_road' ORDER BY q.departed_at`,
    args: [taxipressRouteId],
  })).rows as Row[];
  return Promise.all(rows.map((row) => toEntry(row, null)));
}

/** The driver's current trip: in the line, boarding, or on the road. */
export async function activeEntry(driverId: string): Promise<(LineEntry & { taxipressRouteId: string }) | null> {
  if (!(await queueReady())) return null;
  const row = (await db.execute({ sql: `${await entrySql()} WHERE q.driver_id = ? AND q.status IN ${ACTIVE} ORDER BY q.joined_at DESC LIMIT 1`, args: [driverId] })).rows[0] as Row | undefined;
  if (!row) return null;
  const routeId = String(row.taxipress_route_id);
  const position = row.status === "on_road" ? null : ((await lineOf(routeId)).find((e) => e.id === String(row.id))?.position ?? null);
  return { ...await toEntry(row, position), taxipressRouteId: routeId };
}

type RouteStage = { id: string; relayRouteId: string; fromName: string; fromLat: number; fromLng: number; active: boolean };

async function routeStage(taxipressRouteId: string): Promise<RouteStage | null> {
  const row = (await db.execute({
    sql: `SELECT t.id, t.relay_route_id, t.direction, t.active AS tp_active, rr.active AS relay_active,
                 rr.stage_a_name, rr.stage_a_lat, rr.stage_a_lng, rr.stage_b_name, rr.stage_b_lat, rr.stage_b_lng
          FROM taxipress_routes t JOIN relay_routes rr ON rr.id = t.relay_route_id WHERE t.id = ?`,
    args: [taxipressRouteId],
  })).rows[0] as Row | undefined;
  if (!row) return null;
  const aToB = row.direction === "a_to_b";
  return {
    id: String(row.id),
    relayRouteId: String(row.relay_route_id),
    fromName: String(aToB ? row.stage_a_name : row.stage_b_name),
    fromLat: Number(aToB ? row.stage_a_lat : row.stage_b_lat),
    fromLng: Number(aToB ? row.stage_a_lng : row.stage_b_lng),
    active: Number(row.tp_active) === 1 && Number(row.relay_active) === 1,
  };
}

/** What the driver owes Peebee: a negative wallet balance (cash commission is taken from the wallet and may take it below zero). */
async function amountOwed(userId: string): Promise<number> {
  const column = (await getPlatformEnvironment()) === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const row = (await db.execute({ sql: `SELECT ${column} AS balance FROM users WHERE id = ?`, args: [userId] })).rows[0] as Row | undefined;
  return Math.max(0, -Number(row?.balance ?? 0));
}

/** Join the line at the start stage of a route. */
export async function joinLine(driverId: string, taxipressRouteId: string, at: { lat?: number; lng?: number }): Promise<LineEntry> {
  await requireReady();
  const settings = await getTaxipressSettings();
  if (!settings.enabled) throw new TaxipressError(409, "taxipress_off", "Taxipress isn't running right now.");
  const taxi = await taxiOf(driverId);
  if (!taxi || taxi.status !== "approved") throw new TaxipressError(403, "taxi_not_approved", "Your taxi hasn't been approved yet.");
  if (!taxi.passengersEnabled) throw new TaxipressError(403, "passengers_off", "Your taxi isn't set up to take passengers.");
  const stage = await routeStage(taxipressRouteId);
  if (!stage || !stage.active) throw new TaxipressError(404, "route_not_found", "That route isn't running.");
  if (stage.relayRouteId !== taxi.relayRouteId) throw new TaxipressError(409, "wrong_route", "Your taxi runs on a different route.");
  if (await activeEntry(driverId)) throw new TaxipressError(409, "already_in_line", "You are already in a line.");

  if (settings.blockWhenOwing) {
    const owed = await amountOwed(driverId);
    if (owed > settings.maxOwedUgx) {
      throw new TaxipressError(403, "owing_too_much", `You owe Peebee UGX ${owed.toLocaleString("en-UG")}. Top up your wallet to join the line.`);
    }
  }
  if (settings.stageRadiusM > 0) {
    if (at.lat == null || at.lng == null) throw new TaxipressError(400, "location_required", `Turn on your location to join the line at ${stage.fromName}.`);
    const metres = haversineKm(at.lat, at.lng, stage.fromLat, stage.fromLng) * 1000;
    if (metres > settings.stageRadiusM) {
      throw new TaxipressError(409, "not_at_stage", `You need to be at ${stage.fromName} to join the line. You are about ${Math.round(metres)} m away.`);
    }
  }

  const id = newId("tpq");
  try {
    const numbered = settings.numberedSeatsEnabled && taxi.numberedSeatsEnabled && await seatingReady() && taxi.seats === SEAT_LABELS[taxi.seatLayout].length;
    await executeBatch([{
      sql: `INSERT INTO taxipress_queue (id, taxipress_route_id, taxi_id, driver_id, seats_total, last_lat, last_lng, last_location_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ${at.lat != null ? "datetime('now')" : "NULL"})`,
      args: [id, taxipressRouteId, taxi.id, driverId, taxi.seats, at.lat ?? null, at.lng ?? null],
    },...(numbered ? [{ sql: 'INSERT INTO taxipress_seat_maps(queue_id,layout,labels) VALUES (?,?,?)',args: [id,taxi.seatLayout,JSON.stringify(SEAT_LABELS[taxi.seatLayout])] }] : [])]);
  } catch {
    throw new TaxipressError(409, "already_in_line", "You are already in a line.");
  }
  await pauseCarRides(driverId);
  const entry = await activeEntry(driverId);
  return entry!;
}

/** A driver in the line takes no car ride requests until they choose to go online for cars again. */
async function pauseCarRides(driverId: string): Promise<void> {
  try {
    await db.execute({ sql: "UPDATE car_driver_state SET online = 0, updated_at = datetime('now') WHERE driver_id = ?", args: [driverId] });
  } catch {
    // Peebee Car isn't set up here: nothing to pause.
  }
}

/** True while the driver is in a line or on the road. Peebee Car uses it so a Taxipress driver is not also given car rides. */
export async function isInLine(driverId: string): Promise<boolean> {
  if (!(await queueReady())) return false;
  return (await activeEntry(driverId)) != null;
}

/** A taxi has left the line before departing: its booked passengers move to the next taxi, or are refunded. */
async function afterTaxiLeft(queueId: string): Promise<void> {
  if (!(await hasTable("taxipress_refunds"))) return;
  const { reassignOrRefund } = await import("./cancellation.js");
  await reassignOrRefund(queueId);
}

/** A taxi has gone on the road: booked passengers who did not board are no-shows. */
async function afterDeparture(queueId: string): Promise<void> {
  if (!(await hasTable("taxipress_refunds"))) return;
  const { markRemainingNoShows } = await import("./cancellation.js");
  await markRemainingNoShows(queueId);
}

async function mustHave(driverId: string, ...statuses: LineEntry["status"][]) {
  await requireReady();
  const entry = await activeEntry(driverId);
  if (!entry) throw new TaxipressError(404, "not_in_line", "You aren't in a line.");
  if (!statuses.includes(entry.status)) {
    const now = entry.status === "in_line" ? "waiting in the line" : entry.status === "boarding" ? "boarding" : "on the road";
    throw new TaxipressError(409, "wrong_state", `Your taxi is ${now}.`);
  }
  return entry;
}

/** The driver at the front taps Boarding Now. Only one taxi per route boards at a time. */
export async function startBoarding(driverId: string): Promise<LineEntry> {
  const entry = await mustHave(driverId, "in_line");
  if (entry.position !== 1) {
    throw new TaxipressError(409, "not_first", entry.position == null ? "You aren't in the line." : `${entry.position - 1} taxi${entry.position === 2 ? " is" : "s are"} ahead of you.`);
  }
  try {
    const moved = await db.execute({
      sql: "UPDATE taxipress_queue SET status = 'boarding', boarding_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'in_line'",
      args: [entry.id],
    });
    if (!moved.rowsAffected) throw new TaxipressError(409, "wrong_state", "Your taxi has already moved on.");
  } catch (e) {
    if (e instanceof TaxipressError) throw e;
    throw new TaxipressError(409, "someone_boarding", "Another taxi is boarding.");
  }
  return (await activeEntry(driverId))!;
}

/** Whether the driver may leave now, and why not. A taxi fully booked can always go. */
export async function departureCheck(entry: LineEntry): Promise<{ allowed: boolean; reason: string | null }> {
  if (entry.fullyBooked) return { allowed: true, reason: null };
  const { departureRule, waitMinutes } = await getTaxipressSettings();
  if (departureRule === "driver_choice") return { allowed: true, reason: null };
  if (departureRule === "after_wait") {
    const since = entry.boardingAt ? Date.parse(`${entry.boardingAt.replace(" ", "T")}Z`) : NaN;
    const waited = Number.isFinite(since) ? Math.floor((Date.now() - since) / 60_000) : 0;
    if (waited >= waitMinutes) return { allowed: true, reason: null };
    return { allowed: false, reason: `You can leave after ${waitMinutes} minutes of boarding (${Math.max(0, waitMinutes - waited)} to go), or when every seat is booked.` };
  }
  return { allowed: false, reason: `${entry.seatsLeft} seat${entry.seatsLeft === 1 ? " is" : "s are"} still free. The taxi leaves when every seat is booked.` };
}

/** The taxi leaves the line. Everyone behind moves up. */
export async function goOnRoad(driverId: string): Promise<LineEntry> {
  await cleanupSeatHolds();
  const entry = await mustHave(driverId, "boarding");
  const check = await departureCheck(entry);
  if (!check.allowed) throw new TaxipressError(409, "not_full", check.reason ?? "The taxi isn't full yet.");
  const moved = await db.execute({
    sql: "UPDATE taxipress_queue SET status = 'on_road', departed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'boarding'",
    args: [entry.id],
  }).catch(() => { throw new TaxipressError(409,'booking_in_progress','A passenger booking is finishing. Refresh before departing.'); });
  if (!moved.rowsAffected) throw new TaxipressError(409, "wrong_state", "Your taxi has already moved on.");
  await afterDeparture(entry.id);
  return (await activeEntry(driverId))!;
}

export async function arrive(driverId: string): Promise<void> {
  const entry = await mustHave(driverId, "on_road");
  await db.execute({
    sql: "UPDATE taxipress_queue SET status = 'arrived', arrived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'on_road'",
    args: [entry.id],
  });
  // Passengers who boarded have now completed their trip.
  if (await hasTable("taxipress_bookings")) {
    await db.execute({ sql: "UPDATE taxipress_bookings SET status = 'completed', updated_at = datetime('now') WHERE queue_id = ? AND status = 'boarded'", args: [entry.id] });
  }
}

/** Leave the line before departing. Once On Road a trip ends with Arrived instead. */
export async function leaveLine(driverId: string, reason = "left"): Promise<void> {
  const entry = await mustHave(driverId, "in_line", "boarding");
  // Passengers who boarded have paid the driver; the taxi cannot leave the line with them on board.
  if (await hasTable("taxipress_bookings")) {
    const aboard = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM taxipress_bookings WHERE queue_id = ? AND status = 'boarded'", args: [entry.id] })).rows[0] as Row;
    if (Number(aboard.n) > 0) throw new TaxipressError(409, "passengers_on_board", "You have passengers on board. Tap On road, or contact support if the taxi can't go.");
  }
  await db.execute({
    sql: "UPDATE taxipress_queue SET status = 'cancelled', ended_reason = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('in_line', 'boarding')",
    args: [reason, entry.id],
  });
  await afterTaxiLeft(entry.id);
}

/** Staff: take a taxi out of the line (a taxi On Road is ended as cancelled too). */
export async function removeFromLine(queueId: string, reason = "removed_by_staff"): Promise<void> {
  await requireReady();
  const moved = await db.execute({
    sql: `UPDATE taxipress_queue SET status = 'cancelled', ended_reason = ?, updated_at = datetime('now') WHERE id = ? AND status IN ${ACTIVE}`,
    args: [reason, queueId],
  });
  if (!moved.rowsAffected) throw new TaxipressError(404, "not_found", "That taxi isn't in a line.");
  await afterTaxiLeft(queueId);
}

/** The driver sells (or gives back) seats at the stage without the app. */
export async function walkUp(driverId: string, delta: number,seat?: string): Promise<LineEntry> {
  await cleanupSeatHolds();
  const entry = await mustHave(driverId, "in_line", "boarding", "on_road");
  if (entry.status === "on_road" && (await getTaxipressSettings()).departureRule === "full_only") {
    throw new TaxipressError(409, "wrong_state", "Seats can't be added once the taxi is on the road.");
  }
  const next = entry.walkUpSeats + delta;
  if (next < 0) throw new TaxipressError(409, "none_to_remove", "No walk-up seats to remove.");
  if (delta > 0 && entry.seatsTaken + delta > entry.seatsTotal) throw new TaxipressError(409, "no_seats_left", "Every seat is taken.");
  if (seat) {
    if (delta !== -1 || !(await seatingReady())) throw new TaxipressError(409,'invalid_seat','Choose a numbered stage seat to remove.');
    const result = await executeBatch([
      {sql: `DELETE FROM taxipress_seat_claims WHERE queue_id = ? AND seat = ? AND walk_up = 1
        AND EXISTS (SELECT 1 FROM taxipress_queue WHERE id = ? AND status IN ${ACTIVE} AND walk_up_seats > 0)`,args: [entry.id,seat,entry.id]},
      {sql: `UPDATE taxipress_queue SET walk_up_seats = walk_up_seats - 1,updated_at = datetime('now') WHERE id = ? AND walk_up_seats > 0 AND changes() = 1 AND status IN ${ACTIVE}`,args: [entry.id]},
    ]);
    if (!result[1]) throw new TaxipressError(409,'invalid_seat','That seat is not a stage sale on your departure.');
    return (await activeEntry(driverId))!;
  }
  const changed = await db.execute({
    sql: `UPDATE taxipress_queue SET walk_up_seats = walk_up_seats + ?, updated_at = datetime('now')
          WHERE id = ? AND status IN ${ACTIVE} AND walk_up_seats + ? >= 0 AND seats_booked + walk_up_seats + ? <= seats_total`,
    args: [delta, entry.id, delta,delta],
  }).catch(() => { throw new TaxipressError(409,'no_seats_left','Those seats are booked or held by another customer.'); });
  if (!changed.rowsAffected) throw new TaxipressError(409, "no_seats_left", "Every seat is taken.");
  return (await activeEntry(driverId))!;
}

export async function updateLocation(driverId: string, lat: number, lng: number): Promise<void> {
  if (!(await queueReady())) return;
  await db.execute({
    sql: `UPDATE taxipress_queue SET last_lat = ?, last_lng = ?, last_location_at = datetime('now') WHERE driver_id = ? AND status IN ${ACTIVE}`,
    args: [lat, lng, driverId],
  });
}

/** Everything the driver's screen needs in one answer. */
export async function driverView(driverId: string) {
  const settings = await getTaxipressSettings();
  const taxi = await taxiOf(driverId);
  const ready = await queueReady();
  const entry = ready ? await activeEntry(driverId) : null;
  const check = entry?.status === "boarding" ? await departureCheck(entry) : null;
  const routes = ready && taxi && taxi.status === "approved"
    ? ((await db.execute({
        sql: `SELECT t.id, t.direction, rr.stage_a_name, rr.stage_b_name FROM taxipress_routes t JOIN relay_routes rr ON rr.id = t.relay_route_id
              WHERE t.relay_route_id = ? AND t.active = 1 AND rr.active = 1 ORDER BY t.direction`,
        args: [taxi.relayRouteId],
      })).rows as Row[]).map((r) => ({
        id: String(r.id),
        fromName: String(r.direction === "a_to_b" ? r.stage_a_name : r.stage_b_name),
        toName: String(r.direction === "a_to_b" ? r.stage_b_name : r.stage_a_name),
      }))
    : [];
  // Routes a driver can apply for: relay routes that run a Taxipress route.
  const world = await getPlatformEnvironment();
  const applyRoutes = ready
    ? ((await db.execute(`SELECT DISTINCT rr.id, rr.name FROM taxipress_routes t JOIN relay_routes rr ON rr.id = t.relay_route_id
        WHERE t.active = 1 AND rr.active = 1 ORDER BY rr.name`)).rows as Row[]).filter((r) => visibleHere(world, String(r.id))).map((r) => ({ id: String(r.id), name: String(r.name) }))
    : [];
  return {
    ready,
    enabled: settings.enabled,
    taxi,
    applyRoutes,
    routes,
    entry,
    walkUpSeatNumbers: entry ? await walkUpSeatNumbers(entry.id) : [],
    line: entry && entry.status !== "on_road" ? await lineOf(entry.taxipressRouteId) : [],
    canGoOnRoad: check?.allowed ?? false,
    onRoadReason: check?.reason ?? null,
    departureRule: settings.departureRule,
    waitMinutes: settings.waitMinutes,
    noShowMinutes: settings.noShowMinutes,
    owingBlocked: settings.blockWhenOwing ? (await amountOwed(driverId)) > settings.maxOwedUgx : false,
  };
}

/** Every taxi in a line or on the road, for staff. */
export async function activeQueue() {
  if (!(await queueReady())) return [];
  const rows = (await db.execute(`${(await entrySql()).replace("u.name AS driver_name", "u.name AS driver_name, u.phone AS driver_phone")}
    WHERE q.status IN ${ACTIVE} ORDER BY q.taxipress_route_id, CASE q.status WHEN 'boarding' THEN 0 WHEN 'in_line' THEN 1 ELSE 2 END, q.joined_at`)).rows as Row[];
  return Promise.all(rows.map(async (row) => ({ ...await toEntry(row, null), taxipressRouteId: String(row.taxipress_route_id), driverPhone: (row.driver_phone as string | null) ?? null })));
}
