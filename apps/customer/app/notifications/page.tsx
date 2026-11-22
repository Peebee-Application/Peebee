"use client";

import { BadgeDollarSign, BellRing, ChevronRight, MessageCircle, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { loadActivity, type Activity } from "../../lib/notification-activity";

const ICON = { fee: BadgeDollarSign, message: MessageCircle, order: Truck, wallet: Wallet } as const;

export default function NotificationsPage() {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  function reload() {
    return loadActivity().then(setItems).catch(() => setItems([]));
  }

  useEffect(() => {
    let cancelled = false;
    loadActivity().then((next) => { if (!cancelled) setItems(next); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const visible = items;

  async function markWalletRead() {
    await api.markWalletAlertsRead().catch(() => undefined);
    await reload();
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="customer-preview-seg" role="group" aria-label="Notification filter">
          <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All</button>
          <button type="button" aria-pressed={filter === "unread"} className={filter === "unread" ? "is-on" : ""} onClick={() => setFilter("unread")}>Unread</button>
        </div>
        {items && items.length > 0 && (
          <button type="button" className="text-sm font-bold text-gold" onClick={() => void markWalletRead()}>
            Mark all read
          </button>
        )}
      </div>

      <section className="space-y-2.5" aria-label="Activity">
        {items === null && <div className="home-card h-[70px] animate-pulse !rounded-2xl" aria-busy="true" aria-label="Loading" />}
        {visible?.length === 0 && (
          <div className="home-card flex items-center gap-3 !rounded-2xl">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><BellRing className="h-5 w-5" strokeWidth={1.9} aria-hidden /></span>
            <span><span className="block text-sm font-bold text-ink">You&apos;re all caught up</span><span className="block text-xs text-ink-500">New messages and order updates will show up here.</span></span>
          </div>
        )}
        {visible && visible.length > 0 && (
          <ul className="space-y-2.5">
            {visible.map((item) => {
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
    </div>
  );
}
