import type { DeliverySettings, JawgLightStyle } from "@peebee/shared";
import { jawgTileUrl } from "./mapStyle";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Resolves the tile URL/attribution the in-app navigation map should
 * render with, based on the admin's active maps provider — reuses the
 * same OSM-data raster tile styles as the location pickers (see
 * ../components/maps/StyledOsmPickers.tsx) since in-app navigation is
 * rendered with Leaflet regardless of provider. Google and Mapbox don't
 * offer a raster tile URL usable outside their own SDKs/ToS, so in-app
 * navigation falls back to plain OpenStreetMap tiles for those — the
 * provider toggle still controls the location *pickers* fully; this
 * only affects the live navigation map's look. */
export type NavTiles = {
  tileUrl: string;
  /** Set for Jawg — see OsmStyledPicker. */
  jawg?: { accessToken: string; adminLightStyle: JawgLightStyle };
  attribution: string;
};

export function resolveNavTiles(settings: DeliverySettings): NavTiles {
  switch (settings.mapsActiveProvider) {
    case "maptiler":
      if (settings.mapsMaptilerApiKey) {
        return {
          tileUrl: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(settings.mapsMaptilerApiKey)}`,
          attribution: `${OSM_ATTR} &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>`,
        };
      }
      break;
    case "stadia":
      if (settings.mapsStadiaApiKey) {
        return {
          tileUrl: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(settings.mapsStadiaApiKey)}`,
          attribution: `${OSM_ATTR} &copy; <a href="https://stadiamaps.com/">Stadia Maps</a>`,
        };
      }
      break;
    case "thunderforest":
      if (settings.mapsThunderforestApiKey) {
        return {
          tileUrl: `https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${encodeURIComponent(settings.mapsThunderforestApiKey)}`,
          attribution: `${OSM_ATTR} &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>`,
        };
      }
      break;
    case "jawg":
      if (settings.mapsJawgAccessToken) {
        return {
          tileUrl: jawgTileUrl(settings.mapsJawgLightStyle, settings.mapsJawgAccessToken),
          jawg: { accessToken: settings.mapsJawgAccessToken, adminLightStyle: settings.mapsJawgLightStyle },
          attribution: `${OSM_ATTR} &copy; <a href="https://www.jawg.io/">Jawg</a>`,
        };
      }
      break;
    case "tomtom":
      if (settings.mapsTomtomApiKey) {
        return {
          tileUrl: `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(settings.mapsTomtomApiKey)}`,
          attribution: `&copy; <a href="https://www.tomtom.com/">TomTom</a>`,
        };
      }
      break;
  }
  return { tileUrl: OSM_URL, attribution: OSM_ATTR };
}

export type OsrmRoute = { coordinates: [number, number][]; distanceMeters: number; durationSeconds: number };

/** Free OSRM demo routing server — OSM road-network data, no API key.
 * Rate-limited for production use, which is fine here since this only
 * fires once per navigation start, not per frame. */
export async function fetchDrivingRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<OsrmRoute | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[];
  } | null;
  const route = data?.routes?.[0];
  if (!route || !Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2 ||
      !route.geometry.coordinates.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) ||
      !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}

/** Haversine straight-line distance in meters — used to show live
 * "distance remaining" between route refreshes without re-calling OSRM
 * on every GPS tick. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
