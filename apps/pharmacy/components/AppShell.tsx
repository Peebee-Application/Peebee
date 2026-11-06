"use client";

import { ModuleRouteGate } from "@peebee/shared/module-gate";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MODULE_ROUTES } from "../lib/module-routes";
import { useModules } from "../lib/modules";
import { useAuth } from "../lib/auth-context";
import { useResolvedTheme } from "../lib/theme";
import { BottomNav } from "./BottomNav";
import { BrandLogo } from "./BrandLogo";

export function AppShell({ children }: { children: any }) {
  const { pharmacy, pharmacist, toggleOpen, ready } = useAuth();
  const pathname = usePathname();
  const moduleOn = useModules();
  const router = useRouter();
  const activeTheme = useResolvedTheme();
  const isDarkMode = activeTheme === "dark";
  const isPublicPage = pathname === "/login" || pathname === "/activate";

  // Nobody sees the console without a verified pharmacy session.
  useEffect(() => {
    if (ready && !pharmacist && !isPublicPage) router.replace("/login");
  }, [ready, pharmacist, isPublicPage, router]);

  if (isPublicPage) return <main className="mx-auto max-w-lg px-4 pt-4">{children}</main>;
  if (!ready || !pharmacist) return null;

  const open = !!pharmacy?.isOpen;

  return (
    <div className="min-h-dvh bg-cream text-ink">
      <header className="customer-header sticky top-0 z-30 transition-colors">
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between gap-3 px-4">
          <Link
            href="/"
            aria-label="Go to Peebee Pharmacy home"
            className="flex shrink-0 items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-xl"
          >
            <BrandLogo variant={isDarkMode ? "dark" : "light"} />
            <sup aria-hidden="true" className={`pt-1 text-[10px] font-black uppercase tracking-widest ${isDarkMode ? "text-black" : "text-gold"}`}>
              Pharmacy
            </sup>
          </Link>
          <div
            role="tablist"
            aria-label="Pharmacy open or closed"
            className={`flex items-center gap-1 rounded-full p-1 border transition ${isDarkMode ? "bg-black/10 border-black/15" : "bg-white/10 border-white/15"}`}
          >
            {([true, false] as const).map((value) => {
              const isSelected = open === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => { if (!isSelected) toggleOpen(); }}
                  className={`min-h-8 rounded-full px-3.5 text-xs font-bold transition ${
                    isSelected
                      ? isDarkMode
                        ? "bg-black text-white shadow-sm"
                        : "bg-gold text-ink-gold shadow-sm"
                      : isDarkMode
                        ? "text-black/70 hover:text-black"
                        : "text-white/70 hover:text-white"
                  }`}
                >
                  {value ? "Open" : "Closed"}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-4 customer-nav-content-clearance">
        <ModuleRouteGate rules={MODULE_ROUTES} pathname={pathname} modules={moduleOn}>{children}</ModuleRouteGate>
      </main>

      <BottomNav />
    </div>
  );
}
