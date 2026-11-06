"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "peebee-theme";

function computeTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "auto") return mode;
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "light" : "dark";
}

function apply(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", computeTheme(mode));
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    setModeState(stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto");
  }, []);

  useEffect(() => {
    if (!mode) return;
    apply(mode);
    if (mode !== "auto") return;
    const interval = setInterval(() => apply(mode), 60_000);
    return () => clearInterval(interval);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  return { mode: mode ?? "auto", setMode };
}

/** The theme actually on screen right now ("auto" already resolved) */
export function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

