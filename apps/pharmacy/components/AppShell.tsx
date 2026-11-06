"use client";

import { ModuleRouteGate } from "@peebee/shared/module-gate";
import { MODULE_ROUTES } from "../lib/module-routes";
import { useModules } from "../lib/modules";

import {
  Bell,
  CheckCircle2,
  Lock,
  Power,
  ShieldCheck,
  Store,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../lib/auth-context";
import { PharmacyNav } from "./PharmacyNav";

export function AppShell({ children }: { children: any }) {
  const { pharmacy, pharmacist, toggleOpen, ready } = useAuth();
  const pathname = usePathname();
  const moduleOn = useModules();
  const router = useRouter();
  const isPublicPage = pathname === "/login" || pathname === "/activate";

  // Nobody sees the console without a verified pharmacy session.
  useEffect(() => {
    if (ready && !pharmacist && !isPublicPage) router.replace("/login");
  }, [ready, pharmacist, isPublicPage, router]);

  if (isPublicPage) return <main className="mx-auto max-w-lg px-4 pt-4">{children}</main>;
  if (!ready || !pharmacist) return null;

  return (
    <div className="min-h-screen bg-[rgb(var(--color-cream))] text-ink pb-24">
      {/* Top Pharmacy Status Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/95 backdrop-blur-md px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wider text-gold">
              <ShieldCheck className="h-3.5 w-3.5 text-gold" />
              <span>{pharmacy?.ndaLicenseNumber}</span>
            </div>
            <h1 className="truncate text-lg font-black text-ink">
              {pharmacy?.name}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleOpen}
              className={`flex min-h-12 items-center gap-2 rounded-full px-4 text-base font-black transition active:scale-95 ${
                pharmacy?.isOpen
                  ? "bg-green-600/15 text-green-600 hover:bg-green-600/20"
                  : "bg-red-500/15 text-red-500 hover:bg-red-500/20"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  pharmacy?.isOpen ? "bg-green-600 animate-pulse" : "bg-red-500"
                }`}
              />
              <span>{pharmacy?.isOpen ? "Open" : "Closed"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-lg px-4 pt-4"><ModuleRouteGate rules={MODULE_ROUTES} pathname={pathname} modules={moduleOn}>{children}</ModuleRouteGate></main>

      {/* Persistent Bottom Nav */}
      <PharmacyNav />
    </div>
  );
}
