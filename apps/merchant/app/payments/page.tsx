"use client";

import { isPracticeMode, practicePaymentCode, type MerchantPayment, type MerchantPaymentSummary } from "@tuma/shared";
import { CheckCircle2, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

export default function PaymentsPage() {
  const { merchant } = useAuth();
  const [payments, setPayments] = useState<MerchantPaymentSummary[]>([]);
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<MerchantPayment | null>(null);
  const [disputing, setDisputing] = useState<MerchantPaymentSummary | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (isPracticeMode()) setCode(practicePaymentCode()); }, []);

  const load = useCallback(async () => { if (merchant) setPayments((await api.merchantPayments(merchant.id)).payments); }, [merchant]);
  useEffect(() => { load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  useEffect(() => {
    if (!merchant) return;
    const timer = window.setInterval(() => {
      load().catch((cause) => setError(errorMessage(cause)));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [load, merchant]);

  async function lookup(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setSelected((await api.merchantPayment(code.trim())).payment); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!selected) return; setBusy(true); setError("");
    try { setSelected((await api.confirmMerchantPayment(selected.id, selected.amount)).payment); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function dispute() {
    if (!merchant || !disputing) return; setBusy(true); setError("");
    try { await api.createMerchantDispute(merchant.id, disputing.id, reason); setDisputing(null); setReason(""); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return <div className="space-y-5 px-4 py-5"><header><h1 className="text-2xl font-black">Payments</h1><p className="text-sm text-ink-500">Both you and the rider must agree on the exact amount.</p></header>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    <form onSubmit={lookup} className="home-card space-y-3"><label className="text-xs font-bold text-ink-500">Payment code shown by rider</label><div className="flex gap-2"><input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="mpay_…" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3"/><button disabled={busy} className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold text-ink-gold"><Search className="h-5 w-5"/></button></div></form>
    {selected && <section className="home-card space-y-4"><div><p className="text-xs text-ink-500">Confirm amount</p><p className="text-3xl font-black">{ugx(selected.amount)}</p><p className="text-xs text-ink-500">{selected.outlet_name} · order {selected.order_id}</p></div>{selected.status === "awaiting_confirmation" ? <button disabled={busy} onClick={confirm} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold">Confirm goods handover and amount</button> : <p className="flex gap-2 rounded-xl bg-green/10 p-3 text-sm text-green"><CheckCircle2 className="h-5 w-5"/>Payment {selected.status.replaceAll("_", " ")}.</p>}</section>}
    <section className="home-card space-y-3"><h2 className="font-bold">Payment history</h2>{payments.map((payment) => <div key={payment.id} className="border-t border-[var(--border-faint)] pt-3"><div className="flex justify-between gap-3 text-sm"><span><span className="block font-semibold">{payment.outlet_name}</span><span className="text-xs text-ink-500">{payment.rider_name} · {payment.status.replaceAll("_", " ")}</span></span><strong>{ugx(payment.amount)}</strong></div>{merchant?.member_role !== "cashier" && ["awaiting_confirmation", "held"].includes(payment.status) && <button type="button" onClick={() => setDisputing(payment)} className="mt-2 flex items-center gap-1 text-xs font-bold text-red-600"><ShieldAlert className="h-3.5 w-3.5"/>Raise dispute</button>}</div>)}{payments.length === 0 && <p className="text-sm text-ink-500">No payments yet.</p>}</section>
    {disputing && <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-4"><section className="mx-auto w-full max-w-xl rounded-[24px] bg-[rgb(var(--surface))] p-5"><h2 className="font-bold">Dispute {ugx(disputing.amount)}</h2><p className="mt-1 text-xs text-ink-500">Explain what differs. Tuma will preserve the evidence for review.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="At least 10 characters" className="mt-3 w-full rounded-xl border border-[var(--border-faint)] p-3"/><div className="mt-3 flex gap-2"><button onClick={() => setDisputing(null)} className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] font-bold">Cancel</button><button disabled={busy || reason.trim().length < 10} onClick={dispute} className="min-h-11 flex-[2] rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">Submit dispute</button></div></section></div>}
  </div>;
}
