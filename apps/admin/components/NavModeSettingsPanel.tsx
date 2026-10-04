"use client";

import type { NavMode } from "@peebee/shared";
import { Navigation } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

const NAV_MODE_LABELS: Record<NavMode, string> = {
  external: "Open in Google Maps",
  in_app: "In-app navigation",
};

const NAV_MODE_DESCRIPTIONS: Record<NavMode, string> = {
  external: "Riders leave the app — the native or web Google Maps app opens with turn-by-turn directions.",
  in_app: "Riders stay in the app the whole trip — live position, route line, and distance/ETA render on whichever maps provider is active above.",
};

/** Whether the rider app's "Start Navigation" button sends riders out to
 * Google Maps or keeps them in-app — see apps/rider/components/
 * DeliveryNavigation.tsx and InAppNavigation.tsx. Independent of which
 * maps provider (Streetmaps/Google/Mapbox/etc) is active; in-app
 * navigation works with any of them. */
export function NavModeSettingsPanel() {
  const [navMode, setNavMode] = useState<NavMode | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setNavMode(res.settings.navMode))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function switchTo(mode: NavMode) {
    setSwitching(true);
    setError(null);
    try {
      const res = await api.adminSetNavMode(mode);
      setNavMode(res.navMode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  if (navMode === null) {
    return error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null;
  }

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Navigation className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-ink">Rider navigation</h2>
      </div>
      <p className="text-xs text-ink-500">
        Where the rider app&apos;s &quot;Start Navigation&quot; button sends riders when heading to a pickup or drop-off.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="space-y-2.5">
        {(["external", "in_app"] as const).map((mode) => {
          const isActive = navMode === mode;
          return (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${
                isActive ? "border-gold bg-gold/5" : "border-[var(--border-faint)]"
              }`}
            >
              <input
                type="radio"
                name="navMode"
                checked={isActive}
                disabled={switching}
                onChange={() => switchTo(mode)}
                className="mt-0.5 h-4 w-4 accent-gold"
              />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-ink">{NAV_MODE_LABELS[mode]}</span>
                <span className="mt-0.5 block text-xs text-ink-500">{NAV_MODE_DESCRIPTIONS[mode]}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
