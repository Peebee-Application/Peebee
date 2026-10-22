"use client";

import type { LearnerLessonDetail, QuizAnswer, QuizAttemptStart, QuizResult, ServedQuestion } from "@peebee/shared";
import { ArrowDown, ArrowUp, CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const tab = "w-full rounded-2xl border px-4 py-3.5 text-left text-base transition active:scale-[.99]";
const tabOn = "border-gold bg-gold/10 font-semibold";
const tabOff = "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Ring({ percent, passed }: { percent: number; passed: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-36 w-36" role="img" aria-label={`${percent} percent`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-[rgb(var(--surface-muted))]" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} className={passed ? "stroke-green" : "stroke-gold"} style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-ink">{percent}%</span>
    </div>
  );
}

function Question({ q, value, onChange }: { q: ServedQuestion; value: QuizAnswer | undefined; onChange: (v: QuizAnswer) => void }) {
  switch (q.type) {
    case "single":
      return (
        <div className="space-y-2.5" role="radiogroup" aria-label={q.question}>
          {q.options!.map((o, i) => (
            <button key={i} type="button" role="radio" aria-checked={value === i} onClick={() => onChange(i)} className={`${tab} ${value === i ? tabOn : tabOff}`}>
              {o}
            </button>
          ))}
        </div>
      );
    case "multiple": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-ink-500">Choose every right answer</p>
          {q.options!.map((o, i) => {
            const on = picked.includes(i);
            return (
              <button key={i} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? picked.filter((p) => p !== i) : [...picked, i])} className={`${tab} ${on ? tabOn : tabOff}`}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case "true_false":
      return (
        <div className="grid grid-cols-2 gap-3">
          {[true, false].map((b) => (
            <button key={String(b)} type="button" aria-pressed={value === b} onClick={() => onChange(b)} className={`${tab} text-center text-lg ${value === b ? tabOn : tabOff}`}>
              {b ? "True" : "False"}
            </button>
          ))}
        </div>
      );
    case "fill_blank":
    case "short_answer":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={300}
          autoCapitalize="none"
          autoComplete="off"
          placeholder="Type your answer"
          aria-label={q.question}
          className="w-full rounded-2xl px-4 py-3.5 text-base"
        />
      );
    case "ordering": {
      const order = Array.isArray(value) ? value : q.options!.map((_, i) => i);
      const move = (from: number, by: number) => {
        const to = from + by;
        if (to < 0 || to >= order.length) return;
        const next = [...order];
        [next[from], next[to]] = [next[to], next[from]];
        onChange(next);
      };
      return (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-ink-500">Use the arrows to put these in the right order</p>
          {order.map((pos, i) => (
            <div key={pos} className={`${tab} flex items-center gap-3 ${tabOff}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-gold">{i + 1}</span>
              <span className="min-w-0 flex-1">{q.options![pos]}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-30">
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-30">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      );
    }
    case "matching": {
      const picks = Array.isArray(value) ? value : q.left!.map(() => -1);
      return (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-ink-500">Match each item with its partner</p>
          {q.left!.map((l, i) => (
            <div key={i} className="space-y-1.5 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3">
              <p className="text-sm font-semibold text-ink">{l}</p>
              <select
                value={picks[i] ?? -1}
                aria-label={`Partner for ${l}`}
                onChange={(e) => {
                  const next = [...picks];
                  next[i] = Number(e.target.value);
                  onChange(next);
                }}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
              >
                <option value={-1}>Choose…</option>
                {q.right!.map((r, ri) => (
                  <option key={ri} value={ri}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }
  }
}

const isAnswered = (q: ServedQuestion, v: QuizAnswer | undefined) => {
  if (q.type === "ordering") return true;
  if (q.type === "matching") return Array.isArray(v) && v.length === q.left!.length && v.every((n) => n >= 0);
  if (q.type === "multiple") return Array.isArray(v) && v.length > 0;
  if (q.type === "fill_blank" || q.type === "short_answer") return typeof v === "string" && v.trim() !== "";
  return v !== undefined && v !== null;
};

type Stage = "intro" | "running" | "result";

/** A quiz or exam, one question to a screen: intro → questions (with a timer when the paper has one) → score and review. */
export function QuizRunner({ lesson, onPassed, onContinue }: { lesson: LearnerLessonDetail; onPassed: () => void; onContinue?: () => void }) {
  const info = lesson.quiz!;
  const isExam = lesson.contentType === "exam";
  const [stage, setStage] = useState<Stage>("intro");
  const [attempt, setAttempt] = useState<QuizAttemptStart | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const used = result?.attemptsUsed ?? attempt?.attemptsUsed ?? info.attemptsUsed;
  const allowed = result?.attemptsAllowed ?? attempt?.attemptsAllowed ?? info.attemptsAllowed;
  const attemptsLeft = allowed > 0 ? Math.max(0, allowed - used) : null;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.learnStartQuiz(lesson.id);
      setAttempt(res);
      setAnswers({});
      setIndex(0);
      setResult(null);
      setLeft(res.timeLimitMinutes > 0 ? res.timeLimitMinutes * 60 : null);
      submitting.current = false;
      setStage("running");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const submit = useCallback(async () => {
    if (!attempt || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.learnSubmitAttempt(lesson.id, attempt.attemptToken, answers);
      setResult(res);
      setStage("result");
      if (res.passed) onPassed();
    } catch (err) {
      submitting.current = false;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [attempt, answers, lesson.id, onPassed]);

  useEffect(() => {
    if (stage !== "running" || left === null) return;
    if (left <= 0) {
      void submit();
      return;
    }
    const t = setTimeout(() => setLeft((s) => (s === null ? s : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [stage, left, submit]);

  const q = attempt?.questions[index];
  const answeredCount = useMemo(() => (attempt ? attempt.questions.filter((x) => isAnswered(x, answers[x.id])).length : 0), [attempt, answers]);

  if (stage === "intro") {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-3xl" aria-hidden>
          {isExam ? "🎓" : "✍️"}
        </div>
        <div className="space-y-1">
          <h2 className="font-[family-name:var(--font-lh-display)] text-2xl font-bold tracking-[-0.01em] text-ink">{info.title || lesson.title}</h2>
          {lesson.summary && <p className="text-sm text-ink-500">{lesson.summary}</p>}
        </div>
        <dl className="mx-auto grid max-w-sm grid-cols-2 gap-3 text-left">
          {[
            ["Questions", String(info.questionCount)],
            ["Pass mark", `${info.passingScorePercent}%`],
            ["Time", info.timeLimitMinutes > 0 ? `${info.timeLimitMinutes} min` : "Untimed"],
            ["Attempts", allowed > 0 ? `${Math.max(0, allowed - used)} of ${allowed} left` : "Unlimited"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{k}</dt>
              <dd className="text-base font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {lesson.bestScorePercent !== null && <p className="text-sm text-ink-500">Your best so far: {lesson.bestScorePercent}%</p>}
        {isExam && info.timeLimitMinutes > 0 && <p className="text-xs text-ink-500">The clock starts when you press Start and doesn&apos;t stop. Your answers are sent when time runs out.</p>}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="button" onClick={start} disabled={busy || attemptsLeft === 0} className="w-full rounded-2xl bg-gold px-4 py-4 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50">
          {busy ? "Starting…" : attemptsLeft === 0 ? "No attempts left" : used > 0 ? "Try again" : `Start ${isExam ? "exam" : "quiz"}`}
        </button>
      </div>
    );
  }

  if (stage === "result" && result) {
    return (
      <div className="space-y-6">
        <div className="space-y-3 text-center">
          <Ring percent={result.scorePercent} passed={result.passed} />
          <h2 className="font-[family-name:var(--font-lh-display)] text-2xl font-bold tracking-[-0.01em] text-ink">{result.passed ? "You passed!" : "Not quite yet"}</h2>
          <p className="text-sm text-ink-500">
            {result.earned} of {result.total} points · pass mark {result.passMark}%
            {result.attemptsAllowed > 0 && ` · ${Math.max(0, result.attemptsAllowed - result.attemptsUsed)} attempt${result.attemptsAllowed - result.attemptsUsed === 1 ? "" : "s"} left`}
          </p>
        </div>
        <ol className="space-y-2.5">
          {result.results.map((r, i) => {
            const served = attempt!.questions[i];
            return (
              <li key={r.id} className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5">
                <div className="flex items-start gap-2.5">
                  {r.correct ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green" aria-label="Correct" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-label="Wrong" />}
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-ink">
                      {i + 1}. {served.question}
                    </p>
                    {!r.correct && r.reveal && <p className="text-sm text-ink">Answer: {r.reveal.answer}</p>}
                    {r.reveal?.explanation && <p className="text-xs text-ink-500">{r.reveal.explanation}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="space-y-2.5">
          {result.passed && onContinue && (
            <button type="button" onClick={onContinue} className="w-full rounded-2xl bg-gold px-4 py-4 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98]">
              Continue
            </button>
          )}
          {!result.passed && (attemptsLeft === null || attemptsLeft > 0) && (
            <button type="button" onClick={start} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gold px-4 py-4 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50">
              <RotateCcw className="h-4 w-4" aria-hidden /> Try again
            </button>
          )}
          {!result.passed && attemptsLeft === 0 && <p className="text-center text-sm text-ink-500">You&apos;ve used every attempt. Ask your tutor if you need another chance.</p>}
        </div>
        {error && <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (!attempt || !q) return null;
  const last = index === attempt.questions.length - 1;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-ink-500">
          <span>
            Question {index + 1} of {attempt.questions.length}
          </span>
          {left !== null && (
            <span className={`flex items-center gap-1 tabular-nums ${left <= 30 ? "text-red-600 dark:text-red-400" : ""}`}>
              <Clock className="h-3.5 w-3.5" aria-hidden /> {clock(left)}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={attempt.questions.length}>
          <div className="h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--color-gold)/0.7),rgb(var(--color-gold)))] transition-all" style={{ width: `${((index + 1) / attempt.questions.length) * 100}%` }} />
        </div>
      </div>
      <h2 className="font-[family-name:var(--font-lh-display)] text-xl font-bold tracking-[-0.01em] leading-snug text-ink">{q.question}</h2>
      <Question q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="rounded-2xl border border-[var(--border-faint)] px-5 py-3.5 text-sm font-semibold text-ink disabled:opacity-30">
          Back
        </button>
        {last ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const skipped = attempt.questions.length - answeredCount;
              if (skipped > 0 && !window.confirm(`${skipped} question${skipped === 1 ? " is" : "s are"} unanswered. Submit anyway?`)) return;
              void submit();
            }}
            className="flex-1 rounded-2xl bg-gold px-4 py-3.5 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Marking…" : "Submit"}
          </button>
        ) : (
          <button type="button" onClick={() => setIndex((i) => i + 1)} className="flex-1 rounded-2xl bg-gold px-4 py-3.5 text-base font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98]">
            Next
          </button>
        )}
      </div>
    </div>
  );
}
