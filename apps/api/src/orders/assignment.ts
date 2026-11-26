import { executeBatch } from "../db/client.js";
import { hasColumn } from "../lib/schema.js";

/** Reserve the rider and resolve applications in one transaction, across every matching mode. */
/** SQL: this order (the `orders` row being updated) is on escrow and its collection has succeeded. */
export const PAID_ESCROW = "orders.payment_rail = 'escrow' AND EXISTS (SELECT 1 FROM payments paid WHERE paid.order_id = orders.id AND paid.type = 'collection' AND paid.status = 'successful')";

export async function assignAvailableRider(
  orderId: string, riderId: string, nextStage: string, outOfRange: boolean, environment: string,
): Promise<boolean> {
  const clearLocation = await hasColumn("orders", "rider_location_updated_at")
    ? ", rider_lat = NULL, rider_lng = NULL, rider_location_updated_at = NULL" : "";
  const changes = await executeBatch([
    {
      // An escrow order that is already paid (a relay paid before any rider) goes straight to
      // Shop; deciding it in the same statement means a payment can't slip in between.
      sql: `UPDATE orders SET rider_id = ?, stage = CASE WHEN ${PAID_ESCROW} THEN 'Shop' ELSE ? END, matched_out_of_range = ?, updated_at = datetime('now')${clearLocation}
            WHERE id = ? AND environment = ? AND rider_id IS NULL AND stage IN ('Create', 'Match')
            AND (customer_id IS NULL OR customer_id <> ?)
            AND NOT EXISTS (SELECT 1 FROM orders busy WHERE busy.rider_id = ?
              AND busy.environment = ? AND busy.stage NOT IN ('Settle', 'Cancelled'))`,
      args: [riderId, nextStage, outOfRange ? 1 : 0, orderId, environment, riderId, riderId, environment],
    },
    {
      sql: `UPDATE order_applications SET status = CASE
              WHEN order_id = ? AND rider_id = ? THEN 'selected' ELSE 'declined' END
            WHERE status = 'pending'
              AND (order_id = ? OR (rider_id = ? AND order_id IN (SELECT id FROM orders WHERE environment = ?)))
              AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND rider_id = ?)`,
      args: [orderId, riderId, orderId, riderId, environment, orderId, riderId],
    },
  ]);
  return changes[0] > 0;
}
