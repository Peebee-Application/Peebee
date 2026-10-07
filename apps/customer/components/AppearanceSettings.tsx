"use client";

import { Map, Moon, Smartphone, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useMapStylePref, type MapStylePref } from "../lib/mapStyle";
import { useThemeMode, type ThemeMode } from "../lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { mode: "auto", label: "Auto", hint: "Switches with the time of day", icon: Smartphone },
  { mode: "light", label: "Light", hint: "Always light", icon: Sun },
  { mode: "dark", label: "Dark", hint: "Always dark", icon: Moon },
];

const MAP_STYLE_OPTIONS: { pref: MapStylePref; label: string }[] = [
  { pref: "auto", label: "Auto" },
  { pref: "normal", label: "Normal" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

/** Map style choice — only shown while Jawg is the active maps provider,
 * the one provider with separately designed styles to pick between. */
function MapStyleSetting() {
  const { pref, setPref } = useMapStylePref();
  const [jawgActive, setJawgActive] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setJawgActive(res.settings.mapsActiveProvider === "jawg"))
      .catch(() => {});
  }, []);

  if (!jawgActive) return null;
  return (
    <div className="space-y-2 border-t border-[var(--border-faint)] pt-2.5">
      <div className="flex items-center gap-1.5">
        <Map className="h-4 w-4 text-ink-500" strokeWidth={1.75} aria-hidden />
        <h3 className="text-xs font-semibold text-ink">Map style</h3>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {MAP_STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.pref}
            type="button"
            onClick={() => setPref(opt.pref)}
            className={`rounded-xl border px-2 py-2 text-xs font-bold text-ink ${
              pref === opt.pref ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-500">Auto follows the app theme: a bright map by day, a dark one at night.</p>
    </div>
  );
}

export function AppearanceSettings() {
  const { mode, setMode } = useThemeMode();

  return (
    <section className="home-card space-y-2.5">
      <h2 className="text-sm font-semibold text-ink">Appearance</h2>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(opt.mode)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center ${
                active ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-gold" : "text-ink-500"}`} strokeWidth={1.75} aria-hidden />
              <span className="text-xs font-bold text-ink">{opt.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">{OPTIONS.find((o) => o.mode === mode)?.hint}</p>
      <MapStyleSetting />
    </section>
  );
}
