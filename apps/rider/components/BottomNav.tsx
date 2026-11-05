"use client";

import { observeNotificationSnapshot } from "@peebee/shared";
import { Briefcase, MessageCircle, PiggyBank, User, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useTranslate, type TranslationKey } from "../lib/i18n";
import { useLivePolling } from "../lib/use-live-polling";

type Tab = { href: string; label: string; icon: LucideIcon };

const BASE_TABS: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { href: "/", labelKey: "nav_jobs", icon: Briefcase },
  { href: "/chat", labelKey: "nav_chat", icon: MessageCircle },
  { href: "/wallet", labelKey: "nav_wallet", icon: Wallet },
  { href: "/account", labelKey: "nav_account", icon: User },
];

const UNREAD_POLL_MS = 15000;

export function BottomNav() {
  const pathname = usePathname();
  const [hasUnread, setHasUnread] = useState(false);
  const [showSavingsTab, setShowSavingsTab] = useState(false);
  const t = useTranslate();

  const isHidden =
    pathname === "/login" ||
    pathname === "/activate" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/chat/");

  useLivePolling(
    () => {
      if (isHidden) return;
      api
        .getChatThreads()
        .then((res) => {
          observeNotificationSnapshot(
            "chat-inbox",
            res.threads.filter((t) => t.unread).map((t) => t.counterpartId + ":" + t.lastMessageAt)
          );
          setHasUnread(res.threads.some((t) => t.unread));
        })
        .catch(() => {});
    },
    UNREAD_POLL_MS,
    [isHidden],
  );

  useEffect(() => {
    if (isHidden) return;
    api
      .getSettings()
      .then(({ settings }) => setShowSavingsTab(settings.vslaFeaturePlacement === "bottom_nav_tab"))
      .catch(() => {});
  }, [isHidden]);

  if (isHidden) {
    return null;
  }

  const tabs: Tab[] = BASE_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey), icon: tab.icon }));
  if (showSavingsTab) {
    tabs.splice(3, 0, { href: "/savings", label: "RSLA", icon: PiggyBank });
  }

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
                ? pathname === "/" || pathname.startsWith("/jobs")
                : pathname.startsWith(tab.href);
            const Icon = tab.icon;

            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-[62px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${
                    active ? "is-active" : ""
                  }`}
                >
                  <span className="relative">
                    <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                    {tab.href === "/chat" && hasUnread && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
                    )}
                  </span>
                  <span className="leading-none truncate max-w-[72px]">{tab.label}</span>
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
