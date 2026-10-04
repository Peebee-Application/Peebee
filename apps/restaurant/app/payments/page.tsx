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
    <div className="space-y-5 px-4 pb-24 pt-4">
      <header className="flex items-center gap-2">
        <Link href="/" aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-ink">Confirm rider payment</h1>
          <p className="text-xs text-ink-500">Confirm only after checking the goods and amount together.</p>
        </div>
      </header>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={lookUp} className="home-card space-y-3">
        <label className="block text-xs font-semibold text-ink-500" htmlFor="payment-id">Payment code from rider</label>
        <input
          id="payment-id"
          required
          value={paymentId}
          onChange={(event) => setPaymentId(event.target.value)}
          placeholder="mpay_…"
          autoCapitalize="none"
          className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 text-sm outline-none focus:border-gold"
        />
        <button disabled={busy || !paymentId.trim()} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60">
          {busy ? "Checking…" : "Check payment"}
        </button>
      </form>

      {payment && (
        <section className="home-card space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-500">Rider requests</p>
            <p className="mt-1 text-3xl font-bold text-ink">{money(payment.amount)}</p>
            <p className="mt-1 text-xs text-ink-500">Outlet: {payment.outlet_name ?? "your outlet"} · Order {payment.order_id}</p>
          </div>
          {complete ? (
            <div className="flex items-start gap-2 rounded-xl bg-green/10 p-3 text-sm text-green">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{payment.status === "held" ? "Confirmed. This transaction is held for review." : "Confirmed. The value is now in your merchant balance."}</span>
            </div>
          ) : payment.status === "awaiting_confirmation" ? (
            <button type="button" disabled={busy} onClick={confirm} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60">
              {busy ? "Confirming…" : `Confirm receipt of ${money(payment.amount)}`}
            </button>
          ) : (
            <p className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-sm text-ink-500">This payment cannot be confirmed because its status is {payment.status.replaceAll("_", " ")}.</p>
          )}
          <p className="text-xs text-ink-500">Do not confirm a different amount. Ask the rider to correct the request first.</p>
        </section>
      )}
    </div>
  );
}
