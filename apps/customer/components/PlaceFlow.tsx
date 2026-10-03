"use client";

import type { SavedLocation } from "@tuma/shared";
import { ArrowLeft, Briefcase, Clock, History, Home, Loader2, Map as MapIcon, MapPin, Navigation, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslate, type TranslationKey } from "../lib/i18n";
import {
  cachedPosition,
  currentLocationPlace,
  loadPlaces,
  placeFromSaved,
  placeSubtitle,
  readRecentSearches,
  rememberSearch,
  reverseGeocode,
  searchPlaces,
  type Place,
  type PlacesBootstrap,
} from "../lib/places";
import { ListRow, ListRows } from "./ui/ListRow";

const PlaceMap = dynamic(() => import("./maps/PlaceMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />,
});

/** Same flow everywhere; only the wording changes with what's being ordered. */
export type PlaceConcept = "ride" | "parcel" | "shopping" | "food";
export type PlaceResult = { pickup: Place | null; destination: Place };
type Field = "pickup" | "destination";
type View = "landing" | "search" | "map";

const CONFIRM_KEY: Record<PlaceConcept, TranslationKey> = {
  ride: "place_confirm_ride",
  parcel: "place_confirm_parcel",
  shopping: "place_confirm_delivery",
  food: "place_confirm_delivery",
};

function savedIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("work") || l.includes("office")) return Briefcase;
  if (l.includes("home")) return Home;
  return MapPin;
}

/** Saved places: one is a full-width tab; several slide sideways, each ~70%
 * wide so the next one peeks in and shows there's more to the right. */
function SavedSlider({ saved, onPick, heading }: { saved: SavedLocation[]; onPick: (p: Place) => void; heading: string }) {
  if (saved.length === 0) return null;
  const many = saved.length > 1;
  return (
    <section className="space-y-2">
      <h3 className="px-4 text-sm font-bold text-ink-500">{heading}</h3>
      <div className="flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {saved.map((loc) => {
          const Icon = savedIcon(loc.label);
          const sub = [loc.area, loc.address].filter(Boolean).join(" · ");
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => onPick(placeFromSaved(loc))}
              className={`flex shrink-0 snap-start items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3.5 py-3 text-left active:bg-[rgb(var(--surface-muted))] ${
                many ? "w-[70%]" : "w-full"
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{loc.label}</span>
                {sub && <span className="block truncate text-xs text-ink-500">{sub}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PlaceRows({ heading, places, icon, onPick }: { heading: string; places: Place[]; icon: React.ReactNode; onPick: (p: Place) => void }) {
  if (places.length === 0) return null;
  return (
    <section>
      <h3 className="px-4 pb-1 text-sm font-bold text-ink-500">{heading}</h3>
      <div className="px-4">
        <ListRows>
          {places.map((p, i) => (
            <li key={`${p.address ?? p.label}-${i}`}>
              <ListRow icon={icon} title={p.label} subtitle={placeSubtitle(p) || undefined} onClick={() => onPick(p)} />
            </li>
          ))}
        </ListRows>
      </div>
    </section>
  );
}

/** One field in the route card. In search mode the active one is a real
 * input; in map mode it's a tap target. The right-hand icon swaps: a map
 * icon while searching ("pick this on the map"), a search icon while on the
 * map ("go back to searching"). */
function FieldRow({
  field,
  place,
  placeholder,
  active,
  searchMode,
  query,
  onQuery,
  onActivate,
  onIcon,
  inputRef,
}: {
  field: Field;
  place: Place | null;
  placeholder: string;
  active: boolean;
  searchMode: boolean;
  query: string;
  onQuery: (q: string) => void;
  onActivate: () => void;
  onIcon: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const showInput = searchMode && active;
  return (
    <div
      className={`field-box flex min-h-12 items-center gap-3 rounded-2xl border-2 px-3.5 ${
        active ? "border-gold" : "border-[var(--border-faint)]"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
        {field === "pickup" ? (
          <span className="h-3 w-3 rounded-full bg-ink ring-4 ring-[rgb(var(--color-ink)/0.15)]" />
        ) : (
          <MapPin className="h-5 w-5 text-gold" strokeWidth={2.25} />
        )}
      </span>
      {showInput ? (
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={place?.label ?? placeholder}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-500"
        />
      ) : (
        <button type="button" onClick={onActivate} className="min-w-0 flex-1 py-2.5 text-left">
          <span className={`block truncate text-base ${place ? "font-semibold text-ink" : "text-ink-500"}`}>{place?.label ?? placeholder}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onIcon}
        aria-label={searchMode ? "Pick on map" : "Search"}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-ink active:opacity-60"
      >
        {searchMode ? <MapIcon className="h-[18px] w-[18px]" strokeWidth={2} /> : <Search className="h-[18px] w-[18px]" strokeWidth={2.25} />}
      </button>
    </div>
  );
}

/**
 * The location step for every order type — rides, parcels, shopping and
 * food. Three ways in: tap the map, search, or a saved place.
 *  - "landing": the map, with a Search bar and Saved places below it.
 *  - "search": the bar stretches to full height; pickup and destination
 *    fields, then saved places, recently gone to, recently searched.
 *  - "map": full-height map with the fields hovering at the bottom; tapping
 *    the map fills the active field and hops to the other one.
 * Rides and parcels need pickup + destination; shopping and food only a
 * delivery location.
 */
export function PlaceFlow({
  concept,
  initial,
  onDone,
  onClose,
}: {
  concept: PlaceConcept;
  initial?: { pickup?: Place | null; destination?: Place | null };
  onDone: (result: PlaceResult) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const route = concept === "ride" || concept === "parcel";
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>("landing");
  const [returnTo, setReturnTo] = useState<"landing" | "map">("landing");
  const [active, setActive] = useState<Field>("destination");
  const [pickup, setPickup] = useState<Place | null>(initial?.pickup ?? null);
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState<PlacesBootstrap>({ saved: [], recent: [] });
  const [searches, setSearches] = useState<Place[]>([]);
  const [viewportH, setViewportH] = useState(700);
  const pickupInput = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    setMounted(true);
    setViewportH(window.innerHeight);
    document.body.style.overflow = "hidden";
    // A ride/parcel starts from wherever the phone last put the customer.
    if (route && !initial?.pickup) setPickup((p) => p ?? currentLocationPlace());
    setSearches(readRecentSearches());
    void loadPlaces().then(setData);
    return () => {
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search as they type (debounced, newest request wins).
  useEffect(() => {
    if (view !== "search") return;
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      const found = await searchPlaces(q, cachedPosition()).catch(() => []);
      if (seq === searchSeq.current) {
        setResults(found);
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, view]);

  // Put the cursor in whichever field is active.
  useEffect(() => {
    if (view !== "search") return;
    (active === "pickup" ? pickupInput : destinationInput).current?.focus();
  }, [view, active]);

  const other = (f: Field): Field => (f === "pickup" ? "destination" : "pickup");
  const setField = (f: Field, p: Place | null) => (f === "pickup" ? setPickup(p) : setDestination(p));
  const placeOf = (f: Field) => (f === "pickup" ? pickup : destination);
  const titleFor = (f: Field) =>
    f === "pickup" ? t("place_pickup") : concept === "ride" ? t("place_destination") : t("place_delivery");
  const ready = route ? !!pickup && !!destination : !!destination;

  function openSearch(f: Field) {
    setReturnTo(view === "map" ? "map" : "landing");
    setActive(f);
    setQuery("");
    setView("search");
  }

  function choose(place: Place, fromSearch = false) {
    if (fromSearch) {
      rememberSearch(place);
      setSearches(readRecentSearches());
    }
    setQuery("");
    setResults([]);
    setField(active, place);
    if (!route) {
      onDone({ pickup: null, destination: place });
      return;
    }
    // Move on to whichever field is still empty.
    if (!placeOf(other(active))) setActive(other(active));
  }

  async function pickOnMap(lat: number, lng: number) {
    const field = active;
    setField(field, { label: t("place_locating"), area: null, address: null, lat, lng });
    if (view === "landing") setView("map");
    if (route && !placeOf(other(field))) setActive(other(field));
    const resolved = await reverseGeocode(lat, lng);
    // Only fill it in if that pin is still what the field holds.
    const apply = (p: Place | null) => (p && p.lat === lat && p.lng === lng ? resolved : p);
    if (field === "pickup") setPickup(apply);
    else setDestination(apply);
  }

  function confirm() {
    if (!destination) return;
    onDone({ pickup: route ? pickup : null, destination });
  }

  if (!mounted) return null;

  const frameInset = view === "landing" ? Math.round(viewportH * 0.42) : route ? 230 : 160;
  const mapTitle = view === "landing" ? t("place_select_on_map") : titleFor(active);

  const confirmButton = ready && (
    <button
      type="button"
      onClick={confirm}
      className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]"
    >
      {t(CONFIRM_KEY[concept])}
    </button>
  );

  const fieldRows = (searchMode: boolean) => (
    <div className="space-y-2">
      {route && (
        <FieldRow
          field="pickup"
          place={pickup}
          placeholder={t("place_pickup")}
          active={active === "pickup"}
          searchMode={searchMode}
          query={query}
          onQuery={setQuery}
          onActivate={() => setActive("pickup")}
          onIcon={() => (searchMode ? (setActive("pickup"), setView("map")) : openSearch("pickup"))}
          inputRef={pickupInput}
        />
      )}
      <FieldRow
        field="destination"
        place={destination}
        placeholder={titleFor("destination")}
        active={active === "destination"}
        searchMode={searchMode}
        query={query}
        onQuery={setQuery}
        onActivate={() => setActive("destination")}
        onIcon={() => (searchMode ? (setActive("destination"), setView("map")) : openSearch("destination"))}
        inputRef={destinationInput}
      />
    </div>
  );

  const current = currentLocationPlace();

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-cream" role="dialog" aria-modal="true" aria-label={mapTitle}>
      {/* The map is always there underneath; the sheets/fields sit over it. */}
      <div className="absolute inset-0 isolate mx-auto max-w-lg">
        <PlaceMap
          pickup={pickup?.lat != null && pickup.lng != null ? { lat: pickup.lat, lng: pickup.lng } : null}
          destination={destination?.lat != null && destination.lng != null ? { lat: destination.lat, lng: destination.lng } : null}
          onPick={(lat, lng) => void pickOnMap(lat, lng)}
          bottomInset={frameInset}
        />
      </div>

      {view !== "search" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto flex max-w-lg items-start justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink shadow-[var(--shadow-float-capsule)] active:scale-95"
          >
            <X className="h-5 w-5" strokeWidth={2.25} />
          </button>
          <span className="pointer-events-none mt-1 rounded-full bg-[rgb(var(--surface-card))] px-4 py-2.5 text-[15px] font-bold text-ink shadow-[var(--shadow-float-capsule)]">
            {mapTitle}
          </span>
          <span className="h-11 w-11" aria-hidden />
        </div>
      )}

      {view === "landing" && (
        <div className="soft-drawer absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-[rgb(var(--color-ink-500)/0.25)]" aria-hidden />
          <div className="px-4">
            <button
              type="button"
              onClick={() => openSearch("destination")}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 text-left active:scale-[0.99]"
            >
              <Search className="h-5 w-5 shrink-0 text-ink" strokeWidth={2.25} aria-hidden />
              <span className="text-lg font-bold text-ink">{t("place_search")}</span>
            </button>
          </div>
          <SavedSlider saved={data.saved} onPick={(p) => choose(p)} heading={t("place_saved")} />
        </div>
      )}

      {view === "map" && (
        <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="space-y-2.5 rounded-3xl bg-[rgb(var(--surface-card))] p-3 shadow-[var(--shadow-float-capsule)]">
            {fieldRows(false)}
            {confirmButton}
          </div>
        </div>
      )}

      {view === "search" && (
        <div className="absolute inset-0 z-30 mx-auto flex max-w-lg animate-drawer-in flex-col bg-[rgb(var(--surface-card))]">
          <div className="shrink-0 space-y-3 border-b border-[var(--border-faint)] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView(returnTo)}
                aria-label="Back"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-[rgb(var(--surface-muted))]"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
              </button>
              <h2 className="text-lg font-bold text-ink">{route ? t("place_route") : titleFor("destination")}</h2>
            </div>
            {fieldRows(true)}
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            {query.trim().length >= 3 ? (
              <div className="px-4">
                {searching && (
                  <p className="flex items-center gap-2 py-3 text-sm text-ink-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("place_searching")}
                  </p>
                )}
                {!searching && results.length === 0 && <p className="py-3 text-sm text-ink-500">{t("place_no_results")}</p>}
                <ListRows>
                  {results.map((p, i) => (
                    <li key={`${p.address}-${i}`}>
                      <ListRow
                        icon={<MapPin className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                        title={p.label}
                        subtitle={placeSubtitle(p) || undefined}
                        onClick={() => choose(p, true)}
                      />
                    </li>
                  ))}
                </ListRows>
              </div>
            ) : (
              <>
                {active === "pickup" && current && (
                  <div className="px-4">
                    <ListRows>
                      <li>
                        <ListRow
                          icon={<Navigation className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                          title={t("place_current_location")}
                          subtitle={current.area ?? undefined}
                          onClick={() => choose(current)}
                        />
                      </li>
                    </ListRows>
                  </div>
                )}
                <SavedSlider saved={data.saved} onPick={(p) => choose(p)} heading={t("place_saved")} />
                <PlaceRows
                  heading={t("place_recent_trips")}
                  places={data.recent}
                  icon={<History className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                  onPick={(p) => choose(p)}
                />
                <PlaceRows
                  heading={t("place_recent_searches")}
                  places={searches}
                  icon={<Clock className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                  onPick={(p) => choose(p)}
                />
              </>
            )}
          </div>

          {confirmButton && (
            <div className="shrink-0 border-t border-[var(--border-faint)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{confirmButton}</div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
