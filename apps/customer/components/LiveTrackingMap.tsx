"use client";

import type { OrderEvent, OrderRow } from "@tuma/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { api } from "../lib/api";
import { jawgTileUrl, useJawgStyle } from "../lib/mapStyle";
import { fetchDrivingRoute, resolveNavTiles, type NavTiles, type OsrmRoute } from "../lib/navTiles";

const riderIcon = L.divIcon({
  html: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" fill="#0A0A0A" fill-opacity="0.15"/>
    <circle cx="12" cy="12" r="7" fill="#C9A227" stroke="#FDFBF7" stroke-width="2.5"/>
  </svg>`,
  className: "tuma-rider-dot",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const destinationIcon = L.divIcon({
  html: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22s7-7.94 7-12.75A7 7 0 0 0 5 9.25C5 14.06 12 22 12 22Z" fill="#0A0A0A" stroke="#FDFBF7" stroke-width="1.1"/>
    <circle cx="12" cy="9.4" r="2.6" fill="#FDFBF7"/>
  </svg>`,
  className: "tuma-destination-marker",
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

function FitToMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map((p) => p.join(",")).join("|")]);
  return null;
}

function elapsedLabel(sinceIso: string, nowMs: number): string {
  const since = new Date(sinceIso.includes("T") ? sinceIso : `${sinceIso.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(since)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - since) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/** Live tracking map on the customer's order-detail page — only rendered
 * while admin has rider navigation set to "in_app" (see
 * apps/api/src/lib/settings.ts getNavMode): that's the only mode where
 * the rider app is actually reporting a live position (see
 * apps/rider/components/InAppNavigation.tsx POST /orders/:id/location).
 * When nav mode is "external" the rider's out in Google Maps and no
 * position ever lands here, so this card just doesn't render — the
 * existing OrderTimeline still covers stage-by-stage progress either way. */
export function LiveTrackingMap({ order, events }: { order: OrderRow; events: OrderEvent[] }) {
  const [tiles, setTiles] = useState<NavTiles | null>(null);
  const jawgStyle = useJawgStyle(tiles?.jawg?.adminLightStyle ?? "normal");
  const [route, setRoute] = useState<OsrmRoute | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastRoutedFor = useRef<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setTiles(resolveNavTiles(res.settings)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const riderLat = order.rider_lat;
  const riderLng = order.rider_lng;
  const isRecent =
    !!order.rider_location_updated_at &&
    now - new Date(`${order.rider_location_updated_at.replace(" ", "T")}Z`).getTime() < 2 * 60 * 1000;

  // Heading to the customer's own destination once en route; heading to
  // the pickup point beforehand (rides only — parcels/shopping have no
  // "go collect the passenger" leg for the customer to watch).
  const targetLat = order.stage === "Deliver" || order.stage === "Arrived" || order.stage === "Handover" ? order.destination_lat : order.pickup_lat ?? order.destination_lat;
  const targetLng = order.stage === "Deliver" || order.stage === "Arrived" || order.stage === "Handover" ? order.destination_lng : order.pickup_lng ?? order.destination_lng;

  useEffect(() => {
    if (riderLat == null || riderLng == null || targetLat == null || targetLng == null) return;
    const key = `${Math.round(riderLat * 500)},${Math.round(riderLng * 500)}->${targetLat},${targetLng}`;
    if (lastRoutedFor.current === key) return;
    lastRoutedFor.current = key;
    fetchDrivingRoute({ lat: riderLat, lng: riderLng }, { lat: targetLat, lng: targetLng }).then((r) => {
      if (r) setRoute(r);
    });
  }, [riderLat, riderLng, targetLat, targetLng]);

  if (riderLat == null || riderLng == null || !isRecent) return null;

  const dispatchEvent = events.find((e) => e.stage === "Match");
  const enRouteEvent = events.find((e) => e.stage === "Deliver" || e.stage === "PickedUp");
  const points: [number, number][] = [[riderLat, riderLng]];
  if (targetLat != null && targetLng != null) points.push([targetLat, targetLng]);

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
            <Navigation className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-ink">Live tracking</h2>
        </div>
        {route && <span className="text-xs font-semibold text-ink-500">~{Math.max(1, Math.round(route.durationSeconds / 60))} min away</span>}
      </div>

      <div className="relative h-56 w-full overflow-hidden rounded-xl">
        {!tiles ? (
          <div className="flex h-full items-center justify-center bg-[rgb(var(--surface-muted))]">
            <Loader2 className="h-5 w-5 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
          </div>
        ) : (
          <MapContainer center={[riderLat, riderLng]} zoom={14} className={`tuma-map h-full w-full${tiles.jawg ? " tuma-map-native" : ""}`} attributionControl={false} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false}>
            <TileLayer
              key={tiles.jawg ? jawgStyle : "static"}
              url={tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.tileUrl}
              attribution={tiles.attribution}
            />
            {route && route.coordinates.length > 1 && (
              <Polyline positions={route.coordinates} pathOptions={{ color: "#C9A227", weight: 4, opacity: 0.85 }} />
            )}
            {targetLat != null && targetLng != null && <Marker position={[targetLat, targetLng]} icon={destinationIcon} />}
            <Marker position={[riderLat, riderLng]} icon={riderIcon} />
            <FitToMarkers points={points} />
            <div className="tuma-map-tint" aria-hidden />
          </MapContainer>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        {dispatchEvent && <span>{order.is_ride ? "Hailed" : "Sent"} {elapsedLabel(dispatchEvent.created_at, now)}</span>}
        {enRouteEvent && <span>On the way {elapsedLabel(enRouteEvent.created_at, now)}</span>}
      </div>
    </section>
  );
}
