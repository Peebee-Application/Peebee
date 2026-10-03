"use client";

import { Search } from "lucide-react";

/** Big rounded "Where to?"-style entry bar — the single obvious starting
 * point on a screen. Renders as a button; whatever it opens is the caller's
 * call. */
export function SearchPill({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 text-left transition-transform active:scale-[0.99] disabled:opacity-50"
    >
      <Search className="h-5 w-5 shrink-0 text-ink" strokeWidth={2.25} aria-hidden />
      <span className="text-lg font-bold text-ink">{label}</span>
    </button>
  );
}
