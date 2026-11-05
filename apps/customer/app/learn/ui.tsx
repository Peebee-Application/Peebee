import { ArrowLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { bodyFont, display, monoFont } from "./fonts";

/** Shared look of the Learn screens: one ambient backdrop, one type scale, one set of cards and buttons. */

export const card = "rounded-[20px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[0_1px_0_rgb(var(--color-ink)/0.03),0_8px_24px_-18px_rgb(var(--color-ink)/0.35)]";
export const cardLink = `${card} transition active:scale-[0.99] hover:border-gold/50`;
export const displayFont = "font-[family-name:var(--font-lh-display)]";
export const monoCls = "font-[family-name:var(--font-lh-mono)]";
export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-gold px-5 py-3 text-sm font-bold text-ink-gold shadow-[0_10px_24px_-12px_rgb(var(--color-gold)/0.9)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none";
export const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 py-2.5 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-50";
export const eyebrow = "text-[10px] font-bold uppercase tracking-[0.18em] text-gold";

/** The backdrop: a warm wash from the top plus two soft blobs. It sits behind the content and never takes a tap. */
export function Ambient() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]" aria-hidden>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--color-gold)/0.13),rgb(var(--color-gold)/0.04)_45%,transparent)]" />
      <span className="absolute -right-24 -top-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.38),transparent_68%)] blur-2xl" />
      <span className="absolute -left-28 top-44 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgb(var(--color-green)/0.2),transparent_68%)] blur-2xl" />
      <span className="absolute -right-16 top-[360px] h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.16),transparent_70%)] blur-2xl" />
    </div>
  );
}

/** Root of a Learn screen: its fonts, the backdrop and a centred column. */
export function LearnScreen({ children, width = "max-w-2xl", bottom = "pb-40", className = "" }: { children: ReactNode; width?: string; bottom?: string; className?: string }) {
  return (
    <div className={`${display.variable} ${bodyFont.variable} ${monoFont.variable} relative isolate min-h-dvh font-[family-name:var(--font-lh-body)]`}>
      <Ambient />
      <div className={`mx-auto ${width} space-y-[18px] px-3.5 pt-4 ${bottom} ${className}`}>{children}</div>
    </div>
  );
}

export function BackChip({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={`Back to ${label}`}
      className="flex h-[38px] w-fit items-center gap-1.5 rounded-[13px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] pl-2.5 pr-3 text-xs font-semibold text-ink print:hidden"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {label}
    </Link>
  );
}

/** Title block: a round back button, the small gold label, the heading and an optional line under it. */
export function ScreenHeader({
  back,
  label,
  title,
  subtitle,
  icon: Icon,
  right,
}: {
  back?: { href: string; label: string };
  label?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  right?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {back ? (
          <BackChip href={back.href} label={back.label} />
        ) : (
          <span />
        )}
        {right}
      </div>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,rgb(var(--color-gold)/0.35),rgb(var(--color-gold)/0.12))] text-gold ring-1 ring-gold/30">
            <Icon className="h-6 w-6" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          {label && <p className={eyebrow}>{label}</p>}
          <h1 className={`${displayFont} mt-[3px] text-[24px] font-bold leading-[1.1] tracking-[-0.02em] text-ink`}>{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{subtitle}</p>}
        </div>
      </div>
    </header>
  );
}

export function SectionTitle({ id, icon: Icon, children, action }: { id?: string; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className={`${displayFont} flex items-center gap-2 text-base font-semibold text-ink`}>
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-gold/15 text-gold">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Pill({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "green" | "muted" }) {
  const cls = tone === "green" ? "bg-green/15 text-green" : tone === "muted" ? "bg-[rgb(var(--surface-muted))] text-ink-500" : "bg-gold/15 text-gold";
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

export function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--color-gold)/0.7),rgb(var(--color-gold)))]" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-ink">
      {children}
    </p>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[20px] bg-[rgb(var(--surface-muted))] ${className}`} aria-hidden />;
}

/** An empty list: a soft blob, a line of text and (optionally) the next step. */
export function Empty({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${card} relative flex flex-col items-center gap-2 overflow-hidden px-5 py-7 text-center`}>
      <span className="pointer-events-none absolute -top-10 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full bg-gold/20 blur-2xl" aria-hidden />
      <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/15 text-gold">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="relative max-w-xs text-sm text-ink-500">{children}</p>
      {action && <div className="relative pt-1">{action}</div>}
    </div>
  );
}
