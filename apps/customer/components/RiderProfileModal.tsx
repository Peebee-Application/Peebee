"use client";

import type { RiderApplicant, RiderApplicantProfile } from "@peebee/shared";
import { BadgeCheck, Star, ThumbsUp, User } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useLanguage, useTranslate } from "../lib/i18n";
import { Modal } from "./Modal";

export function RiderProfileModal({ orderId, applicant, available, busy, selectionError, onChoose, onClose }: {
  orderId: string;
  applicant: RiderApplicant;
  available: boolean;
  busy: boolean;
  selectionError: string | null;
  onChoose: () => void;
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
        <div className="flex items-center gap-3">
          {photoUrl ? <Image src={photoUrl} alt={applicant.riderName} width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" /> : (
            <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"><User className="h-8 w-8" aria-hidden /></span>
          )}
          <div className="min-w-0">
            <h3 className="break-words text-lg font-bold text-ink">{applicant.riderName}</h3>
            {profile?.verified && <p className="flex items-center gap-1 text-xs text-green"><BadgeCheck className="h-4 w-4" aria-hidden />{t("rider_verified")}</p>}
            {profile?.vehicleInfo && <p className="break-words text-sm text-ink-500">{profile.vehicleInfo}</p>}
            {profile?.area && <p className="text-xs text-ink-500">{profile.area}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-500">
          <span className="flex items-center gap-1"><Star className="h-4 w-4 fill-gold text-gold" aria-hidden />{applicant.avgRating ?? "—"} · {t("rider_reviews_count", { count: applicant.reviewCount })}</span>
          <span className="flex items-center gap-1 text-green"><ThumbsUp className="h-4 w-4" aria-hidden />{applicant.recommendCount} {t("order_recommends")}</span>
          <span>{t("rider_comments_count", { count: applicant.commentCount })}</span>
        </div>
        {profile && <>
          <div className="rounded-2xl bg-gold/10 p-3">
            <p className="text-sm font-semibold text-ink">{t("rider_days_on_app", { count: days.toLocaleString(locale) })}</p>
            <p className="text-xs text-ink-500">{t("rider_joined", { date: joined!.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) })}</p>
          </div>
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
          {!available && <p role="status" className="text-sm text-ink-500">{t("rider_unavailable")}</p>}
          {selectionError && <p role="alert" className="text-sm text-red-600">{selectionError}</p>}
          <button type="button" onClick={onChoose} disabled={!available || busy} className="min-h-11 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-60">{busy ? t("order_choosing") : t("order_choose_this_rider")}</button>
        </div>
      </div>
    </Modal>
  );
}
