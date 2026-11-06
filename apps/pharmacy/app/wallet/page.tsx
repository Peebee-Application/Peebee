"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  Lock,
  Phone,
  Smartphone,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { TabBar } from "../../components/TabBar";
import { useAuth } from "../../lib/auth-context";

const ugx = (val: number) => `UGX ${val.toLocaleString()}`;

export default function PharmacyWalletPage() {
  const { pharmacy } = useAuth();
  const [balance, setBalance] = useState(1485000);
  const [pending, setPending] = useState(240000);
  const [cashoutModalOpen, setCashoutModalOpen] = useState(false);
  const [cashoutAmount, setCashoutAmount] = useState("");
  const [cashoutPhone, setCashoutPhone] = useState("+256 772 110 220");
  const [cashoutPin, setCashoutPin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"activity" | "account">("activity");

  const handleCashout = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseInt(cashoutAmount, 10);
    if (!amt || amt > balance) return;

    setBalance((prev) => prev - amt);
    setCashoutModalOpen(false);
    setCashoutAmount("");
    setCashoutPin("");
    setNotice(`Payout of ${ugx(amt)} initiated to ${cashoutPhone} via Mobile Money!`);
    setTimeout(() => setNotice(null), 4000);
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-center gap-2 rounded-2xl bg-gold/15 p-3 text-lg font-bold text-ink animate-fade-in">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-gold" aria-hidden />
          <span>{notice}</span>
        </div>
      )}

      <section className="home-card !p-5 space-y-4 !bg-black-700 text-white dark:!bg-black">
        <div>
          <span className="text-base font-semibold text-white/70">Balance</span>
          <p className="mt-1 text-4xl font-black tabular-nums text-white">{ugx(balance)}</p>
          <p className="mt-1 text-lg text-white/70">Pending: {ugx(pending)}</p>
        </div>
        <button type="button" onClick={() => setCashoutModalOpen(true)} className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-xl font-extrabold text-ink-gold active:scale-[0.98]">
          <ArrowUpRight className="h-6 w-6" aria-hidden />
          <span>Cash out</span>
        </button>
      </section>

      <TabBar label="Wallet" active={tab} onChange={setTab} tabs={[{ id: "activity", label: "Activity", icon: Wallet }, { id: "account", label: "Payout", icon: Smartphone }]} />

      {tab === "account" && (
        <section className="space-y-3 home-card !p-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold/20 font-black text-gold">MTN</div>
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-ink">MTN Mobile Money</p>
                <p className="font-mono text-base text-ink-500">+256 772 110 220</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-green-600/15 px-3 py-1 text-sm font-bold text-green-600">Verified</span>
          </div>
        </section>
      )}

      {tab === "activity" && (
        <section className="divide-y divide-[var(--border-faint)] home-card px-4">
          {[
            { title: "Prescription dispensed", amt: 34500, time: "Today 11:20 AM", type: "credit" },
            { title: "OTC medicine cart", amt: 48500, time: "Today 09:45 AM", type: "credit" },
            { title: "Mobile money payout", amt: -500000, time: "Yesterday 06:10 PM", type: "debit" },
            { title: "Prescription dispensed", amt: 65000, time: "Yesterday 02:30 PM", type: "credit" },
          ].map((tx, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-lg font-bold text-ink">{tx.title}</p>
                <p className="text-base text-ink-500">{tx.time}</p>
              </div>
              <span className={`shrink-0 font-mono text-lg font-black ${tx.type === "credit" ? "text-green-600" : "text-ink-500"}`}>
                {tx.amt > 0 ? `+${ugx(tx.amt)}` : ugx(tx.amt)}
              </span>
            </div>
          ))}
          <p className="py-3 text-center text-base text-ink-500">Sample data, not connected yet.</p>
        </section>
      )}

      {/* Cashout Drawer Modal */}
      {cashoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-t-3xl sm:home-card !p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-black text-ink">Cash out</h3>

            <form onSubmit={handleCashout} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-base font-bold text-ink-500">Amount (UGX)</label>
                <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                  <input
                    type="number"
                    required
                    max={balance}
                    placeholder={`Max ${balance.toLocaleString()}`}
                    value={cashoutAmount}
                    onChange={(e) => setCashoutAmount(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-base font-bold text-ink-500">Phone number</label>
                <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                  <input
                    type="text"
                    required
                    value={cashoutPhone}
                    onChange={(e) => setCashoutPhone(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-base font-bold text-ink-500">PIN</label>
                <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                  <input
                    type="password"
                    required
                    placeholder="4-digit PIN"
                    value={cashoutPin}
                    onChange={(e) => setCashoutPin(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCashoutModalOpen(false)}
                  className="flex-1 rounded-2xl border border-[var(--border-faint)] py-2.5 text-base font-bold text-ink-500 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-gold py-2.5 text-base font-black text-ink-gold shadow transition hover:opacity-95"
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
