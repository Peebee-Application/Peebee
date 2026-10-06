"use client";

import { DEFAULT_RIDE_TRACKING_SETTINGS, isFreshLocation, rideIsEnRoute, travelMinutes, type OrderEvent, type OrderRow, type RideTrackingSettings } from "@peebee/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { api } from "../lib/api";
import { jawgTileUrl, useJawgStyle } from "../lib/mapStyle";
import { resolveNavTiles, type NavTiles } from "../lib/navTiles";
import { useRoadRoute } from "../lib/useRoadRoute";

const riderIcon = L.divIcon({
  html: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" fill="#0A0A0A" fill-opacity="0.15"/>
    <circle cx="12" cy="12" r="7" fill="#C9A227" stroke="#FDFBF7" stroke-width="2.5"/>
  </svg>`,
  className: "peebee-rider-dot",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const destinationIcon = L.divIcon({
  html: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22s7-7.94 7-12.75A7 7 0 0 0 5 9.25C5 14.06 12 22 12 22Z" fill="#0A0A0A" stroke="#FDFBF7" stroke-width="1.1"/>
    <circle cx="12" cy="9.4" r="2.6" fill="#FDFBF7"/>
  </svg>`,
  className: "peebee-destination-marker",
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

function FitToMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  const lastTarget = useRef("");
  useEffect(() => {
    if (points.length < 2) return;
    const target = points[points.length - 1].join(",");
    if (lastTarget.current === target && points.every((point) => map.getBounds().contains(L.latLng(point)))) return;
    lastTarget.current = target;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map((p) => p.join(",")).join("|")]);
  return null;
}

function MovingRider({ lat, lng, live }: { lat: number; lng: number; live: boolean }) {
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    const current = marker.current;
    if (!current) return;
    const from = current.getLatLng();
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { current.setLatLng([lat, lng]); return; }
    const started = performance.now();
    let frame = 0;
    function move(time: number) {
      const progress = Math.min(1, (time - started) / 1000);
      current!.setLatLng([from.lat + (lat - from.lat) * progress, from.lng + (lng - from.lng) * progress]);
      if (progress < 1) frame = requestAnimationFrame(move);
    }
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [lat, lng, live]);
  const initial = useRef<[number, number]>([lat, lng]);
  return <Marker ref={marker} position={initial.current} icon={riderIcon} />;
}

function elapsedLabel(sinceIso: string, nowMs: number): string {
  const since = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(sinceIso) ? sinceIso : `${sinceIso.replace(" ", "T")}Z`);
  if (Number.isNaN(since)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - since) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/** Assigned journey GPS, with separate pickup and destination estimates. */
export function LiveTrackingMap({ order, events }: { order: OrderRow; events: OrderEvent[] }) {
  const [tiles, setTiles] = useState<NavTiles | null>(null);
  const jawgStyle = useJawgStyle(tiles?.jawg?.adminLightStyle ?? "normal");
  const [settings, setSettings] = useState<RideTrackingSettings | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api
      .getSettings()
      .then((res) => {
        setTiles(resolveNavTiles(res.settings));
        setSettings(res.settings.rideTracking ?? DEFAULT_RIDE_TRACKING_SETTINGS);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const riderLat = order.rider_lat;
  const riderLng = order.rider_lng;
  const isRecent = isFreshLocation(order.rider_location_updated_at, now, settings?.staleAfterSeconds ?? DEFAULT_RIDE_TRACKING_SETTINGS.staleAfterSeconds);

  // Heading to the customer's own destination once en route; heading to
  // the pickup point beforehand (rides only — parcels/shopping have no
  // "go collect the passenger" leg for the customer to watch).
  const enRoute = rideIsEnRoute(order.stage);
  const targetLat = enRoute ? order.destination_lat : order.pickup_lat ?? order.destination_lat;
  const targetLng = enRoute ? order.destination_lng : order.pickup_lng ?? order.destination_lng;
  const currentLeg = useRoadRoute(settings?.enabled && isRecent ? riderLat : null, settings?.enabled && isRecent ? riderLng : null, targetLat, targetLng, settings?.routeRefreshSeconds);
  const trip = useRoadRoute(settings?.showEstimates && order.is_ride ? order.pickup_lat : null, order.pickup_lng, order.destination_lat, order.destination_lng);
  const route = currentLeg?.route;
  const currentMinutes = currentLeg ? travelMinutes(currentLeg.route.durationSeconds) : null;
  const tripMinutes = trip ? travelMinutes(trip.route.durationSeconds) : null;
  const arrivalSeconds = enRoute ? currentLeg?.route.durationSeconds : currentLeg && trip ? currentLeg.route.durationSeconds + trip.route.durationSeconds : undefined;
  const arrivalTime = arrivalSeconds != null && currentLeg ? new Date(currentLeg.updatedAt + arrivalSeconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  if (!settings?.enabled) return null;
  if (riderLat == null || riderLng == null) return <section className="home-card space-y-2"><h2 className="text-sm font-semibold">Waiting for your rider’s location</h2><p className="text-xs text-ink-500">Pickup arrival time will appear when your rider shares a fresh location.</p>{settings.showEstimates && order.is_ride && tripMinutes && <p className="text-sm font-semibold">Approximately {tripMinutes} min from pickup to destination</p>}</section>;

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
        <span className="text-xs font-semibold text-ink-500">{isRecent ? "Live location" : "Last known location"}</span>
      </div>

      {!isRecent && <p role="status" className="text-xs text-ink-500">Location updates paused{order.rider_location_updated_at ? ` · last updated ${elapsedLabel(order.rider_location_updated_at, now)}` : ""}. Arrival estimates resume with a fresh location.</p>}
      {settings.showEstimates && order.is_ride && <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-ink-500">Pickup</p><p className="font-bold">{enRoute ? "Picked up" : currentMinutes && isRecent ? `~${currentMinutes} min away` : "Waiting for estimate"}</p></div>
        <div><p className="text-xs text-ink-500">Destination</p><p className="font-bold">{order.stage === "Arrived" ? "Arrived" : enRoute ? currentMinutes && isRecent ? `~${currentMinutes} min remaining` : "Waiting for estimate" : tripMinutes ? `~${tripMinutes} min ride` : "Waiting for estimate"}</p>{isRecent && arrivalTime && order.stage !== "Arrived" && <p className="text-xs text-ink-500">Est. arrival {arrivalTime}</p>}</div>
      </div>}
      {settings.showEstimates && !order.is_ride && isRecent && currentMinutes && <p className="text-sm font-semibold">~{currentMinutes} min away</p>}
      {settings.showEstimates && <p className="text-xs text-ink-500">Road estimates exclude live traffic and pickup waiting time.</p>}

      <div className="relative h-56 w-full overflow-hidden rounded-xl">
        {!tiles ? (
          <div className="flex h-full items-center justify-center bg-[rgb(var(--surface-muted))]">
            <Loader2 className="h-5 w-5 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
          </div>
        ) : (
          <MapContainer center={[riderLat, riderLng]} zoom={14} className={`peebee-map h-full w-full${tiles.jawg ? " peebee-map-native" : ""}`} attributionControl={false} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false}>
            <TileLayer
              key={tiles.jawg ? jawgStyle : "static"}
              url={tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.tileUrl}
              attribution={tiles.attribution}
            />
            {route && route.coordinates.length > 1 && (
              <Polyline positions={route.coordinates} pathOptions={{ color: "#C9A227", weight: 4, opacity: 0.85 }} />
            )}
            {targetLat != null && targetLng != null && <Marker position={[targetLat, targetLng]} icon={destinationIcon} />}
            <MovingRider lat={riderLat} lng={riderLng} live={isRecent} />
            <FitToMarkers points={points} />
            <div className="peebee-map-tint" aria-hidden />
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
