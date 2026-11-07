"use client";

import { Moon, Smartphone, Sun } from "lucide-react";
import { useThemeMode, type ThemeMode } from "../lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { mode: "auto", label: "Auto", hint: "Switches with the time of day", icon: Smartphone },
  { mode: "light", label: "Light", hint: "Always light", icon: Sun },
  { mode: "dark", label: "Dark", hint: "Always dark", icon: Moon },
];

export function AppearanceSettings() {
  const { mode, setMode } = useThemeMode();

  return (
    <section className="home-card space-y-2.5">
      <h2 className="text-sm font-semibold text-ink">Appearance</h2>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => setMode(option.mode)}
              aria-pressed={active}
              className="select-card items-center gap-1.5 text-center"
            >
              <Icon className="select-card__icon h-5 w-5 text-ink-500" strokeWidth={1.75} aria-hidden />
              <span className="select-card__title text-xs text-ink">{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">{OPTIONS.find((option) => option.mode === mode)?.hint}</p>
    </section>
  );
}
