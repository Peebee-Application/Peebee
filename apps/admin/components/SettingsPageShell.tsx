"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { locate } from "../lib/admin-nav";
import { toast } from "./shell/Toaster";

/** Consistent page header: group eyebrow, title, optional description. Back arrow on phones (desktop has breadcrumbs). */
export function PageHeader({ title, description, backHref = "/settings", actions }: { title: string; description?: string; backHref?: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const hit = locate(pathname);
  return (
    <div className="flex items-start gap-2">
      <Link href={hit?.child ? hit.item.href : backHref} aria-label="Back" className="-ml-1.5 mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition active:opacity-60 lg:hidden">
        <ChevronLeft className="h-6 w-6" strokeWidth={2} aria-hidden />
      </Link>
      <div className="min-w-0 flex-1">
        {hit && <p className="admin-eyebrow hidden lg:block">{hit.group.label}</p>}
        <h1 className="admin-title">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-base text-ink-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SettingsPageShell({
  title,
  description,
  loading,
  children,
}: {
  title: string;
  description?: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-page space-y-5 px-4 pb-6 pt-4 lg:px-8 lg:pt-2">
      <PageHeader title={title} description={description} />
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          {[0, 1, 2].map((i) => <div key={i} className="admin-skeleton h-28 rounded-[var(--radius-card)]" />)}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * Sticky save bar for settings forms. Same submit button as before (type="submit",
 * "Save settings"), now pinned above the nav, with a toast when the save lands.
 */
export function SettingsSaveBar({
  busy,
  error,
  saved,
}: {
  busy: boolean;
  error: string | null;
  saved: boolean;
}) {
  const last = useRef({ saved, error });
  useEffect(() => {
    if (saved && !last.current.saved) toast("Settings saved");
    if (error && error !== last.current.error) toast(error, "error");
    last.current = { saved, error };
  }, [saved, error]);
  return (
    <>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="admin-savebar sticky bottom-[calc(96px+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
        <span className="hidden text-sm text-ink-500 sm:block" role="status">{saved ? "All changes saved." : "Changes apply when you save."}</span>
        <button
          type="submit"
          disabled={busy}
          className="admin-btn-gold min-h-14 w-full px-6 text-base font-extrabold sm:w-auto"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </>
  );
}
