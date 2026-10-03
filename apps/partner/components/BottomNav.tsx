"use client";

import { CarFront, LayoutGrid, Route, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";

export function BottomNav() {
  const pathname = usePathname();
  const { mode } = useAuth();
  const tabs =
    mode === "driver"
      ? [
          { href: "/", label: "Home", icon: LayoutGrid },
          { href: "/jobs", label: "Jobs", icon: Route },
          { href: "/wallet", label: "Earnings", icon: WalletCards },
          { href: "/account", label: "Account", icon: UserRound },
        ]
      : [
          { href: "/", label: "Home", icon: LayoutGrid },
          { href: "/vehicles", label: "Vehicles", icon: CarFront },
          { href: "/wallet", label: "Earnings", icon: WalletCards },
          { href: "/account", label: "Account", icon: UserRound },
        ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-faint)] bg-[rgb(var(--surface))] pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link href={tab.href} className={`flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold ${active ? "text-gold" : "text-ink-500"}`}>
                <Icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
