"use client";

import type { OrderRow } from "@peebee/shared";
import { ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { jobTitle, stageLabel } from "../../lib/order-display";

export default function ActivePage() {
  const t = useTranslate();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    api
      .myRiderOrders()
      .then((res) => setOrders(res.orders.filter((o) => o.stage !== "Settle")))
      .catch(() => setOrders([]));
  }, []);

  if (orders === null) return <div className="p-4 text-sm text-ink-500">{t("active_loading")}</div>;

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t("active_title")}</h1>
      {orders.length === 0 && (
        <div className="home-card flex flex-col items-center gap-2 py-10 text-center">
          <ClipboardList className="h-12 w-12 text-ink-500" aria-hidden />
          <p className="text-lg font-bold text-ink-500">{t("active_none")}</p>
        </div>
      )}
      <ul className="space-y-2.5">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/jobs/${order.id}`} className="home-card flex min-h-20 items-center gap-3 !rounded-2xl !px-3 !py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-ink">{jobTitle(order)}</span>
                <span className="mt-0.5 inline-block rounded-full bg-gold/15 px-3 py-0.5 text-sm font-bold text-ink">{stageLabel(order.stage)}</span>
              </span>
              <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
