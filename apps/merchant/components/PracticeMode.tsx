"use client";

import {
  exitPracticeMode,
  isPracticeJourneyComplete,
  isPracticeMode,
  practiceStartPath,
  launchPractice,
  type PracticeRole,
} from "@peebee/shared";
import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { PracticeModeFrame, PracticePromptDialog } from "@peebee/shared/practice-ui";
import { api } from "../lib/api";

const ROLE_LABELS: Record<PracticeRole, string> = {
  customer: "customer", rider: "rider", restaurant: "restaurant", merchant: "merchant", gas: "fuel attendant", learner: "learner",
};

export function PracticeModeCard({ role }: { role: PracticeRole }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => { api.getSettings().then(({ settings }) => setAvailable(settings.practiceModeEnabled)).catch(() => setAvailable(false)); }, []);
  if (available == null) return null;
  function start() { void launchPractice(role).then((path) => window.location.assign(path)); }
  return (
    <section data-practice-role={role} className="flex flex-col gap-3.5 rounded-[26px] border-2 border-sky-400/40 bg-sky-500/[.09] p-[18px]">
      <div className="flex items-center gap-3.5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-sky-500/20 text-sky-700 dark:text-sky-300"><FlaskConical className="h-[30px] w-[30px]" strokeWidth={1.9} aria-hidden /></span>
        <div className="min-w-0"><h2 className="text-[22px] font-black leading-tight text-ink">Practice mode</h2><p className="mt-0.5 text-[17px] font-bold text-ink-500">Sample data. No real money.</p></div>
      </div>
      <button type="button" onClick={start} disabled={!available} className="flex min-h-[60px] w-full items-center justify-center rounded-full bg-sky-600 px-4 text-[19px] font-black text-white active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50">{available ? "Start practice" : "Practice is unavailable now"}</button>
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

/** Blue screen border + "Practice mode" tab (shared); its X leaves practice. */
export function PracticeModeBanner({ role }: { role: PracticeRole }) {
  async function exit() { const completed = isPracticeJourneyComplete(role); exitPracticeMode(role); if (completed) await api.completePractice(role).catch(() => undefined); window.location.replace("/account"); }
  return <PracticeModeFrame onExit={exit} />;
}

export function PracticeModePrompt({ role }: { role: PracticeRole }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isPracticeMode()) return; api.getPracticeStatus(role).then(({ practice }) => { if (!practice.shouldPrompt) return; setOpen(true); void api.markPracticePrompted(role).catch(() => undefined); }).catch(() => undefined); }, [role]);
  if (!open) return null;
  function start() { void launchPractice(role).then((path) => window.location.assign(path)); }
  async function neverRemind() { setBusy(true); await api.dismissPracticeReminder(role).catch(() => undefined); setOpen(false); setBusy(false); }
  return <PracticePromptDialog
    id={`practice-prompt-${role}`}
    title="Practise before you get started?"
    body={`Learn inside the real ${ROLE_LABELS[role]} screens with sample data and simulated money. Nothing affects your live account.`}
    primaryLabel="Start practice"
    onPrimary={start}
    secondaryLabel="Maybe later"
    onSecondary={() => setOpen(false)}
    tertiaryLabel="Don't remind me again"
    onTertiary={neverRemind}
    tertiaryBusy={busy}
  />;
}
