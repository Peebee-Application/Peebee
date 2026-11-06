"use client";

import { roundFare } from "@peebee/shared";
import type { CarCategory } from "@peebee/shared";
import { Minus, Phone, Plus } from "lucide-react";
import { useEffect } from "react";
import { api } from "../../lib/api";

/** What a Luxury or Ambulance category costs for a trip, matching the server: distance × rate (never below the minimum), plus hours of hire for Luxury. */
export function specialFare(cat: CarCategory, distanceKm: number | null, hireHours = 0): number {
  const trip = distanceKm != null ? roundFare(distanceKm * cat.rate_per_km, cat.minimum_fare) : cat.minimum_fare;
  return trip + (cat.service_group === "luxury" ? Math.max(0, hireHours) * (cat.rate_per_hour ?? 0) : 0);
}

const money = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

type Props = {
  kind: "luxury" | "ambulance";
  categories: CarCategory[];
  selectedId: string;
  onSelect: (id: string) => void;
  distanceKm: number | null;
  pickup: { lat: number | undefined; lng: number | undefined };
  hireHours: number;
  onHireHours: (hours: number) => void;
  maxHireHours: number;
  note: string;
  onNote: (note: string) => void;
  emergencyNumber: string;
  /** How many cars of the chosen category are free near the pickup (null while checking). */
  nearby: number | null;
  onNearby: (n: number | null) => void;
  /** The Now / Later choice, for Luxury only. */
  schedule: React.ReactNode;
  later: boolean;
};

/** The Luxury (weddings, parties, red carpet) and Ambulance (emergency) panels of the ride screen. */
export function SpecialCarServices(p: Props) {
  const selected = p.categories.find((c) => c.id === p.selectedId) ?? p.categories[0];
  const { lat, lng } = p.pickup;
  const checkNearby = p.kind === "ambulance" || !p.later;

  useEffect(() => {
    if (!selected || lat == null || lng == null || !checkNearby) { p.onNearby(null); return; }
    let live = true;
    p.onNearby(null);
    api.getCarCategoryNearby(selected.id, lat, lng).then((r) => { if (live) p.onNearby(r.nearby); }).catch(() => { if (live) p.onNearby(null); });
    return () => { live = false; };
    // onNearby is a state setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, lat, lng, checkNearby]);

  if (!selected) return null;

  if (p.kind === "ambulance") {
    return (
      <div className="space-y-3">
        <div className="space-y-2 rounded-2xl bg-red-50 p-3 text-red-700" role="note">
          <p className="text-sm font-bold">If someone&apos;s life is in danger, call {p.emergencyNumber} now.</p>
          <a href={`tel:${p.emergencyNumber}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-red-700 px-4 text-sm font-bold">
            <Phone className="h-4 w-4" aria-hidden /> Call {p.emergencyNumber}
          </a>
        </div>
        {p.categories.length > 1 && (
          <div role="group" aria-label="Choose an ambulance" className="grid grid-cols-1 gap-2">
            {p.categories.map((cat) => (
              <button key={cat.id} type="button" aria-pressed={cat.id === selected.id} onClick={() => p.onSelect(cat.id)}
                className="select-card text-left">
                <span className="select-card__title text-sm text-ink">{cat.name}</span>
                {cat.description && <span className="select-card__sub">{cat.description}</span>}
                <span className="select-card__title mt-1 text-sm text-ink">{money(specialFare(cat, p.distanceKm))}</span>
              </button>
            ))}
          </div>
        )}
        {p.categories.length === 1 && (
          <p className="text-xs text-ink-500">{selected.description ?? selected.name} · <span className="font-bold text-ink">{money(specialFare(selected, p.distanceKm))}</span></p>
        )}
        <div className="space-y-1">
          <label htmlFor="amb-note" className="block text-xs font-semibold text-ink-500">What is happening? (helps the crew prepare)</label>
          <textarea id="amb-note" rows={3} maxLength={300} value={p.note} onChange={(e) => p.onNote(e.target.value)} placeholder="e.g. Chest pain, conscious, needs oxygen"
            className="w-full resize-none rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5 text-[15px] outline-none focus:border-gold" />
        </div>
        <p className="text-xs text-ink-500" role="status">
          {p.nearby == null ? "Checking for an ambulance near you…" : p.nearby > 0 ? `${p.nearby} ambulance${p.nearby === 1 ? "" : "s"} free near you. The nearest one is sent straight away.` : `No ambulance is free near you right now. Call ${p.emergencyNumber}.`}
        </p>
      </div>
    );
  }

  const hourly = Number(selected.rate_per_hour ?? 0) > 0;
  return (
    <div className="space-y-3">
      {p.schedule}
      <div role="group" aria-label="Choose a luxury car" className="grid grid-cols-1 gap-2">
        {p.categories.map((cat) => (
          <button key={cat.id} type="button" aria-pressed={cat.id === selected.id} onClick={() => p.onSelect(cat.id)}
            className="select-card text-left">
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <span className="select-card__title min-w-0 flex-1 text-sm text-ink">{cat.name}</span>
              <span className="shrink-0 whitespace-nowrap text-sm font-bold text-ink">{money(specialFare(cat, p.distanceKm, cat.id === selected.id ? p.hireHours : 0))}</span>
            </span>
            {cat.description && <span className="select-card__sub">{cat.description}</span>}
            <span className="select-card__sub">{cat.seats ? `${cat.seats} seats · ` : ""}{cat.size_label ?? "Chauffeur driven"}</span>
          </button>
        ))}
      </div>
      {hourly && (
        <div className="space-y-1 rounded-2xl border border-[var(--border-faint)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">Keep the car for the event</p>
              <p className="text-[11px] text-ink-500">{money(selected.rate_per_hour ?? 0)} per hour on top of the trip. 0 hours is just the trip.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" aria-label="Fewer hours" disabled={p.hireHours <= 0} onClick={() => p.onHireHours(Math.max(0, p.hireHours - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden /></button>
              <span className="w-8 text-center text-base font-bold text-ink" aria-live="polite">{p.hireHours}</span>
              <button type="button" aria-label="More hours" disabled={p.hireHours >= p.maxHireHours} onClick={() => p.onHireHours(Math.min(p.maxHireHours, p.hireHours + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden /></button>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="lux-note" className="block text-xs font-semibold text-ink-500">What is the occasion? (optional)</label>
        <input id="lux-note" type="text" maxLength={300} value={p.note} onChange={(e) => p.onNote(e.target.value)} placeholder="e.g. Wedding, red carpet arrival, birthday party"
          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5 text-[15px] outline-none focus:border-gold" />
      </div>
      {!p.later && (
        <p className="text-xs text-ink-500" role="status">
          {p.nearby == null ? "Checking for cars near you…" : p.nearby > 0 ? `${p.nearby} ${selected.name.toLowerCase()} available near you.` : "None of these is free near you right now. Choose Later to book it for a set time."}
        </p>
      )}
    </div>
  );
}
