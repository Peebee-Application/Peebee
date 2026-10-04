"use client";

import { ORDER_STAGES, type AdminOrderRow, type OrderModuleKey, type OrderOverview, type OrderType } from "@peebee/shared";
import { ChevronRight, Filter, Package, ShoppingBag, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { formatUgx, orderTitle, stageLabel } from "../../lib/order-display";

type TypeFilter = "all" | OrderType;
type StageFilter = "all" | (typeof ORDER_STAGES)[number];

const MODULE_LABEL: Record<OrderModuleKey, string> = {
  parcel: "Parcels",
  shopping: "Shopping",
  ride: "Rides",
  food: "Food",
};

const MODULE_ICON: Record<OrderModuleKey, typeof Package> = {
  parcel: Package,
  shopping: ShoppingBag,
  ride: Truck,
  food: Store,
};

/** A single consolidated dropdown for one filter — used twice here (order
 * type, order stage) instead of two long rows of pill buttons. */
function FilterDropdown<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-1.5 text-xs font-semibold text-ink"
      >
        <Filter className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {label}: {labels[value]}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 z-20 mt-1.5 max-h-80 w-52 overflow-y-auto rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-lg">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2.5 text-left text-sm font-medium ${
                  opt === value ? "bg-gold/10 text-gold" : "text-ink"
                }`}
              >
                {labels[opt]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModuleStatCards() {
  const [overview, setOverview] = useState<OrderOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminOrderOverview("all").then(setOverview).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return null;
  if (!overview) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="grid grid-cols-2 gap-2">
      {(Object.keys(MODULE_LABEL) as OrderModuleKey[]).map((key) => {
        const Icon = MODULE_ICON[key];
        const stats = overview.modules[key];
        return (
          <div key={key} className="home-card !p-3">
            <div className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />
              <p className="text-xs font-semibold text-ink-500">{MODULE_LABEL[key]}</p>
            </div>
            <p className="mt-1 text-xl font-bold text-ink">{stats.orderCount}</p>
            <p className="text-[11px] text-ink-500">orders</p>
          </div>
        );
      })}
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [stage, setStage] = useState<StageFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminListOrders({
        stage: stage === "all" ? undefined : stage,
        type: type === "all" ? undefined : type,
        limit: 50,
      })
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(errorMessage(err)));
  }, [stage, type]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const typeLabels: Record<TypeFilter, string> = { all: "All", shopping: "Shopping", parcel: "Parcel" };
  const stageLabels: Record<StageFilter, string> = {
    all: "All",
    ...(Object.fromEntries(ORDER_STAGES.map((s) => [s, stageLabel(s)])) as Record<(typeof ORDER_STAGES)[number], string>),
  };

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Orders</h1>

      <ModuleStatCards />

      <div className="flex flex-wrap gap-2">
        <FilterDropdown label="Type" value={type} options={["all", "shopping", "parcel"] as const} labels={typeLabels} onChange={setType} />
        <FilterDropdown
          label="Stage"
          value={stage}
          options={["all", ...ORDER_STAGES] as const}
          labels={stageLabels}
          onChange={setStage}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {orders.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No orders match.</p>}

      <ul className="space-y-2.5">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{orderTitle(order)}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {stageLabel(order.stage, order.type)}
                  {order.rider_name ? ` · ${order.rider_name}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-ink">
                {formatUgx(order.final_total ?? order.estimated_total)}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
