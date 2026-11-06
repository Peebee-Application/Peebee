"use client";

import { hasPermission } from "@peebee/shared";
import { ClipboardList, LayoutGrid, Package, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth-context";

type Tab = { href: string; label: string; icon: LucideIcon };

export function BottomNav({ onSettingsClick }: { onSettingsClick?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.adminRole ?? null;

  const tabs: Tab[] = [
    { href: "/", label: "Overview", icon: LayoutGrid },
    ...(hasPermission(role, "customers.view") || hasPermission(role, "riders.view")
      ? [{ href: "/people", label: "Users", icon: Users }]
      : []),
    { href: "/orders", label: "Orders", icon: Package },
    ...(hasPermission(role, "activity_log.view")
      ? [{ href: "/activity", label: "Activity", icon: ClipboardList }]
      : []),
    { href: "/settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 lg:hidden px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          {tabs.map((tab) => {
            const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            const isSettingsTab = tab.href === "/settings";

            return (
              <li key={tab.href} className="flex-1">
                {isSettingsTab && onSettingsClick ? (
                  <button
                    type="button"
                    onClick={onSettingsClick}
                    aria-current={active ? "page" : undefined}
                    className={`customer-nav-item relative flex w-full h-16 flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${
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
                  </button>
                ) : (
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
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
