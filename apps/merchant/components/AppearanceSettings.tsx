"use client";

import { Moon, Smartphone, Sun } from "lucide-react";
import { useThemeMode, type ThemeMode } from "../lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "auto", label: "Auto", icon: Smartphone },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

/** Light / dark / auto (follows the time of day) as three big tiles: Auto full width, then Light and Dark. */
export function AppearanceSettings() {
  const { mode, setMode } = useThemeMode();
  return (
    <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Appearance" data-testid="appearance">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = mode === option.mode;
        return (
          <button key={option.mode} type="button" role="radio" aria-checked={active} onClick={() => setMode(option.mode)} data-testid={`theme-${option.mode}`}
            className={`flex items-center justify-center gap-2.5 rounded-[22px] border-2 text-[19px] font-black text-ink transition active:scale-[.98] ${option.mode === "auto" ? "col-span-2 min-h-[76px]" : "min-h-[96px] flex-col"} ${active ? "border-gold bg-gold/12 shadow-[0_0_0_4px_rgb(var(--gold)/0.2)]" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
            <Icon className="h-[30px] w-[30px]" strokeWidth={2} aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
