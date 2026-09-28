"use client";

import type { Stage } from "@tuma/shared";
import { ChevronRight, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatUgx } from "../lib/order-display";

/** Home-screen teaser for a rider's Stage Savings Circle — mirrors the
 * active-order tracker's floating-card pattern. Before joining a circle it
 * still shows a compact invite card (so the feature is discoverable at
 * all) rather than disappearing outright — only the other two placement
 * modes (their own nav tab / an Account link) hide it here entirely. */
export function StageSavingsCard() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [pot, setPot] = useState<number | null>(null);
  const [placement, setPlacement] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getMyStages(), api.getSettings().catch(() => null)])
      .then(async ([res, settingsRes]) => {
        if (cancelled) return;
        if (settingsRes) setPlacement(settingsRes.settings.vslaFeaturePlacement);
        if (res.stages.length > 0) {
          const mine = res.stages[0];
          setStage(mine);
          const detail = await api.getStage(mine.id).catch(() => null);
          if (!cancelled && detail) setPot(detail.pot);
        }
        if (!cancelled) setChecked(true);
      })
      .catch(() => setChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked || placement === "bottom_nav_tab" || placement === "account_only") return null;

  if (!stage) {
    return (
      <Link
        href="/savings"
        className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#153A75] to-[#0C2245] p-4 text-white shadow-sm"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/25 text-gold">
          <PiggyBank className="h-5 w-5" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Stage savings</span>
          <span className="block text-xs text-white/75">Join or start your stage&apos;s savings circle</span>
        </span>
        <ChevronRight className="h-4.5 w-4.5 shrink-0 text-white/70" strokeWidth={2} aria-hidden />
      </Link>
    );
  }

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
