"use client";

import { ArrowRight, CalendarClock, Crown, Download, GraduationCap, Loader2, Monitor, Package, Percent, QrCode, Radio, Receipt, Store, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomBar, ChoiceTile, ErrorNote, FlowTop, PrimaryButton } from "../../../components/flow/Flow";
import { PLAN_NAME, plansApi, shortDate, ugx, type Checkout, type Cycle, type PlansResponse, type Tier } from "../../../lib/plans";

const RANK: Record<string, number> = { merchant: 0, pro_store: 1, pro_live: 2, elite: 3 };
const ICON = { merchant: QrCode, pro_live: Store, elite: Crown } as const;

/** Plans: pick one. Prices, limits and free/paid come from the admin settings via the server. */
export default function PlansPage() {
  const router = useRouter();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [receipts, setReceipts] = useState<Checkout[]>([]);
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [pick, setPick] = useState<Tier | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [plans, list] = await Promise.all([plansApi.plans(), plansApi.receipts()]);
    if (!plans.ok) { setError(plans.message); return; }
    setData(plans.data);
    if (list.ok) setReceipts(list.data.checkouts.filter((c) => ["active", "scheduled", "failed"].includes(c.status)).slice(0, 5));
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tier") as Tier | null;
    const current = plans.data.current.legacy ? null : plans.data.current.plan === "pro_store" ? "pro_live" : (plans.data.current.plan as Tier);
    const next: Tier = current === "merchant" ? "pro_live" : "elite";
    setPick(wanted && ["merchant", "pro_live", "elite"].includes(wanted) ? wanted : next);
  }
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, []);

  if (!data) {
    return (
      <div className="mx-auto max-w-md">
        <FlowTop title="Plans" onClose={() => router.push("/store")} />
        {error ? <div className="pt-6"><ErrorNote>{error}</ErrorNote></div> : <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>}
      </div>
    );
  }

  const current = data.current.legacy ? "legacy" : data.current.plan === "pro_store" ? "pro_live" : data.current.plan;
  const free = data.pricingMode === "free";
  const choice = pick ?? "elite";
  const price = (t: Tier) => data.plans.find((p) => p.tier === t)?.[cycle] ?? 0;
  const isCurrent = (t: Tier) => current === t;
  const action = (() => {
    if (current === "legacy") return `Choose ${PLAN_NAME[choice]}`;
    if (isCurrent(choice)) return choice === "merchant" ? "" : `Renew ${PLAN_NAME[choice]}`;
    if (RANK[choice] > RANK[current]) return `Upgrade to ${PLAN_NAME[choice]}`;
    return data.downgradesEnabled ? `Move to ${PLAN_NAME[choice]}` : "";
  })();
  const blocked = !action || (choice === "elite" && !data.eliteEnabled) || Boolean(data.paying);

  async function cancelScheduled(id: string) {
    setBusy(true);
    const res = await plansApi.cancel(id);
    setBusy(false);
    if (!res.ok) setError(res.message);
    else void load();
  }

  const feats = (t: Tier): { icon: typeof Package; text: string }[] => {
    const card = data.plans.find((p) => p.tier === t);
    const fee = { icon: Percent, text: `${card?.commissionPercent ?? 0}%` };
    if (t === "merchant") return [{ icon: QrCode, text: "Code pay" }, fee];
    if (t === "pro_live") return [{ icon: Package, text: `${(card?.maxProducts ?? 0).toLocaleString("en-US")} items` }, { icon: Radio, text: "Live" }, fee];
    return [{ icon: Package, text: (card?.maxProducts ?? 0).toLocaleString("en-US") }, { icon: Monitor, text: "POS" }, { icon: Download, text: "Digital" }, { icon: GraduationCap, text: "Courses" }, fee];
  };

  return (
    <div className="mx-auto max-w-md pb-48">
      <FlowTop title="Plans" onClose={() => router.push("/store")} />

      <div className="mx-4 mt-5 grid grid-cols-2 gap-1 rounded-full bg-black p-1.5 dark:bg-[rgb(var(--surface-muted))]" role="radiogroup" aria-label="Billing period">
        {(["monthly", "yearly"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={cycle === c}
            onClick={() => setCycle(c)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-full text-base font-bold ${cycle === c ? "bg-gold text-ink-gold" : "text-white"}`}
          >
            <CalendarClock className="h-5 w-5" /> {c === "monthly" ? "Monthly" : "Yearly"}
            {c === "yearly" && !free && <span className="rounded-full bg-gold/25 px-2 text-xs font-black text-gold">-2 mo</span>}
          </button>
        ))}
      </div>

      {data.scheduled && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-3xl border border-gold/40 bg-gold/10 p-4" data-testid="scheduled-banner">
          <CalendarClock className="h-6 w-6 shrink-0 text-gold" />
          <p className="flex-1 text-sm font-bold text-ink">{PLAN_NAME[data.scheduled.tier]} from {shortDate(data.scheduled.startsAt)}</p>
          <button type="button" disabled={busy} onClick={() => void cancelScheduled(data.scheduled!.id)} className="flex min-h-11 items-center gap-1 rounded-full bg-[rgb(var(--surface-card))] px-4 text-sm font-bold text-ink">
            <X className="h-4 w-4" /> Keep {PLAN_NAME[current] ?? "plan"}
          </button>
        </div>
      )}
      {data.paying && (
        <Link href={`/store/plans/checkout?checkout=${data.paying.id}`} className="mx-4 mt-4 flex min-h-14 items-center gap-3 rounded-3xl bg-gold/15 px-4 text-sm font-bold text-ink">
          <Loader2 className="h-5 w-5 animate-spin text-gold" /> <span className="flex-1">Payment in progress · {data.paying.reference}</span> <ArrowRight className="h-5 w-5" />
        </Link>
      )}

      <div className="mt-4 space-y-3 px-4" role="radiogroup" aria-label="Plans">
        {(["merchant", "pro_live", "elite"] as Tier[]).map((t) => {
          const Icon = ICON[t];
          const here = isCurrent(t);
          const off = t === "elite" && !data.eliteEnabled;
          return (
            <ChoiceTile key={t} selected={choice === t} onClick={() => setPick(t)} disabled={off} className="p-4" testId={`plan-${t}`}>
              {here && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-black px-3 py-0.5 text-xs font-black text-gold dark:bg-gold dark:text-ink-gold">
                  Current{data.current.daysLeft != null && t !== "merchant" ? ` · ${data.current.daysLeft} d` : ""}
                </span>
              )}
              <div className="flex items-start gap-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${t === "elite" ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-black text-ink">{PLAN_NAME[t]}</p>
                  <p className="text-sm font-bold text-ink-500">
                    {t === "merchant" ? "Free" : free ? "Free now" : `${ugx(price(t))} / ${cycle === "monthly" ? "mo" : "yr"}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {feats(t).map((f) => (
                      <span key={f.text} className="inline-flex h-7 items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2.5 text-xs font-bold text-ink">
                        <f.icon className="h-3.5 w-3.5" /> {f.text}
                      </span>
                    ))}
                  </div>
                </div>
                <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${choice === t ? "border-gold bg-gold" : "border-[var(--border-faint)]"}`}>
                  {choice === t && <span className="h-2.5 w-2.5 rounded-full bg-black" />}
                </span>
              </div>
            </ChoiceTile>
          );
        })}
      </div>

      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

      {receipts.length > 0 && (
        <section className="mx-4 mt-6" aria-label="Receipts">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-ink-500"><Receipt className="h-4 w-4" /> Receipts</h2>
          <ul className="divide-y divide-[var(--border-faint)] rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link href={`/store/plans/done?checkout=${r.id}`} className="flex min-h-14 items-center gap-3 px-4 text-sm">
                  <span className="flex-1 font-bold text-ink">{PLAN_NAME[r.tier]} · {r.reference}</span>
                  <span className="font-bold text-ink-500">{r.status === "scheduled" ? "Scheduled" : r.status === "failed" ? "Failed" : ugx(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BottomBar aboveNav>
        <PrimaryButton
          disabled={blocked}
          testId="plans-continue"
          onClick={() => router.push(`/store/plans/checkout?tier=${choice}&cycle=${cycle}`)}
        >
          {action || "Your plan"} <ArrowRight className="h-5 w-5" />
        </PrimaryButton>
      </BottomBar>
    </div>
  );
}
