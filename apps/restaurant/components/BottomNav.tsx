"use client";

import { ClipboardList, MessageCircle, User, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useTranslate, type TranslationKey } from "../lib/i18n";
import { filterByModule, useModules } from "../lib/modules";

const tabs: { href: string; labelKey: TranslationKey; icon: LucideIcon; module?: string }[] = [
  { href: "/", labelKey: "nav_orders", icon: ClipboardList, module: "buy.food" },
  { href: "/menu", labelKey: "nav_menu", icon: UtensilsCrossed, module: "buy.food" },
  { href: "/chat", labelKey: "nav_chat", icon: MessageCircle },
  { href: "/account", labelKey: "nav_account", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslate();
  const moduleOn = useModules();

  // Hide on auth pages or specific full-screen chat threads
  if (
    pathname === "/login" ||
    pathname === "/activate" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/chat/")
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          {filterByModule(tabs, moduleOn).map((tab) => {
            const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
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
                  <span className="leading-none truncate max-w-[64px]">{t(tab.labelKey)}</span>
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
