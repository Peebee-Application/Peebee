"use client";

import { MoreHorizontal, Briefcase, Building2, CreditCard, LayoutGrid, Store, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { filterByModule, useModules } from "../lib/modules";

const tabs = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/store", label: "Products", icon: Store, module: "buy.marketplace" },
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/wallet", label: "Wallet", icon: WalletCards },
  { href: "/outlets", label: "Outlets", icon: Building2 },
  { href: "/account", label: "Account", icon: UserRound },
];

export function BottomNav() {
  const pathname = usePathname();
  const { merchant } = useAuth();
  const moduleOn = useModules();

  if (pathname === "/login" || pathname === "/apply" || pathname === "/activate") return null;

  const visibleTabs =
    filterByModule(merchant?.member_role === "cashier" ? tabs.filter((tab) => tab.href !== "/wallet") : tabs, moduleOn);

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          {visibleTabs.map((tab, index) => {
            const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            const Icon = tab.icon;

            return (
              <li key={tab.href} className={`min-w-0 flex-1 ${index >= 4 ? "hidden sm:block" : ""}`}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-[58px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                    active ? "is-active" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  <span className="leading-none truncate max-w-[58px]">{tab.label}</span>
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
          <li className="min-w-0 flex-1 sm:hidden">
            <details className="relative">
              <summary className="customer-nav-item flex h-[58px] cursor-pointer list-none flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-bold" aria-label="More merchant pages">
                <MoreHorizontal className="h-5 w-5" aria-hidden /><span>More</span>
              </summary>
              <ul className="absolute bottom-full right-0 mb-3 min-w-44 space-y-1 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-2 shadow-xl">
                {visibleTabs.slice(4).map(tab => <li key={tab.href}><Link href={tab.href} aria-current={pathname.startsWith(tab.href) ? "page" : undefined} className="block min-h-11 rounded-xl px-4 py-3 text-sm font-bold text-ink" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{tab.label}</Link></li>)}
              </ul>
            </details>
          </li>
        </ul>
      </div>
    </nav>
  );
}
