import { db, executeBatch, type DbStatement } from "../db/client.js";
import { notifyGuest } from "../guest/notify.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { getPaymentsLateWatchHours, getPaymentsPendingTimeoutMinutes, invalidateSettingsCache, type PlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditWallet } from "../wallet/service.js";
import { activateMerchantAllocationsForFundedOrder } from "../merchants/service.js";
import { BUNDLE_CHILD_PROVIDER, finishBundleChildren } from "../orders/bundle-funding.js";
import { checkPaymentStatus, type DbPaymentStatus } from "./service.js";

type Row = Record<string, unknown>;

export function merchantSettlementPostings(input: {
  success: boolean;
  merchantId: string;
  provider: string;
  amount: number;
  fee: number;
  environment: PlatformEnvironment;
}) {
  const totalDebit = input.amount + input.fee;
  return input.success
    ? [
        { ownerType: "merchant" as const, ownerId: input.merchantId, purpose: "settlement_in_transit", environment: input.environment, amount: -totalDebit },
        { ownerType: "provider" as const, ownerId: input.provider, purpose: "settlement_clearing", environment: input.environment, amount: input.amount },
        ...(input.fee > 0
          ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "settlement_fee_revenue", environment: input.environment, amount: input.fee }]
          : []),
      ]
    : [
        { ownerType: "merchant" as const, ownerId: input.merchantId, purpose: "settlement_in_transit", environment: input.environment, amount: -totalDebit },
        { ownerType: "merchant" as const, ownerId: input.merchantId, purpose: "payable_available", environment: input.environment, amount: totalDebit },
      ];
}

export async function registerProviderOperation(input: {
  operationType: "collection" | "disbursement" | "refund";
  businessType: "payment" | "merchant_settlement";
  businessId: string;
  provider: string;
  providerRef?: string | null;
  idempotencyKey: string;
  amount: number;
  environment: PlatformEnvironment;
}): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO provider_operations
          (id, operation_type, business_type, business_id, provider, provider_ref,
           idempotency_key, amount, environment, status, next_check_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now', '+2 minutes'))`,
    args: [newId("pop"), input.operationType, input.businessType, input.businessId, input.provider,
      input.providerRef ?? null, input.idempotencyKey, input.amount, input.environment],
  });
}

function nextCheckIso(attempt: number): string {
  const minutes = [2, 5, 10, 20, 60][Math.min(attempt, 4)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function markOperationProgress(operation: Row, status: "pending" | "unknown"): Promise<void> {
  const attempt = Number(operation.attempt_count) + 1;
  await db.execute({
    sql: `UPDATE provider_operations
          SET status = ?, attempt_count = ?, last_checked_at = datetime('now'), next_check_at = ?,
              lease_token = NULL, lease_until = NULL, updated_at = datetime('now')
          WHERE id = ?`,
    args: [status, attempt, nextCheckIso(attempt), String(operation.id)],
  });
  const createdAt = Date.parse(`${String(operation.created_at).replace(" ", "T")}Z`);
  if (status === "unknown" && Number.isFinite(createdAt) && Date.now() - createdAt >= 30 * 60_000) {
    console.error("Provider operation has been indeterminate for at least 30 minutes", operation.id);
  }
}

async function enforceMerchantReconciliationGuard(): Promise<void> {
  const mismatch = await db.execute({
    sql: `SELECT 1 FROM merchant_balances b
          WHERE b.held != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                    WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='payable_held'), 0)
             OR b.available != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                         WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='payable_available'), 0)
             OR b.settling != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                        WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='settlement_in_transit'), 0)
          LIMIT 1`,
    args: [],
  });
  if (mismatch.rows.length > 0) {
    await db.execute("UPDATE settings SET value = '1' WHERE key = 'merchant_withdrawals_frozen'");
    invalidateSettingsCache();
    console.error("Merchant balance reconciliation mismatch; withdrawals frozen");
  }
}

async function finishProviderOperation(operationId: string, status: "successful" | "failed", failureCode?: string): Promise<void> {
  await db.execute({
    sql: `UPDATE provider_operations
          SET status = ?, failure_code = ?, terminal_at = datetime('now'), last_checked_at = datetime('now'),
              lease_token = NULL, lease_until = NULL, updated_at = datetime('now')
          WHERE id = ? AND status NOT IN ('successful', 'failed')`,
    args: [status, failureCode ?? null, operationId],
  });
}

/** A customer payment the provider still reports as pending after the admin-set wait. Only collections time out: a
 * payout that is slow to confirm is never given up on, because the money may already have left. */
async function pendingTooLong(payment: Row): Promise<boolean> {
  if (payment.type !== "collection") return false;
  const minutes = await getPaymentsPendingTimeoutMinutes();
  if (minutes <= 0) return false;
  const createdAt = Date.parse(`${String(payment.created_at).replace(" ", "T")}Z`);
  return Number.isFinite(createdAt) && Date.now() - createdAt >= minutes * 60_000;
}

const TIMED_OUT = "timed_out";

/**
 * A collection that timed out is shown to the customer as failed, but the provider may still take the money if the
 * customer approves the prompt late. For the admin-set number of hours (payments_late_watch_hours) the operation stays
 * open: each check asks the provider again, and a late approval is credited to the customer's Peebee wallet, once.
 * A wallet credit (not a provider refund) is instant, free, and cannot collide with a retry or another order.
 */
async function watchLatePayment(payment: Row, op: Row): Promise<DbPaymentStatus> {
  const paymentId = String(payment.id);
  let status: DbPaymentStatus;
  try {
    status = await checkPaymentStatus({
      provider: String(payment.provider),
      provider_ref: payment.provider_ref as string | null,
      created_at: String(payment.created_at),
      type: "collection",
    });
  } catch (err) {
    console.error("Late-payment check failed", paymentId, err);
    await markOperationProgress(op, "unknown");
    return "failed";
  }

  if (status === "failed") {
    await finishProviderOperation(String(op.id), "failed", "provider_confirmed_failed");
    return "failed";
  }

  if (status === "successful") {
    // Claim the credit first: only the check that flips the operation to terminal goes on to credit, so a webhook and the
    // sweep arriving together cannot credit twice.
    const claim = await db.execute({
      sql: `UPDATE provider_operations
            SET status = 'successful', failure_code = 'late_credited', terminal_at = datetime('now'), last_checked_at = datetime('now'),
                lease_token = NULL, lease_until = NULL, updated_at = datetime('now')
            WHERE id = ? AND status NOT IN ('successful', 'failed')`,
      args: [String(op.id)],
    });
    if (claim.rowsAffected === 0) return "failed";

    try {
      const order = (await db.execute({ sql: "SELECT customer_id FROM orders WHERE id = ?", args: [String(payment.order_id)] })).rows[0] as Row | undefined;
      if (!order?.customer_id) throw new Error("order has no customer to credit");
      const amount = Number(payment.amount);
      await creditWallet(String(order.customer_id), amount, {
        type: "refund",
        environment: String(op.environment) as PlatformEnvironment,
        orderId: String(payment.order_id),
        note: `Payment received after the time limit (ref ${paymentId}) — added to your wallet`,
      });
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, (SELECT stage FROM orders WHERE id = ?), ?, NULL)",
        args: [newId("evt"), String(payment.order_id), String(payment.order_id), `Late payment of UGX ${amount.toLocaleString("en-US")} approved after the time limit; credited to the customer's wallet.`],
      });
      notifyUser(String(order.customer_id), {
        title: "Your payment arrived",
        body: `Your UGX ${amount.toLocaleString("en-US")} payment came in after the time limit, so we added it to your Peebee wallet. Use it to pay for your order.`,
        url: "/wallet",
        tag: `late-payment-${paymentId}`,
      }).catch(() => {});
    } catch (err) {
      // The credit did not land: reopen the operation so the next check tries again rather than losing the money.
      console.error("Late-payment wallet credit failed; will retry", paymentId, err);
      await db.execute({
        sql: `UPDATE provider_operations SET status = 'unknown', failure_code = ?, terminal_at = NULL, next_check_at = datetime('now', '+2 minutes'), updated_at = datetime('now')
              WHERE id = ?`,
        args: [TIMED_OUT, String(op.id)],
      });
    }
    return "failed";
  }

  // Still pending: keep watching until the window closes.
  const hours = await getPaymentsLateWatchHours();
  const createdAt = Date.parse(`${String(payment.created_at).replace(" ", "T")}Z`);
  const timeoutMinutes = await getPaymentsPendingTimeoutMinutes();
  const closesAt = createdAt + (timeoutMinutes * 60 + hours * 3600) * 1000;
  if (hours <= 0 || (Number.isFinite(closesAt) && Date.now() >= closesAt)) {
    await finishProviderOperation(String(op.id), "failed", "late_window_closed");
  } else {
    await markOperationProgress(op, "pending");
  }
  return "failed";
}

/** `forceTimeout` is for the stuck-funding sweep: a collection the provider still reports as pending is given up on now
 * (failed, kept open for the late-approval watch) instead of waiting for the admin-set pending timeout. */
export async function reconcilePayment(paymentId: string, actorId: string, opts: { forceTimeout?: boolean } = {}): Promise<DbPaymentStatus> {
  const result = await db.execute({ sql: "SELECT * FROM payments WHERE id = ?", args: [paymentId] });
  const payment = result.rows[0] as Row | undefined;
  if (!payment) throw new Error("Payment not found");
  const operation = await db.execute({
    sql: "SELECT * FROM provider_operations WHERE business_type = 'payment' AND business_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [paymentId],
  });
  const op = operation.rows[0] as Row | undefined;
  // A pickup in a one-payment combined delivery has no provider request of its own:
  // it follows the first pickup's collection.
  if (payment.provider === BUNDLE_CHILD_PROVIDER && payment.provider_ref) {
    await reconcilePayment(String(payment.provider_ref), actorId, opts);
    const refreshed = await db.execute({ sql: "SELECT status FROM payments WHERE id = ?", args: [paymentId] });
    return String((refreshed.rows[0] as Row | undefined)?.status ?? payment.status) as DbPaymentStatus;
  }
  if (payment.status === "failed" && payment.type === "collection" && op && op.failure_code === TIMED_OUT && !["successful", "failed"].includes(String(op.status))) {
    return watchLatePayment(payment, op);
  }
  if (payment.status === "successful" || payment.status === "failed") {
    if (payment.status === "successful" && payment.type === "collection" && op && !["successful", "failed"].includes(String(op.status))) {
      await activateMerchantAllocationsForFundedOrder(String(payment.order_id));
      await finishProviderOperation(String(op.id), "successful");
    }
    if (payment.type === "collection") await finishBundleChildren(paymentId, payment.status as "successful" | "failed", actorId);
    return payment.status as DbPaymentStatus;
  }

  let timedOut = false;
  let status: DbPaymentStatus;
  try {
    status = await checkPaymentStatus({
      provider: String(payment.provider),
      provider_ref: payment.provider_ref as string | null,
      created_at: String(payment.created_at),
      type: payment.type as "collection" | "disbursement" | "refund" | undefined,
    });
  } catch (err) {
    // A provider that errors must not keep an order locked: when giving up is forced, an unanswered check counts as pending.
    if (!opts.forceTimeout) throw err;
    console.warn("Provider check failed while forcing a payment time-out", paymentId, err);
    status = "pending";
  }
  if ((status === "pending" || status === "unknown") && (opts.forceTimeout || (await pendingTooLong(payment)))) {
    // The provider never answered (no prompt reached the phone, or it was ignored): stop waiting so the customer can try again.
    console.warn("Collection timed out while pending; marking failed", paymentId);
    status = "failed";
    timedOut = true;
  }
  if (status === "pending" || status === "unknown") {
    if (op) await markOperationProgress(op, status);
    return status;
  }

  if (status === "failed") {
    await db.execute({
      sql: "UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
      args: [paymentId],
    });
    // A relay paid before any rider goes back to waiting, so it can be paid again or expire.
    if (payment.type === "collection") {
      await db.execute({
        // With a rider already attached the order goes back to Match (where it was before the customer tried to pay), not
        // left at Fund; the unpaid-assignment sweep then frees the rider if the customer never pays.
        sql: "UPDATE orders SET stage = CASE WHEN rider_id IS NULL THEN 'Create' ELSE 'Match' END, updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'",
        args: [String(payment.order_id)],
      });
    }
    if (op) {
      if (timedOut && (await getPaymentsLateWatchHours()) > 0) {
        // Not terminal: keep the operation open so a late approval is still found (see watchLatePayment).
        await db.execute({
          sql: `UPDATE provider_operations SET status = 'unknown', failure_code = ?, next_check_at = datetime('now', '+5 minutes'),
                lease_token = NULL, lease_until = NULL, updated_at = datetime('now') WHERE id = ?`,
          args: [TIMED_OUT, String(op.id)],
        });
      } else {
        await finishProviderOperation(String(op.id), "failed", timedOut ? TIMED_OUT : "provider_confirmed_failed");
      }
    }
    await finishBundleChildren(paymentId, "failed", actorId);
    return status;
  }

  const statements: DbStatement[] = [
    {
      sql: "UPDATE payments SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
      args: [paymentId],
    },
  ];
  if (payment.type === "collection") {
    statements.push(
      {
        // A relay paid before any rider waits in Match, escrow held, until assignRider starts it.
        sql: "UPDATE orders SET stage = CASE WHEN rider_id IS NULL THEN 'Match' ELSE 'Shop' END, updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'",
        args: [String(payment.order_id)],
      },
      {
        sql: `INSERT OR IGNORE INTO order_events (id, order_id, stage, note, actor_id)
              SELECT ?, ?, stage, CASE WHEN stage = 'Shop' THEN (CASE WHEN is_ride = 1 THEN 'Escrow funded — ride started' ELSE 'Escrow funded — shopping started' END) ELSE 'Escrow funded — held until a rider is assigned' END, ?
              FROM orders WHERE id = ? AND (stage = 'Shop' OR (stage = 'Match' AND rider_id IS NULL))`,
        args: [`evt_payment_${paymentId}`, String(payment.order_id), actorId, String(payment.order_id)],
      },
    );
  }
  await executeBatch(statements);
  if (payment.type === "collection") {
    await activateMerchantAllocationsForFundedOrder(String(payment.order_id));
    await finishBundleChildren(paymentId, "successful", actorId);
    void notifyGuest(String(payment.order_id), "paid");
  }
  if (op) await finishProviderOperation(String(op.id), "successful");
  return status;
}

export async function reconcileMerchantSettlement(settlementId: string): Promise<DbPaymentStatus> {
  const result = await db.execute({ sql: "SELECT * FROM merchant_settlements WHERE id = ?", args: [settlementId] });
  const settlement = result.rows[0] as Row | undefined;
  if (!settlement) throw new Error("Merchant settlement not found");
  if (settlement.status === "successful" || settlement.status === "failed") {
    return settlement.status as DbPaymentStatus;
  }

  const status = await checkPaymentStatus({
    provider: String(settlement.provider),
    provider_ref: settlement.provider_ref as string | null,
    created_at: String(settlement.created_at),
    type: "disbursement",
  });
  const operationResult = await db.execute({
    sql: "SELECT * FROM provider_operations WHERE business_type = 'merchant_settlement' AND business_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [settlementId],
  });
  const operation = operationResult.rows[0] as Row | undefined;
  if (status === "pending" || status === "unknown") {
    await db.execute({
      sql: "UPDATE merchant_settlements SET status = ?, updated_at = datetime('now') WHERE id = ? AND status NOT IN ('successful', 'failed')",
      args: [status, settlementId],
    });
    if (operation) await markOperationProgress(operation, status);
    return status;
  }

  const totalDebit = Number(settlement.total_debit);
  const amount = Number(settlement.amount);
  const fee = Number(settlement.fee);
  const merchantId = String(settlement.merchant_id);
  const environment = settlement.environment as PlatformEnvironment;
  const success = status === "successful";
  const postings = merchantSettlementPostings({
    success,
    merchantId,
    provider: String(settlement.provider),
    amount,
    fee,
    environment,
  });

  await postLedgerTransaction({
    kind: success ? "merchant_settlement_paid" : "merchant_settlement_failed",
    idempotencyKey: `merchant-settlement:${settlementId}:${status}`,
    environment,
    referenceType: "merchant_settlement",
    referenceId: settlementId,
    postings,
    additionalStatements: [
      {
        sql: success
          ? "UPDATE merchant_balances SET settling = settling - ?, updated_at = datetime('now') WHERE merchant_id = ? AND environment = ?"
          : "UPDATE merchant_balances SET settling = settling - ?, available = available + ?, updated_at = datetime('now') WHERE merchant_id = ? AND environment = ?",
        args: success ? [totalDebit, merchantId, environment] : [totalDebit, totalDebit, merchantId, environment],
      },
      {
        sql: "UPDATE merchant_settlements SET status = ?, failure_code = ?, updated_at = datetime('now') WHERE id = ?",
        args: [status, success ? null : "provider_confirmed_failed", settlementId],
      },
    ],
  });
  if (operation) await finishProviderOperation(String(operation.id), success ? "successful" : "failed", success ? undefined : "provider_confirmed_failed");
  return status;
}

export async function sweepProviderOperations(limit = 50): Promise<{ checked: number; failed: number }> {
  const due = await db.execute({
    sql: `SELECT * FROM provider_operations
          WHERE status IN ('submitted', 'pending', 'unknown')
            AND next_check_at <= datetime('now')
            AND (lease_until IS NULL OR lease_until < datetime('now'))
          ORDER BY next_check_at LIMIT ?`,
    args: [limit],
  });
  let checked = 0;
  let failed = 0;
  for (const raw of due.rows) {
    const operation = raw as Row;
    const leaseToken = newId("lease");
    const claimed = await db.execute({
      sql: `UPDATE provider_operations SET lease_token = ?, lease_until = datetime('now', '+90 seconds')
            WHERE id = ? AND status IN ('submitted', 'pending', 'unknown')
              AND (lease_until IS NULL OR lease_until < datetime('now'))`,
      args: [leaseToken, String(operation.id)],
    });
    if (claimed.rowsAffected === 0) continue;
    checked += 1;
    try {
      if (operation.business_type === "payment") await reconcilePayment(String(operation.business_id), "provider-poller");
      else if (operation.business_type === "merchant_settlement") await reconcileMerchantSettlement(String(operation.business_id));
      else throw new Error(`Unsupported provider operation ${String(operation.business_type)}`);
    } catch (error) {
      failed += 1;
      console.error("Provider reconciliation failed", operation.id, error);
      await db.execute({
        sql: `UPDATE provider_operations SET status = 'unknown', lease_token = NULL, lease_until = NULL,
              attempt_count = attempt_count + 1, next_check_at = ?, last_checked_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ? AND lease_token = ?`,
        args: [nextCheckIso(Number(operation.attempt_count) + 1), String(operation.id), leaseToken],
      });
    }
  }
  await enforceMerchantReconciliationGuard();
  return { checked, failed };
}
