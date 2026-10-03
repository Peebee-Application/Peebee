import type { SavedLocation } from "@tuma/shared";
import { api } from "./api";

/** One chosen spot — what the order flows turn into pickup/destination fields. */
export type Place = {
  label: string;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

type NominatimResult = { lat: string; lon: string; name?: string; display_name: string; address?: Record<string, string> };

function pickArea(address?: Record<string, string>): string | null {
  if (!address) return null;
  return address.suburb || address.neighbourhood || address.village || address.town || address.city_district || address.city || null;
}

function placeFromNominatim(r: NominatimResult): Place {
  const parts = r.display_name.split(",").map((p) => p.trim());
  return {
    label: r.name?.trim() || parts[0] || r.display_name,
    area: pickArea(r.address),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  };
}

export const placeFromSaved = (loc: SavedLocation): Place => ({
  label: loc.label,
  area: loc.area,
  address: loc.address,
  lat: loc.lat,
  lng: loc.lng,
});

/** The name part of a place, then the rest as a subtitle. */
export function placeSubtitle(p: Place): string {
  const rest = [p.area, p.address].filter(Boolean).join(" · ");
  return rest === p.label ? "" : rest;
}

/** Where the phone last put the customer — written by use-location-label. */
export function cachedPosition(): { lat: number; lng: number; label: string } | null {
  try {
    const raw = localStorage.getItem("tuma-location-label");
    if (!raw) return null;
    const c = JSON.parse(raw) as { lat: number; lng: number; label: string };
    return typeof c.lat === "number" && typeof c.lng === "number" ? c : null;
  } catch {
    return null;
  }
}

export function currentLocationPlace(): Place | null {
  const pos = cachedPosition();
  return pos ? { label: "Current location", area: pos.label, address: pos.label, lat: pos.lat, lng: pos.lng } : null;
}

export async function searchPlaces(query: string, near?: { lat: number; lng: number } | null): Promise<Place[]> {
  // Bias (not restrict) results toward where the customer is — faster and more relevant.
  const view = near ? `&viewbox=${near.lng - 0.4},${near.lat + 0.4},${near.lng + 0.4},${near.lat - 0.4}` : "";
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=ug&q=${encodeURIComponent(query)}${view}`,
  );
  if (!res.ok) return [];
  return ((await res.json()) as NominatimResult[]).map(placeFromNominatim);
}

export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`);
    if (res.ok) return { ...placeFromNominatim((await res.json()) as NominatimResult), lat, lng };
  } catch {}
  return { label: "Pinned location", area: null, address: `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
}

// ---- recently searched (this device) ---------------------------------------

const SEARCH_KEY = "tuma-recent-searches";

export function readRecentSearches(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_KEY) ?? "[]") as Place[];
  } catch {
    return [];
  }
}

export function rememberSearch(place: Place) {
  if (place.lat == null) return;
  const next = [place, ...readRecentSearches().filter((p) => p.address !== place.address)].slice(0, 8);
  try {
    localStorage.setItem(SEARCH_KEY, JSON.stringify(next));
  } catch {}
}

// ---- saved places + recently gone to (account) -----------------------------

export type PlacesBootstrap = { saved: SavedLocation[]; recent: Place[] };
let cached: { at: number; promise: Promise<PlacesBootstrap> } | null = null;

/** Fetched once and shared: Home warms this up so the picker opens with its
 * lists already in hand instead of starting two requests on tap. */
export function loadPlaces(force = false): Promise<PlacesBootstrap> {
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached.promise;
  const promise = Promise.all([
    api.getLocations().then((r) => r.locations).catch(() => [] as SavedLocation[]),
    api
      .getRecentPlaces()
      .then((r) =>
        r.places.map<Place>((p) => ({
          label: (p.address ?? p.area ?? "").split(",")[0]?.trim() || "Recent place",
          area: p.area,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
        })),
      )
      .catch(() => [] as Place[]),
  ]).then(([saved, recent]) => ({ saved, recent }));
  cached = { at: Date.now(), promise };
  return promise;
}

/** Order payload fields from a chosen place. */
export function placeFields(p: Place | null) {
  return { area: p?.area ?? undefined, address: p?.address ?? undefined, lat: p?.lat ?? undefined, lng: p?.lng ?? undefined };
}
