"use client";

import { FileText, LayoutGrid, Pill, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { filterByModule, useModules } from "../lib/modules";

const ALL_TABS: { href: string; label: string; icon: typeof LayoutGrid; module?: string }[] = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/prescriptions", label: "Rx", icon: FileText, module: "buy.pharmacy" },
  { href: "/inventory", label: "Medicines", icon: Pill, module: "buy.pharmacy" },
  { href: "/license", label: "Licence", icon: ShieldCheck },
  { href: "/wallet", label: "Wallet", icon: WalletCards },
];

export function BottomNav() {
  const pathname = usePathname();
  const moduleOn = useModules();

  if (pathname === "/login" || pathname === "/activate") return null;

  const tabs = filterByModule(ALL_TABS, moduleOn);

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          {tabs.map((tab) => {
            const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            const Icon = tab.icon;

            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-16 flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${
                    active ? "is-active" : ""
                  }`}
                >
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  <span className="leading-none truncate max-w-[64px]">{tab.label}</span>
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
