"use client";

import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { OSM_TILES, loadMapTiles, type Tiles } from "../../lib/map-tiles";
import { jawgTileUrl, useJawgStyle } from "../../lib/mapStyle";
import { destinationIcon, meIcon, pickupIcon } from "../maps/map-icons";
import { SelectedRoadRoute, type SelectedRouteLocations } from "../maps/SelectedRoadRoute";

const KAMPALA: [number, number] = [0.3476, 32.5825];

function FlyTo({ target, nonce }: { target: [number, number] | null; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 16, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, target?.[0], target?.[1]]);
  return null;
}

/** Read-only street map behind the home screen: shows where the customer
 * is, follows the admin's maps provider, no pickers or pins. */
export default function HomeMap({ pickup, destination, bottomInset = 0 }: SelectedRouteLocations & { bottomInset?: number }) {
  const [tiles, setTiles] = useState<Tiles>(OSM_TILES);
  const [ready, setReady] = useState(false);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [locating, setLocating] = useState(false);
  const jawgStyle = useJawgStyle(tiles.jawg?.adminLightStyle ?? "normal");
  const tileUrl = tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.url;
  const pickupPoint: [number, number] | null = pickup?.lat != null && pickup.lng != null ? [pickup.lat, pickup.lng] : null;
  const destinationPoint: [number, number] | null = destination?.lat != null && destination.lng != null ? [destination.lat, destination.lng] : null;
  const hasSelection = !!pickupPoint || !!destinationPoint;

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
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        if (recenter) setNonce((n) => n + 1);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  useEffect(() => { locate(false); }, []);

  if (!ready) return <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={position ?? KAMPALA}
        zoom={position ? 16 : 13}
        zoomControl={false}
        scrollWheelZoom={false}
        className={`peebee-map h-full w-full${tiles.jawg ? " peebee-map-native" : ""}`}
      >
        <TileLayer key={tileUrl} url={tileUrl} attribution={tiles.attribution} />
        <FlyTo target={hasSelection && nonce === 0 ? null : position} nonce={nonce} />
        <SelectedRoadRoute pickup={pickup} destination={destination} bottomInset={bottomInset} />
        {position && <Marker position={position} icon={meIcon} interactive={false} />}
        {pickupPoint && <Marker position={pickupPoint} icon={pickupIcon} interactive={false} />}
        {destinationPoint && <Marker position={destinationPoint} icon={destinationIcon} interactive={false} />}
        <div className="peebee-map-tint" aria-hidden />
      </MapContainer>
      <button
        type="button"
        onClick={() => locate()}
        disabled={locating}
        aria-label="Centre on my location"
        className="absolute right-3 top-3 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink shadow-[var(--shadow-float-capsule)] active:scale-95 disabled:opacity-60"
      >
        <LocateFixed className={`h-5 w-5 ${locating ? "animate-pulse text-gold" : ""}`} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
