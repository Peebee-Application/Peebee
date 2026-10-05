"use client";

import type { SavedLocation } from "@peebee/shared";
import { Briefcase, Building2, Church, GraduationCap, Home, MapPin, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { PickedLocation } from "./LocationMapPicker";
import { Modal } from "./Modal";
import { api, errorMessage } from "../lib/api";

const LocationMapPicker = dynamic(() => import("./LocationMapPicker").then(m => m.LocationMapPicker), { ssr: false });
const suggestedNames = [{ label: "Home", Icon: Home }, { label: "Office", Icon: Briefcase }, { label: "Workplace", Icon: Building2 }, { label: "School", Icon: GraduationCap }, { label: "Church", Icon: Church }];

export function SavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [point, setPoint] = useState<PickedLocation | null>(null);
  const [step, setStep] = useState<"name" | "map" | "review">("name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getLocations()
      .then((res) => setLocations(res.locations))
      .catch(() => {});
  }

  useEffect(load, []);

  function close() {
    if (busy) return;
    setAdding(false);
    setLabel("");
    setPoint(null);
    setStep("name");
    setError(null);
  }

  function chooseName(name: string) {
    setLabel(name);
    setError(null);
    setStep("map");
  }

  async function save() {
    if (!label.trim()) {
      setError("Give it a name, e.g. Home or Office.");
      return;
    }
    if (!point) {
      setError("Choose a location on the map.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveLocation({
        label: label.trim(),
        area: point.area?.slice(0, 120) ?? undefined,
        address: point.address?.slice(0, 240) || `Pinned location (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`,
        lat: point.lat,
        lng: point.lng,
      });
      setLabel("");
      setPoint(null);
      setStep("name");
      setAdding(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setLocations((prev) => prev.filter((l) => l.id !== id));
    await api.deleteLocation(id).catch(() => load());
  }

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Saved locations</h2>
        {!adding && (
          <button onClick={() => { setAdding(true); setStep("name"); }} className="min-h-11 px-2 text-sm font-bold text-gold">
            + Add
          </button>
        )}
      </div>

      {locations.length === 0 && !adding && (
        <p className="text-sm text-ink-500">No saved locations yet — add Home, Office, or anywhere you order to often.</p>
      )}

      <ul className="space-y-1.5">
        {locations.map((loc) => (
          <li key={loc.id} className="flex items-center gap-2 rounded-xl border border-[var(--border-faint)] px-3 py-2">
            <MapPin className="h-4 w-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{loc.label}</span>
              {(loc.area || loc.address) && (
                <span className="block truncate text-xs text-ink-500">
                  {[loc.area, loc.address].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            <button
              onClick={() => remove(loc.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-500/60 hover:text-red-600"
              aria-label={`Remove ${loc.label}`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      {adding && step === "map" && <LocationMapPicker initial={point ? { lat: point.lat, lng: point.lng } : undefined}
        onCancel={() => setStep(point ? "review" : "name")}
        onConfirm={location => { setPoint(location); setStep("review"); }} />}

      {adding && step !== "map" && (
        <Modal title={step === "name" ? "Name your saved location" : "Save your location"} onClose={close}>
        <div className="space-y-4">
          {step === "name" && <>
            <p className="text-sm text-ink-500">Choose a name, then select the location on the map.</p>
            <div role="group" aria-label="Suggested location names" className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {suggestedNames.map(({ label: name, Icon }) => <button key={name} type="button" onClick={() => chooseName(name)}
                className="flex min-h-12 shrink-0 snap-start items-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-4 text-sm font-semibold text-ink">
                <Icon className="h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />{name}
              </button>)}
            </div>
          </>}
          <label htmlFor="saved-location-name" className="block text-sm font-semibold text-ink">{step === "name" ? "Or enter a custom name" : "Location name"}</label>
          <input
            id="saved-location-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Location name"
            maxLength={60}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold"
          />
          {step === "review" && point && <button type="button" onClick={() => setStep("map")}
            className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] p-3 text-left">
            <MapPin className="h-5 w-5 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block text-sm text-ink">{[point.area, point.address].filter(Boolean).join(" · ") || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}</span><span className="mt-1 block text-xs font-semibold text-gold">Change map location</span></span>
          </button>}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={close}
              disabled={busy}
              className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] py-2 text-sm font-bold text-ink disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={() => step === "name" ? chooseName(label.trim()) : save()}
              disabled={busy || !label.trim()}
              className="flex min-h-12 flex-[2] items-center justify-center gap-1.5 rounded-full bg-gold py-2 text-sm font-bold text-ink-gold disabled:opacity-60"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              {step === "name" ? "Choose on map" : busy ? "Saving…" : "Save location"}
            </button>
          </div>
        </div>
        </Modal>
      )}
    </section>
  );
}
