"use client";

import Link from "next/link";
import { Bell, Headset, Menu, Search } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { ThemeToggle } from "./ThemeToggle";
import { useResolvedTheme } from "../lib/theme";
import { useSupportAlerts } from "./SupportAlerts";

export function BrandHeader({ onMenuClick, onSearch }: { onMenuClick?: () => void; onSearch?: () => void }) {
  const activeTheme = useResolvedTheme();
  const isDarkMode = activeTheme === "dark";
  const support = useSupportAlerts();

  return (
    <header className="customer-header sticky top-0 z-40 transition-colors">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between gap-2 px-3 lg:max-w-none lg:px-6">
        <div className="flex items-center gap-2">
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Open menu"
              className={`-ml-1 flex lg:hidden h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:opacity-60 ${
                isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
              }`}
            >
              <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          )}
          <Link
            href="/"
            aria-label="Peebee Admin Home"
            className="flex shrink-0 items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-xl"
          >
            <BrandLogo variant={isDarkMode ? "dark" : "light"} />
            <sup
              aria-hidden="true"
              className={`pt-1 text-[10px] font-black uppercase tracking-widest ${
                isDarkMode ? "text-black" : "text-gold"
              }`}
            >
              Admin
            </sup>
          </Link>
        </div>

        <div className="flex items-center gap-0.5">
          {onSearch && (
            <button
              type="button"
              onClick={onSearch}
              aria-label="Search admin"
              className={`flex h-8 w-8 items-center justify-center rounded-full transition active:opacity-60 lg:hidden ${
                isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
              }`}
            >
              <Search className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
            </button>
          )}
          {support.enabled && (
            <Link
              href="/support-chat"
              aria-label={support.waiting > 0 ? `Support chat: ${support.waiting} waiting for a person` : "Support chat"}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full transition active:opacity-60 ${
                isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
              }`}
            >
              <Headset className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
              {support.waiting > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white">
                  {support.waiting > 9 ? "9+" : support.waiting}
                </span>
              )}
            </Link>
          )}
          <Link
            href="/activity"
            aria-label="Activity notifications"
            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition active:opacity-60 ${
              isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
            }`}
          >
            <Bell className="h-4.5 w-4.5" strokeWidth={2} />
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-current" />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
