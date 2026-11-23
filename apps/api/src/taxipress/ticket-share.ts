import { Hono } from "hono";
import { db } from "../db/client.js";
import { consume, clientIp } from "../lib/ratelimit.js";
import { notifyUser } from "../lib/webpush.js";
import { bookingFor, bookingsReady, ticketRowByCode } from "./bookings.js";
import { loadDetails, phoneTail, saveDetails } from "./details.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { getTaxipressSettings } from "./settings.js";

type Row = Record<string, unknown>;

/** The Peebee account that uses this phone number, if any (never the person asking). */
export async function userByPhone(phone: string, exceptUserId?: string): Promise<{ id: string; name: string } | null> {
  const tail = phoneTail(phone);
  if (tail.length < 9) return null;
  const rows = (await db.execute({
    sql: `SELECT id, name FROM users WHERE phone IS NOT NULL AND substr(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), -9) = ? AND status = 'active' LIMIT 3`,
    args: [tail],
  })).rows as Row[];
  const found = rows.find((r) => String(r.id) !== exceptUserId);
  return found ? { id: String(found.id), name: String(found.name) } : null;
}

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** What anyone holding a ticket code may see: the trip and the seat, not who paid or how to reach anyone. */
export type PublicTicket = {
  code: string;
  status: "booked" | "boarded" | "completed" | "cancelled" | "no_show";
  paymentStatus: "paid" | "pay_driver" | "unpaid" | "cancelled";
  /** What still has to be paid to the driver in cash. */
  amountDue: number | null;
  seats: number;
  seatNumbers?: string[];
  adults: number;
  children: number;
  bags: number;
  assistance: string | null;
  language: string | null;
  travellerName: string | null;
  bookedBy: string | null;
  route: { fromName: string; toName: string; directionLabel: string };
  taxi: { plate: string; seatLayout: "14" | "18"; driverName: string | null; status: string; position: number | null };
};

export function normaliseTicketCode(raw: string): string | null {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = compact.startsWith("TXP") ? compact.slice(3) : compact;
  return /^[A-Z0-9]{6}$/.test(body) ? `TXP-${body}` : null;
}

export async function publicTicket(code: string): Promise<PublicTicket | null> {
  if (!(await bookingsReady())) return null;
  const found = await ticketRowByCode(code);
  if (!found) return null;
  const { booking, passengerId } = found;
  const d = booking.details;
  const booker = (await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [passengerId] })).rows[0] as Row | undefined;
  const status = booking.status;
  return {
    code,
    status,
    paymentStatus: booking.paymentStatus,
    amountDue: booking.paymentStatus === "pay_driver" || booking.paymentStatus === "unpaid" ? booking.amount : null,
    seats: booking.seats,
    seatNumbers: booking.seatNumbers,
    adults: d?.adults ?? booking.seats,
    children: d?.children ?? 0,
    bags: d ? Object.values(d.luggage ?? {}).reduce((sum, n) => sum + Number(n || 0), 0) : 0,
    assistance: d?.assistance && d.assistance !== "none" ? d.assistance : null,
    language: d?.language ?? null,
    travellerName: d?.forSomeoneElse && d.travellerName ? d.travellerName : firstName(booker?.name) || null,
    bookedBy: d?.forSomeoneElse ? firstName(booker?.name) || null : null,
    route: { fromName: booking.route.fromName, toName: booking.route.toName, directionLabel: booking.route.directionLabel },
    taxi: { plate: booking.taxi.plate, seatLayout: booking.taxi.seatLayout, driverName: booking.taxi.driverName ? firstName(booking.taxi.driverName) : null, status: booking.taxi.status, position: booking.taxi.position },
  };
}

/** Public, sign-in-free: the page a ticket code opens, for a traveller who has no smartphone or isn't on Peebee. */
export const ticketCodeRoutes = new Hono();

ticketCodeRoutes.get("/:code", async (c) => {
  const quota = await consume(`ticket-code:${clientIp(c)}`, 40, 10 * 60);
  if (!quota.allowed) return c.json({ error: "too_many_requests", message: "Too many tries. Wait a few minutes." }, 429);
  if (!(await getTaxipressSettings()).ticketSharingEnabled) return c.json({ error: "not_found" }, 404);
  const code = normaliseTicketCode(c.req.param("code") ?? "");
  const ticket = code ? await publicTicket(code) : null;
  if (!ticket) return c.json({ error: "not_found", message: "No ticket has that code. Check it and try again." }, 404);
  c.header("Cache-Control", "no-store");
  return c.json({ ticket });
});

export type SendResult = { ok: true; code: string; onPeebee: boolean; travellerName: string; travellerPhone: string };

/**
 * The buyer hands a ticket to someone: it becomes that person's, to show the driver. If they have a Peebee account the ticket
 * appears in their My tickets and they are told; if not, the buyer sends the code (see publicTicket). The buyer keeps paying for
 * it and can still cancel it.
 */
export async function sendTicket(bookingId: string, buyerId: string, person: { name: string; phone: string }): Promise<SendResult | { error: string; message: string; status: 404 | 409 | 403 }> {
  if (!(await getTaxipressSettings()).ticketSharingEnabled) return { error: "sharing_off", message: "Sending tickets isn't available right now.", status: 403 };
  const booking = await bookingFor(bookingId, buyerId);
  if (!booking) return { error: "not_found", message: "That ticket wasn't found.", status: 404 };
  if (booking.status !== "booked") return { error: "not_sendable", message: "A ticket that has boarded or been cancelled can't be sent.", status: 409 };
  const buyer = (await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [buyerId] })).rows[0] as Row | undefined;
  const base = (await loadDetails(bookingId)) ?? {
    adults: booking.seats, children: 0, childSeats: 0, luggage: {}, luggageAmount: 0, assistance: null, language: null, forSomeoneElse: false,
    travellerName: null, travellerPhone: null, emergencyPhone: null,
  };
  const owner = { customerId: buyerId, environment: await getPlatformEnvironment() };
  await saveDetails(bookingId, { ...base, forSomeoneElse: true, travellerName: person.name, travellerPhone: person.phone }, owner);
  const recipient = await userByPhone(person.phone, buyerId);
  if (recipient) {
    await notifyUser(recipient.id, {
      title: "A taxi ticket was sent to you",
      body: `${firstName(buyer?.name) || "Someone"} sent you a Taxipress ticket: ${booking.route.fromName} → ${booking.route.toName}.`,
      url: `/ride/taxipress/ticket/${booking.id}`,
      tag: `taxipress-ticket-${booking.id}`,
    }).catch(() => {});
  }
  return { ok: true, code: String(booking.ticketCode), onPeebee: Boolean(recipient), travellerName: person.name, travellerPhone: person.phone };
}

