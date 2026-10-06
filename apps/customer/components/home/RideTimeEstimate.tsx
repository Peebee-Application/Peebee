"use client";
import { travelMinutes } from "@peebee/shared";
import { useRoadRoute } from "../../lib/useRoadRoute";

export function RideTimeEstimate({ pickupLat, pickupLng, destinationLat, destinationLng }: {
  pickupLat: number | null | undefined; pickupLng: number | null | undefined;
  destinationLat: number | null | undefined; destinationLng: number | null | undefined;
}) {
  const result = useRoadRoute(pickupLat, pickupLng, destinationLat, destinationLng);
  const minutes = result ? travelMinutes(result.route.durationSeconds) : null;
  return <div className="rounded-2xl border border-[var(--border-faint)] px-4 py-3">
    <p className="text-sm font-semibold text-ink">{minutes ? `Approximately ${minutes} min ride` : "Ride time estimate unavailable"}</p>
    <p className="mt-1 text-xs text-ink-500">Pickup arrival time appears once your rider is assigned and sharing location. Road estimate excludes live traffic.</p>
  </div>;
}
