import { db, executeBatch } from '../db/client.js';
import { hasColumn, hasTable } from '../lib/schema.js';
import { newId } from '../lib/ids.js';
import { getTaxipressSettings } from './settings.js';

type Row = Record<string, unknown>;
export class SeatError extends Error {
  constructor(public status: 400 | 404 | 409 | 503, public code: string, message: string) { super(message); }
}
export const SEAT_LABELS = {
  '14': ['1A','1B','2A','2B','2C','3A','3B','3C','4A','4B','4C','5A','5B','5C'],
  '18': ['1A','1B','2A','2B','2C','2D','3A','3B','3C','3D','4A','4B','4C','4D','5A','5B','5C','5D'],
};
export async function seatingReady() {
  return await hasTable('taxipress_seat_maps') && await hasTable('taxipress_seat_reservations')
    && await hasTable('taxipress_seat_claims') && await hasColumn('taxipress_bookings','seat_reservation_id');
}
export async function cleanupSeatHolds() {
  if (!(await seatingReady())) return;
  await db.execute("DELETE FROM taxipress_seat_reservations WHERE state IN ('held','reserved') AND expires_at <= datetime('now') AND booking_id IS NULL");
}
export async function numberedDeparture(queueId: string) {
  if (!(await seatingReady())) return false;
  return !!(await db.execute({ sql: 'SELECT 1 FROM taxipress_seat_maps WHERE queue_id = ?', args: [queueId] })).rows.length;
}
export async function heldSeatCount(queueId: string) {
  if (!(await seatingReady())) return 0;
  return Number((await db.execute({ sql: `SELECT COALESCE(SUM(quantity),0) AS n FROM taxipress_seat_reservations
    WHERE queue_id = ? AND state = 'held' AND expires_at > datetime('now')`, args: [queueId] })).rows[0]?.n ?? 0);
}
export async function bookingSeats(bookingId: string) {
  if (!(await seatingReady())) return { seatNumbers: [] as string[], seatChoiceFee: 0 };
  const rows = (await db.execute({ sql: `SELECT c.seat,r.fee FROM taxipress_seat_reservations r
    LEFT JOIN taxipress_seat_claims c ON c.reservation_id = r.id WHERE r.booking_id = ? ORDER BY c.seat`, args: [bookingId] })).rows as Row[];
  return { seatNumbers: rows.flatMap(r => r.seat ? [String(r.seat)] : []), seatChoiceFee: Number(rows[0]?.fee ?? 0) };
}
export async function seatMap(queueId: string, passengerId?: string) {
  await cleanupSeatHolds();
  const settings = await getTaxipressSettings();
  const off = { enabled: false, queueId, seats: [], hold: null, feePerSeat: settings.seatChoiceFeeUgx, holdSeconds: settings.seatHoldSeconds };
  if (!(await seatingReady())) return off;
  const map = (await db.execute({ sql: `SELECT m.*,q.status FROM taxipress_seat_maps m JOIN taxipress_queue q ON q.id = m.queue_id
    WHERE m.queue_id = ?`, args: [queueId] })).rows[0] as Row | undefined;
  if (!map || !['in_line','boarding'].includes(String(map.status))) return off;
  const claims = (await db.execute({ sql: `SELECT c.seat,c.walk_up,r.id,r.passenger_id,r.state,r.expires_at,r.fee
    FROM taxipress_seat_claims c LEFT JOIN taxipress_seat_reservations r ON r.id = c.reservation_id WHERE c.queue_id = ?`, args: [queueId] })).rows as Row[];
  const mine = passengerId ? claims.find(r => r.state === 'held' && r.passenger_id === passengerId) : undefined;
  return { ...off, enabled: true, layout: map.layout as '14' | '18',
    seats: (JSON.parse(String(map.labels)) as string[]).map(id => {
      const c = claims.find(r => r.seat === id);
      return { id, status: !c ? 'available' : c.state === 'held' ? c.passenger_id === passengerId ? 'mine' : 'held' : 'occupied' };
    }),
    hold: mine ? { id: String(mine.id), seats: claims.filter(c => c.id === mine.id).map(c => String(c.seat)),
      expiresAt: String(mine.expires_at).replace(' ','T') + 'Z', fee: Number(mine.fee) } : null };
}

/** A unique claim per physical seat, checked with the header in one transaction. */
export async function createSeatHold(queueId: string, passengerId: string, quantity: number, requested?: string[]) {
  await cleanupSeatHolds();
  const settings = await getTaxipressSettings();
  if (!settings.enabled || !(await numberedDeparture(queueId))) throw new SeatError(409,'numbered_seats_off','Numbered seats are not offered on this departure.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > settings.maxSeatsPerBooking) throw new SeatError(400,'invalid_seats','Choose an allowed number of passenger seats.');
  const selected = requested?.length ? requested : null;
  if (selected && (selected.length !== quantity || new Set(selected).size !== quantity)) throw new SeatError(400,'invalid_seats','Choose exactly one different seat for every reserved space.');
  const id = newId('tpsh'), fee = selected ? settings.seatChoiceFeeUgx * quantity : 0;
  const expiry = new Date(Date.now() + settings.seatHoldSeconds * 1000).toISOString().slice(0,19).replace('T',' ');
  try {
    await executeBatch([
      { sql: "DELETE FROM taxipress_seat_reservations WHERE passenger_id = ? AND state = 'held'", args: [passengerId] },
      { sql: "INSERT INTO taxipress_seat_reservations(id,queue_id,passenger_id,quantity,chosen,fee,state,expires_at) VALUES (?,?,?,?,?,?,'draft',?)", args: [id,queueId,passengerId,quantity,selected ? 1 : 0,fee,expiry] },
      { sql: `INSERT INTO taxipress_seat_claims(queue_id,seat,reservation_id)
        SELECT m.queue_id,j.value,? FROM taxipress_seat_maps m,json_each(m.labels) j
        WHERE m.queue_id = ? AND (? IS NULL OR j.value IN (SELECT value FROM json_each(?)))
          AND NOT EXISTS (SELECT 1 FROM taxipress_seat_claims c WHERE c.queue_id = m.queue_id AND c.seat = j.value)
        ORDER BY CAST(j.key AS INTEGER) LIMIT ?`, args: [id,queueId,selected ? 'chosen' : null,JSON.stringify(selected || []),quantity] },
      { sql: "UPDATE taxipress_seat_reservations SET state = 'held' WHERE id = ?", args: [id] },
    ]);
  } catch {
    throw new SeatError(409,'seat_conflict','A selected seat is no longer available. Refresh and choose again.');
  }
  return { id, quantity, fee, expiresAt: expiry.replace(' ','T')+'Z' };
}
export async function releaseSeatHold(id: string, passengerId: string) {
  if (!(await seatingReady())) return;
  await db.execute({ sql: "DELETE FROM taxipress_seat_reservations WHERE id = ? AND passenger_id = ? AND state = 'held'", args: [id,passengerId] });
}
/** Older clients get an automatic allocation, at no seat-choice fee. */
export async function reserveNumberedBooking(queueId: string, passengerId: string, quantity: number, holdId?: string) {
  if (!(await numberedDeparture(queueId))) {
    if (holdId) throw new SeatError(409,'hold_invalid','This departure does not accept that seat hold.');
    return null;
  }
  const id = holdId || (await createSeatHold(queueId,passengerId,quantity)).id;
  const settings = await getTaxipressSettings();
  const changed = await db.execute({ sql: `UPDATE taxipress_seat_reservations SET state = 'reserved',expires_at = datetime('now',?)
    WHERE id = ? AND passenger_id = ? AND queue_id = ? AND quantity = ? AND state = 'held'`,
    args: [`+${settings.payWithinMinutes} minutes`,id,passengerId,queueId,quantity] }).catch(() => { throw new SeatError(409,'hold_expired','Your seat hold expired or the departure changed. Select your seats again.'); });
  if (!changed.rowsAffected) throw new SeatError(409,'hold_invalid','This seat hold is no longer usable. Select your seats again.');
  const row = (await db.execute({ sql: 'SELECT fee,chosen FROM taxipress_seat_reservations WHERE id = ?',args: [id] })).rows[0];
  return { id, fee: Number(row.fee),chosen: Number(row.chosen) === 1 };
}
export async function releaseReservedBooking(id: string) {
  await db.execute({ sql: "DELETE FROM taxipress_seat_reservations WHERE id = ? AND state = 'reserved' AND booking_id IS NULL", args: [id] });
}
