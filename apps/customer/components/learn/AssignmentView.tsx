"use client";

import type { LearnerLessonDetail } from "@peebee/shared";
import { CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";

const when = (iso: string) => new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString("en-UG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** An assignment: the instructions, a place to write or link the work, and the mark and feedback once it has been graded. */
export function AssignmentView({ lesson, onChanged }: { lesson: LearnerLessonDetail; onChanged: () => void }) {
  const a = lesson.assignment!;
  const sub = a.submission;
  const [body, setBody] = useState(sub?.body ?? "");
  const [link, setLink] = useState(sub?.link ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!sub);
  const graded = sub?.status === "graded";
  const percent = graded && sub!.score !== null ? Math.round((sub!.score / a.maxPoints) * 100) : null;
  const passed = percent !== null && percent >= a.passPercent;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.learnSubmitWork(lesson.id, { body, link });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="font-[family-name:var(--font-lh-display)] text-2xl font-bold tracking-[-0.01em] leading-tight text-ink">{lesson.title}</h1>
        <p className="text-xs text-ink-500">
          {a.maxPoints} points · pass at {a.passPercent}%{a.dueAt ? ` · due ${when(a.dueAt)}` : ""}
        </p>
      </div>
      {lesson.body && <article className="whitespace-pre-line text-base leading-relaxed text-ink">{lesson.body}</article>}

      {graded && (
        <section className={`space-y-2 rounded-2xl border p-4 ${passed ? "border-green/40 bg-green/10" : "border-gold/40 bg-gold/10"}`} aria-label="Your mark">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            {passed && <CheckCircle2 className="h-4 w-4 text-green" aria-hidden />}
            {sub!.score}/{a.maxPoints} · {percent}% {passed ? "· passed" : "· not yet at the pass mark"}
          </p>
          {sub!.feedback && <p className="whitespace-pre-line text-sm text-ink">{sub!.feedback}</p>}
        </section>
      )}
      {sub && !graded && (
        <p className="flex items-center gap-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-sm text-ink">
          <Clock className="h-4 w-4 text-gold" aria-hidden /> Handed in {when(sub.submittedAt)}. Your tutor will mark it.
        </p>
      )}

      {editing ? (
        <div className="space-y-3">
          <label htmlFor="work" className="block text-xs font-semibold text-ink-500">Your answer</label>
          <textarea id="work" rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-2xl px-4 py-3 text-base" placeholder="Write your answer here" />
          <label htmlFor="work-link" className="block text-xs font-semibold text-ink-500">Link to your work (optional)</label>
          <input id="work-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} className="w-full rounded-2xl px-4 py-3 text-base" placeholder="https://…" />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={submit} disabled={busy} className="w-full rounded-2xl bg-gold px-4 py-4 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50">
            {busy ? "Sending…" : sub ? "Hand in again" : "Hand in"}
          </button>
        </div>
      ) : sub ? (
        <>
          <section className="space-y-1 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-500">What you handed in</p>
            {sub.body && <p className="whitespace-pre-line text-sm text-ink">{sub.body}</p>}
            {sub.link && <a href={sub.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gold underline">{sub.link}</a>}
          </section>
          {a.open && (
            <button type="button" onClick={() => setEditing(true)} className="w-full rounded-2xl border border-[var(--border-faint)] px-4 py-3.5 text-sm font-bold text-ink">
              Change and hand in again
            </button>
          )}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </>
      ) : (
        <p className="text-sm text-ink-500">The deadline for this has passed.</p>
      )}
    </div>
  );
}
