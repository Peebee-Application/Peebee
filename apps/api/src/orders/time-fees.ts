import { timeFeePolicy, type TimeFeePolicy, type OrderTimeFees } from "@tuma/shared";
import { db, executeBatch, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getTimeFeeSettings } from "../lib/settings.js";

type Row = Record<string, unknown>;
const money = (amount: number) => `UGX ${amount.toLocaleString("en-UG")}`;

export async function snapshotTimeFees(orderId: string, fare: number) {
  const policy = timeFeePolicy(await getTimeFeeSettings(), fare);
  await db.execute({ sql: "UPDATE orders SET time_fee_policy = ? WHERE id = ? AND time_fee_policy IS NULL", args: [JSON.stringify(policy), orderId] });
}

function policyFor(order: Row): TimeFeePolicy {
  return order.time_fee_policy ? JSON.parse(String(order.time_fee_policy)) : { cancellationFee: 0, waitingFee: 0, freeWaitingMinutes: 5 };
}

export function waitingDue(order: Row, now = Date.now()): number {
  if (!order.rider_arrived_at || order.waiting_closed_at || order.stage !== "Arrived") return 0;
  const policy = policyFor(order);
  return now > Date.parse(String(order.rider_arrived_at)) + policy.freeWaitingMinutes * 60_000 ? policy.waitingFee : 0;
}

function cancellationEligible(order: Row): boolean {
  if (order.rider_departed_at) return ["Deliver", "Arrived"].includes(String(order.stage));
  if (order.is_ride) return ["Create", "Match", "Fund", "Shop"].includes(String(order.stage));
  return !order.rider_id && ["Create", "Match"].includes(String(order.stage));
}

export async function getOrderTimeFees(order: Row): Promise<OrderTimeFees> {
  const policy = policyFor(order);
  const [fees, payments] = await Promise.all([
    db.execute({ sql: "SELECT id, kind, amount, note FROM order_time_fees WHERE order_id = ? ORDER BY created_at", args: [String(order.id)] }),
    db.execute({ sql: "SELECT 1 FROM payments WHERE order_id = ? AND (status = 'pending' OR (type IN ('refund', 'disbursement') AND status = 'successful')) LIMIT 1", args: [String(order.id)] }),
  ]);
  const wait = waitingDue(order);
  const start = order.rider_arrived_at ? String(order.rider_arrived_at) : null;
  return {
    ...policy,
    canCancel: cancellationEligible(order) && payments.rows.length === 0,
    // One charge on cancellation, never stack two fees for the same wait.
    cancellationDue: Math.max(order.is_ride && order.rider_departed_at ? policy.cancellationFee : 0, wait),
    waitingStartedAt: start,
    waitingEndsAt: start && !order.waiting_closed_at ? new Date(Date.parse(start) + policy.freeWaitingMinutes * 60_000).toISOString() : null,
    waitingDue: wait,
    charged: fees.rows as unknown as OrderTimeFees["charged"],
  };
}

/** Every write is gated by a unique transition token won by a conditional
 * order update in the SAME transaction. Retries and competing requests
 * cannot debit twice or leave a debit without its ledger record. */
function chargeStatements(order: Row, token: string, kind: "cancellation" | "waiting", amount: number, actorId: string): DbStatement[] {
  if (amount <= 0) return [];
  const id = newId("timefee");
  const column = order.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const note = kind === "cancellation"
    ? `Cancellation fee: ${money(amount)}. Your rider had already set off to pick you up.`
    : `Waiting fee: ${money(amount)}. Your rider waited longer than the ${policyFor(order).freeWaitingMinutes} free minutes.`;
  return [
    {
      sql: `INSERT OR IGNORE INTO order_time_fees (id, order_id, customer_id, rider_id, kind, amount, note, environment)
            SELECT ?, id, customer_id, rider_id, ?, ?, ?, environment FROM orders WHERE id = ? AND time_action_token = ?`,
      args: [id, kind, amount, note, String(order.id), token],
    },
    {
      sql: `UPDATE users SET ${column} = ${column} - ? WHERE id = ? AND EXISTS (SELECT 1 FROM order_time_fees WHERE id = ?)`,
      args: [amount, String(order.customer_id), id],
    },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, note, actor_id, environment)
            SELECT ?, id, 'adjustment', ?, ${column}, ?, ?, ?, ? FROM users
            WHERE id = ? AND EXISTS (SELECT 1 FROM order_time_fees WHERE id = ?)`,
      args: [newId("wl"), -amount, String(order.id), note, actorId, String(order.environment), String(order.customer_id), id],
    },
  ];
}

/** Finish waiting and advance the journey atomically. Waiting fees are
 * separate wallet entries, not added again to the fare or cash due. */
export async function finishWaiting(order: Row, nextStage: "PickedUp" | "Handover", actorId: string): Promise<boolean> {
  const token = newId("transition");
  const now = new Date().toISOString();
  const changes = await executeBatch([
    {
      sql: `UPDATE orders SET stage = ?, waiting_closed_at = COALESCE(waiting_closed_at, ?), time_action_token = ?, updated_at = datetime('now')
            WHERE id = ? AND stage = ? AND rider_id IS ?`,
      args: [nextStage, now, token, String(order.id), String(order.stage), order.rider_id ?? null],
    },
    ...chargeStatements(order, token, "waiting", waitingDue(order, Date.parse(now)), actorId),
  ]);
  return changes[0] > 0;
}

/** Close a rider's waiting period when they leave the stop. The caller can
 * then return the order to the matching pool; the conditional update keeps
 * this fee from being charged twice if the rider retries the action. */
export async function closeWaiting(order: Row, actorId: string): Promise<boolean> {
  if (String(order.stage) !== "Arrived") return true;
  const token = newId("waiting");
  const now = new Date().toISOString();
  const changes = await executeBatch([
    {
      sql: `UPDATE orders SET waiting_closed_at = COALESCE(waiting_closed_at, ?), time_action_token = ?, updated_at = datetime('now')
            WHERE id = ? AND stage = 'Arrived' AND rider_id = ?`,
      args: [now, token, String(order.id), String(order.rider_id)],
    },
    ...chargeStatements(order, token, "waiting", waitingDue(order, Date.parse(now)), actorId),
  ]);
  return changes[0] > 0;
}

export async function cancelCustomerOrder(order: Row, actorId: string, acceptedFee: number): Promise<{ error?: string; fee?: number }> {
  if (order.stage === "Cancelled") return {};
  const quote = await getOrderTimeFees(order);
  if (!quote.canCancel) return { error: "This order cannot be cancelled now. If a payment is processing, wait for it to finish. Otherwise, contact support." };
  if (acceptedFee !== quote.cancellationDue) return { error: "The cancellation fee has changed. Please review the amount and confirm again." };
  const token = newId("cancel");
  const id = String(order.id);
  const column = order.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";

  // A wallet refund must return to its original owner and wallet, including
  // shared/secondary wallets. A mobile-money collection returns to the
  // customer's primary Tuma wallet; it is not an external mobile-money refund.
  const source = await db.execute({ sql: "SELECT user_id, wallet_id FROM wallet_ledger WHERE order_id = ? AND type = 'order_payment' ORDER BY created_at", args: [id] });
  if (source.rows.length > 1) return { error: "This order has multiple wallet payments. Please contact support to cancel it." };
  const owner = String(source.rows[0]?.user_id ?? order.customer_id);
  const walletId = source.rows[0]?.wallet_id as string | null | undefined;
  const refundId = newId("refund");
  const refundColumn = order.environment === "sandbox" ? "balance_sandbox" : "balance";
  const refundAmount = "(SELECT amount FROM payments WHERE id = ?)";
  const changes = await executeBatch([
    {
      sql: `UPDATE orders SET stage = 'Cancelled', waiting_closed_at = COALESCE(waiting_closed_at, ?), time_action_token = ?, updated_at = datetime('now')
            WHERE id = ? AND stage = ? AND rider_id IS ? AND rider_departed_at IS ? AND rider_arrived_at IS ?
            AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND (status = 'pending' OR (type IN ('refund','disbursement') AND status = 'successful')))`,
      args: [new Date().toISOString(), token, id, String(order.stage), order.rider_id ?? null, order.rider_departed_at ?? null, order.rider_arrived_at ?? null, id],
    },
    {
      sql: `INSERT INTO payments (id, order_id, type, provider, amount, currency, status)
            SELECT ?, o.id, 'refund', 'wallet', SUM(p.amount), 'UGX', 'successful'
            FROM orders o JOIN payments p ON p.order_id = o.id AND p.type = 'collection' AND p.status = 'successful'
            WHERE o.id = ? AND o.time_action_token = ? GROUP BY o.id HAVING SUM(p.amount) > 0`,
      args: [refundId, id, token],
    },
    walletId ? {
      sql: `UPDATE wallets SET ${refundColumn} = ${refundColumn} + ${refundAmount} WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM payments WHERE id = ?)`,
      args: [refundId, walletId, owner, refundId],
    } : {
      sql: `UPDATE users SET ${column} = ${column} + ${refundAmount} WHERE id = ? AND EXISTS (SELECT 1 FROM payments WHERE id = ?)`,
      args: [refundId, owner, refundId],
    },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, note, actor_id, environment, wallet_id)
            SELECT ?, ?, 'refund', amount, ${walletId ? `(SELECT ${refundColumn} FROM wallets WHERE id = ?)` : `(SELECT ${column} FROM users WHERE id = ?)`},
              ?, 'Cancelled ride: fare returned to wallet', ?, ?, ? FROM payments WHERE id = ?`,
      args: [newId("wl"), owner, walletId ?? owner, id, actorId, String(order.environment), walletId ?? null, refundId],
    },
    ...chargeStatements(order, token, "cancellation", quote.cancellationDue, actorId),
    {
      sql: "UPDATE lists SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND time_action_token = ?)",
      args: [String(order.list_id), id, token],
    },
    {
      sql: "DELETE FROM rider_order_locks WHERE order_id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND time_action_token = ?)",
      args: [id, id, token],
    },
    {
      sql: `INSERT INTO order_events (id, order_id, stage, note, actor_id)
            SELECT ?, id, 'Cancelled', ?, ? FROM orders WHERE id = ? AND time_action_token = ?`,
      args: [newId("evt"), quote.cancellationDue ? `Cancelled by customer. Cancellation fee: ${money(quote.cancellationDue)}.` : "Cancelled by customer. No cancellation fee.", actorId, id, token],
    },
  ]);
  return changes[0] ? { fee: quote.cancellationDue } : { error: "The journey changed. Refresh the order and review the cancellation again." };
}
