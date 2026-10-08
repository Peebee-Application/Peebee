"use client";

import type { RentalVehicle } from "@peebee/shared";
import { useId, useRef, useState } from "react";

const ugx = (amount: number) => `UGX ${amount.toLocaleString("en-UG")}`;

export function RentalCarDetails({ vehicle, roundTripKm, routeLabel, fuelPrice, onFuelPriceChange, fuelUsePer100Km, onFuelUseChange, tripDistanceKm, onTripDistanceChange }: {
  vehicle: RentalVehicle;
  roundTripKm: number | null;
  routeLabel: string | null;
  fuelPrice: number;
  onFuelPriceChange: (price: number) => void;
  fuelUsePer100Km: number | null;
  onFuelUseChange: (value: number | null) => void;
  tripDistanceKm: number | null;
  onTripDistanceChange: (value: number | null) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"fuel" | "specs">("fuel");
  const fuelButton = useRef<HTMLButtonElement>(null);
  const specsButton = useRef<HTMLButtonElement>(null);
  const litres = tripDistanceKm != null && fuelUsePer100Km != null && fuelUsePer100Km > 0 ? tripDistanceKm * fuelUsePer100Km / 100 : null;

  return <div className="rounded-2xl border border-[var(--border-faint)] p-3">
    <div role="tablist" aria-label={`${vehicle.name} details`} className="flex gap-2">
      {(["fuel", "specs"] as const).map((value) => <button key={value} ref={value === "fuel" ? fuelButton : specsButton} id={`${id}-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "fuel" : event.key === "End" ? "specs" : tab === "fuel" ? "specs" : "fuel";
        setTab(next);
        (next === "fuel" ? fuelButton : specsButton).current?.focus();
      }} className={`min-h-10 flex-1 rounded-full px-3 text-xs font-bold ${tab === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{value === "fuel" ? "Fuel estimate" : "Space & specs"}</button>)}
    </div>
    <div id={`${id}-fuel-panel`} role="tabpanel" aria-labelledby={`${id}-fuel-tab`} hidden={tab !== "fuel"} tabIndex={0} className="space-y-2 pt-3">
      {litres != null ? <>
        <p className="text-lg font-bold text-ink">~ {ugx(Math.round(litres * fuelPrice / 100) * 100)}<span className="ml-2 text-xs font-normal text-ink-500">estimated fuel</span></p>
        <p className="text-xs text-ink-500">About {litres.toFixed(2)} L for {tripDistanceKm!.toFixed(1)} km. Estimate uses your route and the values below.</p>
      </> : <p className="text-xs text-ink-500">Add the trip distance and this car’s fuel use below to calculate an estimate.</p>}
      {routeLabel && <p className="text-xs text-ink-500">{routeLabel}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-[11px] font-semibold text-ink-500">Round-trip distance (km)<input type="number" min={0.1} step={0.1} value={tripDistanceKm ?? ""} onChange={(event) => onTripDistanceChange(event.target.value === "" ? null : Math.max(0.1, Number(event.target.value) || 0.1))} placeholder={roundTripKm?.toFixed(1) ?? "e.g. 20"} className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm text-ink outline-none focus:border-gold" /></label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-500">Fuel use (L/100 km)<input type="number" min={0.1} max={60} step={0.1} value={fuelUsePer100Km ?? ""} onChange={(event) => onFuelUseChange(event.target.value === "" ? null : Math.min(60, Math.max(0.1, Number(event.target.value) || 0.1)))} placeholder="e.g. 8.5" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm text-ink outline-none focus:border-gold" /></label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-500">Fuel price (UGX/L)<input type="number" min={1} step={100} value={fuelPrice} onChange={(event) => onFuelPriceChange(Math.max(1, Number(event.target.value) || 1))} className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm text-ink outline-none focus:border-gold" /></label>
      </div>
      <p className="text-xs text-ink-500">Fuel is separate from the rental price. Real use varies with traffic, vehicle condition, load and driving style; adjust the values if you know your route or car’s actual figures.</p>
    </div>
    <div id={`${id}-specs-panel`} role="tabpanel" aria-labelledby={`${id}-specs-tab`} hidden={tab !== "specs"} tabIndex={0} className="space-y-3 pt-3 text-xs text-ink-500">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt>Seats</dt><dd className="font-bold text-ink">{vehicle.seats ?? "Not specified"}</dd></div>
        <div><dt>Boot space</dt><dd className="font-bold text-ink">{vehicle.luggageLitres ? `${vehicle.luggageLitres} L` : "Not specified"}</dd></div>
        <div><dt>Vehicle class</dt><dd className="font-bold text-ink">{vehicle.serviceClass === "comfort" ? "Comfort" : "Convenient"}</dd></div>
        <div><dt>Condition</dt><dd className="font-bold capitalize text-ink">{vehicle.condition ?? "Not specified"}</dd></div>
      </dl>
      {vehicle.luggageNote && <p>{vehicle.luggageNote}</p>}
      {vehicle.features?.length ? <p>{vehicle.features.join(" · ")}</p> : null}
      {vehicle.lastServiceDate && <p>Last serviced {new Date(`${vehicle.lastServiceDate}T00:00:00`).toLocaleDateString("en-UG", { dateStyle: "medium" })}</p>}
      <p>Owner: {vehicle.ownerName ?? "Vehicle owner"}</p>
      {vehicle.notes && <p>{vehicle.notes}</p>}
      {vehicle.standardDailyPrice != null && <p>Model reference: {ugx(vehicle.standardDailyPrice)} / day · Owner listing: {ugx(vehicle.dailyPrice)} / day</p>}
    </div>
  </div>;
}
