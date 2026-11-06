"use client";

import type { AdminStats, FailedPayment, IntegrationsStatus, OrderModuleKey, OrderOverview, OrderOverviewRange } from "@peebee/shared";
import Link from "next/link";
import { Activity, AlertTriangle, ChevronRight, UsersRound, CheckCircle2, Package, ShoppingBag, Store, Truck, Wallet, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatUgx, formatDate } from "../lib/order-display";
import { TabBar } from "../components/TabBar";
import { loadIncome } from "../lib/income";

const RANGE_LABEL: Record<OrderOverviewRange, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="home-card !p-4 text-center">
      <p className="text-sm font-semibold text-ink-500">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-ink">{value}</p>
    </div>
  );
}

function OrdersByModule() {
  const [range, setRange] = useState<OrderOverviewRange>("all");
  const [view, setView] = useState<"revenue" | "profit">("revenue");
  const [overview, setOverview] = useState<OrderOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminOrderOverview(range)
      .then(setOverview)
      .catch((err) => setError(errorMessage(err)));
  }, [range]);

  const modules = useMemo(() => {
    if (!overview) return [];
    return (Object.keys(MODULE_LABEL) as OrderModuleKey[])
      .map((key) => ({ key, ...overview.modules[key] }))
      .sort((a, b) => b[view] - a[view]);
  }, [overview, view]);

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div><h2 className="text-lg font-extrabold text-ink">Orders</h2><p className="text-xs text-ink-500">Rides, parcels, shopping, food. Other income is under Money.</p></div>
        <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-0.5">
          {(["revenue", "profit"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3.5 py-2 text-sm font-bold ${
                view === v ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm" : "text-ink-500"
              }`}
            >
              {v === "revenue" ? "Revenue" : "Income"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(RANGE_LABEL) as OrderOverviewRange[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`min-h-12 rounded-full px-4 py-2.5 text-base font-bold ${
              range === r ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {overview && (
        <>
          <div className="grid grid-cols-2 gap-3 border-y border-[var(--border-faint)] py-3">
            <div>
              <p className="text-sm text-ink-500">Total orders</p>
              <p className="text-2xl font-extrabold text-ink">{overview.totals.orderCount}</p>
            </div>
            <div>
              <p className="text-sm text-ink-500">{view === "revenue" ? "Order value" : "Platform income"}</p>
              <p className="text-2xl font-extrabold text-ink">{formatUgx(overview.totals[view])}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {modules.map((m) => {
              const Icon = MODULE_ICON[m.key];
              const shareOfTotal = overview.totals[view] > 0 ? (m[view] / overview.totals[view]) * 100 : 0;
              return (
                <li key={m.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{MODULE_LABEL[m.key]}</span>
                    <span className="text-sm text-ink-500">{m.orderCount} order{m.orderCount === 1 ? "" : "s"}</span>
                    <span className="w-28 text-right text-base font-extrabold text-ink">{formatUgx(m[view])}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[rgb(var(--surface-muted))]">
                    <div className="h-1.5 rounded-full bg-gold" style={{ width: `${Math.min(100, shareOfTotal)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>

          {view === "profit" && (
            <p className="text-xs text-ink-500">
              Gross income, not profit. Cash orders&apos; cut is taken from the rider&apos;s wallet at settle, so it isn&apos;t counted here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

type OverviewTab = "today" | "money" | "system";

export default function OverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [failedPayments, setFailedPayments] = useState<FailedPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<OverviewTab>("today");
  const [allIncome, setAllIncome] = useState<{ total: number; counted: number; streams: number } | null>(null);

  const load = useCallback(() => {
    Promise.all([api.adminStats(), api.adminIntegrations()])
      .then(([s, i]) => {
        setStats(s.stats);
        setIntegrations(i.integrations);
        setFailedPayments(i.recentFailedPayments);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // All income streams (not just orders), for the Money tab. Loaded once; a failure just leaves the card without a figure.
  useEffect(() => {
    loadIncome("month").then((d) => setAllIncome({ total: d.total, counted: d.counted, streams: d.rows.length })).catch(() => setAllIncome(null));
  }, []);

  if (error) {
    return <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  }
  if (!stats || !integrations) {
    return <div className="p-4 text-base text-ink-500">Loading…</div>;
  }

  const activeOrders = Object.entries(stats.ordersByStage)
    .filter(([stage]) => stage !== "Settle")
    .reduce((sum, [, n]) => sum + n, 0);
  const simulated = !integrations.mobileMoney.collection.live;

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h1 className="text-2xl font-extrabold text-ink">Overview</h1>

      {/* Payments being mocked is the most dangerous thing to miss, so it stays a banner above every tab. */}
      {simulated && (
        <section role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-3.5 dark:bg-red-950/40">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" strokeWidth={2.25} aria-hidden />
          <div className="space-y-1">
            <p className="text-base font-extrabold text-red-700 dark:text-red-400">Simulated payments</p>
            <p className="text-sm leading-relaxed text-red-700 dark:text-red-300">
              No real money moves. Every figure here is test data until mobile money is live.
            </p>
          </div>
        </section>
      )}

      <TabBar
        label="Overview"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "today", label: "People", icon: Activity },
          { id: "money", label: "Money", icon: Wallet },
          { id: "system", label: "System", icon: CheckCircle2, count: failedPayments.length },
        ]}
      />

      {tab === "today" && (
        <>
          <section className="grid grid-cols-2 gap-3">
            <StatCard label="Active orders" value={activeOrders} />
            <StatCard label="Riders online" value={stats.onlineRiders} />
            <StatCard label="Customers" value={stats.totalCustomers} />
            <StatCard label="Riders" value={stats.totalRiders} />
            <StatCard label="Verified riders" value={stats.verifiedRiders} />
            <StatCard label="Restaurants" value={stats.totalRestaurants} />
          </section>
          <Link href="/people/types" className="home-card flex min-h-16 items-center gap-3">
            <UsersRound className="h-6 w-6 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1 text-lg font-bold text-ink">Every kind of user</span>
            <ChevronRight className="h-5 w-5 text-ink-500/60" aria-hidden />
          </Link>
          <OrdersByModule />
        </>
      )}

      {tab === "money" && (
        <>
          <Link href="/income" className="home-card !bg-black-700 block text-white dark:!bg-black">
            <p className="text-sm font-semibold text-white/70">All income, last 30 days</p>
            <p className="mt-1 text-4xl font-extrabold text-gold">{allIncome ? formatUgx(allIncome.total) : "…"}</p>
            <p className="mt-1 text-sm text-white/70">
              {allIncome ? `Rides, parcels, shopping, food, Learn, subscriptions and more. ${allIncome.counted} of ${allIncome.streams} streams totalled.` : "Every way Peebee earns."}
            </p>
          </Link>
          <section className="home-card">
            <p className="text-sm font-semibold text-ink-500">Settled GMV, all time</p>
            <p className="mt-1 text-3xl font-extrabold text-ink">{formatUgx(stats.settledGmv)}</p>
          </section>
          <section className="grid grid-cols-3 gap-3">
            <StatCard label="Pending" value={stats.paymentsByStatus.pending ?? 0} />
            <StatCard label="Paid" value={stats.paymentsByStatus.successful ?? 0} />
            <StatCard label="Failed" value={stats.paymentsByStatus.failed ?? 0} />
          </section>
        </>
      )}

      {tab === "system" && (
        <section className="home-card space-y-4">
          <h2 className="text-lg font-extrabold text-ink">Connections</h2>
          {integrations.mobileMoney.providers.map((provider) => (
            <div key={provider.key} className="flex items-center gap-3 text-base">
              {provider.configured ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-green" strokeWidth={2} aria-hidden />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-full bg-gold/70" aria-hidden />
              )}
              <span className="text-ink">
                {provider.displayName}: {provider.configured ? "connected" : "demo"}
                {provider.active ? (provider.priority === 0 ? " · primary" : " · fallback") : " · off"}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 text-base">
            {integrations.storage.configured ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-green" strokeWidth={2} aria-hidden />
            ) : (
              <XCircle className="h-6 w-6 shrink-0 text-red-600" strokeWidth={2} aria-hidden />
            )}
            <span className="text-ink">Document storage: {integrations.storage.configured ? "connected" : "not connected"}</span>
          </div>

          {failedPayments.length > 0 && (
            <div className="space-y-2 border-t border-[var(--border-faint)] pt-4">
              <p className="flex items-center gap-2 text-base font-bold text-red-700">
                <AlertTriangle className="h-5 w-5" strokeWidth={2} aria-hidden />
                Failed payments
              </p>
              <ul className="space-y-2">
                {failedPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm text-ink-500">
                    <span className="min-w-0">
                      {p.type} · {formatDate(p.created_at)}
                      {p.late === "credited" && <span className="ml-1.5 font-semibold text-green">· credited late</span>}
                      {p.late === "watching" && <span className="ml-1.5 font-semibold text-gold">· watching</span>}
                    </span>
                    <span className="shrink-0 text-base font-bold text-ink">{formatUgx(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
