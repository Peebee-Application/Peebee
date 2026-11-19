"use client";

import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared big, senior-friendly pieces for the Store screens: page header with a 56px back button, tiles with a count
 * badge hanging over the top-right corner, a black-and-gold segmented switch, and big rows.
 */

export const card = "rounded-[26px] border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[0_6px_20px_rgba(8,20,38,0.07)] dark:shadow-none";
export const fieldCls = "min-h-[60px] w-full min-w-0 rounded-[20px] border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 text-[21px] font-semibold text-ink outline-none placeholder:text-ink-500/60 focus:border-gold";
export const labelCls = "mb-2 flex items-center gap-2 text-[17px] font-extrabold text-ink";
export const goldBtn = "flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-full bg-gold px-5 text-[19px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.3)] transition active:scale-[.98] disabled:opacity-50";
export const ghostBtn = "flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-full border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-5 text-[18px] font-black text-ink transition active:scale-[.98] disabled:opacity-50";

/** Count badge that hangs over a tile's top-right corner (never clipped: parents must not hide overflow). */
export function CornerBadge({ n, testId }: { n: number | string; testId?: string }) {
  return (
    <span data-testid={testId} className="absolute -right-1.5 -top-2.5 z-[2] grid h-9 min-w-9 place-items-center rounded-full border-[3px] border-[rgb(var(--cream))] bg-black px-2.5 text-[17px] font-black leading-none text-gold dark:bg-gold dark:text-ink-gold">
      {n}
    </span>
  );
}

/** Back button + big title (+ optional count and right-side control). */
export function PageHeader({ title, count, onBack, right, testId }: { title: string; count?: number; onBack: () => void; right?: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" data-testid={testId}>
      <button type="button" onClick={onBack} aria-label="Back to store" data-testid="store-back"
        className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink active:scale-95">
        <ChevronLeft className="h-7 w-7" strokeWidth={2.6} />
      </button>
      <h1 className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-[23px] font-black leading-tight text-ink min-[400px]:text-[25px]">
        <span className="min-w-0 truncate">{title}</span>
        {count != null && (
          <span data-testid="page-count" className="grid h-9 min-w-9 shrink-0 place-items-center rounded-full bg-black px-2.5 text-[18px] font-black text-gold dark:bg-gold dark:text-ink-gold">{count}</span>
        )}
      </h1>
      {right}
    </div>
  );
}

/** Black segmented switch with a gold selected option (same look as the variant table's List/Grid). */
export function Seg<T extends string>({ value, onChange, options, wide = false, iconOnlyNarrow = false, hideIconNarrow = false, testId, label }: {
  value: T; onChange: (v: T) => void; options: { v: T; icon?: ReactNode; label: string; testId?: string }[]; wide?: boolean; iconOnlyNarrow?: boolean; hideIconNarrow?: boolean; testId?: string; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId}
      className={`grid shrink-0 gap-1 rounded-[20px] bg-black p-1 dark:border dark:border-white/10 dark:bg-[#000] ${wide ? "w-full" : ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} aria-label={o.label} onClick={() => onChange(o.v)} data-testid={o.testId}
          className={`flex min-h-[52px] min-w-[52px] items-center justify-center gap-1.5 rounded-[15px] px-2.5 text-[17px] font-extrabold ${value === o.v ? "bg-gold text-ink-gold" : "text-white"}`}>
          {o.icon && (hideIconNarrow ? <span className="hidden min-[400px]:contents">{o.icon}</span> : o.icon)}
          <span className={iconOnlyNarrow ? "hidden min-[440px]:inline" : "min-w-0 truncate"}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Big 2-column tile for the Store home grid. */
export function HubTile({ icon: Icon, title, sub, onClick, badge, tone = "gold", testId }: {
  icon: LucideIcon; title: string; sub: string; onClick: () => void; badge?: number; tone?: "gold" | "red"; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`${card} relative flex min-h-[132px] min-w-0 flex-col items-start justify-between gap-3 p-4 text-left transition active:scale-[.98]`}>
      {badge != null && <CornerBadge n={badge} testId={testId ? `${testId}-badge` : undefined} />}
      <span className={`grid h-14 w-14 place-items-center rounded-[18px] ${tone === "red" ? "bg-red-600/15 text-red-600 dark:text-red-400" : "bg-gold/15 text-[#8a6d0b] dark:text-gold"}`}>
        <Icon className="h-[30px] w-[30px]" strokeWidth={2.2} />
      </span>
      <span className="block min-w-0 max-w-full">
        <span className="block break-words text-[20px] font-black leading-tight text-ink">{title}</span>
        <span className="mt-0.5 block break-words text-[16px] font-semibold leading-snug text-ink-500">{sub}</span>
      </span>
    </button>
  );
}

/** Full-width row with an icon, two lines of text and a trailing icon. */
export function BigRow({ icon: Icon, title, sub, trailing, onClick, href, testId, tone = "muted", external }: {
  icon: LucideIcon; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; onClick?: () => void; href?: string; testId?: string; tone?: "muted" | "gold"; external?: boolean;
}) {
  const inner = (
    <>
      <span className={`grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[16px] ${tone === "gold" ? "bg-gold text-ink-gold" : "bg-gold/15 text-[#8a6d0b] dark:text-gold"}`}>
        <Icon className="h-[26px] w-[26px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[19px] font-black leading-tight text-ink">{title}</span>
        {sub != null && <span className="mt-0.5 block break-words text-[16px] font-semibold leading-snug text-ink-500">{sub}</span>}
      </span>
      {trailing ?? <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={2.6} />}
    </>
  );
  const cls = `${card} flex min-h-[76px] w-full min-w-0 items-center gap-3.5 !rounded-[22px] px-3.5 py-3 text-left transition active:scale-[.99]`;
  if (href) return <a href={href} data-testid={testId} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} data-testid={testId} className={cls}>{inner}</button>;
  return <div data-testid={testId} className={cls}>{inner}</div>;
}

/** Decorative gold glow behind the Store screens (main app style). */
export function StoreGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <div className="absolute -right-32 top-4 h-[340px] w-[340px] rounded-full bg-[radial-gradient(circle,rgb(var(--gold)/0.2),transparent_68%)]" />
      <div className="absolute -left-40 top-[520px] h-[340px] w-[340px] rounded-full bg-[radial-gradient(circle,rgb(var(--gold)/0.11),transparent_70%)]" />
    </div>
  );
}
