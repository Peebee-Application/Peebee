"use client";

import { Loader2, LocateFixed, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadScript } from "../../lib/load-script";
import type { MapPickerProps } from "./map-types";

const UGANDA = { lat: 1.3733, lng: 32.2903 };

// Minimal shape of the bits of the Google Maps JS API this component
// touches — avoids pulling in @types/google.maps just for a handful of
// calls. Real `google.maps.*` objects satisfy this structurally at runtime.
type GoogleNamespace = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
    Marker: new (opts: Record<string, unknown>) => GoogleMarker;
    Geocoder: new () => { geocode: (req: Record<string, unknown>, cb: (results: GeocoderResult[] | null, status: string) => void) => void };
    places: {
      Autocomplete: new (input: HTMLInputElement, opts: Record<string, unknown>) => {
        addListener: (event: string, handler: () => void) => void;
        getPlace: () => { geometry?: { location?: { lat: () => number; lng: () => number } }; formatted_address?: string };
      };
    };
  };
};
type GoogleMap = { setCenter: (pos: { lat: number; lng: number }) => void; setZoom: (zoom: number) => void; addListener: (event: string, handler: (e: { latLng: { lat: () => number; lng: () => number } }) => void) => void };
type GoogleMarker = { setPosition: (pos: { lat: number; lng: number }) => void; setMap: (map: GoogleMap | null) => void };
type GeocoderResult = { address_components: { types: string[]; long_name: string }[]; formatted_address: string };

// Window.google is already declared elsewhere (Google Sign-In) with a
// narrower shape, so read it via a local cast instead of redeclaring the
// global — avoids a conflicting-declaration error between the two.
function getGoogleMaps(): GoogleNamespace | undefined {
  return (window as unknown as { google?: GoogleNamespace }).google;
}

function pickArea(components: GeocoderResult["address_components"]): string | null {
  const byType = (type: string) => components.find((c) => c.types.includes(type))?.long_name;
  return byType("sublocality") || byType("neighborhood") || byType("locality") || byType("administrative_area_level_2") || null;
}

/** Google Maps JS API + Places Autocomplete + Geocoder — mounted only once
 * an admin has saved a working API key and switched to this provider (see
 * ../LocationMapPicker.tsx). Same visual shell and confirm/cancel contract
 * as StreetMapsPicker, so switching providers is invisible to the rest of
 * the app. */
export function GoogleMapPicker({ initial, onConfirm, onCancel, apiKey }: MapPickerProps & { apiKey: string }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadScript(
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`,
      "tuma-google-maps",
    )
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    const google = getGoogleMaps();
    if (!ready || !mapDivRef.current || !google) return;
    let cancelled = false;
    const start = initial ?? UGANDA;
    const map = new google.maps.Map(mapDivRef.current, {
      center: start,
      zoom: initial ? 14 : 7,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
    });
    mapRef.current = map;

    if (initial) {
      markerRef.current = new google.maps.Marker({ position: initial, map });
    } else if (navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const nearby = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentPosition(nearby);
          map.setCenter(nearby);
          map.setZoom(14);
          setLocating(false);
        },
        () => {
          if (!cancelled) setLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    }

    map.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      placeMarker(lat, lng);
    });

    if (inputRef.current) {
      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "ug" },
        fields: ["geometry", "formatted_address"],
      });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        const loc = place.geometry?.location;
        if (!loc) return;
        const lat = loc.lat();
        const lng = loc.lng();
        map.setCenter({ lat, lng });
        placeMarker(lat, lng);
      });
    }

    function placeMarker(lat: number, lng: number) {
      setMarker({ lat, lng });
      if (markerRef.current) {
        markerRef.current.setPosition({ lat, lng });
      } else if (google) {
        markerRef.current = new google.maps.Marker({ position: { lat, lng }, map });
      }
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function useMyLocation() {
    setLocationError(false);
    const select = (next: { lat: number; lng: number }) => {
      mapRef.current?.setCenter(next);
      mapRef.current?.setZoom(16);
      setMarker(next);
      const google = getGoogleMaps();
      if (markerRef.current) {
        markerRef.current.setPosition(next);
      } else if (google && mapRef.current) {
        markerRef.current = new google.maps.Marker({ position: next, map: mapRef.current });
      }
      setLocating(false);
    };
    if (currentPosition) {
      select(currentPosition);
      return;
    }
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentPosition(next);
        select(next);
      },
      () => { setLocating(false); setLocationError(true); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function confirm() {
    const google = getGoogleMaps();
    if (!marker || !google) return;
    setResolving(true);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: marker }, (results: GeocoderResult[] | null, status: string) => {
      setResolving(false);
      const first = status === "OK" && results ? results[0] : null;
      onConfirm({
        lat: marker.lat,
        lng: marker.lng,
        area: first ? pickArea(first.address_components) : null,
        address: first?.formatted_address ?? null,
      });
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-cream">
      <div className="relative z-20 shrink-0 border-b border-[var(--border-faint)] bg-cream p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" strokeWidth={2} />
          <input
            ref={inputRef}
            placeholder="Search a place in Uganda…"
            className="min-h-12 w-full rounded-full border border-[var(--border-faint)] py-3 pl-10 pr-4 text-base outline-none focus:border-gold"
          />
        </div>
      </div>

      <div className="relative flex-1">
        {!ready && !loadError && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gold" strokeWidth={2.5} aria-hidden />
          </div>
        )}
        {loadError && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-700">
            Couldn&apos;t load Google Maps. Check the connection and try again.
          </div>
        )}
        <div ref={mapDivRef} className="h-full w-full" />

        {ready && !marker && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full bg-ink/80 px-4 py-2 text-sm font-semibold text-cream">
              Tap the map to drop a pin
            </span>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-[var(--border-faint)] bg-cream p-4">
        <button onClick={useMyLocation} disabled={locating} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-gold text-base font-bold text-ink disabled:opacity-60">
          {locating ? <Loader2 className="h-5 w-5 animate-spin text-gold" aria-hidden /> : <LocateFixed className="h-5 w-5 text-gold" strokeWidth={2.25} aria-hidden />}
          {locating ? "Finding your location…" : "Select my current location"}
        </button>
        {locationError && <p role="alert" className="text-center text-sm text-red-700">We couldn&apos;t get your location. Search or tap the map instead.</p>}
        <div className="flex gap-3">
          <button onClick={onCancel} className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] text-base font-bold text-ink">Cancel</button>
          <button onClick={confirm} disabled={!marker || resolving} className="flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-full bg-gold text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-50">
            {resolving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {resolving ? "Finding address…" : "Use selected location"}
          </button>
        </div>
      </div>
    </div>
  );
}
