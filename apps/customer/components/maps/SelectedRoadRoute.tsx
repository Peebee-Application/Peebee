"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import { Polyline, useMap } from "react-leaflet";
import { useTranslate } from "../../lib/i18n";
import { fetchDrivingRoute, type OsrmRoute } from "../../lib/navTiles";

type Location = { lat: number | null; lng: number | null } | null;
export type SelectedRouteLocations = { pickup?: Location; destination?: Location };
type Result = { key: string; route: OsrmRoute | null };

// Reuse the chosen route when moving from the picker to its confirmation map.
let lastRoute: Result | null = null;

export function SelectedRoadRoute({ pickup, destination, bottomInset = 0, topInset = 40 }: SelectedRouteLocations & { bottomInset?: number; topInset?: number }) {
  const map = useMap();
  const t = useTranslate();
  const [result, setResult] = useState<Result | null>(() => lastRoute);
  const fromLat = pickup?.lat ?? null;
  const fromLng = pickup?.lng ?? null;
  const toLat = destination?.lat ?? null;
  const toLng = destination?.lng ?? null;
  const complete = fromLat !== null && fromLng !== null && toLat !== null && toLng !== null;
  const key = complete ? `${fromLat},${fromLng}->${toLat},${toLng}` : null;
  const current = result?.key === key ? result : null;
  const route = current?.route ?? null;

  useEffect(() => {
    if (!key || fromLat === null || fromLng === null || toLat === null || toLng === null) return;
    if (lastRoute?.key === key) {
      setResult(lastRoute);
      return;
    }
    const controller = new AbortController();
    // A stalled lookup must not leave the preview showing "loading" forever.
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    void fetchDrivingRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, controller.signal)
      .then((route) => {
        if (!active) return;
        const next = { key, route };
        if (route) lastRoute = next;
        setResult(next);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [key, fromLat, fromLng, toLat, toLng]);

  useEffect(() => {
    const points: [number, number][] = [];
    if (fromLat !== null && fromLng !== null) points.push([fromLat, fromLng]);
    if (toLat !== null && toLng !== null) points.push([toLat, toLng]);
    if (!points.length) return;
    map.fitBounds(L.latLngBounds([...points, ...(route?.coordinates ?? [])]), {
      paddingTopLeft: [40, topInset],
      paddingBottomRight: [40, bottomInset + 30],
      maxZoom: 16,
      animate: true,
    });
  }, [map, fromLat, fromLng, toLat, toLng, route, bottomInset, topInset]);

  if (!key) return null;
  return <>
    {route && <>
      <Polyline positions={route.coordinates} interactive={false} pathOptions={{ color: "#FDFBF7", weight: 9, opacity: 0.95 }} />
      <Polyline positions={route.coordinates} interactive={false} pathOptions={{ color: "#C9A227", weight: 5, opacity: 1 }} />
    </>}
    {!route && <div role="status" className="pointer-events-none absolute inset-x-3 top-16 z-[500] flex justify-center">
      <span className="rounded-full glass-panel px-3 py-2 text-xs font-semibold text-ink shadow-[var(--shadow-float-capsule)]">
        {t(current ? "place_route_unavailable" : "place_route_loading")}
      </span>
    </div>}
  </>;
}
