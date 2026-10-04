"use client";

import { Select } from "@peebee/shared/select";

import type { MerchantBalance, MerchantSettlement, MerchantSettlementAccount } from "@peebee/shared";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

function ugx(value: number) {
  return `UGX ${Math.trunc(value).toLocaleString("en-UG")}`;
}

export default function MerchantWalletPage() {
  const { restaurant, restaurantReady } = useAuth();
  const merchantId = restaurant?.merchant_id ?? null;
  const [balance, setBalance] = useState<MerchantBalance | null>(null);
  const [accounts, setAccounts] = useState<MerchantSettlementAccount[]>([]);
  const [phone, setPhone] = useState(restaurant?.phone ?? "");
  const [network, setNetwork] = useState<"MTN" | "Airtel">("MTN");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"instant" | "scheduled">("scheduled");
  const [quote, setQuote] = useState<{ id: string; amount: number; fee: number; totalDebit: number } | null>(null);
  const [settlement, setSettlement] = useState<MerchantSettlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!merchantId) return;
    const [balanceResult, accountResult] = await Promise.all([
      api.merchantBalance(merchantId),
      api.merchantSettlementAccounts(merchantId),
    ]);
    setBalance(balanceResult.balance);
    setAccounts(accountResult.settlementAccounts);
  }, [merchantId]);

  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  useEffect(() => {
    if (!merchantId || !settlement || !["submitted", "pending", "unknown"].includes(settlement.status)) return;
    const timer = window.setInterval(() => {
      api.refreshMerchantSettlement(merchantId, settlement.id)
        .then((result) => {
          setSettlement(result.settlement);
          if (["successful", "failed"].includes(result.settlement.status)) load().catch(() => undefined);
        })
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [load, merchantId, settlement]);

  const verifiedAccount = useMemo(
    () => accounts.find((account) => account.status === "verified" && (!account.cooling_until || new Date(account.cooling_until).getTime() <= Date.now())),
    [accounts],
  );

  async function addDestination() {
    if (!merchantId) return;
    setBusy(true);
    setError("");
    try {
      await api.addMerchantSettlementAccount(merchantId, {
        type: "momo",
        provider: network.toLowerCase(),
        accountRef: phone,
        accountName: restaurant?.name,
        networkOrBank: network,
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function requestQuote() {
    if (!merchantId || !verifiedAccount) return;
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
      setError("Enter a whole UGX amount greater than zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.quoteMerchantSettlement(merchantId, {
        settlementAccountId: verifiedAccount.id,
        amount: numericAmount,
        mode,
      });
      setQuote(result.quote);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSettlement() {
    if (!merchantId || !quote) return;
    setBusy(true);
    setError("");
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const result = await api.createMerchantSettlement(merchantId, quote.id, key);
      setSettlement(result.settlement);
      setQuote(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!restaurantReady) return <p className="px-4 py-10 text-center text-sm text-ink-500">Loading…</p>;
  if (!restaurant || !merchantId) {
    return <div className="px-4 py-8 text-sm text-ink-500">This restaurant has not yet been connected to Peebee Merchant.</div>;
  }

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back" className="rounded-full p-2 text-ink"><ArrowLeft className="h-5 w-5" /></Link>
        <div><h1 className="text-xl font-bold text-ink">Merchant balance</h1><p className="text-xs text-ink-500">Backed UGX payable to {restaurant.name}</p></div>
      </div>

      {error && <div className="flex gap-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <section className="home-card grid grid-cols-3 gap-3 text-center">
        <div><p className="text-[11px] text-ink-500">Available</p><p className="mt-1 text-sm font-bold text-ink">{ugx(balance?.available ?? 0)}</p></div>
        <div><p className="text-[11px] text-ink-500">Held</p><p className="mt-1 text-sm font-bold text-ink">{ugx(balance?.held ?? 0)}</p></div>
        <div><p className="text-[11px] text-ink-500">Settling</p><p className="mt-1 text-sm font-bold text-ink">{ugx(balance?.settling ?? 0)}</p></div>
      </section>

      {accounts.length === 0 ? (
        <section className="home-card space-y-3">
          <div><h2 className="text-sm font-bold text-ink">Add a Mobile Money destination</h2><p className="text-xs text-ink-500">It must be verified by Peebee and then complete a 24-hour security cooling period.</p></div>
          <Select aria-label="Mobile Money network" value={network} onValueChange={(value) => setNetwork(value as "MTN" | "Airtel")} className="w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 py-3 text-sm"><option>MTN</option><option>Airtel</option></Select>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Mobile Money number" className="w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 py-3 text-sm" />
          <button disabled={busy || phone.trim().length < 6} onClick={addDestination} className="w-full rounded-xl bg-gold px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save destination"}</button>
        </section>
      ) : !verifiedAccount ? (
        <section className="home-card space-y-2"><h2 className="text-sm font-bold text-ink">Destination awaiting verification</h2>{accounts.map((account) => <p key={account.id} className="text-xs text-ink-500">{account.network_or_bank} {account.masked_account_ref} — {account.status.replace("_", " ")}</p>)}</section>
      ) : (
        <section className="home-card space-y-3">
          <div><h2 className="text-sm font-bold text-ink">Settle to Mobile Money</h2><p className="text-xs text-ink-500">{verifiedAccount.network_or_bank} {verifiedAccount.masked_account_ref}</p></div>
          <input inputMode="numeric" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/\D/g, "")); setQuote(null); }} placeholder="Amount in UGX" className="w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 py-3 text-sm" />
          <Select aria-label="Settlement mode" value={mode} onValueChange={(value) => { setMode(value as "instant" | "scheduled"); setQuote(null); }} className="w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 py-3 text-sm"><option value="scheduled">Scheduled settlement</option><option value="instant">Instant settlement</option></Select>
          {!quote ? <button disabled={busy || !amount} onClick={requestQuote} className="w-full rounded-xl bg-gold px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Review settlement</button> : <div className="space-y-3 rounded-xl border border-gold/40 p-3 text-sm"><div className="flex justify-between"><span>Merchant receives</span><strong>{ugx(quote.amount)}</strong></div><div className="flex justify-between"><span>Settlement fee</span><strong>{ugx(quote.fee)}</strong></div><div className="flex justify-between border-t border-[var(--border-faint)] pt-2"><span>Total balance debit</span><strong>{ugx(quote.totalDebit)}</strong></div><button disabled={busy} onClick={confirmSettlement} className="w-full rounded-xl bg-gold px-4 py-3 font-bold text-white">Confirm settlement</button></div>}
        </section>
      )}

      {settlement && <section className="home-card flex items-start gap-3">{settlement.status === "successful" ? <CheckCircle2 className="h-5 w-5 text-green" /> : <Loader2 className="h-5 w-5 animate-spin text-gold" />}<div><p className="text-sm font-bold text-ink">Settlement {settlement.status}</p><p className="text-xs text-ink-500">{ugx(settlement.amount)} · Never retry while the result is pending or unknown.</p></div></section>}
    </div>
  );
}
