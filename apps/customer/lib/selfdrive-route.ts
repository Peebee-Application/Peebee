import type { PlaceResult } from "../components/PlaceFlow";
import type { Place } from "./places";

const ROUTE_KEY = "peebee-selfdrive-route-v1";

export function saveSelfDriveRoute(route: PlaceResult) {
  try { window.sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ pickup: route.pickup, destination: route.destination })); } catch { /* Storage can be unavailable. */ }
}

function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const place = value as Partial<Place>;
  return typeof place.label === "string" && typeof place.lat === "number" && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 && typeof place.lng === "number" && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180;
}

export function loadSelfDriveRoute(): PlaceResult | null {
  try {
    const route = JSON.parse(window.sessionStorage.getItem(ROUTE_KEY) ?? "null") as Partial<PlaceResult> | null;
    return route && isPlace(route.pickup) && isPlace(route.destination) ? { pickup: route.pickup, destination: route.destination } : null;
  } catch { return null; }
}
