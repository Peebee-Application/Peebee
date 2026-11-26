"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { ugx } from "../../lib/format";

type Earnings = Awaited<ReturnType<typeof api.workEarnings>>;

export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [personalWalletActivating, setPersonalWalletActivating] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");

  useEffect(() => {
    api.workEarnings().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);

  async function moveToPersonalWallet() {
    if (!data) return;
    const amount = Number(transferAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > data.workWalletBalance) return;
    setTransferBusy(true); setError(null); setTransferMessage("");
    try {
      await api.transferProviderWallet({ providerType: "work", providerId: data.providerId, amount }, crypto.randomUUID());
      setTransferAmount("");
      setTransferMessage("Funds moved to your personal Peebee wallet.");
      setData(await api.workEarnings());
    } catch (e) { setError(errorMessage(e)); }
    finally { setTransferBusy(false); }
  }

  async function activatePersonalWallet() {
    if (!data) return;
    setPersonalWalletActivating(true); setError(null);
    try { await api.activatePersonalWallet(); setData(await api.workEarnings()); }
    catch (e) { setError(errorMessage(e)); }
    finally { setPersonalWalletActivating(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Wallet className="h-7 w-7 text-gold" aria-hidden /> Earnings</h1>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}
      {data && (
        <>
          <div className="home-card space-y-1 p-5">
            <p className="text-base font-bold text-ink-500">Paid</p>
            <p className="text-4xl font-black tabular-nums text-ink">{ugx(data.paidUgx)}</p>
            <p className="text-base font-medium text-ink-500">{data.paidJobs} paid {data.paidJobs === 1 ? "job" : "jobs"}</p>
          </div>
          <div className="home-card space-y-1 p-5">
            <p className="text-base font-bold text-ink-500">Coming up</p>
            <p className="text-3xl font-black tabular-nums text-ink">{ugx(data.upcomingUgx)}</p>
            <p className="text-base font-medium text-ink-500">{data.upcomingJobs} {data.upcomingJobs === 1 ? "job" : "jobs"} booked or waiting</p>
          </div>
          {data.workWalletReady ? <div className="home-card space-y-3 p-5">
            <div><p className="text-base font-bold text-ink-500">Work wallet</p><p className="text-3xl font-black tabular-nums text-ink">{ugx(data.workWalletBalance)}</p><p className="text-sm text-ink-500">Customer payments confirmed for your provider profile are held here. Your personal Peebee wallet stays separate.</p></div>
            {(!data.personalWalletActive && data.personalWalletActivationAvailable || data.personalWalletActive && data.providerWalletTransfersEnabled) && (data.personalWalletActive
              ? <div className="space-y-2"><input aria-label="Amount to move to personal wallet in UGX" inputMode="numeric" value={transferAmount} onChange={(e) => { setTransferAmount(e.target.value.replace(/\D/g, "")); setTransferMessage(""); }} placeholder="Amount in UGX" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3 text-base" />{transferMessage && <p role="status" className="text-sm font-semibold text-green">{transferMessage}</p>}<button type="button" disabled={transferBusy || !transferAmount || Number(transferAmount) > data.workWalletBalance} onClick={() => void moveToPersonalWallet()} className="min-h-12 w-full rounded-full bg-gold px-4 font-bold text-ink-gold disabled:opacity-50">{transferBusy ? "Moving funds…" : "Move to personal wallet"}</button></div>
              : <div className="space-y-2"><p className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-sm text-ink-500">Activate a personal wallet on this Peebee identity when you want to move work funds into your personal balance.</p><button type="button" disabled={personalWalletActivating} onClick={() => void activatePersonalWallet()} className="min-h-12 w-full rounded-full bg-gold px-4 font-bold text-ink-gold disabled:opacity-50">{personalWalletActivating ? "Activating…" : "Activate personal wallet"}</button></div>)}
          </div> : <p className="home-card text-sm text-ink-500">Work-wallet separation is pending migration 0175. Until it is applied, provider earnings continue to use the existing personal wallet balance.</p>}
          <p className="text-lg text-ink-500">Paid earnings reflect jobs the customer confirmed.</p>
        </>
      )}
    </div>
  );
}
