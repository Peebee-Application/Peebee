import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { computeCheckoutFees, riderPayout } from "../lib/monetization.js";
import { getMonetizationSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditRiderWorkWallet, debitRiderWorkWalletAllowNegative } from "../wallet/rider-work-wallet.js";
import { bookingsReady } from "./bookings.js";
import { moveOpenTicketOnto, openTicketOf } from "./open-tickets.js";
import { activeEntry, TaxipressError } from "./queue.js";
import { getTaxipressSettings, type TaxipressSettings } from "./settings.js";

type Row = Record<string, unknown>;

const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

/** Until migration 0126 is applied (after 0125) there is no boarding confirmation. */
export async function settlementsReady(): Promise<boolean> {
  return (await bookingsReady()) && (await hasTable("taxipress_settlements"));
}

/**
 * Peebee's Taxipress commission on a booking's fare: a percentage (cash and digital can differ) or a flat
 * amount per seat, as staff set it. Never more than the fare itself.
 */
export function commissionFor(
  settings: Pick<TaxipressSettings, "commissionType" | "commissionDigitalPercent" | "commissionCashPercent" | "commissionFlatUgx">,
  method: "app" | "cash",
  fare: number,
  seats: number,
): { amount: number; rule: string } {
  const raw = settings.commissionType === "flat"
    ? settings.commissionFlatUgx * seats
    : Math.round((fare * (method === "cash" ? settings.commissionCashPercent : settings.commissionDigitalPercent)) / 100);
  return { amount: Math.max(0, Math.min(raw, fare)), rule: settings.commissionType };
}

export type BoardingResult = {
  bookingId: string;
  passengerName: string | null;
  seats: number;
  fare: number;
  paymentMethod: "app" | "cash";
  commission: number;
  /** App payment: added to the driver's wallet. Cash: what the driver keeps of the cash they collected. */
  driverAmount: number;
  /** Cash only: Peebee's cut, taken from the driver's wallet (which may go below zero). */
  takenFromDriver: number;
  /** The driver's wallet balance after a cash commission was taken. */
  driverBalance: number | null;
};

/** A passenger gives the driver their ticket code (or shows the QR). The driver confirms it and the seat is settled. */
export async function confirmBoarding(driverId: string, rawCode: string): Promise<BoardingResult> {
  if (!(await settlementsReady())) throw new TaxipressError(503, "taxipress_unavailable", "Boarding isn't set up yet.");
  const entry = await activeEntry(driverId);
  if (!entry) throw new TaxipressError(404, "not_in_line", "You aren't in a line.");
  if (entry.status !== "boarding") throw new TaxipressError(409, "not_boarding", "Tap Boarding now before you confirm passengers.");

  let code = rawCode.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) code = `TXP-${code}`;
  const booking = (await db.execute({
    sql: `SELECT b.id, b.order_id, b.queue_id, b.passenger_id, b.seats, b.amount, b.payment_method, b.status, b.environment, u.name AS passenger_name
          FROM taxipress_bookings b LEFT JOIN users u ON u.id = b.passenger_id WHERE b.ticket_code = ?`,
    args: [code],
  })).rows[0] as Row | undefined;
  if (!booking) throw new TaxipressError(404, "code_not_found", "That code doesn't match a ticket.");
  const open = await openTicketOf(String(booking.id));
  if (open?.expired) throw new TaxipressError(409, "ticket_expired", "This open ticket has expired.");
  if (String(booking.queue_id) !== entry.id) {
    // An open ticket is good on any taxi on its route: it moves onto this one.
    const full = (await db.execute({ sql: "SELECT taxipress_route_id, queue_id, seats, order_id, passenger_id, id FROM taxipress_bookings WHERE id = ?", args: [String(booking.id)] })).rows[0] as Row;
    if (booking.status === "booked" && (await moveOpenTicketOnto(full, entry, driverId))) booking.queue_id = entry.id;
    else throw new TaxipressError(409, "wrong_taxi", "This ticket is for a different taxi.");
  }
  if (booking.status === "boarded" || booking.status === "completed") throw new TaxipressError(409, "already_boarded", "This passenger has already boarded.");
  if (booking.status !== "booked") throw new TaxipressError(409, "not_valid", "This booking was cancelled.");

  const orderId = String(booking.order_id);
  const order = (await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (!order || order.stage === "Cancelled") throw new TaxipressError(409, "not_valid", "This booking was cancelled.");

  const method = booking.payment_method === "cash" ? "cash" : "app";
  const fare = Number(booking.amount);
  const seats = Number(booking.seats);
  const environment = booking.environment === "sandbox" ? "sandbox" : "live";
  const settings = await getTaxipressSettings();
  const commission = commissionFor(settings, method, fare, seats);

  let driverAmount: number;
  let takenFromDriver = 0;
  let platformFees = 0;
  let commissionTaken: number;
  if (method === "app") {
    // What escrow actually collected, less the fees locked in when the passenger paid (the same release the order settle uses).
    const collected = Number(((await db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful'",
      args: [orderId],
    })).rows[0] as Row).collected ?? 0);
    if (collected <= 0) throw new TaxipressError(409, "not_paid", "This passenger hasn't paid yet. Ask them to pay in the app, or take cash if you agree.");
    const feesRow = (await db.execute({ sql: "SELECT * FROM order_fees WHERE order_id = ?", args: [orderId] })).rows[0] as Row | undefined;
    const payout = feesRow
      ? riderPayout(collected, {
          serviceFee: Number(feesRow.service_fee) || 0,
          processingFeeCustomer: Number(feesRow.processing_fee_customer) || 0,
          processingFeeRider: Number(feesRow.processing_fee_rider) || 0,
          deliveryCommission: Number(feesRow.delivery_commission) || 0,
          totalSurcharge: (Number(feesRow.service_fee) || 0) + (Number(feesRow.processing_fee_customer) || 0),
        })
      : collected;
    platformFees = collected - payout;
    commissionTaken = Math.min(commission.amount, payout);
    driverAmount = payout - commissionTaken;
  } else {
    // The passenger confirmed the booking on the order and hands the driver the cash.
    if (order.stage === "Match") throw new TaxipressError(409, "not_confirmed", "Ask the passenger to confirm the booking in the app first.");
    const fees = computeCheckoutFees(await getMonetizationSettings(), { baseAmount: fare, deliveryFee: Number(order.delivery_fee ?? 0), orderType: "parcel", payingWithWallet: false });
    platformFees = Math.min(fare, fees.totalSurcharge + fees.deliveryCommission + fees.processingFeeRider);
    commissionTaken = Math.min(commission.amount, fare - platformFees);
    takenFromDriver = commissionTaken + platformFees;
    driverAmount = fare - takenFromDriver;
  }

  // Claim the booking first so a retry can never pay twice.
  const claimed = await db.execute({ sql: "UPDATE taxipress_bookings SET status = 'boarded', updated_at = datetime('now') WHERE id = ? AND status = 'booked'", args: [String(booking.id)] });
  if (claimed.rowsAffected === 0) throw new TaxipressError(409, "already_boarded", "This passenger has already boarded.");
  await db.execute({
    sql: `INSERT INTO taxipress_settlements (id, booking_id, order_id, queue_id, driver_id, passenger_id, payment_method, seats, fare, commission, commission_rule, platform_fees, driver_amount, taken_from_driver, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId("tps"), String(booking.id), orderId, entry.id, driverId, String(booking.passenger_id), method, seats, fare, commissionTaken, commission.rule, platformFees, driverAmount, takenFromDriver, environment],
  });

  let driverBalance: number | null = null;
  if (method === "app") {
    if (driverAmount > 0) driverBalance = await creditRiderWorkWallet(driverId, driverAmount, environment);
  } else if (takenFromDriver > 0) {
    driverBalance = await debitRiderWorkWalletAllowNegative(driverId, takenFromDriver, environment);
  }

  // The seat is done: close the order out the way a settled ride is.
  await db.execute({ sql: "UPDATE orders SET stage = 'Settle', final_total = ?, updated_at = datetime('now') WHERE id = ? AND stage != 'Cancelled'", args: [fare, orderId] });
  await db.execute({ sql: "UPDATE lists SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", args: [String(order.list_id)] });
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Settle', ?, ?)",
    args: [
      newId("evt"), orderId,
      method === "app"
        ? `Boarded — ${ugx(driverAmount)} released to the driver, ${ugx(commissionTaken)} Taxipress commission`
        : `Boarded — ${ugx(fare)} paid in cash, ${ugx(takenFromDriver)} commission taken from the driver's wallet`,
      driverId,
    ],
  });

  await notifyUser(String(booking.passenger_id), { title: "Welcome aboard", body: "Your seat is confirmed. Have a good trip.", url: `/ride/taxipress/ticket/${String(booking.id)}`, tag: `taxipress-board-${String(booking.id)}` }).catch(() => {});
  if (method === "cash" && takenFromDriver > 0) {
    await notifyUser(driverId, {
      title: "Commission taken from a cash seat",
      body: `${ugx(takenFromDriver)} came out of your wallet${driverBalance != null && driverBalance < 0 ? `. You now owe ${ugx(-driverBalance)}.` : "."}`,
      url: "/wallet",
      tag: `taxipress-cash-${String(booking.id)}`,
    }).catch(() => {});
  }

  return {
    bookingId: String(booking.id),
    passengerName: (booking.passenger_name as string | null) ?? null,
    seats, fare, paymentMethod: method, commission: commissionTaken, driverAmount, takenFromDriver, driverBalance,
  };
}

/** What Peebee has settled and what drivers owe, for staff. */
export async function settlementReport(days: number) {
  if (!(await settlementsReady())) return { ready: false as const };
  const since = `-${Math.max(1, Math.min(365, days))} days`;
  const env = await getPlatformEnvironment();
  const totals = (await db.execute({
    sql: `SELECT COUNT(*) AS bookings, COALESCE(SUM(seats), 0) AS seats, COALESCE(SUM(fare), 0) AS fare, COALESCE(SUM(commission), 0) AS commission,
                 COALESCE(SUM(platform_fees), 0) AS platform_fees, COALESCE(SUM(driver_amount), 0) AS driver_amount,
                 COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN fare ELSE 0 END), 0) AS cash_fare,
                 COALESCE(SUM(CASE WHEN payment_method = 'app' THEN fare ELSE 0 END), 0) AS app_fare,
                 COALESCE(SUM(taken_from_driver), 0) AS taken_from_drivers
          FROM taxipress_settlements WHERE environment = ? AND created_at >= datetime('now', ?)`,
    args: [env, since],
  })).rows[0] as Row;
  const recent = (await db.execute({
    sql: `SELECT s.id, s.booking_id, s.payment_method, s.seats, s.fare, s.commission, s.platform_fees, s.driver_amount, s.taken_from_driver, s.created_at,
                 x.plate, u.name AS driver_name
          FROM taxipress_settlements s JOIN taxipress_queue q ON q.id = s.queue_id JOIN taxipress_taxis x ON x.id = q.taxi_id LEFT JOIN users u ON u.id = s.driver_id
          WHERE s.environment = ? AND s.created_at >= datetime('now', ?) ORDER BY s.created_at DESC LIMIT 50`,
    args: [env, since],
  })).rows as Row[];
  // Seats that ended without boarding: what went back to passengers and what fees were kept.
  let refunds = { count: 0, refunded: 0, fees: 0, cancelled: 0, noShows: 0, taxiRemoved: 0 };
  if (await hasTable("taxipress_refunds")) {
    const r = (await db.execute({
      sql: `SELECT COUNT(*) AS n, COALESCE(SUM(refunded), 0) AS refunded, COALESCE(SUM(fee), 0) AS fees,
                   COALESCE(SUM(CASE WHEN kind = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
                   COALESCE(SUM(CASE WHEN kind = 'no_show' THEN 1 ELSE 0 END), 0) AS no_shows,
                   COALESCE(SUM(CASE WHEN kind = 'taxi_removed' THEN 1 ELSE 0 END), 0) AS taxi_removed
            FROM taxipress_refunds WHERE environment = ? AND created_at >= datetime('now', ?)`,
      args: [env, since],
    })).rows[0] as Row;
    refunds = { count: Number(r.n), refunded: Number(r.refunded), fees: Number(r.fees), cancelled: Number(r.cancelled), noShows: Number(r.no_shows), taxiRemoved: Number(r.taxi_removed) };
  }
  const column = env === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const owing = (await db.execute(`SELECT u.id, u.name, u.phone, r.${column} AS balance, x.plate FROM taxipress_taxis x JOIN users u ON u.id = x.user_id
    JOIN riders r ON r.user_id=x.user_id WHERE r.${column} < 0 ORDER BY r.${column} LIMIT 50`)).rows as Row[];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    ready: true as const,
    days,
    totals: {
      bookings: n(totals.bookings), seats: n(totals.seats), fare: n(totals.fare), commission: n(totals.commission), platformFees: n(totals.platform_fees),
      driverAmount: n(totals.driver_amount), cashFare: n(totals.cash_fare), appFare: n(totals.app_fare), takenFromDrivers: n(totals.taken_from_drivers),
    },
    refunds,
    recent: recent.map((r) => ({
      id: String(r.id), bookingId: String(r.booking_id), paymentMethod: r.payment_method === "cash" ? "cash" as const : "app" as const, seats: n(r.seats), fare: n(r.fare),
      commission: n(r.commission), platformFees: n(r.platform_fees), driverAmount: n(r.driver_amount), takenFromDriver: n(r.taken_from_driver), createdAt: String(r.created_at),
      plate: String(r.plate), driverName: (r.driver_name as string | null) ?? null,
    })),
    owing: owing.map((r) => ({ id: String(r.id), name: (r.name as string | null) ?? null, phone: (r.phone as string | null) ?? null, balance: n(r.balance), plate: String(r.plate) })),
  };
}
