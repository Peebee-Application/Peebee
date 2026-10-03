"use client";

import { roundFare } from "@tuma/shared";
import { Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";

/** Great-circle distance in km — mirrors apps/api/src/lib/geo.ts, used only
 * for the live fare preview here; the backend recomputes it authoritatively. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** "Just like SafeBoda" — call a rider to come pick you up from wherever
 * you are and take you to a destination. A ride is stored as a normal
 * parcel order (pickup + destination, distance-priced) with `isRide: true`
 * — see apps/api/src/db/migrations/0039_ride_orders.sql. */
export function RideModal({ onClose }: { onClose: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  // The first thing a rider books is where: pickup and destination come
  // from the shared place flow, then this screen just confirms the fare.
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setPricing({ ratePerKm: res.settings.rideRatePerKm, minimum: res.settings.rideMinimumFare }))
      .catch(() => {});
  }, []);

  const p = route?.pickup;
  const d = route?.destination;
  const distanceKm = p?.lat != null && p.lng != null && d?.lat != null && d.lng != null ? haversineKm(p.lat, p.lng, d.lat, d.lng) : null;
  const liveEstimate = distanceKm != null && pricing != null ? roundFare(distanceKm * pricing.ratePerKm, pricing.minimum) : null;

  if (choosing || !route) {
    return (
      <PlaceFlow
        concept="ride"
        initial={route ?? undefined}
        onClose={() => (route ? setChoosing(false) : onClose())}
        onDone={(r) => {
          setRoute(r);
          setChoosing(false);
        }}
      />
    );
  }

  async function submit() {
    if (!route) return;
    const pf = placeFields(route.pickup);
    const df = placeFields(route.destination);
    setBusy(true);
    setError(null);
    try {
      const list = await api.createList({ title: "Ride" });
      const { order } = await api.createOrder({
        listId: list.listId,
        type: "parcel",
        isRide: true,
        pickupArea: pf.area,
        pickupAddress: pf.address,
        pickupLat: pf.lat,
        pickupLng: pf.lng,
        destinationArea: df.area,
        destinationAddress: df.address,
        destinationLat: df.lat,
        destinationLng: df.lng,
        paymentRail: "escrow",
        estimatedTotal: liveEstimate ?? (estimatedTotal ? roundFare(Number(estimatedTotal), pricing?.minimum) : undefined),
      });
      onClose();
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal withMap title={t("ride_title")} onClose={onClose}>
      <div className="space-y-4">
        <RouteSummary pickup={route.pickup} destination={route.destination} destinationLabel={t("place_destination")} onChange={() => setChoosing(true)} />

        {liveEstimate != null ? (
          <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
            <Route className="h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
            <p className="text-sm text-ink">
              <span className="font-bold">UGX {liveEstimate.toLocaleString("en-UG")}</span> {t("ride_estimated_fare")} ·{" "}
              {distanceKm!.toFixed(1)} km
            </p>
          </div>
        ) : (
          <input
            value={estimatedTotal}
            onChange={(e) => setEstimatedTotal(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder={t("ride_estimated_fare_input")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
        >
          {busy ? "Please wait…" : "Next: payment"}
        </button>
      </div>
    </Modal>
  );
}
