"use client";

import { Select } from "@peebee/shared/select";

import type { CarWallet, SavedMobileNumber } from "@peebee/shared";
import { Clock, Fuel, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TabBar } from "../../components/TabBar";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;
const field = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg";

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
  const [tab, setTab] = useState<"cash" | "history">("cash");

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
    <div className="space-y-4 px-4 py-5">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p className="text-lg font-medium text-green">{notice}</p>}
      <section className="rounded-[24px] border border-white/10 bg-black-900 p-5 text-white dark:bg-black-900">
        <p className="text-base text-white/70">Wallet</p>
        <p className="mt-1 text-4xl font-black tabular-nums">{ugx(wallet?.balance ?? 0)}</p>
        <p className="mt-2 text-lg text-white/80">
          Cash out: <strong>{ugx(wallet?.withdrawable ?? 0)}</strong>
        </p>
      </section>

      <TabBar label="Earnings" active={tab} onChange={setTab} tabs={[{ id: "cash", label: "Cash out", icon: Wallet }, { id: "history", label: "History", icon: Clock, count: wallet?.history.length }]} />

      {tab === "cash" && (
        <>
          {wallet && !wallet.withdrawalsEnabled && (
            <p className="home-card text-lg text-ink-500">Cash-out isn&apos;t open yet. Your money is safe in your wallet.</p>
          )}

          {wallet?.withdrawalsEnabled && numbers.length === 0 && (
            <form onSubmit={saveNumber} className="home-card space-y-3">
              <h2 className="text-xl font-bold">Mobile money number</h2>
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Number to receive money" className={field} />
              <button disabled={busy || phone.trim().length < 6} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">Save number</button>
            </form>
          )}

          {wallet?.withdrawalsEnabled && numbers.length > 0 && (
            <form onSubmit={withdraw} className="home-card space-y-3">
              {numbers.length > 1 && (
                <Select value={numberId} onValueChange={(value) => setNumberId(value)} className={field} aria-label="Mobile money number">
                  {numbers.map((n) => <option key={n.id} value={n.id}>{n.phone}</option>)}
                </Select>
              )}
              {numbers.length === 1 && <p className="text-lg text-ink-500">To {numbers[0].phone}</p>}
              <input
                required
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder={wallet.minAmount > 0 ? `Amount (min ${ugx(wallet.minAmount)})` : "Amount in UGX"}
                aria-label="Amount"
                className={field}
              />
              <button disabled={busy || !amount || !!pendingId} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Withdraw"}</button>
            </form>
          )}

          <Link href="/fuel" className="home-card flex min-h-16 items-center gap-3 text-xl font-bold text-ink">
            <Fuel className="h-7 w-7 text-gold" aria-hidden /> Fuel voucher
          </Link>
        </>
      )}

      {tab === "history" && (
        wallet && wallet.history.length > 0 ? (
          <section className="home-card divide-y divide-[var(--border-faint)]">
            {wallet.history.slice(0, 10).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 py-3">
                <span><span className="block text-lg font-bold capitalize text-ink">{w.status}</span><span className="text-base text-ink-500">{w.created_at}</span></span>
                <strong className="text-xl tabular-nums">{ugx(w.amount)}</strong>
              </div>
            ))}
          </section>
        ) : (
          <p className="home-card py-8 text-center text-lg text-ink-500">None yet</p>
        )
      )}
    </div>
  );
}
