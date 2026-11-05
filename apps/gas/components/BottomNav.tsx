"use client";

import { Briefcase, Fuel, GraduationCap, History, Package, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { filterByModule, useModules } from "../lib/modules";

const BASE_TABS = [
  { href: "/", label: "Pump", icon: Fuel, module: "buy.gas" },
  { href: "/parcels", label: "Parcels", icon: Package, module: "deliver.relay" },
  { href: "/manager", label: "Manager", icon: Briefcase },
  { href: "/shift", label: "Shift", icon: History },
  { href: "/prices", label: "Prices", icon: Store, module: "buy.gas" },
  { href: "/practice", label: "Practice", icon: GraduationCap },
];

export function BottomNav() {
  const pathname = usePathname();
  const { isManager } = useAuth();
  const moduleOn = useModules();

  // Do not show bottom nav on login page
  if (pathname === "/login") return null;

  const tabs = filterByModule(BASE_TABS, moduleOn);

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          {tabs.map((tab) => {
            const active =
              tab.href === "/"
                ? pathname === "/" || pathname === "/dispense"
                : pathname.startsWith(tab.href);
            const Icon = tab.icon;

            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-[58px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                    active ? "is-active" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  <span className="leading-none">{tab.label}</span>
                  {active && (
                    <span
                      className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full"
                      aria-hidden
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
