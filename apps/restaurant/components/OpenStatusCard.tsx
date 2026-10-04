"use client";

import type { Restaurant } from "@peebee/shared";
import { Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

function minutesNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Handles an overnight schedule (e.g. open 18:00, close 02:00) by wrapping
 * past midnight instead of treating close as always after open same-day. */
function withinSchedule(openTime: string, closeTime: string, nowMin: number): boolean {
  const openM = parseHm(openTime);
  const closeM = parseHm(closeTime);
  if (openM === closeM) return true;
  if (openM < closeM) return nowMin >= openM && nowMin < closeM;
  return nowMin >= openM || nowMin < closeM;
}

function formatHm(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Big manual open/closed toggle — always the final word over the schedule
 * below. When the schedule's boundary is crossed (opening or closing time
 * reached) while the manual state disagrees, prompts the owner to confirm
 * rather than silently flipping it for them. */
export function OpenStatusCard({
  restaurant,
  onUpdated,
}: {
  restaurant: Restaurant;
  onUpdated: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<"open" | "close" | null>(null);
  const withinRef = useRef<boolean | null>(null);
  const promptedForRef = useRef<boolean | null>(null);

  const hasSchedule = !!restaurant.open_time && !!restaurant.close_time;
  const openTime = restaurant.open_time;
  const closeTime = restaurant.close_time;
  const isOpen = !!restaurant.is_open;

  useEffect(() => {
    if (!hasSchedule || !openTime || !closeTime) return;

    function check() {
      const within = withinSchedule(openTime as string, closeTime as string, minutesNow());
      if (withinRef.current === null) {
        // First run after mount/schedule change — don't prompt for a
        // boundary that was crossed before this session started.
        withinRef.current = within;
        promptedForRef.current = within;
        return;
      }
      if (within !== withinRef.current) {
        withinRef.current = within;
        promptedForRef.current = null;
      }
      if (promptedForRef.current === within) return;
      if (within && !isOpen) {
        setPrompt("open");
        promptedForRef.current = within;
      } else if (!within && isOpen) {
        setPrompt("close");
        promptedForRef.current = within;
      }
    }

    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [hasSchedule, openTime, closeTime, isOpen]);

  async function setOpen(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.updateRestaurant({ isOpen: next });
      await onUpdated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPrompt(null);
    }
  }

  return (
    <section className="home-card space-y-3">
      <button
        onClick={() => setOpen(!isOpen)}
        disabled={busy}
        className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold transition-colors disabled:opacity-60 ${
          isOpen ? "bg-green/15 text-green" : "bg-red-50 text-red-600"
        }`}
      >
        <Store className="h-5 w-5" strokeWidth={2} aria-hidden />
        {busy ? "Updating…" : isOpen ? "OPEN — tap to close" : "CLOSED — tap to open"}
      </button>

      {hasSchedule && (
        <p className="text-center text-xs text-ink-500">
          Scheduled hours: {formatHm(openTime as string)} – {formatHm(closeTime as string)}
        </p>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {prompt && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-[rgb(var(--surface-card))] p-5 shadow-xl">
            <p className="text-sm font-bold text-ink">
              {prompt === "open" ? "It's now your opening time" : "It's now your closing time"}
            </p>
            <p className="text-sm text-ink-500">
              {prompt === "open"
                ? "Your schedule says you should be open now, but you're marked closed. Open up?"
                : "Your schedule says you should be closed now, but you're marked open. Close now?"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPrompt(null)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-60"
              >
                {prompt === "open" ? "Stay closed" : "Stay open"}
              </button>
              <button
                onClick={() => setOpen(prompt === "open")}
                disabled={busy}
                className="min-h-11 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                {prompt === "open" ? "Open now" : "Close now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
