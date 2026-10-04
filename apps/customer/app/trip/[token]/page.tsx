"use client";

import type { SharedTrip } from "@peebee/shared";
import { MapPin, Navigation } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { api } from "../../../lib/api";
import { useTranslate } from "../../../lib/i18n";
import { useLivePolling } from "../../../lib/use-live-polling";

const STATUS: Record<string, string> = {
  Create: "Finding your driver",
  Match: "Driver on the way",
  Shop: "Finding your driver",
  Deliver: "Driver heading to you",
  Arrived: "Your driver is here",
  Handover: "On your trip",
  Settle: "Trip complete",
  Cancelled: "Trip cancelled",
};

/** The passenger's page for a ride someone booked for them. Public — the link
 * itself is the credential — so it shows only the driver's first name, the
 * route and progress. */
export default function TripPage() {
  const { token } = useParams<{ token: string }>();
  const t = useTranslate();
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTrip((await api.getSharedTrip(token)).trip);
    } catch {
      setMissing(true);
    }
  }, [token]);
  useLivePolling(() => void load(), 10_000, [load]);

  if (missing) return <p className="p-6 text-center text-ink-500">{t("trip_not_found")}</p>;
  if (!trip) return null;

  const done = trip.stage === "Settle" || trip.stage === "Cancelled";
  return (
    <div className="space-y-4 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">{t("trip_page_title")}</h1>
        {trip.passengerName && <p className="text-base text-ink-500">{trip.passengerName}</p>}
      </div>

      <section className="home-card space-y-3">
        <p className="text-lg font-bold text-ink">{STATUS[trip.stage] ?? trip.stage}</p>
        {trip.driverName && (
          <p className="text-[15px] text-ink-500">
            {t("trip_driver")}: <span className="font-semibold text-ink">{trip.driverName}</span>
            {!done && trip.etaMinutes != null && ` · ${trip.etaMinutes} min`}
          </p>
        )}
        {trip.riderLat != null && trip.riderLng != null && !done && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${trip.riderLat}&mlon=${trip.riderLng}#map=16/${trip.riderLat}/${trip.riderLng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
          >
            <Navigation className="h-4 w-4 text-gold" aria-hidden /> Driver on the map
          </a>
        )}
      </section>

      <section className="home-card space-y-2.5">
        {[
          { key: "pickup", area: trip.pickupArea, address: trip.pickupAddress },
          { key: "destination", area: trip.destinationArea, address: trip.destinationAddress },
        ].map((r) => (
          <p key={r.key} className="flex items-start gap-2 text-[15px] text-ink">
            <MapPin className={`mt-0.5 h-4 w-4 shrink-0 ${r.key === "pickup" ? "text-ink" : "text-gold"}`} aria-hidden />
            <span className="min-w-0">
              {[r.area, r.address].filter(Boolean).join(" · ") || "—"}
            </span>
          </p>
        ))}
      </section>
    </div>
  );
}
