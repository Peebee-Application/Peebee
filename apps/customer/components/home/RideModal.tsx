"use client";

import { roundFare, type SavedLocation } from "@tuma/shared";
import { Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, emptyPoint, resolvePoint, type PointState } from "../LocationPicker";
import { Modal } from "../Modal";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";

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
  const [step, setStep] = useState<"pickup" | "destination">("pickup");
  const [pickup, setPickup] = useState<PointState>(emptyPoint);
  const [destination, setDestination] = useState<PointState>(emptyPoint);
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [paymentRail, setPaymentRail] = useState<"escrow" | "float">("escrow");
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLocations()
      .then((res) => setLocations(res.locations))
      .catch(() => {});
    api
      .getSettings()
      .then((res) => setPricing({ ratePerKm: res.settings.rideRatePerKm, minimum: res.settings.rideMinimumFare }))
      .catch(() => {});
  }, []);

  const pickupPoint = resolvePoint(pickup, locations);
  const destinationPoint = resolvePoint(destination, locations);
  const distanceKm =
    pickupPoint.lat != null && pickupPoint.lng != null && destinationPoint.lat != null && destinationPoint.lng != null
      ? haversineKm(pickupPoint.lat, pickupPoint.lng, destinationPoint.lat, destinationPoint.lng)
      : null;
  const liveEstimate = distanceKm != null && pricing != null ? roundFare(distanceKm * pricing.ratePerKm, pricing.minimum) : null;

  function next() {
    const p = resolvePoint(pickup, locations);
    if (!p.area && !p.address) {
      setError(t("ride_set_pickup"));
      return;
    }
    setError(null);
    setStep("destination");
  }

  async function submit() {
    const p = resolvePoint(pickup, locations);
    const d = resolvePoint(destination, locations);
    if (!d.area && !d.address) {
      setError(t("ride_set_destination"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const list = await api.createList({ title: "Ride" });
      const { order } = await api.createOrder({
        listId: list.listId,
        type: "parcel",
        isRide: true,
        pickupArea: p.area,
        pickupAddress: p.address,
        pickupLat: p.lat,
        pickupLng: p.lng,
        destinationArea: d.area,
        destinationAddress: d.address,
        destinationLat: d.lat,
        destinationLng: d.lng,
        paymentRail,
        estimatedTotal: liveEstimate ?? (estimatedTotal ? roundFare(Number(estimatedTotal), pricing?.minimum) : undefined),
      });
      onClose();
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={step === "pickup" ? t("ride_pickup_step") : t("ride_destination_step")} onClose={onClose}>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-ink-500">
        <span className={step === "pickup" ? "text-ink" : ""}>{t("parcel_step1")}</span>
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
        <span className={step === "destination" ? "text-ink" : ""}>{t("ride_step2")}</span>
      </div>

      {step === "pickup" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">{t("ride_where_pickup")}</p>
          <LocationPicker point={pickup} setPoint={setPickup} locations={locations} />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            onClick={next}
            className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]"
          >
            {t("ride_next_destination")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">{t("ride_where_going")}</p>
          <LocationPicker point={destination} setPoint={setDestination} locations={locations} detailsLabel={t("ride_landmark")} />

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

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("restaurant_payment")}</p>
            <div className="flex gap-2">
              {(["escrow", "float"] as const).map((rail) => (
                <button
                  key={rail}
                  onClick={() => setPaymentRail(rail)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                    paymentRail === rail ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                  }`}
                >
                  {rail === "float" ? t("restaurant_cash") : t("restaurant_escrow")}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              {paymentRail === "float" ? t("restaurant_pay_rider_direct") : t("ride_pay_upfront")}
            </p>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => setStep("pickup")}
              className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
            >
              {t("ride_back")}
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="min-h-12 flex-[2] rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
            >
              {busy ? t("ride_requesting") : t("ride_request")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
