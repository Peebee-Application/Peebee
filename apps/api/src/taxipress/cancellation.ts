import { db, executeBatch } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { notifyUser } from "../lib/webpush.js";
import { creditWallet, refundToWallet } from "../wallet/service.js";
import { bookingsReady } from "./bookings.js";
import { openTicketColumnsReady, openTicketOf } from "./open-tickets.js";
import { cancelTermsFor, collectedFor, feeOf, minutesSince, type CancelTerms } from "./cancel-terms.js";
import { activeEntry, lineOf, TaxipressError } from "./queue.js";
import { getTaxipressSettings } from "./settings.js";
import { cleanupSeatHolds } from './seats.js';

type Row = Record<string, unknown>;

const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

/** Until migration 0127 is applied (after 0125) there is no cancellation or refund. */
export async function refundsReady(): Promise<boolean> {
  return (await bookingsReady()) && (await hasTable("taxipress_refunds"));
}

export type BookingOutcome = { kind: "cancelled" | "no_show" | "taxi_removed"; refunded: number; fee: number };

const BOOKING = `SELECT b.id, b.order_id, b.queue_id, b.taxipress_route_id, b.passenger_id, b.driver_id, b.seats, b.amount, b.payment_method, b.status, b.created_at, b.environment,
    q.status AS queue_status, q.boarding_at, o.list_id
  FROM taxipress_bookings b JOIN taxipress_queue q ON q.id = b.queue_id JOIN orders o ON o.id = b.order_id`;

/**
 * Ends a booking that did not board: marks it, cancels its order, gives back what escrow holds less any fee
 * kept, and pays the fee to the driver when staff set it so. A booking is ended once: the claim and the
 * unique refund row make a retry safe.
 */
async function endBooking(
  row: Row,
  kind: BookingOutcome["kind"],
  feePercent: number,
  opts: { releaseSeats: boolean; note: string },
): Promise<BookingOutcome> {
  const settings = await getTaxipressSettings();
  const bookingId = String(row.id);
  const orderId = String(row.order_id);
  const claimed = await db.execute({
    sql: "UPDATE taxipress_bookings SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'booked' AND queue_id = ?",
    args: [kind === "no_show" ? "no_show" : "cancelled", bookingId,String(row.queue_id)],
  });
  if (claimed.rowsAffected === 0) throw new TaxipressError(409, "not_cancellable", "This booking has already been dealt with.");

  const method = row.payment_method === "cash" ? "cash" : "app";
  const collected = method === "app" ? await collectedFor(orderId) : 0;
  const fee = collected > 0 ? feeOf(Number(row.amount), feePercent, collected) : 0;
  const refunded = collected - fee;
  const environment = row.environment === "sandbox" ? "sandbox" : "live";
  const driverId = (row.driver_id as string | null) ?? null;

  await db.execute({
    sql: `INSERT INTO taxipress_refunds (id, booking_id, order_id, passenger_id, driver_id, kind, payment_method, collected, refunded, fee, fee_to, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId("tpf"), bookingId, orderId, String(row.passenger_id), driverId, kind, method, collected, refunded, fee, settings.feeTo, environment],
  });
  await db.execute({ sql: "UPDATE orders SET stage = 'Cancelled', updated_at = datetime('now') WHERE id = ? AND stage != 'Settle'", args: [orderId] });
  if (opts.releaseSeats) {
    await db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?), updated_at = datetime('now') WHERE id = ?", args: [Number(row.seats), String(row.queue_id)] });
  }

  if (refunded > 0) {
    await db.execute({
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status) VALUES (?, ?, 'refund', 'wallet', NULL, ?, 'UGX', 'successful')`,
      args: [newId("pay"), orderId, refunded],
    });
    await refundToWallet(String(row.passenger_id), refunded, { orderId, environment, note: opts.note, actorId: String(row.passenger_id) });
  }
  if (fee > 0 && settings.feeTo === "driver" && driverId) {
    await creditWallet(driverId, fee, { type: "adjustment", environment, orderId, note: kind === "no_show" ? "Taxipress no-show fee" : "Taxipress late cancellation fee", actorId: driverId });
  }
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Cancelled', ?, ?)",
    args: [newId("evt"), orderId, `${opts.note}${refunded > 0 ? ` — ${ugx(refunded)} refunded` : ""}${fee > 0 ? `, ${ugx(fee)} kept` : ""}`, String(row.passenger_id)],
  });
  return { kind, refunded, fee };
}

/** The terms a passenger would get if they cancelled this booking now (for the ticket screen). */
export async function cancelTermsOf(booking: { status: string; queueStatus: string; method: "app" | "cash"; amount: number; createdAt: string; orderId: string; openTicket?: boolean }): Promise<CancelTerms> {
  const settings = await getTaxipressSettings();
  const collected = booking.method === "app" && booking.status === "booked" ? await collectedFor(booking.orderId) : 0;
  return cancelTermsFor({ ...booking, collected }, settings);
}

/** A passenger cancels a seat before boarding. */
export async function cancelBooking(passengerId: string, bookingId: string): Promise<BookingOutcome> {
  if (!(await refundsReady())) throw new TaxipressError(503, "taxipress_unavailable", "Cancellation isn't set up yet.");
  const row = (await db.execute({ sql: `${BOOKING} WHERE b.id = ? AND b.passenger_id = ?`, args: [bookingId, passengerId] })).rows[0] as Row | undefined;
  if (!row) throw new TaxipressError(404, "not_found", "That booking wasn't found.");
  const method = row.payment_method === "cash" ? "cash" : "app";
  const open = (await openTicketOf(bookingId)) != null;
  const terms = await cancelTermsOf({ status: String(row.status), queueStatus: String(row.queue_status), method, amount: Number(row.amount), createdAt: String(row.created_at), orderId: String(row.order_id), openTicket: open });
  if (!terms.allowed) throw new TaxipressError(409, "not_cancellable", terms.reason ?? "This booking can't be cancelled.");
  const settings = await getTaxipressSettings();
  const outcome = await endBooking(row, "cancelled", terms.free ? 0 : open ? 100 - settings.openTicketRefundPercent : settings.cancelRetentionPercent, { releaseSeats: true, note: "Passenger cancelled before boarding" });
  if (row.driver_id) {
    await notifyUser(String(row.driver_id), { title: "A passenger cancelled", body: `${Number(row.seats)} seat${Number(row.seats) === 1 ? "" : "s"} are free again.`, url: "/taxipress", tag: `taxipress-cancel-${bookingId}` }).catch(() => {});
  }
  return outcome;
}

/** The driver marks a passenger who has not turned up as a no-show, once the taxi has been boarding long enough. */
export async function markNoShow(driverId: string, bookingId: string): Promise<BookingOutcome> {
  if (!(await refundsReady())) throw new TaxipressError(503, "taxipress_unavailable", "No-shows aren't set up yet.");
  const entry = await activeEntry(driverId);
  if (!entry) throw new TaxipressError(404, "not_in_line", "You aren't in a line.");
  if (entry.status !== "boarding") throw new TaxipressError(409, "not_boarding", "Tap Boarding now first.");
  const row = (await db.execute({ sql: `${BOOKING} WHERE b.id = ? AND b.queue_id = ?`, args: [bookingId, entry.id] })).rows[0] as Row | undefined;
  if (!row) throw new TaxipressError(404, "not_found", "That passenger isn't on your taxi.");
  if (row.status !== "booked") throw new TaxipressError(409, "not_cancellable", "This passenger has already boarded or cancelled.");
  const settings = await getTaxipressSettings();
  const waited = entry.boardingAt ? minutesSince(entry.boardingAt) : 0;
  if (waited < settings.noShowMinutes) {
    throw new TaxipressError(409, "too_early", `Wait ${settings.noShowMinutes - waited} more minute${settings.noShowMinutes - waited === 1 ? "" : "s"} before marking a no-show.`);
  }
  const outcome = await endBooking(row, "no_show", settings.noShowFeePercent, { releaseSeats: true, note: "Passenger did not board" });
  await notifyUser(String(row.passenger_id), {
    title: "You missed your taxi",
    body: outcome.refunded > 0 ? `${ugx(outcome.refunded)} was refunded to your wallet${outcome.fee > 0 ? ` (${ugx(outcome.fee)} kept)` : ""}.` : "Your seat was released.",
    url: `/ride/taxipress/ticket/${bookingId}`,
    tag: `taxipress-noshow-${bookingId}`,
  }).catch(() => {});
  return outcome;
}

/** A taxi has gone on the road: anyone booked who did not board is a no-show. */
export async function markRemainingNoShows(queueId: string): Promise<number> {
  if (!(await refundsReady())) return 0;
  const settings = await getTaxipressSettings();
  // An open ticket outlives its taxi: it stays valid for any other taxi on the route.
  const keepOpen = (await openTicketColumnsReady()) ? " AND b.open_ticket = 0" : "";
  const rows = (await db.execute({ sql: `${BOOKING} WHERE b.queue_id = ? AND b.status = 'booked'${keepOpen}`, args: [queueId] })).rows as Row[];
  let done = 0;
  for (const row of rows) {
    try {
      const outcome = await endBooking(row, "no_show", settings.noShowFeePercent, { releaseSeats: false, note: "Passenger did not board before the taxi left" });
      done += 1;
      await notifyUser(String(row.passenger_id), {
        title: "Your taxi has left",
        body: outcome.refunded > 0 ? `${ugx(outcome.refunded)} was refunded to your wallet${outcome.fee > 0 ? ` (${ugx(outcome.fee)} kept)` : ""}.` : "Your seat was released.",
        url: `/ride/taxipress/ticket/${String(row.id)}`,
        tag: `taxipress-left-${String(row.id)}`,
      }).catch(() => {});
    } catch {
      // Already dealt with by another request.
    }
  }
  return done;
}

/**
 * A taxi has left the line before departing (the driver left, staff removed it, or it was suspended). Its
 * booked passengers move to the next taxi with room, or, when there is none (or staff turned moving off), are
 * refunded in full. Passengers who already boarded were settled and are not touched.
 */
export async function reassignOrRefund(queueId: string): Promise<{ moved: number; refunded: number }> {
  await cleanupSeatHolds();
  if (!(await refundsReady())) return { moved: 0, refunded: 0 };
  const settings = await getTaxipressSettings();
  const rows = (await db.execute({ sql: `${BOOKING} WHERE b.queue_id = ? AND b.status = 'booked'`, args: [queueId] })).rows as Row[];
  if (rows.length === 0) return { moved: 0, refunded: 0 };
  const routeId = String(rows[0].taxipress_route_id);
  let moved = 0;
  let refunded = 0;

  bookingLoop: for (const row of rows) {
    const seats = Number(row.seats);
    let target: { id: string; driverId: string; plate: string } | null = null;
    if (settings.rebookOnRemoval) {
      for (const candidate of await lineOf(routeId)) {
        if (candidate.id === queueId) continue;
        const result = await executeBatch([{
          sql: `UPDATE taxipress_queue SET seats_booked = seats_booked + ?, updated_at = datetime('now')
                WHERE id = ? AND status IN ('in_line', 'boarding') AND seats_booked + walk_up_seats + ? <= seats_total`,
          args: [seats, candidate.id, seats],
        },{ sql: "UPDATE taxipress_bookings SET queue_id = ?, driver_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'booked' AND queue_id = ? AND changes() = 1",
          args: [candidate.id,candidate.driverId,String(row.id),queueId] }]).catch(e => {
            if (/taxipress_seat_conflict|UNIQUE constraint failed: taxipress_seat_claims/.test(String(e))) return null;
            throw e;
          });
        if (result && result[0] > 0 && result[1] === 0) {
          await db.execute({ sql: 'UPDATE taxipress_queue SET seats_booked = MAX(0,seats_booked - ?) WHERE id = ?',args: [seats,candidate.id] });
          continue bookingLoop;
        }
        if (result && result[1] > 0) {
          target = { id: candidate.id, driverId: candidate.driverId, plate: candidate.plate };
          break;
        }
      }
    }
    if (target) {
      await db.execute({ sql: "UPDATE orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?", args: [target.driverId, String(row.order_id)] });
      await db.execute({ sql: "UPDATE chat_messages SET rider_id = ? WHERE order_id = ?", args: [target.driverId, String(row.order_id)] });
      await db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?), updated_at = datetime('now') WHERE id = ?", args: [seats, queueId] });
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Match', ?, ?)",
        args: [newId("evt"), String(row.order_id), `Taxi left the line — moved to ${target.plate}`, target.driverId],
      });
      moved += 1;
      await notifyUser(String(row.passenger_id), { title: "Your taxi changed", body: `Your taxi left the line. You are now on ${target.plate}.`, url: `/ride/taxipress/ticket/${String(row.id)}`, tag: `taxipress-moved-${String(row.id)}` }).catch(() => {});
      await notifyUser(target.driverId, { title: "Passengers moved to your taxi", body: `${seats} seat${seats === 1 ? "" : "s"} were moved to you.`, url: "/taxipress", tag: `taxipress-moved-in-${String(row.id)}` }).catch(() => {});
      continue;
    }
    try {
      const outcome = await endBooking(row, "taxi_removed", 0, { releaseSeats: false, note: "Taxi left the line and no other taxi had room" });
      refunded += 1;
      await notifyUser(String(row.passenger_id), {
        title: "Your taxi left the line",
        body: outcome.refunded > 0 ? `${ugx(outcome.refunded)} was refunded to your wallet. Please book another taxi.` : "Your booking was cancelled. Please book another taxi.",
        url: "/ride/taxipress",
        tag: `taxipress-removed-${String(row.id)}`,
      }).catch(() => {});
    } catch {
      // Already dealt with by another request.
    }
  }
  return { moved, refunded };
}

/** Open tickets past their valid-until date are ended and refunded as staff set (lazily, whenever tickets are listed). */
export async function expireOpenTickets(): Promise<number> {
  if (!(await refundsReady()) || !(await openTicketColumnsReady())) return 0;
  const settings = await getTaxipressSettings();
  const rows = (await db.execute({
    sql: `${BOOKING} WHERE b.status = 'booked' AND b.open_ticket = 1 AND b.valid_until IS NOT NULL AND b.valid_until <= datetime('now')`,
    args: [],
  })).rows as Row[];
  let done = 0;
  for (const row of rows) {
    try {
      const outcome = await endBooking(row, "cancelled", 100 - settings.openTicketRefundPercent, { releaseSeats: true, note: "Open ticket expired" });
      done += 1;
      await notifyUser(String(row.passenger_id), {
        title: "Your open ticket expired",
        body: outcome.refunded > 0 ? `${ugx(outcome.refunded)} was refunded to your wallet.` : "It was not used in time.",
        url: `/ride/taxipress/ticket/${String(row.id)}`,
        tag: `taxipress-open-expired-${String(row.id)}`,
      }).catch(() => {});
    } catch {
      // Already dealt with by another request.
    }
  }
  return done;
}
