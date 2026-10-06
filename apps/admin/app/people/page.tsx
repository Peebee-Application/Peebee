"use client";
import { foodBusinessLabel } from "@peebee/shared";

import {
  hasPermission,
  type AdminCustomer,
  type AdminMerchant,
  type AdminRestaurant,
  type AdminRider,
  type Merchant,
  type RestaurantStatus,
} from "@peebee/shared";
import { ChevronRight, Filter, Search, ShieldCheck, ShieldQuestion, Store, Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type Tab = "riders" | "customers" | "restaurants" | "merchants";
type RiderFilter = "all" | "pending" | "verified";
type RestaurantFilter = "all" | RestaurantStatus;
type MerchantFilter = "all" | Merchant["status"];
type DateRange = "all" | "today" | "week" | "month";

const RESTAURANT_STATUS_LABEL: Record<RestaurantStatus, string> = {
  pending_approval: "Pending",
  active: "Active",
  suspended: "Suspended",
};

const MERCHANT_STATUS_LABEL: Record<Merchant["status"], string> = {
  pending_approval: "Pending",
  provisional: "Provisional",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
};

const DATE_RANGE_LABEL: Record<DateRange, string> = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
};

function rangeStart(range: DateRange): Date | null {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (range === "month") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function withinRange(createdAt: string, range: DateRange): boolean {
  const start = rangeStart(range);
  if (!start) return true;
  const created = new Date(createdAt.replace(" ", "T") + (createdAt.includes("Z") ? "" : "Z"));
  return created.getTime() >= start.getTime();
}

function cityOf(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Unspecified";
}

function groupByCity<T>(rows: T[], cityOf_: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const city = cityOf_(row);
    const list = groups.get(city);
    if (list) list.push(row);
    else groups.set(city, [row]);
  }
  return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length));
}

function StatusBadge({ status }: { status: "active" | "suspended" }) {
  if (status === "active") return null;
  return <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Suspended</span>;
}

/** A single consolidated "Filters" dropdown, replacing a row of segmented
 * pill buttons — keeps the page to one filter control regardless of how
 * many secondary filters a tab has. */
function FilterDropdown<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
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
        {labels[value]}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-lg">
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

function DateRangeTabs({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {(Object.keys(DATE_RANGE_LABEL) as DateRange[]).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
            value === r
              ? "bg-gold text-ink-gold shadow-sm"
              : "bg-[rgb(var(--surface-muted))] text-ink-500"
          }`}
        >
          {DATE_RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

function RidersTab({ dateRange }: { dateRange: DateRange }) {
  const [riders, setRiders] = useState<AdminRider[]>([]);
  const [filter, setFilter] = useState<RiderFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminListRiders()
      .then((res) => setRiders(res.riders))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      riders.filter((r) => {
        if (filter === "pending" && r.verified) return false;
        if (filter === "verified" && !r.verified) return false;
        return withinRange(r.created_at, dateRange);
      }),
    [riders, filter, dateRange],
  );

  const grouped = useMemo(() => groupByCity(filtered, (r) => cityOf(r.area)), [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500">{filtered.length} rider{filtered.length === 1 ? "" : "s"}</p>
        <FilterDropdown
          value={filter}
          options={["all", "pending", "verified"] as const}
          labels={{ all: "All", pending: "Pending", verified: "Verified" }}
          onChange={setFilter}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No riders here.</p>}

      <div className="space-y-5">
        {[...grouped.entries()].map(([city, cityRiders]) => (
          <div key={city} className="space-y-2.5">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {city} · {cityRiders.length}
            </p>
            <ul className="space-y-2.5">
              {cityRiders.map((r) => (
                <li key={r.user_id}>
                  <Link href={`/people/riders/${r.user_id}`} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
                    {r.verified ? (
                      <ShieldCheck className="h-5 w-5 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
                    ) : (
                      <ShieldQuestion className="h-5 w-5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-ink">{r.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">{r.phone}</span>
                    </span>
                    <StatusBadge status={r.status} />
                    <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomersTab({ dateRange }: { dateRange: DateRange }) {
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query: string) => {
    api
      .adminListCustomers(query || undefined)
      .then((res) => setCustomers(res.customers))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const filtered = useMemo(() => customers.filter((c) => withinRange(c.created_at, dateRange)), [customers, dateRange]);
  const grouped = useMemo(() => groupByCity(filtered, (c) => cityOf(c.city)), [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone"
          className="w-full text-sm outline-none"
        />
      </div>
      <p className="text-xs font-semibold text-ink-500">{filtered.length} customer{filtered.length === 1 ? "" : "s"}</p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No customers found.</p>}

      <div className="space-y-5">
        {[...grouped.entries()].map(([city, cityCustomers]) => (
          <div key={city} className="space-y-2.5">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {city} · {cityCustomers.length}
            </p>
            <ul className="space-y-2.5">
              {cityCustomers.map((c) => (
                <li key={c.id}>
                  <Link href={`/people/customers/${c.id}`} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-ink">{c.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {c.phone} · {c.order_count} order{c.order_count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <StatusBadge status={c.status} />
                    <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RestaurantsTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "restaurants.manage");
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [filter, setFilter] = useState<RestaurantFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminListRestaurants()
      .then((res) => setRestaurants(res.restaurants))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: RestaurantStatus) {
    setBusyId(id);
    setError(null);
    try {
      await api.adminSetRestaurantStatus(id, status);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const filtered = restaurants.filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500">{filtered.length} restaurant{filtered.length === 1 ? "" : "s"}</p>
        <FilterDropdown
          value={filter}
          options={["all", "pending_approval", "active", "suspended"] as const}
          labels={{ all: "All", ...RESTAURANT_STATUS_LABEL }}
          onChange={setFilter}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No food businesses here.</p>}

      <ul className="space-y-2.5">
        {filtered.map((r) => (
          <li key={r.id} className="home-card space-y-2 !rounded-2xl !px-3 !py-3">
            <div className="flex items-center gap-3">
              <Store className="h-5 w-5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{r.name}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {r.owner_name}
                  {` · ${foodBusinessLabel(r.business_type)}`}
                  {r.cuisine ? ` · ${r.cuisine}` : ""}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  r.status === "active"
                    ? "bg-green/15 text-green"
                    : r.status === "suspended"
                      ? "bg-red-100 text-red-700"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500"
                }`}
              >
                {RESTAURANT_STATUS_LABEL[r.status]}
              </span>
            </div>
            {canManage && (
              <div className="flex gap-2">
                {r.status !== "active" && (
                  <button
                    onClick={() => setStatus(r.id, "active")}
                    disabled={busyId === r.id}
                    className="min-h-9 flex-1 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold disabled:opacity-60"
                  >
                    Approve
                  </button>
                )}
                {r.status !== "suspended" && (
                  <button
                    onClick={() => setStatus(r.id, "suspended")}
                    disabled={busyId === r.id}
                    className="min-h-9 flex-1 rounded-full border border-red-200 px-3 text-xs font-bold text-red-600 disabled:opacity-60"
                  >
                    Suspend
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MerchantsTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "merchants.manage");
  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);
  const [filter, setFilter] = useState<MerchantFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminMerchants()
      .then((res) => setMerchants(res.merchants))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: Merchant["status"]) {
    setBusyId(id);
    setError(null);
    try {
      await api.adminSetMerchantStatus(id, status);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const filtered = merchants.filter((merchant) => filter === "all" || merchant.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500">
          {filtered.length} merchant{filtered.length === 1 ? "" : "s"}
        </p>
        <FilterDropdown
          value={filter}
          options={["all", "pending_approval", "provisional", "active", "suspended", "rejected"] as const}
          labels={{ all: "All", ...MERCHANT_STATUS_LABEL }}
          onChange={setFilter}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No merchants here.</p>}

      <ul className="space-y-2.5">
        {filtered.map((merchant) => (
          <li key={merchant.id} className="home-card space-y-2 !rounded-2xl !px-3 !py-3">
            <Link href={`/people/merchants/${merchant.id}`} className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <Store className="h-5 w-5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{merchant.display_name}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {merchant.legal_name} · {merchant.outlet_count} outlet{Number(merchant.outlet_count) === 1 ? "" : "s"}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  merchant.status === "active"
                    ? "bg-green/15 text-green"
                    : merchant.status === "suspended" || merchant.status === "rejected"
                      ? "bg-red-100 text-red-700"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500"
                }`}
              >
                {MERCHANT_STATUS_LABEL[merchant.status]}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
            </Link>
            {canManage && (
              <div className="flex gap-2">
                {merchant.status !== "active" && (
                  <button
                    onClick={() => setStatus(merchant.id, "active")}
                    disabled={busyId === merchant.id}
                    className="min-h-9 flex-1 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold disabled:opacity-60"
                  >
                    Approve
                  </button>
                )}
                {merchant.status !== "suspended" && (
                  <button
                    onClick={() => setStatus(merchant.id, "suspended")}
                    disabled={busyId === merchant.id}
                    className="min-h-9 flex-1 rounded-full border border-red-200 px-3 text-xs font-bold text-red-600 disabled:opacity-60"
                  >
                    Suspend
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryStrip() {
  const [riders, setRiders] = useState<AdminRider[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);

  useEffect(() => {
    api.adminListRiders().then((res) => setRiders(res.riders)).catch(() => {});
    api.adminListCustomers().then((res) => setCustomers(res.customers)).catch(() => {});
    api.adminListRestaurants().then((res) => setRestaurants(res.restaurants)).catch(() => {});
    api.adminMerchants().then((res) => setMerchants(res.merchants)).catch(() => {});
  }, []);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="home-card !py-3 text-center">
        <UsersIcon className="mx-auto h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />
        <p className="mt-1 text-lg font-bold text-ink">{riders.length}</p>
        <p className="text-[11px] text-ink-500">Riders</p>
      </div>
      <div className="home-card !py-3 text-center">
        <UsersIcon className="mx-auto h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />
        <p className="mt-1 text-lg font-bold text-ink">{customers.length}</p>
        <p className="text-[11px] text-ink-500">Customers</p>
      </div>
      <div className="home-card !py-3 text-center">
        <Store className="mx-auto h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />
        <p className="mt-1 text-lg font-bold text-ink">{restaurants.length}</p>
        <p className="text-[11px] text-ink-500">Food</p>
      </div>
      <div className="home-card !py-3 text-center">
        <Store className="mx-auto h-4 w-4 text-gold" strokeWidth={1.75} aria-hidden />
        <p className="mt-1 text-lg font-bold text-ink">{merchants.length}</p>
        <p className="text-[11px] text-ink-500">Merchants</p>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [tab, setTab] = useState<Tab>("riders");
  const [dateRange, setDateRange] = useState<DateRange>("all");

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Users</h1>

      <SummaryStrip />

      {(tab === "riders" || tab === "customers") && <DateRangeTabs value={dateRange} onChange={setDateRange} />}

      <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
        {(["riders", "customers", "restaurants", "merchants"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-w-0 flex-1 rounded-full px-1 py-2 text-xs font-semibold capitalize transition-colors sm:text-sm ${
              tab === t ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"
            }`}
          >
            {t === "restaurants" ? "Food" : t}
          </button>
        ))}
      </div>

      {tab === "riders" ? (
        <RidersTab dateRange={dateRange} />
      ) : tab === "customers" ? (
        <CustomersTab dateRange={dateRange} />
      ) : tab === "restaurants" ? (
        <RestaurantsTab />
      ) : (
        <MerchantsTab />
      )}
    </div>
  );
}
