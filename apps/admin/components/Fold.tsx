"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * A settings section that opens and closes. Long settings pages are lists of these, so a page shows its section titles
 * (or each section's main switch) and the details open on a tap. The body stays mounted while closed, so every field
 * keeps its value and the form saves exactly as before; if the browser finds a required field invalid inside a closed
 * section, that section opens so the person can see it.
 *
 * Give it either a `title`, or a `head` (for example the section's on/off switch) that stays visible beside the arrow.
 */
export function Fold({ title, head, defaultOpen = false, children }: { title?: ReactNode; head?: ReactNode; defaultOpen?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  // A section whose switch has no details under it needs no arrow.
  if (!children) return <section className="home-card">{head ?? title}</section>;
  const arrow = <ChevronDown className={`h-6 w-6 shrink-0 text-ink-500 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />;
  return (
    <section className="home-card !p-0">
      {head ? (
        <div className="flex min-h-16 items-center gap-2 px-4">
          <div className="min-w-0 flex-1 py-3">{head}</div>
          <button type="button" aria-expanded={open} aria-controls={id} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen((o) => !o)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            {arrow}
          </button>
        </div>
      ) : (
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left">
          <span className="min-w-0 flex-1 text-lg font-extrabold text-ink">{title}</span>
          {arrow}
        </button>
      )}
      <div id={id} hidden={!open} onInvalidCapture={() => setOpen(true)} className="space-y-3 px-4 pb-4">{children}</div>
    </section>
  );
}
