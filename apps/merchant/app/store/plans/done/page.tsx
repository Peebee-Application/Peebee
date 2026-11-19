"use client";

import { ArrowRight, CalendarCheck, CalendarClock, Crown, Loader2, Printer, QrCode, ShieldCheck, Store, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BottomBar, ErrorNote, FlowTop, GhostButton, PrimaryButton } from "../../../../components/flow/Flow";
import { PLAN_NAME, plansApi, shortDate, ugx, type Checkout } from "../../../../lib/plans";

const VIA: Record<string, string> = { wallet: "Wallet", mobile_money: "Mobile money", card: "Card", free: "Free" };
const ICON = { merchant: QrCode, pro_live: Store, elite: Crown } as const;

function Done() {
  const router = useRouter();
  const [c, setC] = useState<Checkout | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /** A move down waits for the end of the plan in force; until then the owner can keep the plan. */
  async function keepPlan() {
    if (!c) return;
    setBusy(true);
    setError("");
    const res = await plansApi.cancel(c.id);
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    router.push("/store/plans");
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("checkout");
    const load = id ? plansApi.get(id) : Promise.resolve(null);
    void load.then((res) => (!res ? setError("Receipt not found.") : res.ok ? setC(res.data.checkout) : setError(res.message)));
  }, []);

  if (!c) {
    return (
      <div className="mx-auto max-w-md">
        <FlowTop title="Done" onClose={() => router.push("/store")} />
        {error ? <div className="pt-6"><ErrorNote>{error}</ErrorNote></div> : <div className="flex justify-center py-24"><Loader2 className="h-9 w-9 animate-spin text-gold" /></div>}
      </div>
    );
  }

  const scheduled = c.status === "scheduled";
  const moveDown = c.kind === "downgrade";
  const fromName = PLAN_NAME[c.fromPlan] ?? (c.fromPlan === "legacy" ? "Pro" : "your plan");
  const Icon = ICON[c.tier] ?? Crown;
  return (
    <div className="mx-auto max-w-md pb-48">
      <FlowTop title="Done" onClose={() => router.push("/store")} />
      <div className="flex flex-col items-center gap-4 px-4 pt-6 text-center">
        <div className="relative">
          <span className="absolute inset-0 -m-6 rounded-full bg-gold/20 blur-2xl" aria-hidden />
          <span className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gold text-ink-gold shadow-[0_12px_40px_rgb(var(--gold)/0.4)]">
            {scheduled ? <CalendarClock className="h-16 w-16" strokeWidth={2} /> : <Icon className="h-16 w-16" strokeWidth={2} />}
          </span>
        </div>
        <p className="text-3xl font-black text-ink" data-testid="done-title">{scheduled ? `${PLAN_NAME[c.tier]} from ${shortDate(c.startsAt)}` : `${PLAN_NAME[c.tier]} is on`}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-green/10 px-3 text-sm font-bold text-green"><ShieldCheck className="h-4 w-4" /> {c.verifyMethod === "session" ? "Confirmed" : "Verified"}</span>
          {c.expiresAt && !scheduled && <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-sm font-bold text-ink"><CalendarCheck className="h-4 w-4" /> Until {shortDate(c.expiresAt)}</span>}
        </div>
        {scheduled && moveDown && <p className="max-w-xs text-base text-ink-500" data-testid="done-keep-note">You keep {fromName} until then. Changed your mind? Keep your plan any time before that day.</p>}
      </div>

      <dl className="mx-4 mt-6 space-y-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-base" data-testid="receipt">
        <div className="flex justify-between"><dt className="text-ink-500">{moveDown ? "To pay" : "Paid"}</dt><dd className="font-black text-ink">{ugx(c.amount)}</dd></div>
        {c.credit > 0 && <div className="flex justify-between"><dt className="text-ink-500">Credit</dt><dd className="font-bold text-green">− {ugx(c.credit)}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink-500">Via</dt><dd className="font-bold text-ink">{VIA[c.method] ?? c.method}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-500">Ref</dt><dd className="font-mono font-bold text-ink">{c.reference}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-500">Date</dt><dd className="font-bold text-ink">{shortDate(c.verifiedAt ?? c.createdAt)}</dd></div>
      </dl>
      {error && <div className="px-4 pt-4"><ErrorNote>{error}</ErrorNote></div>}

      <BottomBar aboveNav>
        {scheduled && moveDown && (
          <GhostButton onClick={() => void keepPlan()} disabled={busy} testId="done-keep-plan"><Undo2 className="h-5 w-5 shrink-0" /> <span className="whitespace-nowrap">Keep {fromName}</span></GhostButton>
        )}
        {!(scheduled && moveDown) && <GhostButton square label="Print receipt" onClick={() => window.print()}><Printer className="h-6 w-6" /></GhostButton>}
        <PrimaryButton onClick={() => router.push(scheduled ? "/store/plans" : "/store")}>
          {scheduled ? "Plans" : `Open ${PLAN_NAME[c.tier]} tools`} <ArrowRight className="h-5 w-5" />
        </PrimaryButton>
      </BottomBar>
    </div>
  );
}

export default function PlanDonePage() {
  return (
    <Suspense fallback={null}>
      <Done />
    </Suspense>
  );
}
