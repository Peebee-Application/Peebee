import type { JawgLightStyle } from "@tuma/shared";
import { api } from "./api";

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type Tiles = { url: string; attribution: string; jawg?: { accessToken: string; adminLightStyle: JawgLightStyle } };

export const OSM_TILES: Tiles = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR };

/** Same provider choice as LocationMapPicker. Google and Mapbox need their
 * own SDKs for an interactive map, so these maps use plain OpenStreetMap
 * tiles for those two rather than loading either. */
export function tilesFromSettings(s: Awaited<ReturnType<typeof api.getSettings>>["settings"]): Tiles {
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

let tilesPromise: { at: number; promise: Promise<Tiles> } | null = null;

/** The admin's map provider, fetched once and shared by every map on screen. */
export function loadMapTiles(): Promise<Tiles> {
  if (tilesPromise && Date.now() - tilesPromise.at < 10 * 60_000) return tilesPromise.promise;
  const promise = api
    .getSettings()
    .then((res) => tilesFromSettings(res.settings))
    .catch(() => OSM_TILES);
  tilesPromise = { at: Date.now(), promise };
  return promise;
}
