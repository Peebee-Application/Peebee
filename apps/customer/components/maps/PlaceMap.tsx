"use client";

import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { OSM_TILES, loadMapTiles, type Tiles } from "../../lib/map-tiles";
import { jawgTileUrl, useJawgStyle } from "../../lib/mapStyle";
import { cachedPosition } from "../../lib/places";
import { destinationIcon, meIcon, pickupIcon } from "./map-icons";
import { SelectedRoadRoute } from "./SelectedRoadRoute";

type LatLng = { lat: number; lng: number } | null;

const KAMPALA: [number, number] = [0.3476, 32.5825];

function Tap({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyToMe({ target, nonce }: { target: [number, number] | null; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (target && nonce > 0) map.flyTo(target, 16, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return null;
}

/** The map behind the place picker: tap anywhere to choose a spot, shows the
 * customer, the pickup (dot) and the destination (gold pin). Follows the
 * admin's maps provider. */
export default function PlaceMap({
  pickup,
  destination,
  onPick,
  bottomInset,
}: {
  pickup: LatLng;
  destination: LatLng;
  onPick: (lat: number, lng: number) => void;
  bottomInset: number;
}) {
  const [tiles, setTiles] = useState<Tiles>(OSM_TILES);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<[number, number] | null>(() => {
    const c = typeof window === "undefined" ? null : cachedPosition();
    return c ? [c.lat, c.lng] : null;
  });
  const [nonce, setNonce] = useState(0);
  const [locating, setLocating] = useState(false);
  const jawgStyle = useJawgStyle(tiles.jawg?.adminLightStyle ?? "normal");
  const tileUrl = tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.url;

  useEffect(() => {
    let cancelled = false;
    loadMapTiles()
      .then((t) => !cancelled && setTiles(t))
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  function locate(recenter = true) {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe([pos.coords.latitude, pos.coords.longitude]);
        if (recenter) setNonce((n) => n + 1);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // First paint uses the cached position if there is one; otherwise ask once.
  useEffect(() => {
    if (!me) locate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />;

  const start = pickup ?? destination;
  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={start ? [start.lat, start.lng] : (me ?? KAMPALA)}
        zoom={start || me ? 15 : 12}
        zoomControl={false}
        className={`peebee-map h-full w-full${tiles.jawg ? " peebee-map-native" : ""}`}
      >
        <TileLayer key={tileUrl} url={tileUrl} attribution={tiles.attribution} />
        <Tap onPick={onPick} />
        <SelectedRoadRoute pickup={pickup} destination={destination} bottomInset={bottomInset} topInset={110} />
        <FlyToMe target={me} nonce={nonce} />
        {me && <Marker position={me} icon={meIcon} interactive={false} />}
        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} interactive={false} />}
        {destination && <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} interactive={false} />}
        <div className="peebee-map-tint" aria-hidden />
      </MapContainer>
      <button
        type="button"
        onClick={() => locate()}
        disabled={locating}
        aria-label="Centre on my location"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink shadow-[var(--shadow-float-capsule)] active:scale-95 disabled:opacity-60"
      >
        <LocateFixed className={`h-5 w-5 ${locating ? "animate-pulse text-gold" : ""}`} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
