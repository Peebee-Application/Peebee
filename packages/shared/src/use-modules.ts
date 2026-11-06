"use client";

import { useEffect, useState } from "react";
import { isModuleOn, noticeFor, type ModuleAvailability, type ModuleNotice, type ModuleNotices, type ModuleOfflineDisplay, type ModuleSettings, type ModuleWorld } from "./modules.js";
import { isPracticeMode } from "./practice-runtime.js";

/**
 * What to do with items whose module (if they name one) is off, as Admin chose: "hide" drops them; "inactive" keeps them,
 * flagged `offline`, for the screen to draw greyed out. Items without a module always stay, and `on` without a `display`
 * (a plain function) hides.
 */
export function filterByModule<T extends { module?: string }>(items: readonly T[], on: ((key: string) => boolean) & { display?: ModuleOfflineDisplay }): (T & { offline?: boolean })[] {
  if (on.display === "inactive") return items.map((item) => (item.module && !on(item.module) ? { ...item, offline: true } : item));
  return items.filter((item) => !item.module || on(item.module));
}

/**
 * Builds an app's `useModules` hook from its own settings call. `on("ride.car")` is false while Peebee Car, or the Ride
 * cluster above it, is switched off in Admin → Services for the world this device is in (Practice only when the person
 * switched it on). Before the first load, offline, or for an unknown module it reads as on, so a slow load never hides a tab.
 */
export type ModulesView = ((key: string) => boolean) & {
  /** Why a module is off and what to tell people: Admin's reason, message and date. */
  notice: (key: string) => ModuleNotice;
  /** What Admin chose for switched-off modules: gone ("hide") or greyed out ("inactive"). */
  display: ModuleOfflineDisplay;
};

/** How long the switches are kept before asking again. Coming back to the app after this long asks at once. */
const MODULES_CACHE_MS = 15_000;

type Loaded = { available: ModuleAvailability; notices: ModuleNotices; display: ModuleOfflineDisplay };

export function createUseModules(load: () => Promise<{ settings: { modules?: ModuleSettings } }>): () => ModulesView {
  let cached: { at: number; value: Loaded } | null = null;
  let inflight: Promise<Loaded | null> | null = null;

  const fetchAvailability = (): Promise<Loaded | null> => {
    if (cached && Date.now() - cached.at < MODULES_CACHE_MS) return Promise.resolve(cached.value);
    inflight ??= load()
      .then((res) => {
        const modules = res.settings.modules;
        if (modules?.available) cached = { at: Date.now(), value: { available: modules.available, notices: modules.notices ?? {}, display: modules.display === "inactive" ? "inactive" : "hide" } };
        return cached?.value ?? null;
      })
      .catch(() => cached?.value ?? null)
      .finally(() => { inflight = null; });
    return inflight;
  };

  return function useModules() {
    // The first client render must match SSR; apply the shared cache from the effect.
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    useEffect(() => {
      let live = true;
      const refresh = () => { void fetchAvailability().then((v) => { if (live && v) setLoaded(v); }); };
      refresh();
      // Back in the app after a while: pick up whatever Admin switched meanwhile.
      const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
      document.addEventListener("visibilitychange", onVisible);
      return () => { live = false; document.removeEventListener("visibilitychange", onVisible); };
    }, []);
    const world: ModuleWorld = isPracticeMode() ? "practice" : "live";
    return Object.assign((key: string) => isModuleOn(key, world, loaded?.available), { notice: (key: string) => noticeFor(key, loaded?.notices), display: loaded?.display ?? "hide" });
  };
}
