"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { tvApi, type TrialClass } from "../lib/api";
import { useDevice } from "../lib/device";

/**
 * Practice classes a screen can show on its own: the class plays by itself, and phones join the same class with the
 * code on screen. Works before the TV is paired, so a new TV can be tried straight away.
 */
export function TrialPicker({ heading = "Just looking? Watch a practice class" }: { heading?: string }) {
  const router = useRouter();
  const { secret, setTrial } = useDevice();
  const [classes, setClasses] = useState<TrialClass[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tvApi
      .trials()
      .then((res) => !cancelled && setClasses(res.classes))
      .catch(() => !cancelled && setClasses([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!classes || classes.length === 0) return null;

  async function start(slot: TrialClass["slot"]) {
    if (!secret || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setTrial(slot);
      router.push("/learn");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the practice class.");
      setBusy(false);
    }
  }

  return (
    <section aria-label="Practice classes" className="space-y-[1rem]">
      <h2 className="text-[1.5rem] font-bold text-ink">{heading}</h2>
      <ul className="flex flex-wrap gap-[1.2rem]">
        {classes.map((c) => (
          <li key={c.slot}>
            <button
              type="button"
              data-focusable
              disabled={busy || !secret}
              onClick={() => void start(c.slot)}
              className="flex w-[34rem] flex-col rounded-[1.4rem] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-[1.3rem] text-left focus:bg-gold focus:text-ink-gold disabled:opacity-60"
            >
              <span className="text-[1.5rem] font-black leading-tight">{c.title.replace(/^Trial class: /, "")}</span>
              <span className="mt-[0.3rem] text-[1.05rem] opacity-80">with {c.hostName}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[1.1rem] text-red-500">{error}</p>}
    </section>
  );
}
