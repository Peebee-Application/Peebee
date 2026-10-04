"use client";

import type { AdminStats, FailedPayment, IntegrationsStatus, OrderModuleKey, OrderOverview, OrderOverviewRange } from "@peebee/shared";
import { AlertTriangle, CheckCircle2, Package, ShoppingBag, Store, Truck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatUgx, formatDate } from "../lib/order-display";

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
    <div className="home-card !p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Orders</h2>
        <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-0.5">
          {(["revenue", "profit"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                view === v ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm" : "text-ink-500"
              }`}
            >
              {v === "revenue" ? "Revenue" : "Income"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {(Object.keys(RANGE_LABEL) as OrderOverviewRange[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              range === r ? "bg-ink text-white" : "bg-[rgb(var(--surface-muted))] text-ink-500"
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
              <p className="text-xs text-ink-500">Total orders</p>
              <p className="text-xl font-bold text-ink">{overview.totals.orderCount}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">{view === "revenue" ? "Order value" : "Platform income"}</p>
              <p className="text-xl font-bold text-ink">{formatUgx(overview.totals[view])}</p>
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
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{MODULE_LABEL[m.key]}</span>
                    <span className="text-xs text-ink-500">{m.orderCount} order{m.orderCount === 1 ? "" : "s"}</span>
                    <span className="w-24 text-right text-sm font-bold text-ink">{formatUgx(m[view])}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[rgb(var(--surface-muted))]">
                    <div className="h-1.5 rounded-full bg-gold" style={{ width: `${Math.min(100, shareOfTotal)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>

          {view === "profit" && (
            <p className="text-[11px] text-ink-500">
              Cash orders&apos; platform cut is deducted from the rider&apos;s wallet at settle rather than tracked
              per order, so it isn&apos;t reflected in income here yet. This is gross income, not pure profit —
              it doesn&apos;t yet account for costs like payment processing or payouts.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [failedPayments, setFailedPayments] = useState<FailedPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  }
  if (!stats || !integrations) {
    return <div className="p-4 text-sm text-ink-500">Loading…</div>;
  }

  const activeOrders = Object.entries(stats.ordersByStage)
    .filter(([stage]) => stage !== "Settle")
    .reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Overview</h1>

      {/* The single most dangerous thing about this deployment is someone
          treating a wallet balance or a GMV figure as real money while
          payments are mocked. It gets a banner, not a line item. */}
      {!integrations.mobileMoney.collection.live && (
        <section
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border-2 border-red-500 bg-red-50 px-3.5 py-3 dark:bg-red-950/40"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" strokeWidth={2.25} aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
              Simulated payments
            </p>
            <p className="text-xs leading-relaxed text-red-700 dark:text-red-300">
              No real money moves. Escrow collections succeed without charging anyone, rider wallet balances are
              fictional, and withdrawals pay out nothing. Every figure below is test data — don&apos;t onboard real
              riders or settle real orders until mobile money is live.
            </p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-3 gap-3">
        <StatCard label="Customers" value={stats.totalCustomers} />
        <StatCard label="Riders" value={stats.totalRiders} />
        <StatCard label="Restaurants" value={stats.totalRestaurants} />
        <StatCard label="Verified riders" value={stats.verifiedRiders} />
        <StatCard label="Online now" value={stats.onlineRiders} />
        <StatCard label="Active orders" value={activeOrders} />
      </section>

      <OrdersByModule />

      <section className="home-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Payments</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-500">Pending</span>
          <span className="font-semibold text-ink">{stats.paymentsByStatus.pending ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-500">Successful</span>
          <span className="font-semibold text-ink">{stats.paymentsByStatus.successful ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-500">Failed</span>
          <span className="font-semibold text-red-700">{stats.paymentsByStatus.failed ?? 0}</span>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2 text-sm">
          <span className="text-ink-500">Settled GMV (all time)</span>
          <span className="font-semibold text-ink">{formatUgx(stats.settledGmv)}</span>
        </div>
      </section>

      <section className="home-card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Integrations</h2>
        {integrations.mobileMoney.providers.map((provider) => (
          <div key={provider.key} className="flex items-center gap-2 text-sm">
            {provider.configured ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green" strokeWidth={2} aria-hidden />
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-full bg-gold/70" aria-hidden />
            )}
            <span className="text-ink">
              {provider.displayName} — {provider.configured ? "connected" : "demo / simulated"}
              {provider.active ? (provider.priority === 0 ? " · primary" : " · fallback") : " · off"}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-sm">
          {integrations.storage.configured ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green" strokeWidth={2} aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-red-600" strokeWidth={2} aria-hidden />
          )}
          <span className="text-ink">
            R2 document storage — {integrations.storage.configured ? "connected" : "not connected"}
          </span>
        </div>

        {failedPayments.length > 0 && (
          <div className="space-y-1.5 border-t border-[var(--border-faint)] pt-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Recent failed payments
            </p>
            <ul className="space-y-1">
              {failedPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-xs text-ink-500">
                  <span>
                    {p.type} · {formatDate(p.created_at)}
                  </span>
                  <span className="font-semibold text-ink">{formatUgx(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
