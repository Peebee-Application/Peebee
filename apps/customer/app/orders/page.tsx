"use client";

import type { ListSummary, OrderRow } from "@tuma/shared";
import { ChevronRight, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingListModal } from "../../components/home/ShoppingListModal";
import { api } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { orderTitle, stageLabel } from "../../lib/order-display";

export default function OrdersPage() {
  const t = useTranslate();
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [activeOrder, setActiveOrder] = useState<OrderRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showNewList, setShowNewList] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getRecentLists(50), api.getActiveOrder()])
      .then(([listsRes, orderRes]) => {
        if (cancelled) return;
        setLists(listsRes.lists);
        setActiveOrder(orderRes.activeOrder);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">{t("orders_title")}</h1>
        <button
          type="button"
          onClick={() => setShowNewList(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-2 text-sm font-bold text-ink-gold"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          {t("orders_new")}
        </button>
      </div>

      {showNewList && <ShoppingListModal onClose={() => setShowNewList(false)} />}

      {activeOrder && (
        <Link
          href={`/orders/${activeOrder.id}`}
          className="home-card flex items-center justify-between gap-3"
        >
          <span>
            <span className="block text-[15px] font-bold text-ink">{orderTitle(activeOrder)}</span>
            <span className="text-xs text-ink-500">{stageLabel(activeOrder.stage)}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-ink-500/60" strokeWidth={1.75} aria-hidden />
        </Link>
      )}

      {loaded && lists.length === 0 && !activeOrder && (
        <p className="py-10 text-center text-sm text-ink-500">{t("orders_no_lists")}</p>
      )}

      {lists.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("orders_lists_heading")}</h2>
          <ul className="space-y-2.5">
            {lists.map((list) => (
              <li key={list.id}>
                <Link
                  href={`/orders/lists/${list.listId}`}
                  className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink-500">
                    <ShoppingBag className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink">{list.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      {list.expired ? t("list_expired_hint") : `${list.itemCount} ${t("items_count")}`}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                      list.expired ? "bg-gold/15 text-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                    }`}
                  >
                    {list.expired ? t("list_expired") : list.status}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
