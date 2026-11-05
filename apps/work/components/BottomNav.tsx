"use client";

import { Briefcase, Home, Users, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { filterByModule, useModules } from "../lib/modules";

export function BottomNav() {
  const pathname = usePathname();
  const { provider, isOwner } = useAuth();
  const moduleOn = useModules();

  const tabs = filterByModule([
    { href: "/", label: "Home", icon: Home },
    { href: "/jobs", label: "Jobs", icon: Briefcase, module: "hive.work" },
    ...(isOwner ? [{ href: "/earnings", label: "Earnings", icon: Wallet }] : []),
    ...(isOwner && provider?.kind === "company" ? [{ href: "/team", label: "Team", icon: Users }] : []),
    { href: "/account", label: "Account", icon: UserRound },
  ], moduleOn);

  return (
    <nav aria-label="Primary navigation" className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around gap-1 rounded-[24px] p-1.5">
          {tabs.map((tab) => {
            const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-[58px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95 ${active ? "is-active" : ""}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  <span className="leading-none">{tab.label}</span>
                  {active && <span className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
