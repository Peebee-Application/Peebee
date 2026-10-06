"use client";

import { LayoutGrid, MessageCircle, User, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useTranslate, type TranslationKey } from "../lib/i18n";

const tabs: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { href: "/", labelKey: "nav_home", icon: LayoutGrid },
  { href: "/menu", labelKey: "nav_menu", icon: UtensilsCrossed },
  { href: "/chat", labelKey: "nav_chat", icon: MessageCircle },
  { href: "/account", labelKey: "nav_account", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslate();

  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/95 shadow-lg backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-gold bg-gold/10 rounded-3xl" : "text-ink-500"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                <span>{t(tab.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
