"use client";

import { ApiError, observeNotificationSnapshot } from "@peebee/shared";

import type { AvailableJob, OrderRow, RelayOpenLeg, Rider } from "@peebee/shared";
import { isRiderProfileComplete } from "@peebee/shared";
import {
  ArrowUpDown, Bike, Briefcase, Bus, Check, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Fuel, HandCoins, LayoutGrid, MapPin,
  Package, Power, ShoppingCart, TriangleAlert, Utensils, Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FareOfferPanel } from "../components/FareOfferPanel";
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

type SortOrder = "distance" | "price_high" | "newest";
/** One tap cycles through the three orders riders actually use. */
const SORT_CYCLE: SortOrder[] = ["distance", "price_high", "newest"];
const SORT_LABELS: Record<SortOrder, string> = { distance: "Near", price_high: "Pay", newest: "New" };
const PAGE_SIZE = 4;

const CATEGORY_ICONS = { ride: Bike, parcel: Package, shopping: ShoppingCart, food: Utensils };

function CategoryIcon({ category }: { category: JobCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10 text-ink">
      <Icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** The API refuses a claim/apply with 409 when the job left the open pool after the list loaded. */
function jobIsGone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && ["invalid_stage", "rider_unavailable", "already_claimed"].includes(err.code ?? "");
}

export default function JobsHomePage() {
  const t = useTranslate();
  const { user } = useAuth();
  const router = useRouter();
  const [rider, setRider] = useState<Rider | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [availableJobs, setAvailableJobs] = useState<AvailableJob[]>([]);
  const [relayLegs, setRelayLegs] = useState<RelayOpenLeg[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why a claim or an application was refused, shown on that job's own card where the rider just tapped.
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [previewJobItem, setPreviewJobItem] = useState<AvailableJob | null>(null);
  const [subscriptionOk, setSubscriptionOk] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<JobCategory | "all">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("distance");
  const [bids, setBids] = useState<Record<string, string>>({});
  const [openBid, setOpenBid] = useState<string | null>(null);
  const [tab, setTab] = useState<"jobs" | "mine">("jobs");
  const [page, setPage] = useState(0);
  const online = useNetworkStatus();

  const load = useCallback(() => {
    Promise.all([api.myRiderProfile(), api.myRiderOrders(), api.availableJobs(), api.myRiderSubscription()])
      .then(([r, o, j, s]) => {
        setRider(r.rider);
        setOrders(o.orders);
        observeNotificationSnapshot("rider-jobs", j.jobs.map((job) => job.id));
        setAvailableJobs(j.jobs);
        setSubscriptionOk(!s.subscription.required || s.subscription.current);
        setLoaded(true);
      })
      .catch((err) => setError(errorMessage(err)));
    // Relay pickups are optional: a failure here never blocks the feed.
    api
      .listOpenRelayLegs()
      .then((res) => setRelayLegs(res.legs))
      .catch(() => setRelayLegs([]));
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

  function setJobError(id: string, message: string | null) {
    setJobErrors((prev) => {
      if (message == null) {
        if (!(id in prev)) return prev;
        const { [id]: _cleared, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: message };
    });
  }

  async function claimJob(id: string) {
    setClaimingId(id);
    setError(null);
    setJobError(id, null);
    try {
      await api.claimOrder(id);
      router.push(`/jobs/${id}`);
    } catch (err) {
      if (jobIsGone(err)) {
        setAvailableJobs((prev) => prev.filter((j) => j.id !== id));
        setError("That job was just cancelled or taken by someone else.");
      } else {
        setJobError(id, errorMessage(err));
      }
      load();
    } finally {
      setClaimingId(null);
    }
  }

  async function claimRelay(leg: RelayOpenLeg) {
    setClaimingId(leg.id);
    setError(null);
    setJobError(leg.id, null);
    try {
      const res = await api.claimRelayLeg(leg.id);
      router.push(`/jobs/${res.orderId ?? leg.order_id}`);
    } catch (err) {
      setJobError(leg.id, errorMessage(err));
      load();
    } finally {
      setClaimingId(null);
    }
  }

  /** "nearest_window"/"customer_selects" jobs don't assign outright — applying just enters the running. */
  async function applyToJob(id: string) {
    setClaimingId(id);
    setError(null);
    setJobError(id, null);
    try {
      const job = availableJobs.find((j) => j.id === id);
      const typed = Number((bids[id] ?? "").replace(/[^\d]/g, ""));
      // Only send a price when bidding is on for this job and it differs from the app's own.
      const bid = job?.bidding && typed > 0 && typed !== job.bidding.appPrice ? typed : undefined;
      await api.applyForOrder(id, bid);
      await load();
    } catch (err) {
      if (jobIsGone(err)) {
        // Cancelled or taken since this list loaded: drop the dead card instead of leaving it with an error.
        setAvailableJobs((prev) => prev.filter((j) => j.id !== id));
        setError("That job was just cancelled or taken by someone else.");
        load();
      } else {
        setJobError(id, errorMessage(err));
      }
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
          return (b.delivery_fee ?? b.final_total ?? b.estimated_total ?? 0) - (a.delivery_fee ?? a.final_total ?? a.estimated_total ?? 0);
        case "newest":
          return b.created_at.localeCompare(a.created_at);
        case "distance":
        default:
          return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      }
    });
    return sorted;
  }, [availableJobs, categoryFilter, sortOrder]);


  if (!ready) {
    return <div className="p-4 text-base text-ink-500">{t("loading")}</div>;
  }

  const activeOrders = orders.filter((o) => o.stage !== "Settle" && o.stage !== "Cancelled");
  const riderOnline = !!rider?.is_online;
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / PAGE_SIZE));
  const pageNow = Math.min(page, pageCount - 1);
  const pageJobs = visibleJobs.slice(pageNow * PAGE_SIZE, pageNow * PAGE_SIZE + PAGE_SIZE);
  const nextSort = () => {
    setSortOrder(SORT_CYCLE[(SORT_CYCLE.indexOf(sortOrder) + 1) % SORT_CYCLE.length]);
    setPage(0);
  };

  const bigButton = "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-bold disabled:opacity-60";

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <header className="flex items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight text-ink">
          {t("home_hi")}
          {user?.name ? `, ${user.name.trim().split(/\s+/)[0]}` : ""}
        </h1>
        <Link href="/fuel" aria-label="Peebee Gas" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Fuel className="h-6 w-6" aria-hidden />
        </Link>
        <button
          type="button"
          role="switch"
          aria-checked={riderOnline}
          aria-label={t("home_availability")}
          disabled={busy || !online}
          onClick={toggleOnline}
          className={`flex h-14 shrink-0 items-center gap-2 rounded-full pl-4 pr-2 text-base font-bold disabled:opacity-50 ${
            riderOnline ? "bg-green/15 text-green-600" : "bg-[rgb(var(--surface-muted))] text-ink"
          }`}
        >
          {riderOnline ? t("home_online") : t("home_offline")}
          <span aria-hidden className={`flex h-8 w-14 items-center rounded-full p-1 ${riderOnline ? "justify-end bg-green" : "justify-start bg-ink-500"}`}>
            <span className="h-6 w-6 rounded-full bg-white" />
          </span>
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl bg-gold/10 px-4 py-3 text-base text-ink">{error}</p>}

      <div role="tablist" aria-label="Jobs" className="grid grid-cols-2 gap-1 rounded-2xl bg-[rgb(var(--surface-muted))] p-1">
        {([
          { id: "jobs", label: t("nav_jobs"), icon: Briefcase, count: riderOnline ? availableJobs.length + relayLegs.length : 0 },
          { id: "mine", label: t("home_your_jobs"), icon: ClipboardList, count: activeOrders.length },
        ] as const).map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex min-h-14 items-center justify-center gap-2 rounded-xl text-lg font-bold ${tab === id ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"}`}
          >
            <Icon className="h-6 w-6" aria-hidden />
            <span className="truncate">{label}</span>
            {count > 0 && <span className="rounded-full bg-ink/10 px-2 text-sm tabular-nums">{count}</span>}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <section className="space-y-3" role="tabpanel" aria-label={t("home_available_jobs")}>
          {!riderOnline ? (
            <div className="home-card flex flex-col items-center gap-3 py-8 text-center">
              <Power className="h-12 w-12 text-ink-500" aria-hidden />
              <p className="text-lg font-bold text-ink">{t("home_go_online")}</p>
              <button type="button" onClick={toggleOnline} disabled={busy || !online} className={`${bigButton} bg-gold text-ink-gold`}>
                <Power className="h-6 w-6" aria-hidden /> {t("home_online")}
              </button>
            </div>
          ) : (
            <>
              {availableJobs.length > 0 && (
                <div className="flex items-center gap-2">
                  <div role="group" aria-label={t("home_categories")} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                    {(["all", "ride", "parcel", "shopping", "food"] as const).map((cat) => {
                      const Icon = cat === "all" ? LayoutGrid : CATEGORY_ICONS[cat];
                      const count = cat === "all" ? availableJobs.length : categoryCounts[cat];
                      return (
                        <button
                          key={cat}
                          type="button"
                          aria-pressed={categoryFilter === cat}
                          aria-label={`${cat === "all" ? t("home_all") : JOB_CATEGORY_LABELS[cat]} (${count})`}
                          onClick={() => { setCategoryFilter(cat); setPage(0); }}
                          className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
                            categoryFilter === cat ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                          }`}
                        >
                          <Icon className="h-6 w-6" aria-hidden />
                          {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-ink px-1 text-center text-[11px] font-bold leading-5 text-cream">{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={nextSort} aria-label={`${t("home_sort")}: ${SORT_LABELS[sortOrder]}`} className="flex h-14 shrink-0 items-center gap-1.5 rounded-2xl bg-[rgb(var(--surface-muted))] px-3 text-base font-bold text-ink">
                    <ArrowUpDown className="h-5 w-5" aria-hidden /> {SORT_LABELS[sortOrder]}
                  </button>
                </div>
              )}

              {pageNow === 0 && relayLegs.map((leg) => (
                <article key={leg.id} className="home-card space-y-3 !rounded-2xl !p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10 text-ink"><Bus className="h-6 w-6" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-bold text-ink">{leg.vehicle_plate ? `Matatu ${leg.vehicle_plate}` : "Relay pickup"}</span>
                      <span className="flex items-center gap-1 truncate text-sm text-ink-500"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{leg.from_name} → {leg.destination_area ?? leg.to_name} · {leg.distance_km} km</span>
                    </span>
                    <span className="text-xl font-extrabold tabular-nums text-ink">{formatUgx(leg.fee)}</span>
                  </div>
                  <button type="button" onClick={() => claimRelay(leg)} disabled={claimingId === leg.id || !online} className={`${bigButton} bg-gold text-ink-gold`}>
                    <Zap className="h-6 w-6" aria-hidden />
                    {claimingId === leg.id ? t("home_claiming") : !online ? t("home_offline_btn") : t("home_claim_job")}
                  </button>
                  {jobErrors[leg.id] && <p role="alert" className="rounded-lg bg-gold/10 px-3 py-2 text-base text-ink">{jobErrors[leg.id]}</p>}
                </article>
              ))}

              {availableJobs.length === 0 && relayLegs.length === 0 && (
                <div className="home-card flex flex-col items-center gap-2 py-10 text-center">
                  <Briefcase className="h-12 w-12 text-ink-500" aria-hidden />
                  <p className="text-lg font-bold text-ink-500">{t("home_no_jobs")}</p>
                </div>
              )}
              {availableJobs.length > 0 && visibleJobs.length === 0 && (
                <p className="py-6 text-center text-base text-ink-500">
                  {t("home_no_category_jobs", { category: JOB_CATEGORY_LABELS[categoryFilter as JobCategory]?.toLowerCase() ?? "" })}
                </p>
              )}

              {pageJobs.map((job) => {
                const fee = job.delivery_fee ?? job.final_total ?? job.estimated_total;
                const biddable = !!job.bidding && job.matching_mode !== "first_to_claim" && !job.applied && !job.fareOffer;
                const claim = job.matching_mode === "first_to_claim";
                return (
                  <article key={job.id} className="home-card space-y-3 !rounded-2xl !p-3.5">
                    <button type="button" onClick={() => setPreviewJobItem(job)} className="flex w-full items-center gap-3 text-left" aria-label={`${jobTitle(job)} — ${t("home_preview")}`}>
                      <CategoryIcon category={jobCategory(job)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-bold text-ink">{jobTitle(job)}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-ink-500">
                          <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden />{job.distanceKm != null ? `${job.distanceKm} km` : "—"}</span>
                          {(job.stop_count ?? 0) > 0 && <span className="rounded-full bg-gold/15 px-2 text-sm font-bold text-ink">+{job.stop_count}</span>}
                          {(job.bundle_order_count ?? 1) > 1 && <span className="rounded-full bg-gold/15 px-2 text-sm font-bold text-ink">×{job.bundle_order_count}</span>}
                          {job.outOfServiceRange && <TriangleAlert className="h-4 w-4 text-gold" aria-label={t("home_out_of_range")} />}
                        </span>
                      </span>
                      <span className="text-xl font-extrabold tabular-nums text-ink">{formatUgx(fee)}</span>
                    </button>

                    {job.fareOffer && !job.applied && (
                      <FareOfferPanel job={job as AvailableJob & { fareOffer: NonNullable<AvailableJob["fareOffer"]> }} online={online} onChanged={load} />
                    )}

                    {biddable && (
                      <div>
                        <button
                          type="button"
                          aria-expanded={openBid === job.id}
                          onClick={() => setOpenBid(openBid === job.id ? null : job.id)}
                          className="flex min-h-12 w-full items-center gap-2 rounded-xl bg-[rgb(var(--surface-muted))] px-3 text-base font-bold text-ink"
                        >
                          <HandCoins className="h-5 w-5 text-gold" aria-hidden />
                          <span className="flex-1 text-left">{t("bid_your_price")}</span>
                          <span className="tabular-nums">{formatUgx(Number(bids[job.id] ?? job.bidding!.appPrice ?? 0))}</span>
                          {openBid === job.id ? <ChevronUp className="h-5 w-5" aria-hidden /> : <ChevronRight className="h-5 w-5" aria-hidden />}
                        </button>
                        {openBid === job.id && (
                          <div className="mt-2 space-y-1">
                            <input
                              id={`bid-${job.id}`}
                              aria-label={t("bid_your_price")}
                              inputMode="numeric"
                              value={bids[job.id] ?? String(job.bidding!.appPrice ?? "")}
                              onChange={(e) => setBids((prev) => ({ ...prev, [job.id]: e.target.value.replace(/[^\d]/g, "") }))}
                              className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3 text-xl font-bold text-ink outline-none focus:border-gold"
                            />
                            <p className="text-sm text-ink-500">
                              {t("bid_range", { min: formatUgx(job.bidding!.min), max: formatUgx(job.bidding!.max) })}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => (claim ? claimJob(job.id) : applyToJob(job.id))}
                      disabled={claimingId === job.id || (!claim && !!job.applied) || !online}
                      className={`${bigButton} ${!claim && job.applied ? "bg-[rgb(var(--surface-muted))] text-ink-500" : "bg-gold text-ink-gold"}`}
                    >
                      {claim ? <Zap className="h-6 w-6" aria-hidden /> : <Check className="h-6 w-6" aria-hidden />}
                      {claimingId === job.id
                        ? claim ? t("home_claiming") : t("home_applying")
                        : !claim && job.applied
                          ? t("home_applied")
                          : !online
                            ? t("home_offline_btn")
                            : job.fareOffer
                              ? t("offer_accept", { price: formatUgx(job.fareOffer.amount) })
                              : claim ? t("home_claim_job") : t("home_apply")}
                    </button>
                    {jobErrors[job.id] && <p role="alert" className="rounded-lg bg-gold/10 px-3 py-2 text-base text-ink">{jobErrors[job.id]}</p>}
                  </article>
                );
              })}

              {pageCount > 1 && (
                <nav aria-label="Pages" className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setPage(pageNow - 1)} disabled={pageNow === 0} aria-label="Previous" className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink disabled:opacity-30">
                    <ChevronLeft className="h-6 w-6" aria-hidden />
                  </button>
                  <span className="text-lg font-bold tabular-nums text-ink-500">{pageNow + 1} / {pageCount}</span>
                  <button type="button" onClick={() => setPage(pageNow + 1)} disabled={pageNow >= pageCount - 1} aria-label="Next" className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink disabled:opacity-30">
                    <ChevronRight className="h-6 w-6" aria-hidden />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      )}

      {tab === "mine" && (
        <section className="space-y-3" role="tabpanel" aria-label={t("home_your_jobs")}>
          {activeOrders.length === 0 && (
            <div className="home-card flex flex-col items-center gap-2 py-10 text-center">
              <ClipboardList className="h-12 w-12 text-ink-500" aria-hidden />
              <p className="text-lg font-bold text-ink-500">{t("home_no_active_jobs")}</p>
            </div>
          )}
          {activeOrders.map((order) => (
            <Link key={order.id} href={`/jobs/${order.id}`} className="home-card flex items-center gap-3 !rounded-2xl !p-3.5">
              <CategoryIcon category={jobCategory(order)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-ink">{jobTitle(order)}</span>
                <span className="mt-0.5 inline-block rounded-full bg-gold/15 px-3 py-0.5 text-sm font-bold text-ink">{stageLabel(order.stage, order.type, !!order.is_ride)}</span>
              </span>
              <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" aria-hidden />
            </Link>
          ))}
        </section>
      )}

      <StageSavingsCard compact />

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
