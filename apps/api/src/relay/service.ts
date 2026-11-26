import { visibleHere } from "../practice/people.js";
import { primeDemoAccounts, ridersForThisWorld } from "../practice/people.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { isGuestOrder } from "../guest/service.js";
import { roundFare } from "@peebee/shared";
import { db, executeBatch, requireChangedRow } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { getRoadSettings, roadLegsKm } from "../lib/road-distance.js";
import { newId } from "../lib/ids.js";
import { riderPayout } from "../lib/monetization.js";
import { randomInt } from "../lib/random.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getDeliverySettings, getPlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditProviderWorkWallet, ensureProviderWorkWallet } from "../wallet/provider-work-wallet.js";
import { ledgerBalance, postLedgerTransaction } from "../ledger/service.js";
import { getRelaySettings } from "./settings.js";
import { beyondRiderRange, riderRangeKm } from "../orders/matching.js";
import { directionFrom, directionLabel, legDirections, routeCodeLabel, type RouteEnd } from "./direction.js";

/**
 * Relay delivery: a parcel too far for one boda goes boda -> matatu -> boda.
 *
 *  leg 1  first rider: pickup -> boarding stage, hands the parcel to the matatu
 *  leg 2  matatu operator: boarding stage -> drop stage
 *  leg 3  last rider: drop stage -> customer, who gives the usual 4-digit PIN
 *
 * On a "station" route the matatu doesn't stop for a rider: it drops the
 * parcel at the Peebee Gas station nearest the customer, where the pump
 * attendant keeps it. From there the customer collects it with their code,
 * or a rider takes it to the door (leg 3, paid up front or added later).
 *
 * Each handoff is confirmed by the receiver entering (or scanning) the giver's
 * code, which stamps the time and who took it. Each leg is priced at its own
 * normal rate and the customer pays the sum. The order's rider_id always names
 * whoever is carrying it on a boda; while it rides the matatu it is NULL.
 */

type Row = Record<string, unknown>;

export type RelayLegPlan = {
  leg: 1 | 2 | 3;
  kind: "boda" | "matatu";
  fromName: string;
  fromLat: number;
  fromLng: number;
  toName: string;
  toLat: number;
  toLng: number;
  distanceKm: number;
  fee: number;
};

export type RelayDropMode = "stage" | "station";
/** A stop on a route: its two end stages and the stages between, any of which may be a petrol station. */
export type RouteStage = { id: string; name: string; lat: number; lng: number; outletId: string | null };
export type RelayLastMile = "door" | "collect" | "pending";

export type RelayPlan = {
  routeId: string;
  /** The route's full name, kept for older clients; what people see is `direction`. */
  routeName: string;
  /** This trip's direction, written like a ticket: "KLA - EBB" (stage A to B) or "EBB - KLA". */
  direction: string;
  /** The end the matatu leg starts from. */
  directionFrom: RouteEnd;
  /** The route both ways: "KLA ⇄ EBB". */
  routeCode: string;
  legs: RelayLegPlan[];
  /** Every leg, to the door. */
  total: number;
  dropMode: RelayDropMode;
  /** Station routes: the drop station, and what the customer pays to collect there (legs 1 and 2). */
  station?: { outletId: string; name: string; address: string | null; lat: number; lng: number };
  collectTotal?: number;
  /** Stages near the customer where they can meet the matatu instead (when admin allows it). */
  meetStages?: Array<RouteStage & { distanceKm: number }>;
};

type Point = { lat: number; lng: number; name?: string | null };

export async function relayReady(): Promise<boolean> {
  return (await hasTable("order_relay_legs")) && (await hasTable("relay_routes")) && (await hasTable("relay_operators"));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The cheapest relay for a delivery, or null when it should go on one boda as usual.
 * Distances follow the road. A rider collecting from several stores first starts at
 * `opts.start` and rides `opts.leadInKm` before `pickup` (the last store); `opts.tripKm`
 * is the whole one-rider trip, which decides whether a relay is worth offering.
 */
export async function planRelay(
  pickup: Point,
  destination: Point,
  opts: { start?: Point; leadInKm?: number; tripKm?: number } = {},
): Promise<RelayPlan | null> {
  const settings = await getRelaySettings();
  if (!settings.enabled || !(await relayReady())) return null;
  const { factor } = await getRoadSettings();
  const road = (a: Point, b: Point) => haversineKm(a.lat, a.lng, b.lat, b.lng) * factor;
  const leadInKm = opts.leadInKm ?? 0;
  const start = opts.start ?? pickup;
  const directKm = opts.tripKm ?? road(pickup, destination);
  if (directKm < settings.minDistanceKm) return null;

  const relayWorld = await getPlatformEnvironment();
  const routes = ((await db.execute("SELECT * FROM relay_routes WHERE active = 1")).rows as Row[]).filter((r) => visibleHere(relayWorld, String(r.id)));
  const { deliveryRatePerKm, minimumDeliveryFee } = await getDeliverySettings();
  const stationsReady = await relayStationsReady();
  const boda = (km: number) => roundFare(km * deliveryRatePerKm, minimumDeliveryFee);
  let best: RelayPlan | null = null;
  const stagePickup = settings.stagePickup && (await relayMeetReady());
  for (const route of routes) {
    const stages = await routeStages(route);
    // A route drops only at its own stations (its stops that are petrol stations). With none open
    // near the customer, it hands over at the stage instead.
    const station = stationsReady && route.drop_mode === "station" ? await nearestDropStation(route, stages, destination, settings.stationMaxKm) : null;
    const dropMode: RelayDropMode = station ? "station" : "stage";
    // Board at the route's stage nearest the pickup.
    const board = nearestStage(stages, pickup);
    if (!board || board.km > settings.maxAccessKm) continue;
    const rest = stages.filter((stage) => stage.id !== board.stage.id);
    // A stage drop hands over at the stage nearest the customer; a station drop at the station nearest them.
    const stageEnd = nearestStage(rest, destination);
    if (dropMode === "stage" && (!stageEnd || stageEnd.km > settings.maxAccessKm)) continue;
    const alight = dropMode === "station" ? station! : stageEnd!.stage;
    // Which way the matatu runs: by stop order when both ends are known stops (a station that
    // is a stop, or a sandbox demo station beside one, takes that stop's place), else by
    // which end is nearer stage A.
    const alightIndex = dropMode === "station"
      ? stages.findIndex((stage) => stage.outletId === station!.outletId || (!stage.outletId && demoOutletId(route, stage) === station!.outletId))
      : stages.indexOf(stageEnd!.stage);
    const fromEnd = directionFrom(
      stages[0],
      { lat: board.stage.lat, lng: board.stage.lng, index: stages.indexOf(board.stage) },
      { lat: alight.lat, lng: alight.lng, index: alightIndex },
    );
    const firstKm = leadInKm + board.km * factor;
    const lastKm = road(alight, destination);
    // The matatu has to actually carry it most of the way.
    if (firstKm + lastKm >= directKm) continue;
    const legs: RelayLegPlan[] = [
      {
        leg: 1, kind: "boda", fromName: start.name || pickup.name || "Pickup", fromLat: start.lat, fromLng: start.lng,
        toName: board.stage.name, toLat: board.stage.lat, toLng: board.stage.lng, distanceKm: round1(firstKm), fee: boda(firstKm),
      },
      {
        leg: 2, kind: "matatu", fromName: board.stage.name, fromLat: board.stage.lat, fromLng: board.stage.lng,
        toName: alight.name, toLat: alight.lat, toLng: alight.lng,
        distanceKm: round1(haversineKm(board.stage.lat, board.stage.lng, alight.lat, alight.lng)),
        fee: Math.max(0, Math.round(Number(route.parcel_fare) || 0)),
      },
      {
        leg: 3, kind: "boda", fromName: alight.name, fromLat: alight.lat, fromLng: alight.lng,
        toName: destination.name || "Destination", toLat: destination.lat, toLng: destination.lng, distanceKm: round1(lastKm), fee: boda(lastKm),
      },
    ];
    const total = legs.reduce((sum, leg) => sum + leg.fee, 0);
    if (!best || total < best.total) {
      const meetStages = dropMode === "station" && stagePickup
        ? rest
            .map((stage) => ({ ...stage, distanceKm: round1(haversineKm(stage.lat, stage.lng, destination.lat, destination.lng)) }))
            .filter((stage) => stage.distanceKm <= settings.maxAccessKm)
            .sort((x, y) => x.distanceKm - y.distanceKm)
            .slice(0, 5)
        : [];
      best = {
        routeId: String(route.id), routeName: String(route.name), legs, total, dropMode,
        direction: directionLabel(route, fromEnd), directionFrom: fromEnd, routeCode: routeCodeLabel(route),
        ...(dropMode === "station" ? { station: station!, collectTotal: legs[0].fee + legs[1].fee, meetStages } : {}),
      };
    }
  }
  return best ? withRoadDistances(best, pickup, leadInKm) : null;
}

/** With a routing server, the chosen plan's boda legs get their true road distances and fees. */
async function withRoadDistances(plan: RelayPlan, pickup: Point, leadInKm: number): Promise<RelayPlan> {
  if (!(await getRoadSettings()).routingServerUrl) return plan;
  const { deliveryRatePerKm, minimumDeliveryFee } = await getDeliverySettings();
  const [first, , last] = plan.legs;
  const [toBoard] = await roadLegsKm([pickup, { lat: first.toLat, lng: first.toLng }]);
  const [toDoor] = await roadLegsKm([{ lat: last.fromLat, lng: last.fromLng }, { lat: last.toLat, lng: last.toLng }]);
  first.distanceKm = round1(leadInKm + toBoard);
  last.distanceKm = round1(toDoor);
  first.fee = roundFare(first.distanceKm * deliveryRatePerKm, minimumDeliveryFee);
  last.fee = roundFare(last.distanceKm * deliveryRatePerKm, minimumDeliveryFee);
  plan.total = plan.legs.reduce((sum, leg) => sum + leg.fee, 0);
  if (plan.dropMode === "station") plan.collectTotal = first.fee + plan.legs[1].fee;
  return plan;
}

/** Migration 0106 adds defined route stages and meeting the matatu. */
export async function relayMeetReady(): Promise<boolean> {
  return (await hasTable("relay_route_stages")) && (await hasColumn("order_relay", "meet_stage_id"));
}

/** A route's stops in order: stage A, the stages admin defined between, then stage B. */
export async function routeStages(route: Row): Promise<RouteStage[]> {
  const a: RouteStage = { id: `${String(route.id)}:a`, name: String(route.stage_a_name), lat: Number(route.stage_a_lat), lng: Number(route.stage_a_lng), outletId: null };
  const b: RouteStage = { id: `${String(route.id)}:b`, name: String(route.stage_b_name), lat: Number(route.stage_b_lat), lng: Number(route.stage_b_lng), outletId: null };
  if (!(await hasTable("relay_route_stages"))) return [a, b];
  const rows = (await db.execute({
    sql: "SELECT * FROM relay_route_stages WHERE route_id = ? AND active = 1 ORDER BY seq, created_at",
    args: [String(route.id)],
  })).rows as Row[];
  const middle = rows.map((row) => ({ id: String(row.id), name: String(row.name), lat: Number(row.lat), lng: Number(row.lng), outletId: (row.outlet_id as string | null) ?? null }));
  return [a, ...middle, b];
}

function nearestStage(stages: RouteStage[], point: Point): { stage: RouteStage; km: number } | null {
  let best: { stage: RouteStage; km: number } | null = null;
  for (const stage of stages) {
    const km = haversineKm(stage.lat, stage.lng, point.lat, point.lng);
    if (!best || km < best.km) best = { stage, km };
  }
  return best;
}

/** Migration 0105 adds petrol-station drops. Until then every route drops at a stage. */
export async function relayStationsReady(): Promise<boolean> {
  return (await hasTable("order_relay")) && (await hasColumn("relay_routes", "drop_mode")) && (await hasColumn("fuel_station_outlets", "relay_drop"));
}

/**
 * How a station takes relay parcels, as staff set it: 0 not at all, 1 always,
 * 2 only in sandbox (and practice), for stations still being trialled.
 */
export const RELAY_DROP_OFF = 0;
export const RELAY_DROP_LIVE = 1;
export const RELAY_DROP_SANDBOX = 2;
/**
 * Sandbox demo petrol stations are stored 'closed' (so no live list shows them) under ids
 * with this prefix; sandbox relay planning recognises them by it.
 */
export const DEMO_OUTLET_PREFIX = "demo-relay-out-";

/**
 * A station's display name: "Shell Kitoro" from brand "Shell" and outlet "Kitoro", but just
 * "Shell Akright" when the outlet's own name already starts with the brand.
 */
export function stationDisplayName(brand: unknown, outlet: unknown): string {
  const b = typeof brand === "string" ? brand.trim() : "";
  const o = typeof outlet === "string" ? outlet.trim() : "";
  const word = b.split(/[\s(]+/)[0]?.toLowerCase();
  if (o && word && o.toLowerCase().startsWith(word)) return o;
  return [b, o].filter(Boolean).join(" ");
}

/** The sandbox demo station the simulator keeps beside a route stop (see sandbox-demo.ts). */
export function demoOutletId(route: Row, stage: RouteStage): string {
  const end = stage.id === `${String(route.id)}:a` ? "a" : stage.id === `${String(route.id)}:b` ? "b" : null;
  return `${DEMO_OUTLET_PREFIX}${end ? `${String(route.id)}-${end}` : stage.id}`;
}

/**
 * The route's station that accepts relay parcels nearest the customer, within the admin's limit.
 * Relay is rolled out route by route: a route only uses the stations that are its stops.
 */
async function nearestDropStation(route: Row, stages: RouteStage[], destination: Point, maxKm: number): Promise<RelayPlan["station"] | null> {
  const sandbox = (await getPlatformEnvironment()) === "sandbox";
  const modes = sandbox ? [RELAY_DROP_LIVE, RELAY_DROP_SANDBOX] : [RELAY_DROP_LIVE];
  const ids = stages.map((stage) => stage.outletId).filter((id): id is string => !!id);
  // Sandbox also uses the route's demo stations, which are stored closed so no live list shows them.
  const demoIds = sandbox ? stages.filter((stage) => !stage.outletId).map((stage) => demoOutletId(route, stage)) : [];
  if (!ids.length && !demoIds.length) return null;
  const outlets = (await db.execute({
    sql: `SELECT o.id, o.name, o.address, o.lat, o.lng, s.brand_name AS station_name
          FROM fuel_station_outlets o JOIN fuel_stations s ON s.id = o.station_id
          WHERE o.relay_drop IN (${modes.map(() => "?").join(",")})
            AND ((o.status = 'active' AND o.id IN (${ids.map(() => "?").join(",") || "NULL"}))
                 OR o.id IN (${demoIds.map(() => "?").join(",") || "NULL"}))
            AND o.lat IS NOT NULL AND o.lng IS NOT NULL`,
    args: [...modes, ...ids, ...demoIds],
  })).rows as Row[];
  let best: { row: Row; km: number } | null = null;
  for (const row of outlets) {
    const km = haversineKm(Number(row.lat), Number(row.lng), destination.lat, destination.lng);
    if (km <= maxKm && (!best || km < best.km)) best = { row, km };
  }
  if (!best) return null;
  const name = stationDisplayName(best.row.station_name, best.row.name) || "Petrol station";
  return { outletId: String(best.row.id), name, address: (best.row.address as string | null) ?? null, lat: Number(best.row.lat), lng: Number(best.row.lng) };
}

/** What the customer is charged for a plan, given how the last mile goes. */
export function relayChargeFor(plan: RelayPlan, lastMile: RelayLastMile): number {
  return plan.dropMode === "station" && lastMile !== "door" ? plan.collectTotal ?? plan.total : plan.total;
}

export type RelayMeet = RouteStage;

/** The last-mile choice an order starts with: stage routes always go to the door. */
export async function initialLastMile(plan: RelayPlan, requested: "door" | "collect" | "meet" | undefined): Promise<RelayLastMile> {
  return (await resolveLastMile(plan, requested)).lastMile;
}

/**
 * How the parcel reaches the customer. On a station route they may meet the
 * matatu at a stage (when admin allows it), which is paid like collecting at
 * the station; if they miss it, the parcel goes on to the station.
 */
export async function resolveLastMile(
  plan: RelayPlan,
  requested: "door" | "collect" | "meet" | undefined,
  meetStageId?: string,
): Promise<{ lastMile: RelayLastMile; meet: RelayMeet | null }> {
  if (plan.dropMode !== "station") return { lastMile: "door", meet: null };
  if (requested === "meet") {
    const meet = plan.meetStages?.find((stage) => stage.id === meetStageId) ?? plan.meetStages?.[0];
    if (meet) return { lastMile: "collect", meet };
  }
  if ((await getRelaySettings()).lastMileChoice === "arrival") return { lastMile: "pending", meet: null };
  return { lastMile: requested === "collect" ? "collect" : "door", meet: null };
}

function newHandoffCode(): string {
  return String(100000 + randomInt(900000));
}

export async function insertRelayLegs(orderId: string, plan: RelayPlan, lastMile: RelayLastMile = "door", meet: RelayMeet | null = null): Promise<void> {
  if (await relayStationsReady()) {
    await db.execute({
      sql: `INSERT INTO order_relay (order_id, drop_mode, outlet_id, last_mile, collect_code, release_code) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [orderId, plan.dropMode, plan.station?.outletId ?? null, lastMile,
        plan.dropMode === "station" ? newHandoffCode() : null, plan.dropMode === "station" ? newHandoffCode() : null],
    });
    if (meet && (await relayMeetReady())) {
      await db.execute({
        sql: "UPDATE order_relay SET meet_stage_id = ?, meet_stage_name = ?, meet_lat = ?, meet_lng = ? WHERE order_id = ?",
        args: [meet.id, meet.name, meet.lat, meet.lng, orderId],
      });
    }
  }
  // Meeting the customer: the matatu leg ends at their stage.
  if (meet) {
    const leg2 = plan.legs.find((leg) => leg.leg === 2);
    if (leg2) {
      leg2.toName = meet.name;
      leg2.toLat = meet.lat;
      leg2.toLng = meet.lng;
      leg2.distanceKm = round1(haversineKm(leg2.fromLat, leg2.fromLng, meet.lat, meet.lng));
    }
  }
  await executeBatch(plan.legs.map((leg) => ({
    sql: `INSERT INTO order_relay_legs (id, order_id, leg, kind, route_id, from_name, from_lat, from_lng, to_name, to_lat, to_lng, distance_km, fee, status, handoff_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
    args: [
      newId("rleg"), orderId, leg.leg, leg.kind, plan.routeId, leg.fromName, leg.fromLat, leg.fromLng,
      leg.toName, leg.toLat, leg.toLng, leg.distanceKm, leg.fee, leg.leg === 3 ? null : newHandoffCode(),
    ],
  })));
}

export async function relayRow(orderId: string): Promise<Row | null> {
  if (!(await hasTable("order_relay"))) return null;
  return ((await db.execute({ sql: "SELECT * FROM order_relay WHERE order_id = ?", args: [orderId] })).rows[0] as Row | undefined) ?? null;
}

/** Legs the customer paid for: the last boda leg only counts when it goes to the door. */
function boughtLegs(legs: Row[], relay: Row | null): Row[] {
  return relay && relay.last_mile !== "door" ? legs.filter((leg) => Number(leg.leg) < 3) : legs;
}

export async function relayLegs(orderId: string): Promise<Row[]> {
  if (!(await hasTable("order_relay_legs"))) return [];
  return (await db.execute({ sql: "SELECT * FROM order_relay_legs WHERE order_id = ? ORDER BY leg", args: [orderId] })).rows as Row[];
}

/**
 * A relay order the customer may pay before any rider accepts it: admin's
 * "pay before rider" switch is on, it is an escrow order still waiting for its
 * first-leg rider (Create, or Match with no rider), and it rides a relay. The
 * payment is held in escrow exactly as today; when the first rider is assigned
 * the order goes straight to Shop (see assignRider in ../orders/routes.ts).
 */
export async function relayPaysBeforeRider(order: Row): Promise<boolean> {
  if (order.rider_id || order.payment_rail !== "escrow" || !["Create", "Match"].includes(String(order.stage))) return false;
  // A guest has no wallet and no rider to front the money: they always pay first.
  if (await isGuestOrder(String(order.id))) return true;
  if (!(await hasTable("order_relay_legs"))) return false;
  if (!(await getRelaySettings()).payBeforeRider) return false;
  const legs = await db.execute({ sql: "SELECT 1 FROM order_relay_legs WHERE order_id = ? LIMIT 1", args: [String(order.id)] });
  return legs.rows.length > 0;
}

/** Whether the order's current boda rider may act as the final rider (arrive, take the PIN). */
export async function relayBlocksFinalSteps(orderId: string): Promise<boolean> {
  const legs = await relayLegs(orderId);
  if (!legs.length) return false;
  const last = legs.find((leg) => Number(leg.leg) === 3);
  return !last || !["in_transit", "done"].includes(String(last.status));
}

/** The last rider has taken the leg but not yet collected the parcel from the matatu. */
export async function relayAwaitingCollection(orderId: string): Promise<boolean> {
  const legs = await relayLegs(orderId);
  return legs.some((leg) => Number(leg.leg) === 3 && leg.status === "assigned");
}

/** What the order page shows about the relay. Handoff codes only go to whoever is handing over. */
export async function relayView(order: Row, viewerId: string): Promise<Row | null> {
  const legs = await relayLegs(String(order.id));
  if (!legs.length) return null;
  const route = (await db.execute({ sql: "SELECT * FROM relay_routes WHERE id = ?", args: [String(legs[0].route_id)] })).rows[0] as Row | undefined;
  // The direction comes from the matatu leg's ends against the route's stops (not stored).
  const matatuLeg = legs.find((leg) => Number(leg.leg) === 2);
  const direction = matatuLeg ? (await legDirections([matatuLeg])).get(String(matatuLeg.id)) ?? null : null;
  const providers = legs.map((leg) => leg.provider_id).filter(Boolean) as string[];
  const names = new Map<string, Row>();
  if (providers.length) {
    const res = await db.execute({
      sql: `SELECT u.id, u.name, ro.vehicle_plate FROM users u LEFT JOIN relay_operators ro ON ro.user_id = u.id
            WHERE u.id IN (${providers.map(() => "?").join(",")})`,
      args: providers,
    });
    for (const row of res.rows as Row[]) names.set(String(row.id), row);
  }
  const relay = await relayRow(String(order.id));
  const station = relay?.outlet_id
    ? (await db.execute({
        sql: `SELECT o.name, o.address, o.lat, o.lng, o.phone, s.brand_name AS station_name FROM fuel_station_outlets o
              JOIN fuel_stations s ON s.id = o.station_id WHERE o.id = ?`,
        args: [String(relay.outlet_id)],
      })).rows[0] as Row | undefined
    : undefined;
  const isCustomer = order.customer_id === viewerId;
  const leg3 = legs.find((leg) => Number(leg.leg) === 3);
  const atStation = relay?.drop_mode === "station";
  const stillHeld = atStation && !relay?.released_at;
  return {
    routeName: route?.name ?? null,
    direction,
    routeCode: route ? routeCodeLabel(route) : null,
    dropMode: relay?.drop_mode ?? "stage",
    lastMile: relay?.last_mile ?? "door",
    station: station
      ? {
          name: stationDisplayName(station.station_name, station.name),
          address: station.address ?? null, lat: station.lat ?? null, lng: station.lng ?? null, phone: station.phone ?? null,
        }
      : null,
    heldAt: relay?.held_at ?? null,
    releasedAt: relay?.released_at ?? null,
    releasedTo: relay?.released_to ?? null,
    // The customer's code to collect at the station, and the price of sending a rider instead.
    collectCode: isCustomer && stillHeld && relay?.last_mile !== "door" ? relay?.collect_code ?? null : undefined,
    // Meeting the matatu at a stage instead of the station (until missed).
    meetStage: relay?.meet_stage_id ? { name: relay.meet_stage_name, lat: relay.meet_lat, lng: relay.meet_lng } : null,
    missedAt: relay?.missed_at ?? null,
    etaMinutes: await relayEtaMinutes(order),
    sendRiderFee: isCustomer && stillHeld && relay?.last_mile !== "door" ? Number(leg3?.fee ?? 0) : undefined,
    legs: legs.map((leg) => {
      const provider = leg.provider_id ? names.get(String(leg.provider_id)) : undefined;
      const showCode = Number(leg.leg) === 1 && leg.status !== "done" && order.rider_id === viewerId;
      return {
        id: leg.id,
        leg: Number(leg.leg),
        kind: leg.kind,
        fromName: leg.from_name,
        fromLat: leg.from_lat,
        fromLng: leg.from_lng,
        toName: leg.to_name,
        toLat: leg.to_lat,
        toLng: leg.to_lng,
        distanceKm: leg.distance_km,
        fee: leg.fee,
        status: leg.status,
        providerName: provider?.name ?? null,
        vehiclePlate: leg.kind === "matatu" ? provider?.vehicle_plate ?? null : null,
        startedAt: leg.started_at,
        handedOverAt: leg.handed_over_at,
        handoffCode: showCode ? leg.handoff_code : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

const MERCHANT_MODEL = "merchant_allocations_v1";

/** Money records name a user as the actor; station staff aren't users, so their actions carry none. */
const userActor = (actorId: string): string | undefined => (actorId.includes(":") ? undefined : actorId);

/** What the riders and operator share between them: the same amount a single
 * rider would get for this order. Escrow orders: what was collected, less the
 * platform fees locked in at Fund. Merchant-funded store orders: the delivery
 * fee less commission, as settle works it out. */
export async function relayPayoutPool(order: Row): Promise<number> {
  const orderId = String(order.id);
  const fees = (await db.execute({ sql: "SELECT * FROM order_fees WHERE order_id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (order.funds_model === MERCHANT_MODEL) {
    return Math.max(0, Number(order.delivery_fee ?? 0) - Number(fees?.delivery_commission ?? 0) - Number(fees?.processing_fee_rider ?? 0));
  }
  const collected = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful'",
    args: [orderId],
  });
  const released = Number((collected.rows[0] as Row)?.collected ?? 0);
  if (!fees) return released;
  const serviceFee = Number(fees.service_fee) || 0;
  const processingFeeCustomer = Number(fees.processing_fee_customer) || 0;
  return riderPayout(released, {
    serviceFee,
    processingFeeCustomer,
    processingFeeRider: Number(fees.processing_fee_rider) || 0,
    deliveryCommission: Number(fees.delivery_commission) || 0,
    totalSurcharge: serviceFee + processingFeeCustomer,
  });
}

function shareOf(pool: number, legs: Row[], leg: number): number {
  const total = legs.reduce((sum, row) => sum + Number(row.fee), 0);
  const row = legs.find((r) => Number(r.leg) === leg);
  if (!row || total <= 0) return 0;
  return Math.floor((pool * Number(row.fee)) / total);
}

/** Pays one leg once. A boda leg goes to the rider's wallet, the matatu leg to the operator's.
 * On a merchant-funded store order the money moves through the ledger from the order's escrow. */
async function payLeg(order: Row, leg: Row, amount: number, actorId: string): Promise<number> {
  const marked = await db.execute({
    sql: "UPDATE order_relay_legs SET paid_amount = ?, paid_at = datetime('now') WHERE id = ? AND paid_at IS NULL",
    args: [amount, String(leg.id)],
  });
  if (!marked.rowsAffected || amount <= 0 || !leg.provider_id) return marked.rowsAffected ? amount : 0;
  const environment = order.environment === "sandbox" ? "sandbox" : "live";
  const providerId = String(leg.provider_id);
  if (order.funds_model === MERCHANT_MODEL) {
    const isBoda = leg.kind === "boda";
    const relayWalletReady = !isBoda && await hasTable("provider_wallets");
    if (relayWalletReady) await ensureProviderWorkWallet("relay", providerId, environment);
    const relayWalletStatements = isBoda
      ? [{ sql: `UPDATE riders SET ${environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance"} = ${environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance"} + ?, updated_at = datetime('now') WHERE user_id = ?`, args: [amount, providerId] }]
      : relayWalletReady
        ? [
            { sql: "UPDATE provider_wallets SET balance=balance+?, updated_at=datetime('now') WHERE provider_type='relay' AND provider_id=? AND environment=?", args: [amount, providerId, environment] },
            requireChangedRow,
            {
              sql: `INSERT INTO provider_wallet_ledger
                    (id, provider_type, provider_id, environment, kind, amount, balance_after, reference_type, reference_id, idempotency_key, actor_id, note)
                    SELECT ?, 'relay', ?, ?, 'earning', ?, balance, 'relay_leg', ?, ?, ?, 'Relay parcel carried by matatu'
                    FROM provider_wallets WHERE provider_type='relay' AND provider_id=? AND environment=?`,
              args: [newId("pwl"), providerId, environment, amount, String(leg.id), `relay-leg:${String(leg.id)}`, userActor(actorId), providerId, environment],
            },
          ]
        : [
            { sql: `UPDATE users SET ${environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance"} = ${environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance"} + ?, updated_at = datetime('now') WHERE id = ?`, args: [amount, providerId] },
            requireChangedRow,
            { sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, note, actor_id, environment) SELECT ?, id, 'adjustment', ?, ${environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance"}, ?, 'Relay parcel carried by matatu', ?, ? FROM users WHERE id = ?`, args: [newId("wl"), amount, String(order.id), userActor(actorId), environment, providerId] },
          ];
    await postLedgerTransaction({
      kind: "relay_leg_paid",
      idempotencyKey: `relay-leg:${String(leg.id)}`,
      environment,
      referenceType: "order",
      referenceId: String(order.id),
      actorId: userActor(actorId),
      postings: [
        { ownerType: "order", ownerId: String(order.id), purpose: "settlement_escrow", environment, amount: -amount },
        isBoda
          ? { ownerType: "rider", ownerId: providerId, purpose: "earnings_available", environment, amount }
          : relayWalletReady
            ? { ownerType: "provider", ownerId: providerId, purpose: "relay_work_wallet", environment, amount }
            : { ownerType: "customer", ownerId: providerId, purpose: "wallet_payable", environment, amount },
      ],
      additionalStatements: relayWalletStatements,
    });
    return amount;
  }
  if (leg.kind === "boda") {
    const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    await db.execute({
      sql: `UPDATE riders SET ${column} = ${column} + ?, updated_at = datetime('now') WHERE user_id = ?`,
      args: [amount, providerId],
    });
  } else {
    await creditProviderWorkWallet({
      providerType: "relay",
      providerId,
      amount,
      environment,
      kind: "earning",
      referenceType: "relay_leg",
      referenceId: String(leg.id),
      idempotencyKey: `relay-leg:${String(leg.id)}`,
      actorId: userActor(actorId),
      note: "Relay parcel carried by matatu",
      legacyUserId: providerId,
    });
  }
  return amount;
}

async function payLegAtHandoff(orderId: string, legNumber: number, actorId: string): Promise<void> {
  const order = (await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] })).rows[0] as Row | undefined;
  if (!order || order.payment_rail !== "escrow" || !(await getRelaySettings()).releasePerLeg) return;
  const legs = boughtLegs(await relayLegs(String(order.id)), await relayRow(String(order.id)));
  const leg = legs.find((row) => Number(row.leg) === legNumber);
  if (!leg) return;
  await payLeg(order, leg, shareOf(await relayPayoutPool(order), legs, legNumber), actorId);
}

/** At settle: pays any leg not paid at its handoff, then the last rider (if
 * the customer bought the last leg) the rest of the pool. A merchant-funded
 * order's leftover escrow goes to the platform, as a normal settle does. */
export async function settleRelayPayouts(order: Row, pool: number, actorId: string): Promise<boolean> {
  const all = await relayLegs(String(order.id));
  if (!all.length) return false;
  const relay = await relayRow(String(order.id));
  const legs = boughtLegs(all, relay);
  const last = legs.find((row) => Number(row.leg) === 3);
  let paid = 0;
  for (const leg of legs.filter((row) => Number(row.leg) < 3)) {
    // Without a last leg, the matatu leg takes what's left so the pool is paid out exactly.
    const share = !last && Number(leg.leg) === 2 ? Math.max(0, pool - paid) : shareOf(pool, legs, Number(leg.leg));
    paid += leg.paid_at ? Number(leg.paid_amount ?? 0) : await payLeg(order, leg, share, actorId);
  }
  if (last) {
    await payLeg(order, { ...last, provider_id: last.provider_id ?? order.rider_id }, Math.max(0, pool - paid), actorId);
    await db.execute({ sql: "UPDATE order_relay_legs SET status = 'done', handed_over_at = datetime('now') WHERE id = ?", args: [String(last.id)] });
  }
  if (order.funds_model === MERCHANT_MODEL) await closeMerchantEscrow(order, actorId);
  return true;
}

async function closeMerchantEscrow(order: Row, actorId: string): Promise<void> {
  const environment = order.environment === "sandbox" ? "sandbox" : "live";
  const orderId = String(order.id);
  const escrow = await ledgerBalance({ ownerType: "order", ownerId: orderId, purpose: "settlement_escrow", environment });
  const statements = [
    { sql: "UPDATE order_budgets SET status = 'closed', updated_at = datetime('now') WHERE order_id = ?", args: [orderId] },
    { sql: "DELETE FROM rider_order_locks WHERE order_id = ?", args: [orderId] },
  ];
  if (escrow > 0) {
    await postLedgerTransaction({
      kind: "merchant_order_settled",
      idempotencyKey: `merchant-order:${orderId}:settle`,
      environment,
      referenceType: "order",
      referenceId: orderId,
      actorId: userActor(actorId),
      postings: [
        { ownerType: "order", ownerId: orderId, purpose: "settlement_escrow", environment, amount: -escrow },
        { ownerType: "platform", ownerId: "peebee", purpose: "order_revenue", environment, amount: escrow },
      ],
      additionalStatements: statements,
    });
  } else {
    for (const statement of statements) await db.execute(statement);
  }
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export class RelayError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, public code: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// A multi-store bag on a relay: every store's order has its own legs, but they
// travel together. A handoff made with any one of their codes moves all of them,
// and the people involved hear about it once.
// ---------------------------------------------------------------------------

const alongForTheRide = new AsyncLocalStorage<true>();

/** A notification, sent once per bag: orders that move along with another stay quiet. */
function tell(userId: string, payload: Parameters<typeof notifyUser>[1]): Promise<void> {
  return alongForTheRide.getStore() ? Promise.resolve() : notifyUser(userId, payload);
}

/** The other orders of the same bag riding this relay. */
export async function relayMates(orderId: string): Promise<string[]> {
  if (!(await hasColumn("orders", "delivery_bundle_id"))) return [];
  const rows = (await db.execute({
    sql: `SELECT o.id FROM orders o JOIN orders me ON me.id = ?
          WHERE me.delivery_bundle_id IS NOT NULL AND o.delivery_bundle_id = me.delivery_bundle_id AND o.id != me.id
            AND o.stage != 'Cancelled' AND EXISTS (SELECT 1 FROM order_relay_legs l WHERE l.order_id = o.id)
          ORDER BY o.created_at, o.id`,
    args: [orderId],
  })).rows as Row[];
  return rows.map((row) => String(row.id));
}

/** Repeats a handoff for the bag's other orders (only from the first call, never from theirs). */
async function alongWithMates(orderId: string, step: (mateId: string) => Promise<unknown>): Promise<void> {
  if (alongForTheRide.getStore()) return;
  for (const mateId of await relayMates(orderId)) {
    await alongForTheRide.run(true, () => step(mateId)).catch((err) => {
      console.warn(`Relay bag order ${mateId} didn't follow ${orderId}:`, err instanceof Error ? err.message : err);
    });
  }
}

const legOf = async (orderId: string, leg: number) =>
  (await db.execute({ sql: "SELECT * FROM order_relay_legs WHERE order_id = ? AND leg = ?", args: [orderId, leg] })).rows[0] as Row | undefined;

async function logOrderEvent(orderId: string, note: string, actorId: string) {
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Deliver', ?, ?)",
    args: [newId("evt"), orderId, note, actorId],
  });
}

export async function approvedOperator(userId: string): Promise<Row | null> {
  if (!(await relayReady())) return null;
  const row = (await db.execute({ sql: "SELECT * FROM relay_operators WHERE user_id = ? AND status = 'approved'", args: [userId] })).rows[0] as Row | undefined;
  return row ?? null;
}

/** Handoff 1: the matatu operator enters the first rider's code and takes the parcel. */
export async function receiveAtMatatu(operatorId: string, code: string): Promise<{ orderId: string }> {
  const operator = await approvedOperator(operatorId);
  if (!operator) throw new RelayError(403, "not_operator", "Only an approved matatu operator can receive relay parcels.");
  const leg1 = (await db.execute({
    sql: `SELECT l.*, o.rider_id, o.stage, o.customer_id, o.environment, o.payment_rail
          FROM order_relay_legs l JOIN orders o ON o.id = l.order_id
          WHERE l.leg = 1 AND l.status != 'done' AND l.handoff_code = ? AND l.route_id = ?`,
    args: [code.trim(), String(operator.route_id)],
  })).rows[0] as Row | undefined;
  if (!leg1) throw new RelayError(404, "code_not_found", "That code doesn't match a parcel for your route.");
  if (leg1.stage !== "Deliver" || !leg1.rider_id) {
    throw new RelayError(409, "not_on_the_way", "The rider hasn't set off with this parcel yet.");
  }
  const orderId = String(leg1.order_id);
  const firstRider = String(leg1.rider_id);
  // A bag from several stores goes on the matatu whole: the rider has collected from every store.
  if (!alongForTheRide.getStore()) {
    for (const mateId of await relayMates(orderId)) {
      const mate = (await db.execute({ sql: "SELECT stage, rider_id FROM orders WHERE id = ?", args: [mateId] })).rows[0] as Row | undefined;
      if (mate && (mate.stage !== "Deliver" || mate.rider_id !== leg1.rider_id)) {
        throw new RelayError(409, "bag_not_complete", "The rider hasn't collected from every store in this bag yet.");
      }
    }
  }
  const relay = await relayRow(orderId);
  const toStation = relay?.drop_mode === "station";
  const clearLocation = (await hasColumn("orders", "rider_location_updated_at"))
    ? ", rider_lat = NULL, rider_lng = NULL, rider_location_updated_at = NULL" : "";
  const changes = await executeBatch([
    {
      sql: `UPDATE order_relay_legs SET status = 'done', provider_id = ?, handed_over_at = datetime('now'), handed_over_to = ?
            WHERE id = ? AND status != 'done'`,
      args: [firstRider, operatorId, String(leg1.id)],
    },
    {
      sql: `UPDATE order_relay_legs SET status = 'in_transit', provider_id = ?, started_at = datetime('now')
            WHERE order_id = ? AND leg = 2 AND EXISTS (SELECT 1 FROM order_relay_legs WHERE id = ? AND handed_over_to = ?)`,
      args: [operatorId, orderId, String(leg1.id), operatorId],
    },
    // A stage drop opens the last leg now; a station drop opens it once the parcel is at the station.
    {
      sql: `UPDATE order_relay_legs SET status = 'open' WHERE order_id = ? AND leg = 3 AND status = 'waiting' AND ${toStation ? "0" : "1"}`,
      args: [orderId],
    },
    {
      sql: `UPDATE orders SET rider_id = NULL${clearLocation}, updated_at = datetime('now') WHERE id = ? AND rider_id = ?`,
      args: [orderId, firstRider],
    },
    // A store order's first rider is free for their next shop.
    { sql: "DELETE FROM rider_order_locks WHERE rider_id = ? AND order_id = ?", args: [firstRider, orderId] },
  ]);
  if (!changes[0]) throw new RelayError(409, "already_received", "This parcel has already been handed over.");
  await logOrderEvent(orderId, `Parcel handed to matatu ${operator.vehicle_plate} at ${leg1.to_name}`, operatorId);
  await payLegAtHandoff(orderId, 1, operatorId);

  const notes: Promise<unknown>[] = [
    tell(firstRider, { title: "Handoff confirmed", body: `The matatu took the parcel at ${leg1.to_name}. You're free for your next job.`, url: "/", tag: `relay-${orderId}` }),
  ];
  if (leg1.customer_id) {
    notes.push(tell(String(leg1.customer_id), {
      title: "Your parcel is on the matatu",
      body: toStation
        ? `It left ${leg1.to_name} for the petrol station near you.`
        : `It left ${leg1.to_name}. A rider will bring it to your door.`,
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    }));
  }
  await Promise.allSettled([...notes, ...(toStation ? [] : [notifyRidersOfLastMile(orderId)])]);
  await alongWithMates(orderId, async (mateId) => {
    const mateLeg = await legOf(mateId, 1);
    if (mateLeg?.handoff_code) await receiveAtMatatu(operatorId, String(mateLeg.handoff_code));
  });
  return { orderId };
}

/** Riders near the drop stage hear about the last-mile leg as soon as the parcel is on the matatu. */
async function notifyRidersOfLastMile(orderId: string): Promise<void> {
  const leg3 = (await db.execute({
    sql: "SELECT l.*, o.environment FROM order_relay_legs l JOIN orders o ON o.id = l.order_id WHERE l.order_id = ? AND l.leg = 3",
    args: [orderId],
  })).rows[0] as Row | undefined;
  if (!leg3) return;
  const { lastMileRadiusKm } = await getRelaySettings();
  const atStation = (await relayRow(orderId))?.drop_mode === "station";
  await primeDemoAccounts();
  const riders = (await db.execute(`SELECT user_id, stage_lat, stage_lng FROM riders WHERE verified = 1 AND is_online = 1 AND stage_lat IS NOT NULL AND stage_lng IS NOT NULL AND ${ridersForThisWorld("user_id")}`)).rows as Row[];
  const near = riders
    .filter((r) => haversineKm(Number(r.stage_lat), Number(r.stage_lng), Number(leg3.from_lat), Number(leg3.from_lng)) <= lastMileRadiusKm)
    .slice(0, 25);
  await Promise.allSettled(near.map((r) => tell(String(r.user_id), {
    title: "Relay pickup near you",
    body: atStation
      ? `Collect a parcel at ${leg3.from_name} and deliver ${leg3.distance_km} km.`
      : `Meet a matatu at ${leg3.from_name} and deliver ${leg3.distance_km} km.`,
    url: "/",
    tag: `relay-open-${orderId}`,
  })));
}

/** A rider takes the last-mile leg. They become the order's rider straight away
 * but can't arrive or take the PIN until they've collected the parcel. */
async function claimLastMileOne(riderId: string, legId: string, opts: { demo?: boolean } = {}): Promise<{ orderId: string }> {
  const leg = (await db.execute({
    sql: "SELECT l.*, o.environment FROM order_relay_legs l JOIN orders o ON o.id = l.order_id WHERE l.id = ? AND l.leg = 3",
    args: [legId],
  })).rows[0] as Row | undefined;
  if (!leg) throw new RelayError(404, "not_found", "This relay pickup no longer exists.");
  if (leg.status !== "open") throw new RelayError(409, "already_claimed", "Another rider already took this pickup.");
  const rider = (await db.execute({ sql: "SELECT verified, is_online, stage_lat, stage_lng FROM riders WHERE user_id = ?", args: [riderId] })).rows[0] as Row | undefined;
  if (!rider?.verified) throw new RelayError(403, "not_verified", "Only verified riders can take relay pickups.");
  // A sandbox demo rider stays offline (so live matching never sees it) and has no range.
  // The bag's other orders follow the rider who took the first (who is now, of course, busy).
  const following = !!alongForTheRide.getStore();
  if (!opts.demo && !following && !rider.is_online) throw new RelayError(409, "not_online", "Go online to take jobs.");
  if (!opts.demo && !following && rider.stage_lat != null && rider.stage_lng != null) {
    const distanceKm = haversineKm(Number(rider.stage_lat), Number(rider.stage_lng), Number(leg.from_lat), Number(leg.from_lng));
    if (beyondRiderRange(distanceKm, await riderRangeKm(riderId))) throw new RelayError(403, "out_of_range", "This pickup is outside your range.");
  }
  const orderId = String(leg.order_id);
  const environment = String(leg.environment);
  const changes = await executeBatch([
    {
      sql: `UPDATE orders SET rider_id = ?, updated_at = datetime('now')
            WHERE id = ? AND rider_id IS NULL AND stage = 'Deliver'
            AND (? OR NOT EXISTS (SELECT 1 FROM orders busy WHERE busy.rider_id = ? AND busy.environment = ? AND busy.stage NOT IN ('Settle', 'Cancelled')))`,
      args: [riderId, orderId, following ? 1 : 0, riderId, environment],
    },
    {
      sql: `UPDATE order_relay_legs SET status = 'assigned', provider_id = ?
            WHERE id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND rider_id = ?)`,
      args: [riderId, legId, orderId, riderId],
    },
  ]);
  if (!changes[0] || !changes[1]) {
    throw new RelayError(409, "rider_unavailable", "This pickup is gone, or you already have an active job.");
  }
  await logOrderEvent(orderId, `Last-mile rider assigned to meet the matatu at ${leg.from_name}`, riderId);
  const operatorLeg = (await db.execute({ sql: "SELECT provider_id FROM order_relay_legs WHERE order_id = ? AND leg = 2", args: [orderId] })).rows[0] as Row | undefined;
  if (operatorLeg?.provider_id) {
    await tell(String(operatorLeg.provider_id), {
      title: "Rider coming for a parcel",
      body: `A rider will meet you at ${leg.from_name} to collect it.`,
      url: "/relay",
      tag: `relay-${orderId}`,
    }).catch(() => {});
  }
  return { orderId };
}

/** Handoff 2: the last rider enters the operator's code and takes the parcel. */
async function collectFromMatatuOne(riderId: string, legId: string, code: string): Promise<{ orderId: string }> {
  const leg3 = (await db.execute({ sql: "SELECT * FROM order_relay_legs WHERE id = ? AND leg = 3", args: [legId] })).rows[0] as Row | undefined;
  if (!leg3) throw new RelayError(404, "not_found", "This relay pickup no longer exists.");
  if (leg3.provider_id !== riderId || leg3.status !== "assigned") {
    throw new RelayError(403, "not_your_pickup", "This pickup isn't assigned to you.");
  }
  const orderId = String(leg3.order_id);
  const relay = await relayRow(orderId);
  if (relay?.drop_mode === "station") return collectFromStation(riderId, leg3, relay, code);
  const leg2 = (await db.execute({ sql: "SELECT * FROM order_relay_legs WHERE order_id = ? AND leg = 2", args: [orderId] })).rows[0] as Row | undefined;
  if (!leg2 || !["in_transit", "arrived"].includes(String(leg2.status))) {
    throw new RelayError(409, "not_on_matatu", "The parcel isn't on the matatu yet.");
  }
  if (String(leg2.handoff_code) !== code.trim()) throw new RelayError(400, "code_mismatch", "That code doesn't match. Ask the matatu operator for theirs.");
  const changes = await executeBatch([
    {
      sql: `UPDATE order_relay_legs SET status = 'done', handed_over_at = datetime('now'), handed_over_to = ?
            WHERE id = ? AND status IN ('in_transit', 'arrived')`,
      args: [riderId, String(leg2.id)],
    },
    {
      sql: "UPDATE order_relay_legs SET status = 'in_transit', started_at = datetime('now') WHERE id = ? AND status = 'assigned' AND provider_id = ?",
      args: [legId, riderId],
    },
  ]);
  if (!changes[0]) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  await logOrderEvent(orderId, `Last-mile rider collected the parcel from the matatu at ${leg3.from_name}`, riderId);
  const order = (await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] })).rows[0] as Row;
  await payLegAtHandoff(orderId, 2, riderId);
  if (order.customer_id) {
    await tell(String(order.customer_id), {
      title: "Your parcel is on the last stretch",
      body: "A rider collected it from the matatu and is bringing it to you.",
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    }).catch(() => {});
  }
  return { orderId };
}

// ---------------------------------------------------------------------------
// Petrol-station drop
// ---------------------------------------------------------------------------

export type StationStaff = { kind: "attendant" | "manager"; id: string; outletId: string; name: string };

async function orderRow(orderId: string): Promise<Row> {
  return (await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] })).rows[0] as Row;
}

/** The matatu drops the parcel: the attendant enters the operator's code and keeps it in the shop. */
async function receiveAtStationOne(staff: StationStaff, code: string): Promise<{ orderId: string }> {
  const leg2 = (await db.execute({
    sql: `SELECT l.*, r.last_mile, r.outlet_id FROM order_relay_legs l JOIN order_relay r ON r.order_id = l.order_id
          WHERE l.leg = 2 AND l.status IN ('in_transit', 'arrived') AND l.handoff_code = ? AND r.drop_mode = 'station' AND r.outlet_id = ?`,
    args: [code.trim(), staff.outletId],
  })).rows[0] as Row | undefined;
  if (!leg2) throw new RelayError(404, "code_not_found", "That code doesn't match a parcel coming to this station.");
  const orderId = String(leg2.order_id);
  const meeting = await relayRow(orderId);
  if (meeting?.meet_stage_id && !meeting.missed_at) {
    throw new RelayError(409, "meeting_customer", `This parcel is for the customer to collect from the matatu at ${meeting.meet_stage_name}.`);
  }
  const holder = `${staff.kind}:${staff.id}`;
  const changes = await executeBatch([
    {
      sql: "UPDATE order_relay_legs SET status = 'done', handed_over_at = datetime('now'), handed_over_to = ? WHERE id = ? AND status IN ('in_transit', 'arrived')",
      args: [holder, String(leg2.id)],
    },
    { sql: "UPDATE order_relay SET held_at = datetime('now'), held_by = ? WHERE order_id = ? AND held_at IS NULL", args: [holder, orderId] },
    // Door delivery is already paid for: the rider is called straight away.
    { sql: "UPDATE order_relay_legs SET status = 'open' WHERE order_id = ? AND leg = 3 AND status = 'waiting' AND ? = 'door'", args: [orderId, String(leg2.last_mile)] },
  ]);
  if (!changes[0]) throw new RelayError(409, "already_received", "This parcel is already at the station.");
  await logOrderEvent(orderId, `Parcel dropped at ${leg2.to_name} and kept by ${staff.name}`, holder);
  await payLegAtHandoff(orderId, 2, holder);

  const order = await orderRow(orderId);
  const relay = await relayRow(orderId);
  const notes: Promise<unknown>[] = [];
  if (order.customer_id) {
    notes.push(tell(String(order.customer_id), relay?.last_mile === "door"
      ? { title: "Your parcel is at the petrol station", body: `It's at ${leg2.to_name}. A rider is being called to bring it to you.`, url: `/orders/${orderId}`, tag: `order-${orderId}` }
      : relay?.last_mile === "collect"
        ? { title: "Ready to collect", body: `Collect it at ${leg2.to_name}. Show your code at the shop.`, url: `/orders/${orderId}`, tag: `order-${orderId}` }
        : { title: "Your parcel is at the petrol station", body: `It's at ${leg2.to_name}. Collect it, or send a rider to bring it to you.`, url: `/orders/${orderId}`, tag: `order-${orderId}` }));
  }
  if (leg2.provider_id) {
    notes.push(tell(String(leg2.provider_id), { title: "Drop confirmed", body: `The station took the parcel at ${leg2.to_name}.`, url: "/relay", tag: `relay-${orderId}` }));
  }
  if (relay?.last_mile === "door") notes.push(notifyRidersOfLastMile(orderId));
  await Promise.allSettled(notes);
  return { orderId };
}

/** A rider collects at the station: they enter the code the attendant shows them. */
async function collectFromStation(riderId: string, leg3: Row, relay: Row, code: string): Promise<{ orderId: string }> {
  const orderId = String(leg3.order_id);
  if (!relay.held_at) throw new RelayError(409, "not_at_station", "The parcel hasn't reached the station yet.");
  if (relay.released_at) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  if (String(relay.release_code) !== code.trim()) throw new RelayError(400, "code_mismatch", "That code doesn't match. Ask the pump attendant for the parcel's code.");
  const changes = await executeBatch([
    {
      sql: "UPDATE order_relay SET released_at = datetime('now'), released_to = 'rider', released_by = ? WHERE order_id = ? AND released_at IS NULL",
      args: [riderId, orderId],
    },
    {
      sql: "UPDATE order_relay_legs SET status = 'in_transit', started_at = datetime('now') WHERE id = ? AND status = 'assigned' AND provider_id = ?",
      args: [String(leg3.id), riderId],
    },
  ]);
  if (!changes[0]) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  await logOrderEvent(orderId, `Rider collected the parcel at ${leg3.from_name}`, riderId);
  const order = await orderRow(orderId);
  if (order.customer_id) {
    await tell(String(order.customer_id), {
      title: "Your parcel is on the last stretch",
      body: `A rider collected it at ${leg3.from_name} and is bringing it to you.`,
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    }).catch(() => {});
  }
  return { orderId };
}

/** The customer collects in person: the attendant enters the customer's code. The order is done. */
async function releaseToCustomerOne(staff: StationStaff, code: string): Promise<{ orderId: string }> {
  const relay = (await db.execute({
    sql: `SELECT * FROM order_relay WHERE collect_code = ? AND outlet_id = ? AND drop_mode = 'station'
          AND held_at IS NOT NULL AND released_at IS NULL AND last_mile != 'door'`,
    args: [code.trim(), staff.outletId],
  })).rows[0] as Row | undefined;
  if (!relay) throw new RelayError(404, "code_not_found", "That code doesn't match a parcel waiting here for collection.");
  const orderId = String(relay.order_id);
  const holder = `${staff.kind}:${staff.id}`;
  const released = await db.execute({
    sql: "UPDATE order_relay SET released_at = datetime('now'), released_to = 'customer', released_by = ? WHERE order_id = ? AND released_at IS NULL",
    args: [holder, orderId],
  });
  if (!released.rowsAffected) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  await logOrderEvent(orderId, `Customer collected the parcel at the station (${staff.name})`, holder);
  await finishCollectedOrder(orderId, holder);
  const order = await orderRow(orderId);
  if (order.customer_id) {
    await tell(String(order.customer_id), { title: "Collected — thank you!", body: "Your parcel was handed to you at the petrol station.", url: `/orders/${orderId}`, tag: `order-${orderId}` }).catch(() => {});
  }
  return { orderId };
}

/** Settles an order the customer collected at the station: pays the legs they bought and closes it. */
async function finishCollectedOrder(orderId: string, actorId: string): Promise<void> {
  const order = await orderRow(orderId);
  if (order.payment_rail === "escrow") {
    if (order.funds_model === MERCHANT_MODEL) {
      const { refundUnusedOrderPrincipal } = await import("../merchants/service.js");
      await refundUnusedOrderPrincipal(orderId, userActor(actorId) ?? String(order.customer_id));
    }
    await settleRelayPayouts(order, await relayPayoutPool(order), actorId);
  }
  const total = Number(order.final_total ?? order.estimated_total ?? 0);
  await db.execute({ sql: "UPDATE orders SET stage = 'Settle', final_total = ?, updated_at = datetime('now') WHERE id = ?", args: [total, orderId] });
  await db.execute({ sql: "UPDATE lists SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", args: [String(order.list_id)] });
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Settle', ?, ?)",
    args: [newId("evt"), orderId, "Order complete — collected at the petrol station", actorId],
  });
}

/** The customer chose to collect (or hasn't chosen) and now wants a rider to bring it. They pay the last leg from their wallet. */
async function sendRiderFromStationOne(customerId: string, orderId: string): Promise<{ orderId: string; charged: number }> {
  const order = await orderRow(orderId);
  if (!order || order.customer_id !== customerId) throw new RelayError(404, "not_found", "Order not found.");
  const relay = await relayRow(orderId);
  if (relay?.drop_mode !== "station" || relay.last_mile === "door") throw new RelayError(409, "not_available", "A rider is already arranged for this parcel.");
  if (relay.released_at) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  const leg3 = (await relayLegs(orderId)).find((leg) => Number(leg.leg) === 3);
  if (!leg3) throw new RelayError(409, "not_available", "This parcel can't be sent with a rider.");
  const fee = Number(leg3.fee);
  const environment = order.environment === "sandbox" ? "sandbox" : "live";
  const switched = await db.execute({
    sql: "UPDATE order_relay SET last_mile = 'door' WHERE order_id = ? AND last_mile != 'door' AND released_at IS NULL",
    args: [orderId],
  });
  if (!switched.rowsAffected) throw new RelayError(409, "not_available", "A rider is already arranged for this parcel.");
  const { payFromWallet } = await import("../wallet/service.js");
  const paymentId = fee > 0 ? await payFromWallet({ userId: customerId, amount: fee, orderId, environment, note: `Rider from the petrol station, order ${orderId}` }) : "free";
  if (!paymentId) {
    await db.execute({ sql: "UPDATE order_relay SET last_mile = ? WHERE order_id = ?", args: [String(relay.last_mile), orderId] });
    throw new RelayError(409, "insufficient_wallet_balance", `Top up your wallet with at least UGX ${fee.toLocaleString("en-UG")} to send a rider.`);
  }
  await db.execute({
    sql: "UPDATE orders SET estimated_total = COALESCE(estimated_total, 0) + ?, delivery_fee = COALESCE(delivery_fee, 0) + ?, updated_at = datetime('now') WHERE id = ?",
    args: [fee, fee, orderId],
  });
  if (fee > 0 && order.funds_model === MERCHANT_MODEL) {
    // The extra payment funds the order's delivery escrow, as the original collection did.
    await postLedgerTransaction({
      kind: "relay_last_leg_funded",
      idempotencyKey: `relay-last-leg:${orderId}`,
      environment,
      referenceType: "order",
      referenceId: orderId,
      actorId: customerId,
      postings: [
        { ownerType: "provider", ownerId: "collections", purpose: "clearing", environment, amount: -fee },
        { ownerType: "order", ownerId: orderId, purpose: "settlement_escrow", environment, amount: fee },
      ],
    });
  }
  await logOrderEvent(orderId, `Customer sent for a rider from the station (UGX ${fee.toLocaleString("en-UG")})`, customerId);
  if (relay.held_at) {
    await db.execute({ sql: "UPDATE order_relay_legs SET status = 'open' WHERE id = ? AND status = 'waiting'", args: [String(leg3.id)] });
    await notifyRidersOfLastMile(orderId);
  }
  return { orderId, charged: fee };
}

/** Who may watch a relayed order: the customer, everyone who carries or holds it, the seller, and staff. */
export async function canWatchRelay(order: Row, userId: string, role: string): Promise<boolean> {
  if (role === "admin" || order.customer_id === userId || order.rider_id === userId) return true;
  const legs = await relayLegs(String(order.id));
  if (legs.some((leg) => leg.provider_id === userId)) return true;
  if (order.restaurant_id) {
    const owner = await db.execute({ sql: "SELECT 1 FROM restaurants WHERE id = ? AND owner_id = ?", args: [String(order.restaurant_id), userId] });
    if (owner.rows.length) return true;
  }
  if (order.store_id && (await hasTable("stores"))) {
    const member = await db.execute({
      sql: `SELECT 1 FROM stores s JOIN merchant_members mm ON mm.merchant_id = s.merchant_id
            WHERE s.id = ? AND mm.user_id = ? AND mm.status = 'active'`,
      args: [String(order.store_id), userId],
    });
    if (member.rows.length) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Meeting the matatu, the station fallback, and arrival alerts
// ---------------------------------------------------------------------------

/** Where the matatu is heading with this parcel: the customer's stage, or the station/stage at the end of its leg. */
async function matatuTarget(orderId: string): Promise<{ name: string; lat: number; lng: number; meeting: boolean } | null> {
  const relay = await relayRow(orderId);
  if (relay?.meet_stage_id && !relay.missed_at && relay.meet_lat != null && relay.meet_lng != null) {
    return { name: String(relay.meet_stage_name), lat: Number(relay.meet_lat), lng: Number(relay.meet_lng), meeting: true };
  }
  const leg2 = (await relayLegs(orderId)).find((leg) => Number(leg.leg) === 2);
  if (!leg2 || leg2.to_lat == null || leg2.to_lng == null) return null;
  return { name: String(leg2.to_name), lat: Number(leg2.to_lat), lng: Number(leg2.to_lng), meeting: false };
}

/** Minutes until the matatu reaches the customer's stage or the station, from its last shared position. */
export async function relayEtaMinutes(order: Row): Promise<number | null> {
  if (order.rider_id || order.rider_lat == null || order.rider_lng == null) return null;
  const leg2 = (await relayLegs(String(order.id))).find((leg) => Number(leg.leg) === 2);
  if (!leg2 || leg2.status !== "in_transit") return null;
  const target = await matatuTarget(String(order.id));
  if (!target) return null;
  const { matatuSpeedKmh } = await getRelaySettings();
  const km = haversineKm(Number(order.rider_lat), Number(order.rider_lng), target.lat, target.lng);
  return Math.max(1, Math.round((km / matatuSpeedKmh) * 60));
}

/** After each matatu position: tell the customer once when it's a few minutes away. */
export async function noticeMatatuApproach(orderId: string): Promise<void> {
  if (!(await relayMeetReady())) return;
  const order = await orderRow(orderId);
  const eta = await relayEtaMinutes(order);
  const { arrivalNoticeMinutes } = await getRelaySettings();
  if (eta == null || eta > arrivalNoticeMinutes || !order.customer_id) return;
  const marked = await db.execute({ sql: "UPDATE order_relay SET soon_notified_at = datetime('now') WHERE order_id = ? AND soon_notified_at IS NULL", args: [orderId] });
  if (!marked.rowsAffected) return;
  const target = await matatuTarget(orderId);
  const relay = await relayRow(orderId);
  await tell(String(order.customer_id), {
    title: `Your parcel arrives in about ${eta} minutes`,
    body: target?.meeting
      ? `Head to ${target.name} now and have your code ready. The matatu can't wait long.`
      : relay?.last_mile === "door"
        ? `It's nearly at ${target?.name ?? "the station"}. A rider will bring it to you.`
        : `It's nearly at ${target?.name ?? "the station"}.`,
    url: `/orders/${orderId}`,
    tag: `order-${orderId}-soon`,
  }).catch(() => {});
}

/** Tell the customer the matatu has reached their stage or the station. */
export async function noticeMatatuArrived(orderId: string): Promise<void> {
  const order = await orderRow(orderId);
  if (!order?.customer_id) return;
  const target = await matatuTarget(orderId);
  if (!target?.meeting) return;
  await tell(String(order.customer_id), {
    title: "The matatu is at your stage",
    body: `It's at ${target.name} now. Show your code to the conductor to collect your parcel.`,
    url: `/orders/${orderId}`,
    tag: `order-${orderId}`,
  }).catch(() => {});
}

/** Handoff at the stage: the operator enters the customer's code and gives them the parcel. The order is done. */
async function handToCustomerAtStageOne(operatorId: string, code: string): Promise<{ orderId: string }> {
  const relay = (await db.execute({
    sql: `SELECT r.*, l.id AS leg2_id FROM order_relay r JOIN order_relay_legs l ON l.order_id = r.order_id AND l.leg = 2
          WHERE r.collect_code = ? AND r.meet_stage_id IS NOT NULL AND r.missed_at IS NULL AND r.released_at IS NULL
            AND l.provider_id = ? AND l.status IN ('in_transit', 'arrived')`,
    args: [code.trim(), operatorId],
  })).rows[0] as Row | undefined;
  if (!relay) throw new RelayError(404, "code_not_found", "That code doesn't match a customer meeting your matatu.");
  const orderId = String(relay.order_id);
  const changes = await executeBatch([
    { sql: "UPDATE order_relay SET released_at = datetime('now'), released_to = 'customer', released_by = ? WHERE order_id = ? AND released_at IS NULL", args: [operatorId, orderId] },
    { sql: "UPDATE order_relay_legs SET status = 'done', handed_over_at = datetime('now'), handed_over_to = ? WHERE id = ?", args: [`customer:${orderId}`, String(relay.leg2_id)] },
  ]);
  if (!changes[0]) throw new RelayError(409, "already_collected", "This parcel was already collected.");
  await logOrderEvent(orderId, `Customer collected the parcel from the matatu at ${relay.meet_stage_name}`, operatorId);
  await finishCollectedOrder(orderId, operatorId);
  const order = await orderRow(orderId);
  if (order.customer_id) {
    await tell(String(order.customer_id), { title: "Collected — thank you!", body: `You collected your parcel at ${relay.meet_stage_name}.`, url: `/orders/${orderId}`, tag: `order-${orderId}` }).catch(() => {});
  }
  return { orderId };
}

/** The customer wasn't at the stage. If admin allows it, the parcel goes on to the petrol station near them. */
async function customerMissedMatatuOne(operatorId: string, legId: string): Promise<{ orderId: string; station: string }> {
  const leg2 = (await db.execute({
    sql: "SELECT * FROM order_relay_legs WHERE id = ? AND leg = 2 AND provider_id = ? AND status IN ('in_transit', 'arrived')",
    args: [legId, operatorId],
  })).rows[0] as Row | undefined;
  if (!leg2) throw new RelayError(404, "not_found", "This parcel isn't on your matatu.");
  const orderId = String(leg2.order_id);
  const relay = await relayRow(orderId);
  if (!relay?.meet_stage_id || relay.missed_at || relay.released_at) throw new RelayError(409, "not_meeting", "This parcel isn't waiting for the customer at a stage.");
  if (!(await getRelaySettings()).stageFallback) {
    throw new RelayError(409, "fallback_off", "Call the customer. Leaving parcels at the petrol station is switched off.");
  }
  const station = relay.outlet_id
    ? (await db.execute({
        sql: "SELECT o.name, o.lat, o.lng, s.brand_name FROM fuel_station_outlets o JOIN fuel_stations s ON s.id = o.station_id WHERE o.id = ?",
        args: [String(relay.outlet_id)],
      })).rows[0] as Row | undefined
    : undefined;
  if (!station) throw new RelayError(409, "no_station", "There's no petrol station set for this parcel. Call the customer.");
  const stationName = stationDisplayName(station.brand_name, station.name);
  await executeBatch([
    { sql: "UPDATE order_relay SET missed_at = datetime('now'), soon_notified_at = NULL WHERE order_id = ? AND missed_at IS NULL", args: [orderId] },
    // The matatu leg now ends at the station, where the attendant receives it with the usual code.
    { sql: "UPDATE order_relay_legs SET status = 'in_transit', to_name = ?, to_lat = ?, to_lng = ? WHERE id = ?", args: [stationName, station.lat, station.lng, legId] },
  ]);
  await logOrderEvent(orderId, `Customer wasn't at ${relay.meet_stage_name}; parcel going on to ${stationName}`, operatorId);
  const order = await orderRow(orderId);
  if (order.customer_id) {
    await tell(String(order.customer_id), {
      title: "You missed the matatu",
      body: `No problem — your parcel will be at ${stationName}. Collect it there or send a rider.`,
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    }).catch(() => {});
  }
  return { orderId, station: stationName };
}

// The handoffs, each moving a whole multi-store bag when its orders share the relay.

export async function claimLastMile(riderId: string, legId: string, opts: { demo?: boolean } = {}): Promise<{ orderId: string }> {
  const result = await claimLastMileOne(riderId, legId, opts);
  await alongWithMates(result.orderId, async (mateId) => {
    const leg = await legOf(mateId, 3);
    if (leg?.status === "open") await claimLastMileOne(riderId, String(leg.id), opts);
  });
  return result;
}

export async function collectFromMatatu(riderId: string, legId: string, code: string): Promise<{ orderId: string }> {
  const result = await collectFromMatatuOne(riderId, legId, code);
  await alongWithMates(result.orderId, async (mateId) => {
    const leg = await legOf(mateId, 3);
    if (!leg || leg.status !== "assigned" || leg.provider_id !== riderId) return;
    const relay = await relayRow(mateId);
    const mateCode = relay?.drop_mode === "station" ? relay.release_code : (await legOf(mateId, 2))?.handoff_code;
    if (mateCode) await collectFromMatatuOne(riderId, String(leg.id), String(mateCode));
  });
  return result;
}

export async function receiveAtStation(staff: StationStaff, code: string): Promise<{ orderId: string }> {
  const result = await receiveAtStationOne(staff, code);
  await alongWithMates(result.orderId, async (mateId) => {
    const leg = await legOf(mateId, 2);
    if (leg?.handoff_code) await receiveAtStationOne(staff, String(leg.handoff_code));
  });
  return result;
}

export async function releaseToCustomer(staff: StationStaff, code: string): Promise<{ orderId: string }> {
  const result = await releaseToCustomerOne(staff, code);
  await alongWithMates(result.orderId, async (mateId) => {
    const relay = await relayRow(mateId);
    if (relay?.collect_code) await releaseToCustomerOne(staff, String(relay.collect_code));
  });
  return result;
}

export async function sendRiderFromStation(customerId: string, orderId: string): Promise<{ orderId: string; charged: number }> {
  const result = await sendRiderFromStationOne(customerId, orderId);
  await alongWithMates(orderId, (mateId) => sendRiderFromStationOne(customerId, mateId));
  return result;
}

export async function handToCustomerAtStage(operatorId: string, code: string): Promise<{ orderId: string }> {
  const result = await handToCustomerAtStageOne(operatorId, code);
  await alongWithMates(result.orderId, async (mateId) => {
    const relay = await relayRow(mateId);
    if (relay?.collect_code) await handToCustomerAtStageOne(operatorId, String(relay.collect_code));
  });
  return result;
}

export async function customerMissedMatatu(operatorId: string, legId: string): Promise<{ orderId: string; station: string }> {
  const result = await customerMissedMatatuOne(operatorId, legId);
  await alongWithMates(result.orderId, async (mateId) => {
    const leg = await legOf(mateId, 2);
    if (leg && leg.provider_id === operatorId && ["in_transit", "arrived"].includes(String(leg.status))) await customerMissedMatatuOne(operatorId, String(leg.id));
  });
  return result;
}

/** The matatu reached the drop: the bag's other orders arrive with it (the route handler tells people once). */
export async function markMatesArrived(orderId: string, operatorId: string): Promise<void> {
  for (const mateId of await relayMates(orderId)) {
    await db.execute({
      sql: "UPDATE order_relay_legs SET status = 'arrived' WHERE order_id = ? AND leg = 2 AND provider_id = ? AND status = 'in_transit'",
      args: [mateId, operatorId],
    });
  }
}

/** The matatu's live position, for every order of the bag it carries. */
export async function shareMatatuPosition(orderId: string, lat: number, lng: number): Promise<void> {
  if (!(await hasColumn("orders", "rider_location_updated_at"))) return;
  for (const mateId of await relayMates(orderId)) {
    await db.execute({
      sql: "UPDATE orders SET rider_lat = ?, rider_lng = ?, rider_location_updated_at = datetime('now') WHERE id = ? AND rider_id IS NULL",
      args: [lat, lng, mateId],
    });
  }
}
