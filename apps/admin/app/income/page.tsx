"use client";

import { Banknote } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { TabBar } from "../../components/TabBar";
import { requestErrorMessage } from "../../lib/admin-request";
import { loadIncome, type IncomeRange, type IncomeRow } from "../../lib/income";
import { formatUgx } from "../../lib/order-display";

type Range = IncomeRange;

const KIND: Record<string, string> = { commission: "Commission", fee: "Fee", subscription: "Subscription", ads: "Advertising", deposit: "Deposit kept", other: "Other" };

const RANGES: { id: Range; label: string }[] = [{ id: "today", label: "Today" }, { id: "week", label: "7 days" }, { id: "month", label: "30 days" }, { id: "all", label: "All time" }];
/** Every way Peebee earns, grouped by area, with what each stream is and, where it is tracked, how much it made. */
export default function IncomePage() {
  const [range, setRange] = useState<Range>("month");
  const [data, setData] = useState<Awaited<ReturnType<typeof loadIncome>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadIncome(range)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(requestErrorMessage(err)); });
    return () => { alive = false; };
  }, [range]);

  if (error) return <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!data) return <div className="p-4 text-base text-ink-500">Loading…</div>;
  const { income, rows, total, counted: tracked } = data;

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h1 className="text-2xl font-extrabold text-ink">How Peebee earns</h1>
      <TabBar label="Period" active={range} onChange={setRange} tabs={RANGES.map((r) => ({ id: r.id, label: r.label, icon: Banknote }))} />

      <section className="home-card !bg-black-700 text-white dark:!bg-black">
        <p className="text-sm font-semibold text-white/70">Platform income, {RANGES.find((r) => r.id === range)!.label.toLowerCase()}</p>
        <p className="mt-1 text-4xl font-extrabold text-gold">{formatUgx(total)}</p>
        <p className="mt-1 text-sm text-white/70">{tracked} of {rows.length} streams are totalled here. The rest are listed so none is missed.</p>
      </section>

      {income.groups.map((g) => {
        const list = rows.filter((r: IncomeRow) => r.group === g.id);
        const sum = list.reduce((s, r) => s + (r.value ?? 0), 0);
        return (
          <Accordion key={g.id} title={g.label} icon={Banknote} summary={formatUgx(sum)} defaultOpen={sum > 0}>
            <ul className="space-y-3">
              {list.map((r) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-extrabold text-ink">{r.label}</span>
                      <span className="mt-0.5 inline-block rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-bold text-ink">{KIND[r.kind] ?? r.kind}</span>
                      <span className="mt-1.5 block text-sm text-ink-500">{r.how}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      {r.value != null ? <span className="text-xl font-extrabold text-ink">{formatUgx(r.value)}{r.partial ? <span className="block text-xs font-semibold text-ink-500">may be low</span> : null}</span> : <span className="text-sm font-semibold text-ink-500">Not totalled yet</span>}
                    </span>
                  </>
                );
                const cls = "flex min-h-16 items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3";
                return <li key={r.key}>{r.href ? <Link href={r.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
              })}
            </ul>
          </Accordion>
        );
      })}
      <p className="text-xs text-ink-500">Showing {income.environment} figures. Income is gross: it does not yet take off costs such as payment processing or payouts.</p>
    </div>
  );
}
