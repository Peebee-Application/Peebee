"use client";

import { AlertCircle, CheckCircle2, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cardCls = "rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]";

const buttonBase =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 py-2 text-lg font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const buttonCls = {
  primary: `${buttonBase} bg-gold text-ink-gold`,
  secondary: `${buttonBase} border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink hover:border-gold/50`,
  danger: `${buttonBase} border border-red-500/30 bg-[rgb(var(--surface-muted))] text-red-600 hover:border-red-500/60 dark:text-red-400`,
} as const;

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonCls }) {
  return <button type="button" {...rest} className={`${buttonCls[variant]} ${className}`} />;
}

export function LinkButton({ href, variant = "primary", children, className = "" }: { href: string; variant?: keyof typeof buttonCls; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`${buttonCls[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** A labelled form field. The control itself gets the app's single solid field fill from the global rule. */
export function Field({ label, hint, htmlFor, children, className = "" }: { label: string; hint?: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={htmlFor} className="block text-base font-semibold text-ink-500">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

export const controlCls = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] text-lg text-ink outline-none focus:border-gold";

export function Notice({ tone = "info", children, onClose }: { tone?: "info" | "success" | "error"; children: ReactNode; onClose?: () => void }) {
  const styles = {
    info: "border-gold/40 bg-gold/10 text-ink",
    success: "border-green/40 bg-green/10 text-ink",
    error: "border-red-500/40 bg-red-500/10 text-ink",
  }[tone];
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-lg ${styles}`}>
      <Icon className={`mt-1 h-5 w-5 shrink-0 ${tone === "error" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-green" : "text-gold"}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 text-ink-500 hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className={`${cardCls} flex flex-col items-center gap-3 px-5 py-10 text-center`}>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        <p className="mx-auto max-w-sm text-lg text-ink-500">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-base text-ink-500">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>›</span>}
          {item.href ? (
            <Link href={item.href} className="font-semibold text-gold hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="truncate font-semibold text-ink">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "gold" | "green" }) {
  const tones = { muted: "bg-[rgb(var(--surface-muted))] text-ink-500", gold: "bg-gold/15 text-gold", green: "bg-green/15 text-green" }[tone];
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${tones}`}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[rgb(var(--surface-muted))] ${className}`} aria-hidden />;
}

/** Segmented choice (tabs, not a field), e.g. Class | Masterclass. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; disabled?: boolean }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`min-h-12 flex-1 rounded-lg px-3 text-base font-bold transition disabled:opacity-40 ${value === o.id ? "bg-gold text-ink-gold" : "text-ink-500 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
