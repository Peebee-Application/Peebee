"use client";

import type { JawgLightStyle } from "@peebee/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancelRef.current(); }
      if (event.key !== "Tab") return;
      event.stopImmediatePropagation();
      const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus(); }
      else if (event.shiftKey && (document.activeElement === dialog || document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === dialog || document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [mounted]);

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

  if (!mounted) return null;
  let content: React.ReactNode;
  if (!provider) {
    content = (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-cream">
        <button type="button" onClick={props.onCancel} className="absolute left-4 top-4 min-h-11 rounded-full border border-[var(--border-faint)] px-4 font-semibold text-ink">Cancel</button>
        <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
      </div>
    );
  } else switch (provider.kind) {
    case "google":
      content = <GoogleMapPicker {...props} apiKey={provider.apiKey} />; break;
    case "mapbox":
      content = <MapboxMapPicker {...props} accessToken={provider.accessToken} />; break;
    case "maptiler":
      content = <MapTilerPicker {...props} apiKey={provider.apiKey} />; break;
    case "stadia":
      content = <StadiaMapsPicker {...props} apiKey={provider.apiKey} />; break;
    case "thunderforest":
      content = <ThunderforestPicker {...props} apiKey={provider.apiKey} />; break;
    case "jawg":
      content = <JawgMapsPicker {...props} accessToken={provider.accessToken} adminLightStyle={provider.adminLightStyle} />; break;
    case "tomtom":
      content = <TomTomPicker {...props} apiKey={provider.apiKey} />; break;
    default:
      content = <StreetMapsPicker {...props} />;
  }
  // Glass cards use transforms/filters, which contain fixed descendants.
  // Rendering at body level keeps every map provider at viewport size.
  return createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Choose map location" tabIndex={-1} className="fixed inset-0 z-[80] bg-cream">{content}</div>, document.body);
}
