"use client";

import type { JawgLightStyle } from "@tuma/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { GoogleMapPicker } from "./maps/GoogleMapPicker";
import { MapboxMapPicker } from "./maps/MapboxMapPicker";
import { StreetMapsPicker } from "./maps/StreetMapsPicker";
import { JawgMapsPicker, MapTilerPicker, StadiaMapsPicker, ThunderforestPicker, TomTomPicker } from "./maps/StyledOsmPickers";
import type { MapPickerProps, PickedLocation } from "./maps/map-types";

export type { PickedLocation };

type ResolvedProvider =
  | { kind: "streetmaps" }
  | { kind: "google"; apiKey: string }
  | { kind: "mapbox"; accessToken: string }
  | { kind: "maptiler"; apiKey: string }
  | { kind: "stadia"; apiKey: string }
  | { kind: "thunderforest"; apiKey: string }
  | { kind: "jawg"; accessToken: string; adminLightStyle: JawgLightStyle }
  | { kind: "tomtom"; apiKey: string };

/** Picks which map implementation to render based on the admin's active
 * maps provider — Streetmaps (OpenStreetMap/Leaflet, free, no key) by
 * default, or Google/Mapbox/MapTiler/Stadia/Thunderforest/Jawg/TomTom once an
 * admin has saved a working key and switched to it. Always falls back to
 * Streetmaps if the chosen provider's key is missing, so this can never
 * render a broken map. Every call site imports this exact
 * component/prop shape — the underlying provider swap is invisible to
 * them. */
export function LocationMapPicker(props: MapPickerProps) {
  const [provider, setProvider] = useState<ResolvedProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => {
        if (cancelled) return;
        const s = res.settings;
        if (s.mapsActiveProvider === "google" && s.mapsGoogleApiKey) {
          setProvider({ kind: "google", apiKey: s.mapsGoogleApiKey });
        } else if (s.mapsActiveProvider === "mapbox" && s.mapsMapboxAccessToken) {
          setProvider({ kind: "mapbox", accessToken: s.mapsMapboxAccessToken });
        } else if (s.mapsActiveProvider === "maptiler" && s.mapsMaptilerApiKey) {
          setProvider({ kind: "maptiler", apiKey: s.mapsMaptilerApiKey });
        } else if (s.mapsActiveProvider === "stadia" && s.mapsStadiaApiKey) {
          setProvider({ kind: "stadia", apiKey: s.mapsStadiaApiKey });
        } else if (s.mapsActiveProvider === "thunderforest" && s.mapsThunderforestApiKey) {
          setProvider({ kind: "thunderforest", apiKey: s.mapsThunderforestApiKey });
        } else if (s.mapsActiveProvider === "jawg" && s.mapsJawgAccessToken) {
          setProvider({ kind: "jawg", accessToken: s.mapsJawgAccessToken, adminLightStyle: s.mapsJawgLightStyle });
        } else if (s.mapsActiveProvider === "tomtom" && s.mapsTomtomApiKey) {
          setProvider({ kind: "tomtom", apiKey: s.mapsTomtomApiKey });
        } else {
          setProvider({ kind: "streetmaps" });
        }
      })
      .catch(() => {
        if (!cancelled) setProvider({ kind: "streetmaps" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!provider) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-cream">
        <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
      </div>
    );
  }

  switch (provider.kind) {
    case "google":
      return <GoogleMapPicker {...props} apiKey={provider.apiKey} />;
    case "mapbox":
      return <MapboxMapPicker {...props} accessToken={provider.accessToken} />;
    case "maptiler":
      return <MapTilerPicker {...props} apiKey={provider.apiKey} />;
    case "stadia":
      return <StadiaMapsPicker {...props} apiKey={provider.apiKey} />;
    case "thunderforest":
      return <ThunderforestPicker {...props} apiKey={provider.apiKey} />;
    case "jawg":
      return <JawgMapsPicker {...props} accessToken={provider.accessToken} adminLightStyle={provider.adminLightStyle} />;
    case "tomtom":
      return <TomTomPicker {...props} apiKey={provider.apiKey} />;
    default:
      return <StreetMapsPicker {...props} />;
  }
}
