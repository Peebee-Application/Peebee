import { executeBatch } from "../db/client.js";

/** Reserve the rider and resolve applications in one transaction, across every matching mode. */
export async function assignAvailableRider(
  orderId: string, riderId: string, nextStage: string, outOfRange: boolean, environment: string,
): Promise<boolean> {
  const changes = await executeBatch([
    {
      sql: `UPDATE orders SET rider_id = ?, stage = ?, matched_out_of_range = ?, updated_at = datetime('now')
            WHERE id = ? AND environment = ? AND rider_id IS NULL AND stage IN ('Create', 'Match')
            AND NOT EXISTS (SELECT 1 FROM orders busy WHERE busy.rider_id = ?
              AND busy.environment = ? AND busy.stage NOT IN ('Settle', 'Cancelled'))`,
      args: [riderId, nextStage, outOfRange ? 1 : 0, orderId, environment, riderId, environment],
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
