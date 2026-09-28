"use client";

import type { Stage } from "@tuma/shared";
import { ChevronRight, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatUgx } from "../lib/order-display";

/** Home-screen teaser for a rider's Stage Savings Circle — mirrors the
 * active-order tracker's floating-card pattern. Renders nothing if the
 * rider isn't in a circle yet, so it never intrudes before they've joined. */
export function StageSavingsCard() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [pot, setPot] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMyStages()
      .then(async (res) => {
        if (cancelled || res.stages.length === 0) return;
        const mine = res.stages[0];
        setStage(mine);
        const detail = await api.getStage(mine.id).catch(() => null);
        if (!cancelled && detail) setPot(detail.pot);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stage) return null;

  return (
    <Link
      href={`/savings/${stage.id}`}
      className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#153A75] to-[#0C2245] p-4 text-white shadow-sm"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/25 text-gold">
        <PiggyBank className="h-5 w-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wide text-white/80">{stage.name}</span>
        <span className="block text-lg font-extrabold">{pot != null ? formatUgx(pot) : "—"}</span>
      </span>
      <ChevronRight className="h-4.5 w-4.5 shrink-0 text-white/70" strokeWidth={2} aria-hidden />
    </Link>
  );
}
