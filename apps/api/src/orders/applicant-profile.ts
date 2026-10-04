import type { RiderApplicantProfile } from "@peebee/shared";
import { db } from "../db/client.js";

export async function getApplicantProfile(riderId: string, environment: string, offset: number): Promise<RiderApplicantProfile | null> {
  const [rider, totals, reviews] = await Promise.all([
    db.execute({
      sql: `SELECT u.name, r.created_at, r.verified, r.vehicle_info, r.area
            FROM riders r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`,
      args: [riderId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS total, SUM(is_ride = 1) AS rides,
                   SUM(type = 'parcel' AND is_ride = 0) AS parcels,
                   SUM(type = 'shopping' AND restaurant_id IS NOT NULL) AS food,
                   SUM(type = 'shopping' AND restaurant_id IS NULL) AS shopping
            FROM orders WHERE rider_id = ? AND environment = ? AND stage = 'Settle'`,
      args: [riderId, environment],
    }),
    db.execute({
      sql: `SELECT r.id, r.rating, r.comment, r.recommended, r.created_at
            FROM order_ratings r JOIN orders o ON o.id = r.order_id
            WHERE r.rider_id = ? AND o.environment = ?
            ORDER BY r.created_at DESC, r.id DESC LIMIT 21 OFFSET ?`,
      args: [riderId, environment, offset],
    }),
  ]);
  const person = rider.rows[0];
  if (!person) return null;
  const counts = totals.rows[0];
  return {
    riderId, riderName: String(person.name), joinedAt: String(person.created_at),
    verified: Boolean(person.verified), vehicleInfo: person.vehicle_info as string | null, area: person.area as string | null,
    completed: {
      total: Number(counts.total ?? 0), rides: Number(counts.rides ?? 0), parcels: Number(counts.parcels ?? 0),
      food: Number(counts.food ?? 0), shopping: Number(counts.shopping ?? 0),
    },
    reviews: reviews.rows.slice(0, 20).map((row) => ({
      id: String(row.id), rating: Number(row.rating), comment: row.comment as string | null,
      recommended: Boolean(row.recommended), createdAt: String(row.created_at),
    })),
    nextOffset: reviews.rows.length > 20 ? offset + 20 : null,
  };
}
