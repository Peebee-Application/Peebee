import { db } from "../db/client.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { taxipressVanFeatures, type TaxipressVanFeature } from "@peebee/shared";
import type { LineEntry } from "./queue.js";
import { LUGGAGE_TYPES, offeredLuggageTypes, type LuggageType, type TaxipressSettings } from "./settings.js";

type Row = Record<string, unknown>;

/**
 * Taxipress v5: passengers, luggage and options on a booking, the taxi profile, route stops and
 * departure estimates. Migration 0128 adds the columns; until it is applied a booking is seats only.
 */
/** The last nine digits of a phone number: what two spellings of one number ("0772…", "+256 772…") have in common. */
export const phoneTail = (phone: string | null | undefined): string => String(phone ?? "").replace(/\D/g, "").slice(-9);

export async function detailsColumnsReady(): Promise<boolean> {
  return (await hasColumn("taxipress_bookings", "adults")) && (await hasColumn("taxipress_bookings", "emergency_phone"));
}

/**
 * Booking options always work. With migration 0128 they live in their own columns; before it, the same
 * details are kept as JSON on a hidden, cancelled `lists` row (a table every deployment has) keyed by booking.
 */
export async function detailsReady(): Promise<boolean> {
  return true;
}

export const detailsListId = (bookingId: string) => `tpdetails_${bookingId}`;


export type Assistance = "none" | "boarding" | "priority" | "mobility";
/** A language code staff have set up for passengers (en, lg, sw and whatever else they add). */
export type Language = string;

export type BookingDetailsInput = {
  adults: number;
  children: number;
  /** Optional explicit seats for children who could otherwise travel on a lap. */
  childSeats?: number;
  luggage: Partial<Record<LuggageType, number>>;
  assistance: Assistance | null;
  language: Language | null;
  forSomeoneElse: boolean;
  travellerName: string | null;
  travellerPhone: string | null;
  emergencyPhone: string | null;
};

export type BookingDetails = BookingDetailsInput & { childSeats: number; luggageAmount: number };

export type Priced = { seats: number; childSeats: number; fareAmount: number; luggageAmount: number; amount: number; error: string | null };

/**
 * Fly Express rules (xristo7/flyexpress script.js): up to `maxLapChildren` children ride on a lap for free;
 * every further child needs a seat (reserved = max(0, children - 2)), priced at childSeatFarePercent of the fare.
 * Luggage priced per item; a type priced null (commercial) is assessed at the stage and adds nothing now.
 */
export function priceBooking(input: Pick<BookingDetailsInput, "adults" | "children" | "childSeats" | "luggage">, farePerSeat: number, settings: Pick<TaxipressSettings, "maxLapChildren" | "childSeatFarePercent" | "luggageEnabled" | "luggageOptionsShown" | "luggagePrices">): Priced {
  const minimum = Math.max(0, input.children - settings.maxLapChildren);
  const childSeats = input.childSeats ?? minimum;
  const seats = input.adults + childSeats;
  const childFare = Math.round((farePerSeat * settings.childSeatFarePercent) / 100);
  const fareAmount = farePerSeat * input.adults + childFare * childSeats;
  let luggageAmount = 0;
  if (settings.luggageEnabled) {
    for (const type of offeredLuggageTypes(settings)) {
      const qty = Math.max(0, Math.round(input.luggage[type] ?? 0));
      const price = settings.luggagePrices[type];
      if (qty > 0 && price != null) luggageAmount += price * qty;
    }
  }
  const error = input.adults < 1 ? "At least one adult travels on a booking."
    : !Number.isInteger(childSeats) || childSeats < minimum || childSeats > input.children ? `Choose between ${minimum} and ${input.children} child seats.` : null;
  return { seats, childSeats, fareAmount, luggageAmount, amount: fareAmount + luggageAmount, error };
}

export function luggageCount(json: unknown): number {
  try {
    const parsed = JSON.parse(String(json ?? "{}")) as Record<string, unknown>;
    return Object.values(parsed).reduce<number>((n, v) => n + (typeof v === "number" && v > 0 ? v : 0), 0);
  } catch {
    return 0;
  }
}

export function detailsFromRow(row: Row): BookingDetails {
  let luggage: Partial<Record<LuggageType, number>> = {};
  try {
    const parsed = JSON.parse(String(row.luggage_json ?? "{}")) as Record<string, unknown>;
    for (const type of LUGGAGE_TYPES) if (typeof parsed[type] === "number" && (parsed[type] as number) > 0) luggage[type] = parsed[type] as number;
  } catch {
    luggage = {};
  }
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    adults: Number(row.adults ?? row.seats ?? 1),
    children: Number(row.children ?? 0),
    childSeats: Number(row.child_seats ?? 0),
    luggage,
    luggageAmount: Number(row.luggage_amount ?? 0),
    assistance: (str(row.assistance) as Assistance | null),
    language: (str(row.language) as Language | null),
    forSomeoneElse: Number(row.for_someone_else ?? 0) === 1,
    travellerName: str(row.traveller_name),
    travellerPhone: str(row.traveller_phone),
    emergencyPhone: str(row.emergency_phone),
  };
}

export async function saveDetails(bookingId: string, d: BookingDetails, owner?: { customerId: string; environment: string }): Promise<void> {
  if (!(await detailsColumnsReady())) {
    if (!owner) return;
    await db.execute({
      sql: "INSERT OR REPLACE INTO lists (id, customer_id, title, status, environment, customer_hidden) VALUES (?, ?, ?, 'cancelled', ?, 1)",
      args: [detailsListId(bookingId), owner.customerId, JSON.stringify(d), owner.environment],
    });
    return;
  }
  await db.execute({
    sql: `UPDATE taxipress_bookings SET adults = ?, children = ?, child_seats = ?, luggage_json = ?, luggage_amount = ?, assistance = ?, language = ?,
            for_someone_else = ?, traveller_name = ?, traveller_phone = ?, emergency_phone = ? WHERE id = ?`,
    args: [d.adults, d.children, d.childSeats, JSON.stringify(d.luggage), d.luggageAmount, d.assistance, d.language,
      d.forSomeoneElse ? 1 : 0, d.travellerName, d.travellerPhone, d.emergencyPhone, bookingId],
  });
}

/** A booking's options from whichever store holds them; null when none were given. */
export async function loadDetails(bookingId: string): Promise<BookingDetails | null> {
  if (await detailsColumnsReady()) {
    const d = (await db.execute({ sql: "SELECT seats, adults, children, child_seats, luggage_json, luggage_amount, assistance, language, for_someone_else, traveller_name, traveller_phone, emergency_phone FROM taxipress_bookings WHERE id = ?", args: [bookingId] })).rows[0] as Row | undefined;
    if (d) return detailsFromRow(d);
  }
  const row = (await db.execute({ sql: "SELECT title FROM lists WHERE id = ?", args: [detailsListId(bookingId)] })).rows[0] as Row | undefined;
  if (!row) return null;
  try {
    const j = JSON.parse(String(row.title)) as BookingDetails;
    return detailsFromRow({
      adults: j.adults, children: j.children, child_seats: j.childSeats, luggage_json: JSON.stringify(j.luggage ?? {}), luggage_amount: j.luggageAmount,
      assistance: j.assistance, language: j.language, for_someone_else: j.forSomeoneElse ? 1 : 0,
      traveller_name: j.travellerName, traveller_phone: j.travellerPhone, emergency_phone: j.emergencyPhone,
    });
  } catch {
    return null;
  }
}

/** The stops along a Taxipress route, in travel order: the Relay stages staff already keep for the route. */
export async function stopsFor(relayRouteId: string, direction: "a_to_b" | "b_to_a"): Promise<string[]> {
  if (!(await hasTable("relay_route_stages"))) return [];
  const rows = (await db.execute({
    sql: "SELECT name FROM relay_route_stages WHERE route_id = ? AND active = 1 ORDER BY seq, created_at",
    args: [relayRouteId],
  })).rows as Row[];
  const names = rows.map((r) => String(r.name)).filter(Boolean);
  return direction === "a_to_b" ? names : names.reverse();
}

const MINUTE = 60_000;
const parseAt = (v: string | null) => (v ? Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`) : NaN);

/**
 * Minutes a taxi on this route usually spends Boarding Now, from the last ten real departures.
 * Null with no history: estimates are then shown only where a staff rule fixes the time.
 */
async function usualBoardingMinutes(taxipressRouteId: string): Promise<number | null> {
  const rows = (await db.execute({
    sql: `SELECT boarding_at, departed_at FROM taxipress_queue WHERE taxipress_route_id = ? AND boarding_at IS NOT NULL AND departed_at IS NOT NULL
          ORDER BY departed_at DESC LIMIT 10`,
    args: [taxipressRouteId],
  })).rows as Row[];
  const spans = rows
    .map((r) => (parseAt(String(r.departed_at)) - parseAt(String(r.boarding_at))) / MINUTE)
    .filter((m) => Number.isFinite(m) && m > 0 && m < 600);
  if (spans.length === 0) return null;
  return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
}

/**
 * Departure estimates and which taxis can be booked.
 * - Only the first `bookableTaxis` taxis waiting in line (not the one Boarding Now) may be booked, and only with seats left.
 * - Boarding taxi: after_wait leaves at boarding_at + waitMinutes (sooner if full); otherwise boarding_at + the route's usual boarding time.
 * - Each taxi behind leaves one boarding period after the one ahead (waitMinutes under after_wait, capped by the usual time when known).
 * - No history and no fixed wait: no estimate (null), never a made-up time.
 */
export async function decorateLine(taxipressRouteId: string, line: LineEntry[], settings: TaxipressSettings): Promise<Array<LineEntry & { bookable: boolean; departsAt: string | null }>> {
  const usual = line.length > 0 ? await usualBoardingMinutes(taxipressRouteId) : null;
  const period = settings.departureRule === "after_wait"
    ? (usual != null ? Math.min(usual, settings.waitMinutes) : settings.waitMinutes)
    : usual;
  const now = Date.now();
  let previous: number | null = null;
  let waiting = 0;
  return line.map((entry) => {
    let departs: number | null = null;
    if (entry.status === "boarding") {
      const start = parseAt(entry.boardingAt) || now;
      const span = settings.departureRule === "after_wait" ? settings.waitMinutes : usual;
      departs = span == null ? null : Math.max(now + MINUTE, start + span * MINUTE);
    } else {
      waiting += 1;
      const ahead = previous ?? (period == null ? null : now);
      departs = ahead == null || period == null ? null : ahead + period * MINUTE;
    }
    previous = departs;
    const bookable = entry.status === "in_line" && waiting <= settings.bookableTaxis && !entry.fullyBooked;
    return { ...entry, bookable, departsAt: departs == null ? null : new Date(departs).toISOString() };
  });
}

export type TaxiProfile = {
  queueId: string; plate: string; seatLayout: "14" | "18"; vehicleType: string | null; colour: string | null; photoUrl: string | null;
  passengerCapacity: number; driverBio: string | null; features: TaxipressVanFeature[];
  driverName: string | null; driverPhotoUrl: string | null; memberSince: string | null; tripsCount: number | null;
  rating: number | null; ratingCount: number | null; reviews: Array<{ rating: number; comment: string | null; createdAt: string }>;
  status: LineEntry["status"]; position: number | null; seatsLeft: number; bookable: boolean; departsAt: string | null;
  route: { id: string; fromName: string; toName: string; stops: string[] };
};

/** A taxi's profile from real records only. Anything with no data is null and the app hides it. */
export async function taxiProfile(entry: LineEntry & { bookable: boolean; departsAt: string | null }, route: { id: string; fromName: string; toName: string; relayRouteId: string; direction: "a_to_b" | "b_to_a" }, showStops: boolean): Promise<TaxiProfile> {
  const profileCols = await hasColumn("taxipress_taxis", "photo_url");
  const customizationCols = await hasColumn("taxipress_taxis", "driver_bio") && await hasColumn("taxipress_taxis", "vehicle_features_json");
  const taxi = (await db.execute({
    sql: `SELECT x.approved_at, x.created_at${profileCols ? ", x.photo_url, x.vehicle_type, x.colour" : ""}${customizationCols ? ", x.driver_bio, x.vehicle_features_json" : ""} FROM taxipress_taxis x WHERE x.id = ?`,
    args: [entry.taxiId],
  })).rows[0] as Row | undefined;
  const trips = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM taxipress_queue WHERE taxi_id = ? AND status = 'arrived'", args: [entry.taxiId] })).rows[0] as Row | undefined;
  let rating: number | null = null;
  let ratingCount: number | null = null;
  let reviews: TaxiProfile["reviews"] = [];
  if (await hasTable("taxipress_reviews")) {
    const agg = (await db.execute({ sql: "SELECT COUNT(*) AS n, AVG(rating) AS avg FROM taxipress_reviews WHERE taxi_id = ?", args: [entry.taxiId] })).rows[0] as Row | undefined;
    const n = Number(agg?.n ?? 0);
    if (n > 0) {
      ratingCount = n;
      rating = Math.round(Number(agg?.avg) * 10) / 10;
      reviews = ((await db.execute({ sql: "SELECT rating, comment, created_at FROM taxipress_reviews WHERE taxi_id = ? AND comment IS NOT NULL AND comment != '' ORDER BY created_at DESC LIMIT 3", args: [entry.taxiId] })).rows as Row[])
        .map((r) => ({ rating: Number(r.rating), comment: r.comment == null ? null : String(r.comment), createdAt: String(r.created_at) }));
    }
  }
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const tripsCount = Number(trips?.n ?? 0);
  return {
    queueId: entry.id,
    plate: entry.plate,
    seatLayout: entry.seatLayout,
    vehicleType: str(taxi?.vehicle_type),
    colour: str(taxi?.colour),
    photoUrl: str(taxi?.photo_url),
    passengerCapacity: entry.seatsTotal,
    driverBio: str(taxi?.driver_bio),
    features: taxipressVanFeatures(parseJson(taxi?.vehicle_features_json), entry.seatLayout),
    driverName: entry.driverName,
    driverPhotoUrl: entry.driverPhotoUrl ?? null,
    memberSince: str(taxi?.approved_at) ?? str(taxi?.created_at),
    tripsCount: tripsCount > 0 ? tripsCount : null,
    rating, ratingCount, reviews,
    status: entry.status,
    position: entry.position,
    seatsLeft: entry.seatsLeft,
    bookable: entry.bookable,
    departsAt: entry.departsAt,
    route: { id: route.id, fromName: route.fromName, toName: route.toName, stops: showStops ? await stopsFor(route.relayRouteId, route.direction) : [] },
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return [];
  try { return JSON.parse(value); } catch { return []; }
}
