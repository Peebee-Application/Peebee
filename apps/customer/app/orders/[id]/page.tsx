"use client";

import type { MobileMoneyNetwork, OrderDetail, OrderRating, RiderApplicant, WalletShareReceived } from "@tuma/shared";
import { detectMobileMoneyNetwork, mobileMoneyNetworkLabel } from "@tuma/shared";
import { MapPin, MessageCircle, Star, ThumbsUp, TriangleAlert, User, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomDrawer } from "../../../components/BottomDrawer";
import { FeeProposalVoicePlayer } from "../../../components/FeeProposalVoicePlayer";
import { LiveTrackingMap } from "../../../components/LiveTrackingMap";
import { MobileNumberPicker } from "../../../components/MobileNumberPicker";
import { OrderTimeline } from "../../../components/OrderTimeline";
import { RateDeliveryCard } from "../../../components/RateDeliveryCard";
import { RiderProfileModal } from "../../../components/RiderProfileModal";
import { SwipeToConfirm } from "../../../components/SwipeToConfirm";
import { VoiceNotePlayer } from "../../../components/VoiceNotePlayer";
import { api, errorMessage } from "../../../lib/api";
import { markFeeProposalSeen } from "../../../lib/fee-proposal-seen";
import { useTranslate } from "../../../lib/i18n";
import { formatDateTime, formatDuration, formatUgx, orderTitle, stageLabel } from "../../../lib/order-display";
import { useFreshness } from "../../../lib/use-freshness";
import { useLivePolling } from "../../../lib/use-live-polling";
import { useNetworkStatus } from "../../../lib/use-network-status";

/** Photo + name of the rider handling this order, and (once settled) when it was delivered and how long it took. */
function RiderSummaryCard({
  riderId,
  riderName,
  settled,
  createdAt,
  settledAt,
}: {
  riderId: string;
  riderName: string | null;
  settled: boolean;
  createdAt: string;
  settledAt: string;
}) {
  const t = useTranslate();
  const router = useRouter();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .riderPhotoBlob(riderId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [riderId]);

  return (
    <section className="home-card flex items-center gap-3">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <User className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-ink">{riderName ?? t("order_your_rider")}</span>
        {settled ? (
          <span className="block text-xs text-ink-500">
            {t("order_delivered_took", { when: formatDateTime(settledAt), duration: formatDuration(createdAt, settledAt) })}
          </span>
        ) : (
          <span className="block text-xs text-ink-500">{t("order_your_rider")}</span>
        )}
      </span>
      <button
        type="button"
        onClick={() => router.push(`/chat/${riderId}`)}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs font-bold text-ink"
      >
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {t("order_chat")}
      </button>
    </section>
  );
}

/** For a "customer_selects" order still unmatched — each applicant's distance and track record, and a pick button. */
function ApplicantPicker({ orderId, onSelected }: { orderId: string; onSelected: () => void }) {
  const t = useTranslate();
  const [applicants, setApplicants] = useState<RiderApplicant[]>([]);
  const [profileApplicant, setProfileApplicant] = useState<RiderApplicant | null>(null);
  const selecting = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getApplicants(orderId)
      .then((res) => setApplicants(res.applicants))
      .catch(() => {});
  }, [orderId]);

  useLivePolling(load, 4000, [load]);

  async function choose(riderId: string) {
    if (selecting.current) return;
    selecting.current = true;
    setBusyId(riderId);
    setError(null);
    try {
      await api.selectApplicant(orderId, riderId);
      setProfileApplicant(null);
      onSelected();
    } catch (err) {
      setError(errorMessage(err));
      load();
    } finally {
      selecting.current = false;
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2.5">
      {applicants.length === 0 ? (
      <div className="flex items-center gap-3 py-2">
        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        <p className="text-sm text-ink-500">{t("order_waiting_riders")}</p>
      </div>
      ) : <>
      <p className="text-sm font-semibold text-ink">{t("order_choose_rider")}</p>
      {applicants.map((a) => (
        <div key={a.riderId} className="space-y-1.5 rounded-xl border border-[var(--border-faint)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-ink">{a.riderName}</span>
            {a.distanceKm != null && Number.isFinite(a.distanceKm) && a.distanceKm >= 0 && (
              <span className="text-xs text-ink-500">
                {a.distanceKm < 1
                  ? t("order_distance_under_km")
                  : t("order_distance_about_km", { distance: Math.round(a.distanceKm * 10) / 10 })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-500">
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-gold text-gold" strokeWidth={1.5} aria-hidden />
                {a.avgRating ?? "—"} · {t("rider_reviews_count", { count: a.reviewCount })}
              </span>
              <span className="flex items-center gap-1 text-green">
                <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {a.recommendCount} {t("order_recommends")}
              </span>
              <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{t("rider_comments_count", { count: a.commentCount })}</span>
          </div>
          {a.outOfServiceRange && <p className="text-xs text-gold">{t("order_out_of_range")}</p>}
          <button type="button" onClick={() => setProfileApplicant(a)} aria-haspopup="dialog" className="min-h-11 w-full rounded-full border border-[var(--border-faint)] px-3 text-xs font-semibold text-ink">{t("rider_view_profile")}</button>
          <button
            type="button"
            onClick={() => choose(a.riderId)}
            disabled={busyId !== null}
            className="min-h-11 w-full rounded-full bg-gold px-3 text-xs font-bold text-ink-gold disabled:opacity-60"
          >
            {busyId === a.riderId ? t("order_choosing") : t("order_choose_this_rider")}
          </button>
        </div>
      ))}
      </>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {profileApplicant && <RiderProfileModal
        key={profileApplicant.riderId}
        orderId={orderId}
        applicant={applicants.find((a) => a.riderId === profileApplicant.riderId) ?? profileApplicant}
        available={applicants.some((a) => a.riderId === profileApplicant.riderId)}
        busy={busyId !== null}
        selectionError={error}
        onChoose={() => choose(profileApplicant.riderId)}
        onClose={() => setProfileApplicant(null)}
      />}
    </div>
  );
}

export default function OrderDetailPage() {
  const t = useTranslate();
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msisdn, setMsisdn] = useState("");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [sharedWallets, setSharedWallets] = useState<WalletShareReceived[]>([]);
  const [cancelConfirm, setCancelConfirm] = useState<"cancel" | "delete" | null>(null);
  const [dismissedWaitingNotice, setDismissedWaitingNotice] = useState<string | null>(null);
  const online = useNetworkStatus();
  const { markUpdated, label: staleLabel } = useFreshness();
  const detectedNetwork = useMemo(() => detectMobileMoneyNetwork(msisdn), [msisdn]);
  const matching = useRef(false);

  async function cancelThisOrder() {
    setBusy(true);
    setError(null);
    try {
      await api.customerCancelOrder(orderId, detail?.timeFees?.cancellationDue ?? 0);
      setCancelConfirm(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteThisOrder() {
    setBusy(true);
    setError(null);
    try {
      await api.customerDeleteOrder(orderId);
      router.push("/orders");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  useEffect(() => {
    api
      .getWallet()
      .then((w) => setWalletBalance(w.balance))
      .catch(() => {});
    api
      .getWalletShares()
      .then((s) => setSharedWallets(s.received.filter((r) => r.status === "active")))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const res = await api.getOrder(orderId);
    setDetail(res);
    markUpdated();
    // Opening the order counts as "seen" for the home screen's reminder
    // card even if the customer doesn't act on it here — see
    // lib/fee-proposal-seen.
    const pendingProposal = res.feeProposals.find((f) => f.status === "pending");
    if (pendingProposal) markFeeProposalSeen(pendingProposal.id);
    const pending = res.payments.find((p) => p.status === "pending");
    if (pending) {
      api.refreshPayment(pending.id).catch(() => {});
    }
    return res;
  }, [orderId, markUpdated]);

  useLivePolling(() => void load().catch(() => {}), 4000, [load]);

  // Silently find a rider as soon as an unmatched order lands here, then
  // keep retrying on a fixed 4s cadence until one is found. Depends only on
  // stable primitives (stage, rider_id) rather than `detail` itself —
  // `detail` is a brand-new object on every load(), so keying on it re-fires
  // this effect on every poll tick, and a failed matchOrder's `finally`
  // calling load() would immediately re-trigger another matchOrder with no
  // delay at all: an unbounded, zero-delay retry loop whenever no rider is
  // available yet (this is what took the API down — see incident notes).
  // Also covers a funded order whose rider cancelled — it's left in "Match"
  // with rider_id cleared rather than rewound to "Create", since rewinding
  // would re-expose the funding step after money already moved.
  const stage = detail?.order.stage;
  const riderId = detail?.order.rider_id;
  useEffect(() => {
    if (!detail || riderId || (stage !== "Create" && stage !== "Match")) return;
    let cancelled = false;

    async function attempt() {
      if (matching.current) return;
      matching.current = true;
      try {
        await api.matchOrder(orderId);
      } catch {
        // no rider available yet — the interval below retries in 4s
      } finally {
        matching.current = false;
        if (!cancelled) load().catch(() => {});
      }
    }

    attempt();
    const interval = setInterval(attempt, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, stage, riderId]);

  // Rethrows on failure — several call sites pass these straight to
  // SwipeToConfirm's onConfirm, which only shows its confirmed checkmark
  // once the promise it's given actually resolves. Swallowing the error
  // here (only setting `error` state) would let that control show a false
  // "success" on a failed payment or handover. Fire-and-forget callers
  // (plain onClick handlers, not awaited) must swallow it themselves with
  // `.catch(() => {})` — the error is already surfaced via `error` state.
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function doFund(useWallet = false, walletOwnerId?: string) {
    setBusy(true);
    setError(null);
    try {
      const input =
        detail?.order.payment_rail === "escrow"
          ? useWallet
            ? { useWallet: true, walletOwnerId }
            : { msisdn }
          : {};
      const res = await api.fundOrder(orderId, input);
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <div className="p-4 text-sm text-ink-500">{t("order_loading")}</div>;
  }

  const { order, items, substitutions, feeProposals } = detail;
  const timeFees = detail.timeFees;
  const pendingFeeProposal = feeProposals.find((f) => f.status === "pending");
  const currentItemsTotal = (order.final_total ?? order.estimated_total ?? 0) - (order.delivery_fee ?? 0);
  const pendingPayment = detail.payments.find((p) => p.status === "pending");
  const awaitingRiderOrPayment = ["Create", "Match", "Fund"].includes(order.stage);
  const pendingSubs = substitutions.filter((s) => s.status === "pending");
  // Group by batch so a rider's multi-item edit shows as one card with one
  // approve/reject action; older single-item proposals (no batch_id) each
  // just form a group of their own, decided via the original endpoint.
  const pendingGroups = Object.values(
    pendingSubs.reduce<Record<string, { key: string; batchId: string | null; subs: typeof pendingSubs }>>(
      (groups, sub) => {
        const key = sub.batch_id ?? sub.id;
        (groups[key] ??= { key, batchId: sub.batch_id, subs: [] }).subs.push(sub);
        return groups;
      },
      {},
    ),
  );

  function decideGroup(group: { batchId: string | null; subs: typeof pendingSubs }, approve: boolean) {
    return group.batchId
      ? api.decideSubstitutionBatch(orderId, group.batchId, approve)
      : api.decideSubstitution(orderId, group.subs[0].id, approve);
  }

  function handleRated(newRating: OrderRating) {
    setDetail((prev) => (prev ? { ...prev, rating: newRating } : prev));
  }

  // Nothing has happened yet — no rider assigned, which also means no
  // money's been collected (funding only ever follows a match). Once
  // that's no longer true, backing out affects someone else's day and
  // goes through the API's own "cannot_cancel"/"cannot_delete" refusal
  // (surfaced via the normal error banner) rather than a button here.
  const canCancel = timeFees?.canCancel ?? (!order.rider_id && ["Create", "Match"].includes(order.stage));
  const canDelete = !order.rider_id && ["Create", "Match"].includes(order.stage);

  // Only pop up once the free window is genuinely closing (last 90s) or has
  // just charged — not on every load, and not as a permanent banner.
  const msToWaitingEnd = timeFees?.waitingEndsAt ? Date.parse(timeFees.waitingEndsAt) - Date.now() : null;
  const waitingNoticeKind: "warn" | "due" | null =
    !timeFees || order.stage !== "Arrived"
      ? null
      : timeFees.waitingDue > 0
        ? "due"
        : msToWaitingEnd !== null && msToWaitingEnd > 0 && msToWaitingEnd <= 90_000
          ? "warn"
          : null;
  const waitingNoticeKey = waitingNoticeKind ? `${timeFees?.waitingStartedAt}:${waitingNoticeKind}` : null;
  const showWaitingNotice = waitingNoticeKey !== null && dismissedWaitingNotice !== waitingNoticeKey;

  return (
    <div className="space-y-6 px-4 pb-24 pt-4">
      {showWaitingNotice && (
        <div className="fixed inset-x-4 top-4 z-40 flex items-start gap-2 rounded-2xl border border-gold/30 bg-[rgb(var(--surface))] px-4 py-3 text-sm text-ink shadow-lg">
          <p className="flex-1">
            {waitingNoticeKind === "due"
              ? `Free waiting is over — a ${formatUgx(timeFees!.waitingFee)} fee applies.`
              : "Free waiting time is almost up."}
          </p>
          <button
            type="button"
            onClick={() => setDismissedWaitingNotice(waitingNoticeKey)}
            className="shrink-0 text-ink-500"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-ink">{orderTitle(order)}</h1>
          {canCancel && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setCancelConfirm("cancel")}
                className="rounded-full border border-[var(--border-faint)] px-3 py-1.5 text-xs font-bold text-ink-500"
              >
                {t("order_cancel")}
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setCancelConfirm("delete")}
                  className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600"
                >
                  {t("order_delete")}
                </button>
              )}
            </div>
          )}
        </div>
        <p className={`flex items-center gap-1.5 text-sm font-semibold ${order.stage === "Cancelled" ? "text-red-600" : "text-green"}`}>
          {stageLabel(order.stage, order.type, !!order.is_ride)}
          {staleLabel && (
            <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-[11px] font-medium text-ink-500">
              {t("order_updated")} {staleLabel}
            </span>
          )}
        </p>
        {order.stage === "Cancelled" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t("order_cancelled_note")}</p>
        )}
        {order.type === "parcel" && order.pickup_area && (
          <p className="flex items-center gap-1.5 text-sm text-ink-500">
            <MapPin className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} aria-hidden />
            {order.is_ride ? t("order_pickup_point") : t("order_pickup")}
            {order.pickup_area}
            {order.pickup_address ? ` · ${order.pickup_address}` : ""}
          </p>
        )}
        {order.destination_area && (
          <p className="flex items-center gap-1.5 text-sm text-ink-500">
            <MapPin className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} aria-hidden />
            {order.type === "parcel" ? (order.is_ride ? t("order_destination") : t("order_deliver_to")) : ""}
            {order.destination_area}
            {order.destination_address ? ` · ${order.destination_address}` : ""}
          </p>
        )}
      </header>

      {pendingFeeProposal && (
        <section className="home-card space-y-2 !border-l-4 !border-l-gold">
          <p className="text-sm text-ink">
            {t("order_fee_suggests")}{" "}
            <strong>{formatUgx(pendingFeeProposal.proposed_total - currentItemsTotal)}</strong>{" "}
            <span className="text-ink-500">
              ({t("order_fee_was")} {formatUgx(order.delivery_fee ?? 0)})
            </span>
            <span className="block text-ink-500">{t("order_items_unaffected")}</span>
            {pendingFeeProposal.reason && <span className="block text-ink-500">{pendingFeeProposal.reason}</span>}
          </p>
          {pendingFeeProposal.reason_voice_key && (
            <FeeProposalVoicePlayer orderId={orderId} proposalId={pendingFeeProposal.id} />
          )}
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => run(() => api.decideFeeProposal(orderId, pendingFeeProposal.id, true)).catch(() => {})}
              className="flex-1 rounded-full bg-green px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              {t("order_accept")}
            </button>
            <button
              disabled={busy}
              onClick={() => run(() => api.decideFeeProposal(orderId, pendingFeeProposal.id, false)).catch(() => {})}
              className="flex-1 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs font-bold text-ink disabled:opacity-60"
            >
              {t("order_reject")}
            </button>
          </div>
        </section>
      )}

      <OrderTimeline order={order} events={detail.events} statusLabel={stageLabel(order.stage, order.type)} />

      {order.rider_id && !["Settle", "Handover"].includes(order.stage) && (
        <LiveTrackingMap order={order} events={detail.events} />
      )}

      {order.rider_id && (
        <RiderSummaryCard
          riderId={order.rider_id}
          riderName={order.rider_name}
          settled={order.stage === "Settle"}
          createdAt={order.created_at}
          settledAt={order.updated_at}
        />
      )}

      {order.voice_note_key && <VoiceNotePlayer orderId={orderId} />}

      {!!order.matched_out_of_range && order.rider_id && (
        <div className="flex items-start gap-2 rounded-xl border border-gold bg-gold/10 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
          <p className="text-sm text-ink">{t("order_out_of_range_note")}</p>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {order.type === "shopping" && (
        <section className="home-card space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("order_items_heading")}</h2>
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm text-ink">
                <span>
                  <span className="block">
                    {item.quantity}× {item.name}
                    {item.unit_price != null && (
                      <span className="text-ink-500">
                        {" "}
                        · {t("order_est_each")} {formatUgx(item.unit_price)} {t("order_each")}
                      </span>
                    )}
                  </span>
                  {item.note && <span className="block text-xs text-ink-500">{item.note}</span>}
                </span>
                {item.unit_price != null && (
                  <span className="shrink-0 font-semibold">{formatUgx(item.unit_price * item.quantity)}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-[var(--border-faint)] pt-2 text-sm font-semibold">
            <div className="flex justify-between">
              <span>{t("order_items_total")}</span>
              <span>{formatUgx((order.final_total ?? order.estimated_total ?? 0) - (order.delivery_fee ?? 0))}</span>
            </div>
            <div className="flex justify-between text-ink-500">
              <span>{t("order_delivery_fee")}</span>
              <span>{formatUgx(order.delivery_fee ?? 0)}</span>
            </div>
          </div>
        </section>
      )}

      {order.type === "parcel" && (
        <section className="home-card flex justify-between text-sm font-semibold">
          <span>{order.is_ride ? t("order_fare") : t("order_delivery_fee")}</span>
          <span>{formatUgx(order.delivery_fee ?? order.final_total ?? order.estimated_total)}</span>
        </section>
      )}

      {awaitingRiderOrPayment && (
        <section className="home-card space-y-3">
          {!order.rider_id && order.matching_mode === "customer_selects" ? (
            <ApplicantPicker orderId={orderId} onSelected={() => load()} />
          ) : (
            !order.rider_id && (
              <div className="flex items-center gap-3 py-2">
                <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                <p className="text-sm text-ink-500">{t("order_finding_rider")}</p>
              </div>
            )
          )}

          {order.rider_id && pendingPayment && (
            <div className="flex items-center gap-3 py-2">
              <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              <p className="text-sm text-ink-500">
                {t("order_confirming_payment", {
                  network: mobileMoneyNetworkLabel((pendingPayment?.network as MobileMoneyNetwork | undefined) ?? null),
                })}
              </p>
            </div>
          )}

          {order.rider_id && !pendingPayment && (
            <>
              <p className="text-sm text-ink-500">
                {t("order_rider_ready")}{" "}
                {order.is_ride
                  ? t("order_pay_confirm_ride")
                  : order.type === "parcel"
                    ? t("order_pay_send_parcel")
                    : t("order_pay_send_list")}
              </p>
              {!online && (
                <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs font-semibold text-ink-500">
                  {t("order_offline_pay")}
                </p>
              )}
              {order.payment_rail === "escrow" ? (
                <div className="space-y-3">
                  {walletBalance != null && walletBalance >= (order.final_total ?? order.estimated_total ?? 0) && (
                    <SwipeToConfirm
                      label={`${t("order_slide_pay_wallet")} (${formatUgx(walletBalance)})`}
                      confirmedLabel={t("order_funding_escrow")}
                      onConfirm={() => doFund(true)}
                      disabled={busy || !online}
                    />
                  )}
                  {sharedWallets
                    .filter((w) => w.owner_balance != null && w.owner_balance >= (order.final_total ?? order.estimated_total ?? 0))
                    .map((w) => (
                      <SwipeToConfirm
                        key={w.id}
                        label={t("order_slide_pay_wallet_name", { name: w.owner_name })}
                        confirmedLabel={t("order_funding_escrow")}
                        onConfirm={() => doFund(true, w.owner_id)}
                        disabled={busy || !online}
                      />
                    ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      doFund(false).catch(() => {});
                    }}
                    className="space-y-2 pt-1"
                  >
                    <MobileNumberPicker purpose="payment" value={msisdn} onChange={setMsisdn} />
                    <SwipeToConfirm
                      label={t("order_slide_pay_via", { network: mobileMoneyNetworkLabel(detectedNetwork) })}
                      confirmedLabel={t("order_prompting_phone")}
                      onConfirm={() => doFund(false)}
                      disabled={busy || !online || !msisdn.trim()}
                    />
                  </form>
                </div>
              ) : (
                <SwipeToConfirm
                  label={t("order_slide_confirm_cash")}
                  confirmedLabel={t("order_confirmed")}
                  onConfirm={() => doFund()}
                  disabled={busy || !online}
                />
              )}
            </>
          )}
        </section>
      )}

      {!awaitingRiderOrPayment && (
      <section className="home-card space-y-3">
        {(order.stage === "Shop" || order.stage === "Substitute") && (
          <>
            <p className="text-sm text-ink-500">
              {order.is_ride
                ? t("order_rider_ready_ride")
                : order.type === "parcel"
                  ? t("order_rider_picking_up")
                  : t("order_rider_shopping")}
            </p>
            {pendingGroups.length > 0 && (
              <ul className="space-y-2">
                {pendingGroups.map((group) => {
                  const netDelta = group.subs.reduce((sum, s) => sum + s.price_delta, 0);
                  return (
                    <li key={group.key} className="rounded-xl border border-[var(--border-faint)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        {t("order_rider_proposed_change")}
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {group.subs.map((sub) => (
                          <li key={sub.id} className="text-sm text-ink">
                            <strong>{sub.original_name}</strong> → <strong>{sub.substitute_name}</strong>
                            {sub.price_delta !== 0 && (
                              <span className="text-ink-500">
                                {" "}
                                ({sub.price_delta > 0 ? "+" : ""}
                                {formatUgx(sub.price_delta)})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {group.subs.length > 1 && (
                        <p className="mt-1.5 text-sm font-semibold text-ink">
                          {t("order_net_change")} {netDelta >= 0 ? "+" : ""}
                          {formatUgx(netDelta)}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => run(() => decideGroup(group, true)).catch(() => {})}
                          className="flex-1 rounded-full bg-green px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                        >
                          {t("order_approve")}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => run(() => decideGroup(group, false)).catch(() => {})}
                          className="flex-1 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs font-bold text-ink disabled:opacity-60"
                        >
                          {t("order_reject")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {order.stage === "Approve" && <p className="text-sm text-ink-500">{t("order_waiting_start_delivery")}</p>}

        {!!order.is_ride && order.stage === "Deliver" && (
          <p className="text-sm text-ink-500">
            {t("order_heading_to_pickup")}
            {order.eta_minutes ? ` — ~${order.eta_minutes} min` : ""}.
          </p>
        )}

        {!!order.is_ride && order.stage === "Arrived" && (
          <p className="text-sm text-ink-500">{t("order_rider_here")}</p>
        )}

        {(!order.is_ride
          ? order.stage === "Deliver" || order.stage === "Arrived"
          : order.stage === "PickedUp") && (
          <>
            <p className="text-sm text-ink-500">
              {order.is_ride
                ? t("order_on_way_destination")
                : order.stage === "Arrived"
                  ? t("order_rider_arrived")
                  : `${t("order_rider_on_way")}${order.eta_minutes ? ` — ~${order.eta_minutes} min` : ""}.`}
            </p>
            {order.pin_code && (
              <div className="rounded-xl bg-gold/10 p-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {order.is_ride ? t("order_trip_pin") : t("order_handover_pin")}
                </p>
                <p className="text-2xl font-bold tracking-[0.3em] text-ink">{order.pin_code}</p>
              </div>
            )}
            <div className="pt-2">
              <SwipeToConfirm
                label={order.is_ride ? t("order_slide_complete_trip") : t("order_slide_confirm_received")}
                confirmedLabel={t("order_handover_confirmed")}
                onConfirm={() => run(() => api.handoverOrder(orderId, order.pin_code as string))}
                disabled={busy}
              />
            </div>
          </>
        )}

        {order.stage === "Handover" && (
          <p className="text-sm text-ink-500">
            {order.is_ride ? t("order_trip_confirmed_note") : t("order_handover_confirmed_note")}
          </p>
        )}

        {order.stage === "Settle" && (
          <RateDeliveryCard orderId={orderId} rating={detail.rating} onRated={handleRated} />
        )}
      </section>
      )}

      <BottomDrawer
        isOpen={cancelConfirm !== null}
        onClose={() => setCancelConfirm(null)}
        title={cancelConfirm === "delete" ? t("order_delete_title") : t("order_cancel_title")}
      >
        <p className="text-sm text-ink-500">
          {cancelConfirm === "delete"
            ? t("order_delete_note")
            : timeFees?.cancellationDue
              ? `Your rider has already started the journey. Cancelling now will charge ${formatUgx(timeFees.cancellationDue)} from your main wallet. If your wallet is empty, it will show as money owed and your next top-up will clear it.`
              : t("order_cancel_note")}
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCancelConfirm(null)}
            disabled={busy}
            className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-60"
          >
            {t("order_never_mind")}
          </button>
          <button
            type="button"
            onClick={cancelConfirm === "delete" ? deleteThisOrder : cancelThisOrder}
            disabled={busy}
            className="min-h-11 flex-1 rounded-full bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? t("order_working") : cancelConfirm === "delete" ? t("order_delete_order") : t("order_cancel_order")}
          </button>
        </div>
      </BottomDrawer>
    </div>
  );
}
