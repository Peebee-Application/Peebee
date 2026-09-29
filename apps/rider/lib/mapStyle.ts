"use client";

import type { JawgLightStyle } from "@tuma/shared";
import { useEffect, useState } from "react";
import { useResolvedTheme } from "./theme";

/** A user's own map style override (Appearance settings). "auto" follows
 * the app theme: the admin's light-mode style by day, Jawg Dark by night.
 * Only used while Jawg is the active maps provider — it's the only one
 * that ships separately designed light and dark styles. */
export type MapStylePref = "auto" | "normal" | "light" | "dark";
export type JawgStyle = "normal" | "light" | "dark";

const STORAGE_KEY = "tuma-map-style";
const CHANGE_EVENT = "tuma-map-style-change";

const JAWG_STYLE_IDS: Record<JawgStyle, string> = {
  normal: "jawg-sunny",
  light: "jawg-light",
  dark: "jawg-dark",
};

export function jawgTileUrl(style: JawgStyle, accessToken: string): string {
  return `https://tile.jawg.io/${JAWG_STYLE_IDS[style]}/{z}/{x}/{y}{r}.png?access-token=${encodeURIComponent(accessToken)}`;
}

function readPref(): MapStylePref {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {}
  return stored === "normal" || stored === "light" || stored === "dark" ? stored : "auto";
}

/** Reads/writes the user's map style override, and keeps every mounted
 * map in step when it changes. */
export function useMapStylePref() {
  const [pref, setPrefState] = useState<MapStylePref>("auto");

  useEffect(() => {
    setPrefState(readPref());
    const onChange = () => setPrefState(readPref());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  function setPref(next: MapStylePref) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setPrefState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return { pref, setPref };
}

/** The Jawg style to show right now: the user's override if they set
 * one, otherwise the admin's light-mode style or Jawg Dark by theme. */
export function useJawgStyle(adminLightStyle: JawgLightStyle): JawgStyle {
  const theme = useResolvedTheme();
  const { pref } = useMapStylePref();
  if (pref !== "auto") return pref;
  return theme === "dark" ? "dark" : adminLightStyle;
}
