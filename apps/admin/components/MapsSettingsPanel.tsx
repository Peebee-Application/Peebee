"use client";

import type { MapsCredentialFieldStatus, MapsProviderIdentity, MapsAdminSettings } from "@tuma/shared";
import { Map } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

const PROVIDER_LABELS: Record<MapsProviderIdentity, string> = {
  streetmaps: "Streetmaps (OpenStreetMap)",
  google: "Google Maps",
  mapbox: "Mapbox",
  maptiler: "MapTiler",
  stadia: "Stadia Maps",
  thunderforest: "Thunderforest",
  jawg: "Jawg Maps",
  tomtom: "TomTom",
};

const PROVIDER_DESCRIPTIONS: Record<MapsProviderIdentity, string> = {
  streetmaps: "Free, no API key needed — plain OpenStreetMap tiles and Nominatim geocoding. Safe default.",
  google: "Google Maps JavaScript API, Places search, and Geocoding — fully wired, just needs an API key.",
  mapbox: "Mapbox GL JS and its Geocoding API — fully wired, just needs an access token.",
  maptiler: "OpenStreetMap data with MapTiler's custom tile styling — fully wired, just needs an API key.",
  stadia: "OpenStreetMap data with Stadia's custom tile styling — fully wired, just needs an API key.",
  thunderforest: "OpenStreetMap data with Thunderforest's custom tile styling — fully wired, just needs an API key.",
  jawg: "OpenStreetMap data with Jawg's custom tile styling — fully wired, just needs an access token.",
  tomtom: "TomTom's own map tiles (search still uses free OpenStreetMap geocoding) — fully wired, just needs an API key.",
};

const MAPS_PROVIDER_ORDER: MapsProviderIdentity[] = ["streetmaps", "google", "mapbox", "maptiler", "stadia", "thunderforest", "jawg", "tomtom"];

function MapsCredentialFieldsForm({
  provider,
  displayName,
  fields,
  onSaved,
}: {
  provider: Exclude<MapsProviderIdentity, "streetmaps">;
  displayName: string;
  fields: MapsCredentialFieldStatus[];
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const nonBlank = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim().length > 0));
      await api.adminSaveMapsCredentials(provider, nonBlank);
      setValues({});
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear(field: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminClearMapsCredential(provider, field);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2.5 border-t border-[var(--border-faint)] pt-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-gold">
        {open ? "Hide" : "Set"} {displayName} credentials
      </button>
      {open && (
        <div className="mt-2 space-y-2.5">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-ink-500" htmlFor={`${provider}-${field.key}`}>
                  {field.label}
                  {field.required && <span className="text-gold"> *</span>}
                </label>
                {field.set && (
                  <button
                    type="button"
                    onClick={() => onClear(field.key)}
                    disabled={busy}
                    className="text-[11px] font-semibold text-ink-500 underline disabled:opacity-60"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                id={`${provider}-${field.key}`}
                type={field.secret ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.set ? "•••••••• (already set — leave blank to keep)" : field.placeholder}
                autoComplete="off"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
              {field.helpText && <p className="text-xs text-ink-500">{field.helpText}</p>}
            </div>
          ))}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {saved && <p className="text-xs font-medium text-green">Saved.</p>}
          <button
            type="button"
            onClick={onSave}
            disabled={busy || Object.values(values).every((v) => !v.trim())}
            className="min-h-9 w-full rounded-full border border-gold px-4 text-xs font-bold text-gold disabled:opacity-60"
          >
            {busy ? "Saving…" : `Save ${displayName} credentials`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Which map backend location pickers/geocoding across the customer,
 * rider, and restaurant apps actually use — see apps/api/src/maps/.
 * Switching to Google or Mapbox is blocked until that provider's API key
 * is saved and working; every app falls back to Streetmaps on its own if
 * the key ever stops working, so this can never leave the app with no
 * usable map. */
export function MapsSettingsPanel() {
  const [settings, setSettings] = useState<MapsAdminSettings | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .adminGetMapsSettings()
      .then(setSettings)
      .catch((err) => setError(errorMessage(err)));
  };

  useEffect(load, []);

  async function switchTo(provider: MapsProviderIdentity) {
    setSwitching(true);
    setError(null);
    try {
      await api.adminSetMapsProvider(provider);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  if (!settings) {
    return error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null;
  }

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Map className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-ink">Maps &amp; navigation</h2>
      </div>
      <p className="text-xs text-ink-500">
        Location pickers and geocoding across every app use this backend. Switch any time as API keys become
        available — Streetmaps needs nothing and is always available as a fallback.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="space-y-2.5">
        {MAPS_PROVIDER_ORDER.map((provider) => {
          const isActive = settings.activeProvider === provider;
          const info = provider === "streetmaps" ? null : settings.providers[provider];
          return (
            <div key={provider} className={`rounded-xl border p-3 ${isActive ? "border-gold bg-gold/5" : "border-[var(--border-faint)]"}`}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="mapsProvider"
                  checked={isActive}
                  disabled={switching || (!!info && !info.configured)}
                  onChange={() => switchTo(provider)}
                  className="mt-0.5 h-4 w-4 accent-gold"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{PROVIDER_LABELS[provider]}</span>
                    {info && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          info.configured ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                        }`}
                      >
                        {info.configured ? "Configured" : "Not configured"}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500">{PROVIDER_DESCRIPTIONS[provider]}</span>
                </span>
              </label>
              {info && info.fields.length > 0 && (
                <MapsCredentialFieldsForm
                  provider={provider as Exclude<MapsProviderIdentity, "streetmaps">}
                  displayName={PROVIDER_LABELS[provider]}
                  fields={info.fields}
                  onSaved={load}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
