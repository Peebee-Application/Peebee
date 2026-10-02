import { ChevronRight } from "lucide-react";
import Link from "next/link";

type ListRowProps = {
  /** Leading glyph (usually a lucide icon) shown in a muted rounded square. */
  icon?: React.ReactNode;
  /** Replaces the icon square entirely, e.g. a photo. */
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
};

/** Flat, divider-separated row — icon square, bold title, muted subtitle.
 * The shared list pattern for recent places, orders, restaurants, saved
 * locations. Rows sit inside <ListRows>, which draws the dividers. */
export function ListRow({ icon, leading, title, subtitle, trailing, href, onClick, chevron }: ListRowProps) {
  const body = (
    <>
      {leading ?? (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-sm text-ink-500">{subtitle}</span>}
      </span>
      {trailing}
      {(chevron ?? !!href) && <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />}
    </>
  );
  const cls = "flex w-full items-center gap-3 py-3 text-left transition-colors active:bg-[rgb(var(--surface-muted))]/60";
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function ListRows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-[var(--border-faint)] [&>li]:list-none">{children}</ul>;
}
