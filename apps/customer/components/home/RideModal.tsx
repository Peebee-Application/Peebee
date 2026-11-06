"use client";

import { RoundedNote } from "../RoundedNote";
import { bodaExact } from "../../lib/ride-home";
import { useModules } from "../../lib/modules";
import { DEFAULT_RIDE_TRACKING_SETTINGS, roundFare } from "@peebee/shared";
import type { CarCategory, RidePassenger, RideStopInput, SavedPassenger } from "@peebee/shared";
import { Ambulance, ChevronRight, Crown, Route, Truck, User, Users } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../Modal";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";
import { RideTimeEstimate } from "./RideTimeEstimate";
import { SpecialCarServices, specialFare } from "./SpecialCarServices";
import { WhoIsRiding } from "../WhoIsRiding";
import { saveSelfDriveRoute } from "../../lib/selfdrive-route";
import { useRegisterNavPrimaryAction, useRegisterNavBack, goBackOr } from "../../lib/nav-primary-action";

const FALLBACK_CARGO_CATEGORIES: CarCategory[] = [
  { id: "peebee-cargo-van", kind: "cargo", name: "Cargo Van", seats: 2, cargo_type: "van", size_label: "Up to 800 kg", rate_per_km: 2500, minimum_fare: 15000 },
  { id: "peebee-cargo-pickup", kind: "cargo", name: "Pickup Truck (1 Ton)", seats: 2, cargo_type: "pickup", size_label: "Up to 1 Ton", rate_per_km: 3500, minimum_fare: 25000 },
  { id: "peebee-cargo-truck-3t", kind: "cargo", name: "Box Truck (3 Ton)", seats: 2, cargo_type: "truck_3t", size_label: "Up to 3 Ton", rate_per_km: 5000, minimum_fare: 45000 },
  { id: "peebee-cargo-truck-7t", kind: "cargo", name: "Heavy Truck (7 Ton)", seats: 2, cargo_type: "truck_7t", size_label: "Up to 7 Ton", rate_per_km: 8000, minimum_fare: 80000 },
];

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
export function RideModal({
  onClose,
  initialMode = "boda",
  initialCargo = false,
  initialService,
  serviceLocked = false,
  initialRoute,
  initialPassenger = null,
  initialTier = "convenient",
  initialSize = "normal",
  initialPickupAt,
  initialCargoCategoryId,
  initialSpecialId,
  autoBook = false,
  initialStops,
}: {
  onClose: () => void;
  initialMode?: "boda" | "car";
  initialCargo?: boolean;
  /** Open straight into Luxury or Ambulance (the rides home screen links here). */
  initialService?: "luxury" | "ambulance";
  serviceLocked?: boolean;
  /** Handed over from the Ride home: start on the confirm sheet with this route instead of the place picker. */
  initialRoute?: PlaceResult;
  initialPassenger?: RidePassenger | null;
  initialTier?: "convenient" | "comfort";
  initialSize?: "normal" | "large";
  /** Local `YYYY-MM-DDTHH:mm` pickup time (books "later" when set). */
  initialPickupAt?: string;
  initialCargoCategoryId?: string;
  /** Preselected Luxury/Ambulance category. */
  initialSpecialId?: string;
  /** The home already showed the fare and the customer tapped "Book": submit as
   * soon as this sheet has what it needs (fare, nearby cars). If anything blocks
   * it (no car nearby, an error) the confirm sheet simply stays open. */
  autoBook?: boolean;
  /** Boda only: stops between pickup and destination chosen on the Ride home (the server prices the full route). */
  initialStops?: RideStopInput[];
}) {
  const t = useTranslate();
  // Admin → Services: a ride type that is switched off is not offered.
  const moduleOn = useModules();
  const bodaOn = moduleOn("ride.boda");
  const carModuleOn = moduleOn("ride.car");
  const moveOn = moduleOn("ride.move");
  const luxuryOn = moduleOn("ride.luxury");
  const ambulanceOn = moduleOn("ride.ambulance");
  const router = useRouter();
  // The first thing a rider books is where: pickup and destination come
  // from the shared place flow, then this screen just confirms the fare.
  const [route, setRoute] = useState<PlaceResult | null>(initialRoute ?? null);
  const [choosing, setChoosing] = useState(!initialRoute);
  // Booking for someone else: offered only when the admin has it on.
  const [passenger, setPassenger] = useState<RidePassenger | null>(initialRoute?.passenger ?? initialPassenger);
  const [passengers, setPassengers] = useState<SavedPassenger[]>([]);
  const [forOtherOn, setForOtherOn] = useState(false);
  const [pickingWho, setPickingWho] = useState(false);
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  // Peebee Car is offered only when its service tiers are ready.
  const [tierPricing, setTierPricing] = useState<{ ratePerKm: number; minimumFare: number; comfortPremiumPercent: number; xlPremiumPercent: number; xlMinSeats: number } | null>(null);
  const [tier, setTier] = useState<"convenient" | "comfort">(initialTier);
  const [vehicleSize, setVehicleSize] = useState<"normal" | "large">(initialSize);
  const [tierOptions, setTierOptions] = useState<Array<{ size: "normal" | "large"; tier: "convenient" | "comfort"; fare: number; roundedFrom?: number | null; nearby: number }>>([]);
  const [categories, setCategories] = useState<CarCategory[]>([]);
  const [carSubMode, setCarSubMode] = useState<"passenger" | "cargo" | "luxury" | "ambulance">(initialService ?? (initialCargo ? "cargo" : "passenger"));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [luxuryId, setLuxuryId] = useState(initialService === "luxury" ? initialSpecialId ?? "" : "");
  const [ambulanceId, setAmbulanceId] = useState(initialService === "ambulance" ? initialSpecialId ?? "" : "");
  const [hireHours, setHireHours] = useState(0);
  const [tripNote, setTripNote] = useState("");
  const [specialNearby, setSpecialNearby] = useState<number | null>(null);
  const [emergencyNumber, setEmergencyNumber] = useState("999");
  const [maxHireHours, setMaxHireHours] = useState(24);
  const [selectedCargoCatId, setSelectedCargoCatId] = useState<string>(initialCargoCategoryId ?? "peebee-cargo-van");
  const [cargoDescription, setCargoDescription] = useState<string>("");
  const [schedule, setSchedule] = useState<{ maxAdvanceHours: number | null; minLeadMinutes: number } | null>(null);
  const [when, setWhen] = useState<"now" | "later">(initialPickupAt ? "later" : "now");
  const [nowOk, setNowOk] = useState(true);
  const [carpoolOn, setCarpoolOn] = useState(false);
  const [rentOn, setRentOn] = useState(false);
  const [pickupAt, setPickupAt] = useState(initialPickupAt ?? "");
  const [mode, setMode] = useState<"boda" | "car">(initialCargo || initialService ? "car" : initialMode);
  const [carMenuOpen, setCarMenuOpen] = useState(initialMode === "car" || initialCargo || !!initialService);
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
        if (cfg.categories) setCategories(cfg.categories);
        if (cfg.emergencyNumber) setEmergencyNumber(cfg.emergencyNumber);
        if (cfg.maxHireHours) setMaxHireHours(cfg.maxHireHours);
        setConfigLoaded(true);
      })
      .catch(() => { setTierPricing(null); setConfigLoaded(true); });
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

  // "Next: payment" is the bottom nav's right capsule (an intermediate step:
  // white in light, grey in dark), not an in-sheet button. Same handler,
  // validation and busy state as before.
  const navCargoList = categories.filter((c) => c.kind === "cargo" || c.id.startsWith("peebee-cargo-"));
  const navCargo = (navCargoList.length > 0 ? navCargoList : FALLBACK_CARGO_CATEGORIES).find((c) => c.id === selectedCargoCatId);
  // Offered only once Peebee has approved at least one such vehicle, so there is never an Ambulance button without an ambulance.
  const luxuryCats = categories.filter((c) => c.service_group === "luxury" && Number(c.has_vehicles ?? 0) > 0);
  const ambulanceCats = categories.filter((c) => c.service_group === "ambulance" && Number(c.has_vehicles ?? 0) > 0);
  const navLuxury = luxuryCats.find((c) => c.id === luxuryId) ?? luxuryCats[0];
  const navAmbulance = ambulanceCats.find((c) => c.id === ambulanceId) ?? ambulanceCats[0];
  const navCarOption = tierOptions.find((o) => o.size === vehicleSize && o.tier === tier);
  const navFare = mode === "car" && carSubMode === "luxury" ? (navLuxury ? specialFare(navLuxury, distanceKm, hireHours) : null)
    : mode === "car" && carSubMode === "ambulance" ? (navAmbulance ? specialFare(navAmbulance, distanceKm) : null)
    : mode === "car" && carSubMode === "cargo"
    ? navCargo ? (distanceKm != null ? roundFare(distanceKm * navCargo.rate_per_km, navCargo.minimum_fare) : navCargo.minimum_fare) : null
    : mode === "car" && tierPricing ? navCarOption?.fare ?? null
    : liveEstimate ?? (estimatedTotal ? Number(estimatedTotal) : null);
  const specialBlocked = mode === "car" && (
    (carSubMode === "luxury" && (!navLuxury || (when === "later" ? !pickupAt : specialNearby === 0)))
    || (carSubMode === "ambulance" && (!navAmbulance || specialNearby === 0))
  );
  const submitDisabled = busy || specialBlocked || (mode === "car" && carSubMode === "passenger" && (tierOptions.length === 0 || (when === "now" && !navCarOption?.nearby) || (when === "later" && !pickupAt))) || (mode === "car" && carSubMode === "cargo" && when === "later" && !pickupAt);
  const submitShown = !choosing && !!route && !pickingWho && (!carMenuOpen || !!tierPricing || carSubMode === "cargo" || carSubMode === "luxury" || carSubMode === "ambulance");
  useRegisterNavPrimaryAction(submitShown ? {
    tone: "step",
    label: busy ? "Please wait…" : mode === "car" && carSubMode === "ambulance" ? "Get ambulance" : "Next: payment",
    detail: navFare != null && Number.isFinite(navFare) && navFare > 0 ? `UGX ${navFare.toLocaleString("en-UG")}` : undefined,
    disabled: submitDisabled,
    busy,
    onClick: () => void submit(),
  } : null);

  // On the fare/confirm sheet, nav Back returns to the route picker — or,
  // when the Ride home handed this route over, back to the home's fare board.
  useRegisterNavBack(!choosing && !!route && !pickingWho, () => (initialRoute ? onClose() : setChoosing(true)));

  // "Book" on the Ride home: submit once the fare and availability are known.
  const autoBooked = useRef(false);
  const autoBookReady = autoBook && !autoBooked.current && configLoaded && submitShown && !submitDisabled
    && (mode === "boda" ? pricing != null : carSubMode === "passenger" ? tierOptions.length > 0 : true);
  useEffect(() => {
    if (!autoBookReady) return;
    autoBooked.current = true;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBookReady]);

  if (choosing || !route) {
    return (
      <PlaceFlow
        concept="ride"
        initial={route ? { ...route, passenger } : undefined}
        onClose={() => (route ? setChoosing(false) : onClose())}
        onBack={() => (route ? setChoosing(false) : goBackOr(router, "/ride"))}
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
      if (mode === "car") {
        if (pf.lat == null || pf.lng == null || df.lat == null || df.lng == null) throw new Error("Please pin both places on the map.");
        if (carSubMode === "luxury" || carSubMode === "ambulance") {
          const cat = carSubMode === "luxury" ? navLuxury : navAmbulance;
          if (!cat) throw new Error("That service isn't available right now.");
          const { order } = await api.bookCar({
            categoryId: cat.id,
            ...(carSubMode === "luxury" && hireHours > 0 ? { hireHours } : {}),
            ...(tripNote.trim() ? { note: tripNote.trim() } : {}),
            pickupArea: pf.area,
            pickupAddress: pf.address,
            pickupLat: pf.lat,
            pickupLng: pf.lng,
            destinationArea: df.area,
            destinationAddress: df.address,
            destinationLat: df.lat,
            destinationLng: df.lng,
            // An ambulance is always sent straight away.
            ...(carSubMode === "luxury" && when === "later" ? { scheduledFor: new Date(pickupAt).toISOString() } : {}),
            ...(passenger ? { passenger } : {}),
          });
          onClose();
          router.push(`/orders/${order.id}/pay`);
          return;
        }
        if (carSubMode === "cargo") {
          const cargoList = categories.filter((c) => c.kind === "cargo" || c.id.startsWith("peebee-cargo-"));
          const effective = cargoList.length > 0 ? cargoList : FALLBACK_CARGO_CATEGORIES;
          const selectedCat = effective.find((c) => c.id === selectedCargoCatId) || effective[0];
          const { order } = await api.bookCar({
            categoryId: selectedCat.id,
            cargoDescription: cargoDescription.trim() || undefined,
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
        if (tierPricing) {
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
        ...(initialStops?.length ? { stops: initialStops } : {}),
      });
      onClose();
      // Riders apply and the customer picks: show them as they come in. First come, first served goes straight to payment.
      router.push(order.matching_mode === "customer_selects" ? `/orders/${order.id}` : `/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const cargoList = categories.filter((c) => c.kind === "cargo" || c.id.startsWith("peebee-cargo-"));
  const effectiveCargo = cargoList.length > 0 ? cargoList : FALLBACK_CARGO_CATEGORIES;
  const luxurySchedule = schedule ? (
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
          <p className="text-xs text-ink-500">At least {schedule.minLeadMinutes} minutes ahead{schedule.maxAdvanceHours ? `, up to ${schedule.maxAdvanceHours} hours` : ""}.</p>
        </>
      )}
    </div>
  ) : null;

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

        {!serviceLocked && (tierPricing || carpoolOn || rentOn || effectiveCargo.length > 0) && (!carMenuOpen ? (
          <div role="group" aria-label="Choose a ride" className="flex gap-2">
            {bodaOn && <button type="button" aria-pressed={mode === "boda"} onClick={() => setMode("boda")} className={`min-h-10 flex-1 rounded-full px-3 text-sm font-bold ${mode === "boda" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{t("car_tab_boda")}</button>}
            {(carModuleOn || moveOn || luxuryOn || ambulanceOn) && <button type="button" onClick={() => { setMode("car"); setCarMenuOpen(true); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">{t("car_tab_car")}</button>}
          </div>
        ) : (
          <div className="space-y-2">
            <button type="button" onClick={() => { setMode("boda"); setCarMenuOpen(false); }} className="min-h-9 text-sm font-bold text-gold">← Choose Boda or Car</button>
            <div role="group" aria-label="Choose a car service" className="flex flex-wrap gap-2">
              {tierPricing && carModuleOn && (
                <button
                  type="button"
                  aria-pressed={mode === "car" && carSubMode === "passenger"}
                  onClick={() => { setMode("car"); setCarSubMode("passenger"); }}
                  className={`min-h-10 flex-1 rounded-full px-3 text-sm font-bold transition-colors ${
                    mode === "car" && carSubMode === "passenger" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"
                  }`}
                >
                  Car
                </button>
              )}
              {moveOn && <button
                type="button"
                aria-pressed={mode === "car" && carSubMode === "cargo"}
                onClick={() => { setMode("car"); setCarSubMode("cargo"); }}
                className={`min-h-10 flex-1 rounded-full px-3 text-sm font-bold transition-colors ${
                  mode === "car" && carSubMode === "cargo" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"
                }`}
              >
                Cargo / Truck
              </button>}
              {luxuryOn && luxuryCats.length > 0 && (
                <button type="button" aria-pressed={mode === "car" && carSubMode === "luxury"} onClick={() => { setMode("car"); setCarSubMode("luxury"); }}
                  className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-bold transition-colors ${mode === "car" && carSubMode === "luxury" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
                  <Crown className="h-4 w-4" aria-hidden /> VIP
                </button>
              )}
              {ambulanceOn && ambulanceCats.length > 0 && (
                <button type="button" aria-pressed={mode === "car" && carSubMode === "ambulance"} onClick={() => { setMode("car"); setCarSubMode("ambulance"); }}
                  className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-bold transition-colors ${mode === "car" && carSubMode === "ambulance" ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
                  <Ambulance className="h-4 w-4" aria-hidden /> Ambulance
                </button>
              )}
              {carpoolOn && <button type="button" onClick={() => { onClose(); router.push("/carpool"); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">Rideshare</button>}
              {rentOn && <button type="button" onClick={() => { saveSelfDriveRoute(route); onClose(); router.push("/rent"); }} className="min-h-10 flex-1 rounded-full bg-gold/15 px-3 text-sm font-bold text-ink">Selfdrive</button>}
            </div>
          </div>
        ))}

        {carMenuOpen && mode === "car" && (carSubMode === "luxury" || carSubMode === "ambulance") && configLoaded && (carSubMode === "luxury" ? luxuryCats : ambulanceCats).length === 0 ? (
          <div className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-4" role="status">
            <p className="text-sm font-bold text-ink">{carSubMode === "luxury" ? "VIP cars aren't available yet." : "Ambulance requests aren't available yet."}</p>
            <p className="text-xs text-ink-500">
              {carSubMode === "ambulance" ? `If someone's life is in danger, call ${emergencyNumber} now.` : "Please choose a Car, or check back soon."}
            </p>
            {carSubMode === "ambulance" && <a href={`tel:${emergencyNumber}`} className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink">Call {emergencyNumber}</a>}
          </div>
        ) : carMenuOpen && mode === "car" && (carSubMode === "luxury" || carSubMode === "ambulance") ? (
          <SpecialCarServices
            kind={carSubMode}
            categories={carSubMode === "luxury" ? luxuryCats : ambulanceCats}
            selectedId={carSubMode === "luxury" ? (navLuxury?.id ?? "") : (navAmbulance?.id ?? "")}
            onSelect={carSubMode === "luxury" ? setLuxuryId : setAmbulanceId}
            distanceKm={distanceKm}
            pickup={{ lat: pickupLat ?? undefined, lng: pickupLng ?? undefined }}
            hireHours={hireHours}
            onHireHours={setHireHours}
            maxHireHours={maxHireHours}
            note={tripNote}
            onNote={setTripNote}
            emergencyNumber={emergencyNumber}
            nearby={specialNearby}
            onNearby={setSpecialNearby}
            schedule={luxurySchedule}
            later={carSubMode === "luxury" && when === "later"}
          />
        ) : carMenuOpen && mode === "car" && carSubMode === "cargo" ? (
          <div className="space-y-3">
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
                      At least {schedule.minLeadMinutes} minutes ahead{schedule.maxAdvanceHours ? `, up to ${schedule.maxAdvanceHours} hours` : ""}.
                    </p>
                  </>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-ink-500 mb-2">Choose cargo & delivery vehicle</p>
              <div role="group" aria-label="Choose cargo vehicle" className="grid grid-cols-2 gap-2">
                {effectiveCargo.map((cat) => {
                  const selected = selectedCargoCatId === cat.id;
                  const catFare = distanceKm != null ? roundFare(distanceKm * cat.rate_per_km, cat.minimum_fare) : cat.minimum_fare;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedCargoCatId(cat.id)}
                      className="select-card text-left"
                    >
                      <span className="select-card__title text-sm text-ink">{cat.name}</span>
                      <span className="select-card__sub">{cat.size_label ?? "Cargo transport"}</span>
                      <span className="select-card__title mt-2 text-sm text-ink">
                        UGX {catFare.toLocaleString("en-UG")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-ink-500">
                What are you transporting? (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Household goods, cartons, equipment..."
                value={cargoDescription}
                onChange={(e) => setCargoDescription(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
          </div>
        ) : carMenuOpen && mode === "car" && tierPricing ? (
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
                    className="select-card overflow-hidden !p-0 text-left">
                    <span className="block h-[94px] w-full px-2 pt-1">
                      <Image src={image} alt="" aria-hidden="true" width={768} height={768} sizes="(max-width: 640px) 50vw, 240px" className="h-full w-full object-contain" />
                    </span>
                    <span className="block w-full min-w-0 px-3 pb-3 pt-1"><span className="select-card__title text-sm text-ink">{size === "normal" ? "Normal" : "Large"}</span>
                      <span className="select-card__sub">{size === "normal" ? "Saloon · 3–4 seats" : "Minivan · 5–7 seats"}</span></span>
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
                    <span className="shrink-0 text-right text-sm font-bold text-ink">UGX {selectedOption.fare.toLocaleString("en-UG")}<RoundedNote amount={selectedOption.fare} from={selectedOption.roundedFrom} /></span>
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
              <RoundedNote amount={liveEstimate} from={bodaExact(distanceKm, pricing?.ratePerKm, pricing?.minimum)} />
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
      </div>
    </Modal>
  );
}
