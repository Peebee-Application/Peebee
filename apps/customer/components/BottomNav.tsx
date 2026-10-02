"use client";

import type { OrderRow } from "@tuma/shared";
import { ChevronRight, Home, MessageCircle, ShoppingBag, ShoppingCart, User, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTranslate, type TranslationKey } from "../lib/i18n";
import { orderTitle, stageLabel } from "../lib/order-display";
import { useLivePolling } from "../lib/use-live-polling";
import { BottomDrawer } from "./BottomDrawer";

const tabs: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { href: "/", labelKey: "nav_home", icon: Home },
  { href: "/restaurants", labelKey: "nav_food", icon: UtensilsCrossed },
  { href: "/orders", labelKey: "nav_orders", icon: ShoppingCart },
  { href: "/chat", labelKey: "nav_chat", icon: MessageCircle },
  { href: "/account", labelKey: "nav_account", icon: User },
];

const UNREAD_POLL_MS = 15000;
const ACTIVE_ORDER_POLL_MS = 10000;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [hasUnread, setHasUnread] = useState(false);
  const [activeOrder, setActiveOrder] = useState<OrderRow | null>(null);
  const [trackerDrawerOpen, setTrackerDrawerOpen] = useState(false);
  const t = useTranslate();

  useLivePolling(
    () => {
      if (!user) return;
      api
        .getChatThreads()
        .then((res) => setHasUnread(res.threads.some((t) => t.unread)))
        .catch(() => {});
    },
    UNREAD_POLL_MS,
    [user],
  );

  useLivePolling(
    () => {
      if (!user) return;
      api
        .getActiveOrder()
        .then((res) => setActiveOrder(res.activeOrder))
        .catch(() => setActiveOrder(null));
    },
    ACTIVE_ORDER_POLL_MS,
    [user],
  );

  // Skip the floating badge where it would repeat what's already on screen:
  // the active order's own tracking page, and Home (which has the Active
  // order card — the chip just sat on top of it while scrolling).
  const isOnActiveOrderPage = activeOrder ? pathname === `/orders/${activeOrder.id}` : false;
  const showActiveDeliveryBadge = !!activeOrder && !isOnActiveOrderPage && pathname !== "/";

  return (
    <>
      <nav className="fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md flex-col items-center gap-2">
          {/* Active Delivery Floating Capsule Chip */}
          {showActiveDeliveryBadge && (
            <button
              type="button"
              onClick={() => setTrackerDrawerOpen(true)}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-[rgb(var(--surface-card))] border border-gold/30 px-3.5 py-1.5 shadow-[var(--shadow-float-capsule)] animate-drawer-in active:scale-95 transition-transform"
            >
              <span className="flex h-2 w-2 rounded-full bg-green animate-pulse" />
              <ShoppingBag className="h-3.5 w-3.5 text-gold" strokeWidth={2.2} />
              <span className="text-xs font-bold text-ink truncate max-w-[170px]">
                {stageLabel(activeOrder.stage, activeOrder.type)}
              </span>
              {activeOrder.pin_code && (
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-ink tracking-wider">
                  {t("nav_tracker_pin_label", { pin: activeOrder.pin_code })}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-ink-500" />
            </button>
          )}

          {/* Elevated Floating Capsule Dock */}
          <div className="pointer-events-auto w-full soft-capsule p-1.5 transition-all">
            <ul className="flex items-center justify-around">
              {tabs.map((tab) => {
                const active =
                  tab.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(tab.href);
                const Icon = tab.icon;
                return (
                  <li key={tab.href} className="flex-1">
                    <Link
                      href={tab.href}
                      className={`relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200 ${
                        active
                          ? "text-gold font-bold scale-105"
                          : "text-ink-500 hover:text-ink font-medium"
                      }`}
                    >
                      <span className="relative">
                        <Icon className="h-5 w-5" strokeWidth={active ? 2.3 : 1.75} aria-hidden />
                        {tab.href === "/chat" && hasUnread && (
                          <span
                            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold animate-glow-gold"
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="text-[10px] leading-none">{t(tab.labelKey)}</span>
                      {active && (
                        <span
                          className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-gold"
                          aria-hidden
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </nav>

      {/* Mini Tracker Bottom Sheet for Active Delivery */}
      {activeOrder && (
        <BottomDrawer
          isOpen={trackerDrawerOpen}
          onClose={() => setTrackerDrawerOpen(false)}
          title={t("nav_tracker_title")}
        >
          <div className="space-y-4">
            <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  {activeOrder.type === "parcel" ? t("nav_tracker_parcel") : t("nav_tracker_shopping")}
                </span>
                <span className="rounded-full bg-green/15 px-2.5 py-0.5 text-xs font-bold text-green">
                  {stageLabel(activeOrder.stage, activeOrder.type)}
                </span>
              </div>
              <h3 className="text-base font-bold text-ink">{orderTitle(activeOrder)}</h3>
              {activeOrder.pin_code && (
                <div className="rounded-xl bg-gold/10 p-3 text-center">
                  <p className="text-xs font-semibold uppercase text-ink-500">{t("nav_tracker_handover_pin")}</p>
                  <p className="text-2xl font-bold tracking-[0.25em] text-ink">{activeOrder.pin_code}</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setTrackerDrawerOpen(false);
                router.push(`/orders/${activeOrder.id}`);
              }}
              className="min-h-12 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] active:scale-95 transition-transform"
            >
              {t("nav_tracker_open_full")}
            </button>
          </div>
        </BottomDrawer>
      )}
    </>
  );
}
