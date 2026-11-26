import { patchSchema } from "../lib/patch-schema.js";
import { Hono, type Context } from "hono";
import { roundFare } from "@peebee/shared";
import { getDeliverySettings } from "../lib/settings.js";
import { roadKm } from "../lib/road-distance.js";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { riderRangeKm } from "../orders/matching.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, getWalletAccountSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { ensureProviderWorkWallet, providerWorkWalletBalance } from "../wallet/provider-work-wallet.js";
import { personalWalletIsActive } from "../wallet/personal-wallet.js";
import {
  approvedOperator,
  canWatchRelay,
  claimLastMile,
  customerMissedMatatu,
  handToCustomerAtStage,
  noticeMatatuApproach,
  noticeMatatuArrived,
  relayMeetReady,
  stationDisplayName,
  collectFromMatatu,
  planRelay,
  receiveAtMatatu,
  relayReady,
  relayStationsReady,
  relayView,
  RelayError,
  markMatesArrived,
  shareMatatuPosition,
  RELAY_DROP_LIVE,
  RELAY_DROP_OFF,
  RELAY_DROP_SANDBOX,
  sendRiderFromStation,
} from "./service.js";
import { getRelaySettings, setRelaySettings } from "./settings.js";
import { directionLabel, legDirections, routeCodeLabel, routeCodes, routeCodesReady } from "./direction.js";

type Row = Record<string, unknown>;

/** Relay delivery endpoints: the customer's quote, the last-mile rider, the matatu operator and staff. */
export const relayRoutes = new Hono();
relayRoutes.use("/relay/*", requireAuth);
relayRoutes.use("/admin/relay/*", requireAuth, requireRole("admin"));

const ip = (c: Context) => c.req.header("cf-connecting-ip") ?? null;

function fail(c: Context, e: unknown) {
  if (e instanceof RelayError) return c.json({ error: e.code, message: e.message }, e.status);
  throw e;
}

relayRoutes.use("/relay/*", async (c, next) => {
  if (!(await relayReady())) return c.json({ error: "relay_unavailable", message: "Relay delivery isn't set up yet." }, 503);
  await next();
});

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

const quoteSchema = z.object({
  pickupLat: z.coerce.number(), pickupLng: z.coerce.number(),
  destinationLat: z.coerce.number(), destinationLng: z.coerce.number(),
  pickupName: z.string().max(240).optional(), destinationName: z.string().max(240).optional(),
});

/** The relay a long parcel would take and what each leg costs, or relay: null for a normal delivery. */
export async function customerRelayQuote(c: Context) {
  const parsed = quoteSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const d = parsed.data;
  // One boda all the way, along the road (what the parcel costs when it isn't relayed).
  const bodaKm = await roadKm({ lat: d.pickupLat, lng: d.pickupLng }, { lat: d.destinationLat, lng: d.destinationLng });
  const { deliveryRatePerKm, minimumDeliveryFee } = await getDeliverySettings();
  const plan = await planRelay(
    { lat: d.pickupLat, lng: d.pickupLng, name: d.pickupName },
    { lat: d.destinationLat, lng: d.destinationLng, name: d.destinationName },
    { tripKm: bodaKm },
  );
  const { lastMileChoice, directMaxHours } = await getRelaySettings();
  return c.json({
    /** "Direct" (one boda all the way) is promised in under this many hours (admin setting). */
    directMaxHours,
    boda: { distanceKm: Math.round(bodaKm * 10) / 10, fee: roundFare(bodaKm * deliveryRatePerKm, minimumDeliveryFee) },
    relay: plan && {
      routeName: plan.routeName,
      direction: plan.direction,
      routeCode: plan.routeCode,
      total: plan.total,
      dropMode: plan.dropMode,
      // Petrol-station drop: where it's left, what collecting there costs, and whether the customer chooses now.
      station: plan.station ? { name: plan.station.name, address: plan.station.address } : null,
      collectTotal: plan.collectTotal ?? null,
      choiceAtOrder: plan.dropMode === "station" && lastMileChoice === "order",
      // Stages near the customer where they can meet the matatu instead (admin setting).
      meetStages: (plan.meetStages ?? []).map((stage) => ({ id: stage.id, name: stage.name, distanceKm: stage.distanceKm, isStation: !!stage.outletId })),
      legs: plan.legs.map((leg) => ({ leg: leg.leg, kind: leg.kind, fromName: leg.fromName, toName: leg.toName, distanceKm: leg.distanceKm, fee: leg.fee })),
    },
  });
}
relayRoutes.get('/relay/quote',customerRelayQuote);

/** Everyone involved in a relayed order follows it here: the customer, the
 * riders, the matatu operator and the seller (staff use the admin view). */
relayRoutes.get("/relay/orders/:id/track", async (c) => {
  const user = c.get("user");
  const order = (await db.execute({
    sql: `SELECT o.*, c.name AS customer_name, r.name AS rider_name FROM orders o
          LEFT JOIN users c ON c.id = o.customer_id LEFT JOIN users r ON r.id = o.rider_id WHERE o.id = ?`,
    args: [c.req.param("id") as string],
  })).rows[0] as Row | undefined;
  if (!order) return c.json({ error: "not_found" }, 404);
  if (!(await canWatchRelay(order, user.sub, user.role))) return c.json({ error: "forbidden" }, 403);
  const relay = await relayView(order, user.sub);
  if (!relay) return c.json({ error: "not_relayed" }, 404);
  const events = await db.execute({ sql: "SELECT stage, note, created_at FROM order_events WHERE order_id = ? ORDER BY created_at", args: [String(order.id)] });
  return c.json({
    order: {
      id: order.id, stage: order.stage, type: order.type, createdAt: order.created_at,
      pickupArea: order.pickup_area, destinationArea: order.destination_area,
      customerName: order.customer_name, riderName: order.rider_name,
      // Live position: the boda carrying it, or the matatu while it's on board.
      lat: order.rider_lat ?? null, lng: order.rider_lng ?? null, locationAt: order.rider_location_updated_at ?? null,
    },
    relay,
    events: events.rows,
  });
});

/** The customer switches to door delivery from the station, paying the last leg from their wallet. */
relayRoutes.post("/relay/orders/:id/send-rider", async (c) => {
  try {
    return c.json(await sendRiderFromStation(c.get("user").sub, c.req.param("id") as string));
  } catch (e) {
    return fail(c, e);
  }
});

/** A seller's relayed orders, so they can follow each one to the customer. */
relayRoutes.get("/relay/merchant/orders", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT DISTINCT o.id, o.stage, o.created_at, o.destination_area, st.name AS store_name, c.name AS customer_name
          FROM orders o
          JOIN order_relay_legs l ON l.order_id = o.id
          JOIN stores st ON st.id = o.store_id
          JOIN merchant_members mm ON mm.merchant_id = st.merchant_id AND mm.user_id = ? AND mm.status = 'active'
          LEFT JOIN users c ON c.id = o.customer_id
          ORDER BY o.created_at DESC LIMIT 50`,
    args: [user.sub],
  }).catch(() => ({ rows: [] }));
  return c.json({ orders: res.rows });
});

// ---------------------------------------------------------------------------
// Last-mile rider
// ---------------------------------------------------------------------------

/** Last-mile legs waiting for a rider near the rider's stage. */
relayRoutes.get("/relay/legs/open", requireRole("rider"), async (c) => {
  const user = c.get("user");
  const rider = (await db.execute({ sql: "SELECT stage_lat, stage_lng FROM riders WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  const { lastMileRadiusKm } = await getRelaySettings();
  // A multi-store bag is one pickup: list it once, under its first store's order.
  const bagOnce = (await hasColumn("orders", "delivery_bundle_id"))
    ? ` AND NOT (o.delivery_bundle_id IS NOT NULL AND o.delivery_bundle_id != o.id AND EXISTS (
          SELECT 1 FROM order_relay_legs lead WHERE lead.order_id = o.delivery_bundle_id AND lead.leg = 3 AND lead.status = 'open'))`
    : "";
  const res = await db.execute({
    sql: `SELECT l.id, l.order_id, l.from_name, l.from_lat, l.from_lng, l.to_name, l.distance_km, l.fee, l.created_at,
                 o.destination_area, o.destination_address, m.status AS matatu_status, ro.vehicle_plate
          FROM order_relay_legs l
          JOIN orders o ON o.id = l.order_id
          LEFT JOIN order_relay_legs m ON m.order_id = l.order_id AND m.leg = 2
          LEFT JOIN relay_operators ro ON ro.user_id = m.provider_id
          WHERE l.leg = 3 AND l.status = 'open' AND o.environment = ? AND o.stage = 'Deliver' AND o.rider_id IS NULL${bagOnce}
          ORDER BY l.created_at LIMIT 50`,
    args: [await getPlatformEnvironment()],
  });
  // Within the last-mile radius, and never past the rider's own visibility range.
  const ownRange = await riderRangeKm(user.sub);
  const limitKm = ownRange == null ? lastMileRadiusKm : Math.min(lastMileRadiusKm, ownRange);
  const legs = (res.rows as Row[]).filter((leg) =>
    rider?.stage_lat == null || rider?.stage_lng == null ||
    haversineKm(Number(rider.stage_lat), Number(rider.stage_lng), Number(leg.from_lat), Number(leg.from_lng)) <= limitKm,
  );
  return c.json({ legs });
});

relayRoutes.post("/relay/legs/:id/claim", requireRole("rider"), async (c) => {
  try {
    return c.json(await claimLastMile(c.get("user").sub, c.req.param("id") as string));
  } catch (e) {
    return fail(c, e);
  }
});

const codeSchema = z.object({ code: z.string().trim().min(4).max(12) });

relayRoutes.post("/relay/legs/:id/collect", requireRole("rider"), async (c) => {
  const parsed = codeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter the code." }, 400);
  try {
    return c.json(await collectFromMatatu(c.get("user").sub, c.req.param("id") as string, parsed.data.code));
  } catch (e) {
    return fail(c, e);
  }
});

// ---------------------------------------------------------------------------
// Matatu operator
// ---------------------------------------------------------------------------

relayRoutes.get("/relay/operator/me", async (c) => {
  const user = c.get("user");
  const [operator, routes] = await Promise.all([
    db.execute({
      sql: "SELECT ro.*, rr.name AS route_name FROM relay_operators ro LEFT JOIN relay_routes rr ON rr.id = ro.route_id WHERE ro.user_id = ?",
      args: [user.sub],
    }),
    // Every column, so the stage codes come along once migration 0107 adds them.
    db.execute("SELECT * FROM relay_routes WHERE active = 1 ORDER BY name"),
  ]);
  const own = operator.rows[0] as Row | undefined;
  const ownRoute = own?.route_id
    ? (await db.execute({ sql: "SELECT * FROM relay_routes WHERE id = ?", args: [String(own.route_id)] })).rows[0] as Row | undefined
    : undefined;
  return c.json({
    operator: own ? { ...own, route_code: ownRoute ? routeCodeLabel(ownRoute) : null } : null,
    routes: (routes.rows as Row[]).map((route) => ({
      id: route.id, name: route.name, stage_a_name: route.stage_a_name, stage_b_name: route.stage_b_name, route_code: routeCodeLabel(route),
    })),
    enabled: (await getRelaySettings()).enabled,
  });
});

relayRoutes.get("/relay/operator/wallet", async (c) => {
  const user = c.get("user");
  const operator = await approvedOperator(user.sub);
  if (!operator) return c.json({ error: "not_operator", message: "Your operator account isn't approved yet." }, 403);
  const environment = await getPlatformEnvironment();
  await ensureProviderWorkWallet("relay", user.sub, environment);
  const [balance, personalWalletActive, walletSettings] = await Promise.all([
    providerWorkWalletBalance("relay", user.sub, environment),
    personalWalletIsActive(user.sub),
    getWalletAccountSettings(),
  ]);
  return c.json({
    walletType: "relay_work",
    balance: balance ?? 0,
    environment,
    personalWalletActive,
    personalWalletActivationAvailable: await hasTable("personal_wallets"),
    providerWalletTransfersEnabled: walletSettings.providerTransfersEnabled && await hasTable("provider_wallet_transfers"),
  });
});

const applySchema = z.object({
  routeId: z.string().min(1),
  vehiclePlate: z.string().trim().min(3).max(20),
  phone: z.string().trim().max(20).optional(),
});

relayRoutes.post("/relay/operator/apply", async (c) => {
  const user = c.get("user");
  const parsed = applySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Choose a route and enter the number plate." }, 400);
  const d = parsed.data;
  const route = (await db.execute({ sql: "SELECT id FROM relay_routes WHERE id = ? AND active = 1", args: [d.routeId] })).rows[0];
  if (!route) return c.json({ error: "route_not_found", message: "That route isn't available." }, 404);
  const existing = (await db.execute({ sql: "SELECT status FROM relay_operators WHERE user_id = ?", args: [user.sub] })).rows[0] as Row | undefined;
  if (existing?.status === "suspended") return c.json({ error: "suspended", message: "Your operator account is suspended. Contact support." }, 403);
  // Changing route or plate sends the operator back for approval.
  await db.execute({
    sql: `INSERT INTO relay_operators (user_id, route_id, vehicle_plate, phone, status) VALUES (?, ?, ?, ?, 'pending')
          ON CONFLICT(user_id) DO UPDATE SET route_id = excluded.route_id, vehicle_plate = excluded.vehicle_plate,
            phone = excluded.phone, status = 'pending', updated_at = datetime('now')`,
    args: [user.sub, d.routeId, d.vehiclePlate.toUpperCase(), d.phone ?? null],
  });
  await ensureProviderWorkWallet("relay", user.sub, await getPlatformEnvironment());
  return c.json({ ok: true }, 201);
});

/** Parcels on the operator's matatu, and the ones riders are bringing to it. */
relayRoutes.get("/relay/operator/parcels", async (c) => {
  const user = c.get("user");
  const operator = await approvedOperator(user.sub);
  if (!operator) return c.json({ error: "not_operator", message: "Your operator account isn't approved yet." }, 403);
  // A customer meeting the matatu at a stage: hand it to them with their code (no handoff code to show then).
  const meetReady = await relayMeetReady();
  const meetColumns = meetReady
    ? `, CASE WHEN r.meet_stage_id IS NOT NULL AND r.missed_at IS NULL THEN r.meet_stage_name END AS meet_stage_name,
         CASE WHEN r.meet_stage_id IS NOT NULL AND r.missed_at IS NULL THEN cu.name END AS customer_name,
         CASE WHEN r.meet_stage_id IS NOT NULL AND r.missed_at IS NULL THEN cu.phone END AS customer_phone,
         CASE WHEN r.meet_stage_id IS NOT NULL AND r.missed_at IS NULL THEN cu.id END AS customer_id`
    : "";
  const meetJoin = meetReady ? "LEFT JOIN order_relay r ON r.order_id = l.order_id LEFT JOIN orders mo ON mo.id = l.order_id LEFT JOIN users cu ON cu.id = mo.customer_id" : "";
  const [carrying, incoming, recent] = await Promise.all([
    db.execute({
      sql: `SELECT l.id, l.order_id, l.route_id, l.from_name, l.from_lat, l.from_lng, l.to_name, l.to_lat, l.to_lng, l.status, l.handoff_code, l.started_at,
                   last.status AS last_mile_status, u.name AS last_rider_name${meetColumns}
            FROM order_relay_legs l
            LEFT JOIN order_relay_legs last ON last.order_id = l.order_id AND last.leg = 3
            LEFT JOIN users u ON u.id = last.provider_id
            ${meetJoin}
            WHERE l.leg = 2 AND l.provider_id = ? AND l.status IN ('in_transit', 'arrived') ORDER BY l.started_at`,
      args: [user.sub],
    }),
    db.execute({
      sql: `SELECT l.order_id, l.to_name AS stage_name, o.stage, u.name AS rider_name
            FROM order_relay_legs l JOIN orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = o.rider_id
            WHERE l.leg = 1 AND l.status != 'done' AND l.route_id = ? AND o.stage IN ('Match', 'Fund', 'Shop', 'Deliver') AND o.environment = ?
            ORDER BY o.updated_at DESC LIMIT 30`,
      args: [String(operator.route_id), await getPlatformEnvironment()],
    }),
    db.execute({
      sql: `SELECT l.id, l.order_id, l.route_id, l.from_name, l.from_lat, l.from_lng, l.to_name, l.to_lat, l.to_lng, l.handed_over_at, l.paid_amount
            FROM order_relay_legs l WHERE l.leg = 2 AND l.provider_id = ? AND l.status = 'done'
            ORDER BY l.handed_over_at DESC LIMIT 20`,
      args: [user.sub],
    }),
  ]);
  // Each parcel's direction along the route ("KLA - EBB"), from where its matatu leg starts and ends.
  const directions = await legDirections([...(carrying.rows as Row[]), ...(recent.rows as Row[])]);
  const withDirection = (rows: Row[]) => rows.map((row) => ({ ...row, direction: directions.get(String(row.id)) ?? null }));
  return c.json({ carrying: withDirection(carrying.rows as Row[]), incoming: incoming.rows, recent: withDirection(recent.rows as Row[]) });
});

relayRoutes.post("/relay/operator/receive", async (c) => {
  const parsed = codeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter the rider's code." }, 400);
  try {
    return c.json(await receiveAtMatatu(c.get("user").sub, parsed.data.code));
  } catch (e) {
    return fail(c, e);
  }
});

async function operatorLeg(c: Context): Promise<Row | null> {
  const row = (await db.execute({
    sql: "SELECT * FROM order_relay_legs WHERE id = ? AND leg = 2 AND provider_id = ? AND status IN ('in_transit', 'arrived')",
    args: [c.req.param("id") as string, c.get("user").sub],
  })).rows[0] as Row | undefined;
  return row ?? null;
}

/** The matatu reached the drop stage: tell the last rider and the customer. */
relayRoutes.post("/relay/operator/legs/:id/arrived", async (c) => {
  const leg = await operatorLeg(c);
  if (!leg) return c.json({ error: "not_found", message: "This parcel isn't on your matatu." }, 404);
  await db.execute({ sql: "UPDATE order_relay_legs SET status = 'arrived' WHERE id = ? AND status = 'in_transit'", args: [String(leg.id)] });
  await markMatesArrived(String(leg.order_id), c.get("user").sub);
  await noticeMatatuArrived(String(leg.order_id));
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Deliver', ?, ?)",
    args: [newId("evt"), String(leg.order_id), `Matatu reached ${leg.to_name}`, c.get("user").sub],
  });
  const order = (await db.execute({ sql: "SELECT customer_id, rider_id FROM orders WHERE id = ?", args: [String(leg.order_id)] })).rows[0] as Row | undefined;
  const sends: Promise<void>[] = [];
  if (order?.rider_id) sends.push(notifyUser(String(order.rider_id), { title: "The matatu is at the stage", body: `Collect the parcel at ${leg.to_name}.`, url: `/jobs/${leg.order_id}`, tag: `relay-${leg.order_id}` }));
  if (order?.customer_id) sends.push(notifyUser(String(order.customer_id), { title: "Your parcel reached the stage", body: `It's at ${leg.to_name}, waiting for the last rider.`, url: `/orders/${leg.order_id}`, tag: `order-${leg.order_id}` }));
  await Promise.allSettled(sends);
  return c.json({ ok: true });
});

const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** The matatu's position while it carries the parcel — shown to the customer as the live location. */
relayRoutes.post("/relay/operator/legs/:id/location", async (c) => {
  const leg = await operatorLeg(c);
  if (!leg) return c.json({ error: "not_found" }, 404);
  const parsed = locationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  if (await hasColumn("orders", "rider_location_updated_at")) {
    await db.execute({
      sql: "UPDATE orders SET rider_lat = ?, rider_lng = ?, rider_location_updated_at = datetime('now') WHERE id = ? AND rider_id IS NULL",
      args: [parsed.data.lat, parsed.data.lng, String(leg.order_id)],
    });
    await shareMatatuPosition(String(leg.order_id), parsed.data.lat, parsed.data.lng);
    await noticeMatatuApproach(String(leg.order_id));
  }
  return c.json({ ok: true });
});

/** At the customer's stage: the operator enters the customer's code and hands them the parcel. */
relayRoutes.post("/relay/operator/handover", async (c) => {
  const parsed = codeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter the customer's code." }, 400);
  try {
    return c.json(await handToCustomerAtStage(c.get("user").sub, parsed.data.code));
  } catch (e) {
    return fail(c, e);
  }
});

/** The customer wasn't at the stage: the parcel goes on to the petrol station near them (admin setting). */
relayRoutes.post("/relay/operator/legs/:id/missed", async (c) => {
  try {
    return c.json(await customerMissedMatatu(c.get("user").sub, c.req.param("id") as string));
  } catch (e) {
    return fail(c, e);
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

relayRoutes.get("/admin/relay/settings", requirePermission("settings.manage"), async (c) => {
  return c.json({ settings: await getRelaySettings(), ready: await relayReady(), stationsReady: await relayStationsReady(), stagesReady: await relayMeetReady() });
});

const settingsSchema = patchSchema(z.object({
  enabled: z.boolean(),
  minDistanceKm: z.number().min(1).max(500),
  maxAccessKm: z.number().min(0.5).max(100),
  lastMileRadiusKm: z.number().min(0.5).max(100),
  releasePerLeg: z.boolean(),
  lastMileChoice: z.enum(["order", "arrival"]),
  stationMaxKm: z.number().min(0.5).max(100),
  stagePickup: z.boolean(),
  stageFallback: z.boolean(),
  matatuSpeedKmh: z.number().min(5).max(120),
  arrivalNoticeMinutes: z.number().int().min(1).max(120),
  sandboxDemo: z.boolean(),
  sandboxDemoStepSeconds: z.number().int().min(5).max(600),
  payBeforeRider: z.boolean(),
  directMaxHours: z.number().int().min(1).max(24),
}));

relayRoutes.put("/admin/relay/settings", requirePermission("settings.manage"), async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const before = await getRelaySettings();
  await setRelaySettings(parsed.data);
  const after = await getRelaySettings();
  await logActivity({ actor: c.get("user"), action: "settings.relay", summary: "Updated relay delivery settings", entityType: "settings", entityId: "relay", before, after, ip: ip(c) });
  return c.json({ settings: after });
});

relayRoutes.get("/admin/relay/routes", requirePermission("settings.manage"), async (c) => {
  if (!(await relayReady())) return c.json({ routes: [], ready: false });
  const res = await db.execute(`SELECT rr.*, (SELECT COUNT(*) FROM relay_operators ro WHERE ro.route_id = rr.id AND ro.status = 'approved') AS operators
                                FROM relay_routes rr ORDER BY rr.active DESC, rr.name`);
  // Each route both ways, written like a ticket: "KLA ⇄ EBB", "KLA - EBB" and "EBB - KLA".
  const routes = (res.rows as Row[]).map((route) => {
    const codes = routeCodes(route);
    return { ...route, codes, route_code: routeCodeLabel(route), directions: [directionLabel(route, "a"), directionLabel(route, "b")] };
  });
  return c.json({ routes, ready: true, codesReady: await routeCodesReady() });
});

const routeFields = {
  name: z.string().trim().min(2).max(80),
  stageAName: z.string().trim().min(2).max(80),
  stageALat: z.number().min(-90).max(90),
  stageALng: z.number().min(-180).max(180),
  stageBName: z.string().trim().min(2).max(80),
  stageBLat: z.number().min(-90).max(90),
  stageBLng: z.number().min(-180).max(180),
  parcelFare: z.number().int().min(0).max(1_000_000),
  active: z.boolean(),
  /** Where the matatu hands over at the far end: to a rider at the stage, or at the petrol station nearest the customer. */
  dropMode: z.enum(["stage", "station"]),
  /** Short codes for the two ends, like a ticket ("KLA", "EBB"). Empty clears one. */
  stageACode: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.union([z.literal(""), z.string().regex(/^[A-Z]{2,4}$/, "Use 2 to 4 letters")]).nullable()),
  stageBCode: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.union([z.literal(""), z.string().regex(/^[A-Z]{2,4}$/, "Use 2 to 4 letters")]).nullable()),
};

const codesUnavailable = { error: "codes_unavailable", message: "Apply migration 0107 first to save stage codes." } as const;

relayRoutes.post("/admin/relay/routes", requirePermission("settings.manage"), async (c) => {
  if (!(await relayReady())) return c.json({ error: "relay_unavailable", message: "Apply migration 0102 first." }, 503);
  const parsed = z.object({
    ...routeFields, active: routeFields.active.default(true), dropMode: routeFields.dropMode.optional(),
    stageACode: routeFields.stageACode.optional(), stageBCode: routeFields.stageBCode.optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  // Parcels go to the petrol station by default (once stations are set up).
  const d = { ...parsed.data, dropMode: parsed.data.dropMode ?? ((await relayStationsReady()) ? "station" : "stage") };
  if (d.dropMode === "station" && !(await relayStationsReady())) {
    return c.json({ error: "stations_unavailable", message: "Apply migration 0105 to drop at petrol stations." }, 503);
  }
  const hasCodes = !!(d.stageACode || d.stageBCode);
  if (hasCodes && !(await routeCodesReady())) return c.json(codesUnavailable, 503);
  const id = newId("rrt");
  await db.execute({
    sql: `INSERT INTO relay_routes (id, name, stage_a_name, stage_a_lat, stage_a_lng, stage_b_name, stage_b_lat, stage_b_lng, parcel_fare, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, d.name, d.stageAName, d.stageALat, d.stageALng, d.stageBName, d.stageBLat, d.stageBLng, d.parcelFare, d.active ? 1 : 0],
  });
  if (d.dropMode === "station") await db.execute({ sql: "UPDATE relay_routes SET drop_mode = 'station' WHERE id = ?", args: [id] });
  if (hasCodes) {
    await db.execute({ sql: "UPDATE relay_routes SET stage_a_code = ?, stage_b_code = ? WHERE id = ?", args: [d.stageACode || null, d.stageBCode || null, id] });
  }
  await logActivity({ actor: c.get("user"), action: "relay.route.create", summary: `Added relay route "${d.name}"`, entityType: "relay_route", entityId: id, after: d, ip: ip(c) });
  return c.json({ id }, 201);
});

relayRoutes.patch("/admin/relay/routes/:id", requirePermission("settings.manage"), async (c) => {
  const id = c.req.param("id") as string;
  const before = (await db.execute({ sql: "SELECT * FROM relay_routes WHERE id = ?", args: [id] })).rows[0] as Row | undefined;
  if (!before) return c.json({ error: "not_found" }, 404);
  const parsed = patchSchema(z.object(routeFields)).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const columns: [string, unknown][] = [
    ["name", d.name], ["stage_a_name", d.stageAName], ["stage_a_lat", d.stageALat], ["stage_a_lng", d.stageALng],
    ["stage_b_name", d.stageBName], ["stage_b_lat", d.stageBLat], ["stage_b_lng", d.stageBLng],
    ["parcel_fare", d.parcelFare], ["active", d.active == null ? undefined : d.active ? 1 : 0],
    ["drop_mode", d.dropMode],
    // An empty code clears it (the name's fallback is shown again).
    ["stage_a_code", d.stageACode === undefined ? undefined : d.stageACode || null],
    ["stage_b_code", d.stageBCode === undefined ? undefined : d.stageBCode || null],
  ];
  if (d.dropMode && !(await relayStationsReady())) {
    return c.json({ error: "stations_unavailable", message: "Apply migration 0105 to drop at petrol stations." }, 503);
  }
  if ((d.stageACode !== undefined || d.stageBCode !== undefined) && !(await routeCodesReady())) return c.json(codesUnavailable, 503);
  const set = columns.filter(([, value]) => value !== undefined);
  if (!set.length) return c.json({ ok: true });
  await db.execute({
    sql: `UPDATE relay_routes SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    args: [...set.map(([, value]) => value as string | number | null), id],
  });
  await logActivity({ actor: c.get("user"), action: "relay.route.update", summary: `Updated relay route "${before.name}"`, entityType: "relay_route", entityId: id, before, after: d, ip: ip(c) });
  return c.json({ ok: true });
});

relayRoutes.get("/admin/relay/operators", requirePermission("riders.view"), async (c) => {
  if (!(await relayReady())) return c.json({ operators: [] });
  const [res, routes] = await Promise.all([
    db.execute(`SELECT ro.*, u.name, u.phone AS account_phone, rr.name AS route_name,
                       (SELECT COUNT(*) FROM order_relay_legs l WHERE l.leg = 2 AND l.provider_id = ro.user_id AND l.status = 'done') AS parcels
                FROM relay_operators ro JOIN users u ON u.id = ro.user_id LEFT JOIN relay_routes rr ON rr.id = ro.route_id
                ORDER BY CASE ro.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, ro.updated_at DESC`),
    db.execute("SELECT * FROM relay_routes"),
  ]);
  const codeOf = new Map((routes.rows as Row[]).map((route) => [String(route.id), routeCodeLabel(route)]));
  return c.json({ operators: (res.rows as Row[]).map((row) => ({ ...row, route_code: row.route_id ? codeOf.get(String(row.route_id)) ?? null : null })) });
});

relayRoutes.post("/admin/relay/operators/:userId/status", requirePermission("riders.verify"), async (c) => {
  const userId = c.req.param("userId") as string;
  const parsed = z.object({ status: z.enum(["approved", "suspended", "pending"]) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const before = (await db.execute({ sql: "SELECT * FROM relay_operators WHERE user_id = ?", args: [userId] })).rows[0] as Row | undefined;
  if (!before) return c.json({ error: "not_found" }, 404);
  await db.execute({ sql: "UPDATE relay_operators SET status = ?, updated_at = datetime('now') WHERE user_id = ?", args: [parsed.data.status, userId] });
  if (parsed.data.status === "approved") await ensureProviderWorkWallet("relay", userId, await getPlatformEnvironment());
  await logActivity({ actor: c.get("user"), action: "relay.operator.status", summary: `Set matatu operator ${before.vehicle_plate} to ${parsed.data.status}`, entityType: "relay_operator", entityId: userId, before, after: parsed.data, ip: ip(c) });
  if (parsed.data.status === "approved") {
    await notifyUser(userId, { title: "You're approved for relay parcels", body: "Open Relay parcels in the Peebee Car app to receive them.", url: "/relay", tag: "relay-approved" }).catch(() => {});
  }
  return c.json({ ok: true });
});

/** Recent relayed orders with every leg, for oversight. */
relayRoutes.get("/admin/relay/orders", requirePermission("orders.view"), async (c) => {
  if (!(await relayReady())) return c.json({ orders: [] });
  const res = await db.execute(`SELECT l.*, o.stage, o.created_at AS order_created_at, o.environment, u.name AS provider_name
                                FROM order_relay_legs l JOIN orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = l.provider_id
                                WHERE l.order_id IN (SELECT order_id FROM order_relay_legs GROUP BY order_id ORDER BY MAX(created_at) DESC LIMIT 50)
                                ORDER BY o.created_at DESC, l.leg`);
  const byOrder = new Map<string, Row & { legs: Row[] }>();
  for (const row of res.rows as Row[]) {
    const id = String(row.order_id);
    if (!byOrder.has(id)) byOrder.set(id, { id, stage: row.stage, createdAt: row.order_created_at, environment: row.environment, legs: [] });
    byOrder.get(id)!.legs.push({
      leg: row.leg, kind: row.kind, fromName: row.from_name, toName: row.to_name, fee: row.fee, status: row.status,
      providerName: row.provider_name, handedOverAt: row.handed_over_at, paidAmount: row.paid_amount, paidAt: row.paid_at,
    });
  }
  return c.json({ orders: [...byOrder.values()] });
});

/** Peebee Gas stations, and whether each accepts relay parcels. */
relayRoutes.get("/admin/relay/stations", requirePermission("settings.manage"), async (c) => {
  if (!(await relayStationsReady())) return c.json({ stations: [], ready: false });
  const routes = (await relayMeetReady())
    ? `(SELECT GROUP_CONCAT(rr.name, ', ') FROM relay_route_stages st JOIN relay_routes rr ON rr.id = st.route_id WHERE st.outlet_id = o.id AND st.active = 1)`
    : "NULL";
  const res = await db.execute(`SELECT o.id, o.name, o.address, o.lat, o.lng, o.status, o.relay_drop, s.brand_name AS station_name,
                                       (SELECT COUNT(*) FROM order_relay r WHERE r.outlet_id = o.id AND r.held_at IS NOT NULL AND r.released_at IS NULL) AS holding,
                                       ${routes} AS routes
                                FROM fuel_station_outlets o JOIN fuel_stations s ON s.id = o.station_id
                                ORDER BY o.relay_drop DESC, s.brand_name, o.name`);
  return c.json({ stations: res.rows, ready: true });
});

relayRoutes.post("/admin/relay/stations/:outletId", requirePermission("settings.manage"), async (c) => {
  if (!(await relayStationsReady())) return c.json({ error: "stations_unavailable", message: "Apply migration 0105 first." }, 503);
  const outletId = c.req.param("outletId") as string;
  // `relayDrop: true/false` is kept for older admin builds; `mode` adds sandbox-only stations.
  const parsed = z.object({ relayDrop: z.boolean().optional(), mode: z.enum(["off", "sandbox", "live"]).optional() })
    .refine((b) => b.mode != null || b.relayDrop != null)
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const mode = parsed.data.mode ?? (parsed.data.relayDrop ? "live" : "off");
  const value = mode === "live" ? RELAY_DROP_LIVE : mode === "sandbox" ? RELAY_DROP_SANDBOX : RELAY_DROP_OFF;
  const before = (await db.execute({ sql: "SELECT id, name, relay_drop, lat, lng FROM fuel_station_outlets WHERE id = ?", args: [outletId] })).rows[0] as Row | undefined;
  if (!before) return c.json({ error: "not_found" }, 404);
  if (value !== RELAY_DROP_OFF && (before.lat == null || before.lng == null)) {
    return c.json({ error: "location_required", message: "Set this station's map location first." }, 400);
  }
  await db.execute({ sql: "UPDATE fuel_station_outlets SET relay_drop = ?, updated_at = datetime('now') WHERE id = ?", args: [value, outletId] });
  const label = { off: "Closed", sandbox: "Opened (sandbox & practice only)", live: "Opened" }[mode];
  await logActivity({
    actor: c.get("user"), action: "relay.station", summary: `${label} ${before.name} for relay parcels`,
    entityType: "fuel_station_outlet", entityId: outletId, before: { relayDrop: before.relay_drop }, after: { relayDrop: value, mode }, ip: ip(c),
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Route stages (admin)
// ---------------------------------------------------------------------------

/** A route's stops between stage A and stage B. A stop can be a Peebee Gas station. */
relayRoutes.get("/admin/relay/routes/:id/stages", requirePermission("settings.manage"), async (c) => {
  if (!(await relayMeetReady())) return c.json({ stages: [], ready: false });
  const res = await db.execute({
    sql: `SELECT st.*, o.name AS outlet_name, fs.brand_name AS station_brand FROM relay_route_stages st
          LEFT JOIN fuel_station_outlets o ON o.id = st.outlet_id LEFT JOIN fuel_stations fs ON fs.id = o.station_id
          WHERE st.route_id = ? ORDER BY st.seq, st.created_at`,
    args: [c.req.param("id") as string],
  });
  return c.json({ stages: res.rows, ready: true });
});

const stageFields = {
  name: z.string().trim().min(2).max(80),
  seq: z.number().int().min(0).max(1000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Make this stop a Peebee Gas station; its location is used. */
  outletId: z.string().nullable(),
  active: z.boolean(),
};

async function outletLocation(outletId: string): Promise<{ lat: number; lng: number; name: string } | null> {
  const row = (await db.execute({
    sql: "SELECT o.name, o.lat, o.lng, s.brand_name FROM fuel_station_outlets o JOIN fuel_stations s ON s.id = o.station_id WHERE o.id = ?",
    args: [outletId],
  })).rows[0] as Row | undefined;
  if (!row || row.lat == null || row.lng == null) return null;
  return { lat: Number(row.lat), lng: Number(row.lng), name: stationDisplayName(row.brand_name, row.name) };
}

relayRoutes.post("/admin/relay/routes/:id/stages", requirePermission("settings.manage"), async (c) => {
  if (!(await relayMeetReady())) return c.json({ error: "stages_unavailable", message: "Apply migration 0106 first." }, 503);
  const routeId = c.req.param("id") as string;
  const route = (await db.execute({ sql: "SELECT name FROM relay_routes WHERE id = ?", args: [routeId] })).rows[0] as Row | undefined;
  if (!route) return c.json({ error: "not_found" }, 404);
  const parsed = z.object({ ...stageFields, name: stageFields.name.optional(), lat: stageFields.lat.optional(), lng: stageFields.lng.optional(), outletId: stageFields.outletId.default(null), active: stageFields.active.default(true), seq: stageFields.seq.default(0) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const outlet = d.outletId ? await outletLocation(d.outletId) : null;
  if (d.outletId && !outlet) return c.json({ error: "location_required", message: "That station has no map location." }, 400);
  const name = d.name ?? outlet?.name;
  const lat = outlet?.lat ?? d.lat;
  const lng = outlet?.lng ?? d.lng;
  if (!name || lat == null || lng == null) return c.json({ error: "invalid_body", message: "Give the stage a name and location, or pick a station." }, 400);
  const id = newId("rst");
  await db.execute({
    sql: "INSERT INTO relay_route_stages (id, route_id, seq, name, lat, lng, outlet_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, routeId, d.seq, name, lat, lng, d.outletId, d.active ? 1 : 0],
  });
  await logActivity({ actor: c.get("user"), action: "relay.stage.create", summary: `Added stage "${name}" to ${route.name}`, entityType: "relay_stage", entityId: id, after: { ...d, name, lat, lng }, ip: ip(c) });
  return c.json({ id }, 201);
});

relayRoutes.patch("/admin/relay/stages/:id", requirePermission("settings.manage"), async (c) => {
  const id = c.req.param("id") as string;
  const before = (await db.execute({ sql: "SELECT * FROM relay_route_stages WHERE id = ?", args: [id] })).rows[0] as Row | undefined;
  if (!before) return c.json({ error: "not_found" }, 404);
  const parsed = patchSchema(z.object(stageFields)).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const outlet = d.outletId ? await outletLocation(d.outletId) : null;
  if (d.outletId && !outlet) return c.json({ error: "location_required", message: "That station has no map location." }, 400);
  const columns: [string, unknown][] = [
    ["name", d.name], ["seq", d.seq], ["lat", outlet?.lat ?? d.lat], ["lng", outlet?.lng ?? d.lng],
    ["outlet_id", d.outletId === undefined ? undefined : d.outletId], ["active", d.active == null ? undefined : d.active ? 1 : 0],
  ];
  const set = columns.filter(([, value]) => value !== undefined);
  if (set.length) {
    await db.execute({
      sql: `UPDATE relay_route_stages SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      args: [...set.map(([, value]) => value as string | number | null), id],
    });
  }
  await logActivity({ actor: c.get("user"), action: "relay.stage.update", summary: `Updated stage "${before.name}"`, entityType: "relay_stage", entityId: id, before, after: d, ip: ip(c) });
  return c.json({ ok: true });
});
