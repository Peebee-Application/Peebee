import type { RiderApplicantProfile } from "@peebee/shared";
import { db } from "../db/client.js";
import { hasColumn, hasTable } from "../lib/schema.js";

export async function getApplicantProfile(riderId: string, environment: string, offset: number): Promise<RiderApplicantProfile | null> {
  // The bio column arrives with a hand-applied migration; until then the profile just has none.
  const hasBio = await hasColumn("riders", "bio");
  const hasStages = (await hasTable("stage_members")) && (await hasTable("stages"));
  const [rider, totals, reviews, rated, stage] = await Promise.all([
    db.execute({
      sql: `SELECT u.name, r.created_at, r.verified, r.vehicle_info, r.area${hasBio ? ", r.bio" : ""}
            FROM riders r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`,
      args: [riderId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS total, SUM(is_ride = 1) AS rides,
                   SUM(type = 'parcel' AND is_ride = 0) AS parcels,
                   SUM(type = 'shopping' AND restaurant_id IS NOT NULL) AS food,
                   SUM(type = 'shopping' AND restaurant_id IS NULL) AS shopping,
                   COALESCE(SUM(distance_km), 0) AS km
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
    // Every rating, not just the page of reviews being shown.
    db.execute({
      sql: `SELECT COUNT(*) AS n, AVG(r.rating) AS avg, SUM(r.recommended) AS rec
            FROM order_ratings r JOIN orders o ON o.id = r.order_id WHERE r.rider_id = ? AND o.environment = ?`,
      args: [riderId, environment],
    }),
    // The boda stage they belong to (their longest-standing active membership).
    hasStages
      ? db.execute({
          sql: `SELECT s.name, s.area, m.role FROM stage_members m JOIN stages s ON s.id = m.stage_id
                WHERE m.rider_id = ? AND m.status = 'active' AND s.status = 'active'
                ORDER BY m.joined_at ASC LIMIT 1`,
          args: [riderId],
        })
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  const person = rider.rows[0];
  if (!person) return null;
  const counts = totals.rows[0];
  return {
    riderId, riderName: String(person.name), joinedAt: String(person.created_at),
    verified: Boolean(person.verified), vehicleInfo: person.vehicle_info as string | null, area: person.area as string | null,
    stage: stage.rows[0]
      ? { name: String(stage.rows[0].name), area: (stage.rows[0].area as string | null) ?? null, role: String(stage.rows[0].role) }
      : null,
    bio: hasBio && typeof person.bio === "string" && person.bio.trim() ? person.bio.trim() : null,
    // The route distance of every finished job, added up.
    totalKm: Math.round(Number(counts.km ?? 0)),
    avgRating: rated.rows[0]?.avg == null ? null : Math.round(Number(rated.rows[0].avg) * 10) / 10,
    reviewCount: Number(rated.rows[0]?.n ?? 0),
    recommendCount: Number(rated.rows[0]?.rec ?? 0),
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
