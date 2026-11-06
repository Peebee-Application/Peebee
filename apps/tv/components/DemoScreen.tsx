"use client";

import { launchServerPractice } from "@peebee/shared";
import { useEffect, useState } from "react";
import { practiceApi } from "../lib/api";

/** Lets a new TV try Peebee Learn on a demo screen that is already paired, with demo courses and a demo learner. */
export function DemoScreen() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { practiceApi.getSettings().then(({ settings }) => setAvailable(settings.practiceModeEnabled)).catch(() => setAvailable(false)); }, []);
  if (!available) return null;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await launchServerPractice("tv"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the demo screen.");
      setBusy(false);
    }
  }

  return (
    <section aria-label="Demo screen" className="space-y-[1rem]">
      <h2 className="text-[1.5rem] font-bold text-ink">Try it with demo courses</h2>
      <button
        type="button"
        data-focusable
        disabled={busy}
        onClick={() => void start()}
        className="flex w-[34rem] flex-col rounded-[1.4rem] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-[1.3rem] text-left focus:bg-gold focus:text-ink-gold disabled:opacity-60"
      >
        <span className="text-[1.5rem] font-black leading-tight">Open the demo screen</span>
        <span className="mt-[0.3rem] text-[1.05rem] opacity-80">A demo learner with courses and live classes. Nothing here is real.</span>
      </button>
      {error && <p role="alert" className="text-[1.1rem] text-red-500">{error}</p>}
    </section>
  );
}
