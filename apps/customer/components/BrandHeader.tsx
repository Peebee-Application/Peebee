"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { useLocationLabel } from "../lib/use-location-label";

export function BrandHeader() {
  const { label, status } = useLocationLabel();
  const pillText = status === "locating" ? "Locating…" : (label ?? "Kampala");

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-navy/15 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-lg items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="Go to home" className="shrink-0">
          <img src="/brand/peebee-logo-navy.png" alt="Peebee" width={120} height={45} className="h-7 w-auto dark:hidden" />
          <img
            src="/brand/peebee-logo-white.png"
            alt="Peebee"
            width={120}
            height={45}
            className="hidden h-7 w-auto dark:block"
          />
        </Link>
        <span className="inline-flex max-w-[calc(100vw-9rem)] items-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-1.5 text-left shadow-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
          <span className="truncate text-xs font-medium text-ink">{pillText}</span>
        </span>
      </div>
    </header>
  );
}
