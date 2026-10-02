"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { JawgLightStyle } from "@tuma/shared";
import { LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { api } from "../../lib/api";
import { jawgTileUrl, useJawgStyle } from "../../lib/mapStyle";

const KAMPALA: [number, number] = [0.3476, 32.5825];
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type Tiles = { url: string; attribution: string; jawg?: { accessToken: string; adminLightStyle: JawgLightStyle } };

const OSM_TILES: Tiles = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR };

/** "You are here" dot in the app's gold, ringed in cream like the picker pin. */
const meIcon = L.divIcon({
  html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#C9A227;border:3px solid #FDFBF7;box-shadow:0 0 0 6px rgba(201,162,39,0.25),0 2px 6px rgba(10,10,10,0.35)"></span>`,
  className: "tuma-me-dot",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** Same provider choice as LocationMapPicker. Google and Mapbox need their
 * own SDKs for an interactive map, so the home backdrop uses plain
 * OpenStreetMap tiles for those two rather than loading either. */
function tilesFromSettings(s: Awaited<ReturnType<typeof api.getSettings>>["settings"]): Tiles {
  const enc = encodeURIComponent;
  switch (s.mapsActiveProvider) {
    case "maptiler":
      if (s.mapsMaptilerApiKey)
        return { url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${enc(s.mapsMaptilerApiKey)}`, attribution: `${OSM_ATTR} &copy; MapTiler` };
      break;
    case "stadia":
      if (s.mapsStadiaApiKey)
        return { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${enc(s.mapsStadiaApiKey)}`, attribution: `${OSM_ATTR} &copy; Stadia Maps` };
      break;
    case "thunderforest":
      if (s.mapsThunderforestApiKey)
        return { url: `https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${enc(s.mapsThunderforestApiKey)}`, attribution: `${OSM_ATTR} &copy; Thunderforest` };
      break;
    case "jawg":
      if (s.mapsJawgAccessToken)
        return { url: "", attribution: `${OSM_ATTR} &copy; Jawg`, jawg: { accessToken: s.mapsJawgAccessToken, adminLightStyle: s.mapsJawgLightStyle } };
      break;
    case "tomtom":
      if (s.mapsTomtomApiKey)
        return { url: `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${enc(s.mapsTomtomApiKey)}`, attribution: "&copy; TomTom" };
      break;
  }
  return OSM_TILES;
}

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
export default function HomeMap() {
  const [tiles, setTiles] = useState<Tiles>(OSM_TILES);
  const [ready, setReady] = useState(false);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [locating, setLocating] = useState(false);
  const jawgStyle = useJawgStyle(tiles.jawg?.adminLightStyle ?? "normal");
  const tileUrl = tiles.jawg ? jawgTileUrl(jawgStyle, tiles.jawg.accessToken) : tiles.url;

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => !cancelled && setTiles(tilesFromSettings(res.settings)))
      .catch(() => {})
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setNonce((n) => n + 1);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  useEffect(locate, []);

  if (!ready) return <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={position ?? KAMPALA}
        zoom={position ? 16 : 13}
        zoomControl={false}
        scrollWheelZoom={false}
        className={`tuma-map h-full w-full${tiles.jawg ? " tuma-map-native" : ""}`}
      >
        <TileLayer key={tileUrl} url={tileUrl} attribution={tiles.attribution} />
        <FlyTo target={position} nonce={nonce} />
        {position && <Marker position={position} icon={meIcon} interactive={false} />}
        <div className="tuma-map-tint" aria-hidden />
      </MapContainer>
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        aria-label="Centre on my location"
        className="absolute right-3 top-3 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink shadow-[var(--shadow-float-capsule)] active:scale-95 disabled:opacity-60"
      >
        <LocateFixed className={`h-5 w-5 ${locating ? "animate-pulse text-gold" : ""}`} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
