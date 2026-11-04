import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { reconcilePayment } from "../payments/reconciliation.js";
import { getMatchingSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";

type Row = Record<string, unknown>;

/**
 * Frees a rider who was matched to an order its customer never paid for.
 *
 * A rider is attached to an order the moment they accept it, but an escrow order is only funded afterwards, when the
 * customer pays. If the customer walks away (or their payment keeps failing) the order sits at "Match" with the rider
 * still on it, and while it does the rider cannot apply for or claim anything else. The job-expiry sweep leaves such an
 * order alone on purpose, because a rider has taken it.
 *
 * After the admin-set number of minutes with no change to the order and no payment made or in progress, the rider is
 * released and the order goes back to the pool for the customer to match again. Nothing has been paid, so nothing is
 * refunded and the rider is not penalised. A payment that is pending is never interrupted. Plain orders only: car
 * rides, relayed parcels and combined deliveries have extra state and are left for a person to handle. Off at 0 minutes.
 */
export async function sweepUnpaidAssignments(): Promise<{ released: number; skipped: number }> {
  const { unpaidMatchReleaseMinutes: minutes } = await getMatchingSettings();
  if (minutes <= 0) return { released: 0, skipped: 0 };

  const extra: string[] = [];
  if (await hasTable("car_bookings")) extra.push("NOT EXISTS (SELECT 1 FROM car_bookings cb WHERE cb.order_id = orders.id)");
  if (await hasTable("order_relay_legs")) extra.push("NOT EXISTS (SELECT 1 FROM order_relay_legs rl WHERE rl.order_id = orders.id)");
  if (await hasColumn("orders", "delivery_bundle_id")) extra.push("delivery_bundle_id IS NULL");

  const unpaid = "NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.type = 'collection' AND p.status IN ('pending', 'unknown', 'successful'))";
  const due = await db.execute({
    sql: `SELECT id, rider_id, customer_id FROM orders
          WHERE stage = 'Match' AND rider_id IS NOT NULL AND payment_rail = 'escrow'
            AND updated_at <= datetime('now', ?)
            AND ${unpaid}
            ${extra.map((clause) => `AND ${clause}`).join(" ")}
          ORDER BY updated_at LIMIT 100`,
    args: [`-${minutes} minutes`],
  });

  let released = 0;
  let skipped = 0;
  for (const order of due.rows as Row[]) {
    try {
      const id = String(order.id);
      const riderId = String(order.rider_id);
      // The same conditions again, in the one statement that frees the rider: a payment that started since the read
      // above, or a rider change, leaves the order exactly as it is.
      const result = await db.execute({
        sql: `UPDATE orders SET rider_id = NULL, stage = 'Create', matched_out_of_range = 0, updated_at = datetime('now')
              WHERE id = ? AND stage = 'Match' AND rider_id = ? AND ${unpaid}`,
        args: [id, riderId],
      });
      if (result.rowsAffected === 0) {
        skipped += 1;
        continue;
      }
      await db.execute({ sql: "DELETE FROM rider_order_locks WHERE rider_id = ? AND order_id = ?", args: [riderId, id] }).catch(() => undefined);
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Create', ?, NULL)",
        args: [newId("evt"), id, `Rider released: the order was not paid within ${minutes} minutes of being matched. It is open to riders again.`],
      });
      released += 1;
      notifyUser(riderId, {
        title: "Job released",
        body: "The customer didn't pay in time, so this job is open to other riders again. You're free to take another.",
        url: "/",
        tag: `released-${id}`,
      }).catch(() => {});
      if (order.customer_id) {
        notifyUser(String(order.customer_id), {
          title: "Your rider was released",
          body: `You didn't pay within ${minutes} minutes, so your order is open to riders again. Pick a rider to continue.`,
          url: `/orders/${id}`,
          tag: `released-${id}`,
        }).catch(() => {});
      }
    } catch (err) {
      skipped += 1;
      console.error("Unpaid-assignment release failed for", order.id, err);
    }
  }
  return { released, skipped };
}

/**
 * Unlocks an order stuck at "Funding".
 *
 * Paying moves an order to "Fund" and waits for the payment to settle. If that never happens (the provider keeps
 * answering "pending", the callback was lost, or the payment row never settled the order), the order sits there with
 * its rider attached: the rider cannot take another job, the customer cannot book another, and neither can cancel,
 * because cancelling is only offered before a rider is attached and the other sweeps skip "Fund".
 *
 * After the admin-set minutes at "Fund" with no change, each payment still pending is checked with the provider one
 * last time and, if it is still pending, given up on exactly as a normal payment time-out is (the customer may still be
 * credited to their wallet if they approve it late). Then:
 *  - a payment that did succeed moves the order on (rider: shopping/ride starts; no rider: waits in Match), and
 *  - an order with no successful or live payment goes back to "Match" (rider attached) or "Create" (no rider), where
 *    the customer can pay again and the unpaid-assignment sweep frees the rider if they don't.
 * Nothing is charged and nobody is penalised. Combined deliveries are left for a person. Off at 0 minutes.
 */
export async function sweepStuckFunding(): Promise<{ released: number; skipped: number }> {
  const { stuckFundingReleaseMinutes: minutes } = await getMatchingSettings();
  if (minutes <= 0) return { released: 0, skipped: 0 };

  const bundled = (await hasColumn("orders", "delivery_bundle_id")) ? "AND delivery_bundle_id IS NULL" : "";
  const due = await db.execute({
    sql: `SELECT id, rider_id, customer_id FROM orders
          WHERE stage = 'Fund' AND updated_at <= datetime('now', ?) ${bundled}
          ORDER BY updated_at LIMIT 100`,
    args: [`-${minutes} minutes`],
  });

  let released = 0;
  let skipped = 0;
  for (const order of due.rows as Row[]) {
    try {
      const id = String(order.id);
      const live = await db.execute({ sql: "SELECT id FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'pending'", args: [id] });
      for (const payment of live.rows as Row[]) {
        await reconcilePayment(String(payment.id), "system", { forceTimeout: true }).catch((err) => console.error("Stuck funding check failed for", payment.id, err));
      }

      const current = (await db.execute({ sql: "SELECT stage, rider_id FROM orders WHERE id = ?", args: [id] })).rows[0] as Row | undefined;
      if (!current || current.stage !== "Fund") {
        // The check above already moved it on (paid or failed).
        released += current ? 1 : 0;
        continue;
      }
      const pay = await db.execute({
        sql: `SELECT SUM(status = 'successful') AS paid, SUM(status = 'pending') AS pending FROM payments WHERE order_id = ? AND type = 'collection'`,
        args: [id],
      });
      const paid = Number((pay.rows[0] as Row | undefined)?.paid ?? 0) > 0;
      const pending = Number((pay.rows[0] as Row | undefined)?.pending ?? 0) > 0;
      if (pending) {
        skipped += 1; // a payment could not be settled this run; try again next sweep
        continue;
      }
      const riderId = current.rider_id ? String(current.rider_id) : null;
      const next = paid ? (riderId ? "Shop" : "Match") : riderId ? "Match" : "Create";
      const result = await db.execute({
        sql: `UPDATE orders SET stage = ?, updated_at = datetime('now') WHERE id = ? AND stage = 'Fund'
              AND ${paid ? "1 = 1" : "NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.type = 'collection' AND p.status IN ('pending', 'successful'))"}`,
        args: [next, id],
      });
      if (result.rowsAffected === 0) {
        skipped += 1;
        continue;
      }
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, ?, ?, NULL)",
        args: [
          newId("evt"),
          id,
          next,
          paid
            ? "Payment confirmed — the order was stuck at Funding and has been moved on."
            : `Funding released: the payment did not complete within ${minutes} minutes. The order is open to pay again.`,
        ],
      });
      released += 1;
      if (!paid && order.customer_id) {
        notifyUser(String(order.customer_id), {
          title: "Your payment didn't complete",
          body: "We've unlocked your order — you can pay again or cancel it. If money left your account, it is credited to your Peebee wallet.",
          url: `/orders/${id}`,
          tag: `funding-${id}`,
        }).catch(() => {});
      }
    } catch (err) {
      skipped += 1;
      console.error("Stuck-funding release failed for", order.id, err);
    }
  }
  return { released, skipped };
}
