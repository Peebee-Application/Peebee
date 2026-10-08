"use client";

import type { RentalVehicle } from "@peebee/shared";
import { useId, useRef, useState } from "react";

const ugx = (amount: number) => `UGX ${amount.toLocaleString("en-UG")}`;

export function RentalCarDetails({ vehicle, roundTripKm, routeLabel, fuelPrice, onFuelPriceChange }: {
  vehicle: RentalVehicle;
  roundTripKm: number | null;
  routeLabel: string | null;
  fuelPrice: number;
  onFuelPriceChange: (price: number) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"fuel" | "specs">("fuel");
  const fuelButton = useRef<HTMLButtonElement>(null);
  const specsButton = useRef<HTMLButtonElement>(null);
  const consumption = vehicle.fuelLitresPerKm;
  const litres = roundTripKm != null && consumption != null && consumption > 0 ? roundTripKm * consumption : null;

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
        <p className="text-lg font-bold text-ink">{ugx(Math.ceil(litres * fuelPrice))}<span className="ml-2 text-xs font-normal text-ink-500">estimated fuel</span></p>
        <p className="text-xs text-ink-500">About {litres.toFixed(1)} L for a {roundTripKm!.toFixed(1)} km round trip.</p>
      </> : <p className="text-xs text-ink-500">{consumption == null || consumption <= 0 ? "Fuel consumption is unavailable for this car." : routeLabel ? "Route distance is currently unavailable. Your selected route is retained." : "No trip route is available. Fuel estimates use the route selected when booking your ride."}</p>}
      {consumption != null && consumption > 0 && <p className="text-xs text-ink-500">This car: about {(consumption * 100).toFixed(1)} L / 100 km.</p>}
      {routeLabel && <p className="text-xs text-ink-500">{routeLabel}</p>}
      <details className="text-xs text-ink-500">
        <summary className="cursor-pointer py-1">Fuel price: {ugx(fuelPrice)} / litre</summary>
        <label className="mt-2 block space-y-1 font-semibold">Update fuel price per litre (UGX)<input type="number" min={1} value={fuelPrice} onChange={(event) => onFuelPriceChange(Math.max(1, Number(event.target.value) || 1))} className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold" /></label>
      </details>
      {litres != null && <p className="text-xs text-ink-500">Assumes the same route back. Actual fuel use varies with traffic, condition and driving style. Fuel is separate from the rental price.</p>}
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
