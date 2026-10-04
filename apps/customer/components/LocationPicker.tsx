"use client";

import type { SavedLocation } from "@peebee/shared";
import { ChevronRight, Home, Map, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

const LocationMapPicker = dynamic(() => import("./LocationMapPicker").then((m) => m.LocationMapPicker), { ssr: false });

export type LocationTab = "saved" | "map" | "text";

export type PointState = {
  mode: LocationTab;
  selectedLocationId: string | null;
  area: string;
  address: string;
  geoCoords: { lat: number; lng: number } | null;
  geoStatus: "idle" | "locating" | "done" | "error";
  mapArea: string | null;
  mapAddress: string | null;
};

export const emptyPoint: PointState = {
  mode: "map",
  selectedLocationId: null,
  area: "",
  address: "",
  geoCoords: null,
  geoStatus: "idle",
  mapArea: null,
  mapAddress: null,
};

export function resolvePoint(
  point: PointState,
  locations: SavedLocation[],
): { area?: string; address?: string; lat?: number; lng?: number } {
  const selected = locations.find((l) => l.id === point.selectedLocationId);
  if (selected) {
    return {
      area: selected.area ?? undefined,
      address: selected.address ?? undefined,
      lat: selected.lat ?? undefined,
      lng: selected.lng ?? undefined,
    };
  }
  if (point.mode === "map") {
    const typedArea = point.area.trim() || undefined;
    const typedAddress = point.address.trim() || undefined;
    if (point.mapArea || point.mapAddress) {
      return {
        area: typedArea ?? point.mapArea ?? undefined,
        address: typedAddress ?? point.mapAddress ?? undefined,
        lat: point.geoCoords?.lat,
        lng: point.geoCoords?.lng,
      };
    }
    if (point.geoCoords) {
      return {
        area: typedArea,
        address: typedAddress ?? `Current location (${point.geoCoords.lat.toFixed(4)}, ${point.geoCoords.lng.toFixed(4)})`,
        lat: point.geoCoords.lat,
        lng: point.geoCoords.lng,
      };
    }
    return { area: typedArea, address: typedAddress };
  }
  return { area: point.area.trim() || undefined, address: point.address.trim() || undefined };
}

/** A progressive location picker shared by every order-creation flow.
 * Keep the parent screen quiet: a user may choose a saved place or open
 * the full-screen map. Search, current location and pin placement live in
 * that map step instead of competing for attention here. */
export function LocationPicker({
  point,
  setPoint,
  locations,
  detailsLabel = "Landmark / house detail",
}: {
  point: PointState;
  setPoint: (p: PointState) => void;
  locations: SavedLocation[];
  detailsLabel?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const pinnedLabel = point.mapAddress || point.mapArea;
  const selected = locations.find((l) => l.id === point.selectedLocationId);
  const hasMapLocation = point.mode === "map" && Boolean(point.geoCoords);
  const selectedLabel = selected
    ? [selected.label, selected.area, selected.address].filter(Boolean).join(" · ")
    : pinnedLabel || (hasMapLocation ? "Location selected on the map" : null);

  return (
    <div className="space-y-4">
      {locations.length > 0 && (
        <section className="space-y-2.5" aria-labelledby="saved-places-heading">
          <h3 id="saved-places-heading" className="text-base font-bold text-ink">Saved places</h3>
          <div className="grid gap-2">
            {locations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setPoint({ ...point, mode: "saved", selectedLocationId: loc.id })}
                className={`flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-base font-semibold ${
                  point.selectedLocationId === loc.id
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-[var(--border-faint)] text-ink-500"
                }`}
              >
                <Home className="h-5 w-5 shrink-0 text-gold" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{loc.label}</span>
                  {(loc.area || loc.address) && (
                    <span className="mt-0.5 block truncate text-sm font-normal text-ink-500">
                      {[loc.area, loc.address].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-gold px-4 py-3 text-left text-base font-bold text-ink"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Map className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="flex-1">{hasMapLocation ? "Change location on the map" : "Select location on the map"}</span>
        <ChevronRight className="h-5 w-5 text-ink-500" aria-hidden />
      </button>

      {selectedLabel && (
        <div className="flex items-start gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-4" aria-live="polite">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
          <p className="min-w-0 flex-1 text-base font-semibold leading-6 text-ink">{selectedLabel}</p>
        </div>
      )}

      {hasMapLocation && (
        <details className="group rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]">
          <summary className="cursor-pointer list-none px-4 py-3.5 text-base font-semibold text-ink marker:hidden">
            Add address details <span className="font-normal text-ink-500">(optional)</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--border-faint)] p-4">
            <div className="grid gap-3">
              <input
                value={point.area}
                onChange={(e) => setPoint({ ...point, area: e.target.value })}
                placeholder="Area (e.g. Kololo)"
                className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-4 text-base outline-none focus:border-gold"
              />
              <input
                value={point.address}
                onChange={(e) => setPoint({ ...point, address: e.target.value })}
                placeholder={detailsLabel}
                className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-4 text-base outline-none focus:border-gold"
              />
            </div>
            <p className="text-sm leading-5 text-ink-500">A landmark or house detail helps the rider find you.</p>
          </div>
        </details>
      )}

      {showPicker && (
        <LocationMapPicker
          initial={point.geoCoords ?? undefined}
          onCancel={() => setShowPicker(false)}
          onConfirm={(loc) => {
            setPoint({
              ...point,
              mode: "map",
              geoCoords: { lat: loc.lat, lng: loc.lng },
              geoStatus: "done",
              selectedLocationId: null,
              mapArea: loc.area,
              mapAddress: loc.address,
            });
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}
