"use client";

import { Check, Crown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type PlanInfo = {
  plan: "merchant" | "pro_store" | "pro_live" | "elite";
  isElite: boolean;
  isPaidTier: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  legacy: boolean;
  warn?: boolean;
};

type Tier = "merchant" | "pro_live" | "elite";

const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;
const RANK: Record<string, number> = { merchant: 0, pro_store: 1, pro_live: 2, elite: 3 };
const NAME: Record<Tier, string> = { merchant: "Merchant", pro_live: "Merchant Pro", elite: "Merchant Elite" };

/**
 * Merchant, Pro and Elite side by side: which one the store is on, when it ends, and a button to move up or renew.
 * Prices and limits come from the admin's settings; the server decides what is allowed and takes the money.
 */
export function PlanLadder({
  plan, isProFree, proPrice, elitePrice, eliteEnabled, commissionPercent, eliteCommissionPercent,
}: {
  plan?: PlanInfo;
  isProFree: boolean;
  proPrice: number;
  elitePrice: number;
  eliteEnabled: boolean;
  commissionPercent: number;
  eliteCommissionPercent: number;
  /** Kept for callers; plan changes now finish on the Done screen. */
  onChanged?: (store: any, message: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const current = plan?.plan ?? "merchant";
  const legacy = Boolean(plan?.legacy);
  const price = (t: Tier) => (t === "pro_live" ? proPrice : t === "elite" ? elitePrice : 0) * (billingCycle === "yearly" ? 10 : 1);
  const priceLine = (t: Tier) => (t === "merchant" ? "Free" : isProFree ? "Free for now" : `${ugx(price(t))}/${billingCycle === "yearly" ? "year" : "month"}`);
  const isCurrent = (t: Tier) => (t === "pro_live" ? current === "pro_live" || current === "pro_store" : current === t);
  const lower = (t: Tier) => !legacy && RANK[t] < RANK[current];
  const endsOn = plan?.expiresAt ? new Date(plan.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

  // Every change (up, renew or down) goes through Plans → Review → Pay → Verify → Done.
  const open = (tier: Tier) => router.push(`/store/plans?tier=${tier}&cycle=${billingCycle}`);

  const cards: Array<{ tier: Tier; blurb: string }> = [
    { tier: "merchant", blurb: `Take payments with your Merchant Code. A small store with ${commissionPercent}% platform fee.` },
    { tier: "pro_live", blurb: `Full marketplace store, live selling and more products. ${commissionPercent}% fee.` },
    { tier: "elite", blurb: eliteEnabled ? `POS, branch stock, digital products, courses, CRM, supplier purchasing and storefront tools. ${eliteCommissionPercent}% fee.` : "Paused by the platform for now." },
  ];

  return (
    <div id="merchant-plans" className="mt-4 space-y-3">
      {plan?.warn && plan.daysLeft !== null && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-gold/50 bg-gold/10 px-3.5 py-2.5 text-xs">
          <span className="font-semibold text-ink">
            Your {NAME[current === "elite" ? "elite" : "pro_live"]} plan ends {plan.daysLeft <= 0 ? "today" : `in ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}`}. Renew to keep your tools.
          </span>
          <button type="button" onClick={() => open(current === "elite" ? "elite" : "pro_live")} className="shrink-0 rounded-full bg-gold px-3 py-1.5 font-black text-ink-gold">Renew</button>
        </div>
      )}
      {legacy && (
        <p className="rounded-2xl bg-[rgb(var(--surface-muted))] px-3.5 py-2.5 text-xs text-ink-500">
          Your legacy access includes the tools shown below. Choosing a subscription replaces that access with the selected plan and expiry date.
        </p>
      )}

      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="mb-2 font-bold text-ink">Billing period</legend>
        {(["monthly", "yearly"] as const).map(cycle => <label key={cycle} className="flex min-h-11 items-center gap-2"><input type="radio" name="billing-cycle" checked={billingCycle === cycle} onChange={() => setBillingCycle(cycle)} />{cycle === "monthly" ? "Monthly" : "Yearly · 12 months for the price of 10"}</label>)}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="list" aria-label="Plans">
        {cards.map(({ tier, blurb }) => {
          const here = isCurrent(tier) && !legacy;
          const disabled = (here && tier === "merchant") || (tier === "elite" && !eliteEnabled);
          const label = legacy && isCurrent(tier) ? "Choose this plan" : here ? (tier === "merchant" ? "Your plan" : "Renew") : lower(tier) ? "Move down" : tier === "merchant" ? "Choose" : tier === "elite" ? "Upgrade to Elite" : "Choose Pro";
          return (
            <div key={tier} role="listitem" className={`flex flex-col rounded-2xl border p-2.5 text-left ${here ? "border-gold bg-gold/15" : tier === "elite" ? "border-gold/40 bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-black uppercase text-ink-500">
                  {tier === "elite" && <Crown className="h-3 w-3" aria-hidden />}
                  {tier === "merchant" ? "Merchant" : tier === "pro_live" ? "Pro" : "Elite"}
                </span>
                {here && <Check className="h-3.5 w-3.5 text-gold" aria-label="Your plan" />}
              </div>
              <p className="mt-0.5 text-xs font-extrabold text-ink">{priceLine(tier)}</p>
              <p className="mt-1 flex-1 text-xs leading-snug text-ink-500">{blurb}</p>
              {here && endsOn && <p className="mt-1 text-xs font-bold text-ink">Until {endsOn}</p>}
              <button
                type="button"
                disabled={disabled}
                onClick={() => open(tier)}
                className={`mt-2 rounded-full px-2 py-1.5 text-xs font-black disabled:opacity-60 ${here || tier !== "merchant" ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-card))] text-ink-500"}`}
              >
                {label}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}
