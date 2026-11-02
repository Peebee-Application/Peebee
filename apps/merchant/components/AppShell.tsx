"use client";

import { ModuleRouteGate } from "@peebee/shared/module-gate";
import { MODULE_ROUTES } from "../lib/module-routes";
import { useModules } from "../lib/modules";

import { BrandLogo } from "./BrandLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { useResolvedTheme } from "../lib/theme";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { ServiceBanner } from "./ServiceBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";
import { usePracticeModeActive } from "@peebee/shared/practice-ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  // Practice is shown by the shared blue border + tab, so the sandbox "Demo" chip is hidden while practising.
  const practiceActive = usePracticeModeActive();
  const pathname = usePathname();
  const moduleOn = useModules();
  const { merchant } = useAuth();
  const activeTheme = useResolvedTheme();
  const isDarkMode = activeTheme === "dark";
  const bare = pathname === "/forgot-password" || pathname === "/login" || pathname === "/apply" || pathname === "/activate";

  return (
    <AuthGate>
      <PracticeModeGuard role="merchant" pathname={pathname} />
      {!bare && <PracticeModePrompt role="merchant" />}
      {!bare && (
        <header className="customer-header sticky top-0 z-30 transition-colors">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Link
              href="/"
              aria-label="Go to merchant home"
              className="flex shrink-0 items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-xl"
            >
              <BrandLogo variant={isDarkMode ? "dark" : "light"} />
              <sup
                aria-hidden="true"
                className={`pt-1 text-[10px] font-black uppercase tracking-widest ${
                  isDarkMode ? "text-black" : "text-gold"
                }`}
              >
                Merchant
              </sup>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              {merchant?.display_name && (
                <p
                  className={`max-w-[180px] truncate text-xs font-semibold ${
                    isDarkMode ? "text-black/80" : "text-white/80"
                  }`}
                >
                  {merchant.display_name}
                </p>
              )}
              {merchant?.environment === "sandbox" && !practiceActive && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    isDarkMode
                      ? "bg-black/15 text-black"
                      : "bg-sky-500/20 text-sky-300"
                  }`}
                >
                  Demo
                </span>
              )}
            </div>
          </div>
        </header>
      )}
      {!bare && <PracticeModeBanner role="merchant" />}
      {!bare && <ServiceBanner />}
      <main className={`mx-auto min-h-dvh max-w-6xl ${bare ? "" : "pb-[calc(88px+env(safe-area-inset-bottom))]"}`}>
        <ModuleRouteGate rules={MODULE_ROUTES} pathname={pathname} modules={moduleOn}>{children}</ModuleRouteGate>
      </main>
      {!bare && <BottomNav />}
    </AuthGate>
  );
}
