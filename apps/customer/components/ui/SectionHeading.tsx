import Link from "next/link";

export function SectionHeading({ title, actionLabel, actionHref }: { title: string; actionLabel?: string; actionHref?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="text-sm font-medium text-ink-500 hover:text-ink">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
