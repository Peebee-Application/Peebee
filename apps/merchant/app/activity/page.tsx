"use client";

import type { MerchantDispute, MerchantTransaction } from "@peebee/shared";
import { History, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { TabBar } from "../../components/TabBar";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (amount: number) => `${amount >= 0 ? "+" : "−"} UGX ${Math.abs(Number(amount)).toLocaleString()}`;

export default function ActivityPage() {
  const { merchant } = useAuth();
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [disputes, setDisputes] = useState<MerchantDispute[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"transactions" | "disputes">("transactions");
  const [limit, setLimit] = useState(10);
  useEffect(() => { if (!merchant) return; Promise.all([api.merchantTransactions(merchant.id), api.merchantDisputes(merchant.id)]).then(([t, d]) => { setTransactions(t.transactions); setDisputes(d.disputes); }).catch((cause) => setError(errorMessage(cause))); }, [merchant]);
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header><h1 className="text-3xl font-black">Ledger</h1></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    <TabBar label="Ledger" active={tab} onChange={setTab} tabs={[{ id: "transactions", label: "Money", icon: History }, { id: "disputes", label: "Disputes", icon: ShieldAlert, count: disputes.length }]} />
    {tab === "transactions" && <section className="home-card space-y-3" role="tabpanel" aria-label="Money">
      {transactions.slice(0, limit).map((t) => <div key={`${t.id}-${t.purpose}`} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3 first:border-0 first:pt-0"><span className="min-w-0"><span className="block truncate text-lg font-semibold">{t.description || t.kind.replaceAll("_", " ")}</span><span className="block truncate text-base text-ink-500">{new Date(`${t.created_at.replace(" ", "T")}Z`).toLocaleDateString()} · {t.purpose.replaceAll("_", " ")}</span></span><strong className={`shrink-0 text-lg tabular-nums ${t.amount >= 0 ? "text-green" : "text-ink"}`}>{ugx(t.amount)}</strong></div>)}
      {transactions.length === 0 && <p className="py-4 text-center text-lg text-ink-500">Nothing yet</p>}
      {transactions.length > limit && <button type="button" onClick={() => setLimit((n) => n + 10)} className="min-h-14 w-full rounded-full border border-gold text-lg font-bold text-gold">Show more ({transactions.length - limit})</button>}
    </section>}
    {tab === "disputes" && <section className="home-card space-y-3" role="tabpanel" aria-label="Disputes">
      {disputes.map((d) => <div key={d.id} className="border-t border-[var(--border-faint)] pt-3 first:border-0 first:pt-0"><div className="flex justify-between text-lg"><strong className="capitalize">{d.status.replaceAll("_", " ")}</strong><span className="tabular-nums">{d.amount ? `UGX ${d.amount.toLocaleString()}` : ""}</span></div><p className="mt-1 text-base text-ink-500">{d.reason}</p></div>)}
      {disputes.length === 0 && <p className="py-4 text-center text-lg text-ink-500">No disputes</p>}
    </section>}
  </div>;
}
