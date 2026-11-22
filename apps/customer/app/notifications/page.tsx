"use client";

import { BadgeDollarSign, BellRing, ChevronRight, MessageCircle, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NotificationSettings } from "../../components/NotificationSettings";
import { api } from "../../lib/api";
import { loadOrderFeed } from "../../lib/order-feed";

type Activity = { id: string; href: string; title: string; detail: string; kind: "fee" | "message" | "order" | "wallet" };

const ICON = { fee: BadgeDollarSign, message: MessageCircle, order: Truck, wallet: Wallet } as const;

/** No separate notification inbox exists on the server; this gathers the
 * things that need you from live data: a rider's fee proposal, unread
 * messages and orders still in progress. */
async function loadActivity(): Promise<Activity[]> {
  const [active, threads, restaurantThreads, feed, walletAlerts] = await Promise.allSettled([
    api.getActiveOrder(), api.getChatThreads(), api.getMyRestaurantChatThreads(), loadOrderFeed(), api.getWalletAlerts(),
  ]);
  const items: Activity[] = [];
  if (active.status === "fulfilled" && active.value.pendingFeeProposal && active.value.activeOrder) {
    items.push({ id: "fee", kind: "fee", href: `/orders/${active.value.activeOrder.id}`, title: "Your rider proposed a new fee", detail: "Review and approve or decline" });
  }
  if (threads.status === "fulfilled") {
    for (const t of threads.value.threads.filter((t) => t.unread)) {
      items.push({ id: `chat-${t.counterpartId}`, kind: "message", href: `/chat/${t.counterpartId}`, title: `New message from ${t.counterpartName}`, detail: t.lastMessagePreview });
    }
  }
  if (restaurantThreads.status === "fulfilled") {
    for (const t of restaurantThreads.value.threads.filter((t) => t.unread)) {
      items.push({ id: `rchat-${t.restaurantId}`, kind: "message", href: `/restaurants/${t.restaurantId}/chat`, title: `New message from ${t.restaurantName}`, detail: t.lastMessagePreview });
    }
  }
  if (walletAlerts.status === "fulfilled") {
    for (const alert of walletAlerts.value.alerts) {
      items.push({ id: `wallet-${alert.id}`, kind: "wallet", href: "/wallet", title: alert.title, detail: alert.body });
    }
  }
  if (feed.status === "fulfilled") {
    for (const list of feed.value.inProgress) {
      items.push({ id: `order-${list.id}`, kind: "order", href: `/orders/${list.orderId}`, title: list.title, detail: "In progress · tap to follow it" });
    }
  }
  return items;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Activity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadActivity().then((next) => { if (!cancelled) setItems(next); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Notifications</h1>

      <section className="space-y-2.5" aria-label="Activity">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Activity</h2>
        {items === null && <div className="home-card h-[70px] animate-pulse !rounded-2xl" aria-busy="true" aria-label="Loading" />}
        {items?.length === 0 && (
          <div className="home-card flex items-center gap-3 !rounded-2xl">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><BellRing className="h-5 w-5" strokeWidth={1.9} aria-hidden /></span>
            <span><span className="block text-sm font-bold text-ink">You&apos;re all caught up</span><span className="block text-xs text-ink-500">New messages and order updates will show up here.</span></span>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="space-y-2.5">
            {items.map((item) => {
              const Icon = ICON[item.kind];
              return (
                <li key={item.id}>
                  <Link href={item.href} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">{item.detail}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NotificationSettings />
    </div>
  );
}
