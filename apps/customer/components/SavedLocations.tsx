"use client";

import type { SavedLocation } from "@peebee/shared";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { emptyPoint, resolvePoint, type PointState } from "./LocationPicker";
import { LocationPicker } from "./LocationPicker";
import { api, errorMessage } from "../lib/api";

export function SavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [point, setPoint] = useState<PointState>(emptyPoint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getLocations()
      .then((res) => setLocations(res.locations))
      .catch(() => {});
  }

  useEffect(load, []);

  async function save() {
    if (!label.trim()) {
      setError("Give it a name, e.g. Home or Office.");
      return;
    }
    const resolved = resolvePoint(point, []);
    if (!resolved.area && !resolved.address) {
      setError("Pin it on the map or type an address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveLocation({
        label: label.trim(),
        area: resolved.area,
        address: resolved.address,
        lat: resolved.lat,
        lng: resolved.lng,
      });
      setLabel("");
      setPoint(emptyPoint);
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
          <button onClick={() => setAdding(true)} className="text-sm font-bold text-gold">
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

      {adding && (
        <div className="space-y-3 border-t border-[var(--border-faint)] pt-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. Home)"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold"
          />
          <LocationPicker point={point} setPoint={setPoint} locations={[]} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAdding(false);
                setPoint(emptyPoint);
                setError(null);
              }}
              className="flex-1 rounded-full border border-[var(--border-faint)] py-2 text-sm font-bold text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex flex-[2] items-center justify-center gap-1.5 rounded-full bg-gold py-2 text-sm font-bold text-ink-gold disabled:opacity-60"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              Save location
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
