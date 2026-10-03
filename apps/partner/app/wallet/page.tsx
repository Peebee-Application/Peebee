"use client";

import type { CarWallet, SavedMobileNumber } from "@tuma/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;
const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";

export default function WalletPage() {
  const [wallet, setWallet] = useState<CarWallet | null>(null);
  const [numbers, setNumbers] = useState<SavedMobileNumber[]>([]);
  const [numberId, setNumberId] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [w, n] = await Promise.all([api.carWallet(), api.getMobileNumbers("withdrawal")]);
    setWallet(w);
    setNumbers(n.numbers);
    setNumberId((cur) => cur || n.numbers[0]?.id || "");
  }, []);
  useEffect(() => {
    load().catch((err: unknown) => setError(errorMessage(err)));
  }, [load]);

  // Follow a payout until it settles (a failed one is returned to the wallet).
  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => {
      api.carWithdrawalStatus(pendingId).then(async (r) => {
        if (r.withdrawal.status !== "pending") {
          setPendingId(null);
          setNotice(r.withdrawal.status === "successful" ? "Withdrawal sent." : "The withdrawal failed and the money is back in your wallet.");
          await load();
        }
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load, pendingId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const saveNumber = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.addMobileNumber({ purpose: "withdrawal", phone });
      setPhone("");
      await load();
    });
  };
  const withdraw = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await api.carWithdraw(Number(amount), numbers.length > 1 ? numberId : undefined);
      setAmount("");
      setPendingId(res.withdrawalId);
      setNotice("Withdrawal started — you'll see it here when it's done.");
      await load();
    });
  };

  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">Earnings</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p className="text-sm font-medium text-green">{notice}</p>}
      <section className="rounded-[24px] bg-navy p-5 text-white dark:bg-[#153A75]">
        <p className="text-xs text-white/70">Wallet balance</p>
        <p className="mt-2 text-3xl font-black">{ugx(wallet?.balance ?? 0)}</p>
        <p className="mt-3 text-xs text-white/70">
          Ready to cash out: <strong>{ugx(wallet?.withdrawable ?? 0)}</strong> (your ride earnings)
        </p>
      </section>

      {wallet && !wallet.withdrawalsEnabled && (
        <p className="home-card text-sm text-ink-500">Cash-out to mobile money isn&apos;t open yet. Your earnings stay safe in your wallet.</p>
      )}

      {wallet?.withdrawalsEnabled && numbers.length === 0 && (
        <form onSubmit={saveNumber} className="home-card space-y-3">
          <h2 className="font-bold">Mobile money number</h2>
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Number to receive withdrawals" className={field} />
          <button disabled={busy || phone.trim().length < 6} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">Save number</button>
        </form>
      )}

      {wallet?.withdrawalsEnabled && numbers.length > 0 && (
        <form onSubmit={withdraw} className="home-card space-y-3">
          <h2 className="font-bold">Cash out</h2>
          {numbers.length > 1 && (
            <select value={numberId} onChange={(e) => setNumberId(e.target.value)} className={field} aria-label="Mobile money number">
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.phone}</option>)}
            </select>
          )}
          {numbers.length === 1 && <p className="text-xs text-ink-500">To {numbers[0].phone}</p>}
          <input
            required
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder={wallet.minAmount > 0 ? `Amount (at least ${ugx(wallet.minAmount)})` : "Amount in UGX"}
            className={field}
          />
          <button disabled={busy || !amount || !!pendingId} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Withdraw"}</button>
        </form>
      )}

      {wallet && wallet.history.length > 0 && (
        <section className="home-card space-y-3">
          <h2 className="font-bold">Withdrawals</h2>
          {wallet.history.map((w) => (
            <div key={w.id} className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm">
              <span><span className="block">{w.status}</span><span className="text-xs text-ink-500">{w.created_at}</span></span>
              <strong>{ugx(w.amount)}</strong>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
