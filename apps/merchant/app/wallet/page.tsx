"use client";

import type { MerchantBalance, MerchantSettlement, MerchantSettlementAccount } from "@peebee/shared";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

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

  const load = useCallback(async () => {
    if (!merchant) return;
    const [b, a, s] = await Promise.all([api.merchantBalance(merchant.id), api.merchantSettlementAccounts(merchant.id), api.merchantSettlements(merchant.id)]);
    setBalance(b.balance); setAccounts(a.settlementAccounts); setHistory(s.settlements);
  }, [merchant]);
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

  return <div className="space-y-5 px-4 py-5"><header><h1 className="text-2xl font-black">Merchant wallet</h1><p className="text-sm text-ink-500">Provider-backed value from confirmed purchases.</p></header>
    {error && <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</p>}
    <section className="grid grid-cols-3 gap-2 rounded-[24px] bg-navy p-5 text-center text-white dark:bg-[#153A75]"><div><p className="text-[10px] text-white/65">Available</p><p className="mt-1 text-sm font-black">{ugx(balance?.available ?? 0)}</p></div><div><p className="text-[10px] text-white/65">Held</p><p className="mt-1 text-sm font-black">{ugx(balance?.held ?? 0)}</p></div><div><p className="text-[10px] text-white/65">Settling</p><p className="mt-1 text-sm font-black">{ugx(balance?.settling ?? 0)}</p></div></section>
    {!verified ? <section className="home-card space-y-3"><div><h2 className="font-bold">Mobile Money destination</h2><p className="text-xs text-ink-500">{merchant?.environment === "sandbox" ? "Peebee still requires administrator verification, but the 24-hour live cooling period is skipped for sandbox testing." : "Peebee verifies ownership and applies a 24-hour cooling period before first use."}</p></div>{accounts.map((a) => <p key={a.id} className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-xs">{a.network_or_bank} {a.masked_account_ref} — {a.status.replaceAll("_", " ")}</p>)}<select value={network} onChange={(e) => setNetwork(e.target.value as "MTN" | "Airtel")} className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"><option>MTN</option><option>Airtel</option></select><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile Money number" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><button disabled={busy || phone.trim().length < 6} onClick={addDestination} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">Save destination</button></section>
      : <section className="home-card space-y-3"><div><h2 className="font-bold">Request settlement</h2><p className="text-xs text-ink-500">{verified.network_or_bank} {verified.masked_account_ref}. Fees are shown before confirmation.</p></div><input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "")); setQuote(null); }} placeholder="Amount in UGX" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><select value={mode} onChange={(e) => { setMode(e.target.value as "instant" | "scheduled"); setQuote(null); }} className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"><option value="scheduled">Scheduled settlement</option><option value="instant">Instant settlement</option></select>{!quote ? <button disabled={busy || !amount} onClick={getQuote} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">Review settlement</button> : <div className="space-y-2 rounded-xl border border-gold/40 p-3 text-sm"><p className="flex justify-between"><span>Merchant receives</span><strong>{ugx(quote.amount)}</strong></p><p className="flex justify-between"><span>Fee</span><strong>{ugx(quote.fee)}</strong></p><p className="flex justify-between border-t border-[var(--border-faint)] pt-2"><span>Total debit</span><strong>{ugx(quote.totalDebit)}</strong></p><button disabled={busy} onClick={confirm} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold">Confirm</button></div>}</section>}
    {settlement && <section className="home-card flex gap-3">{settlement.status === "successful" ? <CheckCircle2 className="h-5 w-5 text-green"/> : <Loader2 className="h-5 w-5 animate-spin text-gold"/>}<div><p className="font-bold">Settlement {settlement.status}</p><p className="text-xs text-ink-500">Never retry a pending or unknown transfer.</p></div></section>}
    <section className="home-card space-y-3"><h2 className="font-bold">Settlement history</h2>{history.map((item) => <div key={item.id} className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm"><span><span className="block capitalize">{item.mode ?? "settlement"}</span><span className="text-xs text-ink-500">{item.status}</span></span><strong>{ugx(item.amount)}</strong></div>)}{history.length === 0 && <p className="text-sm text-ink-500">No settlements yet.</p>}</section>
  </div>;
}
