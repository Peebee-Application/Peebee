"use client";

import { PRACTICE_JOURNEYS, PRACTICE_MODE_STORAGE_KEY } from "@tuma/shared";
import { CheckCircle2, FlaskConical, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

const journey = PRACTICE_JOURNEYS.customer;

export default function PracticePage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const finished = completed === journey.steps.length;
  const step = journey.steps[Math.min(stepIndex, journey.steps.length - 1)];

  useEffect(() => {
    window.localStorage.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
    api.getSettings()
      .then(({ settings }) => {
        setAvailable(settings.practiceModeEnabled);
        if (!settings.practiceModeEnabled) window.localStorage.removeItem(PRACTICE_MODE_STORAGE_KEY);
      })
      .catch(() => {
        window.localStorage.removeItem(PRACTICE_MODE_STORAGE_KEY);
        setAvailable(false);
      });
  }, []);

  function exit() {
    window.localStorage.removeItem(PRACTICE_MODE_STORAGE_KEY);
    window.location.replace("/account");
  }

  function advance() {
    const nextCompleted = Math.max(completed, stepIndex + 1);
    setCompleted(nextCompleted);
    if (nextCompleted < journey.steps.length) setStepIndex(nextCompleted);
  }

  function restart() {
    setCompleted(0);
    setStepIndex(0);
  }

  if (available == null) return <div className="p-5 text-sm text-ink-500">Preparing the safe practice environment…</div>;
  if (!available) {
    return (
      <div className="space-y-4 p-5">
        <h1 className="text-xl font-bold text-ink">Practice is currently unavailable</h1>
        <p className="text-sm text-ink-500">An administrator has paused user practice. Your live account was not changed.</p>
        <button type="button" onClick={exit} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold">
          Return to account
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sky-50 px-4 pb-8 pt-4 text-ink dark:bg-[#071a32]">
      <div className="mx-auto max-w-xl space-y-4">
        <header className="rounded-3xl border-2 border-sky-300 bg-white p-4 shadow-sm dark:border-sky-800 dark:bg-[rgb(var(--surface-card))]">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
              <FlaskConical className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                Practice · No real money
              </span>
              <h1 className="mt-2 text-xl font-black">{journey.heading}</h1>
              <p className="mt-1 text-sm text-ink-500">{journey.introduction}</p>
            </div>
            <button type="button" onClick={exit} aria-label="Exit practice mode" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink-500">
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <div className="mt-4 rounded-2xl bg-sky-50 p-3 dark:bg-sky-950/30">
            <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-200">Sample value</p>
            <p className="mt-1 text-base font-black">{journey.sampleAmount}</p>
          </div>
        </header>

        <div className="h-2 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950/60" aria-label={"Practice progress: " + completed + " of " + journey.steps.length + " steps complete"}>
          <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: String((completed / journey.steps.length) * 100) + "%" }} />
        </div>

        {finished ? (
          <section className="home-card space-y-4 border-2 border-green/30 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green" strokeWidth={1.6} aria-hidden />
            <div>
              <h2 className="text-lg font-black text-ink">Practice complete</h2>
              <p className="mt-1 text-sm text-ink-500">{journey.completionMessage}</p>
            </div>
            <p className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-xs font-semibold text-ink">
              Your real account, orders and balances were not changed.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={restart} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-sky-500 px-3 text-sm font-bold text-sky-700 dark:text-sky-200">
                <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden /> Try again
              </button>
              <button type="button" onClick={exit} className="min-h-11 flex-[1.4] rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">
                Return to live account
              </button>
            </div>
          </section>
        ) : (
          <section className="home-card space-y-4 border-2 border-sky-200 dark:border-sky-900">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-200">
                Step {stepIndex + 1} of {journey.steps.length}
              </p>
              <p className="text-xs font-semibold text-ink-500">{journey.roleLabel}</p>
            </div>
            <div>
              <h2 className="text-lg font-black text-ink">{step.title}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-500">{step.description}</p>
            </div>
            <button type="button" onClick={advance} className="min-h-12 w-full rounded-full bg-sky-600 px-4 text-sm font-black text-white">
              {step.actionLabel}
            </button>
          </section>
        )}

        <section className="home-card space-y-2">
          <h2 className="text-sm font-bold text-ink">Journey checklist</h2>
          {journey.steps.map((item, index) => (
            <div key={item.title} className="flex items-center gap-2 border-t border-[var(--border-faint)] pt-2 text-xs first:border-0 first:pt-0">
              <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " + (index < completed ? "bg-green text-white" : index === stepIndex && !finished ? "bg-sky-600 text-white" : "bg-[rgb(var(--surface-muted))] text-ink-500")}>
                {index < completed ? "✓" : index + 1}
              </span>
              <span>
                <span className={index < completed ? "block font-semibold text-ink" : "block text-ink-500"}>{item.title}</span>
                {index < completed && <span className="mt-0.5 block text-[11px] text-green">{item.resultLabel}</span>}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
