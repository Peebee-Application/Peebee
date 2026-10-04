"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Check, Loader2, LocateFixed, Navigation, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { api } from "../lib/api";
import { jawgTileUrl, useJawgStyle } from "../lib/mapStyle";
import { fetchDrivingRoute, haversineMeters, resolveNavTiles, type NavTiles, type OsrmRoute } from "../lib/navTiles";

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

function RecenterOnRider({ position, follow }: { position: [number, number]; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow) map.setView(position, map.getZoom() < 15 ? 16 : map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1], follow]);
  return null;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Full-screen in-app turn-by-turn-style navigation — used instead of
 * handing the rider off to Google Maps when admin sets nav mode to
 * "in_app" (see ../lib/settings.ts getNavMode / DeliveryNavigation.tsx).
 * Tracks the rider's live GPS position, draws the driving route from
 * OSRM (free, OSM road data, no API key) once at start, and shows
 * distance/ETA remaining computed live off the rider's position —
 * everything stays on-platform, nothing links out. */
export function InAppNavigation({
  orderId,
  destinationLat,
  destinationLng,
  onArrived,
  onClose,
  confirmButtonLabel = "Confirm Delivery",
}: {
  orderId: string;
  destinationLat: number;
  destinationLng: number;
  onArrived: () => void;
  onClose: () => void;
  confirmButtonLabel?: string;
}) {
  const [tiles, setTiles] = useState<NavTiles | null>(null);
  const jawgStyle = useJawgStyle(tiles?.jawg?.adminLightStyle ?? "normal");
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [route, setRoute] = useState<OsrmRoute | null>(null);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const routeFetched = useRef(false);
  const lastBroadcast = useRef(0);
  const destination: [number, number] = [destinationLat, destinationLng];

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setTiles(resolveNavTiles(res.settings)))
      .catch(() => setTiles({ tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "" }));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Location isn't available on this device.");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setPosition(next);
        if (!routeFetched.current) {
          routeFetched.current = true;
          fetchDrivingRoute({ lat: next[0], lng: next[1] }, { lat: destinationLat, lng: destinationLng }).then(
            (r) => {
              if (r) setRoute(r);
            },
          );
        }
        // Powers the customer's live tracking map — throttled to once
        // every ~5s so a fast GPS tick rate doesn't hammer the API.
        const nowMs = Date.now();
        if (nowMs - lastBroadcast.current > 5000) {
          lastBroadcast.current = nowMs;
          api.postOrderLocation(orderId, next[0], next[1]).catch(() => {});
        }
      },
      () => setError("Couldn't get your location — check location permissions."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, destinationLat, destinationLng]);

  const remainingMeters = position ? haversineMeters({ lat: position[0], lng: position[1] }, { lat: destinationLat, lng: destinationLng }) : null;
  const arrived = remainingMeters != null && remainingMeters < 40;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-cream">
      <div className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-faint)] bg-cream p-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink"
          aria-label="Close navigation"
        >
          <X className="h-4.5 w-4.5" strokeWidth={2.25} aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-semibold text-ink">
          <Navigation className="h-4 w-4 text-gold" strokeWidth={2.25} aria-hidden />
          {remainingMeters != null ? (
            <span>
              {formatDistance(remainingMeters)}
              {route && ` · ~${formatDuration(route.durationSeconds)}`}
            </span>
          ) : (
            <span className="text-ink-500">Locating…</span>
          )}
        </div>
        <span className="h-9 w-9" />
      </div>

      <div className="relative flex-1">
        {!tiles || !position ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
          </div>
        ) : (
          <MapContainer center={position} zoom={16} className={`peebee-map h-full w-full${tiles.jawg ? " peebee-map-native" : ""}`} attributionControl>
            <TileLayer
              key={tiles.jawg ? jawgStyle : "static"}
              url={tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.tileUrl}
              attribution={tiles.attribution}
            />
            {route && route.coordinates.length > 1 && (
              <Polyline positions={route.coordinates} pathOptions={{ color: "#C9A227", weight: 5, opacity: 0.85 }} />
            )}
            <Marker position={destination} icon={destinationIcon} />
            <Marker position={position} icon={riderIcon} />
            <RecenterOnRider position={position} follow={follow} />
            <div className="peebee-map-tint" aria-hidden />
          </MapContainer>
        )}

        {error && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
            <span className="rounded-full bg-red-700/90 px-3 py-1.5 text-center text-xs font-medium text-white">{error}</span>
          </div>
        )}

        <button
          onClick={() => setFollow(true)}
          className="absolute bottom-4 right-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink shadow-lg"
          aria-label="Recenter on my location"
        >
          <LocateFixed className="h-5 w-5 text-gold" strokeWidth={2.25} />
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border-faint)] bg-cream p-3">
        <button
          type="button"
          onClick={onArrived}
          disabled={!arrived}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-50"
        >
          <Check className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          {arrived ? confirmButtonLabel : "Get closer to confirm"}
        </button>
      </div>
    </div>
  );
}
