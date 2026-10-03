"use client";

import { useEffect, useMemo, useState } from "react";
import { friendlyLocationName, geoKey, isCoordinateAddress, readNames, type Place } from "./places";

/** Swaps coordinate-style addresses ("Current location (0.0496, 32.4612)")
 * for a real place name once it's been looked up — instantly when it was
 * seen before, otherwise after one reverse-geocode (spaced out to stay
 * within the free geocoder's limits). `relabel` also renames a place that
 * is only called "Current location" (recent places have no other name). */
export function useFriendlyPlaces(places: Place[], relabel = false): Place[] {
  const [names, setNames] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : readNames()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of places) {
        if (p.lat == null || p.lng == null || !isCoordinateAddress(p.address)) continue;
        const key = geoKey(p.lat, p.lng);
        if (names[key]) continue;
        const { name, fromCache } = await friendlyLocationName(p.lat, p.lng);
        if (cancelled) return;
        if (name) setNames((prev) => ({ ...prev, [key]: name }));
        if (!fromCache) await new Promise((r) => setTimeout(r, 1100));
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  return useMemo(
    () =>
      places.map((p) => {
        if (p.lat == null || p.lng == null || !isCoordinateAddress(p.address)) return p;
        const name = names[geoKey(p.lat, p.lng)];
        if (!name) return { ...p, address: "Current location" }; // never show raw coordinates
        return {
          ...p,
          label: relabel && p.label === "Current location" ? name.split(",")[0] : p.label,
          area: p.area ?? name.split(",").slice(-2).join(",").trim(),
          address: name,
        };
      }),
    [places, names, relabel],
  );
}
