import { roundFare } from "@peebee/shared";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { getCarServicePricing, getPlatformEnvironment } from "../lib/settings.js";

export type CarServiceTier = "convenient" | "comfort" | "xl";
export type CarVehicleSize = "normal" | "large";
export type TierVehicle = { service_class: unknown; accepts_convenient: unknown; seat_capacity: unknown; lat: unknown; lng: unknown };

export function acceptsTier(vehicle: TierVehicle, tier: CarServiceTier, xlMinSeats: number, size?: CarVehicleSize): boolean {
  const seats = Number(vehicle.seat_capacity);
  if (size === "large" && seats < 5) return false;
  if (size === "normal" && seats >= 5) return false;
  // Legacy XL bookings are retained as large, convenient rides.
  if (tier === "xl") return seats >= xlMinSeats;
  if (tier === "comfort") return vehicle.service_class === "comfort";
  return vehicle.service_class !== "comfort" || Number(vehicle.accepts_convenient) === 1;
}

export function tierFare(distanceKm: number, tier: CarServiceTier, pricing: Awaited<ReturnType<typeof getCarServicePricing>>, size?: CarVehicleSize): number {
  const base = roundFare(distanceKm * pricing.ratePerKm, pricing.minimumFare);
  const comfortPremium = tier === "comfort" ? pricing.comfortPremiumPercent : 0;
  const sizePremium = size === "large" || tier === "xl" ? pricing.xlPremiumPercent : 0;
  return roundFare(base * (1 + comfortPremium / 100) * (1 + sizePremium / 100), 0);
}

/** Online, free drivers with a pickup location in the customer's radius. */
export async function nearbyTierCounts(lat: number, lng: number, radiusKm: number, xlMinSeats: number): Promise<Record<CarVehicleSize, Record<Exclude<CarServiceTier, "xl">, number>>> {
  const environment = await getPlatformEnvironment();
  const result = await db.execute({
    sql: `SELECT s.lat, s.lng, v.service_class, v.accepts_convenient, v.seat_capacity
          FROM car_driver_state s
          JOIN car_partners p ON p.user_id = s.driver_id AND p.driver_status = 'approved'
          JOIN vehicles v ON v.id = s.vehicle_id AND v.status = 'approved'
          JOIN vehicle_categories cat ON cat.id = v.category_id AND cat.kind = 'passenger'
          JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.driver_id = s.driver_id AND a.status = 'active'
          WHERE s.online = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
            AND s.driver_id NOT IN (SELECT rider_id FROM orders WHERE rider_id IS NOT NULL AND environment = ? AND stage NOT IN ('Settle', 'Cancelled'))`,
    args: [environment],
  });
  const counts: Record<CarVehicleSize, Record<Exclude<CarServiceTier, "xl">, number>> = {
    normal: { convenient: 0, comfort: 0 }, large: { convenient: 0, comfort: 0 },
  };
  for (const row of result.rows) {
    const vehicle = row as unknown as TierVehicle;
    if (haversineKm(lat, lng, Number(vehicle.lat), Number(vehicle.lng)) > radiusKm) continue;
    for (const size of ["normal", "large"] as const) for (const tier of ["convenient", "comfort"] as const) {
      if (acceptsTier(vehicle, tier, xlMinSeats, size)) counts[size][tier]++;
    }
  }
  return counts;
}
