"use client";

import Link from "next/link";
import { ArrowRight, Crown, Package, UserRound, Check } from "lucide-react";
import type { SalesTier, StoreSales } from "../../lib/store-sales";
import { salesPrice, upgradeHref } from "../../lib/store-sales";
import { card, goldBtn } from "./StoreUI";

export function SalesLoading({ error, retry }: { error?: string; retry: () => void }) {
  return <section className={`${card} space-y-3 p-5`}>
    <p role={error ? "alert" : "status"} className="text-lg text-ink">{error || "Loading plans…"}</p>
    {error && <button type="button" onClick={retry} className="min-h-12 rounded-full border-2 border-gold px-5 font-bold text-ink">Try again</button>}
  </section>;
}
export function PlanChoice({ tier, data, selected, onClick }: { tier: SalesTier; data: StoreSales; selected: boolean; onClick?: () => void }) {
  const Icon = tier === "pro" ? Package : Crown;
  return <button type="button" role="tab" id={`sales-tab-${tier}`} aria-selected={selected} aria-controls="sales-plan-panel" tabIndex={selected ? 0 : -1}
    onClick={onClick} data-testid={`sales-choice-${tier}`}
    className={`relative flex min-h-[176px] min-w-0 flex-col items-start rounded-[26px] border-[3px] p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:min-h-[200px] sm:p-5 ${selected ? "border-gold bg-black text-white shadow-[0_8px_24px_rgb(var(--gold)/0.2)]" : `${card} text-ink`}`}>
    <span className={`mb-3 grid h-12 w-12 place-items-center rounded-[16px] ${selected ? "bg-cream text-ink-gold" : "bg-gold/15 text-gold"}`}><Icon className="h-8 w-8" aria-hidden /></span>
    {selected && <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-gold text-ink-gold"><Check className="h-4 w-4" strokeWidth={3} aria-hidden /></span>}
    <span className="text-[27px] font-black leading-tight sm:text-[32px]">{tier === "pro" ? "Pro" : "Elite"}</span>
    <span className={`mt-1 text-[17px] font-semibold ${selected ? "text-white/85" : "text-ink-500"}`}>{tier === "pro" ? "Sell online" : "Run it all"}</span>
    <span className="mt-3 rounded-full bg-cream px-3 py-1 text-sm font-black text-ink-gold">{data.plans[tier].enabled ? salesPrice(data.plans[tier].monthly) : "Currently unavailable"}</span>
  </button>;
}
export function UpgradeAction({ data, tier, compact = false, dark = false }: { data: StoreSales; tier: SalesTier; compact?: boolean; dark?: boolean }) {
  const name = tier === "pro" ? "Pro" : "Elite";
  const actionClass = `${goldBtn} ${dark ? "!bg-black !text-white border-2 border-gold" : ""} ${compact ? "!gap-1 !px-2 !text-[13px] sm:!text-base" : ""}`;
  if (!data.plans[tier].enabled) return <p role="status" className="rounded-2xl bg-gold/10 p-4 text-center text-base font-bold text-ink">Elite is currently unavailable. You can still compare its tools.</p>;
  if (!data.canUpgrade) return <div className="space-y-3">
    <Link href="/account/team" className={actionClass}>Ask your owner about {name}<ArrowRight className="h-5 w-5 shrink-0" aria-hidden /></Link>
    {!compact && <p className="flex items-center justify-center gap-2 text-center text-sm text-ink-500"><UserRound className="h-4 w-4 shrink-0" aria-hidden />The business owner confirms plan changes.</p>}
  </div>;
  return <Link href={upgradeHref(data, tier)} className={actionClass} data-testid={`upgrade-${tier}`}>Upgrade to {name}<ArrowRight className={`${compact ? "h-4 w-4" : "h-6 w-6"} shrink-0`} aria-hidden /></Link>;
}
