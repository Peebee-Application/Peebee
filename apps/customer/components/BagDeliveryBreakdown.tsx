"use client";

import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import type { BagTrip } from "@peebee/shared";
import { placeSubtitle, type Place } from "../lib/places";
import type { BagDeliveryMode, useBagQuote } from "../lib/bag-quote";
import { deliveryModeName, deliveryModeSubtitle } from "../lib/delivery-modes";
import { BagRelayDetails } from "./BagRelayDetails";
import type { LastMileChoiceValue } from "./LastMileChoice";

type BagQuoteState = ReturnType<typeof useBagQuote>;

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;
const km = (n: number) => `${n.toFixed(1)} km`;

/**
 * Relay (same day, boda and matatu legs) or Direct (instant, one rider), each
 * with the server's delivery price. The API values stay "relay" and "rider".
 */
export function BagDeliveryModeChoice({
  options,
  mode,
  onChange,
  directMaxHours,
  disabled,
}: {
  options: { rider: number; relay: number | null };
  mode: BagDeliveryMode | null;
  onChange: (mode: BagDeliveryMode) => void;
  /** Direct is promised in under this many hours (admin setting). */
  directMaxHours?: number | null;
  disabled?: boolean;
}) {
  if (options.relay == null) return null;
  const choices: Array<{ value: BagDeliveryMode; label: string; note: string; fee: number }> = [
    { value: "relay", label: deliveryModeName("relay"), note: deliveryModeSubtitle("relay"), fee: options.relay },
    { value: "rider", label: deliveryModeName("rider"), note: deliveryModeSubtitle("rider", directMaxHours), fee: options.rider },
  ];
  const current = mode ?? "relay";
  return (
    <div role="radiogroup" aria-label="How it's delivered" className="grid grid-cols-2 gap-2">
      {choices.map((choice) => {
        const selected = current === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(choice.value)}
            className="select-card items-start gap-0.5 text-left"
          >
            <span className="select-card__title text-sm text-ink">{choice.label}</span>
            <span className="select-card__sub">{choice.note}</span>
            <span className="select-card__title text-sm text-ink">{ugx(choice.fee)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One rider's road trip, store by store, and how its delivery fee is made up. */
export function BagTripBreakdown({ trip }: { trip: BagTrip }) {
  const firstStore = trip.legs[0]?.fromName ?? "Store";
  const extraStores = Math.max(0, trip.legs.length - 1);
  const showAdded = trip.addedKm > 0 || trip.addedFee > 0;
  return (
    <div className="space-y-3 text-[11px] text-ink-500">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-ink">Rider&apos;s trip</p>
        {trip.legs.map((leg, i) => (
          <p key={i}>
            {leg.fromName} → {leg.toName} · {km(leg.km)}
          </p>
        ))}
        <p className="font-semibold text-ink">Total trip · {km(trip.totalKm)}</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-ink">Delivery</p>
        <div className="flex justify-between gap-3">
          <span className="min-w-0">Direct: {firstStore} → you · {km(trip.directKm)}</span>
          <span className="shrink-0">{ugx(trip.directFee)}</span>
        </div>
        {showAdded && (
          <div className="flex justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-ink">Added distance</span>
              Extra stops ({extraStores} store{extraStores === 1 ? "" : "s"}) · +{km(trip.addedKm)}
            </span>
            <span className="shrink-0 self-end">{ugx(trip.addedFee)}</span>
          </div>
        )}
        <div className="flex justify-between gap-3 font-semibold text-ink">
          <span>Total</span>
          <span>{ugx(trip.fee)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The delivery part of a bag's summary: the relay-or-rider choice when a relay
 * is offered, then the chosen way's breakdown. Only server amounts are shown.
 */
export function BagDeliveryBreakdown({
  bag,
  storeCount,
  onModeChange,
  lastMile,
  onLastMileChange,
  meetStageId,
  onMeetStageChange,
  onChooseLocation,
  disabled,
  indent = "pl-3",
}: {
  bag: BagQuoteState;
  storeCount: number;
  onModeChange: (mode: BagDeliveryMode) => void;
  lastMile: LastMileChoiceValue;
  onLastMileChange: (value: LastMileChoiceValue) => void;
  meetStageId: string | null;
  onMeetStageChange: (id: string) => void;
  onChooseLocation?: () => void;
  disabled?: boolean;
  indent?: string;
}) {
  const relayOffered = bag.options?.relay != null;
  const showRelay = relayOffered && bag.mode !== "rider" && !!bag.relay;
  const showTrip = !showRelay && !!bag.trip && (!bag.quote || bag.quote.deliveryMode === "rider");
  const fee = bag.quote?.deliveryFee ?? null;

  const status = bag.needsDestination ? (
    onChooseLocation ? (
      <button type="button" onClick={onChooseLocation} className="font-bold text-gold">Choose location</button>
    ) : (
      "Choose location"
    )
  ) : bag.failed ? (
    <button type="button" onClick={bag.retry} className="font-bold text-gold">Retry</button>
  ) : fee == null ? (
    "Calculating…"
  ) : (
    ugx(fee)
  );

  return (
    <div className="space-y-2">
      {relayOffered && bag.options && (
        <BagDeliveryModeChoice options={bag.options} mode={bag.mode} onChange={onModeChange} directMaxHours={bag.directMaxHours} disabled={disabled} />
      )}
      {showTrip && bag.trip && !bag.failed ? (
        <details className={`group ${indent}`}>
          <summary className="flex min-h-9 cursor-pointer select-none list-none items-center gap-1 text-[11px] font-semibold text-gold [&::-webkit-details-marker]:hidden">
            Details
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="mt-2">
            <BagTripBreakdown trip={bag.trip} />
          </div>
        </details>
      ) : (
        <>
          {showRelay && bag.relay && (
            <BagRelayDetails
              relay={bag.relay}
              storeCount={storeCount}
              pickups={bag.quote?.stores.map((store) => store.storeName) ?? []}
              lastMile={lastMile}
              onLastMileChange={onLastMileChange}
              meetStageId={meetStageId}
              onMeetStageChange={onMeetStageChange}
              disabled={disabled}
              className={indent}
            />
          )}
          {/* The chosen way already shows its price above, so a relay needs no second total. */}
          {(!showRelay || fee == null) && (
            <div className={`flex justify-between ${showRelay ? "font-semibold text-ink" : "text-ink-500"}`}>
              <span>{showRelay ? "Delivery total" : "Delivery"}</span>
              <span>{status}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Where the bag goes: tap to choose or change the spot on the map. */
export function BagDestinationCard({
  place,
  ready,
  onChange,
  disabled,
  className = "",
}: {
  place: Place | null;
  ready: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const subtitle = place ? placeSubtitle(place) : "";
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled || !ready}
      aria-label={place ? `Delivery to ${place.label}. Change delivery location` : "Choose delivery location"}
      className={`flex w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3 text-left transition hover:border-gold disabled:opacity-60 ${className}`}
    >
      <MapPin className="h-4 w-4 shrink-0 text-gold" aria-hidden />
      <span className="min-w-0 flex-1">
        {place ? (
          <>
            <span className="block truncate text-xs font-semibold text-ink">{place.label}</span>
            {subtitle && <span className="mt-0.5 block truncate text-[11px] text-ink-500">{subtitle}</span>}
          </>
        ) : (
          <>
            <span className="block text-xs font-semibold text-ink">{ready ? "Choose delivery location" : "Finding your location…"}</span>
            
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-gold">
        {place ? "Change" : "Choose"}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </button>
  );
}
