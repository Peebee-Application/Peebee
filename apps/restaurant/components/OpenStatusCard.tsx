"use client";

import type { Restaurant } from "@peebee/shared";
import { Store } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";

export function OpenStatusCard({
  restaurant,
  onUpdated,
  compact = false,
}: {
  restaurant: Restaurant;
  onUpdated: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = !!restaurant.is_open;
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

    }
  }

  return (
    <section
      className={
        compact ? "relative shrink-0 space-y-2" : "home-card space-y-3"
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={isOpen}
        aria-label={`${restaurant.name} accepting new orders`}
        onClick={() => setOpen(!isOpen)}
        disabled={busy}
        className={
          compact
            ? `flex min-h-12 items-center gap-2 rounded-full border px-3 text-xs font-bold disabled:opacity-60 ${isOpen ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink-500"}`
            : `flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold transition-colors disabled:opacity-60 ${isOpen ? "bg-green/15 text-green" : "bg-red-50 text-red-600"}`
        }
      >
        {!compact && <Store className="h-5 w-5" strokeWidth={2} aria-hidden />}
        {busy
          ? "Updating…"
          : compact
            ? isOpen
              ? "Open"
              : "Closed"
            : isOpen
              ? "OPEN — tap to close"
              : "CLOSED — tap to open"}
        {compact && (
          <span
            aria-hidden
            className={`flex h-6 w-10 items-center rounded-full p-0.5 ${isOpen ? "bg-gold" : "bg-[rgb(var(--surface-card))]"}`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-cream shadow-sm motion-safe:transition-transform ${isOpen ? "translate-x-4" : "translate-x-0"}`}
            />
          </span>
        )}
      </button>

      {compact && !isOpen && (
        <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-sm rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 text-center shadow-xl">
          <p className="text-lg font-bold">Your business is closed</p>
          <p className="mt-1 text-sm text-ink-500">Ready to take new orders? Your other tabs are still available.</p>
          <button type="button" disabled={busy} onClick={() => setOpen(true)} className="mt-4 flex min-h-16 w-full items-center justify-center gap-3 rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-60">
            <Store size={24} aria-hidden />{busy ? "Opening…" : "Open"}
          </button>
          {restaurant.open_time && restaurant.close_time && <p className="mt-3 text-xs text-ink-500">Working hours: {restaurant.open_time}–{restaurant.close_time} (Uganda). Your schedule resumes at its next opening or closing time.</p>}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className={
            compact
              ? "absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-[var(--border-faint)] bg-cream p-3 text-xs text-ink"
              : "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          }
        >
          {error}
        </p>
      )}

    </section>
  );
}
