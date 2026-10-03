"use client";

import type { AvailableJob, OrderRow, Rider } from "@tuma/shared";
import { isRiderProfileComplete } from "@tuma/shared";
import { ChevronRight, MapPin, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JobPreviewModal } from "../components/JobPreviewModal";
import { StageSavingsCard } from "../components/StageSavingsCard";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTranslate } from "../lib/i18n";
import {
  formatUgx,
  JOB_CATEGORY_LABELS,
  jobCategory,
  jobTitle,
  stageLabel,
  type JobCategory,
} from "../lib/order-display";
import { useLivePolling } from "../lib/use-live-polling";
import { useNetworkStatus } from "../lib/use-network-status";

type SortOrder = "distance" | "price_high" | "price_low" | "newest" | "oldest";

const SORT_KEYS: Record<
  SortOrder,
  "home_sort_nearest" | "home_sort_price_high" | "home_sort_price_low" | "home_sort_newest" | "home_sort_oldest"
> = {
  distance: "home_sort_nearest",
  price_high: "home_sort_price_high",
  price_low: "home_sort_price_low",
  newest: "home_sort_newest",
  oldest: "home_sort_oldest",
};

export default function JobsHomePage() {
  const t = useTranslate();
  const { user } = useAuth();
  const router = useRouter();
  const [rider, setRider] = useState<Rider | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [availableJobs, setAvailableJobs] = useState<AvailableJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewJobItem, setPreviewJobItem] = useState<AvailableJob | null>(null);
  const [subscriptionOk, setSubscriptionOk] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<JobCategory | "all">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("distance");
  const [bids, setBids] = useState<Record<string, string>>({});
  const online = useNetworkStatus();

  const load = useCallback(() => {
    Promise.all([api.myRiderProfile(), api.myRiderOrders(), api.availableJobs(), api.myRiderSubscription()])
      .then(([r, o, j, s]) => {
        setRider(r.rider);
        setOrders(o.orders);
        setAvailableJobs(j.jobs);
        setSubscriptionOk(!s.subscription.required || s.subscription.current);
        setLoaded(true);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useLivePolling(load, 6000, [load]);

  // This screen is the landing page once (and only once) a rider is fully
  // set up: profile complete, admin-verified, and (if the admin requires
  // one) their subscription is paid up. Anyone short of that gets sent to
  // their account screen instead — either to finish the required fields,
  // wait for verification, or pay their subscription — rather than seeing
  // an empty jobs list they can't actually do anything with yet.
  const ready = isRiderProfileComplete(rider) && !!rider?.verified && subscriptionOk;
  useEffect(() => {
    if (loaded && !ready) router.replace("/account");
  }, [loaded, ready, router]);

  async function toggleOnline() {
    if (!rider) return;
    setBusy(true);
    try {
      const res = await api.setRiderOnline(!rider.is_online);
      setRider(res.rider);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function claimJob(id: string) {
    setClaimingId(id);
    setError(null);
    try {
      await api.claimOrder(id);
      router.push(`/jobs/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      load();
    } finally {
      setClaimingId(null);
    }
  }

  /** "nearest_window"/"customer_selects" jobs don't assign outright — applying just enters the running. */
  async function applyToJob(id: string) {
    setClaimingId(id);
    setError(null);
    try {
      const job = availableJobs.find((j) => j.id === id);
      const typed = Number((bids[id] ?? "").replace(/[^\d]/g, ""));
      // Only send a price when bidding is on for this job and it differs from the app's own.
      const bid = job?.bidding && typed > 0 && typed !== job.bidding.appPrice ? typed : undefined;
      await api.applyForOrder(id, bid);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClaimingId(null);
    }
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<JobCategory, number> = { parcel: 0, ride: 0, shopping: 0, food: 0 };
    for (const job of availableJobs) counts[jobCategory(job)] += 1;
    return counts;
  }, [availableJobs]);

  const visibleJobs = useMemo(() => {
    const filtered =
      categoryFilter === "all" ? availableJobs : availableJobs.filter((job) => jobCategory(job) === categoryFilter);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortOrder) {
        case "price_high":
          return (b.final_total ?? b.estimated_total ?? 0) - (a.final_total ?? a.estimated_total ?? 0);
        case "price_low":
          return (a.final_total ?? a.estimated_total ?? 0) - (b.final_total ?? b.estimated_total ?? 0);
        case "newest":
          return b.created_at.localeCompare(a.created_at);
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "distance":
        default:
          return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      }
    });
    return sorted;
  }, [availableJobs, categoryFilter, sortOrder]);

  if (!ready) {
    return <div className="p-4 text-sm text-ink-500">{t("loading")}</div>;
  }

  const activeOrders = orders.filter((o) => o.stage !== "Settle");

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">
          {t("home_hi")}
          {user?.name ? `, ${user.name}` : ""}
        </h1>
        <button
          disabled={busy || !online}
          onClick={toggleOnline}
          className={`rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50 ${
            rider?.is_online ? "bg-green text-white" : "bg-[rgb(var(--surface-muted))] text-ink"
          }`}
        >
          {rider?.is_online ? t("home_online") : t("home_offline")}
        </button>
      </header>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <StageSavingsCard />

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("home_available_jobs")}</h2>

        {rider?.is_online && availableJobs.length > 0 && (
          <div className="space-y-2">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {(["all", "ride", "parcel", "shopping", "food"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
                    categoryFilter === cat
                      ? "border-gold bg-gold/15 text-ink"
                      : "border-[var(--border-faint)] text-ink-500"
                  }`}
                >
                  {cat === "all"
                    ? `${t("home_all")} (${availableJobs.length})`
                    : `${JOB_CATEGORY_LABELS[cat]} (${categoryCounts[cat]})`}
                </button>
              ))}
            </div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-gold"
            >
              {(Object.keys(SORT_KEYS) as SortOrder[]).map((key) => (
                <option key={key} value={key}>
                  {t("home_sort")}: {t(SORT_KEYS[key])}
                </option>
              ))}
            </select>
          </div>
        )}

        {!rider?.is_online && (
          <p className="py-4 text-center text-sm text-ink-500">{t("home_go_online")}</p>
        )}
        {rider?.is_online && availableJobs.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-500">{t("home_no_jobs")}</p>
        )}
        {rider?.is_online && availableJobs.length > 0 && visibleJobs.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-500">
            {t("home_no_category_jobs", { category: JOB_CATEGORY_LABELS[categoryFilter as JobCategory]?.toLowerCase() ?? "" })}
          </p>
        )}
        <ul className="space-y-2.5">
          {visibleJobs.map((job) => (
            <li key={job.id} className="home-card space-y-2.5 !rounded-2xl !px-3 !py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-bold text-ink">{jobTitle(job)}</span>
                    <span className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
                      {JOB_CATEGORY_LABELS[jobCategory(job)]}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                    {job.distanceKm != null ? `${job.distanceKm} ${t("home_km_away")}` : t("home_distance_unknown")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold text-ink">
                    {formatUgx(job.final_total ?? job.estimated_total)}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {formatUgx(job.delivery_fee ?? job.final_total ?? job.estimated_total)} {t("home_delivery")}
                  </span>
                </span>
              </div>
              {job.outOfServiceRange && (
                <div className="flex items-start gap-1.5 rounded-lg bg-gold/10 px-2.5 py-1.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
                  <p className="text-xs text-ink-500">{t("home_out_of_range")}</p>
                </div>
              )}
              {job.bidding && job.matching_mode !== "first_to_claim" && !job.applied && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor={`bid-${job.id}`}>
                    {t("bid_your_price")}
                  </label>
                  <input
                    id={`bid-${job.id}`}
                    inputMode="numeric"
                    value={bids[job.id] ?? String(job.bidding.appPrice ?? "")}
                    onChange={(e) => setBids((prev) => ({ ...prev, [job.id]: e.target.value.replace(/[^\d]/g, "") }))}
                    className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] px-3 text-base font-bold text-ink outline-none focus:border-gold"
                  />
                  <p className="text-xs text-ink-500">
                    {t("bid_app_price", { price: formatUgx(job.bidding.appPrice) })} ·{" "}
                    {t("bid_range", { min: formatUgx(job.bidding.min), max: formatUgx(job.bidding.max) })}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewJobItem(job)}
                  className="min-h-10 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
                >
                  {t("home_preview")}
                </button>
                {job.matching_mode === "first_to_claim" ? (
                  <button
                    onClick={() => claimJob(job.id)}
                    disabled={claimingId === job.id || !online}
                    className="min-h-10 flex-[2] rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
                  >
                    {claimingId === job.id ? t("home_claiming") : !online ? t("home_offline_btn") : t("home_claim_job")}
                  </button>
                ) : (
                  <button
                    onClick={() => applyToJob(job.id)}
                    disabled={claimingId === job.id || job.applied || !online}
                    className={`min-h-10 flex-[2] rounded-full px-4 text-sm font-bold disabled:opacity-60 ${
                      job.applied ? "bg-[rgb(var(--surface-muted))] text-ink-500" : "bg-gold text-ink-gold"
                    }`}
                  >
                    {claimingId === job.id
                      ? t("home_applying")
                      : job.applied
                        ? t("home_applied")
                        : !online
                          ? t("home_offline_btn")
                          : t("home_apply")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("home_your_jobs")}</h2>
        {activeOrders.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-500">{t("home_no_active_jobs")}</p>
        )}
        <ul className="space-y-2.5">
          {activeOrders.map((order) => (
            <li key={order.id}>
              <Link href={`/jobs/${order.id}`} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink">{jobTitle(order)}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{stageLabel(order.stage)}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {previewJobItem && (
        <JobPreviewModal
          job={previewJobItem}
          busy={claimingId === previewJobItem.id}
          offline={!online}
          onClose={() => setPreviewJobItem(null)}
          onClaim={() => {
            setPreviewJobItem(null);
            claimJob(previewJobItem.id);
          }}
          onApply={() => {
            setPreviewJobItem(null);
            applyToJob(previewJobItem.id);
          }}
        />
      )}
    </div>
  );
}
