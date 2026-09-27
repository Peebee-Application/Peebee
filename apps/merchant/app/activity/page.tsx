"use client";

import type { MerchantDispute, MerchantTransaction } from "@tuma/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (amount: number) => `${amount >= 0 ? "+" : "−"} UGX ${Math.abs(Number(amount)).toLocaleString()}`;

export default function ActivityPage() {
  const { merchant } = useAuth();
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [disputes, setDisputes] = useState<MerchantDispute[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { if (!merchant) return; Promise.all([api.merchantTransactions(merchant.id), api.merchantDisputes(merchant.id)]).then(([t, d]) => { setTransactions(t.transactions); setDisputes(d.disputes); }).catch((cause) => setError(errorMessage(cause))); }, [merchant]);
  return <div className="space-y-5 px-4 py-5"><header><h1 className="text-2xl font-black">Ledger activity</h1><p className="text-sm text-ink-500">An immutable history of sales, holds, releases, and settlements.</p></header>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {disputes.length > 0 && <section className="home-card space-y-3"><h2 className="font-bold">Disputes</h2>{disputes.map((d) => <div key={d.id} className="border-t border-[var(--border-faint)] pt-3 text-sm"><div className="flex justify-between"><strong>{d.status.replaceAll("_", " ")}</strong><span>{d.amount ? `UGX ${d.amount.toLocaleString()}` : ""}</span></div><p className="mt-1 text-xs text-ink-500">{d.reason}</p></div>)}</section>}
    <section className="home-card space-y-3"><h2 className="font-bold">Transactions</h2>{transactions.map((t) => <div key={`${t.id}-${t.purpose}`} className="flex justify-between gap-3 border-t border-[var(--border-faint)] pt-3 text-sm"><span><span className="block font-semibold">{t.description || t.kind.replaceAll("_", " ")}</span><span className="text-xs text-ink-500">{new Date(`${t.created_at.replace(" ", "T")}Z`).toLocaleString()} · {t.purpose.replaceAll("_", " ")}</span></span><strong className={t.amount >= 0 ? "text-green" : "text-ink"}>{ugx(t.amount)}</strong></div>)}{transactions.length === 0 && <p className="text-sm text-ink-500">No ledger entries yet.</p>}</section>
  </div>;
}
