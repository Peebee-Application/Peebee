"use client";

import type { Stage } from "@tuma/shared";
import { ChevronRight, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatUgx } from "../lib/order-display";

/** Teaser card for a rider's Stage Savings Circle — mirrors the active-order
 * tracker's floating-card pattern. Before joining a circle it still shows a
 * compact invite card (so the feature is discoverable at all) rather than
 * disappearing outright. `context` says where this instance lives, so it
 * only renders itself where the admin-configured placement setting says it
 * should (Home, or the Wallet screen) — the other two placement modes
 * (bottom-nav tab / Account link) render nothing here at all.
 *
 * Fetches only GET /stages/mine, which already includes each stage's pot —
 * no follow-up GET /stages/:id, so this shows up in one round trip instead
 * of two sequential ones. */
export function StageSavingsCard({ context = "home" }: { context?: "home" | "wallet" }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [placement, setPlacement] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getMyStages(), api.getSettings().catch(() => null)])
      .then(([res, settingsRes]) => {
        if (cancelled) return;
        if (settingsRes) setPlacement(settingsRes.settings.vslaFeaturePlacement);
        if (res.stages.length > 0) setStage(res.stages[0]);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const wantsHome = placement === "home_card_and_screen" || placement == null;
  const wantsWallet = placement === "wallet_card";
  const shouldRender = context === "home" ? wantsHome : wantsWallet;

  if (!checked || !shouldRender) return null;

  const pot = stage?.pot ?? null;

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
          <span className="block text-sm font-bold">RSLA</span>
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
