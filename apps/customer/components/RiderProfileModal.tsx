"use client";

import type { RiderApplicant, RiderApplicantProfile } from "@peebee/shared";
import { BadgeCheck, MessageCircle, Phone, Star, ThumbsUp, User } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useLanguage, useTranslate } from "../lib/i18n";
import { Modal } from "./Modal";

export function RiderProfileModal({ orderId, applicant, available = true, busy = false, selectionError = null, onChoose, onCall, onChat, onClose }: {
  orderId: string;
  applicant: RiderApplicant;
  /** An applicant can be chosen; a rider who is already matched can only be called or chatted with. */
  available?: boolean;
  busy?: boolean;
  selectionError?: string | null;
  onChoose?: () => void;
  onCall: () => void;
  /** Only for the rider already matched: chat opens once a rider is chosen. */
  onChat?: () => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const { language } = useLanguage();
  const [profile, setProfile] = useState<RiderApplicantProfile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadingMore = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.riderPhotoBlob(applicant.riderId).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPhotoUrl(objectUrl);
    }).catch(() => {});
    return () => {
      mounted.current = false;
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicant.riderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getApplicantProfile(orderId, applicant.riderId).then((data) => {
      if (!cancelled) setProfile(data);
    }).catch((err) => {
      if (!cancelled) setError(errorMessage(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, applicant.riderId, attempt]);

  async function loadMore() {
    if (profile?.nextOffset == null || loadingMore.current) return;
    loadingMore.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getApplicantProfile(orderId, applicant.riderId, profile.nextOffset);
      if (mounted.current) setProfile((previous) => ({
        ...data, reviews: [...(previous?.reviews ?? []), ...data.reviews.filter((review) => !previous?.reviews.some((old) => old.id === review.id))],
      }));
    } catch (err) {
      if (mounted.current) setError(errorMessage(err));
    } finally {
      loadingMore.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  const locale = language === "lg" ? "lg-UG" : "en-UG";
  const date = (value: string) => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  const joined = profile ? date(profile.joinedAt) : null;
  const days = joined ? Math.max(0, Math.floor((Date.now() - joined.getTime()) / 86_400_000)) : 0;

  return (
    <Modal title={t("rider_profile")} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-1.5 text-center">
          {photoUrl ? <Image src={photoUrl} alt={applicant.riderName} width={128} height={128} className="h-32 w-32 shrink-0 rounded-full object-cover ring-4 ring-gold/40" /> : (
            <span className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold ring-4 ring-gold/30"><User className="h-14 w-14" aria-hidden /></span>
          )}
          <h3 className="break-words text-2xl font-extrabold text-ink">{applicant.riderName}</h3>
          {profile?.verified && <p className="flex items-center gap-1 text-sm font-semibold text-green"><BadgeCheck className="h-4 w-4" aria-hidden />{t("rider_verified")}</p>}
          {(profile?.vehicleInfo || profile?.area) && <p className="break-words text-sm text-ink-500">{[profile?.vehicleInfo, profile?.area].filter(Boolean).join(" · ")}</p>}
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {([
            [t("rider_total_rides"), profile ? profile.completed.total.toLocaleString(locale) : "—"],
            [t("rider_distance"), profile ? profile.totalKm.toLocaleString(locale) : "—"],
            [t("rider_rating"), (profile?.avgRating ?? applicant.avgRating) != null ? String(profile?.avgRating ?? applicant.avgRating) : "—"],
            [t("rider_reviews_short"), (profile?.reviewCount ?? applicant.reviewCount).toLocaleString(locale)],
            [t("order_recommends"), (profile?.recommendCount ?? applicant.recommendCount).toLocaleString(locale)],
            [t("rider_days_short"), profile ? days.toLocaleString(locale) : "—"],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-[rgb(var(--surface-muted))] px-1 py-3">
              <dd className="text-xl font-extrabold tabular-nums text-ink">{value}</dd>
              <dt className="mt-0.5 text-xs text-ink-500">{label}</dt>
            </div>
          ))}
        </dl>
        {profile?.bio && (
          <section>
            <h3 className="mb-1 text-sm font-bold text-ink">{t("rider_about")}</h3>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-ink">{profile.bio}</p>
          </section>
        )}
        {profile && <>
          <section>
            <h3 className="mb-3 text-sm font-bold text-ink">{t("rider_completed")} <span className="text-gold">{profile.completed.total}</span></h3>
            <dl className="grid grid-cols-2 gap-2">
              {([
                ["rider_rides", profile.completed.rides], ["rider_parcels", profile.completed.parcels],
                ["rider_food", profile.completed.food], ["rider_shopping", profile.completed.shopping],
              ] as const).map(([label, count]) => <div key={label} className="rounded-xl border border-[var(--border-faint)] p-3">
                <dt className="text-xs text-ink-500">{t(label)}</dt><dd className="mt-1 text-xl font-bold text-ink">{count.toLocaleString(locale)}</dd>
              </div>)}
            </dl>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-ink">{t("rider_reviews")}</h3>
            {profile.reviews.length === 0 && <p className="text-sm text-ink-500">{t("rider_no_reviews")}</p>}
            {profile.reviews.map((review) => <article key={review.id} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1 font-semibold"><Star className="h-3.5 w-3.5 fill-gold text-gold" aria-hidden />{review.rating}/5</span>
                <time className="text-ink-500" dateTime={date(review.createdAt).toISOString()}>{date(review.createdAt).toLocaleDateString(locale)}</time>
              </div>
              {review.comment?.trim() && <p className="whitespace-pre-wrap break-words text-sm text-ink">{review.comment}</p>}
              {review.recommended && <p className="flex items-center gap-1 text-xs text-green"><ThumbsUp className="h-3.5 w-3.5" aria-hidden />{t("order_recommends")}</p>}
            </article>)}
          </section>
        </>}
        {loading && <p role="status" className="text-sm text-ink-500">{t("rider_loading")}</p>}
        {error && <div role="alert" className="text-sm text-red-600"><p>{error}</p><button type="button" className="min-h-11 font-semibold underline" onClick={() => profile ? void loadMore() : setAttempt((value) => value + 1)}>{t("rider_retry")}</button></div>}
        {profile?.nextOffset != null && <button type="button" disabled={loading} onClick={loadMore} className="min-h-11 w-full rounded-full border border-[var(--border-faint)] text-sm font-semibold disabled:opacity-60">{t("rider_more_reviews")}</button>}
        <div className="sticky -bottom-4 space-y-2 border-t border-[var(--border-faint)] bg-cream py-3">
          {onChoose && !available && <p role="status" className="text-sm text-ink-500">{t("rider_unavailable")}</p>}
          {selectionError && <p role="alert" className="text-sm text-red-600">{selectionError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onCall} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--surface-muted))] text-base font-bold text-ink"><Phone className="h-5 w-5" aria-hidden />{t("rider_call")}</button>
            {onChat && <button type="button" onClick={onChat} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--surface-muted))] text-base font-bold text-ink"><MessageCircle className="h-5 w-5" aria-hidden />{t("rider_chat")}</button>}
            {onChoose && <button type="button" onClick={onChoose} disabled={!available || busy} className="min-h-12 flex-[2] rounded-xl bg-gold px-3 text-base font-extrabold text-ink-gold disabled:opacity-60">{busy ? t("order_choosing") : t("order_choose_this_rider")}</button>}
          </div>
          {onChoose && <p className="text-center text-xs text-ink-500">{t("rider_chat_after_choose")}</p>}
        </div>
      </div>
    </Modal>
  );
}
