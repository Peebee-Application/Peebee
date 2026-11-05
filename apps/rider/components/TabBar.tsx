"use client";

import type { LucideIcon } from "lucide-react";

export type TabItem<T extends string> = { id: T; label: string; icon: LucideIcon; count?: number };

/** Big segmented tabs: an icon and one word each, so a screen shows one thing at a time instead of one long scroll. */
export function TabBar<T extends string>({ tabs, active, onChange, label }: { tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; label: string }) {
  // Two tabs sit side by side; three or more stack the icon over the word so no label is cut off.
  const stacked = tabs.length > 2;
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-2xl bg-[rgb(var(--surface-muted))] p-1">
      {tabs.map(({ id, label: text, icon: Icon, count }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          onClick={() => onChange(id)}
          className={`flex min-w-0 flex-1 items-center justify-center rounded-xl px-1 font-bold ${stacked ? "min-h-16 flex-col gap-0.5 text-base" : "min-h-14 gap-2 px-2 text-lg"} ${active === id ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"}`}
        >
          <Icon className="h-6 w-6 shrink-0" aria-hidden />
          <span className="truncate">{text}</span>
          {count != null && count > 0 && <span className="rounded-full bg-ink/10 px-2 text-sm tabular-nums">{count}</span>}
        </button>
      ))}
    </div>
  );
}
