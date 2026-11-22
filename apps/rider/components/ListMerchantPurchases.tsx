"use client";
import { isPracticeMode, type ListPurchaseBudget, MerchantPayment, OrderDetail } from "@peebee/shared";
import { codeFromScan } from "@peebee/shared/qr";
import { CheckCircle2, QrCode, Store } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatUgx } from "../lib/order-display";
import { useLivePolling } from "../lib/use-live-polling";
import { CodeQr } from "./CodeQr";
import { JobAction } from "./JobAction";
import { Modal } from "./Modal";
import { QrScanner } from "./QrScanner";
function purchaseLabel(payment: MerchantPayment) {
  if (payment.purchase_status === "cancelled") return "Cancelled";
  if (payment.status === "disputed") return "Disputed";
  if (payment.delivery_pending) return "Pending customer receipt";
  if (payment.status === "held") return payment.risk_state === "held" ? "Held for review" : "Awaiting settlement";
  if (payment.purchase_status === "released") return "Settled";
  return payment.status === "awaiting_confirmation" ? "Awaiting merchant" : payment.status.replaceAll("_", " ");
}

type Outlet = Awaited<ReturnType<typeof api.lookupPurchaseOutlet>>["outlets"][number];
export function ListMerchantPurchases({ detail, onActive }: {
    detail: OrderDetail;
    onActive: (value: boolean) => void;
}) {
    const { order, items } = detail;
    const [open, setOpen] = useState(false), [scanning, setScanning] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [outletCode, setOutletCode] = useState(""), [outlets, setOutlets] = useState<Outlet[]>([]), [outlet, setOutlet] = useState<Outlet | null>(null);
    const [amounts, setAmounts] = useState<Record<string, string>>({}), [selected, setSelected] = useState<string[]>([]), [receipt, setReceipt] = useState("");
    const [purchases, setPurchases] = useState<MerchantPayment[]>([]), [payment, setPayment] = useState<MerchantPayment | null>(null), [budget, setBudget] = useState<ListPurchaseBudget | null>(null);
    const request = useRef<{
        signature: string;
        input: Parameters<typeof api.createMerchantPayment>[0];
        key: string;
    } | null>(null);
    const load = useCallback(async () => {
        const result = await api.listMerchantPurchases(order.id);
        setPurchases(result.purchases);
        setBudget(result.budget);
        setPayment(current => current ? result.purchases.find(row => row.id === current.id) ?? current : null);
    }, [order.id]);
    useLivePolling(() => { if (order.funds_model === 'merchant_allocations_v1')
        void load().catch(cause => setError(errorMessage(cause))); }, 5000, [load, order.funds_model]);
    const bought = new Set(purchases.filter(row => row.purchase_status !== 'cancelled').flatMap(row => row.items?.map(item => item.list_item_id) ?? []));
    const approved = [...detail.substitutions].reverse().filter(row => row.status === 'approved');
    const available = items.filter(item => !bought.has(item.id)).map(item => ({ ...item, name: approved.find(row => row.original_name === item.name)?.substitute_name ?? item.name })).filter(item => item.name !== 'Not available');
    const lines = selected.map(itemId => ({ itemId, amount: Number(amounts[itemId]) }));
    const total = lines.reduce((sum, item) => sum + item.amount, 0);
    const valid = !!outlet && lines.length > 0 && lines.every(item => Number.isSafeInteger(item.amount) && item.amount > 0) && Number.isSafeInteger(total) && total > 0 && !!budget && total <= budget.remaining;
    function close() { setOpen(false); setScanning(false); onActive(false); }
    function start(existing?: MerchantPayment) { setError(""); setPayment(existing ?? null); setOpen(true); onActive(true); if (!existing) {
        setOutlet(null);
        setOutlets([]);
        setSelected([]);
        setAmounts({});
        setReceipt("");
        setOutletCode("");
        request.current = null;
    } }
    async function lookup(raw: string) { setBusy(true); setError(""); try {
        const result = await api.lookupPurchaseOutlet(codeFromScan(raw));
        setOutlets(result.outlets);
        setOutlet(result.outlets.length === 1 ? result.outlets[0] : null);
    }
    catch (cause) {
        setError(errorMessage(cause));
    }
    finally {
        setBusy(false);
    } }
    const onScan = useCallback((raw: string) => { setScanning(false); setOutletCode(codeFromScan(raw)); void lookup(raw); }, []);
    const closeScanner = useCallback(() => setScanning(false), []);
    async function generate() {
        if (!valid || busy)
            return;
        setBusy(true);
        setError("");
        try {
            const signature = JSON.stringify({ outlet: outlet!.code, lines, receipt });
            if (request.current?.signature !== signature) {
                const location = isPracticeMode() ? null : await new Promise<GeolocationPosition | null>(resolve => { if (!navigator.geolocation)
                    return resolve(null); navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }); });
                if (!location && !receipt.trim() && !isPracticeMode())
                    throw new Error("Allow location access, or enter the merchant receipt number.");
                request.current = { signature, key: `list-purchase:${order.id}:${crypto.randomUUID()}`, input: { orderId: order.id, outletCode: outlet!.code, amount: total, items: lines,
                        riderLat: location?.coords.latitude, riderLng: location?.coords.longitude, accuracyM: location?.coords.accuracy, capturedAt: location ? new Date(location.timestamp).toISOString() : undefined,
                        evidenceMode: receipt.trim() || isPracticeMode() ? "merchant_reauth_receipt" : "gps", receiptReference: receipt.trim() || (isPracticeMode() ? "PRACTICE-ONLY" : undefined) } };
            }
            const result = await api.createMerchantPayment(request.current.input, request.current.key);
            setPayment(result.payment);
            await load();
        }
        catch (cause) {
            setError(errorMessage(cause));
        }
        finally {
            setBusy(false);
        }
    }
    async function cancel() { if (!payment || busy)
        return; setBusy(true); setError(""); try {
        await api.cancelListMerchantPurchase(payment.id);
        await load();
        setPayment(null);
        setSelected([]);
        request.current = null;
    }
    catch (cause) {
        setError(errorMessage(cause));
    }
    finally {
        setBusy(false);
    } }
    if (order.funds_model !== 'merchant_allocations_v1')
        return <section className="home-card space-y-3"><h2 className="text-xl font-bold">Merchant purchases</h2><p className="text-base text-ink-500">QR purchases require a digitally funded merchant-payment order. This order uses a different funding method.</p></section>;
    return <section className="home-card space-y-5">
    <h2 className="text-xl font-bold">Merchant purchases</h2>
    {budget && <p className="flex justify-between gap-3 text-lg"><span>Left to spend</span><strong>{formatUgx(budget.remaining)}</strong></p>}
    <button type="button" className="job-secondary w-full" onClick={() => start()}><QrCode aria-hidden/>Scan merchant QR</button>
    {purchases.map(row => <button type="button" className="flex min-h-16 w-full items-center justify-between gap-3 text-left" key={row.id} onClick={() => start(row)}><span><strong>{row.outlet_name || row.display_name || "Merchant"}</strong><span className="block text-base text-ink-500">{purchaseLabel(row)}</span></span><strong>{formatUgx(row.amount)}</strong></button>)}
    {!open && error && <p role="alert" className="text-base">{error}</p>}
    {open && <Modal title={payment ? "Purchase code" : "Merchant purchase"} onClose={close}><div className="space-y-6 pb-24">
      {scanning && <QrScanner title="Scan merchant QR" onScan={onScan} onClose={closeScanner}/>}
      {payment ? <>
        <div className="flex items-center gap-3"><Store className="h-7 w-7 text-gold" aria-hidden/><div><h3 className="text-xl font-bold">{payment.outlet_name || outlet?.name || "Merchant"}</h3><p className="text-base text-ink-500">{purchaseLabel(payment)}</p></div></div>
        {payment.status === 'awaiting_confirmation' && <><div className="flex justify-center"><CodeQr value={payment.purchase_code || payment.id} size={220}/></div><p className="break-all text-center font-mono text-2xl font-bold tracking-wide">{payment.purchase_code || payment.id}</p><p className="text-center text-base text-ink-500">Show this code to the merchant</p></>}
        <ul className="space-y-4">{payment.items?.map(item => <li key={item.list_item_id} className="flex justify-between gap-3 text-base"><span>{item.quantity} × {item.name}</span><strong>{formatUgx(item.amount)}</strong></li>)}</ul>
        <p className="flex justify-between text-xl"><span>Total</span><strong>{formatUgx(payment.amount)}</strong></p>
        {payment.delivery_pending && <p className="text-base text-ink-500">Confirmed by merchant. Funds stay pending until the customer confirms receipt.</p>}
        {isPracticeMode() && payment.status === 'awaiting_confirmation' && <button type="button" className="job-secondary w-full" onClick={() => { void api.confirmMerchantPayment(payment.id, payment.amount).then(() => load()).catch(cause => setError(errorMessage(cause))); }}>Practice: merchant confirms</button>}
        {payment.status === 'awaiting_confirmation' && <button type="button" disabled={busy} className="job-secondary w-full" onClick={() => void cancel()}>Cancel unconfirmed purchase</button>}
        <JobAction><button type="button" className="job-primary" onClick={close}><CheckCircle2 aria-hidden/>Back to list</button></JobAction>
      </> : <>
        {!outlet ? <><button type="button" className="job-secondary w-full" onClick={() => setScanning(true)}><QrCode aria-hidden/>Open scanner</button>{isPracticeMode() && <p className="text-base text-ink-500">Practice merchant code: PEEBEE-DEMO</p>}<label className="block space-y-3 text-base">Merchant or outlet code<input value={outletCode} onChange={e => setOutletCode(e.target.value)} className="min-h-14 w-full rounded-2xl border border-[var(--border-faint)] text-lg" autoCapitalize="characters"/></label><button type="button" disabled={busy || !outletCode.trim()} className="job-secondary w-full" onClick={() => void lookup(outletCode)}>Find merchant</button>{outlets.map(row => <button type="button" key={row.id} onClick={() => setOutlet(row)} className="job-secondary w-full">{row.name} · {row.address}</button>)}</> : <><div className="flex items-center gap-3"><Store className="h-7 w-7 text-gold" aria-hidden/><div><h3 className="text-xl font-bold">{outlet.display_name}</h3><p className="text-base text-ink-500">Verified · {outlet.name}</p></div></div><button type="button" className="min-h-14 text-base underline" onClick={() => setOutlet(null)}>Change merchant</button>
        <h3 className="text-xl font-bold">Items bought here</h3>
        {available.length === 0 && <p className="text-base text-ink-500">All list items already have purchase requests.</p>}
        {available.map(item => <div key={item.id} className="space-y-3"><label className="flex min-h-14 items-center gap-3 text-lg font-semibold"><input type="checkbox" className="h-6 w-6 accent-gold" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>{item.quantity} × {item.name}</label>{selected.includes(item.id) && <label className="block space-y-2 text-base">Total for this quantity (UGX)<input inputMode="numeric" value={amounts[item.id] ?? ""} onChange={e => setAmounts(current => ({ ...current, [item.id]: e.target.value.replace(/[^\d]/g, "") }))} className="min-h-14 w-full rounded-2xl border border-[var(--border-faint)] text-xl"/></label>}</div>)}
        <label className="block space-y-3 text-base">Receipt number (optional)<input value={receipt} onChange={e => setReceipt(e.target.value)} className="min-h-14 w-full rounded-2xl border border-[var(--border-faint)] text-lg"/></label>
        <p className="flex justify-between text-xl"><span>Total</span><strong>{formatUgx(total || 0)}</strong></p>
        {budget && total > budget.remaining && <p role="alert">Amount exceeds the remaining funded budget.</p>}
        <JobAction><button type="button" disabled={!valid || busy} className="job-primary" onClick={() => void generate()}>{busy ? "Creating…" : "Generate purchase code"}</button></JobAction>
        </>}
      </>}
      {error && <p role="alert" className="text-base">{error}</p>}
    </div></Modal>}
  </section>;
}
