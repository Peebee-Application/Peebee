"use client";

import { BrandLogo } from "./BrandLogo";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { useLocationLabel } from "../lib/use-location-label";

export function BrandHeader() {
  const { label, status } = useLocationLabel();
  const pillText = status === "locating" ? "Locating…" : (label ?? "Kampala");

  return (
    <header className="glass-header sticky top-0 z-40 h-14 border-b border-navy/15">
      <div className="mx-auto flex h-full max-w-lg items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="Go to home" className="shrink-0">
          <BrandLogo />
        </Link>
        <span className="inline-flex min-w-0 max-w-[calc(100vw-11rem)] items-center gap-1.5 rounded-full border border-[var(--border-faint)] glass-panel px-3 py-1.5 text-left shadow-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
          <span className="truncate text-xs font-medium text-ink">{pillText}</span>
        </span>
      </div>
    </header>
  );
}
