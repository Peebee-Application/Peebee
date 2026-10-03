"use client";

import type { CustomerWallet } from "@tuma/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

export default function WalletPage() {
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getWallet().then(setWallet).catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">Earnings</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <section className="rounded-[24px] bg-navy p-5 text-white dark:bg-[#153A75]">
        <p className="text-xs text-white/70">Wallet balance</p>
        <p className="mt-2 text-3xl font-black">{ugx(wallet?.balance ?? 0)}</p>
        <p className="mt-3 text-xs text-white/70">Your share of every finished ride lands here. Cash-out to mobile money is coming soon.</p>
      </section>
      <section className="home-card space-y-3">
        <h2 className="font-bold">Recent activity</h2>
        {(wallet?.ledger ?? []).map((row) => (
          <div key={String(row.id)} className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm">
            <span className="min-w-0 pr-3"><span className="block truncate">{String(row.note ?? row.type)}</span><span className="text-xs text-ink-500">{String(row.created_at ?? "")}</span></span>
            <strong>{ugx(Number(row.amount))}</strong>
          </div>
        ))}
        {wallet && wallet.ledger.length === 0 && <p className="text-sm text-ink-500">Nothing yet.</p>}
      </section>
    </div>
  );
}
