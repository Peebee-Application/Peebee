import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";
import { getTaxipressSettings } from "./settings.js";
import { openTicketOf } from "./open-tickets.js";

type Row = Record<string, unknown>;

/** What the order pay page may offer for a TaxiPress booking's order. */
export type TaxipressPayRules = { bookingId: string; cashAllowed: boolean; cashReason: string | null };

/** Pure rule: is cash allowed, given the switch, the limit and the passenger's other open cash bookings? */
export function cashRule(cashEnabled: boolean, maxCashBookings: number, openCashBookings: number): { cashAllowed: boolean; cashReason: string | null } {
  if (!cashEnabled) return { cashAllowed: false, cashReason: "Cash isn't accepted for TaxiPress right now. Pay in the app." };
  if (openCashBookings >= maxCashBookings) {
    return { cashAllowed: false, cashReason: `You can hold ${maxCashBookings} cash booking${maxCashBookings === 1 ? "" : "s"} at a time. Pay in the app.` };
  }
  return { cashAllowed: true, cashReason: null };
}

/** The TaxiPress rules for an order, or null when the order isn't a TaxiPress booking. */
export async function taxipressPayRules(orderId: string, customerId: string): Promise<TaxipressPayRules | null> {
  if (!(await hasTable("taxipress_bookings"))) return null;
  const found = await db.execute({ sql: "SELECT id, payment_method FROM taxipress_bookings WHERE order_id = ? LIMIT 1", args: [orderId] });
  const booking = found.rows[0] as Row | undefined;
  if (!booking) return null;
  if (await openTicketOf(String(booking.id))) return { bookingId: String(booking.id), cashAllowed: false, cashReason: "An open ticket must be paid in the app." };
  // Booked as cash on the TaxiPress screen: that booking already passed the cash checks.
  if (booking.payment_method === "cash") return { bookingId: String(booking.id), cashAllowed: true, cashReason: null };
  const settings = await getTaxipressSettings();
  // Other open cash bookings: booked as cash, or switched to the cash ("float") rail at checkout.
  const open = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM taxipress_bookings b JOIN orders o ON o.id = b.order_id
          WHERE b.passenger_id = ? AND b.status = 'booked' AND b.order_id != ?
            AND (b.payment_method = 'cash' OR o.payment_rail = 'float')`,
    args: [customerId, orderId],
  });
  return { bookingId: String(booking.id), ...cashRule(settings.cashEnabled, settings.maxCashBookings, Number((open.rows[0] as Row)?.n ?? 0)) };
}
