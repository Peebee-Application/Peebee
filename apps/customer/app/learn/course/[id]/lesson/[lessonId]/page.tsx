"use client";

import type { LearnerCourse, LearnerLessonDetail } from "@peebee/shared";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, MessageCircle, Radio } from "lucide-react";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssignmentView } from "../../../../../../components/learn/AssignmentView";
import { AudioPlayer } from "../../../../../../components/learn/AudioPlayer";
import { KIND_ICON, KIND_LABEL, whenLabel } from "../../../../../../components/learn/kinds";
import { QuizRunner } from "../../../../../../components/learn/QuizRunner";
import { SlideDeck } from "../../../../../../components/learn/SlideDeck";
import { Ambient } from "../../../../ui";
import { bodyFont, display, monoFont } from "../../../../fonts";
import { api, errorMessage } from "../../../../../../lib/api";

function Media({ lesson, onEnded }: { lesson: LearnerLessonDetail; onEnded: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!lesson.hasMedia) return;
    let cancelled = false;
    api
      .learnLessonMediaUrl(lesson.id)
      .then((r) => !cancelled && setUrl(r.url))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [lesson.id, lesson.hasMedia]);

  if (error) return <p role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-ink">{error}</p>;
  if (lesson.hasMedia && !url) return <div className="aspect-video w-full animate-pulse rounded-3xl bg-[rgb(var(--surface-muted))]" />;
  if (url && lesson.contentType === "audio") return <AudioPlayer src={url} art={<LearnThumb src={api.learnArtUrl("lesson", lesson.id)} />} onEnded={onEnded} />;
  if (url) return <video controls playsInline preload="metadata" src={url} onEnded={onEnded} className="aspect-video w-full rounded-3xl bg-black" />;
  return null;
}

function Live({ lesson, onJoined }: { lesson: LearnerLessonDetail; onJoined: () => void }) {
  const live = lesson.live!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.learnJoinLive(lesson.id);
      window.open(res.url, "_blank", "noopener,noreferrer");
      onJoined();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center shadow-sm">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 text-gold">
        <Radio className="h-8 w-8" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-gold">Live video lesson</p>
        <p className="text-xl font-bold text-ink">{whenLabel(live.startsAt)}</p>
        <p className="text-sm text-ink-500">{live.durationMinutes} minutes</p>
      </div>
      {live.notes && <p className="whitespace-pre-line text-sm text-ink">{live.notes}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="button" onClick={join} disabled={busy || !live.joinOpen} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gold px-4 py-4 text-base font-bold text-ink-gold disabled:opacity-50">
        {live.joinOpen ? (busy ? "Opening…" : lesson.completed ? "Join again" : "Join now") : Date.parse(live.startsAt) > Date.now() ? "Opens shortly before the start" : "This lesson has finished"}
        {live.joinOpen && <ExternalLink className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

export default function LessonPage() {
  const { id, lessonId } = useParams<{ id: string; lessonId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<LearnerCourse | null>(null);
  const [lesson, setLesson] = useState<LearnerLessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [c, l] = await Promise.all([api.learnCourse(id), api.learnLesson(lessonId)]);
    setCourse(c.course);
    setLesson(l.lesson);
  }, [id, lessonId]);

  useEffect(() => {
    setLesson(null);
    setError(null);
    refresh().catch((err) => setError(errorMessage(err)));
  }, [refresh]);

  const items = useMemo(() => course?.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, section: m.title }))) ?? [], [course]);
  const at = items.findIndex((i) => i.id === lessonId);
  const prev = at > 0 ? items[at - 1] : null;
  const next = at >= 0 && at < items.length - 1 ? items[at + 1] : null;
  const href = (itemId: string) => `/learn/course/${id}/lesson/${itemId}`;
  const goNext = () => router.push(next ? href(next.id) : `/learn/course/${id}`);

  const complete = useCallback(async () => {
    try {
      await api.learnCompleteLesson(lessonId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [lessonId, refresh]);

  async function markAndContinue() {
    setBusy(true);
    try {
      if (!lesson?.completed) await api.learnCompleteLesson(lessonId);
      goNext();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const Icon = lesson ? KIND_ICON[lesson.contentType] : null;
  const assessment = lesson?.contentType === "quiz" || lesson?.contentType === "exam";
  const needsButton = lesson && !assessment && lesson.contentType !== "live" && lesson.contentType !== "assignment";

  return (
    <div className={`${display.variable} ${bodyFont.variable} ${monoFont.variable} fixed inset-0 z-50 isolate flex flex-col overflow-hidden bg-[rgb(var(--color-cream))] font-[family-name:var(--font-lh-body)]`}>
      <Ambient />
      <header className="flex items-center gap-2.5 border-b border-[var(--border-faint)] bg-[rgb(var(--color-cream)/0.7)] px-3 pb-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
        <Link href={`/learn/course/${id}`} aria-label="Back to the class" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{items[at]?.section ?? course?.title ?? ""}</p>
          <p className="truncate font-[family-name:var(--font-lh-display)] text-sm font-semibold text-ink">{lesson?.title ?? "Loading…"}</p>
        </div>
        <Link href={`/learn/course/${id}/discuss?lesson=${lessonId}`} aria-label="Ask a question about this lesson" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink">
          <MessageCircle className="h-5 w-5" aria-hidden />
        </Link>
        {lesson?.completed && <CheckCircle2 className="h-5 w-5 shrink-0 text-green" aria-label="Completed" />}
      </header>
      {course && (
        <div className="h-1 bg-[rgb(var(--surface-muted))]" role="progressbar" aria-valuenow={course.progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Class progress">
          <div className="h-full bg-[linear-gradient(90deg,rgb(var(--color-gold)/0.7),rgb(var(--color-gold)))] transition-all" style={{ width: `${course.progressPercent}%` }} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-2xl space-y-5 p-4 pb-8">
          {error && <p role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-ink">{error}</p>}
          {!lesson && !error && <div className="h-64 animate-pulse rounded-3xl bg-[rgb(var(--surface-muted))]" />}
          {lesson && Icon && (
            <>
              {lesson.contentType === "assignment" && lesson.assignment && <AssignmentView lesson={lesson} onChanged={() => void refresh()} />}

              {!assessment && lesson.contentType !== "assignment" && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {KIND_LABEL[lesson.contentType]} · {lesson.durationMinutes} min
                  </p>
                  <h1 className="font-[family-name:var(--font-lh-display)] text-[26px] font-bold leading-[1.1] tracking-[-0.02em] text-ink">{lesson.title}</h1>
                </div>
              )}

              {(lesson.contentType === "video" || lesson.contentType === "audio") && (
                <>
                  <Media lesson={lesson} onEnded={() => !lesson.completed && void complete()} />
                  {lesson.contentUrl && (
                    <a href={lesson.contentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 py-2.5 text-sm font-semibold text-gold">
                      {lesson.contentType === "audio" ? "Open the audio" : "Open the video"} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                  {lesson.summary && <p className="whitespace-pre-line text-base leading-relaxed text-ink">{lesson.summary}</p>}
                </>
              )}

              {lesson.contentType === "text" && <article className="whitespace-pre-line text-lg leading-relaxed text-ink">{lesson.body || lesson.summary}</article>}

              {lesson.contentType === "slides" && <SlideDeck slides={lesson.slides} onFinished={() => !lesson.completed && void complete()} />}

              {lesson.contentType === "live" && lesson.live && <Live lesson={lesson} onJoined={() => void refresh()} />}

              {assessment && lesson.quiz && <QuizRunner lesson={lesson} onPassed={() => void refresh()} onContinue={goNext} />}

              {/* Older lessons may still carry a quiz of their own. */}
              {!assessment && lesson.quiz && (
                <section className="space-y-3 border-t border-[var(--border-faint)] pt-5">
                  <QuizRunner lesson={lesson} onPassed={() => void refresh()} onContinue={goNext} />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-[var(--border-faint)] bg-[rgb(var(--color-cream)/0.8)] px-3 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <Link href={prev ? href(prev.id) : `/learn/course/${id}`} aria-label="Previous" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {needsButton && !lesson?.quiz ? (
          <button type="button" onClick={markAndContinue} disabled={busy} className="h-12 flex-1 whitespace-nowrap rounded-2xl bg-gold px-3 text-[15px] font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50">
            {lesson?.completed ? (next ? "Next" : "Finish") : next ? "Mark done & continue" : "Mark done & finish"}
          </button>
        ) : (
          <div className="h-12 flex-1" />
        )}
        <Link href={next ? href(next.id) : `/learn/course/${id}`} aria-label="Next" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      </footer>
    </div>
  );
}
