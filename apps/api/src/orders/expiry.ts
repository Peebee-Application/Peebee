import { db } from "../db/client.js";
import { getJobExpirySettings, jobExpiryMinutes } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { cancelCustomerOrder, getOrderTimeFees } from "./time-fees.js";

type Row = Record<string, unknown>;

/** Stages where nobody has taken the job yet. A job a rider has already
 * accepted (rider_id set) is being served and is never expired here. */
const UNSERVED_STAGES = "('Create', 'Match', 'Fund')";

/** Expires jobs that no rider took within the admin-set time: they are
 * cancelled with no fee and anything the customer already paid is returned
 * to their wallet (same path as a customer cancellation). Runs from the
 * scheduled worker; does nothing unless an admin has switched it on. */
export async function sweepExpiredOrders(): Promise<{ expired: number; skipped: number }> {
  const settings = await getJobExpirySettings();
  if (!settings.enabled) return { expired: 0, skipped: 0 };
  const minutes = jobExpiryMinutes(settings);

  const due = await db.execute({
    sql: `SELECT * FROM orders
          WHERE stage IN ${UNSERVED_STAGES} AND rider_id IS NULL
            AND created_at <= datetime('now', ?)
          ORDER BY created_at LIMIT 100`,
    args: [`-${minutes} minutes`],
  });

  let expired = 0;
  let skipped = 0;
  for (const order of due.rows as Row[]) {
    try {
      // acceptedFee must equal what's due; with no rider it is 0, and a
      // payment still processing makes canCancel false, so it waits a sweep.
      const quote = await getOrderTimeFees(order);
      const label = settings.unit === "hours" ? `${settings.value} hour${settings.value === 1 ? "" : "s"}` : `${settings.value} minutes`;
      const result = quote.canCancel
        ? await cancelCustomerOrder(order, null, quote.cancellationDue, {
            eventNote: `Expired: no rider took this job within ${label}.`,
          })
        : { error: "not_cancellable" };
      if (result.error) {
        skipped += 1;
        continue;
      }
      expired += 1;
      if (order.customer_id) {
        notifyUser(order.customer_id as string, {
          title: "Your order expired",
          body: `No rider took it within ${label}. Anything you paid has been returned to your wallet.`,
          url: `/orders/${order.id}`,
          tag: `order-${order.id}`,
        }).catch(() => {});
      }
    } catch (err) {
      skipped += 1;
      console.error("Order expiry failed for", order.id, err);
    }
  }
  return { expired, skipped };
}
