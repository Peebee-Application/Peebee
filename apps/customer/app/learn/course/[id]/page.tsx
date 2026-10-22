"use client";

import type { CohortInfo, CourseOffers, CourseReview, LearnerCourse, LearnerLesson } from "@peebee/shared";
import { ApiError } from "@peebee/shared";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import { Award, CheckCircle2, ChevronRight, Lock, MessageCircle, Play, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KIND_ICON, KIND_LABEL, metaLine } from "../../../../components/learn/kinds";
import { api, errorMessage } from "../../../../lib/api";
import { BackChip, ErrorNote, LearnScreen, Pill, Skeleton, card, cardLink, displayFont, eyebrow, primaryBtn } from "../../ui";

const ugx = (n: number) => (n > 0 ? `UGX ${n.toLocaleString("en-UG")}` : "Free");

type Preview = { title: string; summary: string; priceUgx: number; schoolName: string; outcomes: string[]; lessonCount: number };

function Ring({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Class progress">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-[rgb(var(--surface-muted))]" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} className="stroke-gold" style={{ transition: "stroke-dashoffset .9s ease" }} />
      </svg>
      <span className={`${displayFont} absolute inset-0 flex items-center justify-center text-sm font-bold text-ink`}>{percent}%</span>
    </div>
  );
}

function Row({ courseId, lesson }: { courseId: string; lesson: LearnerLesson }) {
  const Icon = KIND_ICON[lesson.contentType];
  const assessment = lesson.contentType === "quiz" || lesson.contentType === "exam";
  if (lesson.locked) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 opacity-60" aria-disabled="true">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgb(var(--surface-muted))] text-ink-500">
          <Lock className="h-5 w-5" aria-label="Locked" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{lesson.title}</span>
          <span className="block truncate text-xs text-ink-500">{lesson.locked.message}</span>
        </span>
      </div>
    );
  }
  return (
    <Link href={`/learn/course/${courseId}/lesson/${lesson.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-[rgb(var(--surface-muted))]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] ${lesson.completed ? "bg-green/15 text-green" : assessment ? "bg-gold/20 text-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>
        {lesson.completed ? <CheckCircle2 className="h-5 w-5" aria-label="Done" /> : <Icon className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">{lesson.title}</span>
        <span className="block truncate text-xs text-ink-500">
          {KIND_LABEL[lesson.contentType]} · {metaLine(lesson)}
          {lesson.bestScorePercent !== null && assessment ? ` · best ${lesson.bestScorePercent}%` : ""}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
    </Link>
  );
}

export default function LearnCoursePage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<LearnerCourse | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolError, setEnrolError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [prerequisite, setPrerequisite] = useState<{ id: string; title: string } | null>(null);
  const [offers, setOffers] = useState<CourseOffers>({ bundles: [], plans: [] });
  const [rating, setRating] = useState<{ average: number | null; count: number }>({ average: null, count: 0 });
  const [reviews, setReviews] = useState<CourseReview[]>([]);
  const [cohorts, setCohorts] = useState<CohortInfo[]>([]);
  const [cohortId, setCohortId] = useState("");
  const [myStars, setMyStars] = useState(0);
  const [myReview, setMyReview] = useState("");
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<{ valid: boolean; message?: string; discountUgx: number; finalUgx: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.learnCourse(id);
      setCourse(res.course);
      setPreview(null);
      setError(null);
    } catch (err) {
      setCourse(null);
      if (err instanceof ApiError && err.status === 403) {
        try {
          const info = await api.getCatalogCourse(id);
          const c = info.course;
          setPrerequisite(c.prerequisite ?? null);
          setOffers({ bundles: c.bundles ?? [], plans: c.plans ?? [] });
          setRating(c.rating ?? { average: null, count: 0 });
          setReviews(c.reviews ?? []);
          setCohorts(c.cohorts ?? []);
          setPreview({ title: c.title, summary: c.summary, priceUgx: c.priceUgx, schoolName: c.schoolName, outcomes: c.outcomes, lessonCount: c.modules.reduce((n, m) => n + m.lessons.length, 0) });
          setError(null);
        } catch (inner) {
          setError(errorMessage(inner));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function enrol() {
    setBusy(true);
    setEnrolError(null);
    setNeedsFunds(false);
    try {
      await api.learnEnroll(id, { ...(quote?.valid ? { coupon } : {}), ...(cohortId ? { cohortId } : {}) });
      setLoaded(false);
      await load();
    } catch (err) {
      setEnrolError(errorMessage(err));
      setNeedsFunds(err instanceof ApiError && err.status === 402);
    } finally {
      setBusy(false);
    }
  }

  async function sendReview() {
    setReviewNote(null);
    try {
      await api.learnSaveReview(id, myStars, myReview);
      setReviewNote("Thank you for your review!");
    } catch (err) {
      setReviewNote(errorMessage(err));
    }
  }

  async function applyCoupon() {
    if (!coupon.trim()) return;
    setEnrolError(null);
    try {
      setQuote(await api.learnQuote(id, coupon.trim()));
    } catch (err) {
      setEnrolError(errorMessage(err));
    }
  }

  async function buy(kind: "bundle" | "plan", targetId: string) {
    setBusy(true);
    setEnrolError(null);
    setNeedsFunds(false);
    try {
      if (kind === "bundle") await api.learnBuyBundle(targetId);
      else await api.learnSubscribe(targetId);
      setLoaded(false);
      await load();
    } catch (err) {
      setEnrolError(errorMessage(err));
      setNeedsFunds(err instanceof ApiError && err.status === 402);
    } finally {
      setBusy(false);
    }
  }

  const items = useMemo(() => course?.modules.flatMap((m) => m.lessons) ?? [], [course]);
  const resume = items.find((l) => !l.completed && !l.locked) ?? items.find((l) => !l.locked) ?? null;
  const started = items.some((l) => l.completed);
  const allDone = items.length > 0 && items.every((l) => l.completed);

  if (!loaded) return <LearnScreen><Skeleton className="h-64" /></LearnScreen>;

  return (
    <LearnScreen>
      <BackChip href="/learn/my" label="My class" />

      {error && <ErrorNote>{error}</ErrorNote>}

      {preview && (
        <section className={`${card} space-y-4 overflow-hidden`}>
          <LearnThumb src={api.learnArtUrl("course", id)} ratio="15 / 9" className="max-w-none" />
          <div className="space-y-4 px-5 pb-5">
            <div className="space-y-1">
              <p className={eyebrow}>{preview.schoolName}</p>
              <h1 className={`${displayFont} text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink`}>{preview.title}</h1>
              {preview.summary && <p className="text-sm text-ink-500">{preview.summary}</p>}
            </div>
            {preview.outcomes.length > 0 && (
              <ul className="space-y-1.5 text-sm text-ink">
                {preview.outcomes.map((o) => (
                  <li key={o} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" aria-hidden /> <span>{o}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-center gap-1.5 text-xs text-ink-500">
              <Lock className="h-3.5 w-3.5" aria-hidden /> {preview.lessonCount} items unlock when you enrol
            </p>
            {prerequisite && (
              <p className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-ink">
                Before you join, finish{" "}
                <Link href={`/learn/course/${prerequisite.id}`} className="font-semibold underline">
                  {prerequisite.title}
                </Link>
                .
              </p>
            )}
            {enrolError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {enrolError}{" "}
                {needsFunds && (
                  <Link href="/wallet" className="font-semibold underline">
                    Open your wallet
                  </Link>
                )}
              </p>
            )}
            {rating.count > 0 && (
              <p className="flex items-center gap-1 text-sm font-semibold text-ink">
                <Star className="h-4 w-4 fill-gold text-gold" aria-hidden /> {rating.average} <span className="text-xs font-normal text-ink-500">({rating.count} review{rating.count === 1 ? "" : "s"})</span>
              </p>
            )}
            {reviews.length > 0 && (
              <ul className="space-y-2" aria-label="Reviews">
                {reviews.slice(0, 3).map((r, i) => (
                  <li key={i} className="rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink">
                    <span className="font-semibold">{r.name}</span> · {"★".repeat(r.rating)}
                    {r.body && <span className="block text-ink-500">{r.body}</span>}
                    {r.reply && <span className="mt-1 block text-ink-500">Tutor: {r.reply}</span>}
                  </li>
                ))}
              </ul>
            )}
            {cohorts.length > 0 && (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-bold uppercase tracking-wider text-ink-500">Choose your start date</legend>
                {cohorts.map((h) => (
                  <label key={h.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm ${cohortId === h.id ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"}`}>
                    <input type="radio" name="cohort" checked={cohortId === h.id} onChange={() => setCohortId(h.id)} className="accent-[rgb(var(--color-gold))]" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{h.name}</span>
                      <span className="block text-xs text-ink-500">Starts {new Date(h.startsAt).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" })}{h.seatsLeft !== null ? ` · ${h.seatsLeft} seat${h.seatsLeft === 1 ? "" : "s"} left` : ""}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {preview.priceUgx > 0 && (
              <div className="space-y-1.5">
                <div className="field-box flex items-center gap-2 rounded-xl px-3 py-1.5 border border-[var(--border-faint)]">
                  <input aria-label="Coupon code" value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setQuote(null); }} placeholder="Coupon code" maxLength={40} className="min-w-0 flex-1 text-sm" />
                  <button type="button" onClick={applyCoupon} className="shrink-0 text-xs font-bold text-gold">Apply</button>
                </div>
                {quote && (quote.valid ? <p className="text-xs font-semibold text-green">Coupon applied: you save {ugx(quote.discountUgx)}.</p> : <p className="text-xs text-red-600 dark:text-red-400">{quote.message}</p>)}
              </div>
            )}
            <button type="button" onClick={enrol} disabled={busy} className={`${primaryBtn} w-full`}>
              {busy ? "Enrolling…" : preview.priceUgx > 0 ? `Enrol for ${ugx(quote?.valid ? quote.finalUgx : preview.priceUgx)} from your wallet` : "Enrol for free"}
            </button>
            {(offers.bundles.length > 0 || offers.plans.length > 0) && (
              <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Better value</p>
                {offers.bundles.map((b) => (
                  <button key={b.id} type="button" disabled={busy} onClick={() => void buy("bundle", b.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border-faint)] px-3.5 py-3 text-left text-sm disabled:opacity-50">
                    <span className="min-w-0"><span className="block truncate font-semibold text-ink">{b.title}</span><span className="block text-xs text-ink-500">{b.courseCount} courses together</span></span>
                    <span className="shrink-0 font-bold text-gold">{ugx(b.priceUgx)}</span>
                  </button>
                ))}
                {offers.plans.map((p) => (
                  <button key={p.id} type="button" disabled={busy} onClick={() => void buy("plan", p.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border-faint)] px-3.5 py-3 text-left text-sm disabled:opacity-50">
                    <span className="min-w-0"><span className="block truncate font-semibold text-ink">{p.title}</span><span className="block text-xs text-ink-500">Every course of this school for {p.days} days</span></span>
                    <span className="shrink-0 font-bold text-gold">{ugx(p.priceUgx)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {course && (
        <>
          <header className={`${card} overflow-hidden`}>
            <div className="relative">
              <LearnThumb src={api.learnArtUrl("course", id)} ratio="15 / 9" className="max-w-none" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" aria-hidden />
            </div>
            <div className="relative space-y-4 p-4">
              <span className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gold/25 blur-2xl" aria-hidden />
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className={eyebrow}>{course.schoolName}</p>
                  <h1 className={`${displayFont} text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink`}>{course.title}</h1>
                </div>
                <Ring percent={course.progressPercent} />
              </div>
              {course.summary && <p className="text-sm text-ink-500">{course.summary}</p>}
              <p className="text-xs text-ink-500">
                {course.modules.length} section{course.modules.length === 1 ? "" : "s"} · {items.length} item{items.length === 1 ? "" : "s"}
              </p>
            </div>
          </header>

          {course.certificateId && (
            <Link href={`/learn/certificates/${course.certificateId}`} className="relative flex items-center gap-3 overflow-hidden rounded-[20px] border border-gold/40 bg-[linear-gradient(145deg,rgb(var(--color-gold)/0.2),rgb(var(--color-gold)/0.06))] p-4">
              <span className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-gold/30 blur-2xl" aria-hidden />
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold/25 text-gold ring-1 ring-gold/40"><Award className="h-5 w-5" aria-hidden /></span>
              <span className="relative min-w-0 flex-1">
                <span className={`${displayFont} block text-[15px] font-bold text-ink`}>You finished this class!</span>
                <span className="block text-xs text-ink-500">View your certificate</span>
              </span>
              <ChevronRight className="h-4 w-4 text-ink-500" aria-hidden />
            </Link>
          )}

          <Link href={`/learn/course/${id}/discuss`} className={`${cardLink} flex items-center gap-3 p-4`}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gold/15 text-gold"><MessageCircle className="h-5 w-5" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className={`${displayFont} block text-[15px] font-semibold text-ink`}>Questions and announcements</span><span className="block text-xs text-ink-500">Ask your tutor and classmates</span></span>
            <ChevronRight className="h-4 w-4 text-ink-500" aria-hidden />
          </Link>

          {items.length === 0 && <p className="text-sm text-ink-500">This class has no lessons yet.</p>}

          {course.modules.map((m, mi) => {
            const done = m.lessons.filter((l) => l.completed).length;
            return (
              <section key={m.id} aria-label={m.title} className={`${card} overflow-hidden`}>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-faint)] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Section {mi + 1}</p>
                    <h2 className={`${displayFont} truncate text-base font-semibold text-ink`}>{m.title}</h2>
                    {m.opensAt && <p className="text-xs text-ink-500">Opens {new Date(m.opensAt).toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short" })}</p>}
                  </div>
                  <Pill tone={done === m.lessons.length && done > 0 ? "green" : "muted"}>
                    {done}/{m.lessons.length}
                  </Pill>
                </div>
                <div className="divide-y divide-[var(--border-faint)]">
                  {m.lessons.map((l) => (
                    <Row key={l.id} courseId={id} lesson={l} />
                  ))}
                </div>
              </section>
            );
          })}

          {!course.certificateId && started && (
            <section className={`${card} space-y-2.5 p-4`} aria-label="Rate this class">
              <p className={`${displayFont} text-[15px] font-semibold text-ink`}>How is this class?</p>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={myStars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setMyStars(n)}>
                    <Star className={`h-7 w-7 ${n <= myStars ? "fill-gold text-gold" : "text-ink-500"}`} />
                  </button>
                ))}
              </div>
              <textarea aria-label="Your review" rows={2} value={myReview} onChange={(e) => setMyReview(e.target.value)} maxLength={1500} placeholder="Say a little about it (optional)" className="w-full rounded-2xl border border-[var(--border-faint)] px-3.5 py-2.5 text-sm" />
              <button type="button" disabled={myStars === 0} onClick={sendReview} className={primaryBtn}>Send review</button>
              {reviewNote && <p className="text-xs text-ink-500">{reviewNote}</p>}
            </section>
          )}

          {resume && (
            <div className="fixed inset-x-0 bottom-24 z-30 px-4">
              <Link href={`/learn/course/${id}/lesson/${resume.id}`} className={`${primaryBtn} mx-auto flex w-full max-w-2xl !rounded-full !py-4 !text-base`}>
                <Play className="h-4 w-4" aria-hidden /> {allDone ? "Review from the start" : started ? "Continue" : "Start learning"}
              </Link>
            </div>
          )}
        </>
      )}
    </LearnScreen>
  );
}
