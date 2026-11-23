import { db, executeBatch } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn } from "../lib/schema.js";
import { notifyUser } from "../lib/webpush.js";
import { getTaxipressSettings } from "./settings.js";
import { TaxipressError, type LineEntry } from "./queue.js";
import { cleanupSeatHolds } from './seats.js';

type Row = Record<string, unknown>;

/** Until migration 0145 is applied there are no open tickets, whatever staff set. */
export const openTicketColumnsReady = () => hasColumn("taxipress_bookings", "open_ticket");

export type OpenTicketInfo = { validUntil: string | null; expired: boolean };

/** Whether (and until when) a booking is an open ticket. Null for an ordinary booking. */
export async function openTicketOf(bookingId: string): Promise<OpenTicketInfo | null> {
  if (!(await openTicketColumnsReady())) return null;
  const row = (await db.execute({ sql: "SELECT open_ticket, valid_until FROM taxipress_bookings WHERE id = ?", args: [bookingId] })).rows[0] as Row | undefined;
  if (!row || Number(row.open_ticket) !== 1) return null;
  const validUntil = (row.valid_until as string | null) ?? null;
  return { validUntil, expired: validUntil != null && Date.parse(`${validUntil.replace(" ", "T")}Z`) <= Date.now() };
}

/** Makes a fresh booking an open ticket, valid for the days staff set (0 = never expires). */
export async function markOpenTicket(bookingId: string): Promise<void> {
  const { openTicketValidityDays } = await getTaxipressSettings();
  const until = openTicketValidityDays > 0 ? new Date(Date.now() + openTicketValidityDays * 86_400_000).toISOString().slice(0, 19).replace("T", " ") : null;
  await db.execute({ sql: "UPDATE taxipress_bookings SET open_ticket = 1, valid_until = ?, updated_at = datetime('now') WHERE id = ?", args: [until, bookingId] });
}

/**
 * The driver confirmed the code of an open ticket that is on a different taxi: the passenger was late, missed their taxi,
 * or simply took the first one. Moves the ticket onto this taxi (if it has room), so the usual boarding settles it.
 * Returns false when the ticket is not an open ticket (the caller then reports the wrong taxi).
 */
export async function moveOpenTicketOnto(booking: Row, entry: LineEntry & { taxipressRouteId: string }, driverId: string): Promise<boolean> {
  await cleanupSeatHolds();
  if (!(await openTicketColumnsReady())) return false;
  const info = await openTicketOf(String(booking.id));
  if (!info) return false;
  if (String(booking.taxipress_route_id ?? "") && String(booking.taxipress_route_id) !== entry.taxipressRouteId) {
    throw new TaxipressError(409, "wrong_route", "This open ticket is for a different route.");
  }
  if (info.expired) throw new TaxipressError(409, "ticket_expired", "This open ticket has expired.");
  const seats = Number(booking.seats);
  const oldQueue = String(booking.queue_id);
  const result = await executeBatch([{
    sql: `UPDATE taxipress_queue SET seats_booked = seats_booked + ?, updated_at = datetime('now')
          WHERE id = ? AND status IN ('in_line', 'boarding') AND seats_booked + walk_up_seats + ? <= seats_total`,
    args: [seats, entry.id, seats],
  },{
    sql: "UPDATE taxipress_bookings SET queue_id = ?, driver_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'booked' AND queue_id = ? AND changes() = 1",
    args: [entry.id, driverId, String(booking.id), oldQueue],
  }]).catch(() => { throw new TaxipressError(409,'no_room','This taxi cannot accommodate the seats on this open ticket.'); });
  if (result[0] === 0) throw new TaxipressError(409, "no_room", "This taxi has no room for the seats on this open ticket.");
  if (result[1] === 0) {
    await db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?) WHERE id = ?", args: [seats, entry.id] });
    throw new TaxipressError(409, "not_valid", "This ticket was already dealt with.");
  }
  await db.execute({ sql: "UPDATE taxipress_queue SET seats_booked = MAX(0, seats_booked - ?), updated_at = datetime('now') WHERE id = ?", args: [seats, oldQueue] });
  const orderId = String(booking.order_id);
  await db.execute({ sql: "UPDATE orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?", args: [driverId, orderId] });
  await db.execute({ sql: "UPDATE chat_messages SET rider_id = ? WHERE order_id = ?", args: [driverId, orderId] });
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Match', 'Open ticket used on another taxi', ?)",
    args: [newId("evt"), orderId, driverId],
  });
  await notifyUser(String(booking.passenger_id), { title: "Open ticket accepted", body: "The driver accepted your open ticket.", url: `/ride/taxipress/ticket/${String(booking.id)}`, tag: `taxipress-open-${String(booking.id)}` }).catch(() => {});
  return true;
}
