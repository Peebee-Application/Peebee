"use client";

import type { JawgLightStyle } from "@tuma/shared";
import { jawgTileUrl } from "../../lib/mapStyle";
import { OsmStyledPicker } from "./OsmStyledPicker";
import type { MapPickerProps } from "./map-types";

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Same OpenStreetMap data and free Nominatim search as StreetMapsPicker,
 * rendered with MapTiler's custom tile styling instead of the plain OSM
 * look — only mounted once an admin saves a working MapTiler key. */
export function MapTilerPicker({ apiKey, ...props }: MapPickerProps & { apiKey: string }) {
  const tileUrl = `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}`;
  return <OsmStyledPicker {...props} tileUrl={tileUrl} attribution={`${OSM_ATTR} &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>`} />;
}

/** Stadia Maps' "Alidade Smooth" style over OSM data. */
export function StadiaMapsPicker({ apiKey, ...props }: MapPickerProps & { apiKey: string }) {
  const tileUrl = `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(apiKey)}`;
  return (
    <OsmStyledPicker
      {...props}
      tileUrl={tileUrl}
      attribution={`${OSM_ATTR} &copy; <a href="https://stadiamaps.com/">Stadia Maps</a>`}
    />
  );
}

/** Thunderforest's "Transport" style over OSM data — leans into road/transit
 * detail, a reasonable default for a delivery/ride app. */
export function ThunderforestPicker({ apiKey, ...props }: MapPickerProps & { apiKey: string }) {
  const tileUrl = `https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${encodeURIComponent(apiKey)}`;
  return (
    <OsmStyledPicker
      {...props}
      tileUrl={tileUrl}
      attribution={`${OSM_ATTR} &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>`}
    />
  );
}

/** Jawg's own designed styles over OSM data: Normal (Sunny) or Light by day,
 * Dark by night, or whatever the user picked in Appearance settings. Because
 * Jawg designs all of them, none get the CSS recoloring the other providers'
 * single style needs for dark mode. */
export function JawgMapsPicker({
  accessToken,
  adminLightStyle,
  ...props
}: MapPickerProps & { accessToken: string; adminLightStyle: JawgLightStyle }) {
  return (
    <OsmStyledPicker
      {...props}
      tileUrl={jawgTileUrl(adminLightStyle, accessToken)}
      jawg={{ accessToken, adminLightStyle }}
      attribution={`${OSM_ATTR} &copy; <a href="https://www.jawg.io/">Jawg</a>`}
    />
  );
}

/** TomTom's own "basic" raster tiles (TomTom map data, not OSM) — search
 * and reverse-geocoding still go through the same free Nominatim as the
 * other Leaflet pickers. */
export function TomTomPicker({ apiKey, ...props }: MapPickerProps & { apiKey: string }) {
  const tileUrl = `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}`;
  return <OsmStyledPicker {...props} tileUrl={tileUrl} attribution={`&copy; <a href="https://www.tomtom.com/">TomTom</a>`} />;
}
