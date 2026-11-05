"use client";

import { Select } from "@peebee/shared/select";

import type { MerchantBalance, MerchantSettlement, MerchantSettlementAccount } from "@peebee/shared";
import { AlertTriangle, CheckCircle2, Loader2, WalletCards } from "lucide-react";
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

  const field = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-4 text-lg";
  const big = "min-h-14 w-full rounded-full bg-gold text-lg font-bold text-ink-gold disabled:opacity-50";
  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <header><h1 className="text-3xl font-black">Balance</h1></header>
      {error && <div role="alert" className="flex gap-2 rounded-2xl border border-red-300 bg-red-50 p-4 text-base text-red-800"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />{error}</div>}
      <section className="rounded-[24px] border border-white/10 bg-black-900 p-5 text-center text-white dark:bg-black-900" aria-label="Balance">
        <WalletCards className="mx-auto h-8 w-8 text-gold" aria-hidden />
        <p className="mt-1 text-4xl font-black tabular-nums">{ugx(balance?.available ?? 0)}</p>
        <p className="text-base text-white/70">Available</p>
        <p className="mt-2 text-base text-white/70">Held {ugx(balance?.held ?? 0)} · Settling {ugx(balance?.settling ?? 0)}</p>
      </section>
      {settlement && <section className="home-card flex items-center gap-3">{settlement.status === "successful" ? <CheckCircle2 className="h-7 w-7 text-green" /> : <Loader2 className="h-7 w-7 animate-spin text-gold" />}<div><p className="text-lg font-bold capitalize">Withdrawal {settlement.status}</p><p className="text-base text-ink-500">Do not retry a pending transfer.</p></div></section>}

      {accounts.length === 0 ? (
        <section className="home-card space-y-3">
          <h2 className="text-xl font-bold">Where should we send money?</h2>
          <p className="text-base text-ink-500">Peebee verifies the number first, then there is a 24-hour wait before first use.</p>
          <Select aria-label="Mobile Money network" value={network} onValueChange={(value) => setNetwork(value as "MTN" | "Airtel")} className={field}><option>MTN</option><option>Airtel</option></Select>
          <input aria-label="Mobile Money number" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Mobile Money number" className={field} />
          <button disabled={busy || phone.trim().length < 6} onClick={addDestination} className={big}>{busy ? "Saving…" : "Save number"}</button>
        </section>
      ) : !verifiedAccount ? (
        <section className="home-card space-y-2"><h2 className="text-xl font-bold">Waiting for verification</h2>{accounts.map((account) => <p key={account.id} className="text-lg text-ink-500">{account.network_or_bank} {account.masked_account_ref} · {account.status.replace("_", " ")}</p>)}</section>
      ) : (
        <section className="home-card space-y-3">
          <p className="text-base text-ink-500">To {verifiedAccount.network_or_bank} {verifiedAccount.masked_account_ref}</p>
          <input aria-label="Amount in UGX" inputMode="numeric" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/\D/g, "")); setQuote(null); }} placeholder="Amount in UGX" className={`${field} !min-h-16 text-2xl font-bold tabular-nums`} />
          <Select aria-label="Settlement mode" value={mode} onValueChange={(value) => { setMode(value as "instant" | "scheduled"); setQuote(null); }} className={field}><option value="scheduled">Scheduled</option><option value="instant">Instant</option></Select>
          {!quote
            ? <button disabled={busy || !amount} onClick={requestQuote} className={big}>Review</button>
            : <div className="space-y-2 rounded-xl border border-gold/40 p-4 text-lg"><p className="flex justify-between"><span>You receive</span><strong>{ugx(quote.amount)}</strong></p><p className="flex justify-between"><span>Fee</span><strong>{ugx(quote.fee)}</strong></p><p className="flex justify-between border-t border-[var(--border-faint)] pt-2"><span>Total</span><strong>{ugx(quote.totalDebit)}</strong></p><button disabled={busy} onClick={confirmSettlement} className={`${big} mt-2`}>{busy ? "Please wait…" : "Confirm"}</button></div>}
        </section>
      )}
    </div>
  );
}
