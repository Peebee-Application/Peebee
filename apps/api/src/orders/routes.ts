import { Hono, type Context } from "hono";
import { z } from "zod";
import type { InArgs } from "@libsql/client";
import { db, executeBatch } from "../db/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { haversineKm } from "../lib/geo.js";
import { newId, newPin, newShareToken } from "../lib/ids.js";
import { passengerSchema, rideForOtherAvailable } from "../passengers/routes.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import {
  getDeliverySettings,
  getLugandaAudioSettings,
  getMatchingSettings,
  getMaxOrderValue,
  getMonetizationSettings,
  getPlatformEnvironment,
  getRiderReserveSettings,
  isServiceEnabled,
  type ServiceKey,
} from "../lib/settings.js";
import { servicePaused } from "../lib/service-gate.js";
import { computeCheckoutFees, isCashDepositOk, riderPayout } from "../lib/monetization.js";
import { notifyUser } from "../lib/webpush.js";
import { currentVisibilityRadiusKm, orderMatchPoint, parseDbTimestamp } from "./matching.js";
import { redactOrder } from "./visibility.js";
import { assignAvailableRider } from "./assignment.js";
import { computeBidding, loadBiddingContext, validateBid } from "./bidding.js";
import { hasColumn } from "../lib/schema.js";
import { findCarCandidate, isCarOrder, settleCarBooking, stampCarBooking } from "../car/service.js";
import { getApplicantProfile } from "./applicant-profile.js";
import { buildLugandaListNarration } from "./list-narration.js";
import { synthesizeLuganda } from "../speech/gemini.js";
import { isProSubscriptionCurrent } from "../riders/pro-subscription.js";
import type { MatchingMode, MobileMoneyNetwork } from "@peebee/shared";
import { roundFare } from "@peebee/shared";
import { snapshotTimeFees, getOrderTimeFees, cancelCustomerOrder, finishWaiting, closeWaiting } from "./time-fees.js";
import {
  initiateCollection,
  mobileMoneyNetworkLabel,
  paymentProviderErrorResponse,
  paymentProviderHttpStatus,
  UnsupportedNetworkError,
} from "../payments/service.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { appBaseUrl } from "../verify/service.js";
import { payFromWallet } from "../wallet/service.js";
import { isSubscriptionCurrent } from "../riders/subscription.js";
import {
  activateMerchantAllocationsForFundedOrder,
  refundUnusedOrderPrincipal,
  settleMerchantOrderFinancials,
} from "../merchants/service.js";

function paymentReturnUrl(orderId: string): string {
  return `${appBaseUrl("customer")}/orders/${orderId}/pay?payment_return=1`;
}

export const orderRoutes = new Hono();
orderRoutes.use("*", requireAuth);

type Row = Record<string, unknown>;

function formatAmount(n: number): string {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

/** SQLite's own `datetime('now')` format — computed here (instead of just
 * writing it in SQL) so the same value can be reused on the in-memory
 * message objects handed back in the same response, without a re-read. */
function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function logEvent(orderId: string, stage: string, note: string, actorId: string) {
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, ?, ?, ?)",
    args: [newId("evt"), orderId, stage, note, actorId],
  });
}

async function getOrder(orderId: string): Promise<Row | undefined> {
  const res = await db.execute({
    sql: `SELECT o.*, c.name as customer_name, r.name as rider_name FROM orders o
          LEFT JOIN users c ON c.id = o.customer_id
          LEFT JOIN users r ON r.id = o.rider_id
          WHERE o.id = ?`,
    args: [orderId],
  });
  return res.rows[0] as Row | undefined;
}

async function touchOrder(orderId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  await db.execute({
    sql: `UPDATE orders SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
    args: [...keys.map((k) => fields[k]), orderId] as unknown as InArgs,
  });
}

/** Throws a Response-shaped error the caller returns directly. */
class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

function assertCustomer(order: Row, userId: string) {
  if (order.customer_id !== userId) throw new HttpError(403, "Not your order");
}
function assertRider(order: Row, userId: string) {
  if (order.rider_id !== userId) throw new HttpError(403, "Not your assigned order");
}

/**
 * Strips the handover PIN out of every order this router returns, for
 * everyone except the order's own customer (and admins).
 *
 * Done here rather than at each `c.json({ order })` because there are a
 * dozen of those and the next route someone adds would quietly leak it
 * again. The PIN is the customer's proof that they physically received the
 * goods — a rider who can read it can claim a handover that never happened,
 * which is the single thing the PIN exists to prevent.
 */
orderRoutes.use("*", async (c, next) => {
  await next();
  const user = c.get("user");
  if (!user || user.role === "admin") return;
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;

  // Cheap check before the expensive one. This router also serves chat
  // history, which can be long and never contains a PIN — reading the text
  // and looking for the field beats parsing and re-serializing every
  // response just in case.
  const text = await c.res
    .clone()
    .text()
    .catch(() => "");
  if (!text.includes("pin_code") && !text.includes("share_token")) return;

  let body: { order?: Row; orders?: Row[] } | null;
  try {
    body = JSON.parse(text) as { order?: Row; orders?: Row[] };
  } catch {
    return;
  }
  if (!body || typeof body !== "object") return;

  const strip = (order: Row | undefined) => {
    if (!order || order.customer_id === user.sub || !("pin_code" in order || "share_token" in order)) return order;
    const { pin_code: _pin, share_token: _share, ...rest } = order;
    return rest;
  };

  const hadOrder = body.order !== undefined;
  const hadOrders = Array.isArray(body.orders);
  if (!hadOrder && !hadOrders) return;

  const next_ = {
    ...body,
    ...(hadOrder ? { order: strip(body.order) } : {}),
    ...(hadOrders ? { orders: (body.orders as Row[]).map((o) => strip(o) as Row) } : {}),
  };
  c.res = new Response(JSON.stringify(next_), c.res);
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const createListSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        quantity: z.number().int().positive().default(1),
        unitCost: z.number().int().nonnegative().optional(),
        note: z.string().max(240).optional(),
      }),
    )
    .default([]),
});

orderRoutes.post("/lists", async (c) => {
  const user = c.get("user");
  const parsed = createListSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const listId = newId("list");
  const title = parsed.data.title?.trim() || "New shopping list";
  await db.execute({
    sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'draft', ?)",
    args: [listId, user.sub, title, await getPlatformEnvironment()],
  });
  for (const item of parsed.data.items) {
    await db.execute({
      sql: "INSERT INTO list_items (id, list_id, name, quantity, unit_price, note) VALUES (?, ?, ?, ?, ?, ?)",
      args: [newId("item"), listId, item.name, item.quantity, item.unitCost ?? null, item.note ?? null],
    });
  }

  return c.json(
    {
      id: listId,
      listId,
      title,
      status: "draft",
      itemCount: parsed.data.items.length,
      createdAt: new Date().toISOString(),
      nextPath: `/orders/${listId}/create`,
    },
    201,
  );
});

orderRoutes.get("/lists/recent", async (c) => {
  const user = c.get("user");
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? "10") || 10, 50));
  const res = await db.execute({
    sql: `SELECT l.*, (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) as item_count,
                 o.id as order_id, o.stage as order_stage, o.rider_id as rider_id, o.destination_area as destination_area,
                 r.first_name as rider_first_name, r.profile_photo_key as rider_photo_key,
                 u.name as rider_full_name
          FROM lists l
          LEFT JOIN orders o ON o.id = (SELECT id FROM orders WHERE list_id = l.id ORDER BY updated_at DESC LIMIT 1)
          LEFT JOIN riders r ON r.user_id = o.rider_id
          LEFT JOIN users u ON u.id = o.rider_id
          WHERE l.customer_id = ? AND l.environment = ? AND l.customer_hidden = 0 ORDER BY l.updated_at DESC LIMIT ?`,
    args: [user.sub, await getPlatformEnvironment(), limit],
  });
  return c.json({
    lists: res.rows.map((r) => {
      const fullName = (r.rider_full_name as string | null)?.trim();
      const riderFirstName = (r.rider_first_name as string | null) ?? (fullName ? fullName.split(/\s+/)[0] : null);
      return {
        id: r.id,
        listId: r.id,
        title: r.title,
        status: r.status,
        itemCount: r.item_count,
        updatedAt: r.updated_at,
        orderId: r.order_id ?? null,
        // A draft whose last order was cancelled — i.e. one that expired and can be resent.
        expired: r.status === "draft" && r.order_stage === "Cancelled",
        riderId: r.rider_id ?? null,
        riderFirstName: r.rider_id ? riderFirstName : null,
        riderHasPhoto: !!r.rider_photo_key,
        area: r.destination_area ?? null,
      };
    }),
  });
});

orderRoutes.get("/lists/:id", async (c) => {
  const id = c.req.param("id");
  const list = await db.execute({ sql: "SELECT * FROM lists WHERE id = ?", args: [id] });
  const row = list.rows[0];
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.customer_id !== c.get("user").sub) return c.json({ error: "forbidden" }, 403);
  const items = await db.execute({ sql: "SELECT * FROM list_items WHERE list_id = ?", args: [id] });
  // The cancelled order a draft can be resent from (job expiry), if any.
  const last = await db.execute({
    sql: "SELECT id, stage FROM orders WHERE list_id = ? ORDER BY updated_at DESC LIMIT 1",
    args: [id],
  });
  const resendOrderId = row.status === "draft" && last.rows[0]?.stage === "Cancelled" ? (last.rows[0].id as string) : null;
  return c.json({ list: row, items: items.rows, resendOrderId });
});

// ---------------------------------------------------------------------------
// Orders — create / read
// ---------------------------------------------------------------------------

const createOrderSchema = z.object({
  listId: z.string(),
  type: z.enum(["shopping", "parcel"]).default("shopping"),
  /** A passenger ride ("call a rider to pick you up and take you
   * somewhere") rather than a goods parcel — only meaningful when
   * type is "parcel". See migrations/0039_ride_orders.sql. */
  isRide: z.boolean().optional(),
  pickupArea: z.string().max(120).optional(),
  pickupAddress: z.string().max(240).optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  destinationArea: z.string().max(120).optional(),
  destinationAddress: z.string().max(240).optional(),
  destinationLat: z.number().optional(),
  destinationLng: z.number().optional(),
  paymentRail: z.enum(["escrow", "float"]).default("escrow"),
  estimatedTotal: z.number().int().nonnegative().optional(),
  /** A ride booked for someone else: the booker pays, this person rides. */
  passenger: passengerSchema.optional(),
});

orderRoutes.post("/orders", async (c) => {
  const parsed = createOrderSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  return createOrderFromInput(c, parsed.data);
});

/** Creates an order from an existing list — shared by POST /orders and
 * POST /orders/:id/resend so a resent order gets exactly the same pricing,
 * matching and time-fee snapshot as a fresh one. */
export async function createOrderFromInput(
  c: Context,
  d: z.infer<typeof createOrderSchema>,
  /** Set only by the Peebee Car booking route: the category fare replaces the
   * boda ride rate and the order uses the car matching mode. */
  car?: { fare: number; matchingMode: MatchingMode; matchingDeadlineAt?: string },
) {
  const user = c.get("user");

  // An admin can switch a whole service off: no new orders of that kind
  // (anything already in flight carries on).
  const service: ServiceKey = d.type === "shopping" ? "shopping" : d.isRide ? "ride" : "parcel";
  if (!(await isServiceEnabled(service))) return servicePaused(c, service);

  const list = await db.execute({
    sql: "SELECT * FROM lists WHERE id = ?",
    args: [d.listId],
  });
  const listRow = list.rows[0];
  if (!listRow) return c.json({ error: "list_not_found" }, 404);
  if (listRow.customer_id !== user.sub) return c.json({ error: "forbidden" }, 403);

  // A parcel ride's cost is distance × the admin-set rate per km, computed
  // from pickup/destination coords whenever both were pinned on the map —
  // this always wins over any client-supplied estimate.
  //
  // Shopping orders have no pickup point (the "shop" is wherever the rider
  // goes), so there's no ride distance to price this way. The customer's own
  // estimate stands — but it becomes the amount escrow charges their mobile
  // money, so the server doesn't simply write down whatever arrived in the
  // request: it prefers the priced list when there is one, and refuses a
  // figure above the platform ceiling either way.
  let distanceKm: number | null = null;
  let estimatedTotal = d.estimatedTotal ?? null;
  // The delivery-fee portion of estimatedTotal, stored separately since
  // substitutions/fee proposals only ever adjust the items portion — see
  // migrations/0025_order_delivery_fee.sql.
  let deliveryFee: number | null = null;
  const isRide = d.type === "parcel" && d.isRide === true;
  if (car) {
    if (d.pickupLat != null && d.pickupLng != null && d.destinationLat != null && d.destinationLng != null) {
      distanceKm = haversineKm(d.pickupLat, d.pickupLng, d.destinationLat, d.destinationLng);
    }
    estimatedTotal = car.fare;
    deliveryFee = car.fare;
  } else if (d.type === "parcel") {
    if (d.pickupLat != null && d.pickupLng != null && d.destinationLat != null && d.destinationLng != null) {
      distanceKm = haversineKm(d.pickupLat, d.pickupLng, d.destinationLat, d.destinationLng);
    }
    const { deliveryRatePerKm, minimumDeliveryFee, rideRatePerKm, rideMinimumFare } = await getDeliverySettings();
    const rate = isRide ? rideRatePerKm : deliveryRatePerKm;
    const minimum = isRide ? rideMinimumFare : minimumDeliveryFee;
    // The rider still has to go collect and deliver the item (or carry the
    // passenger) even when pickup and destination are barely apart —
    // distance × rate is never allowed to round down toward a near-free ride.
    estimatedTotal = roundFare(distanceKm != null ? distanceKm * rate : (d.estimatedTotal ?? 0), minimum);
    // A parcel ride (goods or passenger) has no items — its whole total IS the delivery fee.
    deliveryFee = estimatedTotal;
  } else if (d.type === "shopping") {
    const priced = await db.execute({
      sql: `SELECT COUNT(*) AS total, COUNT(unit_price) AS priced,
                   COALESCE(SUM(quantity * unit_price), 0) AS sum_priced
            FROM list_items WHERE list_id = ?`,
      args: [d.listId],
    });
    const row = priced.rows[0] as Row | undefined;
    const itemCount = Number(row?.total ?? 0);
    const pricedCount = Number(row?.priced ?? 0);
    const { shoppingDeliveryFee } = await getDeliverySettings();
    deliveryFee = roundFare(shoppingDeliveryFee);
    // Every item carries a price → the list itself is the quote, and the
    // client's separate estimate is redundant at best. Either way, the
    // flat delivery fee is added on top of the items cost.
    const itemsTotal = itemCount > 0 && pricedCount === itemCount ? Number(row?.sum_priced ?? 0) : (d.estimatedTotal ?? 0);
    estimatedTotal = itemsTotal + deliveryFee;
  }

  if (estimatedTotal != null) {
    const maxOrderValue = await getMaxOrderValue();
    if (estimatedTotal > maxOrderValue) {
      return c.json(
        {
          error: "order_value_too_high",
          message: `Orders are capped at ${formatAmount(maxOrderValue)}. Please split this into smaller orders.`,
        },
        400,
      );
    }
  }

  // Which matching mode governs this order: the customer's own standing
  // preference, if admin currently allows it — otherwise whichever mode
  // admin put first. Stamped once at creation so it can't shift mid-flight
  // if either setting changes later. nearest_window gets a short collection
  // window; customer_selects gets a longer safety-net deadline so the order
  // still resolves even if the customer never picks (see ./matching.js and
  // the /orders/:id/match auto-resolve logic).
  const { enabledModes, nearestWindowSeconds, maxAssignmentMinutes } = await getMatchingSettings();
  const userRow = await db.execute({ sql: "SELECT default_matching_mode FROM users WHERE id = ?", args: [user.sub] });
  const preferredMode = userRow.rows[0]?.default_matching_mode as MatchingMode | null | undefined;
  const matchingMode: MatchingMode = car
    ? car.matchingMode
    : preferredMode && enabledModes.includes(preferredMode)
      ? preferredMode
      : enabledModes[0];
  const matchingDeadlineAt = car?.matchingDeadlineAt ??
    (matchingMode === "nearest_window"
      ? new Date(Date.now() + nearestWindowSeconds * 1000).toISOString()
      : matchingMode === "customer_selects"
        ? new Date(Date.now() + maxAssignmentMinutes * 60 * 1000).toISOString()
        : null);

  const orderId = newId("ord");
  // Inherits the list's own environment rather than re-reading whatever's
  // currently active — keeps a list+order pair consistent even if an admin
  // flips platform_environment in the gap between the two requests.
  const orderEnvironment = (listRow.environment as string | undefined) === "sandbox" ? "sandbox" : "live";
  await db.execute({
    sql: `INSERT INTO orders (
            id, list_id, customer_id, stage, type, payment_rail, estimated_total, delivery_fee,
            pickup_area, pickup_address, pickup_lat, pickup_lng,
            destination_area, destination_address, destination_lat, destination_lng, distance_km,
            matching_mode, matching_deadline_at, environment, is_ride
          )
          VALUES (?, ?, ?, 'Create', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      orderId,
      d.listId,
      user.sub,
      d.type,
      d.paymentRail,
      estimatedTotal,
      deliveryFee,
      d.pickupArea ?? null,
      d.pickupAddress ?? null,
      d.pickupLat ?? null,
      d.pickupLng ?? null,
      d.destinationArea ?? null,
      d.destinationAddress ?? null,
      d.destinationLat ?? null,
      d.destinationLng ?? null,
      distanceKm,
      matchingMode,
      matchingDeadlineAt,
      orderEnvironment,
      isRide ? 1 : 0,
    ],
  });
  await db.execute({
    sql: "UPDATE lists SET status = 'active', updated_at = datetime('now') WHERE id = ?",
    args: [d.listId],
  });
  await logEvent(orderId, "Create", "Order created", user.sub);
  await snapshotTimeFees(orderId, deliveryFee ?? estimatedTotal ?? 0);

  // Booking for someone else: only for passenger rides, only while the admin
  // switch is on and its migration is applied. Anything else ignores it.
  if (isRide && d.passenger && (await rideForOtherAvailable())) {
    await db.execute({
      sql: "UPDATE orders SET passenger_name = ?, passenger_phone = ?, share_token = ? WHERE id = ?",
      args: [d.passenger.name, d.passenger.phone, newShareToken(), orderId],
    });
  }

  const order = await getOrder(orderId);
  return c.json({ order }, 201);
}

/** Resend an order that expired (or otherwise went back to a draft): makes a
 * new order from the same list with the same type, route and payment rail.
 * Only the customer's own order, only while its list is a draft and nothing
 * else is running for that list. */
orderRoutes.post("/orders/:id/resend", async (c) => {
  const user = c.get("user");
  const old = await getOrder(c.req.param("id"));
  if (!old) return c.json({ error: "not_found" }, 404);
  if (old.customer_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  if (old.stage !== "Cancelled") return c.json({ error: "not_resendable", message: "Only an expired order can be resent." }, 409);

  const list = await db.execute({ sql: "SELECT status FROM lists WHERE id = ?", args: [String(old.list_id)] });
  if (list.rows[0]?.status !== "draft") {
    return c.json({ error: "not_resendable", message: "This order can't be resent." }, 409);
  }
  const running = await db.execute({
    sql: "SELECT 1 FROM orders WHERE list_id = ? AND stage != 'Cancelled' LIMIT 1",
    args: [String(old.list_id)],
  });
  if (running.rows.length > 0) return c.json({ error: "already_resent", message: "This order was already resent." }, 409);

  const isRide = old.is_ride === 1 || old.is_ride === true;
  const response = await createOrderFromInput(c, {
    listId: String(old.list_id),
    type: old.type === "parcel" ? "parcel" : "shopping",
    isRide: isRide || undefined,
    pickupArea: (old.pickup_area as string | null) ?? undefined,
    pickupAddress: (old.pickup_address as string | null) ?? undefined,
    pickupLat: (old.pickup_lat as number | null) ?? undefined,
    pickupLng: (old.pickup_lng as number | null) ?? undefined,
    destinationArea: (old.destination_area as string | null) ?? undefined,
    destinationAddress: (old.destination_address as string | null) ?? undefined,
    destinationLat: (old.destination_lat as number | null) ?? undefined,
    destinationLng: (old.destination_lng as number | null) ?? undefined,
    paymentRail: old.payment_rail === "float" ? "float" : "escrow",
    passenger: old.passenger_name && old.passenger_phone ? { name: String(old.passenger_name), phone: String(old.passenger_phone) } : undefined,
    // Shopping: the items part of the old total (the delivery fee is added again).
    estimatedTotal:
      old.type === "shopping" && old.estimated_total != null
        ? Math.max(0, Number(old.estimated_total) - Number(old.delivery_fee ?? 0))
        : undefined,
  });
  // A spoken list lives on the order, not the list — carry it over.
  if (response.status === 201 && old.voice_note_key) {
    const created = (await response.clone().json()) as { order?: { id?: string } };
    if (created.order?.id) await touchOrder(created.order.id, { voice_note_key: old.voice_note_key as string });
  }
  return response;
});

/** Places this customer has recently had orders sent to (rides, parcels,
 * shopping and food alike), newest first and de-duplicated — the "Recently
 * gone to" list in the location picker. Cancelled orders don't count. */
orderRoutes.get("/orders/recent-places", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT destination_area AS area, destination_address AS address,
                 destination_lat AS lat, destination_lng AS lng, MAX(created_at) AS last_at
          FROM orders
          WHERE customer_id = ? AND stage != 'Cancelled'
            AND (destination_address IS NOT NULL OR destination_area IS NOT NULL)
          GROUP BY LOWER(COALESCE(destination_address, destination_area))
          ORDER BY last_at DESC LIMIT 8`,
    args: [user.sub],
  });
  return c.json({ places: res.rows });
});

orderRoutes.get("/orders/active", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT o.*, u.name as customer_name FROM orders o
          LEFT JOIN users u ON u.id = o.customer_id
          WHERE o.customer_id = ? AND o.stage NOT IN ('Settle', 'Cancelled') AND o.environment = ?
          ORDER BY o.updated_at DESC LIMIT 1`,
    args: [user.sub, await getPlatformEnvironment()],
  });
  const activeOrder = res.rows[0] ?? null;
  if (!activeOrder) return c.json({ activeOrder: null, pendingFeeProposal: null });

  // Surfaced here too (not just on the order's own detail page) so the
  // home screen can flag a pending rider fee proposal without the customer
  // having to open the order first — see components/home/FeeProposalCard.
  const proposalRes = await db.execute({
    sql: "SELECT * FROM fee_proposals WHERE order_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    args: [activeOrder.id as string],
  });
  return c.json({ activeOrder, pendingFeeProposal: proposalRes.rows[0] ?? null });
});

orderRoutes.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const [items, events, substitutions, payments, rating, feeProposals] = await Promise.all([
    db.execute({ sql: "SELECT * FROM list_items WHERE list_id = ?", args: [order.list_id as string] }),
    db.execute({ sql: "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC", args: [id] }),
    db.execute({ sql: "SELECT * FROM substitutions WHERE order_id = ? ORDER BY created_at ASC", args: [id] }),
    db.execute({ sql: "SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC", args: [id] }),
    db.execute({ sql: "SELECT rating, comment, recommended FROM order_ratings WHERE order_id = ?", args: [id] }),
    db.execute({ sql: "SELECT * FROM fee_proposals WHERE order_id = ? ORDER BY created_at ASC", args: [id] }),
  ]);

  return c.json({
    order: redactOrder(order, user),
    items: items.rows,
    events: events.rows,
    substitutions: substitutions.rows,
    payments: payments.rows,
    rating: rating.rows[0] ?? null,
    feeProposals: feeProposals.rows,
    timeFees: await getOrderTimeFees(order),
  });
});

// ---------------------------------------------------------------------------
// Voice note — spoken context a typed list can miss (units, brand, exactly
// which shelf/shop). Attached by the customer, playable by whoever can
// already see the order.
// ---------------------------------------------------------------------------

const MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024;
const ALLOWED_VOICE_NOTE_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]);

orderRoutes.post("/orders/:id/voice-note", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return c.json({ error: "missing_audio" }, 400);
  if (!ALLOWED_VOICE_NOTE_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
  if (file.size > MAX_VOICE_NOTE_BYTES) return c.json({ error: "file_too_large" }, 400);

  const ext = extensionForMime(file.type, "webm");
  const key = `orders/${id}/voice-note.${ext}`;
  const bucket = getR2Bucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  await touchOrder(id, { voice_note_key: key });
  await logEvent(id, order.stage as string, "Customer attached a voice note", user.sub);

  return c.json({ order: await getOrder(id) });
});

orderRoutes.get("/orders/:id/voice-note", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const key = order.voice_note_key as string | null;
  if (!key) return c.json({ error: "not_found" }, 404);

  const bucket = getR2Bucket();
  const object = await bucket.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: uploadResponseHeaders(object.httpMetadata?.contentType, "audio/webm"),
  });
});

// ---------------------------------------------------------------------------
// Luganda list audio — reads a rider's own preferred voice (see
// riders.preferred_lug_voice, set in apps/rider's account settings) the
// shopping list, for a rider who isn't comfortable reading the typed list
// themselves. Cached in R2 per order; regenerated whenever the list
// contents or the rider's chosen voice change. See ../speech/gemini.ts and
// ./list-narration.ts.
// ---------------------------------------------------------------------------

orderRoutes.get("/orders/:id/list-audio", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const lugandaSettings = await getLugandaAudioSettings();
  if (!lugandaSettings.enabled) return c.json({ error: "feature_disabled" }, 404);

  let voice = lugandaSettings.defaultVoice;
  let riderRow: Row | undefined;
  if (order.rider_id) {
    const riderRes = await db.execute({
      sql: "SELECT preferred_lug_voice, pro_status, pro_paid_through FROM riders WHERE user_id = ?",
      args: [order.rider_id as string],
    });
    riderRow = riderRes.rows[0] as Row | undefined;
    const preferred = riderRow?.preferred_lug_voice as string | null | undefined;
    if (preferred) voice = preferred;
  }
  if (lugandaSettings.requiresPro && !isProSubscriptionCurrent(riderRow ?? {})) {
    return c.json({ error: "pro_required", message: "Listening to lists in Luganda now requires a Pro subscription." }, 403);
  }

  const itemsRes = await db.execute({ sql: "SELECT * FROM list_items WHERE list_id = ?", args: [order.list_id as string] });
  const items = itemsRes.rows as Row[];
  // Hashes the raw item data rather than the built narration text, since
  // building it now involves network calls (per-item name translation) —
  // this lets the cache check happen before any of that runs.
  const textHash = `gemini:${voice}:${JSON.stringify(items.map((i) => [i.id, i.quantity, i.name, i.unit_price]))}`;

  const bucket = getR2Bucket();
  if (order.list_audio_key && order.list_audio_text_hash === textHash) {
    const cached = await bucket.get(order.list_audio_key as string);
    if (cached) {
      return new Response(cached.body, { headers: uploadResponseHeaders(cached.httpMetadata?.contentType, "audio/wav") });
    }
  }

  const lugandaText = await buildLugandaListNarration(items, lugandaSettings.translateMode);
  const audio = await synthesizeLuganda(lugandaText, voice);
  const key = `orders/${id}/list-audio-gemini-${voice}.wav`;
  await bucket.put(key, audio, { httpMetadata: { contentType: "audio/wav" } });
  await touchOrder(id, { list_audio_voice: voice, list_audio_key: key, list_audio_text_hash: textHash });

  return new Response(audio, { headers: uploadResponseHeaders("audio/wav", "audio/wav") });
});

// ---------------------------------------------------------------------------
// Matching preference — a customer's standing choice of how riders get
// assigned to their orders (see ../lib/settings.js for the admin-side
// enable/disable and MatchingMode in @peebee/shared for the three modes).
// Only takes effect for whichever modes admin currently has enabled; a
// preference for a mode that's since been disabled falls back silently to
// admin's first enabled mode at order-creation time.
// ---------------------------------------------------------------------------

const matchingPreferenceSchema = z.object({
  defaultMatchingMode: z.enum(["first_to_claim", "nearest_window", "customer_selects"]).nullable(),
});

orderRoutes.put("/me/matching-preference", async (c) => {
  const user = c.get("user");
  const parsed = matchingPreferenceSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  await db.execute({
    sql: "UPDATE users SET default_matching_mode = ?, updated_at = datetime('now') WHERE id = ?",
    args: [parsed.data.defaultMatchingMode, user.sub],
  });

  return c.json({ defaultMatchingMode: parsed.data.defaultMatchingMode });
});

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

/**
 * Assigns a rider atomically (conditional UPDATE — loses the race harmlessly
 * if someone else got there first) and logs it. Shared by every path that
 * can end in an assignment: the first_to_claim auto-poll and claim button,
 * the nearest_window auto-resolve, and the customer_selects pick.
 */
async function assignRider(
  id: string,
  order: Row,
  riderId: string,
  riderName: string,
  outOfRange: boolean,
): Promise<boolean> {
  const nextStage = order.payment_rail === "float" ? "Shop" : "Match";
  const assigned = await assignAvailableRider(id, riderId, nextStage, outOfRange, String(order.environment));
  if (!assigned) return false;

  if (order.funds_model === "merchant_allocations_v1") {
    await db.execute({
      sql: "INSERT OR IGNORE INTO rider_order_locks (rider_id, order_id, environment) VALUES (?, ?, ?)",
      args: [riderId, id, String(order.environment)],
    });
  }

  // Anything the customer sent before a rider existed was stored with a null
  // rider_id, and every chat query since works off the customer/rider pair —
  // so without this those messages drop out of the conversation the moment
  // it gets a second participant, which is exactly when someone would look
  // for them. Adopt them into the thread that just formed.
  await db.execute({
    sql: "UPDATE chat_messages SET rider_id = ? WHERE order_id = ? AND rider_id IS NULL",
    args: [riderId, id],
  });

  await logEvent(
    id,
    "Match",
    outOfRange ? `Matched with rider ${riderName} (out of normal range)` : `Matched with rider ${riderName}`,
    riderId,
  );
  if (order.payment_rail === "float") {
    await logEvent(id, "Fund", "Cash rail — rider fronting funds, no payment needed upfront", riderId);
  }
  if (await isCarOrder(id)) await stampCarBooking(id, riderId);
  return true;
}

/**
 * Finds the best rider to auto-assign right now, exactly the way the
 * original single-mode matcher did: nearest rider within the currently-open
 * staged-radius tier, falling back (once every tier's had its turn) to a
 * same-area match or any available rider. Used as first_to_claim's auto-poll
 * backstop, and as the nearest_window / customer_selects safety net once
 * their deadline passes with no (or no usable) applicants.
 */
async function findAutoMatchCandidate(
  id: string,
  order: Row,
): Promise<{ riderId: string; riderName: string; outOfRange: boolean } | null> {
  // A car ride is only ever offered to drivers of its vehicle category.
  if (await isCarOrder(id)) return findCarCandidate(id, order);
  const { serviceRangeKm } = await getDeliverySettings();
  const matchPoint = orderMatchPoint(order);
  const visibleRadiusKm = currentVisibilityRadiusKm(order.updated_at as string);
  const fullyOpen = visibleRadiusKm == null;

  // Skips a lapsed subscriber entirely when one's required — auto-match
  // never hands work to a rider who couldn't have claimed it themselves.
  const subscriptionGate = (await getMonetizationSettings()).subscriptionEnabled
    ? "AND r.subscription_status = 'active' AND r.subscription_paid_through >= datetime('now')"
    : "";
  const eligible = await db.execute({
    sql: `SELECT u.id, u.name, r.stage_lat, r.stage_lng, r.area FROM riders r JOIN users u ON u.id = r.user_id
          WHERE r.verified = 1 AND r.is_online = 1
          ${subscriptionGate}
          AND u.id NOT IN (
            SELECT rider_id FROM orders WHERE rider_id IS NOT NULL AND stage NOT IN ('Settle', 'Cancelled') AND environment = ?
          )
          AND u.id NOT IN (SELECT rider_id FROM order_rider_exclusions WHERE order_id = ?)`,
    args: [order.environment as string, id],
  });

  let nearestKnown: { row: Row; distanceKm: number } | null = null;
  const unknownLocation: Row[] = [];
  for (const row of eligible.rows as Row[]) {
    const riderLat = row.stage_lat as number | null;
    const riderLng = row.stage_lng as number | null;
    if (matchPoint && riderLat != null && riderLng != null) {
      const distanceKm = haversineKm(matchPoint.lat, matchPoint.lng, riderLat, riderLng);
      if (!fullyOpen && distanceKm > (visibleRadiusKm as number)) continue; // not their turn yet
      if (!nearestKnown || distanceKm < nearestKnown.distanceKm) nearestKnown = { row, distanceKm };
    } else {
      unknownLocation.push(row);
    }
  }

  if (nearestKnown) {
    return { riderId: nearestKnown.row.id as string, riderName: nearestKnown.row.name as string, outOfRange: nearestKnown.distanceKm > serviceRangeKm };
  }
  if (fullyOpen || !matchPoint) {
    const area = order.destination_area as string | null;
    const candidate = (area ? unknownLocation.find((row) => row.area === area) : undefined) ?? unknownLocation[0];
    if (candidate) {
      return { riderId: candidate.id as string, riderName: candidate.name as string, outOfRange: !area || candidate.area !== area };
    }
  }
  return null;
}

orderRoutes.post("/orders/:id/match", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  // Normally an unmatched order is in "Create". A funded order whose rider
  // cancelled is left in "Match" with rider_id cleared instead of being
  // rewound to "Create" — that would re-expose the funding step even though
  // the customer already paid — so it's matchable again too.
  const canMatch = order.stage === "Create" || (order.stage === "Match" && !order.rider_id);
  if (!canMatch) {
    return c.json({ error: "invalid_stage", message: `Cannot match from stage ${order.stage}` }, 409);
  }

  const mode = order.matching_mode as MatchingMode;

  if (mode === "customer_selects") {
    // The customer picks (see /orders/:id/applicants) — this poll only ever
    // acts as the safety net once the order's max-assignment deadline (set
    // at creation) has passed with nobody chosen yet.
    const deadline = order.matching_deadline_at as string | null;
    if (!deadline || Date.now() < parseDbTimestamp(deadline).getTime()) {
      return c.json({ order });
    }
  }

  if (mode === "nearest_window") {
    const deadline = order.matching_deadline_at as string | null;
    if (deadline && Date.now() < parseDbTimestamp(deadline).getTime()) {
      return c.json({ order }); // still collecting applicants
    }
    // Window's up — assign whoever applied nearest so far.
    const applicants = await db.execute({
      sql: `SELECT oa.rider_id, u.name, oa.distance_km FROM order_applications oa
            JOIN users u ON u.id = oa.rider_id
            WHERE oa.order_id = ? AND oa.status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM orders busy WHERE busy.rider_id = oa.rider_id
              AND busy.environment = ? AND busy.stage NOT IN ('Settle', 'Cancelled'))
            ORDER BY oa.distance_km ASC LIMIT 1`,
      args: [id, String(order.environment)],
    });
    const best = applicants.rows[0] as Row | undefined;
    if (best) {
      const { serviceRangeKm } = await getDeliverySettings();
      const distanceKm = best.distance_km as number | null;
      const outOfRange = distanceKm != null && distanceKm > serviceRangeKm;
      const bestRiderId = best.rider_id as string;
      const assigned = await assignRider(id, order, bestRiderId, best.name as string, outOfRange);
      if (assigned) return c.json({ order: await getOrder(id) });
    }
    // Nobody's applied yet — extend the window rather than falling back
    // immediately, unless the overall SLA ceiling has now been reached.
    const { maxAssignmentMinutes, nearestWindowSeconds } = await getMatchingSettings();
    const ceilingReached =
      Date.now() - parseDbTimestamp(order.created_at as string).getTime() > maxAssignmentMinutes * 60 * 1000;
    if (!ceilingReached) {
      await touchOrder(id, { matching_deadline_at: new Date(Date.now() + nearestWindowSeconds * 1000).toISOString() });
      return c.json({ order: await getOrder(id) });
    }
    // Ceiling reached with zero applicants — fall through to the general
    // auto-match fallback below rather than leaving the customer stuck.
  }

  // first_to_claim's own auto-poll backstop, and the fallback for
  // nearest_window/customer_selects once their safety net is reached.
  const found = await findAutoMatchCandidate(id, order);
  if (!found) {
    return c.json({ error: "no_riders_available", message: "No verified riders online right now" }, 409);
  }
  await assignRider(id, order, found.riderId, found.riderName, found.outOfRange);
  return c.json({ order: await getOrder(id) });
});

/**
 * A rider actively taking an unmatched "first_to_claim" job from their
 * available-jobs list (see GET /riders/jobs/available) — the primary way
 * those orders get assigned, with the auto-match poll above as a backstop
 * for one nobody's claimed yet. Same staged-radius rule applies here so a
 * rider can't jump the queue by hitting this directly before it's their
 * tier's turn. Orders in another matching mode use /apply instead.
 */
orderRoutes.post("/orders/:id/claim", requireRole("rider"), async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id) {
    return c.json({ error: "already_claimed", message: "This job is no longer available or you already have an active job" }, 409);
  }
  if (await isCarOrder(id)) {
    return c.json({ error: "car_order", message: "This is a Peebee Car ride — only car drivers can take it." }, 403);
  }
  const canClaim = order.stage === "Create" || (order.stage === "Match" && !order.rider_id);
  if (!canClaim) {
    return c.json({ error: "invalid_stage", message: `Cannot claim from stage ${order.stage}` }, 409);
  }
  if (order.matching_mode !== "first_to_claim") {
    return c.json({ error: "wrong_mode", message: "This order takes applications instead — use /apply" }, 409);
  }

  const excluded = await db.execute({
    sql: "SELECT 1 FROM order_rider_exclusions WHERE order_id = ? AND rider_id = ?",
    args: [id, user.sub],
  });
  if (excluded.rows.length > 0) {
    return c.json({ error: "not_eligible", message: "You previously declined this order" }, 403);
  }

  const environmentForBalance = order.environment === "sandbox" ? "sandbox" : "live";
  const balanceColumn = environmentForBalance === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const riderRes = await db.execute({
    sql: `SELECT r.verified, r.is_online, r.stage_lat, r.stage_lng, r.subscription_status, r.subscription_paid_through, r.${balanceColumn} as wallet_balance, u.name
          FROM riders r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`,
    args: [user.sub],
  });
  const rider = riderRes.rows[0] as Row | undefined;
  if (!rider?.verified) return c.json({ error: "not_verified" }, 403);
  if (!rider.is_online) return c.json({ error: "not_online", message: "Go online to claim jobs" }, 409);
  const monetizationSettings = await getMonetizationSettings();
  if (monetizationSettings.subscriptionEnabled && !isSubscriptionCurrent(rider)) {
    return c.json({ error: "subscription_required", message: "Pay your subscription to start claiming jobs" }, 403);
  }
  const reserveSettings = await getRiderReserveSettings();
  if (!isCashDepositOk(Number(rider.wallet_balance) || 0, monetizationSettings.cashFeeSource, reserveSettings)) {
    return c.json(
      {
        error: "deposit_required",
        message: `Top up your wallet to at least ${formatAmount(reserveSettings.amount)} to keep claiming jobs`,
      },
      403,
    );
  }

  const { serviceRangeKm } = await getDeliverySettings();
  const matchPoint = orderMatchPoint(order);
  const riderLat = rider.stage_lat as number | null;
  const riderLng = rider.stage_lng as number | null;
  const distanceKm =
    matchPoint && riderLat != null && riderLng != null
      ? haversineKm(matchPoint.lat, matchPoint.lng, riderLat, riderLng)
      : null;

  if (distanceKm != null) {
    const visibleRadiusKm = currentVisibilityRadiusKm(order.updated_at as string);
    if (visibleRadiusKm != null && distanceKm > visibleRadiusKm) {
      return c.json(
        { error: "not_yet_visible", message: "This order isn't open to your area yet — try again shortly" },
        409,
      );
    }
  }
  const outOfRange = distanceKm != null && distanceKm > serviceRangeKm;

  const assigned = await assignRider(id, order, user.sub, rider.name as string, outOfRange);
  if (!assigned) {
    return c.json({ error: "rider_unavailable", message: "This job is no longer available or you already have an active job" }, 409);
  }

  return c.json({ order: await getOrder(id) });
});

/**
 * A rider offering to take a "nearest_window" or "customer_selects" job —
 * unlike /claim, this doesn't assign the order outright. It just enters the
 * rider into the running: nearest_window auto-picks the closest applicant
 * once its collection window closes (see /orders/:id/match above),
 * customer_selects waits for the customer to pick (see /applicants below).
 */
async function biddingArgs(orderId?: string) {
  const { settings, enabledModes } = await loadBiddingContext();
  // A car ride follows the car matching setting, not the boda rider's list of modes.
  const modes = orderId && (await isCarOrder(orderId)) ? [...new Set<MatchingMode>([...enabledModes, "customer_selects"])] : enabledModes;
  return [settings, modes] as const;
}

const applySchema = z.object({
  /** The applicant's own price for the whole job — only when bidding is on for it. */
  bidAmount: z.number().int().positive().max(10_000_000).optional(),
});

orderRoutes.post("/orders/:id/apply", requireRole("rider"), async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const parsedApply = applySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsedApply.success) return c.json({ error: "invalid_body", issues: parsedApply.error.issues }, 400);
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id) {
    return c.json({ error: "already_claimed", message: "This job has already been taken" }, 409);
  }
  if (await isCarOrder(id)) {
    return c.json({ error: "car_order", message: "This is a Peebee Car ride — only car drivers can take it." }, 403);
  }
  const canApply = order.stage === "Create" || (order.stage === "Match" && !order.rider_id);
  if (!canApply) {
    return c.json({ error: "invalid_stage", message: `Cannot apply from stage ${order.stage}` }, 409);
  }
  if (order.matching_mode === "first_to_claim") {
    return c.json({ error: "wrong_mode", message: "This order is first-come-first-served — use /claim" }, 409);
  }

  const excluded = await db.execute({
    sql: "SELECT 1 FROM order_rider_exclusions WHERE order_id = ? AND rider_id = ?",
    args: [id, user.sub],
  });
  if (excluded.rows.length > 0) {
    return c.json({ error: "not_eligible", message: "You previously declined this order" }, 403);
  }

  const applyBalanceColumn = order.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const riderRes = await db.execute({
    sql: `SELECT verified, is_online, stage_lat, stage_lng, subscription_status, subscription_paid_through, ${applyBalanceColumn} as wallet_balance
          FROM riders WHERE user_id = ?`,
    args: [user.sub],
  });
  const rider = riderRes.rows[0] as Row | undefined;
  if (!rider?.verified) return c.json({ error: "not_verified" }, 403);
  if (!rider.is_online) return c.json({ error: "not_online", message: "Go online to apply for jobs" }, 409);
  const applyMonetizationSettings = await getMonetizationSettings();
  if (applyMonetizationSettings.subscriptionEnabled && !isSubscriptionCurrent(rider)) {
    return c.json({ error: "subscription_required", message: "Pay your subscription to start applying for jobs" }, 403);
  }
  const applyReserveSettings = await getRiderReserveSettings();
  if (!isCashDepositOk(Number(rider.wallet_balance) || 0, applyMonetizationSettings.cashFeeSource, applyReserveSettings)) {
    return c.json(
      {
        error: "deposit_required",
        message: `Top up your wallet to at least ${formatAmount(applyReserveSettings.amount)} to keep applying for jobs`,
      },
      403,
    );
  }

  const matchPoint = orderMatchPoint(order);
  const riderLat = rider.stage_lat as number | null;
  const riderLng = rider.stage_lng as number | null;
  const distanceKm =
    matchPoint && riderLat != null && riderLng != null
      ? haversineKm(matchPoint.lat, matchPoint.lng, riderLat, riderLng)
      : null;

  if (distanceKm != null) {
    const visibleRadiusKm = currentVisibilityRadiusKm(order.updated_at as string);
    if (visibleRadiusKm != null && distanceKm > visibleRadiusKm) {
      return c.json(
        { error: "not_yet_visible", message: "This order isn't open to your area yet — try again shortly" },
        409,
      );
    }
  }

  // status goes back to 'pending' on a repeat application, not just the
  // distance. When someone else gets picked every other applicant is marked
  // 'declined', and if that rider later cancels the job returns to the pool —
  // without this reset, anyone who applied the first time round would get an
  // "applied" confirmation while staying invisible to the customer, because
  // the applicant list only shows pending rows.
  // A bid is only taken when bidding is on for this order and it's inside the
  // admin's limits; naming exactly the app's own price is the same as not bidding.
  const bidColumn = await hasColumn("order_applications", "bid_amount");
  let bidAmount: number | null = null;
  if (parsedApply.data.bidAmount != null) {
    if (!bidColumn) return c.json({ error: "bidding_unavailable", message: "Bidding isn't ready yet — apply at the app price." }, 409);
    const bidding = computeBidding(order, ...(await biddingArgs(id)));
    const checked = validateBid(bidding, parsedApply.data.bidAmount);
    if ("error" in checked) return c.json({ error: "bid_not_allowed", message: checked.error }, 400);
    bidAmount = checked.bid === bidding.appPrice ? null : checked.bid;
  }

  const applicationResult = bidColumn
    ? await db.execute({
        sql: `INSERT INTO order_applications (id, order_id, rider_id, distance_km, status, bid_amount)
              SELECT ?, ?, ?, ?, 'pending', ?
              WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND rider_id IS NULL AND stage IN ('Create', 'Match'))
                AND NOT EXISTS (SELECT 1 FROM orders WHERE rider_id = ? AND environment = ? AND stage NOT IN ('Settle', 'Cancelled'))
              ON CONFLICT(order_id, rider_id) DO UPDATE SET distance_km = excluded.distance_km, status = 'pending', bid_amount = excluded.bid_amount`,
        args: [newId("app"), id, user.sub, distanceKm, bidAmount, id, user.sub, String(order.environment)],
      })
    : // Before migration 0064 is applied: exactly the previous behaviour.
      await db.execute({
        sql: `INSERT INTO order_applications (id, order_id, rider_id, distance_km, status)
              SELECT ?, ?, ?, ?, 'pending'
              WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND rider_id IS NULL AND stage IN ('Create', 'Match'))
                AND NOT EXISTS (SELECT 1 FROM orders WHERE rider_id = ? AND environment = ? AND stage NOT IN ('Settle', 'Cancelled'))
              ON CONFLICT(order_id, rider_id) DO UPDATE SET distance_km = excluded.distance_km, status = 'pending'`,
        args: [newId("app"), id, user.sub, distanceKm, id, user.sub, String(order.environment)],
      });
  if (applicationResult.rowsAffected === 0) {
    return c.json({ error: "rider_unavailable", message: "This job is no longer available or you already have an active job" }, 409);
  }

  return c.json({ ok: true });
});

/** The applicant pool for a "customer_selects" order — enough of each rider's track record to compare. */
orderRoutes.get("/orders/:id/applicants", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const { serviceRangeKm } = await getDeliverySettings();
  const bidding = computeBidding(order, ...(await biddingArgs(id)));
  const applications = await db.execute({
    sql: `SELECT oa.rider_id, u.name, oa.distance_km, ${(await hasColumn("order_applications", "bid_amount")) ? "oa.bid_amount" : "NULL AS bid_amount"} FROM order_applications oa
          JOIN users u ON u.id = oa.rider_id
          WHERE oa.order_id = ? AND oa.status = 'pending'
          AND EXISTS (SELECT 1 FROM orders target WHERE target.id = oa.order_id AND target.rider_id IS NULL AND target.stage IN ('Create', 'Match'))
          AND NOT EXISTS (SELECT 1 FROM orders busy WHERE busy.rider_id = oa.rider_id
            AND busy.environment = ? AND busy.stage NOT IN ('Settle', 'Cancelled'))
          ORDER BY oa.distance_km ASC`,
    args: [id, String(order.environment)],
  });

  const applicantRows = [...(applications.rows as Row[])];
  // With bidding on, the best price comes first (nearest breaks ties).
  if (bidding.active) {
    const priceOf = (r: Row) => (r.bid_amount as number | null) ?? bidding.appPrice ?? 0;
    applicantRows.sort(
      (a, b) => priceOf(a) - priceOf(b) || ((a.distance_km as number | null) ?? Infinity) - ((b.distance_km as number | null) ?? Infinity),
    );
  }

  const applicants = await Promise.all(
    applicantRows.map(async (row) => {
      const riderId = row.rider_id as string;
      const [stats, comments] = await Promise.all([
        db.execute({
          sql: `SELECT AVG(orr.rating) as avg_rating, COUNT(*) as review_count, SUM(orr.recommended) as recommend_count,
                       SUM(CASE WHEN TRIM(COALESCE(orr.comment, '')) != '' THEN 1 ELSE 0 END) as comment_count
                FROM order_ratings orr JOIN orders o ON o.id = orr.order_id WHERE orr.rider_id = ? AND o.environment = ?`,
          args: [riderId, String(order.environment)],
        }),
        db.execute({
          sql: `SELECT orr.comment FROM order_ratings orr JOIN orders o ON o.id = orr.order_id
                WHERE orr.rider_id = ? AND o.environment = ? AND orr.comment IS NOT NULL ORDER BY orr.created_at DESC LIMIT 3`,
          args: [riderId, String(order.environment)],
        }),
      ]);
      const statsRow = stats.rows[0] as Row | undefined;
      const distanceKm = row.distance_km as number | null;
      return {
        riderId,
        riderName: row.name as string,
        distanceKm,
        outOfServiceRange: distanceKm != null && distanceKm > serviceRangeKm,
        // What this applicant asks for the job (their bid, else the app's price),
        // plus the app's own price so the customer can compare. Null when bidding is off.
        price: bidding.active ? ((row.bid_amount as number | null) ?? bidding.appPrice) : null,
        bidAmount: bidding.active ? ((row.bid_amount as number | null) ?? null) : null,
        appPrice: bidding.active ? bidding.appPrice : null,
        avgRating: statsRow?.avg_rating != null ? Math.round((statsRow.avg_rating as number) * 10) / 10 : null,
        reviewCount: Number(statsRow?.review_count ?? 0),
        recommendCount: Number(statsRow?.recommend_count ?? 0),
        commentCount: Number(statsRow?.comment_count ?? 0),
        recentComments: (comments.rows as Row[]).map((r) => r.comment as string),
      };
    }),
  );

  return c.json({ applicants });
});

/** Only the customer for this application can inspect the rider's public profile. */
orderRoutes.get("/orders/:id/applicants/:riderId/profile", async (c) => {
  const order = await getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== c.get("user").sub) return c.json({ error: "forbidden" }, 403);
  const riderId = c.req.param("riderId");
  const application = await db.execute({
    sql: "SELECT 1 FROM order_applications WHERE order_id = ? AND rider_id = ?",
    args: [String(order.id), riderId],
  });
  if (!application.rows.length) return c.json({ error: "not_found" }, 404);
  const offset = Number(c.req.query("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return c.json({ error: "invalid_offset" }, 400);
  const profile = await getApplicantProfile(riderId, String(order.environment), offset);
  if (!profile) return c.json({ error: "not_found" }, 404);
  return c.json(profile);
});

/** The customer's pick, for a "customer_selects" order — assigns that rider and turns away the rest. */
orderRoutes.post("/orders/:id/applicants/:riderId/select", async (c) => {
  const id = c.req.param("id");
  const riderId = c.req.param("riderId") as string;
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.rider_id) {
    return c.json({ error: "already_claimed", message: "This order already has a rider" }, 409);
  }

  const application = await db.execute({
    sql: `SELECT oa.distance_km, ${(await hasColumn("order_applications", "bid_amount")) ? "oa.bid_amount" : "NULL AS bid_amount"}, u.name FROM order_applications oa JOIN users u ON u.id = oa.rider_id WHERE oa.order_id = ? AND oa.rider_id = ? AND oa.status = 'pending'`,
    args: [id, riderId],
  });
  const row = application.rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found", message: "That rider hasn't applied for this order" }, 404);

  const { serviceRangeKm } = await getDeliverySettings();
  const distanceKm = row.distance_km as number | null;
  const outOfRange = distanceKm != null && distanceKm > serviceRangeKm;

  const assigned = await assignRider(id, order, riderId, row.name as string, outOfRange);
  if (!assigned) {
    return c.json({ error: "rider_unavailable", message: "This rider or job is no longer available. Please choose another rider." }, 409);
  }

  // The customer chose a bid: that bid is now the price. (Bids are only ever
  // applied on the customer's own pick — never by auto-matching.)
  const bid = row.bid_amount as number | null;
  if (bid != null) {
    const bidding = computeBidding(order, ...(await biddingArgs(id)));
    if (bidding.active && bidding.appPrice != null && bid !== Number(order.estimated_total)) {
      const changed = await db.execute({
        sql: `UPDATE orders SET app_price = COALESCE(app_price, estimated_total), estimated_total = ?, delivery_fee = ?,
                time_fee_policy = NULL, updated_at = datetime('now')
              WHERE id = ? AND rider_id = ? AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ?)`,
        args: [bid, bid, id, riderId, id],
      });
      if (changed.rowsAffected > 0) {
        await snapshotTimeFees(id, bid);
        await logEvent(
          id,
          String(order.payment_rail === "float" ? "Shop" : "Match"),
          `Price agreed at UGX ${bid.toLocaleString("en-UG")} (rider's bid; app price UGX ${bidding.appPrice.toLocaleString("en-UG")})`,
          riderId,
        );
      }
    }
  }

  return c.json({ order: await getOrder(id) });
});

// ---------------------------------------------------------------------------
// Cancel — a rider backing out of a job they were matched to. The order
// drops back into the matching pool instead of being cancelled outright,
// and this rider is never offered it again.
// ---------------------------------------------------------------------------

const CANCELLABLE_STAGES = ["Match", "Shop", "Substitute", "Approve", "Deliver", "Arrived"];

orderRoutes.post("/orders/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (!CANCELLABLE_STAGES.includes(order.stage as string)) {
    return c.json({ error: "invalid_stage", message: `Cannot cancel from stage ${order.stage}` }, 409);
  }

  await db.execute({
    sql: "INSERT OR IGNORE INTO order_rider_exclusions (order_id, rider_id) VALUES (?, ?)",
    args: [id, user.sub],
  });

  // Money already collected? Skip back to "Match" (needs a new rider only) —
  // rewinding all the way to "Create" would re-expose the funding step and
  // risk a double charge. Otherwise a full "Create" rewind is safe.
  const paid = await db.execute({
    sql: "SELECT id FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful' LIMIT 1",
    args: [id],
  });
  const nextStage = paid.rows.length > 0 ? "Match" : "Create";

  if (order.stage === "Arrived") await closeWaiting(order, user.sub);

  await touchOrder(id, { rider_id: null, stage: nextStage, matched_out_of_range: 0, rider_departed_at: null, rider_arrived_at: null, waiting_closed_at: null });
  await db.execute({ sql: "DELETE FROM rider_order_locks WHERE rider_id = ? AND order_id = ?", args: [user.sub, id] });
  await logEvent(id, nextStage, "Rider cancelled — order returned to the job pool", user.sub);

  return c.json({ order: await getOrder(id) });
});

// ---------------------------------------------------------------------------
// Customer-initiated cancel/delete — only while nothing has actually
// happened yet: no rider assigned (which also means no money has been
// collected, since funding only ever follows a rider being matched). Once
// a rider's attached, backing out affects someone else's day and goes
// through support instead of a self-service button.
// ---------------------------------------------------------------------------

const CUSTOMER_CANCELLABLE_STAGES = ["Create", "Match"];

function assertCustomerCancellable(order: Row) {
  if (order.rider_id || !CUSTOMER_CANCELLABLE_STAGES.includes(order.stage as string)) {
    throw new HttpError(409, "This order is already being processed — contact support if you need to cancel it");
  }
}

orderRoutes.post("/orders/:id/customer-cancel", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: "cannot_cancel", message: e.message }, e.status);
    throw e;
  }

  const parsed = z.object({ acceptedFee: z.number().int().nonnegative().default(0) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const result = await cancelCustomerOrder(order, user.sub, parsed.data.acceptedFee);
  if (result.error) return c.json({ error: "cannot_cancel", message: result.error }, 409);

  return c.json({ order: await getOrder(id) });
});

/** Same eligibility as cancel, plus it drops off the customer's own
 * "Lists" view — the row (and its list) stay in the database for support/
 * admin visibility, never hard-deleted. */
orderRoutes.post("/orders/:id/customer-delete", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
    assertCustomerCancellable(order);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: "cannot_delete", message: e.message }, e.status);
    throw e;
  }

  await touchOrder(id, { stage: "Cancelled" });
  await db.execute({
    sql: "UPDATE lists SET status = 'cancelled', customer_hidden = 1, updated_at = datetime('now') WHERE id = ?",
    args: [order.list_id as string],
  });
  await logEvent(id, "Cancelled", "Deleted by customer", user.sub);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Fund (escrow via mobile money collection, or float)
// ---------------------------------------------------------------------------

const fundSchema = z
  .object({
    paymentMethod: z.enum(["mobile_money", "wallet", "cash"]).optional(),
    acceptedAmount: z.number().nonnegative().optional(),
    msisdn: z.string().min(6).max(20).optional(),
    useWallet: z.boolean().optional(),
    // Pay from someone else's wallet instead of your own — only valid
    // when that owner has an active wallet_shares grant to this customer.
    walletOwnerId: z.string().optional(),
    // Which of the (possibly shared) owner's wallets to pay from —
    // omitted or "primary" means their original wallet.
    walletId: z.string().optional(),
  })
  .refine((data) => data.paymentMethod === "cash" || !!data.msisdn || !!data.useWallet, { message: "Provide a mobile money number or pay from wallet" })
  .refine((data) => !data.paymentMethod || data.paymentMethod === "cash" ||
    (data.paymentMethod === "wallet" ? data.useWallet === true : !data.useWallet && !!data.msisdn),
    { message: "The payment details must match the selected method" });

orderRoutes.get("/orders/:id/checkout", async (c) => {
  const order = await getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== c.get("user").sub) return c.json({ error: "forbidden" }, 403);
  const baseAmount = Number(order.final_total ?? order.estimated_total ?? 0);
  const settings = await getMonetizationSettings();
  const input = { baseAmount, deliveryFee: Number(order.delivery_fee ?? 0), orderType: order.type as "parcel" | "shopping" };
  return c.json({
    baseAmount,
    mobileMoney: baseAmount + computeCheckoutFees(settings, { ...input, payingWithWallet: false }).totalSurcharge,
    wallet: baseAmount + computeCheckoutFees(settings, { ...input, payingWithWallet: true }).totalSurcharge,
    cash: baseAmount,
  });
});

orderRoutes.post("/orders/:id/fund", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage !== "Match") {
    return c.json({ error: "invalid_stage", message: `Cannot fund from stage ${order.stage}` }, 409);
  }

  // final_total is set the moment a fee proposal or item substitution is
  // approved — charge that when present so an accepted pre-funding fee
  // change is actually what gets collected, not the original estimate.
  const baseAmount = (order.final_total as number | null) ?? (order.estimated_total as number | null) ?? 0;

  const body = await c.req.json().catch(() => ({}));
  const parsed = fundSchema.safeParse(order.payment_rail === "float" && !body?.paymentMethod ? { ...body, paymentMethod: "cash" } : body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (!order.rider_id) return c.json({ error: "invalid_stage", message: "Please select a rider before confirming payment." }, 409);

  if (parsed.data.paymentMethod === "cash") {
    // Float rail: the customer hands the rider the full cash amount —
    // items, delivery fee, and the platform's own cut all together, same
    // as if nothing about monetization existed. The platform's share of
    // that cash is a debt the rider now owes Peebee, not something collected
    // here — see POST /orders/:id/settle, which computes it and notifies
    // the rider once the order actually completes (the fee only makes
    // sense once the final total is locked in).
    if (parsed.data.acceptedAmount != null && parsed.data.acceptedAmount !== baseAmount) {
      return c.json({ error: "amount_changed", message: "The total has changed. Review the updated amount before continuing." }, 409);
    }
    const confirmed = await db.execute({
      sql: "UPDATE orders SET payment_rail = 'float', stage = 'Shop', updated_at = datetime('now') WHERE id = ? AND stage = 'Match' AND rider_id = ? AND COALESCE(final_total, estimated_total, 0) = ? AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND status IN ('pending', 'unknown', 'successful'))",
      args: [id, String(order.rider_id), baseAmount, id],
    });
    if (!confirmed.rowsAffected) return c.json({ error: "invalid_stage", message: "This order has changed. Refresh before continuing." }, 409);
    await logEvent(id, "Fund", "Cash rail — rider collects full payment from the customer on delivery", user.sub);
    return c.json({ order: await getOrder(id), funded: true, rail: "float" });
  }

  // Fee breakdown is computed once, here, and persisted — Settle reads it
  // back rather than recomputing against whatever the admin-configured
  // rates happen to be by the time the order settles. See
  // ../lib/monetization.ts.
  const monetizationSettings = await getMonetizationSettings();
  const fees = computeCheckoutFees(monetizationSettings, {
    baseAmount,
    deliveryFee: (order.delivery_fee as number | null) ?? 0,
    orderType: order.type as "parcel" | "shopping",
    payingWithWallet: !!parsed.data.useWallet,
  });
  const amount = baseAmount + fees.totalSurcharge;
  if (parsed.data.acceptedAmount != null && parsed.data.acceptedAmount !== amount) {
    return c.json({ error: "amount_changed", message: "The total has changed. Review the updated amount before paying." }, 409);
  }
  const hasFees = fees.serviceFee > 0 || fees.processingFeeCustomer > 0 || fees.processingFeeRider > 0 || fees.deliveryCommission > 0;
  if (hasFees) {
    await db.execute({
      sql: `INSERT INTO order_fees (order_id, service_fee, processing_fee_customer, processing_fee_rider, delivery_commission)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
              service_fee = excluded.service_fee, processing_fee_customer = excluded.processing_fee_customer,
              processing_fee_rider = excluded.processing_fee_rider, delivery_commission = excluded.delivery_commission`,
      args: [id, fees.serviceFee, fees.processingFeeCustomer, fees.processingFeeRider, fees.deliveryCommission],
    });
  }

  if (parsed.data.useWallet) {
    const walletId = !parsed.data.walletId || parsed.data.walletId === "primary" ? undefined : parsed.data.walletId;
    let walletOwnerId = user.sub;
    if (parsed.data.walletOwnerId && parsed.data.walletOwnerId !== user.sub) {
      const share = await db.execute({
        sql: `SELECT 1 FROM wallet_shares WHERE owner_id = ? AND grantee_id = ? AND status = 'active'
              AND wallet_id ${walletId ? "= ?" : "IS NULL"}`,
        args: walletId ? [parsed.data.walletOwnerId, user.sub, walletId] : [parsed.data.walletOwnerId, user.sub],
      });
      if (share.rows.length === 0) return c.json({ error: "wallet_not_shared" }, 403);
      walletOwnerId = parsed.data.walletOwnerId;
    } else if (walletId) {
      // Paying from one of your own secondary wallets — ownership check.
      const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [walletId, user.sub] });
      if (owned.rows.length === 0) return c.json({ error: "not_found", message: "That wallet doesn't exist" }, 404);
    }
    const sharedSpend = walletOwnerId !== user.sub;

    // Reserve funding before debiting; cancellation and duplicate funding
    // requests cannot race a wallet payment.
    const funding = await db.execute({ sql: "UPDATE orders SET payment_rail = 'escrow', stage = 'Fund', updated_at = datetime('now') WHERE id = ? AND stage = 'Match' AND rider_id = ? AND COALESCE(final_total, estimated_total, 0) = ? AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND status IN ('pending', 'unknown', 'successful'))", args: [id, String(order.rider_id), baseAmount, id] });
    if (!funding.rowsAffected) return c.json({ error: "invalid_stage", message: "This order has changed. Refresh before paying." }, 409);

    const paymentId = await payFromWallet({
      userId: walletOwnerId,
      amount,
      orderId: id,
      note: `Order ${id}`,
      actorId: sharedSpend ? user.sub : undefined,
      environment: order.environment as "live" | "sandbox",
      walletId,
    });
    if (!paymentId) {
      await db.execute({ sql: "UPDATE orders SET stage = 'Match' WHERE id = ? AND stage = 'Fund'", args: [id] });
      return c.json({ error: "insufficient_wallet_balance" }, 409);
    }

    await touchOrder(id, { stage: "Shop" });
    await activateMerchantAllocationsForFundedOrder(id);
    await logEvent(id, "Fund", sharedSpend ? "Paid from a shared wallet — shopping started" : "Paid from wallet — shopping started", user.sub);
    return c.json({ order: await getOrder(id), payment: { id: paymentId, status: "successful", network: null } });
  }

  const paymentId = newId("pay");
  const fundingToken = newId("fund");
  const funding = await executeBatch([
    { sql: "UPDATE orders SET payment_rail = 'escrow', stage = 'Fund', time_action_token = ?, updated_at = datetime('now') WHERE id = ? AND stage = 'Match' AND rider_id = ? AND COALESCE(final_total, estimated_total, 0) = ? AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND status IN ('pending', 'unknown', 'successful'))", args: [fundingToken, id, String(order.rider_id), baseAmount, id] },
    {
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, msisdn, amount, currency, status)
            SELECT ?, id, 'collection', 'unassigned', NULL, ?, ?, 'UGX', 'pending' FROM orders WHERE id = ? AND time_action_token = ?`,
      args: [paymentId, parsed.data.msisdn ?? null, amount, id, fundingToken],
    },
  ]);
  if (!funding[0]) return c.json({ error: "invalid_stage", message: "This order has changed. Refresh before paying." }, 409);
  let providerRef: string;
  let network: MobileMoneyNetwork | null;
  let provider: string;
  let redirectUrl: string | undefined;
  try {
    const initiated = await initiateCollection({
      referenceId: paymentId,
      msisdn: parsed.data.msisdn,
      amount,
      name: user.name,
      returnUrl: paymentReturnUrl(id),
      forceMock: order.environment === "sandbox",
    });
    providerRef = initiated.providerRef;
    network = initiated.network;
    provider = initiated.provider;
    redirectUrl = initiated.redirectUrl;
  } catch (err) {
    await executeBatch([
      { sql: "UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id = ?", args: [paymentId] },
      { sql: "UPDATE orders SET stage = 'Match', updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'", args: [id] },
    ]);
    if (err instanceof UnsupportedNetworkError) {
      return c.json({ error: "unsupported_network", message: err.message }, 400);
    }
    console.error("Escrow collection request failed:", err);
    return c.json(
      paymentProviderErrorResponse(err, "Couldn't reach mobile money just now. Please try again."),
      paymentProviderHttpStatus(err),
    );
  }

  try {
    await executeBatch([
      {
        sql: "UPDATE payments SET provider = ?, provider_ref = ?, network = ?, updated_at = datetime('now') WHERE id = ?",
        args: [provider, providerRef, network, paymentId],
      },
      {
        sql: `INSERT INTO provider_operations
              (id, operation_type, business_type, business_id, provider, provider_ref,
               idempotency_key, amount, environment, status, next_check_at)
              VALUES (?, 'collection', 'payment', ?, ?, ?, ?, ?, ?, 'submitted', datetime('now', '+2 minutes'))`,
        args: [newId("pop"), paymentId, provider, providerRef, `payment:${paymentId}:collection`, amount, order.environment],
      },
    ]);
  } catch (error) {
    // The provider already accepted this collection. Preserve the reference
    // and reconciliation job with best-effort idempotent writes; never put
    // the order back at Match, which would invite a duplicate charge.
    console.error("Collection accepted by provider but atomic persistence failed", paymentId, providerRef, error);
    const paymentSaved = await db.execute({
      sql: "UPDATE payments SET provider = ?, provider_ref = ?, network = ?, updated_at = datetime('now') WHERE id = ?",
      args: [provider, providerRef, network, paymentId],
    }).then(() => true).catch(() => false);
    const operationSaved = await db.execute({
      sql: `INSERT OR IGNORE INTO provider_operations
            (id, operation_type, business_type, business_id, provider, provider_ref,
             idempotency_key, amount, environment, status, next_check_at)
            VALUES (?, 'collection', 'payment', ?, ?, ?, ?, ?, ?, 'unknown', datetime('now', '+2 minutes'))`,
      args: [newId("pop"), paymentId, provider, providerRef, `payment:${paymentId}:collection`, amount, String(order.environment)],
    }).then(() => true).catch(() => false);
    if (!paymentSaved || !operationSaved) {
      return c.json({
        error: "collection_status_uncertain",
        message: "The payment request was submitted and may still complete. Do not retry it; support can reconcile this order.",
      }, 502);
    }
  }
  await logEvent(
    id,
    "Fund",
    network ? `${mobileMoneyNetworkLabel(network)} collection requested` : "Collection requested",
    user.sub,
  );

  return c.json({
    order: await getOrder(id),
    payment: { id: paymentId, status: "pending", network },
    redirectUrl,
  });
});

// ---------------------------------------------------------------------------
// Shop / Substitute / Approve
// ---------------------------------------------------------------------------

const substituteSchema = z.object({
  itemId: z.string().optional(),
  originalName: z.string().min(1).max(120),
  substituteName: z.string().min(1).max(120),
  priceDelta: z.number().int().default(0),
});

orderRoutes.post("/orders/:id/substitutions", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage !== "Shop" && order.stage !== "Substitute") {
    return c.json({ error: "invalid_stage", message: `Cannot propose substitution from stage ${order.stage}` }, 409);
  }

  const parsed = substituteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const subId = newId("sub");
  await db.execute({
    sql: `INSERT INTO substitutions (id, order_id, item_id, original_name, substitute_name, price_delta)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [subId, id, parsed.data.itemId ?? null, parsed.data.originalName, parsed.data.substituteName, parsed.data.priceDelta],
  });
  await touchOrder(id, { stage: "Substitute" });
  await logEvent(id, "Substitute", `Proposed: ${parsed.data.originalName} → ${parsed.data.substituteName}`, user.sub);

  return c.json({ substitution: subId }, 201);
});

const batchSubstituteSchema = z.object({
  changes: z
    .array(
      z.object({
        itemId: z.string().optional(),
        originalName: z.string().min(1).max(120),
        substituteName: z.string().min(1).max(120),
        priceDelta: z.number().int().default(0),
      }),
    )
    .min(1)
    .max(50),
});

/** Same as POST /substitutions, but for several items at once — one review for the customer instead of many. */
orderRoutes.post("/orders/:id/substitutions/batch", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage !== "Shop" && order.stage !== "Substitute") {
    return c.json({ error: "invalid_stage", message: `Cannot propose changes from stage ${order.stage}` }, 409);
  }

  const parsed = batchSubstituteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const batchId = newId("batch");
  for (const change of parsed.data.changes) {
    await db.execute({
      sql: `INSERT INTO substitutions (id, order_id, item_id, original_name, substitute_name, price_delta, batch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [newId("sub"), id, change.itemId ?? null, change.originalName, change.substituteName, change.priceDelta, batchId],
    });
  }
  await touchOrder(id, { stage: "Substitute" });
  const netDelta = parsed.data.changes.reduce((sum, ch) => sum + ch.priceDelta, 0);
  await logEvent(
    id,
    "Substitute",
    `Proposed ${parsed.data.changes.length} change(s) for approval (${netDelta >= 0 ? "+" : ""}${netDelta})`,
    user.sub,
  );

  return c.json({ batchId, order: await getOrder(id) }, 201);
});

orderRoutes.post("/orders/:id/substitutions/batch/:batchId/decision", async (c) => {
  const id = c.req.param("id");
  const batchId = c.req.param("batchId");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const parsed = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const batchRes = await db.execute({
    sql: "SELECT * FROM substitutions WHERE order_id = ? AND batch_id = ? AND status = 'pending'",
    args: [id, batchId],
  });
  const rows = batchRes.rows as Row[];
  if (rows.length === 0) return c.json({ error: "not_found" }, 404);

  const status = parsed.data.approve ? "approved" : "rejected";
  await db.execute({
    sql: "UPDATE substitutions SET status = ?, updated_at = datetime('now') WHERE order_id = ? AND batch_id = ?",
    args: [status, id, batchId],
  });

  if (parsed.data.approve) {
    const netDelta = rows.reduce((sum, r) => sum + ((r.price_delta as number) ?? 0), 0);
    if (netDelta) {
      const currentTotal = (order.final_total as number | null) ?? (order.estimated_total as number | null) ?? 0;
      await touchOrder(id, { final_total: currentTotal + netDelta });
    }
  }

  await logEvent(id, "Approve", `Batch of ${rows.length} change(s) ${status}`, user.sub);

  const remaining = await db.execute({
    sql: "SELECT COUNT(*) as n FROM substitutions WHERE order_id = ? AND status = 'pending'",
    args: [id],
  });
  if ((remaining.rows[0]?.n as number) === 0) {
    await touchOrder(id, { stage: "Approve" });
  }

  return c.json({ order: await getOrder(id) });
});

const decisionSchema = z.object({ approve: z.boolean() });

orderRoutes.post("/orders/:id/substitutions/:subId/decision", async (c) => {
  const id = c.req.param("id");
  const subId = c.req.param("subId");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const parsed = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const subRes = await db.execute({ sql: "SELECT * FROM substitutions WHERE id = ? AND order_id = ?", args: [subId, id] });
  const sub = subRes.rows[0];
  if (!sub) return c.json({ error: "not_found" }, 404);

  const status = parsed.data.approve ? "approved" : "rejected";
  await db.execute({
    sql: "UPDATE substitutions SET status = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, subId],
  });

  if (parsed.data.approve && sub.price_delta) {
    const currentTotal = (order.final_total as number | null) ?? (order.estimated_total as number | null) ?? 0;
    await touchOrder(id, { final_total: currentTotal + (sub.price_delta as number) });
  }

  await logEvent(id, "Approve", `Substitution ${status}: ${sub.substitute_name}`, user.sub);

  const remaining = await db.execute({
    sql: "SELECT COUNT(*) as n FROM substitutions WHERE order_id = ? AND status = 'pending'",
    args: [id],
  });
  if ((remaining.rows[0]?.n as number) === 0) {
    await touchOrder(id, { stage: "Approve" });
  }

  return c.json({ order: await getOrder(id) });
});

// ---------------------------------------------------------------------------
// Fee proposals — rider suggests a different total than the auto-calculated
// (or customer-entered) one; customer accepts or rejects it.
// ---------------------------------------------------------------------------

const proposeFeeSchema = z.object({
  proposedTotal: z.number().int().nonnegative(),
  reason: z.string().max(240).optional(),
});

orderRoutes.post("/orders/:id/fee-proposals", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage === "Create" || order.stage === "Settle") {
    return c.json({ error: "invalid_stage", message: `Cannot propose a fee from stage ${order.stage}` }, 409);
  }

  const parsed = proposeFeeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const previousTotal = (order.final_total as number | null) ?? (order.estimated_total as number | null) ?? 0;
  const proposedTotal = order.type === "parcel" ? roundFare(parsed.data.proposedTotal) : parsed.data.proposedTotal;
  const proposalId = newId("fee");
  await db.execute({
    sql: `INSERT INTO fee_proposals (id, order_id, previous_total, proposed_total, reason)
          VALUES (?, ?, ?, ?, ?)`,
    args: [proposalId, id, previousTotal, proposedTotal, parsed.data.reason ?? null],
  });
  await logEvent(
    id,
    order.stage as string,
    `Rider suggested a new total: ${formatAmount(proposedTotal)} (was ${formatAmount(previousTotal)})`,
    user.sub,
  );

  return c.json({ proposalId, order: await getOrder(id) }, 201);
});

orderRoutes.post("/orders/:id/fee-proposals/:proposalId/decision", async (c) => {
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const parsed = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const propRes = await db.execute({
    sql: "SELECT * FROM fee_proposals WHERE id = ? AND order_id = ? AND status = 'pending'",
    args: [proposalId, id],
  });
  const proposal = propRes.rows[0] as Row | undefined;
  if (!proposal) return c.json({ error: "not_found" }, 404);

  const status = parsed.data.approve ? "approved" : "rejected";
  await db.execute({
    sql: "UPDATE fee_proposals SET status = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, proposalId],
  });

  if (parsed.data.approve) {
    await touchOrder(id, {
      final_total: proposal.proposed_total,
      ...(order.type === "parcel" ? { delivery_fee: proposal.proposed_total } : {}),
    });
  }
  await logEvent(
    id,
    order.stage as string,
    `Fee suggestion ${status}${parsed.data.approve ? ` — new total ${formatAmount(proposal.proposed_total as number)}` : ""}`,
    user.sub,
  );

  return c.json({ order: await getOrder(id) });
});

// A rider explaining a fee bump may not be comfortable typing it in
// English — this carries the reason as raw audio instead of transcribing
// it, since transcription of a non-English recording just produces
// gibberish text (see the order-level voice-note handling above, same
// reasoning). Sent as its own request right after the proposal is
// created, since the proposal itself is JSON and this is multipart.
orderRoutes.post("/orders/:id/fee-proposals/:proposalId/voice-note", async (c) => {
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }

  const propRes = await db.execute({
    sql: "SELECT id FROM fee_proposals WHERE id = ? AND order_id = ?",
    args: [proposalId, id],
  });
  if (!propRes.rows[0]) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return c.json({ error: "missing_audio" }, 400);
  if (!ALLOWED_VOICE_NOTE_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
  if (file.size > MAX_VOICE_NOTE_BYTES) return c.json({ error: "file_too_large" }, 400);

  const ext = extensionForMime(file.type, "webm");
  const key = `orders/${id}/fee-proposals/${proposalId}/voice-note.${ext}`;
  const bucket = getR2Bucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  await db.execute({
    sql: "UPDATE fee_proposals SET reason_voice_key = ?, updated_at = datetime('now') WHERE id = ?",
    args: [key, proposalId],
  });

  return c.json({ order: await getOrder(id) });
});

orderRoutes.get("/orders/:id/fee-proposals/:proposalId/voice-note", async (c) => {
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const propRes = await db.execute({
    sql: "SELECT reason_voice_key FROM fee_proposals WHERE id = ? AND order_id = ?",
    args: [proposalId, id],
  });
  const key = (propRes.rows[0] as Row | undefined)?.reason_voice_key as string | null | undefined;
  if (!key) return c.json({ error: "not_found" }, 404);

  const bucket = getR2Bucket();
  const object = await bucket.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: uploadResponseHeaders(object.httpMetadata?.contentType, "audio/webm"),
  });
});

// ---------------------------------------------------------------------------
// Deliver / Handover / Settle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Live rider location — powers the customer-facing tracking map (see
// apps/customer/components/LiveTrackingMap.tsx). Only ever called by the
// rider app's InAppNavigation while nav_mode = "in_app" (see
// apps/api/src/lib/settings.ts getNavMode); pings land here every few
// seconds while a job is open, so this deliberately writes straight to
// the row rather than going through touchOrder — bumping updated_at on
// every GPS tick would make "last updated" misleading everywhere else
// the field is used (admin order lists, etc).
// ---------------------------------------------------------------------------

const orderLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

orderRoutes.post("/orders/:id/location", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (["Settle", "Create"].includes(order.stage as string)) {
    return c.json({ error: "invalid_stage", message: `No active journey to track at stage ${order.stage}` }, 409);
  }

  const parsed = orderLocationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  await db.execute({
    sql: "UPDATE orders SET rider_lat = ?, rider_lng = ?, rider_location_updated_at = datetime('now') WHERE id = ?",
    args: [parsed.data.lat, parsed.data.lng, id],
  });

  return c.json({ ok: true });
});

const deliverSchema = z.object({ etaMinutes: z.number().int().positive().optional() });

orderRoutes.post("/orders/:id/deliver", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (!["Shop", "Substitute", "Approve"].includes(order.stage as string)) {
    return c.json({ error: "invalid_stage", message: `Cannot start delivery from stage ${order.stage}` }, 409);
  }

  const parsed = deliverSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  if (order.type === "shopping" && order.funds_model === "merchant_allocations_v1") {
    const allocation = await db.execute({
      sql: `SELECT b.principal_funded, b.principal_allocated,
                   (SELECT COUNT(*) FROM merchant_payments mp
                    WHERE mp.order_id=b.order_id AND mp.status='awaiting_confirmation') AS awaiting
            FROM order_budgets b WHERE b.order_id = ?`,
      args: [id],
    });
    const budget = allocation.rows[0] as Row | undefined;
    if (!budget || Number(budget.principal_allocated) <= 0) {
      return c.json({
        error: "merchant_purchase_required",
        message: "Record at least one confirmed merchant purchase before starting delivery.",
      }, 409);
    }
    if (Number(budget.awaiting) > 0) {
      return c.json({
        error: "merchant_confirmation_pending",
        message: "A merchant payment is still waiting for the shop to confirm the amount.",
      }, 409);
    }
  }

  const pin = (order.pin_code as string | null) ?? newPin();
  const departed = await db.execute({
    sql: "UPDATE orders SET stage = 'Deliver', eta_minutes = ?, pin_code = ?, rider_departed_at = ?, updated_at = datetime('now') WHERE id = ? AND rider_id = ? AND stage = ?",
    args: [parsed.data.etaMinutes ?? order.eta_minutes ?? 15, pin, new Date().toISOString(), id, user.sub, String(order.stage)] as InArgs,
  });
  if (!departed.rowsAffected) return c.json({ error: "invalid_stage", message: "This journey has changed. Refresh the order." }, 409);
  await logEvent(id, "Deliver", "Rider en route", user.sub);

  return c.json({ order: await getOrder(id) });
});

/** The rider's own "I've arrived" tap — a distinct signal from starting
 * delivery, so the customer gets a fresh notification right when it
 * matters instead of just once, back when the rider set off. */
orderRoutes.post("/orders/:id/arrived", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage !== "Deliver") {
    return c.json({ error: "invalid_stage", message: `Cannot mark arrived from stage ${order.stage}` }, 409);
  }

  const arrived = await db.execute({
    sql: "UPDATE orders SET stage = 'Arrived', rider_arrived_at = ?, waiting_closed_at = NULL, updated_at = datetime('now') WHERE id = ? AND rider_id = ? AND stage = 'Deliver'",
    args: [new Date().toISOString(), id, user.sub],
  });
  if (!arrived.rowsAffected) return c.json({ error: "invalid_stage", message: "This journey has changed. Refresh the order." }, 409);
  await logEvent(id, "Arrived", "Rider arrived", user.sub);

  if (order.customer_id) {
    background(
      c,
      notifyUser(order.customer_id as string, {
        title: order.is_ride ? "Your rider is here" : "Your rider has arrived",
        body: order.is_ride
          ? `${user.name || "Your rider"} is here to pick you up.`
          : `${user.name || "Your rider"} is here with your ${order.type === "parcel" ? "parcel" : "order"}.`,
        url: `/orders/${id}`,
        tag: `order-${id}`,
      }),
    );
  }

  return c.json({ order: await getOrder(id) });
});

/** A ride's second leg: the rider confirms the passenger is aboard and
 * they're now heading to the destination. Goods parcels and shopping
 * orders skip straight from Arrived to Handover — only a ride has someone
 * physically waiting to be collected before the trip itself begins. */
orderRoutes.post("/orders/:id/picked-up", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertRider(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (!order.is_ride) {
    return c.json({ error: "not_a_ride", message: "Only ride orders have a pickup confirmation step" }, 409);
  }
  if (order.stage !== "Arrived") {
    return c.json({ error: "invalid_stage", message: `Cannot confirm pickup from stage ${order.stage}` }, 409);
  }

  if (!await finishWaiting(order, "PickedUp", user.sub)) return c.json({ error: "invalid_stage" }, 409);
  await logEvent(id, "PickedUp", "Passenger picked up, heading to destination", user.sub);

  if (order.customer_id) {
    background(
      c,
      notifyUser(order.customer_id as string, {
        title: "You're on your way",
        body: `${user.name || "Your rider"} has picked you up and is heading to your destination.`,
        url: `/orders/${id}`,
        tag: `order-${id}`,
      }),
    );
  }

  return c.json({ order: await getOrder(id) });
});

const handoverSchema = z.object({ pin: z.string().length(4) });

orderRoutes.post("/orders/:id/handover", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (!["Deliver", "Arrived", "PickedUp"].includes(order.stage as string)) {
    return c.json({ error: "invalid_stage", message: `Cannot hand over from stage ${order.stage}` }, 409);
  }

  const parsed = handoverSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  if (parsed.data.pin !== order.pin_code) {
    return c.json({ error: "pin_mismatch" }, 400);
  }

  if (!await finishWaiting(order, "Handover", user.sub)) return c.json({ error: "invalid_stage" }, 409);
  await logEvent(id, "Handover", "PIN confirmed, handover complete", user.sub);

  return c.json({ order: await getOrder(id) });
});

// Settling is the rider's own confirmation that the job is done — the
// customer already gave theirs by entering the handover PIN. Requiring both
// before any money moves is the whole point of escrow: nothing releases
// from it until each side has confirmed. Escrow proceeds are credited to
// the rider's in-app wallet here rather than wired out immediately; they
// withdraw to mobile money separately, whenever they want. Cash-rail jobs
// have nothing to release — the rider already holds the cash — so this
// just closes the job out.
orderRoutes.post("/orders/:id/settle", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden", message: "Only the assigned rider can settle this order" }, 403);
  }
  if (order.stage !== "Handover") {
    return c.json({ error: "invalid_stage", message: `Cannot settle from stage ${order.stage}` }, 409);
  }

  const total = (order.final_total as number | null) ?? (order.estimated_total as number | null) ?? 0;

  let released = 0;
  let payout = 0;
  if (order.payment_rail === "escrow" && order.rider_id) {
    // Release only what escrow actually holds, never `final_total`. An
    // approved fee proposal or substitution raises `final_total` after the
    // collection has already happened, with no top-up charged — paying that
    // out would hand the rider money the platform never received, which is
    // exactly the hole a rider colluding with a throwaway customer account
    // would mint from. Anything agreed above what was collected is a debt to
    // settle out of band, so it's logged rather than silently paid.
    const collectedRes = await db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) as collected FROM payments
            WHERE order_id = ? AND type = 'collection' AND status = 'successful'`,
      args: [id],
    });
    released = Number((collectedRes.rows[0] as Row)?.collected ?? 0);

    // Whatever monetization fees were locked in at Fund time (see
    // ../lib/monetization.ts) come out of the rider's payout here — never
    // recomputed against today's rates, so a mid-order rate change can't
    // retroactively change what this order owes the rider.
    const feesRes = await db.execute({ sql: "SELECT * FROM order_fees WHERE order_id = ?", args: [id] });
    const feesRow = feesRes.rows[0] as Row | undefined;
    if (order.funds_model === "merchant_allocations_v1") {
      const deliveryFee = Number(order.delivery_fee ?? 0);
      const deliveryCommission = Number(feesRow?.delivery_commission ?? 0);
      const riderProcessing = Number(feesRow?.processing_fee_rider ?? 0);
      payout = Math.max(0, deliveryFee - deliveryCommission - riderProcessing);
      const refunded = await refundUnusedOrderPrincipal(id, user.sub);
      await settleMerchantOrderFinancials({ orderId: id, actorId: user.sub, riderPayout: payout });
      if (refunded > 0) {
        await logEvent(id, "Settle", `${formatAmount(refunded)} unused shopping principal returned to the customer wallet`, user.sub);
      }
    } else {
      payout = feesRow
        ? riderPayout(released, {
            serviceFee: Number(feesRow.service_fee) || 0,
            processingFeeCustomer: Number(feesRow.processing_fee_customer) || 0,
            processingFeeRider: Number(feesRow.processing_fee_rider) || 0,
            deliveryCommission: Number(feesRow.delivery_commission) || 0,
            totalSurcharge: (Number(feesRow.service_fee) || 0) + (Number(feesRow.processing_fee_customer) || 0),
          })
        : released;

      // A car ride's pool is shared between its owner, driver and the
      // platform instead of going to a rider's wallet (see car/service.ts).
      if (payout > 0 && (await isCarOrder(id))) {
        await settleCarBooking(order, payout, user.sub);
      } else if (payout > 0) {
        const balanceColumn = order.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
        await db.execute({
          sql: `UPDATE riders SET ${balanceColumn} = ${balanceColumn} + ?, updated_at = datetime('now') WHERE user_id = ?`,
          args: [payout, order.rider_id as string],
        });
      }
    }
    if (released < total) {
      await logEvent(
        id,
        "Settle",
        `Shortfall — ${formatAmount(total - released)} of the agreed total was never collected into escrow and was not paid out`,
        user.sub,
      );
    }
    if (feesRow && payout < released) {
      await logEvent(
        id,
        "Settle",
        `Platform fees withheld — ${formatAmount(released - payout)} of ${formatAmount(released)} collected (commission/processing/service fees)`,
        user.sub,
      );
    }
  }

  // Cash rail: the customer already handed the rider the full amount in
  // person, platform cut included — so that cut comes straight back out of
  // the rider's own wallet balance here, the same balance their escrow
  // payouts land in. Deliberately allowed to go negative (unlike a normal
  // withdrawal, which respects the admin-set reserve floor): this isn't
  // the rider spending their own money, it's Peebee collecting what it's
  // owed, and it eats into the reserve before anything else would. A
  // negative balance then nets against their very next payout automatically
  // — no separate "debt" to track or pay off, and POST /wallet/withdraw's
  // existing `balance <= 0` check already blocks withdrawing while in the
  // red, so there's nothing extra to enforce either. Computed fresh here
  // against the FINAL settled total (not locked in at Fund time the way
  // escrow's is) since cash changes hands only once, at the very end.
  let cashOwed = 0;
  if (order.payment_rail === "float" && order.rider_id) {
    const monetizationSettings = await getMonetizationSettings();
    const fees = computeCheckoutFees(monetizationSettings, {
      baseAmount: total,
      deliveryFee: (order.delivery_fee as number | null) ?? 0,
      orderType: order.type as "parcel" | "shopping",
      payingWithWallet: false,
    });
    cashOwed = fees.totalSurcharge + fees.deliveryCommission + fees.processingFeeRider;

    if (cashOwed > 0) {
      const balanceColumn = order.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
      await db.execute({
        sql: `UPDATE riders SET ${balanceColumn} = ${balanceColumn} - ?, updated_at = datetime('now') WHERE user_id = ?`,
        args: [cashOwed, order.rider_id as string],
      });
      await notifyUser(order.rider_id as string, {
        title: "Platform fee deducted from a cash order",
        body: `${formatAmount(cashOwed)} from this delivery came out of your wallet — check your balance.`,
        tag: `cash-fee-${id}`,
        url: "/wallet",
      }).catch(() => {});
    }
  }

  await touchOrder(id, { stage: "Settle", final_total: total });
  await db.execute({
    sql: "UPDATE lists SET status = 'delivered', updated_at = datetime('now') WHERE id = ?",
    args: [order.list_id as string],
  });
  await logEvent(
    id,
    "Settle",
    order.payment_rail === "escrow"
      ? `Order settled — ${formatAmount(payout)} released to rider wallet`
      : cashOwed > 0
        ? `Order settled — rider collected cash, owes ${formatAmount(cashOwed)} platform fee`
        : "Order settled",
    user.sub,
  );

  return c.json({ order: await getOrder(id) });
});

// ---------------------------------------------------------------------------
// Rating — customer rates the rider once an order is delivered
// ---------------------------------------------------------------------------

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
  recommended: z.boolean().optional().default(false),
});

orderRoutes.post("/orders/:id/rate", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  try {
    assertCustomer(order, user.sub);
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    throw e;
  }
  if (order.stage !== "Settle") {
    return c.json({ error: "invalid_stage", message: "Can only rate a delivered order" }, 409);
  }
  if (!order.rider_id) {
    return c.json({ error: "no_rider" }, 409);
  }

  const parsed = rateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const existing = await db.execute({ sql: "SELECT id FROM order_ratings WHERE order_id = ?", args: [id] });
  if (existing.rows.length > 0) {
    return c.json({ error: "already_rated" }, 409);
  }

  await db.execute({
    sql: `INSERT INTO order_ratings (id, order_id, customer_id, rider_id, rating, comment, recommended) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId("rat"),
      id,
      user.sub,
      order.rider_id as string,
      parsed.data.rating,
      parsed.data.comment ?? null,
      parsed.data.recommended ? 1 : 0,
    ],
  });
  await db.execute({
    sql: `UPDATE riders SET rating = (SELECT AVG(rating) FROM order_ratings WHERE rider_id = ?), updated_at = datetime('now') WHERE user_id = ?`,
    args: [order.rider_id as string, order.rider_id as string],
  });

  return c.json({
    ok: true,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? null,
    recommended: parsed.data.recommended,
  });
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * The full conversation with this order's rider, not just this one order's
 * slice of it — a customer and rider who've shared several orders see one
 * continued thread, the way the messaging in any app they'd recognize
 * works. Falls back to just this order's own (likely empty) messages when
 * there's no rider assigned yet to pair with.
 */
/**
 * Loads a thread's full message history and, as a side effect, marks
 * anything the other party sent as delivered — the app's stand-in for "this
 * reached the recipient's device," since fetching the thread is the closest
 * signal available. Combined with `read` (derived from chat_reads, set when
 * the recipient's client calls POST .../chat/read), that's the full
 * sent → delivered → read progression the tick UI renders.
 *
 * Only meaningful when the viewer is actually one of the two participants —
 * an admin browsing a thread doesn't move anyone's delivery/read state.
 */
/** Every non-call message can quote an earlier one (reply_to_id) — joined
 * in here so the client always has the quoted preview without a second
 * round trip, and so a since-deleted original still shows correctly
 * ("This message was deleted" rather than a broken/missing quote). */
const THREAD_SELECT = `
  SELECT cm.*,
         reply.body AS reply_to_body, reply.type AS reply_to_type,
         reply.sender_role AS reply_to_sender_role, reply.deleted_at AS reply_to_deleted_at
  FROM chat_messages cm
  LEFT JOIN chat_messages reply ON reply.id = cm.reply_to_id
`;

async function loadThreadMessages(customerId: string, riderId: string | null, viewerId: string): Promise<Row[]> {
  // hidden_for_customer/hidden_for_rider is "delete for me" — filtered per
  // viewer here rather than at read time elsewhere, since this is the one
  // place both branches (with/without a matched rider) funnel through.
  const res = riderId
    ? await db.execute({
        sql: `${THREAD_SELECT} WHERE cm.customer_id = ? AND cm.rider_id = ?
              AND NOT (cm.hidden_for_customer = 1 AND ? = cm.customer_id)
              AND NOT (cm.hidden_for_rider = 1 AND ? = cm.rider_id)
              ORDER BY cm.created_at ASC`,
        args: [customerId, riderId, viewerId, viewerId],
      })
    : await db.execute({
        sql: `${THREAD_SELECT} WHERE cm.customer_id = ? AND cm.rider_id IS NULL
              AND NOT (cm.hidden_for_customer = 1 AND ? = cm.customer_id)
              ORDER BY cm.created_at ASC`,
        args: [customerId, viewerId],
      });
  const messages = res.rows as Row[];

  if (viewerId !== customerId && viewerId !== riderId) {
    return messages.map((m) => ({ ...m, read: false }));
  }

  const now = sqliteNow();
  const undeliveredIds = messages
    .filter((m) => m.sender_id !== viewerId && !m.delivered_at)
    .map((m) => m.id as string);
  if (undeliveredIds.length > 0) {
    const placeholders = undeliveredIds.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE chat_messages SET delivered_at = ? WHERE id IN (${placeholders})`,
      args: [now, ...undeliveredIds],
    });
  }
  const undelivered = new Set(undeliveredIds);

  const counterpartId = viewerId === customerId ? riderId : customerId;
  let counterpartReadAt: string | null = null;
  if (counterpartId) {
    const readRes = await db.execute({
      sql: "SELECT last_read_at FROM chat_reads WHERE user_id = ? AND counterpart_id = ?",
      args: [counterpartId, viewerId],
    });
    counterpartReadAt = (readRes.rows[0]?.last_read_at as string | undefined) ?? null;
  }

  return messages.map((m) => ({
    ...m,
    delivered_at: undelivered.has(m.id as string) ? now : m.delivered_at,
    read: m.sender_id === viewerId && !!counterpartReadAt && (m.created_at as string) <= (counterpartReadAt as string),
  }));
}

orderRoutes.get("/orders/:id/chat", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  // Order progress (stage changes, fee proposals — anything already
  // written to order_events by touchOrder/logEvent) and the order's own
  // items, so the chat screen can show both a WhatsApp-style inline
  // timeline and an expandable order-summary card without a second round
  // trip. See apps/customer/components/OrderChat.tsx.
  const [eventsRes, itemsRes] = await Promise.all([
    db.execute({ sql: "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC", args: [id] }),
    db.execute({ sql: "SELECT * FROM list_items WHERE list_id = ?", args: [order.list_id as string] }),
  ]);
  const shared = { order: redactOrder(order, user), events: eventsRes.rows, items: itemsRes.rows };

  if (!order.rider_id) {
    const res = await db.execute({
      sql: `${THREAD_SELECT} WHERE cm.order_id = ? AND NOT (cm.hidden_for_customer = 1 AND ? = cm.customer_id)
            ORDER BY cm.created_at ASC`,
      args: [id, user.sub],
    });
    return c.json({ messages: (res.rows as Row[]).map((m) => ({ ...m, read: false })), ...shared });
  }
  const messages = await loadThreadMessages(order.customer_id as string, order.rider_id as string, user.sub);
  return c.json({ messages, ...shared });
});

const chatSchema = z.object({ body: z.string().min(1).max(2000), replyToId: z.string().optional() });
const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_CHAT_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A reply must quote a message from this exact thread — otherwise a
 * forged replyToId could leak a snippet of an unrelated conversation via
 * the quoted-preview join in THREAD_SELECT. Returns null (silently
 * dropping the quote) rather than erroring, so a stale/deleted quote
 * target doesn't block sending the new message itself. */
async function resolveReplyToId(rawReplyToId: unknown, order: Row): Promise<string | null> {
  if (typeof rawReplyToId !== "string" || !rawReplyToId) return null;
  const customerId = order.customer_id as string;
  const riderId = (order.rider_id as string | null) ?? null;
  const res = await db.execute({
    sql: `SELECT id FROM chat_messages WHERE id = ? AND customer_id = ?
          AND (rider_id = ? OR (rider_id IS NULL AND ? IS NULL))`,
    args: [rawReplyToId, customerId, riderId, riderId],
  });
  return res.rows[0] ? rawReplyToId : null;
}

/** Every photo or voice message is up to 6-10MB kept in R2 indefinitely, and
 * nothing deletes it — so an ordinary signed-in account can run up storage
 * at will. Both ceilings are well past what a real conversation uses in an
 * hour; they exist to stop a script, not a chatty customer. */
const CHAT_MEDIA_PER_HOUR = 40;
const CHAT_MESSAGES_PER_HOUR = 400;

/**
 * Text messages arrive as JSON; a photo or voice note arrives as multipart
 * form data instead (field `type`: "image" | "voice", field `file`) —
 * chosen by content-type so both share this one endpoint the way
 * apps/customer/components/OrderChat.tsx already expects.
 */
orderRoutes.post("/orders/:id/chat", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const overall = await consume(`chat:${user.sub}`, CHAT_MESSAGES_PER_HOUR, 60 * 60);
  if (!overall.allowed) {
    return tooManyRequests(c, overall, "You're sending messages too quickly. Please try again shortly.");
  }

  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    const mediaQuota = await consume(`chat-media:${user.sub}`, CHAT_MEDIA_PER_HOUR, 60 * 60);
    if (!mediaQuota.allowed) {
      return tooManyRequests(c, mediaQuota, "You've sent a lot of attachments — please try again later.");
    }

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    const type = form?.get("type");
    if (!(file instanceof File) || (type !== "image" && type !== "voice")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const allowed = type === "image" ? ALLOWED_CHAT_IMAGE_MIME : ALLOWED_VOICE_NOTE_MIME;
    const maxBytes = type === "image" ? MAX_CHAT_IMAGE_BYTES : MAX_VOICE_NOTE_BYTES;
    if (!allowed.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
    if (file.size > maxBytes) return c.json({ error: "file_too_large" }, 400);
    const replyToId = await resolveReplyToId(form?.get("replyToId"), order);

    const messageId = newId("msg");
    const ext = extensionForMime(file.type, type === "image" ? "jpg" : "webm");
    const key = `orders/${id}/chat/${messageId}.${ext}`;
    const bucket = getR2Bucket();
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

    await db.execute({
      sql: `INSERT INTO chat_messages (id, order_id, sender_id, sender_role, body, type, media_key, customer_id, rider_id, reply_to_id)
            VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
      args: [
        messageId,
        id,
        user.sub,
        user.role,
        type,
        key,
        order.customer_id as string,
        order.rider_id as string | null,
        replyToId,
      ],
    });
    for (const recipientId of chatRecipientIds(order, user.sub, user.role)) {
      background(
        c,
        notifyUser(recipientId, {
          title: user.name || "New message",
          body: chatPreview(type, null),
          url: `/chat/${user.sub}`,
          tag: `chat-${order.customer_id}-${order.rider_id}`,
        }),
      );
    }
    return c.json({ id: messageId }, 201);
  }

  const parsed = chatSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const replyToId = await resolveReplyToId(parsed.data.replyToId, order);

  const messageId = newId("msg");
  await db.execute({
    sql: `INSERT INTO chat_messages (id, order_id, sender_id, sender_role, body, type, customer_id, rider_id, reply_to_id)
          VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)`,
    args: [
      messageId,
      id,
      user.sub,
      user.role,
      parsed.data.body,
      order.customer_id as string,
      order.rider_id as string | null,
      replyToId,
    ],
  });
  for (const recipientId of chatRecipientIds(order, user.sub, user.role)) {
    background(
      c,
      notifyUser(recipientId, {
        title: user.name || "New message",
        body: chatPreview("text", parsed.data.body),
        url: `/chat/${user.sub}`,
        tag: `chat-${order.customer_id}-${order.rider_id}`,
      }),
    );
  }
  return c.json({ id: messageId }, 201);
});

/** Advances the caller's read pointer for this order's conversation to now
 * — clears the unread badge for whichever counterpart they share it with. */
orderRoutes.post("/orders/:id/chat/read", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const order = await getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const counterpartId = user.sub === order.customer_id ? (order.rider_id as string | null) : (order.customer_id as string);
  if (!counterpartId) return c.json({ ok: true });

  await db.execute({
    sql: `INSERT INTO chat_reads (user_id, counterpart_id, last_read_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id, counterpart_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    args: [user.sub, counterpartId],
  });
  return c.json({ ok: true });
});

const deleteChatSchema = z.object({ scope: z.enum(["me", "everyone"]) });

/**
 * Two WhatsApp-style scopes: "me" only hides the message from the caller's
 * own view (hidden_for_customer/hidden_for_rider — see loadThreadMessages),
 * "everyone" actually clears the content for both sides and is restricted
 * to the message's own sender. Not order-scoped in the URL — same reasoning
 * as GET /chat/media/:messageId below, a message's own denormalized
 * customer_id/rider_id is what determines access, not whichever order
 * happens to be open right now.
 */
orderRoutes.post("/chat/:messageId/delete", async (c) => {
  const messageId = c.req.param("messageId") as string;
  const user = c.get("user");
  const parsed = deleteChatSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const res = await db.execute({ sql: "SELECT * FROM chat_messages WHERE id = ?", args: [messageId] });
  const message = res.rows[0] as Row | undefined;
  if (!message) return c.json({ error: "not_found" }, 404);
  if (message.type === "call") return c.json({ error: "cannot_delete_call_log" }, 400);

  const isParticipant = message.customer_id === user.sub || message.rider_id === user.sub || user.role === "admin";
  if (!isParticipant) return c.json({ error: "forbidden" }, 403);

  if (parsed.data.scope === "everyone") {
    if (message.sender_id !== user.sub && user.role !== "admin") {
      return c.json({ error: "forbidden", message: "You can only delete your own messages for everyone." }, 403);
    }
    if (message.media_key) {
      await getR2Bucket()
        .delete(message.media_key as string)
        .catch(() => {});
    }
    await db.execute({
      sql: "UPDATE chat_messages SET deleted_at = datetime('now'), deleted_by = ?, body = '', media_key = NULL WHERE id = ?",
      args: [user.sub, messageId],
    });
    return c.json({ ok: true, scope: "everyone" });
  }

  if (user.sub === message.customer_id) {
    await db.execute({ sql: "UPDATE chat_messages SET hidden_for_customer = 1 WHERE id = ?", args: [messageId] });
  } else if (user.sub === message.rider_id) {
    await db.execute({ sql: "UPDATE chat_messages SET hidden_for_rider = 1 WHERE id = ?", args: [messageId] });
  }
  return c.json({ ok: true, scope: "me" });
});

/**
 * Streams a chat photo or voice note from R2. Not scoped to a particular
 * order in the URL — a message shown in a thread view may belong to an
 * older order than whichever one's currently open (see GET /orders/:id/chat
 * above) — so access is checked against the message's own denormalized
 * customer_id/rider_id instead.
 */
orderRoutes.get("/chat/media/:messageId", async (c) => {
  const messageId = c.req.param("messageId") as string;
  const user = c.get("user");

  const res = await db.execute({
    sql: "SELECT media_key, customer_id, rider_id, sender_id, type, played_at FROM chat_messages WHERE id = ?",
    args: [messageId],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.customer_id !== user.sub && row.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const key = row.media_key as string | null;
  if (!key) return c.json({ error: "not_found" }, 404);

  // Fetching the blob of a voice note is what "playing" it means client-side
  // (OrderChat only calls this on tap, never eagerly) — record it as played
  // the first time anyone other than the sender does, powering the
  // green/blue unplayed/played bubble color.
  if (row.type === "voice" && row.sender_id !== user.sub && !row.played_at) {
    background(c, db.execute({ sql: "UPDATE chat_messages SET played_at = datetime('now') WHERE id = ?", args: [messageId] }));
  }

  const bucket = getR2Bucket();
  const object = await bucket.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream"),
  });
});

function chatPreview(type: unknown, body: unknown): string {
  if (type === "image") return "📷 Photo";
  if (type === "voice") return "🎤 Voice message";
  if (type === "call") return "📞 " + ((body as string | null) ?? "Call");
  return (body as string | null) ?? "";
}

/** Who should be notified about a new message — the other party in a
 * customer/rider pair, or (a support intervention) both of them when the
 * sender is an admin. Empty when there's no counterpart yet (no rider
 * assigned) or the only other party is the sender themself. */
function chatRecipientIds(order: Row, senderId: string, senderRole: string): string[] {
  const customerId = order.customer_id as string;
  const riderId = order.rider_id as string | null;
  if (senderRole === "admin") {
    return [customerId, riderId].filter((rid): rid is string => !!rid && rid !== senderId);
  }
  const recipientId = senderId === customerId ? riderId : customerId;
  return recipientId ? [recipientId] : [];
}

/** Runs a best-effort background task past the point the response is sent.
 * On a Cloudflare Worker, ctx.waitUntil keeps the task alive after the
 * response returns; outside one (local Node dev) there's no such hook, so
 * it just runs unawaited — the process stays up on its own there. */
function background(c: Context, task: Promise<unknown>): void {
  const settled = task.catch((err) => console.error("Background task failed:", err));
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    void settled;
  }
}

/** Every counterpart this user has ever exchanged chat messages with, most recent first — powers the Chat tab's conversation list. */
orderRoutes.get("/chat/threads", async (c) => {
  const user = c.get("user");
  const isCustomer = user.role === "customer";

  const res = await db.execute(
    isCustomer
      ? {
          sql: `SELECT r.user_id as counterpart_id, u.name as counterpart_name, r.profile_photo_key,
                       MAX(cm.created_at) as last_at
                FROM chat_messages cm
                JOIN riders r ON r.user_id = cm.rider_id
                JOIN users u ON u.id = r.user_id
                WHERE cm.customer_id = ?
                GROUP BY r.user_id
                ORDER BY last_at DESC`,
          args: [user.sub],
        }
      : {
          sql: `SELECT cm.customer_id as counterpart_id, u.name as counterpart_name, u.profile_photo_key,
                       MAX(cm.created_at) as last_at
                FROM chat_messages cm
                JOIN users u ON u.id = cm.customer_id
                WHERE cm.rider_id = ?
                GROUP BY cm.customer_id
                ORDER BY last_at DESC`,
          args: [user.sub],
        },
  );

  const readsRes = await db.execute({
    sql: "SELECT counterpart_id, last_read_at FROM chat_reads WHERE user_id = ?",
    args: [user.sub],
  });
  const lastReadAt = new Map((readsRes.rows as Row[]).map((r) => [r.counterpart_id as string, r.last_read_at as string]));

  const threads = await Promise.all(
    (res.rows as Row[]).map(async (row) => {
      const counterpartId = row.counterpart_id as string;
      const [custId, ridId] = isCustomer ? [user.sub, counterpartId] : [counterpartId, user.sub];
      // Best-effort: this poll runs app-wide (BottomNav) while the user is
      // signed in at all, not just while a specific thread is open — the
      // broadest available "reached their device" signal for delivered ticks.
      background(
        c,
        db.execute({
          sql: "UPDATE chat_messages SET delivered_at = datetime('now') WHERE customer_id = ? AND rider_id = ? AND sender_id != ? AND delivered_at IS NULL",
          args: [custId, ridId, user.sub],
        }),
      );
      const lastRes = await db.execute({
        sql: isCustomer
          ? "SELECT type, body, sender_id FROM chat_messages WHERE customer_id = ? AND rider_id = ? ORDER BY created_at DESC LIMIT 1"
          : "SELECT type, body, sender_id FROM chat_messages WHERE rider_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 1",
        args: [user.sub, counterpartId],
      });
      const last = lastRes.rows[0] as Row | undefined;
      const lastAt = row.last_at as string;
      const readAt = lastReadAt.get(counterpartId);
      const unread = last?.sender_id !== user.sub && (!readAt || lastAt > readAt);
      return {
        counterpartId,
        counterpartName: row.counterpart_name as string,
        counterpartHasPhoto: !!row.profile_photo_key,
        lastMessagePreview: chatPreview(last?.type, last?.body),
        lastMessageAt: lastAt,
        unread,
      };
    }),
  );

  return c.json({ threads });
});

/**
 * Opens a conversation by counterpart rather than by order — resolves the
 * most recent order shared with them (where any new message gets attached)
 * plus their display info and the full cross-order message history.
 */
orderRoutes.get("/chat/threads/:counterpartId", async (c) => {
  const counterpartId = c.req.param("counterpartId") as string;
  const user = c.get("user");
  const isCustomer = user.role === "customer";
  const customerId = isCustomer ? user.sub : counterpartId;
  const riderId = isCustomer ? counterpartId : user.sub;

  const orderRes = await db.execute({
    sql: "SELECT id FROM orders WHERE customer_id = ? AND rider_id = ? ORDER BY updated_at DESC LIMIT 1",
    args: [customerId, riderId],
  });
  const orderId = orderRes.rows[0]?.id as string | undefined;
  if (!orderId) return c.json({ error: "not_found" }, 404);

  const counterpartRes = await db.execute(
    isCustomer
      ? { sql: "SELECT u.name, r.profile_photo_key FROM users u LEFT JOIN riders r ON r.user_id = u.id WHERE u.id = ?", args: [counterpartId] }
      : { sql: "SELECT name, profile_photo_key FROM users WHERE id = ?", args: [counterpartId] },
  );
  const counterpart = counterpartRes.rows[0] as Row | undefined;
  if (!counterpart) return c.json({ error: "not_found" }, 404);

  const messages = await loadThreadMessages(customerId, riderId, user.sub);

  return c.json({
    orderId,
    counterpartName: counterpart.name,
    counterpartHasPhoto: !!counterpart.profile_photo_key,
    messages,
  });
});
