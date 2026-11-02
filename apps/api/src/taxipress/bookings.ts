import type { Context } from "hono";
import { markOpenTicket, openTicketColumnsReady, openTicketOf } from "./open-tickets.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { createOrderFromInput } from "../orders/routes.js";
import { directionLabel } from "../relay/direction.js";
import { cancelTermsFor, collectedFor } from "./cancel-terms.js";
import { lineOf, queueReady } from "./queue.js";
import { decorateLine, detailsColumnsReady, loadDetails, luggageCount, phoneTail, priceBooking, saveDetails, type BookingDetails, type BookingDetailsInput } from "./details.js";
import { getTaxipressSettings, offeredLanguages, offeredLuggageTypes } from "./settings.js";

type Row = Record<string, unknown>;

/** Until migration 0125 is applied nobody can book a seat. */
export async function bookingsReady(): Promise<boolean> {
  return (await queueReady()) && (await hasTable("taxipress_bookings"));
}

export type TaxipressBookingStatus = "booked" | "boarded" | "no_show" | "cancelled" | "completed";
/** unpaid: an app payment is still due. paid: collected in the app. pay_driver: cash, to be paid to the driver. */
export type TaxipressPaymentStatus = "unpaid" | "paid" | "pay_driver" | "cancelled";

export type TaxipressBooking = {
  id: string;
  orderId: string;
  status: TaxipressBookingStatus;
  seats: number;
  farePerSeat: number;
  amount: number;
  paymentMethod: "app" | "cash";
  paymentStatus: TaxipressPaymentStatus;
  /** What the driver checks at boarding. Only the passenger is sent it. */
  ticketCode: string | null;
  createdAt: string;
  /** An app payment still due must be made by this time or the seats are given back. */
  payBy: string | null;
  route: { id: string; fromName: string; toName: string; directionLabel: string };
  taxi: { queueId: string; plate: string; seatLayout: "14" | "18"; driverName: string | null; driverPhone: string | null; status: string; position: number | null; seatsLeft: number };
  /** What cancelling now would do: whether it is allowed, what comes back and what is kept. */
  cancel: { allowed: boolean; reason: string | null; free: boolean; fee: number; refund: number };
  /** How a booking that did not board ended, once it has. */
  outcome: { kind: "cancelled" | "no_show" | "taxi_removed"; refunded: number; fee: number } | null;
  /** The receipt for a seat that boarded and was settled; its QR opens the verification page. */
  receiptRef: string | null;
  /** Who travels and what they bring. Null until migration 0128 is applied. */
  details: BookingDetails | null;
  /** Set for an open ticket: valid on any taxi on this route until validUntil (null = never expires). */
  openTicket?: { validUntil: string | null; expired: boolean } | null;
  /** True when someone else bought this ticket and sent it to the signed-in person. */
  sharedWithMe?: boolean;
  /** The first name of whoever bought a ticket that was sent to you. */
  sentBy?: string | null;
};

// rr.* brings the relay route's stage columns (and its stage codes once migration 0107 adds them), so the
// booking's own columns that share a name with one of its columns (id, status, created_at) are aliased.
const SQL = `SELECT rr.*, b.id AS bk_id, b.order_id AS bk_order_id, b.queue_id, b.taxipress_route_id, b.passenger_id, b.driver_id, b.seats,
    b.fare_per_seat, b.amount, b.payment_method, b.status AS bk_status, b.ticket_code, b.created_at AS bk_created_at,
    o.stage AS order_stage, o.payment_rail AS order_rail,
    EXISTS (SELECT 1 FROM payments p WHERE p.order_id = b.order_id AND p.type = 'collection' AND p.status = 'successful') AS app_paid,
    q.status AS queue_status, q.seats_total, q.seats_booked, q.walk_up_seats, x.plate, x.seat_layout, u.name AS driver_name, u.phone AS driver_phone,
    t.direction, t.id AS tp_id
  FROM taxipress_bookings b
  JOIN orders o ON o.id = b.order_id
  JOIN taxipress_queue q ON q.id = b.queue_id
  JOIN taxipress_taxis x ON x.id = q.taxi_id
  JOIN taxipress_routes t ON t.id = b.taxipress_route_id
  JOIN relay_routes rr ON rr.id = t.relay_route_id
  LEFT JOIN users u ON u.id = b.driver_id`;

async function toBooking(row: Row, forPassenger: boolean): Promise<TaxipressBooking> {
  const settings = await getTaxipressSettings();
  const cancelled = row.bk_status === "cancelled" || row.order_stage === "Cancelled";
  // Cash is chosen on the checkout screen: the order moves to the cash ("float") rail.
  const cash = row.payment_method === "cash" || row.order_rail === "float";
  const funded = row.order_stage !== "Match" && row.order_stage !== "Create" && !cancelled;
  const paymentStatus: TaxipressPaymentStatus = cancelled ? "cancelled" : cash ? (funded ? "pay_driver" : "unpaid") : Number(row.app_paid) === 1 || funded ? "paid" : "unpaid";
  const aToB = row.direction === "a_to_b";
  const queueStatus = String(row.queue_status);
  const position = queueStatus === "in_line" || queueStatus === "boarding"
    ? ((await lineOf(String(row.taxipress_route_id))).find((e) => e.id === String(row.queue_id))?.position ?? null)
    : null;
  const method: "app" | "cash" = cash ? "cash" : "app";
  const collected = method === "app" && row.bk_status === "booked" ? await collectedFor(String(row.bk_order_id)) : 0;
  const openTicket = await openTicketOf(String(row.bk_id));
  const cancel = cancelTermsFor(
    { status: String(row.bk_status), queueStatus, method, amount: Number(row.amount), createdAt: String(row.bk_created_at), collected, openTicket: openTicket != null },
    settings,
  );
  let receiptRef: string | null = null;
  if ((row.bk_status === "boarded" || row.bk_status === "completed") && (await hasTable("taxipress_settlements"))) {
    const settled = (await db.execute({ sql: "SELECT id FROM taxipress_settlements WHERE booking_id = ?", args: [String(row.bk_id)] })).rows[0] as Row | undefined;
    if (settled) receiptRef = String(settled.id);
  }
  let outcome: TaxipressBooking["outcome"] = null;
  if (row.bk_status !== "booked" && row.bk_status !== "boarded" && row.bk_status !== "completed" && (await hasTable("taxipress_refunds"))) {
    const r = (await db.execute({ sql: "SELECT kind, refunded, fee FROM taxipress_refunds WHERE booking_id = ?", args: [String(row.bk_id)] })).rows[0] as Row | undefined;
    if (r) outcome = { kind: r.kind as NonNullable<TaxipressBooking["outcome"]>["kind"], refunded: Number(r.refunded), fee: Number(r.fee) };
  }
  let details: BookingDetails | null = null;
  details = await loadDetails(String(row.bk_id));
  const createdMs = Date.parse(`${String(row.bk_created_at).replace(" ", "T")}Z`);
  return {
    id: String(row.bk_id),
    orderId: String(row.bk_order_id),
    status: row.bk_status as TaxipressBookingStatus,
    seats: Number(row.seats),
    farePerSeat: Number(row.fare_per_seat),
    amount: Number(row.amount),
    paymentMethod: cash ? "cash" : "app",
    paymentStatus,
    ticketCode: forPassenger ? String(row.ticket_code) : null,
    createdAt: String(row.bk_created_at),
    payBy: paymentStatus === "unpaid" && Number.isFinite(createdMs) ? new Date(createdMs + settings.payWithinMinutes * 60_000).toISOString() : null,
    route: {
      id: String(row.tp_id),
      fromName: String(aToB ? row.stage_a_name : row.stage_b_name),
      toName: String(aToB ? row.stage_b_name : row.stage_a_name),
      directionLabel: directionLabel(row, aToB ? "a" : "b"),
    },
    taxi: {
      queueId: String(row.queue_id),
      plate: String(row.plate),
      seatLayout: row.seat_layout === "18" ? "18" : "14",
      driverName: (row.driver_name as string | null) ?? null,
      driverPhone: (row.driver_phone as string | null) ?? null,
      status: queueStatus,
      position,
      seatsLeft: Math.max(0, Number(row.seats_total) - Number(row.seats_booked) - Number(row.walk_up_seats)),
    },
    cancel,
    outcome,
    receiptRef,
    details,
    openTicket,
  };
}

/** A WHERE clause for tickets whose named traveller has this phone number (and who did not buy them themselves). */
const SENT_TO_ME = `b.for_someone_else = 1 AND b.passenger_id <> ? AND b.status != 'cancelled'
  AND substr(REPLACE(REPLACE(REPLACE(COALESCE(b.traveller_phone, ''), ' ', ''), '-', ''), '+', ''), -9) = ?`;

async function myPhoneTail(userId: string): Promise<string | null> {
  const tail = phoneTail(((await db.execute({ sql: "SELECT phone FROM users WHERE id = ?", args: [userId] })).rows[0] as Row | undefined)?.phone as string | undefined);
  return tail.length === 9 && (await detailsColumnsReady()) ? tail : null;
}

async function asSent(row: Row): Promise<TaxipressBooking> {
  const booking = await toBooking(row, true);
  const buyer = (await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [String(row.passenger_id)] })).rows[0] as Row | undefined;
  return { ...booking, sharedWithMe: true, sentBy: String(buyer?.name ?? "").trim().split(/\s+/)[0] || null };
}

/** The signed-in person's tickets: the ones they bought, and the ones someone sent them (once paid or for cash). */
export async function myBookings(passengerId: string): Promise<TaxipressBooking[]> {
  if (!(await bookingsReady())) return [];
  await releaseStaleBookings();
  const rows = (await db.execute({ sql: `${SQL} WHERE b.passenger_id = ? ORDER BY b.created_at DESC LIMIT 50`, args: [passengerId] })).rows as Row[];
  const own = await Promise.all(rows.map((row) => toBooking(row, true)));
  const tail = await myPhoneTail(passengerId);
  if (!tail || !(await getTaxipressSettings()).ticketSharingEnabled) return own;
  const sent = (await db.execute({ sql: `${SQL} WHERE ${SENT_TO_ME} ORDER BY b.created_at DESC LIMIT 20`, args: [passengerId, tail] })).rows as Row[];
  const received = (await Promise.all(sent.map(asSent))).filter((b) => b.paymentStatus === "paid" || b.paymentStatus === "pay_driver");
  return [...received, ...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function bookingFor(id: string, passengerId: string): Promise<TaxipressBooking | null> {
  if (!(await bookingsReady())) return null;
  await releaseStaleBookings();
  const row = (await db.execute({ sql: `${SQL} WHERE b.id = ? AND b.passenger_id = ?`, args: [id, passengerId] })).rows[0] as Row | undefined;
  if (row) return toBooking(row, true);
  // A ticket someone sent to this person: they may see it and show it to the driver, but it stays the buyer's to cancel.
  const tail = await myPhoneTail(passengerId);
  if (!tail || !(await getTaxipressSettings()).ticketSharingEnabled) return null;
  const sent = (await db.execute({ sql: `${SQL} WHERE b.id = ? AND ${SENT_TO_ME}`, args: [id, passengerId, tail] })).rows[0] as Row | undefined;
  return sent ? asSent(sent) : null;
}

/** A ticket by its code, for the public code page. Returns the booking and who bought it. */
export async function ticketRowByCode(code: string): Promise<{ booking: TaxipressBooking; passengerId: string } | null> {
  const row = (await db.execute({ sql: `${SQL} WHERE b.ticket_code = ?`, args: [code] })).rows[0] as Row | undefined;
  return row ? { booking: await toBooking(row, true), passengerId: String(row.passenger_id) } : null;
}

export type ManifestPassenger = {
  id: string;
  passengerName: string | null;
  passengerPhone: string | null;
  seats: number;
  amount: number;
  paymentMethod: "app" | "cash";
  paymentStatus: TaxipressPaymentStatus;
  status: TaxipressBookingStatus;
  adults: number;
  children: number;
  bags: number;
  travellerName: string | null;
};

/** The passengers booked on a taxi, for its driver. */
export async function manifestFor(queueId: string): Promise<ManifestPassenger[]> {
  if (!(await bookingsReady())) return [];
  await releaseStaleBookings();
  const rows = (await db.execute({ sql: `${SQL.replace("u.name AS driver_name", "u.name AS driver_name, pu.name AS passenger_name, pu.phone AS passenger_phone").replace("LEFT JOIN users u ON u.id = b.driver_id", "LEFT JOIN users u ON u.id = b.driver_id LEFT JOIN users pu ON pu.id = b.passenger_id")}
      WHERE b.queue_id = ? AND b.status != 'cancelled' ORDER BY b.created_at`, args: [queueId] })).rows as Row[];
  return Promise.all(rows.map(async (row) => {
    const b = await toBooking(row, false);
    const d = b.details;
    return {
      id: b.id, passengerName: (row.passenger_name as string | null) ?? null, passengerPhone: (d?.forSomeoneElse && d.travellerPhone) || ((row.passenger_phone as string | null) ?? null),
      seats: b.seats, amount: b.amount, paymentMethod: b.paymentMethod, paymentStatus: b.paymentStatus, status: b.status,
      adults: d?.adults ?? b.seats, children: d?.children ?? 0, bags: d ? luggageCount(JSON.stringify(d.luggage)) : 0,
      travellerName: d?.forSomeoneElse ? d.travellerName : null,
    };
  }));
}

/**
 * Gives back seats held by bookings that were cancelled, or never paid in time. Run before listing and
 * from the scheduled sweep, so seat counts stay right without touching the order cancellation code.
 */
export async function releaseStaleBookings(): Promise<number> {
  if (!(await bookingsReady())) return 0;
  const { payWithinMinutes } = await getTaxipressSettings();
  // Cash picked on the checkout screen moves the order to the cash rail; the booking follows so boarding settles it as cash.
  await db.execute({
    sql: `UPDATE taxipress_bookings SET payment_method = 'cash', updated_at = datetime('now')
          WHERE status = 'booked' AND payment_method = 'app' AND order_id IN (SELECT id FROM orders WHERE payment_rail = 'float')`,
    args: [],
  });
  // Not paid (or, for cash, not confirmed) in time: cancel the order. Nothing was collected.
  const unpaid = await db.execute({
    sql: `SELECT b.order_id FROM taxipress_bookings b JOIN orders o ON o.id = b.order_id
          WHERE b.status = 'booked' AND o.stage = 'Match' AND b.created_at <= datetime('now', ?)
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)`,
    args: [`-${payWithinMinutes} minutes`],
  });
  for (const row of unpaid.rows as Row[]) {
    const cancelled = await db.execute({ sql: "UPDATE orders SET stage = 'Cancelled', updated_at = datetime('now') WHERE id = ? AND stage = 'Match'", args: [String(row.order_id)] });
    if (cancelled.rowsAffected > 0) {
      await db.execute({ sql: "INSERT INTO order_events (id, order_id, stage, note) VALUES (?, ?, 'Cancelled', 'Seat released: not paid in time')", args: [newId("evt"), String(row.order_id)] });
    }
  }
  const stale = await db.execute({
    sql: `SELECT b.id, b.queue_id, b.seats FROM taxipress_bookings b JOIN orders o ON o.id = b.order_id WHERE b.status = 'booked' AND o.stage = 'Cancelled'`,
    args: [],
  });
  let released = 0;
  for (const row of stale.rows as Row[]) {
    // Only the request that flips booked -> cancelled gives the seats back.
    const flipped = await db.execute({ sql: "UPDATE taxipress_bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'booked'", args: [String(row.id)] });
    if (flipped.rowsAffected === 0) continue;
    await db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?), updated_at = datetime('now') WHERE id = ?", args: [Number(row.seats), String(row.queue_id)] });
    released += Number(row.seats);
  }
  return released;
}

const unavailable = (c: Context) => c.json({ error: "taxipress_unavailable", message: "Taxipress isn't set up yet." }, 503);

function newTicketCode(): string {
  return `TXP-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Books seats on a taxi in the line. The passenger pays next, on the order's pay screen (or hands cash to the driver). */
export type BookInput = { queueId: string; seats?: number; payment?: "app" | "cash"; openTicket?: boolean } & Partial<BookingDetailsInput>;

export async function bookSeats(c: Context, input: BookInput) {
  const user = c.get("user");
  if (!(await bookingsReady())) return unavailable(c);
  const settings = await getTaxipressSettings();
  if (!settings.enabled) return c.json({ error: "taxipress_off", message: "Taxipress isn't running right now." }, 409);
  // Passengers (v5): adults plus children; children beyond the lap allowance take a seat. Older apps send seats only.
  const withDetails = input.adults != null;
  const adults = input.adults ?? input.seats ?? 1;
  const children = withDetails ? Math.max(0, input.children ?? 0) : 0;
  const offered = offeredLuggageTypes(settings);
  const luggage = withDetails ? Object.fromEntries(Object.entries(input.luggage ?? {}).filter(([type]) => (offered as string[]).includes(type))) : {};
  const language = withDetails && input.language && offeredLanguages(settings).some((l) => l.code === input.language) ? input.language : null;
  if (withDetails && input.language && !language && settings.languageEnabled) return c.json({ error: "language_not_offered", message: "That language isn't offered. Choose one from the list." }, 400);
  const payment = input.payment ?? "app";
  if (input.openTicket) {
    if (!settings.openTicketsEnabled || !(await openTicketColumnsReady())) return c.json({ error: "open_tickets_off", message: "Open tickets aren't available right now." }, 409);
    if (payment === "cash") return c.json({ error: "open_ticket_prepaid", message: "An open ticket is paid in the app, not in cash." }, 409);
  }
  if (withDetails && input.forSomeoneElse && !settings.bookForOthersEnabled) return c.json({ error: "for_others_off", message: "Booking for someone else isn't available right now." }, 409);
  if (withDetails && input.forSomeoneElse && (!input.travellerName || !input.travellerPhone || !input.emergencyPhone)) {
    return c.json({ error: "traveller_missing", message: "Add the traveller's name, phone and an emergency contact." }, 400);
  }
  const preview = priceBooking({ adults, children, luggage }, 0, settings);
  if (preview.error) return c.json({ error: "invalid_passengers", message: preview.error }, 400);
  const seatCount = preview.seats;
  if (seatCount + (children - preview.childSeats) > 18) return c.json({ error: "too_many_passengers", message: "A booking can carry up to 18 passengers." }, 400);
  if (seatCount > settings.maxSeatsPerBooking) return c.json({ error: "too_many_seats", message: `You can book up to ${settings.maxSeatsPerBooking} seats at a time.` }, 400);
  if (payment === "cash" && !settings.cashEnabled) return c.json({ error: "cash_off", message: "Cash isn't accepted right now. Pay in the app." }, 409);

  await releaseStaleBookings();
  const entry = (await db.execute({
    sql: `SELECT q.*, t.fare_per_seat, t.active AS tp_active, rr.active AS relay_active, t.direction, rr.stage_a_name, rr.stage_a_lat, rr.stage_a_lng, rr.stage_b_name, rr.stage_b_lat, rr.stage_b_lng
          FROM taxipress_queue q JOIN taxipress_routes t ON t.id = q.taxipress_route_id JOIN relay_routes rr ON rr.id = t.relay_route_id WHERE q.id = ?`,
    args: [input.queueId],
  })).rows[0] as Row | undefined;
  if (!entry) return c.json({ error: "not_found", message: "That taxi isn't available." }, 404);
  if (Number(entry.tp_active) !== 1 || Number(entry.relay_active) !== 1) return c.json({ error: "not_available", message: "That route isn't running." }, 409);
  if (entry.status !== "in_line" && entry.status !== "boarding") return c.json({ error: "not_available", message: "That taxi has left. Choose another." }, 409);
  // Only the first few taxis waiting behind the one Boarding Now can be booked (admin: bookable taxis).
  const line = await decorateLine(String(entry.taxipress_route_id), await lineOf(String(entry.taxipress_route_id)), settings);
  const spot = line.find((e) => e.id === input.queueId);
  if (entry.status === "boarding") return c.json({ error: "boarding_now", message: "This taxi is boarding now. Get on at the stage, or book one of the next taxis." }, 409);
  if (!spot?.bookable) return c.json({ error: "not_bookable_yet", message: `You can book the next ${settings.bookableTaxis} taxis in the line. Choose one of those.` }, 409);
  if (entry.driver_id === user.sub) return c.json({ error: "own_taxi", message: "You can't book a seat on your own taxi." }, 409);

  if (payment === "cash") {
    const open = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM taxipress_bookings WHERE passenger_id = ? AND payment_method = 'cash' AND status = 'booked'",
      args: [user.sub],
    });
    if (Number((open.rows[0] as Row).n) >= settings.maxCashBookings) {
      return c.json({ error: "too_many_cash_bookings", message: `You can hold ${settings.maxCashBookings} cash booking${settings.maxCashBookings === 1 ? "" : "s"} at a time. Pay in the app instead.` }, 409);
    }
  }

  const farePerSeat = Number(entry.fare_per_seat);
  const priced = priceBooking({ adults, children, luggage }, farePerSeat, settings);
  const amount = withDetails ? priced.amount : farePerSeat * seatCount;
  if (!(amount > 0)) return c.json({ error: "no_fare", message: "This route has no fare set yet." }, 409);

  // Race-safe: only one request can take the last seats, and only while the taxi is still in the line.
  const taken = await db.execute({
    sql: `UPDATE taxipress_queue SET seats_booked = seats_booked + ?, updated_at = datetime('now')
          WHERE id = ? AND status IN ('in_line', 'boarding') AND seats_booked + walk_up_seats + ? <= seats_total`,
    args: [seatCount, input.queueId, seatCount],
  });
  if (taken.rowsAffected === 0) return c.json({ error: "not_available", message: "Those seats aren't available any more." }, 409);
  const release = () =>
    db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?), updated_at = datetime('now') WHERE id = ?", args: [seatCount, input.queueId] });

  const environment = (await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live";
  const aToB = entry.direction === "a_to_b";
  const from = { name: String(aToB ? entry.stage_a_name : entry.stage_b_name), lat: Number(aToB ? entry.stage_a_lat : entry.stage_b_lat), lng: Number(aToB ? entry.stage_a_lng : entry.stage_b_lng) };
  const to = { name: String(aToB ? entry.stage_b_name : entry.stage_a_name), lat: Number(aToB ? entry.stage_b_lat : entry.stage_a_lat), lng: Number(aToB ? entry.stage_b_lng : entry.stage_a_lng) };
  const listId = newId("list");
  try {
    await db.execute({
      sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'draft', ?)",
      args: [listId, user.sub, `Taxipress: ${from.name} → ${to.name}`, environment],
    });
    const response = await createOrderFromInput(
      c,
      {
        listId, type: "parcel", isRide: true,
        pickupAddress: from.name, pickupLat: from.lat, pickupLng: from.lng,
        destinationAddress: to.name, destinationLat: to.lat, destinationLng: to.lng,
        paymentRail: payment === "cash" ? "float" : "escrow",
      },
      { fare: amount, matchingMode: "first_to_claim", allowConcurrent: true },
    );
    if (response.status >= 400) {
      await release();
      return response;
    }
    const order = ((await response.clone().json()) as { order: Row }).order;
    const orderId = String(order.id);
    const bookingId = newId("tpb");
    await db.execute({
      sql: `INSERT INTO taxipress_bookings (id, order_id, queue_id, taxipress_route_id, passenger_id, driver_id, seats, fare_per_seat, amount, payment_method, ticket_code, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [bookingId, orderId, input.queueId, String(entry.taxipress_route_id), user.sub, String(entry.driver_id), seatCount, farePerSeat, amount, payment, newTicketCode(), environment],
    });
    if (input.openTicket) await markOpenTicket(bookingId);
    if (withDetails) {
      await saveDetails(bookingId, {
        adults, children, childSeats: priced.childSeats, luggage, luggageAmount: priced.luggageAmount,
        assistance: settings.assistanceEnabled ? (input.assistance ?? null) : null,
        language,
        forSomeoneElse: !!input.forSomeoneElse,
        travellerName: input.forSomeoneElse ? (input.travellerName ?? null) : null,
        travellerPhone: input.forSomeoneElse ? (input.travellerPhone ?? null) : null,
        emergencyPhone: input.emergencyPhone ?? null,
      }, { customerId: user.sub, environment });
    }
    // The seat belongs to this taxi's driver from the start; the passenger pays next.
    await db.execute({ sql: "UPDATE orders SET rider_id = ?, stage = 'Match', updated_at = datetime('now') WHERE id = ? AND rider_id IS NULL", args: [String(entry.driver_id), orderId] });
    await db.execute({ sql: "UPDATE chat_messages SET rider_id = ? WHERE order_id = ? AND rider_id IS NULL", args: [String(entry.driver_id), orderId] });
    await db.execute({
      sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Match', ?, ?)",
      args: [newId("evt"), orderId, `Booked ${seatCount} seat${seatCount === 1 ? "" : "s"} on a Taxipress taxi`, user.sub],
    });
    await notifyUser(String(entry.driver_id), {
      title: "Seat booked",
      body: `${seatCount} seat${seatCount === 1 ? "" : "s"} booked on your taxi.`,
      url: "/taxipress",
      tag: `taxipress-${input.queueId}`,
    }).catch(() => {});
    const booking = await bookingFor(bookingId, user.sub);
    return c.json({ booking, order: { ...order, rider_id: entry.driver_id, stage: "Match" } }, 201);
  } catch (err) {
    await release();
    console.error("Taxipress booking failed:", err);
    return c.json({ error: "booking_failed", message: "Couldn't book those seats. Please try again." }, 500);
  }
}
