import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
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
