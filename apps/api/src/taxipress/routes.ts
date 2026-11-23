import { patchSchema } from "../lib/patch-schema.js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { bookingFor, bookSeats, manifestFor, myBookings, releaseStaleBookings } from "./bookings.js";
import { activeQueue, applyTaxi, arrive, driverView, goOnRoad, joinLine, leaveLine, lineOf, listTaxis, onRoadOf, removeFromLine, startBoarding, TaxipressError, updateLocation, updateTaxi, walkUp } from "./queue.js";
import { decorateLine, detailsColumnsReady, detailsReady, stopsFor, taxiProfile } from "./details.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { getTaxipressSettings, LANGUAGE_CODE, LUGGAGE_TYPES, MAX_LANGUAGES, offeredLanguages, offeredLuggageTypes, setTaxipressSettings } from "./settings.js";
import { cancelBooking, expireOpenTickets, markNoShow } from "./cancellation.js";
import { sendTicket } from "./ticket-share.js";
import { openTicketColumnsReady } from "./open-tickets.js";
import { getRideTrackingSettings } from "../settings/ride-tracking.js";
import { isFreshLocation } from "@peebee/shared";
import { confirmBoarding, settlementReport } from "./settlement.js";
import { getTaxipressRoute, listActiveTaxipressRoutes, listTaxipressRoutes, taxipressReady } from "./service.js";
import { SeatError, createSeatHold, releaseSeatHold, seatingReady, seatMap } from './seats.js';

type Row = Record<string, unknown>;

/** Taxipress: scheduled shared-taxi seats on fixed routes. See docs/FLYEXPRESS_INTEGRATION_BREAKDOWN.md. */
export const taxipressRoutes = new Hono();
/** Mount before shared routers with catch-all authentication. */
export const publicTaxipressRoutes = new Hono();
taxipressRoutes.use("/taxipress/*", requireAuth);
taxipressRoutes.use("/admin/taxipress/*", requireAuth, requireRole("admin"));

const ip = (c: Context) => c.req.header("cf-connecting-ip") ?? null;

function fail(c: Context, e: unknown) {
  if (e instanceof TaxipressError || e instanceof SeatError) return c.json({ error: e.code, message: e.message }, e.status);
  throw e;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/**
 * What the app needs to decide whether to show Taxipress. Always answers: `enabled` is true only
 * when staff switched it on, the migration is applied and at least one route is running.
 */
/** A driver's face photo, for passengers choosing a taxi. Only while that taxi is boarding or in the line. */
taxipressRoutes.get("/taxipress/queue/:queueId/driver-photo", requireAuth, async (c) => {
  const row = (await db.execute({
    sql: `SELECT COALESCE(rd.profile_photo_key, u.profile_photo_key) AS k FROM taxipress_queue q
          LEFT JOIN riders rd ON rd.user_id = q.driver_id LEFT JOIN users u ON u.id = q.driver_id
          WHERE q.id = ? AND q.status IN ('boarding', 'in_line')`,
    args: [c.req.param("queueId") ?? ""],
  })).rows[0] as Record<string, unknown> | undefined;
  const key = row?.k ? String(row.k) : null;
  if (!key) return c.json({ error: "not_found" }, 404);
  const object = await getR2Bucket().get(key);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: { ...uploadResponseHeaders(object.httpMetadata?.contentType, "image/jpeg"), "Cache-Control": "private, max-age=600" },
  });
});

async function customerConfig(c: Context) {
  const settings = await getTaxipressSettings();
  const routes = settings.enabled && (await taxipressReady()) ? await listActiveTaxipressRoutes() : [];
  const stops = settings.showStops ? await Promise.all(routes.map((r) => stopsFor(r.relayRouteId, r.direction))) : routes.map(() => []);
  const ready = await detailsReady();
  const columns = await detailsColumnsReady();
  return c.json({
    enabled: routes.length > 0,
    routes: routes.map((r, i) => ({
      id: r.id, directionLabel: r.directionLabel, routeCode: r.routeCode, fromName: r.fromName, toName: r.toName,
      farePerSeat: r.farePerSeat, relayRouteId: r.relayRouteId,
      reverseId: (routes.find((o) => o.relayRouteId === r.relayRouteId && o.direction !== r.direction)
        ?? routes.find((o) => o.id !== r.id && o.fromName.trim().toLowerCase() === r.toName.trim().toLowerCase() && o.toName.trim().toLowerCase() === r.fromName.trim().toLowerCase()))?.id ?? null,
      stops: stops[i],
    })),
    detailsReady: ready,
    detailsStore: columns ? "columns" : "fallback",
    maxLapChildren: settings.maxLapChildren,
    childSeatFarePercent: settings.childSeatFarePercent,
    luggageEnabled: settings.luggageEnabled,
    luggageTypes: offeredLuggageTypes(settings),
    luggagePrices: settings.luggagePrices,
    assistanceEnabled: settings.assistanceEnabled,
    languageEnabled: settings.languageEnabled,
    languages: offeredLanguages(settings).map((l) => ({ code: l.code, name: l.name })),
    bookForOthersEnabled: settings.bookForOthersEnabled,
    ticketSharingEnabled: settings.ticketSharingEnabled,
    openTicketsEnabled: settings.openTicketsEnabled && (await openTicketColumnsReady()),
    cashEnabled: settings.cashEnabled,
    seatChoiceFeeUgx: settings.seatChoiceFeeUgx,
    numberedSeatsEnabled: settings.numberedSeatsEnabled && await seatingReady(),
    seatHoldSeconds: settings.seatHoldSeconds,
    returnDiscountPercent: settings.returnDiscountPercent,
    maxSeatsPerBooking: settings.maxSeatsPerBooking,
    payWithinMinutes: settings.payWithinMinutes,
    parcelFitText: settings.parcelFitText,
    parcelNotAllowed: settings.parcelNotAllowed,
  });
}
taxipressRoutes.get("/taxipress/config", customerConfig);
publicTaxipressRoutes.get("/taxipress-public/config", customerConfig);

async function visibleSeatQueue(c: Context) {
  const settings = await getTaxipressSettings();
  if (!settings.enabled) return null;
  const row = (await db.execute({ sql: 'SELECT taxipress_route_id,driver_id FROM taxipress_queue WHERE id = ?',args: [c.req.param('queueId') ?? ''] })).rows[0] as Row | undefined;
  if (!row || !(await listActiveTaxipressRoutes()).some(r => r.id === String(row.taxipress_route_id))) return null;
  return row;
}
publicTaxipressRoutes.get('/taxipress-public/queue/:queueId/seats',async c => {
  c.header('Cache-Control','no-store');
  if (!(await seatingReady()) || !(await visibleSeatQueue(c))) return c.json({ enabled: false, seats: [], hold: null });
  return c.json(await seatMap(c.req.param('queueId')));
});
taxipressRoutes.get('/taxipress/queue/:queueId/seats',async c => {
  c.header('Cache-Control','no-store');
  if (!(await seatingReady()) || !(await visibleSeatQueue(c))) return c.json({ enabled: false, seats: [], hold: null });
  return c.json(await seatMap(c.req.param('queueId'),c.get('user').sub));
});
taxipressRoutes.post('/taxipress/queue/:queueId/seat-holds',requireRole('customer'),async c => {
  const parsed = z.object({ seats: z.array(z.string().regex(/^[1-5][A-D]$/)).min(1).max(18) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_seats',message: 'Choose passenger seats from this taxi.' },400);
  const queue = await visibleSeatQueue(c), who = c.get('user').sub;
  if (!queue || queue.driver_id === who) return c.json({ error: 'not_available',message: 'Choose an available departure.' },409);
  const line = await decorateLine(String(queue.taxipress_route_id),await lineOf(String(queue.taxipress_route_id)),await getTaxipressSettings());
  if (!line.some(e => e.id === c.req.param('queueId') && e.bookable)) return c.json({ error: 'not_bookable',message: 'This departure is no longer accepting bookings.' },409);
  try { return c.json({ hold: await createSeatHold(c.req.param('queueId')!,who,parsed.data.seats.length,parsed.data.seats) },201); }
  catch (e) { return fail(c,e); }
});
taxipressRoutes.delete('/taxipress/seat-holds/:holdId',async c => {
  await releaseSeatHold(c.req.param('holdId'),c.get('user').sub);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The line: what drivers do, and what passengers see
// ---------------------------------------------------------------------------

/** The taxis waiting on a route (the one Boarding Now first) and the ones already on the road. */
taxipressRoutes.get("/taxipress/routes/:id/queue", async (c) => {
  const id = c.req.param("id") as string;
  await releaseStaleBookings();
  const [raw, onRoad, route, settings] = await Promise.all([lineOf(id), onRoadOf(id), getTaxipressRoute(id), getTaxipressSettings()]);
  const line = await decorateLine(id, raw, settings);
  return c.json({
    line, onRoad,
    route: route ? { id: route.id, fromName: route.fromName, toName: route.toName, directionLabel: route.directionLabel, farePerSeat: route.farePerSeat } : null,
  });
});

/** Public browsing exposes aggregate availability, never driver IDs or live coordinates. */
publicTaxipressRoutes.get("/taxipress-public/routes/:id/queue", async (c) => {
  const id = c.req.param("id") as string;
  const settings = await getTaxipressSettings();
  const route = settings.enabled && (await taxipressReady()) ? (await listActiveTaxipressRoutes()).find(r => r.id === id) : null;
  if (!route || !route.active || !route.relayActive) return c.json({ line: [], onRoad: [], route: null });
  const [raw, onRoad] = await Promise.all([lineOf(id), onRoadOf(id)]);
  const line = await decorateLine(id, raw, settings);
  const publicEntry = (e: Awaited<ReturnType<typeof lineOf>>[number] & { bookable?: boolean; departsAt?: string | null }) => ({
    id: e.id, plate: e.plate, seatLayout: e.seatLayout, status: e.status,
    position: e.position, seatsLeft: e.seatsLeft, driverName: e.driverName,
    bookable: e.bookable === true, departsAt: e.departsAt ?? null,
  });
  c.header("Cache-Control", "no-store");
  return c.json({ line: line.map(publicEntry), onRoad: onRoad.map(publicEntry), route: { id: route.id, fromName: route.fromName, toName: route.toName, directionLabel: route.directionLabel, farePerSeat: route.farePerSeat } });
});

/** A taxi's profile, from real records only: what has no data yet is null and the app hides it. */
async function customerTaxiProfile(c: Context) {
  const queueId = c.req.param("queueId") as string;
  const row = (await db.execute({ sql: "SELECT taxipress_route_id FROM taxipress_queue WHERE id = ?", args: [queueId] }).catch(() => ({ rows: [] }))).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  const routeId = String(row.taxipress_route_id);
  const [route, settings] = await Promise.all([getTaxipressRoute(routeId), getTaxipressSettings()]);
  const entry = (await decorateLine(routeId, await lineOf(routeId), settings)).find((e) => e.id === queueId);
  if (!route || !entry) return c.json({ error: "not_found", message: "That taxi has left the line." }, 404);
  return c.json({ profile: await taxiProfile(entry, route, settings.showStops) });
}
taxipressRoutes.get("/taxipress/taxis/:queueId/profile", customerTaxiProfile);
publicTaxipressRoutes.get("/taxipress-public/taxis/:queueId/profile", async c => {
  if (!(await getTaxipressSettings()).enabled) return c.json({ error: 'not_found' }, 404);
  const row = (await db.execute({ sql: "SELECT taxipress_route_id FROM taxipress_queue WHERE id = ?", args: [c.req.param('queueId')] }).catch(() => ({ rows: [] }))).rows[0] as Row | undefined;
  if (!row || !(await listActiveTaxipressRoutes()).some(r => r.id === String(row.taxipress_route_id))) return c.json({ error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return customerTaxiProfile(c);
});

/** The driver's taxi, their place in the line and what they can do next. */
taxipressRoutes.get("/taxipress/taxi/me", async (c) => {
  const view = await driverView(c.get("user").sub);
  return c.json({ ...view, bookings: view.entry ? await manifestFor(view.entry.id) : [] });
});

const applySchema = z.object({
  relayRouteId: z.string().min(1),
  plate: z.string().trim().min(3).max(20),
  seatLayout: z.enum(["14", "18"]),
});

taxipressRoutes.post("/taxipress/taxi/apply", async (c) => {
  const parsed = applySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Choose a route, enter the number plate and the seats." }, 400);
  try {
    await applyTaxi(c.get("user").sub, parsed.data);
    return c.json({ ok: true }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

const placeSchema = z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() });

taxipressRoutes.post("/taxipress/driver/join", async (c) => {
  const parsed = placeSchema.extend({ routeId: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Choose which way you are going." }, 400);
  try {
    return c.json({ entry: await joinLine(c.get("user").sub, parsed.data.routeId, parsed.data) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

taxipressRoutes.post("/taxipress/driver/boarding", async (c) => {
  try { return c.json({ entry: await startBoarding(c.get("user").sub) }); } catch (e) { return fail(c, e); }
});

taxipressRoutes.post("/taxipress/driver/on-road", async (c) => {
  try { return c.json({ entry: await goOnRoad(c.get("user").sub) }); } catch (e) { return fail(c, e); }
});

taxipressRoutes.post("/taxipress/driver/arrive", async (c) => {
  try { await arrive(c.get("user").sub); return c.json({ ok: true }); } catch (e) { return fail(c, e); }
});

taxipressRoutes.post("/taxipress/driver/leave", async (c) => {
  try { await leaveLine(c.get("user").sub); return c.json({ ok: true }); } catch (e) { return fail(c, e); }
});

/** The driver confirms a passenger's ticket code at boarding. The seat is settled (fare released, or commission taken for cash). */
taxipressRoutes.post("/taxipress/driver/board", async (c) => {
  const parsed = z.object({ code: z.string().trim().min(6).max(20) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter the passenger's ticket code." }, 400);
  try { return c.json(await confirmBoarding(c.get("user").sub, parsed.data.code)); } catch (e) { return fail(c, e); }
});

/** The driver marks a passenger who has not turned up as a no-show, once the taxi has been boarding long enough. */
taxipressRoutes.post("/taxipress/driver/no-show", async (c) => {
  const parsed = z.object({ bookingId: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try { return c.json({ outcome: await markNoShow(c.get("user").sub, parsed.data.bookingId) }); } catch (e) { return fail(c, e); }
});

taxipressRoutes.post("/taxipress/driver/walk-up", async (c) => {
  const parsed = z.object({ delta: z.number().int().min(-14).max(14).refine((n) => n !== 0) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try { return c.json({ entry: await walkUp(c.get("user").sub, parsed.data.delta) }); } catch (e) { return fail(c, e); }
});

taxipressRoutes.post("/taxipress/driver/location", async (c) => {
  const parsed = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await updateLocation(c.get("user").sub, parsed.data.lat, parsed.data.lng);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Passenger bookings
// ---------------------------------------------------------------------------

const phone = z.string().trim().min(7).max(20).regex(/^[+0-9 ()-]+$/);
const bookSchema = z.object({
  seatHoldId: z.string().min(1).max(100).optional(),
  queueId: z.string().min(1),
  seats: z.number().int().min(1).max(30).optional(),
  /** Optional since v5: cash is chosen on the checkout screen. */
  payment: z.enum(["app", "cash"]).optional(),
  adults: z.number().int().min(1).max(18).optional(),
  children: z.number().int().min(0).max(17).optional(),
  childSeats: z.number().int().min(0).max(17).optional(),
  luggage: z.partialRecord(z.enum(LUGGAGE_TYPES as [string, ...string[]]), z.number().int().min(0).max(10)).optional(),
  assistance: z.enum(["none", "boarding", "priority", "mobility"]).nullable().optional(),
  language: z.string().trim().min(2).max(20).nullable().optional(),
  forSomeoneElse: z.boolean().optional(),
  /** Buy an open ticket: normal fare, valid on any taxi on this route. */
  openTicket: z.boolean().optional(),
  travellerName: z.string().trim().min(2).max(80).nullable().optional(),
  travellerPhone: phone.nullable().optional(),
  emergencyPhone: phone.nullable().optional(),
}).refine((b) => b.seats != null || b.adults != null);

taxipressRoutes.post("/taxipress/bookings", async (c) => {
  const parsed = bookSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Choose a taxi, the seats and how you will pay." }, 400);
  return bookSeats(c, parsed.data as Parameters<typeof bookSeats>[1]);
});

taxipressRoutes.get("/taxipress/bookings/mine", async (c) => {
  await expireOpenTickets().catch(() => 0);
  return c.json({ bookings: await myBookings(c.get("user").sub) });
});

/** A passenger cancels a seat before boarding. What comes back depends on the free-cancel window staff set. */
taxipressRoutes.post("/taxipress/bookings/:id/cancel", async (c) => {
  try { return c.json({ outcome: await cancelBooking(c.get("user").sub, c.req.param("id") as string) }); } catch (e) { return fail(c, e); }
});

const sendSchema = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(20).regex(/^[+0-9 ()-]+$/) });

/** The buyer sends a ticket to someone: it shows in their My tickets (if they are on Peebee) and the buyer gets the code to pass on. */
taxipressRoutes.post("/taxipress/bookings/:id/send", async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Add the person's name and phone number." }, 400);
  const result = await sendTicket(c.req.param("id") as string, c.get("user").sub, parsed.data);
  return "error" in result ? c.json({ error: result.error, message: result.message }, result.status) : c.json(result);
});

taxipressRoutes.get("/taxipress/bookings/:id", async (c) => {
  const booking = await bookingFor(c.req.param("id") as string, c.get("user").sub);
  return booking ? c.json({ booking }) : c.json({ error: "not_found" }, 404);
});

/** A customer's own active trip only; old positions are never presented as live. */
taxipressRoutes.get("/taxipress/bookings/:id/tracking", async (c) => {
  const booking = await bookingFor(c.req.param("id") as string, c.get("user").sub);
  if (!booking) return c.json({ error: "not_found" }, 404);
  const settings = await getRideTrackingSettings();
  let location: { lat: number; lng: number; updatedAt: string } | null = null;
  if (settings.enabled && ["booked", "boarded"].includes(booking.status)) {
    const row = (await db.execute({
      sql: "SELECT last_lat, last_lng, last_location_at FROM taxipress_queue WHERE id = ? AND status IN ('in_line', 'boarding', 'on_road')",
      args: [booking.taxi.queueId],
    })).rows[0] as Row | undefined;
    if (row && row.last_lat != null && row.last_lng != null && isFreshLocation(String(row.last_location_at ?? ""), Date.now(), settings.staleAfterSeconds)) {
      const lat = Number(row.last_lat), lng = Number(row.last_lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        location = { lat, lng, updatedAt: String(row.last_location_at) };
      }
    }
  }
  c.header("Cache-Control", "no-store");
  return c.json({ enabled: settings.enabled, pollAfterSeconds: settings.routeRefreshSeconds, booking, location });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

taxipressRoutes.get("/admin/taxipress/settings", requirePermission("settings.manage"), async (c) => {
  return c.json({ settings: await getTaxipressSettings(), ready: await taxipressReady() });
});

const settingsSchema = patchSchema(z.object({
  enabled: z.boolean(),
  departureRule: z.enum(["full_only", "driver_choice", "after_wait"]),
  sellFreeSeatsOnRoad: z.boolean(),
  commissionType: z.enum(["percent", "flat"]),
  commissionDigitalPercent: z.number().min(0).max(100),
  commissionCashPercent: z.number().min(0).max(100),
  commissionFlatUgx: z.number().int().min(0).max(1_000_000),
  blockWhenOwing: z.boolean(),
  maxOwedUgx: z.number().int().min(0).max(100_000_000),
  cashEnabled: z.boolean(),
  seatChoiceFeeUgx: z.number().int().min(0).max(100_000),
  numberedSeatsEnabled: z.boolean(),
  seatHoldSeconds: z.number().int().min(30).max(900),
  returnDiscountPercent: z.number().min(0).max(100),
  maxSeatsPerBooking: z.number().int().min(1).max(30),
  parcelAcceptRule: z.enum(["boarding_now", "any_in_line"]),
  maxParcels14: z.number().int().min(0).max(50),
  maxParcels18: z.number().int().min(0).max(50),
  parcelFitText: z.string().trim().max(200),
  parcelNotAllowed: z.array(z.string().trim().min(1).max(60)).max(50),
  waitMinutes: z.number().int().min(0).max(600),
  stageRadiusM: z.number().int().min(0).max(5000),
  payWithinMinutes: z.number().int().min(1).max(1440),
  maxCashBookings: z.number().int().min(0).max(50),
  freeCancelMinutes: z.number().int().min(0).max(1440),
  cancelRetentionPercent: z.number().min(0).max(100),
  feeTo: z.enum(["driver", "peebee"]),
  noShowMinutes: z.number().int().min(0).max(240),
  noShowFeePercent: z.number().min(0).max(100),
  rebookOnRemoval: z.boolean(),
  bookableTaxis: z.number().int().min(1).max(20),
  maxLapChildren: z.number().int().min(0).max(10),
  childSeatFarePercent: z.number().min(0).max(100),
  luggageEnabled: z.boolean(),
  luggageOptionsShown: z.number().int().min(1).max(LUGGAGE_TYPES.length),
  luggagePrices: z.object(Object.fromEntries(LUGGAGE_TYPES.map((t) => [t, z.number().int().min(0).max(1_000_000).nullable()])) as Record<(typeof LUGGAGE_TYPES)[number], z.ZodNullable<z.ZodNumber>>),
  assistanceEnabled: z.boolean(),
  languageEnabled: z.boolean(),
  languages: z.array(z.object({ code: z.string().trim().toLowerCase().regex(LANGUAGE_CODE), name: z.string().trim().min(1).max(40), enabled: z.boolean() })).max(MAX_LANGUAGES)
    .refine((list) => new Set(list.map((l) => l.code)).size === list.length, { message: "Each language can be listed once." }),
  bookForOthersEnabled: z.boolean(),
  ticketSharingEnabled: z.boolean(),
  openTicketsEnabled: z.boolean(),
  openTicketValidityDays: z.number().int().min(0).max(3650),
  openTicketRefundPercent: z.number().min(0).max(100),
  showStops: z.boolean(),
}));

taxipressRoutes.put("/admin/taxipress/settings", requirePermission("settings.manage"), async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const before = await getTaxipressSettings();
  await setTaxipressSettings(parsed.data);
  const after = await getTaxipressSettings();
  await logActivity({ actor: c.get("user"), action: "settings.taxipress", summary: "Updated Taxipress settings", entityType: "settings", entityId: "taxipress", before, after, ip: ip(c) });
  return c.json({ settings: after });
});

taxipressRoutes.get("/admin/taxipress/routes", requirePermission("settings.manage"), async (c) => {
  if (!(await taxipressReady())) return c.json({ routes: [], relayRoutes: [], ready: false });
  // Relay routes staff can run Taxipress on (set up in Settings → Relay delivery).
  const relay = (await db.execute("SELECT id, name, stage_a_name, stage_b_name, active FROM relay_routes ORDER BY name")).rows as Row[];
  return c.json({
    routes: await listTaxipressRoutes(),
    relayRoutes: relay.map((r) => ({ id: String(r.id), name: String(r.name), stageAName: String(r.stage_a_name), stageBName: String(r.stage_b_name), active: Number(r.active) === 1 })),
    ready: true,
  });
});

const notReady = { error: "taxipress_unavailable", message: "Apply migration 0123 first." } as const;

const createSchema = z.object({
  relayRouteId: z.string().min(1),
  direction: z.enum(["a_to_b", "b_to_a"]),
  farePerSeat: z.number().int().min(0).max(1_000_000),
  stopPricingEnabled: z.boolean().default(false),
  // A new route stays off until staff switch it on.
  active: z.boolean().default(false),
});

taxipressRoutes.post("/admin/taxipress/routes", requirePermission("settings.manage"), async (c) => {
  if (!(await taxipressReady())) return c.json(notReady, 503);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const relay = (await db.execute({ sql: "SELECT id, name FROM relay_routes WHERE id = ?", args: [d.relayRouteId] })).rows[0] as Row | undefined;
  if (!relay) return c.json({ error: "route_not_found", message: "Choose a route set up in Relay delivery first." }, 404);
  const exists = (await db.execute({ sql: "SELECT 1 FROM taxipress_routes WHERE relay_route_id = ? AND direction = ?", args: [d.relayRouteId, d.direction] })).rows[0];
  if (exists) return c.json({ error: "route_exists", message: "That direction is already set up." }, 409);
  const id = newId("tpr");
  await db.execute({
    sql: "INSERT INTO taxipress_routes (id, relay_route_id, direction, fare_per_seat, stop_pricing_enabled, active) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, d.relayRouteId, d.direction, d.farePerSeat, d.stopPricingEnabled ? 1 : 0, d.active ? 1 : 0],
  });
  await logActivity({ actor: c.get("user"), action: "taxipress.route.create", summary: `Added Taxipress route on "${relay.name}"`, entityType: "taxipress_route", entityId: id, after: d, ip: ip(c) });
  return c.json({ id }, 201);
});

const updateSchema = patchSchema(z.object({
  farePerSeat: z.number().int().min(0).max(1_000_000),
  stopPricingEnabled: z.boolean(),
  active: z.boolean(),
}));

taxipressRoutes.patch("/admin/taxipress/routes/:id", requirePermission("settings.manage"), async (c) => {
  if (!(await taxipressReady())) return c.json(notReady, 503);
  const id = c.req.param("id") as string;
  const before = await getTaxipressRoute(id);
  if (!before) return c.json({ error: "not_found" }, 404);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const columns: [string, number | undefined][] = [
    ["fare_per_seat", d.farePerSeat],
    ["stop_pricing_enabled", d.stopPricingEnabled == null ? undefined : d.stopPricingEnabled ? 1 : 0],
    ["active", d.active == null ? undefined : d.active ? 1 : 0],
  ];
  const set = columns.filter(([, value]) => value !== undefined);
  if (!set.length) return c.json({ ok: true });
  await db.execute({
    sql: `UPDATE taxipress_routes SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    args: [...set.map(([, value]) => value as number), id],
  });
  await logActivity({ actor: c.get("user"), action: "taxipress.route.update", summary: `Updated Taxipress route ${before.directionLabel}`, entityType: "taxipress_route", entityId: id, before, after: d, ip: ip(c) });
  return c.json({ ok: true });
});

// ---- Taxis and the live line, for staff -------------------------------------

taxipressRoutes.get("/admin/taxipress/taxis", requirePermission("riders.view"), async (c) => c.json({ taxis: await listTaxis() }));

const taxiPatch = patchSchema(z.object({
  numberedSeatsEnabled: z.boolean(),
  status: z.enum(["pending", "approved", "suspended"]),
  passengersEnabled: z.boolean(),
  parcelsEnabled: z.boolean(),
}));

taxipressRoutes.post("/admin/taxipress/taxis/:id", requirePermission("riders.verify"), async (c) => {
  const parsed = taxiPatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const id = c.req.param("id") as string;
  try {
    const taxi = await updateTaxi(id, c.get("user").sub, parsed.data);
    await logActivity({ actor: c.get("user"), action: "taxipress.taxi.update", summary: `Updated Taxipress taxi ${taxi.plate}`, entityType: "taxipress_taxi", entityId: id, after: parsed.data, ip: ip(c) });
    return c.json({ taxi });
  } catch (e) {
    return fail(c, e);
  }
});

/** Every taxi in a line or on the road right now. */
taxipressRoutes.get("/admin/taxipress/queue", requirePermission("riders.view"), async (c) => c.json({ queue: await activeQueue() }));

taxipressRoutes.post("/admin/taxipress/queue/:id/remove", requirePermission("settings.manage"), async (c) => {
  const id = c.req.param("id") as string;
  try {
    await removeFromLine(id);
    await logActivity({ actor: c.get("user"), action: "taxipress.queue.remove", summary: "Removed a taxi from the Taxipress line", entityType: "taxipress_queue", entityId: id, ip: ip(c) });
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

/** Settled seats, Peebee's commission and which drivers owe it, for staff. */
taxipressRoutes.get("/admin/taxipress/report", requirePermission("settings.manage"), async (c) => {
  const days = Math.round(Number(c.req.query("days") ?? 30));
  return c.json(await settlementReport(Number.isFinite(days) && days > 0 ? days : 30));
});
