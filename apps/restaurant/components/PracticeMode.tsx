"use client";

import { PRACTICE_MODE_STORAGE_KEY, type PracticeRole } from "@tuma/shared";
import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function PracticeModeCard({ role }: { role: PracticeRole }) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSettings().then(({ settings }) => setAvailable(settings.practiceModeEnabled)).catch(() => setAvailable(false));
  }, []);

  if (available == null) return null;

  function start() {
    window.localStorage.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
    window.location.assign("/practice");
  }

  return (
    <section data-practice-role={role} className="home-card space-y-3 border-2 border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-200">
          <FlaskConical className="h-5 w-5" strokeWidth={1.8} aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-bold text-ink">Practice Mode</h2>
          <p className="mt-1 text-xs text-ink-500">Try processing a food order with sample people and simulated money.</p>
        </div>
      </div>
      <p className="rounded-xl bg-[rgb(var(--surface-muted))] p-2.5 text-xs font-semibold text-ink">
        No real orders, messages, balances, notifications or payments are used.
      </p>
      <button
        type="button"
        onClick={start}
        disabled={!available}
        className="min-h-11 w-full rounded-full bg-sky-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {available ? "Start restaurant practice" : "Practice is currently unavailable"}
      </button>
    </section>
  );
}

export function PracticeModeRedirect({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (pathname === "/practice" || pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/verify")) return;
    if (window.localStorage.getItem(PRACTICE_MODE_STORAGE_KEY) === "1") window.location.replace("/practice");
  }, [pathname]);
  return null;
}
