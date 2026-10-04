"use client";

import { useEffect, useState } from "react";

const CACHE_KEY = "peebee-location-label";
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

type Cached = { label: string; lat: number; lng: number; at: number };

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Cached;
  } catch {
    return null;
  }
}

function writeCache(entry: Cached) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

type NominatimAddress = Record<string, string>;

function pickArea(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  return (
    address.suburb ||
    address.neighbourhood ||
    address.village ||
    address.town ||
    address.city_district ||
    address.city ||
    null
  );
}

function pickCity(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  return address.city || address.town || address.county || null;
}

/** Resolves a short "village/town, city" label for the visitor's current
 * position — used by the header's location pill. Reverse-geocodes via the
 * same free OSM Nominatim endpoint the map picker uses, caches the result
 * for 30 minutes so we don't refetch on every page, and falls back to a
 * generic label if geolocation is denied or unavailable. */
export function useLocationLabel() {
  const [label, setLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "done" | "error">("idle");

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) {
      setLabel(cached.label);
      setStatus("done");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`,
          );
          const data = res.ok ? await res.json() : null;
          const area = pickArea(data?.address);
          const city = pickCity(data?.address);
          const resolved = [area, city].filter(Boolean).join(", ") || area || city || "Your area";
          writeCache({ label: resolved, lat, lng, at: Date.now() });
          setLabel(resolved);
          setStatus("done");
        } catch {
          setStatus("error");
        }
      },
      () => setStatus("error"),
      { timeout: 10000 },
    );
  }, []);

  return { label, status };
}
