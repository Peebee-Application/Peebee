"use client";

import { DEFAULT_RIDE_TRACKING_SETTINGS, roundFare } from "@peebee/shared";
import type { RidePassenger, SavedPassenger } from "@peebee/shared";
import { ChevronRight, Route, User, Users } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";
import { RideTimeEstimate } from "./RideTimeEstimate";
import { WhoIsRiding } from "../WhoIsRiding";
import { saveSelfDriveRoute } from "../../lib/selfdrive-route";

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
export function RideModal({ onClose, initialMode = "boda", serviceLocked = false }: { onClose: () => void; initialMode?: "boda" | "car"; serviceLocked?: boolean }) {
  const t = useTranslate();
  const router = useRouter();
  // The first thing a rider books is where: pickup and destination come
  // from the shared place flow, then this screen just confirms the fare.
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [choosing, setChoosing] = useState(true);
  // Booking for someone else: offered only when the admin has it on.
  const [passenger, setPassenger] = useState<RidePassenger | null>(null);
  const [passengers, setPassengers] = useState<SavedPassenger[]>([]);
  const [forOtherOn, setForOtherOn] = useState(false);
  const [pickingWho, setPickingWho] = useState(false);
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  // Peebee Car is offered only when its service tiers are ready.
  const [tierPricing, setTierPricing] = useState<{ ratePerKm: number; minimumFare: number; comfortPremiumPercent: number; xlPremiumPercent: number; xlMinSeats: number } | null>(null);
  const [tier, setTier] = useState<"convenient" | "comfort">("convenient");
  const [vehicleSize, setVehicleSize] = useState<"normal" | "large">("normal");
  const [tierOptions, setTierOptions] = useState<Array<{ size: "normal" | "large"; tier: "convenient" | "comfort"; fare: number; nearby: number }>>([]);
  const [schedule, setSchedule] = useState<{ maxAdvanceHours: number | null; minLeadMinutes: number } | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [nowOk, setNowOk] = useState(true);
  const [carpoolOn, setCarpoolOn] = useState(false);
  const [rentOn, setRentOn] = useState(false);
  const [pickupAt, setPickupAt] = useState("");
  const [mode, setMode] = useState<"boda" | "car">(initialMode);
  const [carMenuOpen, setCarMenuOpen] = useState(initialMode === "car");
  const [busy, setBusy] = useState(false);
  const [showEstimates, setShowEstimates] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPassengers()
      .then((res) => {
        setPassengers(res.passengers);
        setForOtherOn(res.enabled);
      })
      .catch(() => {});
    api
      .getSettings()
      .then((res) => {
        setPricing({ ratePerKm: res.settings.rideRatePerKm, minimum: res.settings.rideMinimumFare });
        setShowEstimates((res.settings.rideTracking ?? DEFAULT_RIDE_TRACKING_SETTINGS).showEstimates);
      })
      .catch(() => {});
    api
      .getCarConfig()
      .then((cfg) => {
        setTierPricing(cfg.onDemandEnabled || cfg.scheduled ? cfg.serviceTiers ?? null : null);
        setCarpoolOn(!!cfg.carpool);
        setRentOn(!!cfg.selfDrive);
        setSchedule(cfg.scheduled);
        setNowOk(cfg.onDemandEnabled);
        if (!cfg.onDemandEnabled && cfg.scheduled) setWhen("later");
      })
      .catch(() => setTierPricing(null));
  }, []);

  const p = route?.pickup;
  const d = route?.destination;
  const pickupLat = p?.lat;
  const pickupLng = p?.lng;
  const destinationLat = d?.lat;
  const destinationLng = d?.lng;
  const distanceKm = p?.lat != null && p.lng != null && d?.lat != null && d.lng != null ? haversineKm(p.lat, p.lng, d.lat, d.lng) : null;
  const liveEstimate = distanceKm != null && pricing != null ? roundFare(distanceKm * pricing.ratePerKm, pricing.minimum) : null;

  useEffect(() => {
    if (!tierPricing || pickupLat == null || pickupLng == null || destinationLat == null || destinationLng == null) return;
    let active = true;
    api.getCarServiceOptions({ pickupLat, pickupLng, destinationLat, destinationLng })
      .then((result) => { if (active) setTierOptions(result.options); })
      .catch(() => { if (active) setTierOptions([]); });
    return () => { active = false; };
  }, [tierPricing, pickupLat, pickupLng, destinationLat, destinationLng]);

  if (choosing || !route) {
    return (
      <PlaceFlow
        concept="ride"
        initial={route ? { ...route, passenger } : undefined}
        onClose={() => (route ? setChoosing(false) : onClose())}
        onDone={(r) => {
          setRoute(r);
          if (r.passenger !== undefined) setPassenger(r.passenger);
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
      if (mode === "car" && tierPricing) {
        if (pf.lat == null || pf.lng == null || df.lat == null || df.lng == null) throw new Error("Please pin both places on the map.");
        const { order } = await api.bookCar({
          serviceTier: tier,
          vehicleSize,
          pickupArea: pf.area,
          pickupAddress: pf.address,
          pickupLat: pf.lat,
          pickupLng: pf.lng,
          destinationArea: df.area,
          destinationAddress: df.address,
          destinationLat: df.lat,
          destinationLng: df.lng,
          ...(when === "later" ? { scheduledFor: new Date(pickupAt).toISOString() } : {}),
          ...(passenger ? { passenger } : {}),
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
        ...(passenger ? { passenger } : {}),
      });
      onClose();
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal withMap mapRoute={route} title={t("ride_title")} onClose={onClose}>
      <div className="space-y-4">
        <RouteSummary pickup={route.pickup} destination={route.destination} destinationLabel={t("place_destination")} onChange={() => setChoosing(true)} />
        {showEstimates && <RideTimeEstimate pickupLat={p?.lat} pickupLng={p?.lng} destinationLat={d?.lat} destinationLng={d?.lng} />}

        {forOtherOn && (
          <button
            type="button"
            onClick={() => setPickingWho(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] px-4 text-left active:bg-[rgb(var(--surface-muted))]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
              {passenger ? <Users className="h-5 w-5" strokeWidth={1.75} aria-hidden /> : <User className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-bold text-ink">{passenger ? t("who_for", { name: passenger.name }) : t("who_for_me")}</span>
              {passenger && <span className="block truncate text-sm text-ink-500">{passenger.phone}</span>}
            </span>
            <span className="text-sm font-bold text-gold">{t("who_change")}</span>
            <ChevronRight className="h-5 w-5 text-ink-500" aria-hidden />
          </button>
        )}
        {pickingWho && (
          <WhoIsRiding
            passenger={passenger}
            saved={passengers}
            onSaved={setPassengers}
            onPick={(p) => {
              setPassenger(p);
              setPickingWho(false);
            }}
            onClose={() => setPickingWho(false)}
          />
        )}

        {!serviceLocked && (tierPricing || carpoolOn || rentOn) && (!carMenuOpen ? (
          <div role="group" aria-label="Choose a ride" className="flex gap-2">
            <button type="button" aria-pressed={mode === "boda"} onClick={() => setMode("boda")} className={`min-h-10 flex-1 rounded-full px-3 text-sm font-bold ${mode === "boda" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{t("car_tab_boda")}</button>
            <button type="button" onClick={() => { setMode("car"); setCarMenuOpen(true); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">{t("car_tab_car")}</button>
          </div>
        ) : (
          <div className="space-y-2">
            <button type="button" onClick={() => { setMode("boda"); setCarMenuOpen(false); }} className="min-h-9 text-sm font-bold text-gold">← Choose Boda or Car</button>
            <div role="group" aria-label="Choose a car service" className="flex gap-2">
              {tierPricing && <button type="button" aria-pressed={mode === "car"} onClick={() => setMode("car")} className="min-h-10 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Car</button>}
              {carpoolOn && <button type="button" onClick={() => { onClose(); router.push("/carpool"); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">Rideshare</button>}
              {rentOn && <button type="button" onClick={() => { saveSelfDriveRoute(route); onClose(); router.push("/rent"); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">Selfdrive</button>}
            </div>
          </div>
        ))}

        {carMenuOpen && mode === "car" && tierPricing ? (
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
            <>
              <p className="text-xs font-semibold text-ink-500">Choose your Peebee car</p>
              <div role="group" aria-label="Choose car size" className="grid grid-cols-2 gap-2">
                {(["normal", "large"] as const).map((size) => {
                  const selected = vehicleSize === size;
                  const image = size === "normal" ? "/images/ride-types/normal-saloon.png" : "/images/ride-types/large-minivan.png";
                  return <button key={size} type="button" aria-pressed={selected} onClick={() => setVehicleSize(size)}
                    className={`overflow-hidden rounded-2xl border text-left transition-all active:scale-[.98] ${selected ? "border-gold bg-gold/10 shadow-[0_3px_12px_rgba(201,162,39,.14)]" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
                    <span className="block h-[94px] bg-gradient-to-b from-[rgb(var(--surface-muted))] to-[rgb(var(--surface-card))] px-2 pt-1">
                      <Image src={image} alt="" aria-hidden="true" width={768} height={768} sizes="(max-width: 640px) 50vw, 240px" className="h-full w-full object-contain" />
                    </span>
                    <span className="block px-3 pb-3 pt-1"><span className="block text-sm font-bold text-ink">{size === "normal" ? "Normal" : "Large"}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">{size === "normal" ? "Saloon · 3–4 seats" : "Minivan · 5–7 seats"}</span></span>
                  </button>;
                })}
              </div>
              <div className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
                <div className="flex items-center justify-between"><span className="text-sm font-bold text-ink">Ride comfort</span><span className="text-[11px] text-ink-500">Choose a fare</span></div>
                <div role="group" aria-label="Choose ride comfort" className="grid grid-cols-2 gap-2 rounded-full bg-[rgb(var(--surface-muted))] p-1">
                  {(["convenient", "comfort"] as const).map((service) => <button key={service} type="button" aria-pressed={tier === service} onClick={() => setTier(service)}
                    className={`min-h-10 rounded-full px-3 text-sm font-bold transition-colors ${tier === service ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"}`}>
                    {service === "convenient" ? "Convenient" : "Comfort"}
                  </button>)}
                </div>
                {(() => {
                  const selectedOption = tierOptions.find((option) => option.size === vehicleSize && option.tier === tier);
                  return selectedOption ? <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-ink-500">{selectedOption.nearby > 0 ? `${selectedOption.nearby} available` : "No cars nearby"}{tier === "comfort" ? ` · ${tierPricing.comfortPremiumPercent}% comfort premium` : " · standard fare"}{vehicleSize === "large" ? ` · ${tierPricing.xlPremiumPercent}% large-car premium` : ""}</span>
                    <span className="shrink-0 text-sm font-bold text-ink">UGX {selectedOption.fare.toLocaleString("en-UG")}</span>
                  </div> : <p className="text-xs text-ink-500">Checking availability and fare…</p>;
                })()}
              </div>
              {tierOptions.length === 0 && <p className="text-sm text-ink-500">Checking nearby cars and prices…</p>}
              {when === "now" && tierOptions.find((o) => o.size === vehicleSize && o.tier === tier)?.nearby === 0 && (() => {
                const alternate = tierOptions.filter((o) => o.size === vehicleSize && o.tier !== tier && o.nearby > 0).sort((a, b) => a.fare - b.fare)[0];
                return alternate ? <div className="rounded-xl bg-gold/10 p-3 text-sm text-ink">No {tier} {vehicleSize} car is nearby. {alternate.tier} is available for UGX {alternate.fare.toLocaleString("en-UG")}.
                  <button type="button" onClick={() => setTier(alternate.tier)} className="mt-2 block font-bold text-gold">Choose {alternate.tier}</button></div>
                  : <p className="rounded-xl bg-gold/10 p-3 text-sm text-ink">No Peebee Car driver is nearby right now. Try again shortly.</p>;
              })()}
            </>
          </div>
        ) : !carMenuOpen && liveEstimate != null ? (
          <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
            <Route className="h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
            <p className="text-sm text-ink">
              <span className="font-bold">UGX {liveEstimate.toLocaleString("en-UG")}</span> {t("ride_estimated_fare")} ·{" "}
              {distanceKm!.toFixed(1)} km
            </p>
          </div>
        ) : !carMenuOpen ? (
          <input
            value={estimatedTotal}
            onChange={(e) => setEstimatedTotal(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder={t("ride_estimated_fare_input")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        ) : null}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {(!carMenuOpen || tierPricing) && <button
          onClick={submit}
          disabled={busy || (mode === "car" && (tierOptions.length === 0 || (when === "now" && !tierOptions.find((o) => o.size === vehicleSize && o.tier === tier)?.nearby) || (when === "later" && !pickupAt)))}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
        >
          {busy ? "Please wait…" : "Next: payment"}
        </button>}
      </div>
    </Modal>
  );
}
