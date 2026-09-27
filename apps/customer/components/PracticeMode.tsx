"use client";

import {
  exitPracticeMode,
  isPracticeJourneyComplete,
  isPracticeMode,
  practiceStartPath,
  startPracticeMode,
  type PracticeRole,
} from "@tuma/shared";
import { FlaskConical, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const HINTS: Record<PracticeRole, string> = {
  customer: "Use the normal home screen to create, fund, track and complete a sample order.",
  rider: "Claim the sample job and complete it using the same controls as a live delivery.",
  restaurant: "Use the real restaurant dashboard to confirm the sample rider payment and explore settlement.",
  merchant: "Use the real merchant dashboard to confirm the sample payment and test settlement.",
};

const ROLE_LABELS: Record<PracticeRole, string> = {
  customer: "customer", rider: "rider", restaurant: "restaurant", merchant: "merchant",
};

export function PracticeModeCard({ role }: { role: PracticeRole }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => { api.getSettings().then(({ settings }) => setAvailable(settings.practiceModeEnabled)).catch(() => setAvailable(false)); }, []);
  if (available == null) return null;
  function start() { window.location.assign(startPracticeMode(role)); }
  return (
    <section data-practice-role={role} className="home-card space-y-3 border-2 border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-200"><FlaskConical className="h-5 w-5" strokeWidth={1.8} aria-hidden /></span><div><h2 className="text-sm font-bold text-ink">Practice Mode</h2><p className="mt-1 text-xs text-ink-500">Practise inside the real {ROLE_LABELS[role]} app with safe sample data.</p></div></div>
      <p className="rounded-xl bg-[rgb(var(--surface-muted))] p-2.5 text-xs font-semibold text-ink">The screens and controls are the same as live. No real orders, notifications, balances or payments are used.</p>
      <button type="button" onClick={start} disabled={!available} className="min-h-11 w-full rounded-full bg-sky-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{available ? `Open ${ROLE_LABELS[role]} practice` : "Practice is currently unavailable"}</button>
    </section>
  );
}

export function PracticeModeGuard({ role, pathname }: { role: PracticeRole; pathname: string }) {
  useEffect(() => {
    if (!isPracticeMode()) return;
    if (pathname === "/practice") { window.location.replace(practiceStartPath(role)); return; }
    api.getSettings().then(({ settings }) => { if (!settings.practiceModeEnabled) { exitPracticeMode(role); window.location.replace("/account"); } }).catch(() => undefined);
  }, [pathname, role]);
  return null;
}

export function PracticeModeBanner({ role }: { role: PracticeRole }) {
  const [active, setActive] = useState(false);
  useEffect(() => setActive(isPracticeMode()), []);
  if (!active) return null;
  function restart() { window.location.replace(startPracticeMode(role)); }
  async function exit() { const completed = isPracticeJourneyComplete(role); exitPracticeMode(role); if (completed) await api.completePractice(role).catch(() => undefined); window.location.replace("/account"); }
  return <aside className="sticky top-14 z-20 border-b border-sky-300 bg-sky-50 px-3 py-2 text-sky-950 shadow-sm dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"><div className="mx-auto flex max-w-lg items-center gap-2"><FlaskConical className="h-4 w-4 shrink-0" aria-hidden/><p className="min-w-0 flex-1 text-[11px] leading-4"><strong>Practice · no real money.</strong> {HINTS[role]}</p><button type="button" onClick={restart} aria-label="Restart practice" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-300 dark:border-sky-700"><RotateCcw className="h-3.5 w-3.5" aria-hidden/></button><button type="button" onClick={exit} aria-label="Exit practice" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-300 dark:border-sky-700"><X className="h-3.5 w-3.5" aria-hidden/></button></div></aside>;
}

export function PracticeModePrompt({ role }: { role: PracticeRole }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isPracticeMode()) return;
    api.getPracticeStatus(role).then(({ practice }) => {
      if (!practice.shouldPrompt) return;
      setOpen(true);
      void api.markPracticePrompted(role).catch(() => undefined);
    }).catch(() => undefined);
  }, [role]);
  if (!open) return null;
  function start() { window.location.assign(startPracticeMode(role)); }
  async function neverRemind() { setBusy(true); await api.dismissPracticeReminder(role).catch(() => undefined); setOpen(false); setBusy(false); }
  return <div className="fixed inset-0 z-[70] flex items-end bg-black/50 p-4 sm:items-center"><section role="dialog" aria-modal="true" aria-labelledby={`practice-prompt-${role}`} className="mx-auto w-full max-w-md space-y-4 rounded-[28px] bg-[rgb(var(--surface))] p-5 shadow-2xl"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200"><Sparkles className="h-5 w-5" aria-hidden/></span><div><h2 id={`practice-prompt-${role}`} className="text-lg font-black text-ink">Practise before you get started?</h2><p className="mt-1 text-sm leading-5 text-ink-500">Learn inside the real {ROLE_LABELS[role]} screens with sample data and simulated money. Nothing affects your live account.</p></div></div><button type="button" onClick={start} className="min-h-12 w-full rounded-full bg-sky-600 px-4 text-sm font-black text-white">Start practice</button><button type="button" onClick={() => setOpen(false)} className="min-h-10 w-full rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink">Maybe later</button><button type="button" disabled={busy} onClick={neverRemind} className="w-full py-1 text-xs font-semibold text-ink-500 disabled:opacity-50">Don&apos;t remind me again</button></section></div>;
}
