import type { Context } from "hono";
import { db, executeBatch, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { computeCheckoutFees } from "../lib/monetization.js";
import { hasColumn } from "../lib/schema.js";
import { getMonetizationSettings } from "../lib/settings.js";
import { activateMerchantAllocationsForFundedOrder } from "../merchants/service.js";
import {
  initiateCollection,
  mobileMoneyNetworkLabel,
  paymentProviderErrorResponse,
  paymentProviderHttpStatus,
  UnsupportedNetworkError,
} from "../payments/service.js";
import { notifyUser } from "../lib/webpush.js";
import { walletIsFrozen } from "../wallet/freeze.js";
import { payBundleFromWallet } from "../wallet/service.js";
import type { CardDetails, PaymentNextAction } from "../payments/gateway.js";

type Row = Record<string, unknown>;

/** The provider name on the payment row of every pickup after the first in a one-payment combined delivery. */
export const BUNDLE_CHILD_PROVIDER = "bundle_child";

export type BundleGroup = { lead: Row; members: Row[] };

export type BundleFundBody = {
  paymentMethod?: "mobile_money" | "card" | "wallet" | "cash";
  acceptedAmount?: number;
  msisdn?: string;
  card?: CardDetails;
  useWallet?: boolean;
  walletOwnerId?: string;
  walletId?: string;
};

type Deps = {
  getOrder: (id: string) => Promise<Row | undefined>;
  touchOrder: (id: string, fields: Record<string, unknown>) => Promise<void>;
  logEvent: (orderId: string, stage: string, note: string, actorId: string) => Promise<void>;
  paymentReturnUrl: (orderId: string) => string;
};

/**
 * The orders that are paid together with `order` in one payment: a combined
 * delivery (two pickups, one rider) whose first pickup is `order`, with every
 * pickup matched and still unpaid. Anything else — a single order, a pickup
 * after the first, or a combined delivery that was part-paid under the old
 * one-payment-per-pickup flow — returns null and is paid on its own.
 */
export async function unfundedBundleGroup(order: Row): Promise<BundleGroup | null> {
  const members = await bundleMembers(order);
  if (!members) return null;
  const riderId = members[0].rider_id;
  if (!riderId || !members.every((member) => member.stage === "Match" && member.rider_id === riderId)) return null;
  return { lead: members[0], members };
}

/**
 * A combined delivery that isn't paid yet, whether or not a rider has taken it:
 * what the first pickup's pay screen quotes, so the total the customer is shown
 * is the same before and after a rider accepts. Paying still needs
 * unfundedBundleGroup (every pickup matched to the same rider).
 */
export async function unpaidBundleGroup(order: Row): Promise<BundleGroup | null> {
  const members = await bundleMembers(order);
  if (!members || !members.every((member) => member.stage === "Create" || member.stage === "Match")) return null;
  return { lead: members[0], members };
}

/**
 * A relay bag paid before any rider (see relayPaysBeforeRider): every pickup
 * still waiting for its first rider and unpaid. Null when `order` is not part
 * of a combined delivery; "not_ready" when some pickup has moved on, so the
 * bag is never paid in part.
 */
export async function prepaidBundleGroup(order: Row): Promise<BundleGroup | "not_ready" | null> {
  const members = await bundleMembers(order);
  if (!members) return null;
  if (!members.every((member) => !member.rider_id && (member.stage === "Create" || member.stage === "Match"))) return "not_ready";
  return { lead: members[0], members };
}

/** Every live order in `order`'s combined delivery, first pickup first; null unless there are two or more. */
async function bundleMembers(order: Row): Promise<Row[] | null> {
  if (!order.delivery_bundle_id || !(await hasColumn("orders", "delivery_bundle_id"))) return null;
  const bundleId = String(order.delivery_bundle_id);
  const res = await db.execute({
    sql: `SELECT o.*, COALESCE(r.name, o.pickup_area) AS restaurant_name FROM orders o LEFT JOIN restaurants r ON r.id = o.restaurant_id
          WHERE o.delivery_bundle_id = ? AND o.customer_id = ? AND o.environment = ? AND o.stage != 'Cancelled'
          ORDER BY CASE WHEN o.id = ? THEN 0 ELSE 1 END, o.created_at, o.id`,
    args: [bundleId, String(order.customer_id), String(order.environment), bundleId],
  });
  const members = res.rows as Row[];
  return members.length >= 2 && String(members[0].id) === bundleId ? members : null;
}

type Part = { order: Row; base: number; deliveryFee: number; mobile: number; wallet: number };

async function bundleParts(group: BundleGroup): Promise<Part[]> {
  const settings = await getMonetizationSettings();
  return group.members.map((order) => {
    const base = Number(order.final_total ?? order.estimated_total ?? 0);
    const input = { baseAmount: base, deliveryFee: Number(order.delivery_fee ?? 0), orderType: order.type as "parcel" | "shopping" };
    return {
      order,
      base,
      deliveryFee: input.deliveryFee,
      mobile: base + computeCheckoutFees(settings, { ...input, payingWithWallet: false }).totalSurcharge,
      wallet: base + computeCheckoutFees(settings, { ...input, payingWithWallet: true }).totalSurcharge,
    };
  });
}

/** What the customer pays in total for the combined delivery, by method, plus a per-restaurant breakdown. */
export async function bundleCheckoutQuote(group: BundleGroup) {
  const parts = await bundleParts(group);
  const sum = (pick: (part: Part) => number) => parts.reduce((total, part) => total + pick(part), 0);
  return {
    baseAmount: sum((part) => part.base),
    mobileMoney: sum((part) => part.mobile),
    wallet: sum((part) => part.wallet),
    cash: sum((part) => part.base),
    bundle: {
      deliveryFee: sum((part) => part.deliveryFee),
      orders: parts.map((part) => ({ id: String(part.order.id), restaurantName: (part.order.restaurant_name as string | null) ?? null, itemsAndDelivery: part.base, deliveryFee: part.deliveryFee })),
    },
  };
}

/** Puts every pickup back where it was before the payment was attempted (Match, or Create for a relay paid first). */
function revertStatements(parts: Part[], token: string): DbStatement[] {
  return parts.map((part) => ({
    sql: "UPDATE orders SET stage = ?, payment_rail = ?, time_action_token = NULL, updated_at = datetime('now') WHERE id = ? AND time_action_token = ?",
    args: [String(part.order.stage), String(part.order.payment_rail ?? "escrow"), String(part.order.id), token],
  }));
}

function unholdStatements(parts: Part[]): DbStatement[] {
  return parts.map((part) => ({ sql: "UPDATE orders SET stage = ?, updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'", args: [String(part.order.stage), String(part.order.id)] }));
}

/**
 * Pays every pickup of a combined delivery in one go. The customer sees (and
 * accepts) one total; underneath, each order still gets its own payment row,
 * fee record and wallet line, so settlement, merchant holds and refunds keep
 * working per order. A Mobile Money / card collection is one provider request
 * for the total, recorded on the first pickup, with a linked pending row for
 * each other pickup that is resolved together with it (see reconcilePayment).
 */
export async function fundBundle(input: {
  c: Context;
  user: { sub: string; name?: string };
  group: BundleGroup;
  body: BundleFundBody;
  /** A relay bag paid before any rider: the pickups have no rider yet and wait in Match once paid. */
  payFirst?: boolean;
  deps: Deps;
}): Promise<Response> {
  const { c, user, group, body, deps } = input;
  const payFirst = !!input.payFirst;
  const lead = group.lead;
  const leadId = String(lead.id);
  const riderId = String(lead.rider_id);
  const parts = await bundleParts(group);
  const environment = lead.environment as "live" | "sandbox";
  const token = newId("fund");
  const cash = body.paymentMethod === "cash";
  const wallet = !cash && !!body.useWallet;
  const amountOf = (part: Part) => (cash ? part.base : wallet ? part.wallet : part.mobile);
  const total = parts.reduce((sum, part) => sum + amountOf(part), 0);
  if (body.acceptedAmount != null && body.acceptedAmount !== total) {
    return c.json({ error: "amount_changed", message: "The total has changed. Review the updated amount before paying." }, 409);
  }

  // Reserve every pickup in one transaction (stage + token) so a double tap or a
  // concurrent cancel can't leave half of the delivery paid.
  const holdWhere = payFirst ? "stage IN ('Create', 'Match') AND rider_id IS NULL" : "stage = 'Match' AND rider_id = ?";
  const reserveSql = (stage: string, rail: string) => `UPDATE orders SET payment_rail = '${rail}', stage = '${stage}', time_action_token = ?, updated_at = datetime('now')
    WHERE id = ? AND ${holdWhere} AND COALESCE(final_total, estimated_total, 0) = ?
    AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND status IN ('pending', 'unknown', 'successful'))`;
  const reserveArgs = (part: Part): DbStatement["args"] =>
    payFirst ? [token, String(part.order.id), part.base, String(part.order.id)] : [token, String(part.order.id), riderId, part.base, String(part.order.id)];
  const reserve = async (stage: string, rail: string) => {
    const changes = await executeBatch(parts.map((part) => ({
      sql: reserveSql(stage, rail),
      args: reserveArgs(part),
    })));
    if (changes.every((count) => count > 0)) return true;
    await executeBatch(revertStatements(parts, token));
    return false;
  };
  const changed = () => c.json({ error: "invalid_stage", message: "This order has changed. Refresh before paying." }, 409);

  if (cash) {
    if (payFirst) return c.json({ error: "relay_requires_prepay", message: "Relay deliveries are paid in the app, not in cash." }, 409);
    if (!(await reserve("Shop", "float"))) return changed();
    for (const part of parts) {
      await deps.logEvent(String(part.order.id), "Fund", "Cash rail — rider collects full payment from the customer on delivery", user.sub);
    }
    await notifyRiderOfCombinedDelivery(leadId);
    return c.json({ order: await deps.getOrder(leadId), funded: true, rail: "float" });
  }

  // Fee breakdowns are stored per order, exactly as for a single order.
  const settings = await getMonetizationSettings();
  for (const part of parts) {
    const fees = computeCheckoutFees(settings, { baseAmount: part.base, deliveryFee: part.deliveryFee, orderType: part.order.type as "parcel" | "shopping", payingWithWallet: wallet });
    if (fees.serviceFee > 0 || fees.processingFeeCustomer > 0 || fees.processingFeeRider > 0 || fees.deliveryCommission > 0) {
      await db.execute({
        sql: `INSERT INTO order_fees (order_id, service_fee, processing_fee_customer, processing_fee_rider, delivery_commission)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(order_id) DO UPDATE SET
                service_fee = excluded.service_fee, processing_fee_customer = excluded.processing_fee_customer,
                processing_fee_rider = excluded.processing_fee_rider, delivery_commission = excluded.delivery_commission`,
        args: [String(part.order.id), fees.serviceFee, fees.processingFeeCustomer, fees.processingFeeRider, fees.deliveryCommission],
      });
    }
  }

  if (wallet) {
    const walletId = !body.walletId || body.walletId === "primary" ? undefined : body.walletId;
    let walletOwnerId = user.sub;
    if (body.walletOwnerId && body.walletOwnerId !== user.sub) {
      const share = await db.execute({
        sql: `SELECT 1 FROM wallet_shares WHERE owner_id = ? AND grantee_id = ? AND status = 'active'
              AND wallet_id ${walletId ? "= ?" : "IS NULL"}`,
        args: walletId ? [body.walletOwnerId, user.sub, walletId] : [body.walletOwnerId, user.sub],
      });
      if (share.rows.length === 0) return c.json({ error: "wallet_not_shared" }, 403);
      walletOwnerId = body.walletOwnerId;
    } else if (walletId) {
      const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [walletId, user.sub] });
      if (owned.rows.length === 0) return c.json({ error: "not_found", message: "That wallet doesn't exist" }, 404);
    }
    const sharedSpend = walletOwnerId !== user.sub;
    if (await walletIsFrozen(walletOwnerId, walletId)) {
      return c.json({ error: "account_frozen", message: "This account is frozen. Unfreeze it to pay. Money can still come in." }, 409);
    }
    if (!(await reserve("Fund", "escrow"))) return changed();
    const paymentIds = await payBundleFromWallet({
      userId: walletOwnerId,
      parts: parts.map((part) => ({ orderId: String(part.order.id), amount: part.wallet })),
      environment,
      note: `Combined delivery ${leadId}`,
      actorId: sharedSpend ? user.sub : undefined,
      walletId,
    });
    if (!paymentIds) {
      await executeBatch(unholdStatements(parts));
      return c.json({ error: "insufficient_wallet_balance" }, 409);
    }
    if (payFirst) {
      // Held in escrow until the first-leg rider is assigned; assignRider then starts every pickup.
      for (const part of parts) {
        const orderId = String(part.order.id);
        await deps.touchOrder(orderId, { stage: "Match" });
        await deps.logEvent(orderId, "Fund", sharedSpend ? "Paid from a shared wallet with the combined delivery — held until a rider is assigned" : "Paid from wallet with the combined delivery — held until a rider is assigned", user.sub);
      }
      return c.json({ order: await deps.getOrder(leadId), payment: { id: paymentIds[0], status: "successful", network: null } });
    }
    for (const part of parts) {
      const orderId = String(part.order.id);
      await deps.touchOrder(orderId, { stage: "Shop" });
      await activateMerchantAllocationsForFundedOrder(orderId);
      await deps.logEvent(orderId, "Fund", sharedSpend ? "Paid from a shared wallet with the combined delivery — shopping started" : "Paid from wallet with the combined delivery — shopping started", user.sub);
    }
    await notifyRiderOfCombinedDelivery(leadId);
    return c.json({ order: await deps.getOrder(leadId), payment: { id: paymentIds[0], status: "successful", network: null } });
  }

  // Mobile Money / card: one collection for the total.
  const leadPaymentId = newId("pay");
  const childPayments = parts.slice(1).map((part) => ({ id: newId("pay"), part }));
  const statements: DbStatement[] = [
    ...parts.map((part) => ({
      sql: reserveSql("Fund", "escrow"),
      args: reserveArgs(part),
    })),
    {
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, msisdn, amount, currency, status)
            SELECT ?, id, 'collection', 'unassigned', NULL, ?, ?, 'UGX', 'pending' FROM orders WHERE id = ? AND time_action_token = ?`,
      args: [leadPaymentId, body.msisdn ?? null, parts[0].mobile, leadId, token],
    },
    ...childPayments.map(({ id, part }) => ({
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, msisdn, amount, currency, status)
            SELECT ?, id, 'collection', '${BUNDLE_CHILD_PROVIDER}', ?, ?, ?, 'UGX', 'pending' FROM orders WHERE id = ? AND time_action_token = ?`,
      args: [id, leadPaymentId, body.msisdn ?? null, part.mobile, String(part.order.id), token],
    })),
  ];
  const results = await executeBatch(statements);
  if (!results.slice(0, parts.length).every((count) => count > 0)) {
    await executeBatch([
      ...revertStatements(parts, token),
      { sql: `DELETE FROM payments WHERE id IN (${[leadPaymentId, ...childPayments.map((child) => child.id)].map(() => "?").join(",")})`, args: [leadPaymentId, ...childPayments.map((child) => child.id)] },
    ]);
    return changed();
  }
  const paymentIds = [leadPaymentId, ...childPayments.map((child) => child.id)];
  const failAll = () => executeBatch([
    { sql: `UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id IN (${paymentIds.map(() => "?").join(",")})`, args: paymentIds },
    ...unholdStatements(parts),
  ]);

  let providerRef: string;
  let network: Awaited<ReturnType<typeof initiateCollection>>["network"];
  let provider: string;
  let redirectUrl: string | undefined;
  let nextAction: PaymentNextAction | undefined;
  try {
    const initiated = await initiateCollection({
      referenceId: leadPaymentId,
      msisdn: body.paymentMethod === "card" ? undefined : body.msisdn,
      method: body.paymentMethod === "card" || body.paymentMethod === "mobile_money" ? body.paymentMethod : undefined,
      card: body.card,
      amount: total,
      name: user.name,
      returnUrl: deps.paymentReturnUrl(leadId),
      forceMock: environment === "sandbox",
    });
    providerRef = initiated.providerRef;
    network = initiated.network;
    provider = initiated.provider;
    redirectUrl = initiated.redirectUrl;
    nextAction = initiated.nextAction;
  } catch (err) {
    await failAll();
    if (err instanceof UnsupportedNetworkError) return c.json({ error: "unsupported_network", message: err.message }, 400);
    console.error("Combined escrow collection request failed:", err);
    return c.json(paymentProviderErrorResponse(err, "Couldn't reach mobile money just now. Please try again."), paymentProviderHttpStatus(err));
  }

  try {
    await executeBatch([
      { sql: "UPDATE payments SET provider = ?, provider_ref = ?, network = ?, updated_at = datetime('now') WHERE id = ?", args: [provider, providerRef, network, leadPaymentId] },
      ...childPayments.map(({ id }) => ({ sql: "UPDATE payments SET network = ?, updated_at = datetime('now') WHERE id = ?", args: [network, id] as DbStatement["args"] })),
      {
        sql: `INSERT INTO provider_operations
              (id, operation_type, business_type, business_id, provider, provider_ref,
               idempotency_key, amount, environment, status, next_check_at)
              VALUES (?, 'collection', 'payment', ?, ?, ?, ?, ?, ?, 'submitted', datetime('now', '+2 minutes'))`,
        args: [newId("pop"), leadPaymentId, provider, providerRef, `payment:${leadPaymentId}:collection`, total, environment],
      },
    ]);
  } catch (error) {
    // The provider already accepted the collection: keep its reference and the
    // reconciliation job with best-effort writes and never revert the orders,
    // which would invite a duplicate charge.
    console.error("Combined collection accepted by provider but atomic persistence failed", leadPaymentId, providerRef, error);
    const paymentSaved = await db.execute({
      sql: "UPDATE payments SET provider = ?, provider_ref = ?, network = ?, updated_at = datetime('now') WHERE id = ?",
      args: [provider, providerRef, network, leadPaymentId],
    }).then(() => true).catch(() => false);
    const operationSaved = await db.execute({
      sql: `INSERT OR IGNORE INTO provider_operations
            (id, operation_type, business_type, business_id, provider, provider_ref,
             idempotency_key, amount, environment, status, next_check_at)
            VALUES (?, 'collection', 'payment', ?, ?, ?, ?, ?, ?, 'unknown', datetime('now', '+2 minutes'))`,
      args: [newId("pop"), leadPaymentId, provider, providerRef, `payment:${leadPaymentId}:collection`, total, environment],
    }).then(() => true).catch(() => false);
    if (!paymentSaved || !operationSaved) {
      return c.json({
        error: "collection_status_uncertain",
        message: "The payment request was submitted and may still complete. Do not retry it; support can reconcile this order.",
      }, 502);
    }
  }
  for (const part of parts) {
    await deps.logEvent(String(part.order.id), "Fund", network ? `${mobileMoneyNetworkLabel(network)} collection requested for the combined delivery` : "Collection requested for the combined delivery", user.sub);
  }
  return c.json({ order: await deps.getOrder(leadId), payment: { id: leadPaymentId, status: "pending", network }, redirectUrl, nextAction });
}

/**
 * Called by reconcilePayment once the single collection behind a combined
 * delivery has a final answer: marks the linked pickup payments the same way
 * and starts the other pickups' shopping. Safe to run repeatedly.
 */
export async function finishBundleChildren(parentPaymentId: string, outcome: "successful" | "failed", actorId: string): Promise<void> {
  const kids = await db.execute({
    sql: "SELECT id, order_id FROM payments WHERE provider = ? AND provider_ref = ? AND status = 'pending'",
    args: [BUNDLE_CHILD_PROVIDER, parentPaymentId],
  });
  if (kids.rows.length === 0) return;
  if (outcome === "failed") {
    await executeBatch([
      { sql: "UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE provider = ? AND provider_ref = ? AND status = 'pending'", args: [BUNDLE_CHILD_PROVIDER, parentPaymentId] },
      // A relay pickup paid before any rider goes back to waiting, so it can be paid again or expire.
      ...(kids.rows as Row[]).map((kid) => ({ sql: "UPDATE orders SET stage = 'Create', updated_at = datetime('now') WHERE id = ? AND stage = 'Fund' AND rider_id IS NULL", args: [String(kid.order_id)] })),
    ]);
    return;
  }
  const statements: DbStatement[] = [];
  for (const kid of kids.rows as Row[]) {
    const orderId = String(kid.order_id);
    statements.push(
      { sql: "UPDATE payments SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [String(kid.id)] },
      // A relay pickup paid before any rider waits in Match for one (assignRider then starts it).
      { sql: "UPDATE orders SET stage = CASE WHEN rider_id IS NULL THEN 'Match' ELSE 'Shop' END, updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'", args: [orderId] },
      {
        sql: `INSERT OR IGNORE INTO order_events (id, order_id, stage, note, actor_id)
              SELECT ?, ?, stage, CASE WHEN stage = 'Shop' THEN 'Escrow funded with the combined delivery — shopping started'
                ELSE 'Escrow funded with the combined delivery — held until a rider is assigned' END, ?
              FROM orders WHERE id = ? AND (stage = 'Shop' OR (stage = 'Match' AND rider_id IS NULL))`,
        args: [`evt_payment_${String(kid.id)}`, orderId, actorId, orderId],
      },
    );
  }
  await executeBatch(statements);
  for (const kid of kids.rows as Row[]) await activateMerchantAllocationsForFundedOrder(String(kid.order_id));
  const parent = await db.execute({ sql: "SELECT order_id FROM payments WHERE id = ?", args: [parentPaymentId] });
  if (parent.rows[0]) await notifyRiderOfCombinedDelivery(String((parent.rows[0] as Row).order_id));
}

/** Tells the rider, by push, that their delivery has more than one restaurant to collect from. */
export async function notifyRiderOfCombinedDelivery(orderId: string): Promise<void> {
  try {
    const order = (await db.execute({ sql: "SELECT id, rider_id, delivery_bundle_id FROM orders WHERE id = ?", args: [orderId] })).rows[0] as Row | undefined;
    if (!order?.rider_id || !order.delivery_bundle_id) return;
    const stops = (await db.execute({
      sql: `SELECT COALESCE(r.name, o.pickup_area, 'Pickup') AS name FROM orders o LEFT JOIN restaurants r ON r.id = o.restaurant_id
            WHERE o.delivery_bundle_id = ? AND o.stage != 'Cancelled'
            ORDER BY CASE WHEN o.id = o.delivery_bundle_id THEN 0 ELSE 1 END, o.created_at, o.id`,
      args: [String(order.delivery_bundle_id)],
    })).rows as Row[];
    if (stops.length < 2) return;
    await notifyUser(String(order.rider_id), {
      title: `Combined delivery: ${stops.length} pickups`,
      body: `Collect from ${stops.map((stop) => String(stop.name)).join(", then ")}, and deliver everything together.`,
      url: `/jobs/${String(order.delivery_bundle_id)}`,
      tag: `bundle-${String(order.delivery_bundle_id)}`,
    });
  } catch (error) {
    console.error("Could not notify the rider about the combined delivery", error);
  }
}
