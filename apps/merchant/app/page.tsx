"use client";

import type { MerchantBalance, MerchantPaymentSummary } from "@peebee/shared";
import { AlertCircle, ArrowDownToLine, Building2, ChevronRight, CreditCard, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

export default function DashboardPage() {
  const { merchant } = useAuth();
  const [balance, setBalance] = useState<MerchantBalance | null>(null);
  const [payments, setPayments] = useState<MerchantPaymentSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!merchant) return;
    if (merchant.member_role === "cashier") {
      api.merchantPayments(merchant.id).then((result) => setPayments(result.payments)).catch((cause) => setError(errorMessage(cause)));
    } else {
      Promise.all([api.merchantBalance(merchant.id), api.merchantPayments(merchant.id)])
        .then(([balanceResult, paymentResult]) => { setBalance(balanceResult.balance); setPayments(paymentResult.payments); })
        .catch((cause) => setError(errorMessage(cause)));
    }
  }, [merchant]);

  if (!merchant) return null;
  const pending = payments.filter((payment) => payment.status === "awaiting_confirmation");
  return <div className="space-y-5 px-4 py-5">
    <header><p className="text-sm text-ink-500">Welcome back</p><h1 className="text-2xl font-black text-ink">{merchant.display_name}</h1>{merchant.merchant_code && <p className="mt-1 font-mono text-xs text-ink-500">Business code · {merchant.merchant_code}</p>}</header>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {merchant.status !== "active" && <section className="home-card flex gap-3 border-l-4 border-l-gold"><AlertCircle className="h-5 w-5 shrink-0 text-gold"/><div><p className="font-bold">Application {merchant.status.replaceAll("_", " ")}</p><p className="text-xs text-ink-500">Complete business verification while Peebee reviews your account. {merchant.environment === "sandbox" ? "Simulated payment acceptance" : "Live payment acceptance"} begins after approval.</p><Link href="/account" className="mt-2 inline-block text-xs font-bold text-gold">Complete verification →</Link></div></section>}
    {merchant.environment === "sandbox" && <section className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100"><strong>Safe test mode.</strong> Payments and withdrawals behave like live transactions, including pending and failed states, but no real money moves.</section>}
    {merchant.member_role !== "cashier" ? <section className="rounded-[24px] bg-navy p-5 text-white shadow-lg dark:bg-[#153A75]"><p className="text-xs text-white/70">Available to settle</p><p className="mt-2 text-3xl font-black">{ugx(balance?.available ?? 0)}</p><div className="mt-4 flex gap-5 text-xs text-white/75"><span>Held {ugx(balance?.held ?? 0)}</span><span>Settling {ugx(balance?.settling ?? 0)}</span></div><Link href="/wallet" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-full bg-gold font-bold text-ink-gold"><ArrowDownToLine className="h-4 w-4"/>Withdraw or schedule</Link></section> : <section className="rounded-[24px] bg-navy p-5 text-white dark:bg-[#153A75]"><p className="text-xs text-white/70">Cashier workspace</p><p className="mt-2 text-xl font-black">Confirm payments for your assigned outlet</p><p className="mt-2 text-xs text-white/70">Business-wide balances and settlements are limited to finance roles.</p></section>}
    {pending.length > 0 && <Link href="/payments" className="home-card flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/15 text-gold"><ShieldCheck/></span><span className="flex-1"><span className="block font-bold">{pending.length} payment{pending.length === 1 ? "" : "s"} to confirm</span><span className="text-xs text-ink-500">Check goods and exact amounts before accepting.</span></span><ChevronRight className="h-5 w-5 text-ink-500"/></Link>}
    <div className="grid grid-cols-2 gap-3">
      <Link href="/payments" className="home-card !p-4"><CreditCard className="h-5 w-5 text-gold"/><p className="mt-3 text-sm font-bold">Payments</p><p className="text-xs text-ink-500">Confirm and dispute</p></Link>
      <Link href="/outlets" className="home-card !p-4"><Building2 className="h-5 w-5 text-gold"/><p className="mt-3 text-sm font-bold">Outlets</p><p className="text-xs text-ink-500">Codes and locations</p></Link>
    </div>
    <section className="home-card space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">Recent sales</h2>{merchant.member_role !== "cashier" && <Link href="/activity" className="text-xs font-bold text-gold">View ledger</Link>}</div>{payments.slice(0, 4).map((payment) => <div key={payment.id} className="flex items-center justify-between border-t border-[var(--border-faint)] pt-3 text-sm"><span><span className="block font-semibold">{payment.outlet_name}</span><span className="text-xs text-ink-500">{payment.rider_name} · {payment.status.replaceAll("_", " ")}</span></span><strong>{ugx(payment.amount)}</strong></div>)}{payments.length === 0 && <p className="text-sm text-ink-500">No merchant payments yet.</p>}</section>
  </div>;
}
