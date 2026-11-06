"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** One tap opens or closes the details; everything secondary lives in one of these so the screen stays short. */
export function Accordion({
  title,
  icon: Icon,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  /** A few words shown on the closed row (a total, a status). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="home-card !p-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-16 w-full items-center gap-3 px-4 text-left"
      >
        {Icon && <Icon className="h-6 w-6 shrink-0 text-gold" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</span>
        {summary != null && <span className="shrink-0 text-base font-semibold text-ink-500">{summary}</span>}
        <ChevronDown className={`h-5 w-5 shrink-0 text-ink-500 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div id={id} className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  );
}
