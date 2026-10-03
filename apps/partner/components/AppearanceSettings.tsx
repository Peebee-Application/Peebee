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
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center ${
                active ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-gold" : "text-ink-500"}`} strokeWidth={1.75} aria-hidden />
              <span className="text-xs font-bold text-ink">{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">{OPTIONS.find((option) => option.mode === mode)?.hint}</p>
    </section>
  );
}
