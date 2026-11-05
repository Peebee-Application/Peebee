"use client";

import { travelMinutes } from "@peebee/shared";
import { RoundedNote } from "../RoundedNote";
import type { CarCategory, CarConfig, FareCounter, FareOffer, OrderRow, RidePassenger, RideQuote, RideStop, SavedPassenger } from "@peebee/shared";
import type { LucideIcon } from "lucide-react";
import {
  Ambulance, ArrowUpDown, Bike, Bus, Check, HandCoins, Briefcase, CalendarClock, Car, CarFront, ChevronDown, ChevronRight, Clock, Crown, History,
  Home as HomeIcon, MapPin, Package, Route, Search, ShieldCheck, Share2, Truck, User, Users, UsersRound, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { currentLocationPlace, loadPlaces, placeFields, placeFromSaved, type Place, type PlacesBootstrap } from "../../lib/places";
import {
  arrivalLabel, bodaExact, bodaFare, categoryFare, formatUgx, haversineKm, predictUsual, toLocalInput, whenChoices, whenLabel, withinSchedule,
} from "../../lib/ride-home";
import { saveSelfDriveRoute } from "../../lib/selfdrive-route";
import { useSpecialCarServices } from "../../lib/special-car";
import { useTaxipress } from "../../lib/taxipress";
import { filterByModule, useModules } from "../../lib/modules";
import { useLivePolling } from "../../lib/use-live-polling";
import { useRoadRoute } from "../../lib/useRoadRoute";
import { FeeProposalCard } from "../home/FeeProposalCard";
import { RideModal } from "../home/RideModal";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { WhoIsRiding } from "../WhoIsRiding";
import { HoldToCall } from "./HoldToCall";
import { NameYourFare } from "./NameYourFare";
import { OfferLivePanel } from "./OfferLivePanel";
import { RideStopsEditor } from "./RideStopsEditor";
import { RideLiveMap } from "./RideLiveMap";
import { RideTripCard, useRideTripDetails } from "./RideTripCard";

/** Matches RideModal's built-in cargo list, used when the admin hasn't set any. */
const FALLBACK_CARGO: Pick<CarCategory, "id" | "name" | "size_label" | "rate_per_km" | "minimum_fare">[] = [
  { id: "peebee-cargo-van", name: "Cargo Van", size_label: "Up to 800 kg", rate_per_km: 2500, minimum_fare: 15000 },
  { id: "peebee-cargo-truck-7t", name: "Heavy Truck (7 Ton)", size_label: "Up to 7 Ton", rate_per_km: 8000, minimum_fare: 80000 },
];

type Prefer = "boda" | "car" | "move" | "luxury";
type Handoff = {
  mode: "boda" | "car";
  cargo?: boolean;
  service?: "luxury" | "ambulance";
  tier?: "convenient" | "comfort";
  size?: "normal" | "large";
  cargoCategoryId?: string;
  specialId?: string;
  autoBook: boolean;
};
type BoardOption = {
  id: string;
  prefer: Prefer;
  title: string;
  sub: string;
  icon: LucideIcon;
  fare: number | null;
  /** The fare before rounding, when rounding changed it. */
  roundedFrom?: number | null;
  pending: boolean;
  blocked?: string;
  /** true → gold "Book" (books straight away); false → "Next: …" (needs details first). */
  direct: boolean;
  handoff: Handoff;
  /** Nav button sublabel (e.g. "Standard · Comfort"), when the row itself doesn't say it. */
  navSub?: string;
};

type CarSize = "normal" | "large";
type CarTier = "convenient" | "comfort";
/** Size is about seats; the ride feel (Convenient / Comfort) is a separate toggle on the car. */
const CAR_SIZES: Array<{ id: CarSize; label: string; sub: string }> = [
  { id: "normal", label: "Standard", sub: "3–4 seats" },
  { id: "large", label: "Large", sub: "5–7 seats" },
];

const PREFER_LABEL: Record<Prefer, string> = { boda: "Boda", car: "Car", move: "Move", luxury: "VIP" };

function placeIcon(label: string): LucideIcon {
  if (/\b(work|office)\b/i.test(label)) return Briefcase;
  if (/\bhome\b/i.test(label)) return HomeIcon;
  return MapPin;
}

const sameSpot = (a: Place, b: Place) =>
  (a.address && b.address && a.address === b.address) || (a.lat != null && b.lat != null && Math.abs(a.lat - b.lat) < 0.0005 && Math.abs((a.lng ?? 0) - (b.lng ?? 0)) < 0.0005);

/**
 * The Ride home ("Live Canvas"): a live map with a bottom sheet. Say where
 * you're going first, then compare every vehicle type on one fare board and
 * hand the choice to the existing booking flow (RideModal → pay page).
 */
export function RideHome() {
  const router = useRouter();
  const special = useSpecialCarServices();
  const taxipress = useTaxipress();
  // Admin → Services: a ride type that is switched off is not offered anywhere on this screen.
  const moduleOn = useModules();
  const bodaOn = moduleOn("ride.boda");
  const carOn = moduleOn("ride.car");
  const moveOn = moduleOn("ride.move");
  const luxuryOn = moduleOn("ride.luxury");
  const carpoolOn = moduleOn("ride.car.carpool");
  const selfdriveOn = moduleOn("ride.car.selfdrive");
  const [cfg, setCfg] = useState<CarConfig | null>(null);
  const [rates, setRates] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  const [places, setPlaces] = useState<PlacesBootstrap>({ saved: [], recent: [] });
  const [passengers, setPassengers] = useState<SavedPassenger[]>([]);
  const [forOtherOn, setForOtherOn] = useState(false);
  const [active, setActive] = useState<OrderRow | null>(null);
  const [here, setHere] = useState<Place | null>(null);
  const [nearbyCars, setNearbyCars] = useState<number | null>(null);

  const [picked, setPrefer] = useState<Prefer | null>(null);
  // The pick is the customer's choice, else the first ride type that is on (Boda is not always on).
  const typeOn: Record<Prefer, boolean> = { boda: bodaOn, car: carOn, move: moveOn, luxury: luxuryOn };
  const prefer: Prefer = picked && typeOn[picked] ? picked : bodaOn ? "boda" : carOn ? "car" : moveOn ? "move" : luxuryOn ? "luxury" : "boda";
  const [whenAt, setWhenAt] = useState<string | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [passenger, setPassenger] = useState<RidePassenger | null>(null);
  const [pickingWho, setPickingWho] = useState(false);
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [placeFlow, setPlaceFlow] = useState<{ pickup?: Place | null; destination?: Place | null } | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [carSize, setCarSize] = useState<CarSize>("normal");
  const [carTier, setCarTier] = useState<CarTier>("convenient");
  const [carOpen, setCarOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  // Multi-stop + Name your fare (Boda).
  const [stops, setStops] = useState<Place[]>([]);
  const [stopPicker, setStopPicker] = useState(false);
  const [rideQuote, setRideQuote] = useState<RideQuote | null>(null);
  const [rideQuoteState, setRideQuoteState] = useState<"idle" | "loading" | "ok" | "failed">("idle");
  const [nyfOn, setNyfOn] = useState(false);
  const [nyfValue, setNyfValue] = useState<number | null>(null);
  const [offering, setOffering] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [extras, setExtras] = useState<{ stops: RideStop[]; offer: FareOffer | null; counters: FareCounter[] }>({ stops: [], offer: null, counters: [] });

  const sheetRef = useRef<HTMLElement>(null);
  const [sheetH, setSheetH] = useState(0);

  useEffect(() => {
    setHere(currentLocationPlace());
    api.getCarConfig().then(setCfg).catch(() => setCfg(null));
    api.getSettings().then((r) => setRates({ ratePerKm: r.settings.rideRatePerKm, minimum: r.settings.rideMinimumFare })).catch(() => {});
    void loadPlaces().then(setPlaces);
    api.getPassengers().then((r) => { setPassengers(r.passengers ?? []); setForOtherOn(!!r.enabled); }).catch(() => {});
    const refresh = () => setHere(currentLocationPlace());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const refreshActive = () =>
    api.getActiveOrder().then((r) => {
      const ride = r.activeOrder && r.activeOrder.is_ride ? r.activeOrder : null;
      setActive(ride);
      setExtras({ stops: ride ? r.rideStops ?? [] : [], offer: ride ? r.fareOffer ?? null : null, counters: ride ? r.fareCounters ?? [] : [] });
    }).catch(() => {});
  // An open fare offer changes by the second (counters arrive and expire), so poll faster while one is live.
  const offerLive = !!active && !!extras.offer && active.stage === "Create" && !active.rider_id;
  useLivePolling(() => { void refreshActive(); }, offerLive ? 4_000 : 10_000, [offerLive]);
  const trip = useRideTripDetails(active);

  // Cars free near you: the tier counts depend only on the pickup point.
  const tiers = cfg && (cfg.onDemandEnabled || cfg.scheduled) ? cfg.serviceTiers ?? null : null;
  useEffect(() => {
    if (!tiers || here?.lat == null || here.lng == null) return;
    let live = true;
    api.getCarServiceOptions({ pickupLat: here.lat, pickupLng: here.lng, destinationLat: here.lat, destinationLng: here.lng })
      .then((r) => live && setNearbyCars(r.options.reduce((m, o) => Math.max(m, o.nearby), 0)))
      .catch(() => live && setNearbyCars(null));
    return () => { live = false; };
  }, [tiers, here?.lat, here?.lng]);

  // When: quick chips inside the admin's scheduling window.
  const nowOk = cfg ? cfg.onDemandEnabled : true;
  const chips = useMemo(() => whenChoices(cfg?.scheduled ?? null, nowOk), [cfg?.scheduled, nowOk]);
  useEffect(() => {
    if (!nowOk && whenAt == null && chips[0]?.at) setWhenAt(chips[0].at);
  }, [nowOk, whenAt, chips]);

  const cargoCats = (cfg?.categories ?? []).filter((c) => c.kind === "cargo" || c.id.startsWith("peebee-cargo-"));
  const cargoList = cargoCats.length > 0 ? cargoCats : FALLBACK_CARGO;
  const lightestCargo = moveOn ? [...cargoList].sort((a, b) => a.minimum_fare - b.minimum_fare)[0] : undefined;
  const luxuryCats = (cfg?.categories ?? []).filter((c) => c.service_group === "luxury" && Number(c.has_vehicles ?? 0) > 0);
  const ambulanceCats = (cfg?.categories ?? []).filter((c) => c.service_group === "ambulance" && Number(c.has_vehicles ?? 0) > 0);
  const cheapestLuxury = luxuryOn ? [...luxuryCats].sort((a, b) => a.minimum_fare - b.minimum_fare)[0] : undefined;
  const emergencyNumber = cfg?.emergencyNumber || "999";

  // ---- the fare board, once a destination is set ----------------------
  const p = route?.pickup ?? null;
  const d = route?.destination ?? null;
  const km = p?.lat != null && p.lng != null && d?.lat != null && d.lng != null ? haversineKm(p.lat, p.lng, d.lat, d.lng) : null;
  const road = useRoadRoute(p?.lat, p?.lng, d?.lat, d?.lng);
  const rideMin = road ? travelMinutes(road.route.durationSeconds) : km != null ? Math.max(3, Math.round((km / 22) * 60)) : null;
  const roadKm = road ? road.route.distanceMeters / 1000 : km;

  const [carOptions, setCarOptions] = useState<Array<{ size: "normal" | "large"; tier: "convenient" | "comfort"; fare: number; roundedFrom?: number | null; nearby: number }> | null>(null);
  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
  const routeKey = p?.lat != null && d?.lat != null ? `${p.lat},${p.lng}:${d.lat},${d.lng}` : null;
  useEffect(() => {
    setCarOptions(null);
    setQuotes({});
    if (!routeKey || p?.lat == null || p.lng == null || d?.lat == null || d.lng == null) return;
    let live = true;
    const trip = { pickupLat: p.lat, pickupLng: p.lng, destinationLat: d.lat, destinationLng: d.lng };
    if (tiers) api.getCarServiceOptions(trip).then((r) => live && setCarOptions(r.options)).catch(() => live && setCarOptions([]));
    // Real quotes from POST /v1/car/quote; a failure falls back to the category's own rates.
    const ids = [lightestCargo?.id, cheapestLuxury?.id].filter((id): id is string => !!id);
    for (const id of ids) {
      api.quoteCarCategory({ categoryId: id, ...trip })
        .then((q) => live && setQuotes((prev) => ({ ...prev, [id]: q.fare })))
        .catch(() => live && setQuotes((prev) => ({ ...prev, [id]: null })));
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, !!tiers, lightestCargo?.id, cheapestLuxury?.id]);

  // The server's own Boda quote: the full route through any stops plus the
  // per-stop fee, and the Name-your-fare band. If the API doesn't offer it
  // (older server), stops and offers simply aren't shown.
  const stopsKey = stops.map((s) => `${s.lat},${s.lng}`).join(";");
  useEffect(() => {
    setRideQuote(null);
    if (!routeKey || p?.lat == null || p.lng == null || d?.lat == null || d.lng == null) { setRideQuoteState("idle"); return; }
    let live = true;
    setRideQuoteState("loading");
    api.getRideQuote({
      pickupLat: p.lat, pickupLng: p.lng, destinationLat: d.lat, destinationLng: d.lng,
      stops: stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng! })),
    })
      .then((q) => { if (live) { setRideQuote(q); setRideQuoteState("ok"); } })
      .catch(() => { if (live) setRideQuoteState("failed"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, stopsKey]);
  const maxStops = rideQuoteState === "ok" ? rideQuote?.maxStops ?? 0 : 0;
  const offerBand = rideQuote?.offers ?? null;

  const options: BoardOption[] = useMemo(() => {
    if (!route) return [];
    const later = whenAt != null;
    const multi = stops.length > 0;
    const out: BoardOption[] = [];
    if (bodaOn) out.push({
      id: "boda", prefer: "boda", title: "Boda", icon: Bike, direct: true,
      sub: later ? "Boda rides are booked for now" : multi ? `${stops.length} stop${stops.length === 1 ? "" : "s"} · +${formatUgx(rideQuote?.stopFees ?? 0)} stop fees` : "Quickest through traffic",
      // The server quote when there is one; otherwise the same rate the server uses (single destination only).
      fare: rideQuote?.quote ?? (multi ? null : bodaFare(km, rates?.ratePerKm, rates?.minimum)),
      roundedFrom: rideQuote ? rideQuote.roundedFrom ?? null : multi || rates == null ? null : bodaExact(km, rates.ratePerKm, rates.minimum),
      pending: multi ? rideQuoteState === "loading" : rates == null && rideQuote == null,
      blocked: later ? "Now only" : multi && rideQuoteState === "failed" ? "Stops unavailable" : undefined,
      handoff: { mode: "boda", autoBook: true },
    });
    if (tiers && carOn) {
      const o = carOptions?.find((x) => x.size === carSize && x.tier === carTier);
      const sizeInfo = CAR_SIZES.find((z) => z.id === carSize)!;
      const base = `${sizeInfo.label} · ${carTier === "comfort" ? "Comfort" : "Convenient"}`;
      out.push({
        id: "car", prefer: "car", title: "Car", icon: carSize === "large" ? CarFront : Car, direct: true,
        sub: o ? (o.nearby > 0 ? `${base} · ${o.nearby} nearby` : later ? base : `${base} · none nearby`) : base,
        fare: o?.fare ?? null, roundedFrom: o?.roundedFrom ?? null, pending: carOptions == null,
        blocked: multi ? "No stops" : o && !later && o.nearby === 0 ? "None nearby" : carOptions != null && !o ? "Unavailable" : undefined,
        handoff: { mode: "car", tier: carTier, size: carSize, autoBook: true },
        navSub: base,
      });
    }
    if (lightestCargo) {
      const q = quotes[lightestCargo.id];
      out.push({
        id: "move", prefer: "move", title: "Move", icon: Truck, direct: false,
        sub: `${lightestCargo.size_label ?? lightestCargo.name} · bigger trucks next`,
        fare: q ?? categoryFare(km, lightestCargo.rate_per_km, lightestCargo.minimum_fare), pending: !(lightestCargo.id in quotes),
        blocked: multi ? "No stops" : undefined,
        handoff: { mode: "car", cargo: true, cargoCategoryId: lightestCargo.id, autoBook: false },
      });
    }
    if (cheapestLuxury) {
      const q = quotes[cheapestLuxury.id];
      out.push({
        id: "luxury", prefer: "luxury", title: "VIP", icon: Crown, direct: false,
        sub: "Chauffeur · hire by the hour next",
        fare: q ?? categoryFare(km, cheapestLuxury.rate_per_km, cheapestLuxury.minimum_fare), pending: !(cheapestLuxury.id in quotes),
        blocked: multi ? "No stops" : undefined,
        handoff: { mode: "car", service: "luxury", specialId: cheapestLuxury.id, autoBook: false },
      });
    }
    return out;
  }, [route, whenAt, km, rates, tiers, bodaOn, carOn, carOptions, carSize, carTier, quotes, lightestCargo, cheapestLuxury, stops.length, rideQuote, rideQuoteState]);

  const bookable = options.filter((o) => !o.blocked && !o.pending && o.fare != null);
  const bestValue = bookable.length > 1 ? bookable.reduce((a, b) => (b.fare! < a.fare! ? b : a)).id : null;
  // Keep the customer's pick; otherwise the first open option of their preferred type.
  useEffect(() => {
    if (!route) return setSelected(null);
    const current = options.find((o) => o.id === selected);
    if (current && !current.blocked) return;
    const next = options.find((o) => o.prefer === prefer && !o.blocked) ?? options.find((o) => !o.blocked);
    if (next && next.id !== selected) setSelected(next.id);
  }, [route, options, prefer, selected]);
  const chosen = options.find((o) => o.id === selected) ?? null;
  const stopMinutes = stops.length * 3;
  const arrive = arrivalLabel(rideMin != null ? rideMin + stopMinutes : null, whenAt);

  // Name your fare: only for Boda "now", only when the server offers a band.
  const nyfAvailable = chosen?.id === "boda" && !whenAt && !!offerBand && rideQuote != null;
  const nyfActive = nyfAvailable && nyfOn;
  useEffect(() => {
    // Keep the slider inside the current band (it moves when stops change the quote).
    if (!offerBand || !rideQuote) return;
    setNyfValue((v) => (v == null ? Math.max(offerBand.min, Math.round((rideQuote.quote * 0.9) / 500) * 500) : Math.min(offerBand.max, Math.max(offerBand.min, v))));
  }, [offerBand?.min, offerBand?.max, rideQuote?.quote]);
  const stopInputs = stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ area: s.area ?? s.label ?? undefined, address: s.address ?? undefined, lat: s.lat!, lng: s.lng! }));

  async function sendOffer() {
    if (!route?.pickup || !route.destination || nyfValue == null) return;
    setOffering(true);
    setOfferError(null);
    const pf = placeFields(route.pickup);
    const df = placeFields(route.destination);
    try {
      const list = await api.createList({ title: "Ride" });
      await api.createOrder({
        listId: list.listId, type: "parcel", isRide: true,
        pickupArea: pf.area, pickupAddress: pf.address, pickupLat: pf.lat, pickupLng: pf.lng,
        destinationArea: df.area, destinationAddress: df.address, destinationLat: df.lat, destinationLng: df.lng,
        paymentRail: "escrow",
        fareOffer: nyfValue,
        ...(stopInputs.length ? { stops: stopInputs } : {}),
        ...(passenger ? { passenger } : {}),
      });
      setRoute(null); setStops([]); setNyfOn(false); setFull(false);
      await refreshActive();
    } catch (err) {
      setOfferError(errorMessage(err));
    } finally {
      setOffering(false);
    }
  }
  const bestCounter = offerLive ? [...extras.counters].sort((a, b) => a.amount - b.amount)[0] ?? null : null;
  const [accepting, setAccepting] = useState(false);
  async function acceptCounter(c: FareCounter) {
    if (!active) return;
    setAccepting(true);
    try { await api.decideFeeProposal(active.id, c.id, true); } catch { /* the panel shows the latest state */ }
    await refreshActive();
    setAccepting(false);
  }

  // ---- sheet size → map inset ------------------------------------------
  const boardOpen = !!route;
  const expanded = full || boardOpen;
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    // Settle first: refitting the map on every frame of the sheet's height transition is wasted work.
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setSheetH(el.getBoundingClientRect().height), 380);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);
  const drag = useRef<{ y: number } | null>(null);

  // ---- navigation: the nav's right button drives each step -------------
  const choose = (dest: Place) => {
    const from = currentLocationPlace() ?? here;
    if (from && !sameSpot(from, dest)) setRoute({ pickup: from, destination: dest, passenger });
    else setPlaceFlow({ pickup: from, destination: dest });
  };
  const openPicker = () => setPlaceFlow({ pickup: route?.pickup ?? currentLocationPlace() ?? here, destination: route?.destination ?? null });
  const firstName = active?.rider_name?.split(" ")[0] ?? trip.car?.driverName?.split(" ")[0] ?? null;

  const nextRaise = offerLive && extras.offer && extras.offer.raisesLeft > 0 && extras.offer.amount + 500 <= extras.offer.max ? extras.offer.amount + 500 : null;
  const navAction = handoff || placeFlow || pickingWho || stopPicker ? null
    : route
      ? chosen && nyfActive && nyfValue != null
        ? {
            tone: "gold" as const,
            label: offering ? "Sending offer…" : `Offer ${formatUgx(nyfValue)}`,
            sublabel: ["Boda", stops.length ? `${stops.length} stop${stops.length === 1 ? "" : "s"}` : null, "riders accept or counter"].filter(Boolean).join(" · "),
            icon: HandCoins,
            disabled: offering,
            onClick: () => void sendOffer(),
          }
        : chosen
        ? {
            tone: chosen.direct ? ("gold" as const) : ("step" as const),
            label: chosen.direct ? `Book ${chosen.prefer === "car" ? "Car" : chosen.title}` : `Next: ${chosen.title} details`,
            sublabel: [chosen.navSub ?? null, whenLabel(whenAt), passenger ? `for ${passenger.name}` : null].filter(Boolean).join(" · "),
            detail: chosen.fare != null ? formatUgx(chosen.fare) : undefined,
            icon: chosen.icon,
            disabled: !!chosen.blocked || chosen.pending,
            onClick: () => {
              if (route.destination && route.pickup) setHandoff(chosen.handoff);
            },
          }
        : { tone: "step" as const, label: "Checking prices…", disabled: true, onClick: () => {} }
      : offerLive && bestCounter
        ? { tone: "gold" as const, label: accepting ? "Accepting…" : `Accept ${bestCounter.rider_name ?? "rider"}`, sublabel: "Cheapest counter", detail: formatUgx(bestCounter.amount), icon: Check, disabled: accepting, onClick: () => void acceptCounter(bestCounter) }
      : offerLive
        ? nextRaise
          ? { tone: "step" as const, label: `Raise to ${formatUgx(nextRaise)}`, sublabel: "Waiting for riders to accept or counter", icon: HandCoins, onClick: () => void api.raiseFareOffer(active!.id, { amount: nextRaise }, `raise-${active!.id}-${nextRaise}`).then(refreshActive, refreshActive) }
          : { tone: "step" as const, label: "Waiting for riders…", sublabel: extras.offer ? `Your offer ${formatUgx(extras.offer.amount)}` : undefined, disabled: true, onClick: () => {} }
      : active && active.rider_id && active.stage === "Match" && active.payment_rail === "escrow"
        ? { tone: "gold" as const, label: "Pay to confirm ride", sublabel: firstName ? `${firstName} is matched` : "Your rider is matched", icon: Wallet, onClick: () => router.push(`/orders/${active.id}/pay`) }
      : active
        ? { tone: "step" as const, label: firstName ? `Track ${firstName}` : "Track your ride", sublabel: "Live map, chat and PIN", onClick: () => router.push(`/orders/${active.id}`) }
        : { tone: "step" as const, label: "Next: choose destination", sublabel: `${PREFER_LABEL[prefer]} · ${whenLabel(whenAt)}`, onClick: openPicker };
  useRegisterNavPrimaryAction(navAction);
  useRegisterNavBack(!!route && !handoff && !placeFlow && !stopPicker, () => { setRoute(null); setStops([]); setNyfOn(false); setFull(false); });

  // ---- places row ------------------------------------------------------
  const savedPlaces = places.saved.map((s) => ({ ...placeFromSaved(s), id: s.id }));
  const usual = predictUsual(savedPlaces);
  const placeChips: Array<{ key: string; place: Place; tag: string; hot?: boolean }> = [];
  if (usual) placeChips.push({ key: `u-${usual.id}`, place: usual, tag: "Usual now", hot: true });
  for (const s of savedPlaces) if (s !== usual) placeChips.push({ key: `s-${s.id}`, place: s, tag: "Saved" });
  for (const [i, r] of places.recent.entries()) {
    if (placeChips.length >= 7) break;
    if (r.lat == null || placeChips.some((c) => sameSpot(c.place, r))) continue;
    placeChips.push({ key: `r-${i}`, place: r, tag: "Recent" });
  }
  const scheduledTrip = active && trip.car?.scheduledFor && new Date(trip.car.scheduledFor).getTime() > Date.now() ? trip.car.scheduledFor : null;

  // ---- ride types ------------------------------------------------------
  type ModeItem = { id: string; module?: string; label: string; icon: LucideIcon; sub: string; prefer?: Prefer; href?: string; onGo?: () => void };
  const bodaFrom = rates ? bodaFare(0, rates.ratePerKm, rates.minimum) : null;
  const allModes: ModeItem[] = [
    { id: "boda", module: "ride.boda", label: "Boda", icon: Bike, sub: bodaFrom ? `from ${bodaFrom.toLocaleString("en-UG")}` : "Quick in town", prefer: "boda" },
    // Taxipress (when it is on) sits right after Boda.
    ...(taxipress.enabled ? [{ id: "taxipress", module: "ride.taxipress", label: "Taxipress", icon: Bus, sub: "Book a seat", href: "/ride/taxipress" }] : []),
    tiers
      ? { id: "car", module: "ride.car", label: "Car", icon: Car, sub: nearbyCars ? `${nearbyCars} nearby` : `from ${tiers.minimumFare.toLocaleString("en-UG")}`, prefer: "car" }
      : { id: "car", module: "ride.car", label: "Car", icon: Car, sub: "Book a car", href: "/ride/car" },
    { id: "rideshare", module: "ride.car.carpool", label: "Rideshare", icon: UsersRound, sub: "Shared seats", href: "/carpool" },
    { id: "selfdrive", module: "ride.car.selfdrive", label: "Selfdrive", icon: CarFront, sub: "Drive yourself", href: "/rent", onGo: () => route && saveSelfDriveRoute(route) },
    { id: "move", module: "ride.move", label: "Move", icon: Truck, sub: lightestCargo ? `from ${Math.round(lightestCargo.minimum_fare / 1000)}k` : "Vans & trucks", prefer: "move" },
    ...(special.luxury ? [{ id: "luxury", module: "ride.luxury", label: "VIP", icon: Crown, sub: "By the hour", prefer: "luxury" as Prefer }] : []),
    // Parcel moved here from the old Send button.
    { id: "parcel", module: "deliver.parcel", label: "Parcel", icon: Package, sub: "Send a package", href: "/deliver/parcel" },
  ];

  const modes = filterByModule(allModes, moduleOn);

  const sheetStyle = { height: expanded ? "calc(100% - 12px)" : "min(60%, 500px)" };
  const whoLabel = passenger ? `For ${passenger.name.split(" ")[0]}` : "For me";

  return (
    <div className="ride-home relative overflow-hidden">
      <h1 className="sr-only">Ride with Peebee</h1>
      <div className="absolute inset-0 isolate z-0">
        <RideLiveMap
          pickup={route?.pickup ?? undefined}
          destination={route?.destination ?? undefined}
          stops={route ? stopInputs : undefined}
          bottomInset={sheetH}
        />
        {!route && nearbyCars != null && nearbyCars > 0 && (
          <p className="pointer-events-none absolute left-3 top-3 z-[500] flex h-10 items-center gap-2 rounded-full glass-panel px-3.5 text-[13px] font-bold text-ink shadow-[var(--shadow-float-capsule)]">
            <span className="ride-live-dot h-2 w-2 rounded-full bg-green" aria-hidden />
            {nearbyCars} car{nearbyCars === 1 ? "" : "s"} near you
          </p>
        )}
      </div>

      <section
        ref={sheetRef}
        aria-label={route ? "Compare rides" : "Plan a ride"}
        className="ride-sheet absolute inset-x-0 bottom-0 z-10 flex flex-col"
        style={sheetStyle}
      >
        <button
          type="button"
          aria-label={expanded ? "Show more map" : "Expand ride options"}
          aria-expanded={expanded}
          disabled={boardOpen}
          onClick={() => setFull((f) => !f)}
          onPointerDown={(e) => { drag.current = { y: e.clientY }; }}
          onPointerUp={(e) => {
            const start = drag.current; drag.current = null;
            if (!start || boardOpen) return;
            const dy = e.clientY - start.y;
            if (dy < -30) { e.preventDefault(); setFull(true); }
            else if (dy > 30) { e.preventDefault(); setFull(false); }
          }}
          className="flex h-6 w-full shrink-0 touch-none items-start justify-center pt-2.5"
        >
          <span className="h-1.5 w-10 rounded-full bg-[rgb(var(--color-ink-500)/0.28)]" aria-hidden />
        </button>

        <div className="customer-nav-content-clearance min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-1">
          {route ? (
            <>
              <div className="ride-route-card flex items-stretch gap-3 rounded-2xl p-3">
                <span className="flex flex-col items-center pt-1.5" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full border-[2.5px] border-ink" />
                  <span className="my-1 w-px flex-1 bg-[rgb(var(--color-ink-500)/0.35)]" />
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-ink" />
                </span>
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block truncate text-sm font-semibold text-ink-500">{route.pickup?.label ?? "Pickup"}</span>
                  <span className="block truncate text-[15px] font-bold text-ink">{route.destination.label}</span>
                  <span className="flex flex-wrap gap-1.5 text-xs font-semibold text-ink-500">
                    {roadKm != null && <span className="ride-pill"><Route className="h-3.5 w-3.5" aria-hidden />{roadKm.toFixed(1)} km</span>}
                    {rideMin != null && <span className="ride-pill"><Clock className="h-3.5 w-3.5" aria-hidden />{rideMin} min ride</span>}
                    {whenAt && <span className="ride-pill"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{whenLabel(whenAt)}</span>}
                    {passenger && <span className="ride-pill"><Users className="h-3.5 w-3.5" aria-hidden />{passenger.name}</span>}
                  </span>
                </span>
                <button type="button" onClick={openPicker} className="flex h-10 shrink-0 items-center gap-1 self-center rounded-full bg-[rgb(var(--surface-muted))] px-3 text-xs font-bold text-ink" aria-label="Change pickup or destination">
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden /> Change
                </button>
              </div>

              <RideStopsEditor
                stops={stops}
                maxStops={maxStops}
                stopFee={rideQuote?.stopFee ?? null}
                onAdd={() => setStopPicker(true)}
                onMove={(i, by) => setStops((list) => {
                  const next = [...list];
                  const j = i + by;
                  if (j < 0 || j >= next.length) return list;
                  [next[i], next[j]] = [next[j], next[i]];
                  return next;
                })}
                onRemove={(i) => setStops((list) => list.filter((_, k) => k !== i))}
              />

              <fieldset>
                <legend className="mb-2 flex w-full items-baseline justify-between">
                  <span className="text-[15px] font-bold text-ink">Compare rides</span>
                  <span className="text-xs font-semibold text-ink-500">Upfront fares · pay by MoMo</span>
                </legend>
                <div className="ride-board overflow-hidden rounded-[22px]">
                  {options.map((o) => {
                    const Icon = o.icon;
                    const on = o.id === selected;
                    const isCar = o.id === "car";
                    const hasOpt = (size: CarSize, tier?: CarTier) => !!carOptions?.some((x) => x.size === size && (tier == null || x.tier === tier));
                    const otherTier: CarTier = carTier === "comfort" ? "convenient" : "comfort";
                    const feel = (size: CarSize, tier: CarTier) => carOptions?.find((x) => x.size === size && x.tier === tier)?.fare;
                    const comfortExtra = feel(carSize, "comfort") != null && feel(carSize, "convenient") != null ? feel(carSize, "comfort")! - feel(carSize, "convenient")! : null;
                    return (
                      <div key={o.id} className={`ride-board__row ${on ? "is-on" : ""} ${o.blocked ? "is-blocked" : ""}`}>
                        <label className={`flex items-center gap-3 px-3.5 py-3 ${o.blocked ? "cursor-not-allowed" : "cursor-pointer"}`}>
                          <input
                            type="radio" name="ride-option" value={o.id} checked={on} disabled={!!o.blocked} className="sr-only"
                            onChange={() => { setSelected(o.id); setPrefer(o.prefer); if (!isCar) setCarOpen(false); }}
                            // Fires on every tap, including the already-selected row: that tap folds the Car options.
                            onClick={() => { if (isCar) setCarOpen(on ? !carOpen : true); }}
                          />
                          <span className="ride-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"><Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
                              <span className="truncate">{o.title}</span>
                              {isCar && !o.blocked && <ChevronDown className={`h-4 w-4 shrink-0 text-ink-500 transition-transform motion-reduce:transition-none ${on && carOpen ? "rotate-180" : ""}`} aria-hidden />}
                              {o.id === bestValue && <span className="ride-badge">Best value</span>}
                            </span>
                            <span className="block truncate text-xs text-ink-500">{o.sub}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-[15px] font-bold tabular-nums text-ink">
                              {o.pending ? <span className="ride-skeleton inline-block h-4 w-16 rounded" aria-label="Checking fare" /> : o.fare != null ? formatUgx(o.fare) : "On next step"}
                            </span>
                            {!o.pending && <RoundedNote amount={o.fare} from={o.roundedFrom} />}
                            <span className="block text-[11px] font-semibold text-ink-500">{o.blocked ?? (arrive ? `arrive ≈ ${arrive}` : "")}</span>
                          </span>
                        </label>
                        {isCar && on && carOpen && carOptions && (
                          <div id="ride-car-options" className="space-y-3 px-3.5 pb-3.5">
                            <div role="radiogroup" aria-label="Car size" className="grid grid-cols-2 gap-2">
                              {CAR_SIZES.map((z) => {
                                const ok = hasOpt(z.id);
                                const sel = carSize === z.id;
                                return (
                                  <button
                                    key={z.id} type="button" role="radio" aria-checked={sel} disabled={!ok}
                                    onClick={() => { setCarSize(z.id); if (!hasOpt(z.id, carTier) && hasOpt(z.id, otherTier)) setCarTier(otherTier); }}
                                    className={`ride-chip flex-col !items-start justify-center gap-0 py-1.5 text-left ${sel ? "is-on" : ""} ${ok ? "" : "opacity-50"}`}
                                  >
                                    <span className="text-[13px] font-bold">{z.label}</span>
                                    <span className="text-[11px] font-semibold opacity-75">{ok ? z.sub : "Unavailable"}</span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-bold text-ink">Comfort ride</span>
                                <span className="block text-xs text-ink-500">
                                  {hasOpt(carSize, "comfort") ? `Newer cars, more room${comfortExtra != null && comfortExtra > 0 ? ` · +${formatUgx(comfortExtra)}` : ""}` : "Not available for this size"}
                                </span>
                              </span>
                              <button
                                type="button" role="switch" aria-checked={carTier === "comfort"} aria-label="Comfort ride"
                                disabled={!hasOpt(carSize, "comfort")}
                                onClick={() => setCarTier(carTier === "comfort" ? "convenient" : "comfort")}
                                className={`ride-switch relative h-7 w-12 shrink-0 rounded-full disabled:opacity-50 ${carTier === "comfort" ? "is-on" : ""}`}
                              >
                                <span className="ride-switch__knob absolute top-1 h-5 w-5 rounded-full" aria-hidden />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              {nyfAvailable && offerBand && rideQuote && nyfValue != null && (
                <NameYourFare on={nyfOn} onToggle={setNyfOn} quote={rideQuote.quote} band={offerBand} value={nyfValue} onChange={setNyfValue} />
              )}
              {offerError && <p role="alert" className="px-1 text-xs font-semibold text-[rgb(var(--color-red,200_40_40))]">{offerError}</p>}

              {(carpoolOn || selfdriveOn) && <div className="grid grid-cols-2 gap-2">
                {carpoolOn && <Link href="/carpool" className="ride-link-tile flex min-h-14 items-center gap-2.5 rounded-2xl px-3">
                  <UsersRound className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="min-w-0"><span className="block text-sm font-bold text-ink">Rideshare</span><span className="block truncate text-[11px] text-ink-500">Shared seats on this way</span></span>
                </Link>}
                {selfdriveOn && <Link href="/rent" onClick={() => saveSelfDriveRoute(route)} className="ride-link-tile flex min-h-14 items-center gap-2.5 rounded-2xl px-3">
                  <CarFront className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="min-w-0"><span className="block text-sm font-bold text-ink">Selfdrive</span><span className="block truncate text-[11px] text-ink-500">Drive it yourself</span></span>
                </Link>}
              </div>}
              <p className="flex items-start gap-2 px-1 text-xs text-ink-500">
                <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                You pay on the next screen. Mobile Money is held in escrow and released to your rider after the trip.
              </p>
            </>
          ) : (
            <>
              {active && offerLive && extras.offer ? (
                <OfferLivePanel order={active} offer={extras.offer} counters={extras.counters} onChanged={() => void refreshActive()} />
              ) : active ? (
                <RideTripCard order={active} car={trip.car} rider={trip.rider} stops={extras.stops} />
              ) : null}
              <FeeProposalCard />

              <div className="ride-where flex items-center gap-2 rounded-[18px] p-1.5 pl-4">
                <button type="button" onClick={openPicker} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left">
                  <Search className="h-[22px] w-[22px] shrink-0 text-ink" strokeWidth={2.2} aria-hidden />
                  <span className="truncate text-[19px] font-bold tracking-tight text-ink">{active ? "Where to next?" : "Where to?"}</span>
                </button>
                {chips.length > 1 && (
                  <button type="button" onClick={() => setWhenOpen((o) => !o)} aria-expanded={whenOpen} aria-controls="ride-when" className="ride-when-btn flex h-11 shrink-0 items-center gap-1.5 rounded-[13px] px-3 text-[13px] font-bold text-ink">
                    <Clock className="h-4 w-4" aria-hidden /> {whenLabel(whenAt)}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${whenOpen ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                )}
              </div>

              {whenOpen && chips.length > 1 && (
                <div id="ride-when" className="space-y-2">
                  <div role="radiogroup" aria-label="When" className="edge-carousel flex gap-2 overflow-x-auto pb-0.5">
                    {chips.map((c) => (
                      <button key={c.id} type="button" role="radio" aria-checked={whenAt === c.at} onClick={() => { setWhenAt(c.at); setWhenOpen(false); }}
                        className={`ride-chip shrink-0 ${whenAt === c.at ? "is-on" : ""}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {cfg?.scheduled && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-ink-500">
                      <CalendarClock className="h-4 w-4" aria-hidden /> Or pick a time
                      <input
                        type="datetime-local"
                        value={whenAt ?? ""}
                        min={toLocalInput(new Date(Date.now() + cfg.scheduled.minLeadMinutes * 60_000))}
                        max={cfg.scheduled.maxAdvanceHours ? toLocalInput(new Date(Date.now() + cfg.scheduled.maxAdvanceHours * 3_600_000)) : undefined}
                        onChange={(e) => { if (e.target.value && withinSchedule(e.target.value, cfg.scheduled!)) setWhenAt(e.target.value); }}
                        className="min-h-10 flex-1 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-2 text-sm text-ink"
                      />
                    </label>
                  )}
                </div>
              )}

              {(placeChips.length > 0 || scheduledTrip) && (
                <div className="edge-carousel flex snap-x gap-2 overflow-x-auto pb-0.5" role="list" aria-label="Suggested places">
                  {scheduledTrip && active && (
                    <button type="button" role="listitem" onClick={() => router.push(`/orders/${active.id}`)} className="ride-place is-upcoming shrink-0 snap-start">
                      <span className="ride-place__icon"><CalendarClock className="h-4 w-4" aria-hidden /></span>
                      <span className="min-w-0 text-left"><span className="block truncate text-[13px] font-bold text-ink">{active.destination_area ?? "Scheduled ride"}</span><span className="block text-[11px] font-semibold text-ink-500">{whenLabel(toLocalInput(new Date(scheduledTrip)))}</span></span>
                    </button>
                  )}
                  {placeChips.map(({ key, place, tag, hot }) => {
                    const Icon = tag === "Recent" ? History : placeIcon(place.label);
                    return (
                      <button key={key} type="button" role="listitem" onClick={() => choose(place)} className={`ride-place shrink-0 snap-start ${hot ? "is-hot" : ""}`} aria-label={`${place.label}, ${tag}`}>
                        <span className="ride-place__icon"><Icon className="h-4 w-4" aria-hidden /></span>
                        <span className="min-w-0 text-left"><span className="block max-w-[150px] truncate text-[13px] font-bold text-ink">{place.label}</span><span className="block max-w-[150px] truncate text-[11px] font-semibold text-ink-500">{tag}{place.area && place.area !== place.label ? ` · ${place.area}` : ""}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[15px] font-bold text-ink">Ride your way</h2>
                  {forOtherOn && (
                    <button type="button" onClick={() => setPickingWho(true)} className="flex min-h-9 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-xs font-bold text-ink" aria-haspopup="dialog">
                      {passenger ? <Users className="h-3.5 w-3.5" aria-hidden /> : <User className="h-3.5 w-3.5" aria-hidden />}{whoLabel}<ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {/* The selected card draws a 2px gold ring and a soft glow outside its box; the scroll box needs room around the cards or it clips them. */}
                <ul className="edge-carousel -mb-2 -mt-1.5 flex snap-x gap-2 overflow-x-auto pb-3 pt-1.5" aria-label="Ride types">
                  {modes.map((m) => {
                    const Icon = m.icon;
                    const on = !!m.prefer && m.prefer === prefer;
                    const body = (
                      <>
                        <Icon className="ride-mode__icon h-6 w-6" strokeWidth={1.9} aria-hidden />
                        <span className="block">
                          <span className="block text-[13.5px] font-bold text-ink">{m.label}</span>
                          <span className="block truncate text-[11px] font-semibold text-ink-500">{m.sub}</span>
                        </span>
                        {m.href && <ChevronRight className="absolute right-2 top-2.5 h-3.5 w-3.5 text-ink-500" aria-hidden />}
                      </>
                    );
                    return (
                      <li key={m.id} className="shrink-0 snap-start">
                        {m.offline ? (
                          <button type="button" disabled aria-disabled="true" title="Currently Offline" className="ride-mode cursor-not-allowed opacity-40">{body}</button>
                        ) : m.href ? (
                          <Link href={m.href} onClick={m.onGo} className="ride-mode">{body}</Link>
                        ) : (
                          <button type="button" aria-pressed={on} onClick={() => setPrefer(m.prefer!)} className={`ride-mode ${on ? "is-on" : ""}`}>{body}</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="ride-amb flex items-center gap-3 rounded-2xl p-3">
                <span className="ride-amb__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"><Ambulance className="h-5 w-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">Ambulance</span>
                  {special.ambulance || ambulanceCats.length > 0 ? (
                    <Link href="/ride/ambulance" className="inline-flex min-h-6 items-center gap-0.5 whitespace-nowrap text-xs font-bold text-ink-500 underline-offset-2 hover:underline">Request a crew <ChevronRight className="h-3 w-3" aria-hidden /></Link>
                  ) : (
                    <span className="block text-xs text-ink-500">Life in danger? Call now.</span>
                  )}
                </span>
                <HoldToCall number={emergencyNumber} />
              </div>

              <div>
                <button type="button" onClick={() => setTrustOpen((o) => !o)} aria-expanded={trustOpen} aria-controls="ride-trust" className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1 text-left text-[11.5px] font-semibold text-ink-500">
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-green" aria-hidden />Verified riders</span>
                  <span className="inline-flex items-center gap-1"><Share2 className="h-3.5 w-3.5 text-green" aria-hidden />Live trip link</span>
                  <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5 text-green" aria-hidden />MoMo escrow</span>
                  <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${trustOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {trustOpen && (
                  <ul id="ride-trust" className="mt-2 space-y-1.5 rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs text-ink-500">
                    <li><b className="text-ink">Verified riders.</b> Riders and drivers are ID-checked by Peebee before they can take trips.</li>
                    <li><b className="text-ink">Live trip link.</b> Booking for someone? They get a private link to follow the ride live, no app needed.</li>
                    <li><b className="text-ink">MoMo escrow.</b> Your Mobile Money is held safely and only paid out after the trip. A PIN confirms drop-off.</li>
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {placeFlow && (
        <PlaceFlow
          concept="ride"
          initial={{ pickup: placeFlow.pickup ?? null, destination: placeFlow.destination ?? null, passenger }}
          onClose={() => setPlaceFlow(null)}
          onBack={() => setPlaceFlow(null)}
          onDone={(r) => {
            if (r.passenger !== undefined) setPassenger(r.passenger);
            setRoute({ ...r, passenger: r.passenger !== undefined ? r.passenger : passenger });
            setPlaceFlow(null);
          }}
        />
      )}

      {stopPicker && (
        <PlaceFlow
          concept="stop"
          initial={{ destination: null }}
          onClose={() => setStopPicker(false)}
          onBack={() => setStopPicker(false)}
          onDone={(r) => {
            const stop = r.destination;
            if (stop.lat != null && stop.lng != null) setStops((list) => (list.length < Math.max(1, maxStops) ? [...list, stop] : list));
            setStopPicker(false);
          }}
        />
      )}

      {pickingWho && (
        <WhoIsRiding
          passenger={passenger}
          saved={passengers}
          onSaved={setPassengers}
          onPick={(pp) => { setPassenger(pp); setPickingWho(false); }}
          onClose={() => setPickingWho(false)}
        />
      )}

      {handoff && route && (
        <RideModal
          initialRoute={{ ...route, passenger }}
          initialPassenger={passenger}
          initialMode={handoff.mode}
          initialCargo={handoff.cargo}
          initialService={handoff.service}
          initialTier={handoff.tier}
          initialSize={handoff.size}
          initialCargoCategoryId={handoff.cargoCategoryId}
          initialSpecialId={handoff.specialId}
          initialPickupAt={whenAt ?? undefined}
          serviceLocked
          autoBook={handoff.autoBook}
          initialStops={handoff.mode === "boda" && stopInputs.length ? stopInputs : undefined}
          onClose={() => setHandoff(null)}
        />
      )}
    </div>
  );
}
