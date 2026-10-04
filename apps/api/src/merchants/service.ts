import { db, executeBatch } from "../db/client.js";
import { ledgerBalance, postLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { haversineKm } from "../lib/geo.js";
import { getSetting, type PlatformEnvironment } from "../lib/settings.js";
import { resolveMerchantPolicy } from "./policy.js";

type Row = Record<string, unknown>;

export async function merchantPaymentsEnabled(environment: PlatformEnvironment): Promise<boolean> {
  const settingKey = environment === "sandbox" ? "merchant_sandbox_enabled" : "merchant_payments_enabled";
  if ((await getSetting(settingKey)) !== "1") return false;
  if (environment === "sandbox") return true;

  const approvedSetting = await db.execute(
    "SELECT value FROM settings WHERE key = 'merchant_live_custody_approved'",
  );
  if (String((approvedSetting.rows[0] as Row | undefined)?.value ?? "0") !== "1") return false;
  const approval = await db.execute({
    sql: `SELECT id FROM merchant_custody_approvals
          WHERE environment = 'live' AND currency = 'UGX' AND status = 'active'
            AND effective_at <= datetime('now')
            AND (expires_at IS NULL OR expires_at > datetime('now'))
          LIMIT 1`,
    args: [],
  });
  return approval.rows.length > 0;
}

export type PurchaseLocationInput = {
  riderLat?: number;
  riderLng?: number;
  accuracyM?: number;
  capturedAt?: string;
  outletLat?: number;
  outletLng?: number;
  evidenceMode?: "gps" | "dynamic_request" | "merchant_reauth_receipt";
  receiptReference?: string;
};

export type PurchaseRiskDecision = {
  decision: "pass" | "step_up" | "reject";
  distanceM: number | null;
  reason: string;
};

/** Location is one fraud signal, not a brittle 50 m gate. Good GPS passes;
 * uncertain/medium-distance readings require merchant re-authentication and
 * receipt evidence; clearly remote accurate scans are rejected. */
export function assessPurchaseLocation(input: PurchaseLocationInput): PurchaseRiskDecision {
  const hasRiderPoint = Number.isFinite(input.riderLat) && Number.isFinite(input.riderLng);
  const hasOutletPoint = Number.isFinite(input.outletLat) && Number.isFinite(input.outletLng);
  const accuracy = input.accuracyM ?? Number.POSITIVE_INFINITY;
  const capturedMs = input.capturedAt ? Date.parse(input.capturedAt) : Number.NaN;
  const fresh = Number.isFinite(capturedMs) && Math.abs(Date.now() - capturedMs) <= 5 * 60 * 1000;
  const hasFallback = input.evidenceMode === "merchant_reauth_receipt" && !!input.receiptReference?.trim();

  if (!hasRiderPoint || !hasOutletPoint) {
    return hasFallback
      ? { decision: "pass", distanceM: null, reason: "gps_unavailable_fallback_verified" }
      : { decision: "step_up", distanceM: null, reason: "gps_unavailable" };
  }

  const distanceM = Math.round(
    haversineKm(input.riderLat!, input.riderLng!, input.outletLat!, input.outletLng!) * 1000,
  );
  if (fresh && accuracy <= 100 && distanceM > 500) {
    return { decision: "reject", distanceM, reason: "accurate_location_too_far_from_outlet" };
  }
  if (!fresh || accuracy > 100 || distanceM > 50) {
    return hasFallback
      ? { decision: "pass", distanceM, reason: "location_step_up_satisfied" }
      : { decision: "step_up", distanceM, reason: !fresh ? "stale_location" : accuracy > 100 ? "poor_location_accuracy" : "outside_normal_radius" };
  }
  return { decision: "pass", distanceM, reason: "location_verified" };
}

export async function createMerchantBusiness(input: {
  ownerId: string;
  legalName: string;
  displayName: string;
  businessKind: "business" | "personal_seller";
  categoryId: string;
  outletName: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  environment: PlatformEnvironment;
  merchantId?: string;
  outletId?: string;
}): Promise<{ merchantId: string; outletId: string; code: string }> {
  const merchantId = input.merchantId ?? newId("mer");
  const outletId = input.outletId ?? newId("out");
  const code = `PEEBEE-${outletId.slice(-8).toUpperCase()}`;
  await executeBatch([
    {
      sql: `INSERT INTO merchants
            (id, legal_name, display_name, business_kind, environment)
            VALUES (?, ?, ?, ?, ?)`,
      args: [merchantId, input.legalName, input.displayName, input.businessKind, input.environment],
    },
    {
      sql: `INSERT INTO merchant_outlets
            (id, merchant_id, category_id, name, code, phone, address, lat, lng)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        outletId,
        merchantId,
        input.categoryId,
        input.outletName,
        code,
        input.phone ?? null,
        input.address ?? null,
        input.lat ?? null,
        input.lng ?? null,
      ],
    },
    {
      sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')",
      args: [merchantId, input.ownerId],
    },
    {
      sql: "INSERT INTO merchant_kyc_cases (id, merchant_id) VALUES (?, ?)",
      args: [newId("mkyc"), merchantId],
    },
    {
      sql: "INSERT INTO merchant_balances (merchant_id, environment) VALUES (?, ?)",
      args: [merchantId, input.environment],
    },
  ]);
  return { merchantId, outletId, code };
}

export async function ensureOrderBudget(orderId: string): Promise<Row> {
  const orderResult = await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] });
  const order = orderResult.rows[0] as Row | undefined;
  if (!order) throw new Error("Order not found");
  if (order.payment_rail !== "escrow") throw new Error("Merchant allocation requires a digitally funded order");
  const environment = order.environment as PlatformEnvironment;
  const total = Number(order.final_total ?? order.estimated_total ?? 0);
  const principal = Math.max(0, total - Number(order.delivery_fee ?? 0));
  const collectedResult = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS collected FROM payments
          WHERE order_id = ? AND type = 'collection' AND status = 'successful'`,
    args: [orderId],
  });
  const collected = Number((collectedResult.rows[0] as Row | undefined)?.collected ?? 0);
  if (collected < principal) throw new Error("Verified collection does not cover the shopping principal");
  const settlementEscrow = collected - principal;
  const fundingPostings = [
    { ownerType: "provider" as const, ownerId: "collections", purpose: "clearing", environment, amount: -collected },
    { ownerType: "order" as const, ownerId: orderId, purpose: "shopping_principal", environment, amount: principal },
    ...(settlementEscrow > 0
      ? [{ ownerType: "order" as const, ownerId: orderId, purpose: "settlement_escrow", environment, amount: settlementEscrow }]
      : []),
  ];

  await postLedgerTransaction({
    kind: "order_principal_funded",
    idempotencyKey: `order-budget:${orderId}`,
    environment,
    referenceType: "order",
    referenceId: orderId,
    description: "Shopping principal reserved for merchant purchases",
    postings: fundingPostings,
    additionalStatements: [
      {
        sql: `INSERT OR IGNORE INTO order_budgets
              (order_id, principal_funded, status, environment)
              VALUES (?, ?, 'funded', ?)`,
        args: [orderId, principal, environment],
      },
      {
        sql: "UPDATE orders SET funds_model = 'merchant_allocations_v1', updated_at = datetime('now') WHERE id = ?",
        args: [orderId],
      },
    ],
  });

  const result = await db.execute({ sql: "SELECT * FROM order_budgets WHERE order_id = ?", args: [orderId] });
  const budget = result.rows[0] as Row | undefined;
  if (!budget) throw new Error("Order budget could not be created");
  return budget;
}

/** Called only when a newly funded payment enters the successful state.
 * That preserves the clean cutover: orders funded before the feature was
 * enabled stay on the legacy payout model. */
export async function activateMerchantAllocationsForFundedOrder(orderId: string): Promise<boolean> {
  const orderResult = await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] });
  const order = orderResult.rows[0] as Row | undefined;
  if (!order || order.payment_rail !== "escrow") return false;
  const environment = order.environment as PlatformEnvironment;
  if (!(await merchantPaymentsEnabled(environment))) return false;
  if (!order.rider_id) throw new Error("Merchant-funded order must have an assigned rider");
  const existingLock = await db.execute({
    sql: "SELECT order_id FROM rider_order_locks WHERE rider_id = ?",
    args: [String(order.rider_id)],
  });
  if (existingLock.rows[0] && String((existingLock.rows[0] as Row).order_id) !== orderId) {
    throw new Error("Rider already has another active funded order");
  }
  await ensureOrderBudget(orderId);
  await db.execute({
    sql: "INSERT OR IGNORE INTO rider_order_locks (rider_id, order_id, environment) VALUES (?, ?, ?)",
    args: [String(order.rider_id), orderId, environment],
  });
  if (order.restaurant_id) await createRestaurantAllocation(orderId);
  return true;
}

export async function refundUnusedOrderPrincipal(orderId: string, actorId: string): Promise<number> {
  const result = await db.execute({
    sql: `SELECT b.*, o.customer_id FROM order_budgets b JOIN orders o ON o.id = b.order_id WHERE b.order_id = ?`,
    args: [orderId],
  });
  const budget = result.rows[0] as Row | undefined;
  if (!budget) return 0;
  const unused = Number(budget.principal_funded) - Number(budget.principal_allocated) - Number(budget.principal_refunded);
  if (unused <= 0) return 0;
  const environment = budget.environment as PlatformEnvironment;
  const balanceColumn = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const ledgerId = newId("wl");
  await postLedgerTransaction({
    kind: "unused_order_principal_refunded",
    idempotencyKey: `order-budget:${orderId}:unused-refund`,
    environment,
    referenceType: "order",
    referenceId: orderId,
    actorId,
    postings: [
      { ownerType: "order", ownerId: orderId, purpose: "shopping_principal", environment, amount: -unused },
      { ownerType: "customer", ownerId: String(budget.customer_id), purpose: "wallet_payable", environment, amount: unused },
    ],
    additionalStatements: [
      {
        sql: `UPDATE users SET ${balanceColumn} = ${balanceColumn} + ?, updated_at = datetime('now') WHERE id = ?`,
        args: [unused, budget.customer_id],
      },
      {
        sql: `INSERT INTO wallet_ledger
              (id, user_id, type, amount, balance_after, order_id, note, actor_id, environment)
              SELECT ?, ?, 'refund', ?, ${balanceColumn}, ?, 'Unused shopping principal', ?, ? FROM users WHERE id = ?`,
        args: [ledgerId, budget.customer_id, unused, orderId, actorId, environment, budget.customer_id],
      },
      {
        sql: `UPDATE order_budgets
              SET principal_refunded = principal_refunded + ?, status = 'closed', updated_at = datetime('now')
              WHERE order_id = ?`,
        args: [unused, orderId],
      },
    ],
  });
  return unused;
}

export async function settleMerchantOrderFinancials(input: {
  orderId: string;
  actorId: string;
  riderPayout: number;
}): Promise<void> {
  const orderResult = await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [input.orderId] });
  const order = orderResult.rows[0] as Row | undefined;
  if (!order?.rider_id) throw new Error("Funded merchant order has no rider");
  const environment = order.environment as PlatformEnvironment;
  const escrow = await ledgerBalance({
    ownerType: "order",
    ownerId: input.orderId,
    purpose: "settlement_escrow",
    environment,
  });
  if (escrow <= 0) return;
  const payout = Math.max(0, Math.min(escrow, Math.trunc(input.riderPayout)));
  const platformRevenue = escrow - payout;
  const postings = [
    { ownerType: "order" as const, ownerId: input.orderId, purpose: "settlement_escrow", environment, amount: -escrow },
    ...(payout > 0
      ? [{ ownerType: "rider" as const, ownerId: String(order.rider_id), purpose: "earnings_available", environment, amount: payout }]
      : []),
    ...(platformRevenue > 0
      ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "order_revenue", environment, amount: platformRevenue }]
      : []),
  ];
  const balanceColumn = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  await postLedgerTransaction({
    kind: "merchant_order_settled",
    idempotencyKey: `merchant-order:${input.orderId}:settle`,
    environment,
    referenceType: "order",
    referenceId: input.orderId,
    actorId: input.actorId,
    postings,
    additionalStatements: [
      ...(payout > 0
        ? [{
            sql: `UPDATE riders SET ${balanceColumn} = ${balanceColumn} + ?, updated_at = datetime('now') WHERE user_id = ?`,
            args: [payout, order.rider_id],
          }]
        : []),
      { sql: "UPDATE order_budgets SET status = 'closed', updated_at = datetime('now') WHERE order_id = ?", args: [input.orderId] },
      { sql: "DELETE FROM rider_order_locks WHERE rider_id = ? AND order_id = ?", args: [order.rider_id, input.orderId] },
    ],
  });
}

export async function finalizeMerchantPayment(paymentId: string, actorId: string): Promise<Row> {
  const result = await db.execute({
    sql: `SELECT mp.*, m.trust_tier
          FROM merchant_payments mp JOIN merchants m ON m.id = mp.merchant_id
          WHERE mp.id = ?`,
    args: [paymentId],
  });
  const payment = result.rows[0] as Row | undefined;
  if (!payment) throw new Error("Merchant payment not found");
  if (["available", "held", "settlement_pending", "paid"].includes(String(payment.status))) {
    return payment;
  }
  if (payment.status !== "awaiting_confirmation") throw new Error(`Cannot confirm payment in ${payment.status}`);

  await ensureOrderBudget(String(payment.order_id));
  const amount = Number(payment.amount);
  const environment = payment.environment as PlatformEnvironment;
  const held = payment.risk_state === "held";
  const destinationPurpose = held ? "payable_held" : "payable_available";
  const transaction = await postLedgerTransaction({
    kind: "merchant_purchase",
    idempotencyKey: `merchant-payment:${paymentId}:allocate`,
    environment,
    referenceType: "merchant_payment",
    referenceId: paymentId,
    description: held
      ? "Order principal allocated to merchant and held for risk review"
      : "Order principal allocated to merchant after confirmed goods handover",
    actorId,
    postings: [
      { ownerType: "order", ownerId: String(payment.order_id), purpose: "shopping_principal", environment, amount: -amount },
      { ownerType: "merchant", ownerId: String(payment.merchant_id), purpose: destinationPurpose, environment, amount },
    ],
    additionalStatements: [
      {
        // The CHECK constraint is the final concurrent-spend guard. An
        // over-allocation aborts this whole ledger batch.
        sql: `UPDATE order_budgets
              SET principal_allocated = principal_allocated + ?,
                  status = CASE WHEN principal_allocated + ? = principal_funded THEN 'fully_allocated' ELSE 'partially_allocated' END,
                  updated_at = datetime('now')
              WHERE order_id = ?`,
        args: [amount, amount, payment.order_id],
      },
      {
        sql: held
          ? `UPDATE merchant_balances SET held = held + ?, updated_at = datetime('now')
              WHERE merchant_id = ? AND environment = ?`
          : `UPDATE merchant_balances SET available = available + ?, updated_at = datetime('now')
              WHERE merchant_id = ? AND environment = ?`,
        args: [amount, payment.merchant_id, environment],
      },
      {
        sql: `UPDATE merchant_payments
              SET status = ?, available_at = CASE WHEN ? = 'available' THEN datetime('now') ELSE available_at END,
                  updated_at = datetime('now')
              WHERE id = ? AND status = 'awaiting_confirmation'`,
        args: [held ? "held" : "available", held ? "held" : "available", paymentId],
      },
    ],
  });
  if (transaction.duplicate) {
    await db.execute({
      sql: `UPDATE merchant_payments
            SET status = ?, available_at = CASE WHEN ? = 'available' THEN datetime('now') ELSE available_at END,
                updated_at = datetime('now')
            WHERE id = ? AND status = 'awaiting_confirmation'`,
      args: [held ? "held" : "available", held ? "held" : "available", paymentId],
    });
  }
  const updated = await db.execute({ sql: "SELECT * FROM merchant_payments WHERE id = ?", args: [paymentId] });
  return updated.rows[0] as Row;
}

export async function createRestaurantAllocation(orderId: string): Promise<void> {
  const result = await db.execute({
    sql: `SELECT o.*, r.merchant_id, r.outlet_id, m.trust_tier
          FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
          JOIN merchants m ON m.id = r.merchant_id
          WHERE o.id = ?`,
    args: [orderId],
  });
  const order = result.rows[0] as Row | undefined;
  if (!order?.merchant_id || !order.outlet_id || !order.rider_id) return;
  const related = await db.execute({
    sql: "SELECT 1 FROM merchant_members WHERE merchant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
    args: [String(order.merchant_id), String(order.rider_id)],
  });
  if (related.rows.length > 0) throw new Error("Rider cannot allocate order funds to a related merchant");
  const principal = Math.max(0, Number(order.final_total ?? order.estimated_total ?? 0) - Number(order.delivery_fee ?? 0));
  if (principal <= 0) return;
  const policy = await resolveMerchantPolicy(String(order.merchant_id), String(order.trust_tier));
  const riskState = policy.settlementReleaseMode === "manual_hold" ? "held" : "passed";
  const riskReason = riskState === "held" ? "merchant_policy_manual_hold" : "restaurant_order_confirmed";
  const paymentId = `mpay_restaurant_${orderId}`;
  await db.execute({
    sql: `INSERT OR IGNORE INTO merchant_payments
          (id, order_id, merchant_id, outlet_id, amount, status, confirmation_mode, rider_id, initiated_by,
           rider_confirmed_at, merchant_confirmed_at, risk_state, evidence_mode, risk_reason,
           policy_version, idempotency_key, environment)
          VALUES (?, ?, ?, ?, ?, 'awaiting_confirmation', 'merchant_request', ?, ?, datetime('now'), datetime('now'),
                   ?, 'dynamic_request', ?, ?, ?, ?)`,
    args: [
      paymentId,
      orderId,
      String(order.merchant_id),
      String(order.outlet_id),
      principal,
      String(order.rider_id),
      String(order.customer_id),
      riskState,
      riskReason,
      policy.version,
      `restaurant:${orderId}`,
      String(order.environment),
    ],
  });
  await finalizeMerchantPayment(paymentId, String(order.customer_id));
}
