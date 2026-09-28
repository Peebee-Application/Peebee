"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "../../../../../../lib/api";

export default function RepayLoanPage() {
  const params = useParams<{ loanId: string }>();
  const loanId = params.loanId;
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "momo">("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestStageRepayment(loanId, { amount: value, method });
      if (method === "momo" && res.momoRecipientMsisdn) {
        window.location.href = `tel:*165*3*${res.momoRecipientMsisdn}*${value}%23`;
      }
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4 px-4 pb-6 pt-4 text-center">
        <p className="text-sm text-ink-500">
          Your repayment intent has been logged. Your treasurer will confirm it once they&apos;ve received it.
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Repay loan</h1>
      <form onSubmit={submit} className="home-card space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="repayAmount">
            Amount (UGX)
          </label>
          <input
            id="repayAmount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-lg font-bold text-ink outline-none focus:border-gold"
          />
        </div>
        <div className="flex gap-2">
          {(["cash", "momo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                method === m ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
              }`}
            >
              {m === "cash" ? "Cash" : "Mobile money"}
            </button>
          ))}
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !amount}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save repayment intent"}
        </button>
      </form>
    </div>
  );
}
