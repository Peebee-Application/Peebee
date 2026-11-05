"use client";

import type { MerchantBalance, MerchantPaymentSummary } from "@peebee/shared";
import { AlertCircle, ArrowDownToLine, Briefcase, Building2, ChevronRight, CreditCard, History, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { filterByModule, useModules } from "../lib/modules";

const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

export default function DashboardPage() {
  const { merchant } = useAuth();
  const moduleOn = useModules();
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
  const cashier = merchant.member_role === "cashier";
  const tiles = filterByModule(
    [
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/store", label: "Store", icon: Store, module: "buy.marketplace" },
      { href: "/services", label: "Services", icon: Briefcase },
      { href: "/outlets", label: "Outlets", icon: Building2 },
      { href: "/deliveries", label: "Deliveries", icon: Truck },
      ...(cashier ? [] : [{ href: "/activity", label: "Ledger", icon: History }]),
    ],
    moduleOn,
  );
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header>
      <h1 className="text-3xl font-black leading-tight text-ink">{merchant.display_name}</h1>
      {merchant.merchant_code && <p className="mt-1 font-mono text-base text-ink-500">Code · {merchant.merchant_code}</p>}
    </header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {merchant.status !== "active" && <Link href="/account" className="home-card flex items-center gap-3 border-l-4 border-l-gold"><AlertCircle className="h-7 w-7 shrink-0 text-gold" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-lg font-bold">Application {merchant.status.replaceAll("_", " ")}</span><span className="block text-base text-ink-500">Complete verification</span></span><ChevronRight className="h-6 w-6 text-ink-500" aria-hidden /></Link>}
    {merchant.environment === "sandbox" && <p className="rounded-full bg-sky-50 px-4 py-2 text-center text-base font-bold text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">Test mode · no real money moves</p>}

    {!cashier ? <section className="rounded-[24px] border border-white/10 bg-black-900 p-5 text-white shadow-lg dark:bg-black-900" aria-label="Balance">
      <p className="text-base text-white/70">Available to settle</p>
      <p className="mt-1 text-4xl font-black tabular-nums">{ugx(balance?.available ?? 0)}</p>
      <p className="mt-2 text-base text-white/70">Held {ugx(balance?.held ?? 0)} · Settling {ugx(balance?.settling ?? 0)}</p>
      <Link href="/wallet" className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-full bg-gold text-lg font-bold text-ink-gold"><ArrowDownToLine className="h-6 w-6" aria-hidden />Withdraw</Link>
    </section> : <section className="rounded-[24px] border border-white/10 bg-black-900 p-5 text-white dark:bg-black-900"><p className="text-base text-white/70">Cashier</p><p className="mt-1 text-2xl font-black">Confirm payments for your outlet</p></section>}

    {pending.length > 0 && <Link href="/payments" className="home-card flex items-center gap-3 border-l-4 border-l-gold"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold"><ShieldCheck className="h-7 w-7" aria-hidden /></span><span className="min-w-0 flex-1 text-lg font-bold">{pending.length} payment{pending.length === 1 ? "" : "s"} to confirm</span><ChevronRight className="h-6 w-6 text-ink-500" aria-hidden /></Link>}

    <nav aria-label="Business" className="grid grid-cols-2 gap-3">
      {tiles.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="home-card flex min-h-24 flex-col items-center justify-center gap-2 !p-3 text-center">
          <Icon className="h-8 w-8 text-gold" aria-hidden />
          <span className="text-lg font-bold text-ink">{label}</span>
        </Link>
      ))}
    </nav>

    <section className="home-card space-y-3" aria-label="Recent sales">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Recent sales</h2>{payments.length > 0 && <Link href="/payments" className="min-h-11 px-2 text-base font-bold leading-[2.75rem] text-gold">See all</Link>}</div>
      {payments.slice(0, 3).map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3"><span className="min-w-0"><span className="block truncate text-lg font-semibold">{payment.outlet_name}</span><span className="block truncate text-base text-ink-500">{payment.status.replaceAll("_", " ")}</span></span><strong className="shrink-0 text-lg tabular-nums">{ugx(payment.amount)}</strong></div>)}
      {payments.length === 0 && <p className="py-2 text-center text-lg text-ink-500">No sales yet</p>}
    </section>
  </div>;
}
