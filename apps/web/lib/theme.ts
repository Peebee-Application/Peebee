"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "peebee-theme";

function computeAutoTheme(): "light" | "dark" {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "light" : "dark";
}

function computeTheme(mode: ThemeMode | null): "light" | "dark" {
  return mode === "light" || mode === "dark" ? mode : computeAutoTheme();
}

function apply(mode: ThemeMode | null) {
  document.documentElement.setAttribute("data-theme", computeTheme(mode));
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    const nextMode = stored === "light" || stored === "dark" ? stored : null;
    setModeState(nextMode);
    setTheme(computeTheme(nextMode));
  }, []);

  useEffect(() => {
    apply(mode);
    setTheme(computeTheme(mode));
    if (mode) return;
    const interval = setInterval(() => {
      apply(null);
      setTheme(computeAutoTheme());
    }, 60000);
    return () => clearInterval(interval);
  }, [mode]);

  function setMode(next: "light" | "dark") {
    setModeState(next);
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  function toggle() {
    setMode(theme === "dark" ? "light" : "dark");
  }

  return { mode: mode ?? "auto", theme, toggle };
}
