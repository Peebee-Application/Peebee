"use client";

import type { LearnProStatus } from "@peebee/shared";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Chip } from "./ui";

/** The small "Pro" marker next to anything that belongs to Learn Pro. */
export function ProChip({ status }: { status: LearnProStatus | null }) {
  return <Chip tone="gold">{status && !status.tv.required ? "Pro · free for now" : "Pro"}</Chip>;
}

/** Shown where an educator without Pro would otherwise hit a wall: says what Pro is and links to it. */
export function ProUpgrade({ status }: { status: LearnProStatus }) {
  if (status.tv.allowed) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">The TV classroom is a Learn Pro feature</p>
          <p className="text-base text-ink-500">Show lessons and questions on a TV while students answer on their phones. Teaching to phones stays free.</p>
        </div>
      </div>
      <Link href="/pro" className="shrink-0 rounded-xl bg-gold px-4 py-2 text-lg font-semibold text-ink-gold">
        See Learn Pro
      </Link>
    </div>
  );
}
