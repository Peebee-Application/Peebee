"use client";

import { observeNotificationSnapshot } from "@peebee/shared";

import { isPracticeMode, practicePaymentCode, type MerchantPayment, type MerchantPaymentSummary } from "@peebee/shared";
import { codeFromScan } from "@peebee/shared/qr";
import { CheckCircle2, Clock, History, QrCode, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { QrScanner } from "../../components/QrScanner";
import { TabBar } from "../../components/TabBar";
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
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<"confirm" | "history">("confirm");

  useEffect(() => { if (isPracticeMode()) setCode(practicePaymentCode()); }, []);

  const load = useCallback(async () => {
    if (!merchant) return;
    const { payments: incoming } = await api.merchantPayments(merchant.id);
    observeNotificationSnapshot("merchant-payments:" + merchant.id, incoming.map((payment) => payment.id + ":" + payment.status));
    setPayments(incoming);
  }, [merchant]);
  useEffect(() => { load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  useEffect(() => {
    if (!merchant) return;
    const timer = window.setInterval(() => {
      load().catch((cause) => setError(errorMessage(cause)));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [load, merchant]);

  async function lookupCode(paymentCode: string) {
    setBusy(true); setError("");
    try { setSelected((await api.merchantPayment(paymentCode.trim())).payment); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  function lookup(event: React.FormEvent) { event.preventDefault(); void lookupCode(code); }
  const onScan = useCallback((raw: string) => { const scanned = codeFromScan(raw); setScanning(false); setCode(scanned); void lookupCode(scanned); }, []);
  const closeScanner = useCallback(() => setScanning(false), []);
  async function confirm() {
    if (!selected) return; setBusy(true); setError("");
    try { setSelected((await api.confirmMerchantPayment(selected.id, selected.amount)).payment); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function dispute() {
    if (!merchant || !disputing) return; setBusy(true); setError("");
    try { await api.createMerchantDispute(merchant.id, disputing.id, reason); setDisputing(null); setReason(""); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  const waiting = payments.filter((payment) => payment.status === "awaiting_confirmation");
  const shown = tab === "confirm" ? waiting : payments;
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header><h1 className="text-3xl font-black">Payments</h1></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    <form onSubmit={lookup} className="home-card space-y-3">
      <div className="flex gap-2">
        <input required aria-label="Payment code shown by the rider" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Payment code" className="min-h-14 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-4 text-lg" />
        <button type="button" onClick={() => setScanning(true)} aria-label="Scan the rider's QR" className="flex h-14 w-14 items-center justify-center rounded-xl border border-gold text-gold"><QrCode className="h-7 w-7" aria-hidden /></button>
        <button disabled={busy} aria-label="Look up" className="flex h-14 w-14 items-center justify-center rounded-xl bg-gold text-ink-gold"><Search className="h-7 w-7" aria-hidden /></button>
      </div>
    </form>
    {scanning && <QrScanner title="Scan the rider's payment QR" placeholder="mpay_…" onScan={onScan} onClose={closeScanner} />}
    {selected && <section className="home-card space-y-4" aria-live="polite"><div><p className="text-base text-ink-500">Confirm amount</p><p className="text-4xl font-black tabular-nums">{ugx(selected.amount)}</p><p className="text-base text-ink-500">{selected.outlet_name}</p></div>{selected.status === "awaiting_confirmation" ? <button disabled={busy} onClick={confirm} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold">Confirm</button> : <p className="flex items-center gap-2 rounded-xl bg-green/10 p-4 text-lg font-bold text-green"><CheckCircle2 className="h-6 w-6" aria-hidden />{selected.status.replaceAll("_", " ")}</p>}</section>}

    <TabBar label="Payments" active={tab} onChange={setTab} tabs={[{ id: "confirm", label: "To confirm", icon: Clock, count: waiting.length }, { id: "history", label: "History", icon: History }]} />
    <section className="home-card space-y-3" role="tabpanel" aria-label={tab === "confirm" ? "To confirm" : "History"}>
      {shown.slice(0, 10).map((payment) => <div key={payment.id} className="border-t border-[var(--border-faint)] pt-3 first:border-0 first:pt-0"><div className="flex items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-lg font-semibold">{payment.outlet_name}</span><span className="block truncate text-base text-ink-500">{payment.rider_name} · {payment.status.replaceAll("_", " ")}</span></span><strong className="shrink-0 text-lg tabular-nums">{ugx(payment.amount)}</strong></div>{merchant?.member_role !== "cashier" && ["awaiting_confirmation", "held"].includes(payment.status) && <button type="button" onClick={() => setDisputing(payment)} className="mt-2 flex min-h-11 items-center gap-1 text-base font-bold text-red-600"><ShieldAlert className="h-5 w-5" aria-hidden />Dispute</button>}</div>)}
      {shown.length === 0 && <p className="py-4 text-center text-lg text-ink-500">{tab === "confirm" ? "Nothing to confirm" : "No payments yet"}</p>}
      {shown.length > 10 && <p className="text-center text-base text-ink-500">Latest 10 of {shown.length}</p>}
    </section>
    {disputing && <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-4"><section className="mx-auto w-full max-w-xl rounded-[24px] bg-[rgb(var(--surface))] p-5"><h2 className="text-xl font-bold">Dispute {ugx(disputing.amount)}</h2><p className="mt-1 text-base text-ink-500">Say what is different. Peebee keeps the evidence for review.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="At least 10 characters" aria-label="Reason" className="mt-3 w-full rounded-xl border border-[var(--border-faint)] p-3 text-lg" /><div className="mt-3 flex gap-2"><button onClick={() => setDisputing(null)} className="min-h-14 flex-1 rounded-full border border-[var(--border-faint)] text-lg font-bold">Cancel</button><button disabled={busy || reason.trim().length < 10} onClick={dispute} className="min-h-14 flex-[2] rounded-full bg-gold text-lg font-bold text-ink-gold disabled:opacity-50">Submit</button></div></section></div>}
  </div>;
}
