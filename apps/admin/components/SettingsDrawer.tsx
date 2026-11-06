"use client";

import { ADMIN_ROLE_LABELS } from "@peebee/shared";

import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  LogOut,
  Moon,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useThemeMode } from "../lib/theme";
import { visibleGroups } from "../lib/admin-nav";

export interface SettingsItem {
  href?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value?: string | React.ReactNode;
  isExternal?: boolean;
  show?: boolean;
  onClick?: () => void;
}

export function SettingsDrawer({
  open,
  onClose,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  onSearch?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      aria-hidden={!open}
      className={`fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[rgb(var(--color-cream))] text-ink transition-transform duration-300 ease-out lg:hidden ${
        open ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-faint)] bg-[rgb(var(--color-cream))]/95 px-4 backdrop-blur-md">
        <button type="button" onClick={onClose} aria-label="Close menu" className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-ink transition active:opacity-60">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="select-none font-serif text-xl font-bold lowercase tracking-tight text-ink">peebee</span>
        <span className="h-9 w-9" aria-hidden />
      </header>
      <div className="mx-auto w-full max-w-lg px-4 pb-20 pt-3">
        {open && <SettingsListContent onItemClick={onClose} onSearch={onSearch} />}
      </div>
    </div>
  );
}

/**
 * The full admin menu, grouped the same way as the desktop sidebar.
 * Used in the mobile menu drawer and on /settings.
 */
export function SettingsListContent({ onItemClick, onSearch }: { onItemClick?: () => void; onSearch?: () => void }) {
  const { user, logout } = useAuth();
  const role = user?.adminRole ?? null;
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();

  const [platformMode, setPlatformMode] = useState<string | null>(null);
  const [activeServicesCount, setActiveServicesCount] = useState<number | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string>("");

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setPlatformMode(settings.platformEnvironment ?? "live");
        setActiveServicesCount(Object.values(settings.services ?? {}).filter(Boolean).length);
      })
      .catch(() => {});
  }, []);

  function handleThemeCycle() {
    setThemeMode(themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto");
  }

  async function handleClearCache() {
    setCacheStatus("Clearing…");
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } finally {
      setCacheStatus("Cleared");
    }
  }

  const themeLabel = themeMode === "auto" ? "Follow system" : themeMode === "dark" ? "Dark" : "Light";
  const groups = visibleGroups(role);

  const preferences: SettingsItem[] = [
    { icon: Moon, label: "Appearance", value: themeLabel, onClick: handleThemeCycle },
    { icon: Trash2, label: "Clear app cache", value: cacheStatus || undefined, onClick: handleClearCache },
    { href: "https://preview.peebee.online", icon: Sparkles, label: "Preview hub", isExternal: true },
    { href: "https://github.com/Peebee-Application/Peebee", icon: HelpCircle, label: "Help & documentation", isExternal: true },
  ];

  return (
    <div className="space-y-5">
      <Link href="/account" onClick={onItemClick} className="admin-card flex items-center gap-3.5 p-3.5 transition active:opacity-75">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-lg font-black text-gold">
          {(user?.name ?? "A").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-bold leading-tight text-ink">{user?.name ?? "Admin"}</h2>
          <p className="mt-0.5 text-xs font-medium text-ink-500">{role ? (ADMIN_ROLE_LABELS[role] ?? "Admin") : "Admin"}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/50" strokeWidth={1.8} />
      </Link>

      <div className="admin-card space-y-3.5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">Platform</p>
            <h3 className="font-serif text-2xl font-black tracking-tight text-ink">{platformMode === null ? "…" : platformMode === "live" ? "Live" : "Sandbox"}</h3>
          </div>
          <Link href="/settings/platform" onClick={onItemClick} className="rounded-full bg-ink px-5 py-2.5 text-base font-bold text-cream transition hover:opacity-90 active:scale-95">
            Manage
          </Link>
        </div>
        <Link href="/settings/services" onClick={onItemClick} className="flex items-center justify-between border-t border-[var(--border-faint)] pt-3 transition active:opacity-75">
          <span className="flex items-center gap-2.5 text-base font-bold text-ink"><Sparkles className="h-5 w-5 text-gold" strokeWidth={2} /> Active services</span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink-500">
            {activeServicesCount !== null ? `${activeServicesCount} on` : "…"}
            <ChevronRight className="h-4 w-4 text-ink-500/50" strokeWidth={1.8} />
          </span>
        </Link>
      </div>

      {onSearch && (
        <button type="button" onClick={onSearch} className="admin-search-btn flex h-14 w-full items-center gap-2.5 rounded-2xl px-4 text-base text-ink-500">
          <Search className="h-4 w-4" aria-hidden /> Search pages and settings…
        </button>
      )}

      <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label} className="space-y-1.5">
          <h3 className="admin-nav-group px-1">{g.label}</h3>
          <SettingsCardSection items={g.items.map((i) => ({ href: i.href, icon: i.icon, label: i.label, value: i.hint }))} onItemClick={onItemClick} />
        </section>
      ))}

      <section aria-label="Preferences" className="space-y-1.5">
        <h3 className="admin-nav-group px-1">Preferences</h3>
        <SettingsCardSection items={preferences} onItemClick={onItemClick} />
      </section>
      </div>

      <button
        type="button"
        onClick={() => {
          onItemClick?.();
          logout();
        }}
        className="admin-card flex w-full items-center gap-3.5 px-4 py-3.5 text-sm font-semibold text-ink transition active:opacity-75"
      >
        <LogOut className="h-5 w-5 shrink-0 text-ink/80" strokeWidth={1.8} />
        <span>Log out</span>
      </button>
      <p className="text-center text-[11px] text-ink-500">Peebee Admin · v26.18.0</p>
    </div>
  );
}

function SettingsCardSection({
  items,
  onItemClick,
}: {
  items: SettingsItem[];
  onItemClick?: () => void;
}) {
  const visible = items.filter((i) => i.show !== false);
  if (visible.length === 0) return null;

  return (
    <div className="admin-card divide-y divide-[var(--border-faint)] overflow-hidden !p-0">
      {visible.map((item, idx) => {
        const Icon = item.icon;
        const content = (
          <>
            <div className="flex items-center gap-3 min-w-0">
              <Icon className="h-6 w-6 text-gold shrink-0" strokeWidth={1.8} />
              <span className="text-base font-bold text-ink truncate">{item.label}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {item.value && (
                <span className="hidden max-w-[45vw] truncate text-sm font-medium text-ink-500 sm:inline">{item.value}</span>
              )}
              {item.isExternal ? (
                <ArrowUpRight className="h-4 w-4 text-ink-500/60" strokeWidth={1.8} />
              ) : (
                <ChevronRight className="h-4 w-4 text-ink-500/50" strokeWidth={1.8} />
              )}
            </div>
          </>
        );

        if (item.href) {
          if (item.isExternal) {
            return (
              <a
                key={item.label + idx}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                onClick={onItemClick}
                className="flex items-center justify-between min-h-14 px-4 py-3.5 transition active:bg-black/5 dark:active:bg-white/5"
              >
                {content}
              </a>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onItemClick}
              className="flex items-center justify-between min-h-14 px-4 py-3.5 transition active:bg-black/5 dark:active:bg-white/5"
            >
              {content}
            </Link>
          );
        }

        return (
          <button
            key={item.label + idx}
            type="button"
            onClick={() => {
              item.onClick?.();
            }}
            className="flex w-full items-center justify-between min-h-14 px-4 py-3.5 text-left transition active:bg-black/5 dark:active:bg-white/5"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
