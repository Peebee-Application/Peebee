"use client";

import { isPracticeMode, practicePaymentCode, type MerchantPayment } from "@peebee/shared";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const money = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

export default function MerchantPaymentConfirmationPage() {
  const [paymentId, setPaymentId] = useState("");
  const [payment, setPayment] = useState<MerchantPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (isPracticeMode()) setPaymentId(practicePaymentCode()); }, []);

  async function lookUp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPayment(null);
    try {
      const result = await api.merchantPayment(paymentId.trim());
      setPayment(result.payment);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.confirmMerchantPayment(payment.id, payment.amount);
      setPayment(result.payment);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const complete = payment && ["available", "held", "settlement_pending", "paid"].includes(payment.status);

  return (
    <div className="space-y-4 px-4 pb-24 pt-4">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Back" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </Link>
        <h1 className="text-3xl font-black text-ink">Rider payment</h1>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>}

      <form onSubmit={lookUp} className="home-card space-y-3">
        <input
          id="payment-id"
          aria-label="Payment code from rider"
          required
          value={paymentId}
          onChange={(event) => setPaymentId(event.target.value)}
          placeholder="Payment code"
          autoCapitalize="none"
          className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-4 text-lg outline-none focus:border-gold"
        />
        <button disabled={busy || !paymentId.trim()} className="min-h-14 w-full rounded-full bg-gold px-4 text-lg font-bold text-ink-gold disabled:opacity-60">
          {busy ? "Checking…" : "Check payment"}
        </button>
      </form>

      {payment && (
        <section className="home-card space-y-4" aria-live="polite">
          <div>
            <p className="text-base text-ink-500">Rider asks for</p>
            <p className="mt-1 text-4xl font-black tabular-nums text-ink">{money(payment.amount)}</p>
            <p className="mt-1 text-base text-ink-500">{payment.outlet_name ?? "Your outlet"}</p>
          </div>
          {complete ? (
            <div className="flex items-center gap-2 rounded-xl bg-green/10 p-4 text-lg font-bold text-green">
              <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden />
              <span>{payment.status === "held" ? "Confirmed (held for review)" : "Confirmed"}</span>
            </div>
          ) : payment.status === "awaiting_confirmation" ? (
            <button type="button" disabled={busy} onClick={confirm} className="min-h-16 w-full rounded-full bg-gold px-4 text-xl font-extrabold text-ink-gold disabled:opacity-60">
              {busy ? "Confirming…" : "Confirm"}
            </button>
          ) : (
            <p className="rounded-xl bg-[rgb(var(--surface-muted))] p-4 text-base text-ink-500">Cannot confirm: {payment.status.replaceAll("_", " ")}.</p>
          )}
          <p className="text-base text-ink-500">Check the goods and amount together first. Never confirm a different amount.</p>
        </section>
      )}
    </div>
  );
}
