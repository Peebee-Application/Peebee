"use client";

import { Select } from "@peebee/shared/select";

import type { MerchantBalance, MerchantSettlement, MerchantSettlementAccount } from "@peebee/shared";
import { AlertTriangle, ArrowDownToLine, CheckCircle2, History, Loader2, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { TabBar } from "../../components/TabBar";

const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

export default function WalletPage() {
  const { merchant } = useAuth();
  const [balance, setBalance] = useState<MerchantBalance | null>(null);
  const [accounts, setAccounts] = useState<MerchantSettlementAccount[]>([]);
  const [history, setHistory] = useState<MerchantSettlement[]>([]);
  const [phone, setPhone] = useState("");
  const [network, setNetwork] = useState<"MTN" | "Airtel">("MTN");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"instant" | "scheduled">("scheduled");
  const [quote, setQuote] = useState<{ id: string; amount: number; fee: number; totalDebit: number } | null>(null);
  const [settlement, setSettlement] = useState<MerchantSettlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"withdraw" | "history">("withdraw");

  const maySettle = merchant?.member_role === "owner" || merchant?.member_role === "finance";
  const load = useCallback(async () => {
    setError(""); setBalance(null); setAccounts([]); setHistory([]);
    if (!merchant || !maySettle) return;
    const [b, a, s] = await Promise.all([api.merchantBalance(merchant.id), api.merchantSettlementAccounts(merchant.id), api.merchantSettlements(merchant.id)]);
    setBalance(b.balance); setAccounts(a.settlementAccounts); setHistory(s.settlements);
  }, [merchant, maySettle]);
  useEffect(() => { load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  useEffect(() => {
    if (!merchant || !settlement || !["reserved", "submitted", "pending", "unknown"].includes(settlement.status)) return;
    const timer = window.setInterval(() => api.refreshMerchantSettlement(merchant.id, settlement.id).then((r) => { setSettlement(r.settlement); if (["successful", "failed"].includes(r.settlement.status)) void load(); }).catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [load, merchant, settlement]);
  const verified = useMemo(() => accounts.find((a) => a.status === "verified" && (!a.cooling_until || Date.parse(a.cooling_until) <= Date.now())), [accounts]);

  async function addDestination() {
    if (!merchant) return; setBusy(true); setError("");
    try { await api.addMerchantSettlementAccount(merchant.id, { type: "momo", provider: network.toLowerCase(), accountRef: phone, accountName: merchant.legal_name, networkOrBank: network }); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function getQuote() {
    if (!merchant || !verified) return; const numeric = Number(amount);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) { setError("Enter a whole UGX amount above zero."); return; }
    setBusy(true); setError("");
    try { setQuote((await api.quoteMerchantSettlement(merchant.id, { settlementAccountId: verified.id, amount: numeric, mode })).quote); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!merchant || !quote) return; setBusy(true); setError("");
    try { const result = await api.createMerchantSettlement(merchant.id, quote.id, crypto.randomUUID()); setSettlement(result.settlement); setQuote(null); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  const input = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-4 text-lg";
  const big = "min-h-14 w-full rounded-full bg-gold text-lg font-bold text-ink-gold disabled:opacity-50";
  if (!maySettle) return <div className="space-y-4 px-4 pb-6 pt-5"><h1 className="text-3xl font-black">Wallet</h1><p className="home-card text-lg">Only the business owner or finance team can see balances and withdraw.</p></div>;
  if (error || !balance) return <div className="space-y-4 px-4 pb-6 pt-5"><h1 className="text-3xl font-black">Wallet</h1><p role="status" className="text-lg">{error || "Loading balances…"}</p>{error && <button className="min-h-14 rounded-full border border-gold px-6 text-lg font-bold" onClick={() => void load().catch(cause => setError(errorMessage(cause)))}>Try again</button>}</div>;
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header><h1 className="text-3xl font-black">Wallet</h1></header>
    <section className="rounded-[24px] border border-white/10 bg-black-900 p-5 text-center text-white dark:bg-black-900" aria-label="Balance">
      <WalletCards className="mx-auto h-8 w-8 text-gold" aria-hidden />
      <p className="mt-1 text-4xl font-black tabular-nums">{ugx(balance?.available ?? 0)}</p>
      <p className="mt-1 text-base text-white/70">Available</p>
      <p className="mt-2 text-base text-white/70">Held {ugx(balance?.held ?? 0)} · Settling {ugx(balance?.settling ?? 0)}</p>
    </section>
    {error && <p role="alert" className="flex gap-2 rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</p>}
    {settlement && <section className="home-card flex items-center gap-3">{settlement.status === "successful" ? <CheckCircle2 className="h-7 w-7 text-green" /> : <Loader2 className="h-7 w-7 animate-spin text-gold" />}<div><p className="text-lg font-bold capitalize">Withdrawal {settlement.status}</p><p className="text-base text-ink-500">Do not retry a pending transfer.</p></div></section>}

    <TabBar label="Wallet" active={tab} onChange={setTab} tabs={[{ id: "withdraw", label: "Withdraw", icon: ArrowDownToLine }, { id: "history", label: "History", icon: History, count: history.length }]} />

    {tab === "withdraw" && (!verified
      ? <section className="home-card space-y-3" role="tabpanel" aria-label="Withdraw">
          <h2 className="text-xl font-bold">Where should we send money?</h2>
          <p className="text-base text-ink-500">{merchant?.environment === "sandbox" ? "Peebee verifies the number first (no waiting period in test mode)." : "Peebee verifies the number and applies a 24-hour wait before first use."}</p>
          {accounts.map((a) => <p key={a.id} className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-base">{a.network_or_bank} {a.masked_account_ref} · {a.status.replaceAll("_", " ")}</p>)}
          <Select aria-label="Mobile Money network" value={network} onValueChange={(value) => setNetwork(value as "MTN" | "Airtel")} className={input}><option>MTN</option><option>Airtel</option></Select>
          <input id="settlement-phone" aria-label="Mobile Money number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile Money number" className={input} />
          <button disabled={busy || phone.trim().length < 6} onClick={addDestination} className={big}>Save number</button>
        </section>
      : <section className="home-card space-y-3" role="tabpanel" aria-label="Withdraw">
          <p className="text-base text-ink-500">To {verified.network_or_bank} {verified.masked_account_ref}</p>
          <input id="settlement-amount" aria-label="Amount in UGX" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "")); setQuote(null); }} placeholder="Amount in UGX" className={`${input} !min-h-16 text-2xl font-bold tabular-nums`} />
          <Select aria-label="Settlement mode" value={mode} onValueChange={(value) => { setMode(value as "instant" | "scheduled"); setQuote(null); }} className={input}><option value="scheduled">Scheduled</option><option value="instant">Instant</option></Select>
          {!quote
            ? <button disabled={busy || !amount} onClick={getQuote} className={big}>Review</button>
            : <div className="space-y-2 rounded-xl border border-gold/40 p-4 text-lg"><p className="flex justify-between"><span>You receive</span><strong>{ugx(quote.amount)}</strong></p><p className="flex justify-between"><span>Fee</span><strong>{ugx(quote.fee)}</strong></p><p className="flex justify-between border-t border-[var(--border-faint)] pt-2"><span>Total</span><strong>{ugx(quote.totalDebit)}</strong></p><button disabled={busy} onClick={confirm} className={`${big} mt-2`}>Confirm</button></div>}
        </section>)}

    {tab === "history" && <section className="home-card space-y-3" role="tabpanel" aria-label="History">
      {history.slice(0, 10).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3 first:border-0 first:pt-0"><span><span className="block text-lg font-semibold capitalize">{item.mode ?? "withdrawal"}</span><span className="block text-base text-ink-500">{item.status}</span></span><strong className="text-lg tabular-nums">{ugx(item.amount)}</strong></div>)}
      {history.length === 0 && <p className="py-4 text-center text-lg text-ink-500">Nothing yet</p>}
    </section>}
  </div>;
}
