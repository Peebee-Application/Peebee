"use client";
import type { RiderApplicant } from "@peebee/shared";
import { MessageCircle, Star, ThumbsUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { RiderProfileModal } from "./RiderProfileModal";
import { api, errorMessage } from "../lib/api";
import { useTranslate } from "../lib/i18n";
import { formatUgx } from "../lib/order-display";
import { useLivePolling } from "../lib/use-live-polling";

/** For a "customer_selects" order still unmatched — each applicant's distance and track record, and a pick button. */
export function ApplicantPicker({ orderId, onSelected }: { orderId: string; onSelected: () => void }) {
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
      {applicants.map((a, index) => (
        <div key={a.riderId} className="space-y-1.5 rounded-xl border border-[var(--border-faint)] p-3">
          {a.price != null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-extrabold text-ink">{formatUgx(a.price)}</span>
              <span className="flex items-center gap-1.5 text-xs">
                {a.appPrice != null && a.price !== a.appPrice && (
                  <span className={a.price < a.appPrice ? "font-semibold text-green" : "text-ink-500"}>
                    {a.price < a.appPrice
                      ? t("bid_you_save", { amount: formatUgx(a.appPrice - a.price) })
                      : t("bid_more", { amount: formatUgx(a.price - a.appPrice) })}
                  </span>
                )}
                {index === 0 && applicants.length > 1 && <span className="rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold">{t("bid_best_price")}</span>}
              </span>
            </div>
          )}
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

