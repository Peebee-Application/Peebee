"use client";

import type { RiderApplicant } from "@peebee/shared";
import { Phone, Star, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { RiderProfileModal } from "../RiderProfileModal";
import { api, errorMessage } from "../../lib/api";
import { useCalls } from "../../lib/calls-context";
import { useTranslate } from "../../lib/i18n";
import { formatUgx } from "../../lib/order-display";
import { useLivePolling } from "../../lib/use-live-polling";

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "P";

/**
 * The riders who said yes, for a ride where the customer picks. Each one is a card like the live-trip card (who they are,
 * how far, how good, what they ask) with a button to choose them. New riders appear as they apply; there is no
 * share-trip here, because there is no trip yet. Choosing one goes straight to payment.
 */
export function RideApplicants({ orderId, kind, onSelected }: { orderId: string; kind: string; onSelected: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  const { startCall } = useCalls();
  const [applicants, setApplicants] = useState<RiderApplicant[]>([]);
  const [profile, setProfile] = useState<RiderApplicant | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selecting = useRef(false);

  const load = useCallback(() => {
    api.getApplicants(orderId).then((res) => setApplicants(res.applicants)).catch(() => {});
  }, [orderId]);
  useLivePolling(load, 4000, [load]);

  async function choose(riderId: string) {
    if (selecting.current) return;
    selecting.current = true;
    setBusyId(riderId);
    setError(null);
    try {
      await api.selectApplicant(orderId, riderId);
      setProfile(null);
      onSelected();
      // Chosen: the next step is paying to confirm.
      router.push(`/orders/${orderId}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      load();
    } finally {
      selecting.current = false;
      setBusyId(null);
    }
  }

  const btn = "ride-trip-card__btn flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold";
  return (
    <section aria-label={`${kind} riders who can take your ride`} aria-live="polite" className="space-y-3">
      {applicants.length === 0 && <p className="px-1 text-sm text-ink-500">{t("order_waiting_riders")}</p>}
      {applicants.length > 0 && <p className="px-1 text-sm font-semibold text-ink-500">{t("order_choose_rider")}</p>}
      {applicants.map((a, index) => {
        const first = a.riderName.split(" ")[0] || a.riderName;
        const facts = [
          a.avgRating != null ? String(a.avgRating) : null,
          a.reviewCount > 0 ? t("rider_reviews_count", { count: a.reviewCount }) : null,
          a.distanceKm != null && Number.isFinite(a.distanceKm) && a.distanceKm >= 0
            ? (a.distanceKm < 1 ? t("order_distance_under_km") : t("order_distance_about_km", { distance: Math.round(a.distanceKm * 10) / 10 }))
            : null,
        ].filter(Boolean).join(" · ");
        return (
          <article key={a.riderId} className="ride-trip-card relative overflow-hidden rounded-[22px] p-3.5">
            <div className="flex items-center gap-3">
              <span className="ride-trip-card__avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold" aria-hidden>{initials(a.riderName)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{a.riderName}</span>
                <span className="flex items-start gap-1 text-xs text-ink-500">
                  {a.avgRating != null && <Star className="h-3.5 w-3.5 shrink-0 fill-gold text-gold" strokeWidth={1.5} aria-hidden />}
                  <span className="truncate">{facts || t("rider_view_profile")}</span>
                </span>
              </span>
              {a.price != null && (
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-extrabold tabular-nums text-ink">{formatUgx(a.price)}</span>
                  {index === 0 && applicants.length > 1 && <span className="block text-[10px] font-bold uppercase tracking-wide text-gold">{t("bid_best_price")}</span>}
                </span>
              )}
            </div>
            {a.outOfServiceRange && <p className="mt-2 text-xs text-gold">{t("order_out_of_range")}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void choose(a.riderId)}
                disabled={busyId !== null}
                className="flex min-h-11 flex-[2] items-center justify-center rounded-xl bg-gold px-3 text-sm font-extrabold text-ink-gold disabled:opacity-60"
              >
                {busyId === a.riderId ? t("order_choosing") : `${t("order_choose_this_rider")}`}
              </button>
              <button type="button" onClick={() => startCall({ calleeId: a.riderId, orderId })} aria-label={`Call ${first}`} className={btn}><Phone className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => setProfile(a)} aria-haspopup="dialog" aria-label={t("rider_view_profile")} className={btn}><UserRound className="h-4 w-4" aria-hidden /></button>
            </div>
          </article>
        );
      })}
      {error && <p role="alert" className="px-1 text-sm text-red-600">{error}</p>}
      {profile && (
        <RiderProfileModal
          key={profile.riderId}
          orderId={orderId}
          applicant={applicants.find((a) => a.riderId === profile.riderId) ?? profile}
          available={applicants.some((a) => a.riderId === profile.riderId)}
          busy={busyId !== null}
          selectionError={error}
          onChoose={() => void choose(profile.riderId)}
          onClose={() => setProfile(null)}
        />
      )}
    </section>
  );
}
