"use client";

import { roundFare, type CarCategory } from "@tuma/shared";
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
  // Tuma Car: only offered when an admin has switched it on and added a car type.
  const [cars, setCars] = useState<CarCategory[]>([]);
  const [schedule, setSchedule] = useState<{ maxAdvanceHours: number | null; minLeadMinutes: number } | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [nowOk, setNowOk] = useState(true);
  const [carpoolOn, setCarpoolOn] = useState(false);
  const [rentOn, setRentOn] = useState(false);
  const [pickupAt, setPickupAt] = useState("");
  const [mode, setMode] = useState<"boda" | "car">("boda");
  const [carId, setCarId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setPricing({ ratePerKm: res.settings.rideRatePerKm, minimum: res.settings.rideMinimumFare }))
      .catch(() => {});
    api
      .getCarConfig()
      .then((cfg) => {
        setCars(cfg.onDemandEnabled || cfg.scheduled ? cfg.categories : []);
        setCarpoolOn(!!cfg.carpool);
        setRentOn(!!cfg.selfDrive);
        setSchedule(cfg.scheduled);
        setNowOk(cfg.onDemandEnabled);
        if (!cfg.onDemandEnabled && cfg.scheduled) setWhen("later");
      })
      .catch(() => setCars([]));
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

  const carFare = (c: CarCategory) => (distanceKm != null ? roundFare(distanceKm * c.rate_per_km, c.minimum_fare) : null);

  async function submit() {
    if (!route) return;
    const pf = placeFields(route.pickup);
    const df = placeFields(route.destination);
    setBusy(true);
    setError(null);
    try {
      if (mode === "car" && carId) {
        if (pf.lat == null || pf.lng == null || df.lat == null || df.lng == null) throw new Error("Please pin both places on the map.");
        const { order } = await api.bookCar({
          categoryId: carId,
          pickupArea: pf.area,
          pickupAddress: pf.address,
          pickupLat: pf.lat,
          pickupLng: pf.lng,
          destinationArea: df.area,
          destinationAddress: df.address,
          destinationLat: df.lat,
          destinationLng: df.lng,
          ...(when === "later" ? { scheduledFor: new Date(pickupAt).toISOString() } : {}),
        });
        onClose();
        router.push(`/orders/${order.id}/pay`);
        return;
      }
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

        {(cars.length > 0 || carpoolOn || rentOn) && (
          <div role="tablist" className="flex gap-2">
            {(["boda", ...(cars.length > 0 ? ["car"] : []), ...(carpoolOn ? ["carpool"] : []), ...(rentOn ? ["rent"] : [])] as ("boda" | "car" | "carpool" | "rent")[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  if (m === "carpool" || m === "rent") {
                    onClose();
                    router.push(m === "carpool" ? "/carpool" : "/rent");
                    return;
                  }
                  setMode(m);
                }}
                className={`min-h-10 flex-1 rounded-full px-3 text-sm font-bold ${mode === m ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
              >
                {m === "carpool" ? "Carpool" : m === "rent" ? "Rent" : t(m === "boda" ? "car_tab_boda" : "car_tab_car")}
              </button>
            ))}
          </div>
        )}

        {mode === "car" && cars.length > 0 ? (
          <div className="space-y-2">
            {schedule && (
              <div className="space-y-2">
                <div role="tablist" className="flex gap-2">
                  {(["now", "later"] as const).filter((w) => w === "later" || nowOk).map((w) => (
                    <button key={w} type="button" role="tab" aria-selected={when === w} onClick={() => setWhen(w)}
                      className={`min-h-9 flex-1 rounded-full px-3 text-xs font-bold ${when === w ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
                      {w === "now" ? "Now" : "Later"}
                    </button>
                  ))}
                </div>
                {when === "later" && (
                  <>
                    <input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold" aria-label="Pickup time" />
                    <p className="text-xs text-ink-500">
                      At least {schedule.minLeadMinutes} minutes ahead{schedule.maxAdvanceHours ? `, up to ${schedule.maxAdvanceHours} hours` : ""}. Drivers see it shortly before pickup.
                    </p>
                  </>
                )}
              </div>
            )}
            <p className="text-xs font-semibold text-ink-500">{t("car_choose_type")}</p>
            {cars.map((c) => {
              const fare = carFare(c);
              const selected = carId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCarId(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${selected ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink">{c.name}</span>
                    <span className="block text-xs text-ink-500">
                      {c.kind === "passenger" ? `${c.seats ?? ""} ${t("car_seats")}` : [c.cargo_type, c.size_label].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {fare != null && <span className="text-sm font-bold text-ink">UGX {fare.toLocaleString("en-UG")}</span>}
                </button>
              );
            })}
          </div>
        ) : liveEstimate != null ? (
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
          disabled={busy || (mode === "car" && (!carId || (when === "later" && !pickupAt)))}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
        >
          {busy ? "Please wait…" : "Next: payment"}
        </button>
      </div>
    </Modal>
  );
}
