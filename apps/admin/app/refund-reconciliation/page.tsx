"use client";

import { hasPermission } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { adminRequest, requestErrorMessage } from "../../lib/admin-request";

type Purchase = {id: string; store_id: string; store_name: string; price_paid_ugx: number; refunded_at: string; classification: string};
type Evidence = {purchase: Purchase; classification: string; fingerprint: string; transactions: Record<string, unknown>[]; legacyCreditCandidates: Record<string, unknown>[]; candidatesTruncated: boolean; reviews: {id: string; actor_name: string; summary: string; action: string; created_at: string}[]};
type Page = {items: Purchase[]; nextCursor: string | null};
const button = "min-h-11 rounded-full border border-gold px-4 py-2 font-bold disabled:opacity-50";

export default function RefundReconciliationPage() {
  const {user} = useAuth();
  const allowed = hasPermission(user?.adminRole ?? null, "merchant_finance.manage");
  const [page, setPage] = useState<Page>({items: [], nextCursor: null});
  const [store, setStore] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [decision, setDecision] = useState("investigate");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async (after?: string, storeId = "") => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({limit: "25"});
      if (after) params.set("after", after);
      if (storeId) params.set("storeId", storeId);
      const result = await adminRequest<Page>(`/admin/refund-reconciliation?${params}`);
      setPage(previous => ({items: after ? [...previous.items, ...result.items] : result.items, nextCursor: result.nextCursor}));
    } catch (cause) { setError(requestErrorMessage(cause)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  async function open(id: string) {
    setBusy(true); setError(""); setEvidence(null); setNotice(""); setNote(""); setReference(""); setDecision("investigate");
    try { setEvidence(await adminRequest<Evidence>(`/admin/refund-reconciliation/${encodeURIComponent(id)}`)); }
    catch (cause) { setError(requestErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function review() {
    if (!evidence) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminRequest(`/admin/refund-reconciliation/${encodeURIComponent(evidence.purchase.id)}/reviews`, {method: "POST", body: {fingerprint: evidence.fingerprint, decision, note, reference}});
      setNotice("Review recorded in the activity log. No balances or refund records were changed.");
      setEvidence(await adminRequest<Evidence>(`/admin/refund-reconciliation/${encodeURIComponent(evidence.purchase.id)}`));
    } catch (cause) { setError(requestErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  function exportEvidence() {
    if (!evidence) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], {type: "application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = `refund-${evidence.purchase.id}.json`; link.click(); URL.revokeObjectURL(url);
  }
  if (!allowed) return <main className="p-5"><h1 className="text-xl font-bold">Refund reconciliation</h1><p>Merchant finance permission is required.</p></main>;
  return <main className="mx-auto max-w-6xl space-y-5 p-5">
    <header><h1 className="text-2xl font-bold">Digital refund reconciliation</h1><p className="mt-2 text-ink-500">Review historical refunds against their original payment evidence. A matching amount alone does not prove a buyer was refunded. This workspace records reviews; it never moves money.</p></header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => {event.preventDefault(); setEvidence(null); void load(undefined, store.trim());}}>
      <label className="space-y-1"><span className="block text-sm font-bold">Store ID (optional)</span><input value={store} onChange={event => setStore(event.target.value)} className="rounded-xl p-3" /></label>
      <button className={button} disabled={busy}>Refresh refunds</button>
    </form>
    {busy && <p role="status">Loading financial evidence…</p>}
    <section aria-label="Recorded refunds" className="space-y-3">
      {!busy && !page.items.length && <p>No recorded refunds match this filter.</p>}
      {page.items.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-200 p-4"><div><h2 className="font-bold">{item.store_name} · UGX {Number(item.price_paid_ugx).toLocaleString()}</h2><p className="break-all text-sm">{item.id}</p><p className="text-sm">{item.classification.replaceAll("_", " ")} · {item.refunded_at}</p></div><button className={button} disabled={busy} onClick={() => void open(item.id)}>Review evidence</button></article>)}
      {page.nextCursor && <button className={button} disabled={busy} onClick={() => void load(page.nextCursor!, store.trim())}>Load more refunds</button>}
    </section>
    {evidence && <section aria-label="Refund evidence" className="space-y-4 rounded-2xl border border-surface-200 p-4">
      <h2 className="text-xl font-bold">Evidence: {evidence.purchase.id}</h2><p>Classification: {evidence.classification.replaceAll("_", " ")}. “Evidence present” still requires checking balanced postings and the original payment environment.</p>
      <button className={button} onClick={exportEvidence}>Download evidence</button>
      <details open><summary className="cursor-pointer font-bold">Purchase and ledger postings</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({purchase: evidence.purchase, transactions: evidence.transactions}, null, 2)}</pre></details>
      <details><summary className="cursor-pointer font-bold">Possible legacy credits · {evidence.legacyCreditCandidates.length}</summary><p className="text-sm">These share the buyer and amount but are not linked to this purchase. Verify their source before any correction.{evidence.candidatesTruncated ? " More than 50 candidates exist; this export is incomplete." : ""}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(evidence.legacyCreditCandidates, null, 2)}</pre></details>
      <form className="space-y-3" onSubmit={event => {event.preventDefault(); void review();}}>
        <label className="block"><span className="block text-sm font-bold">Review decision</span><select value={decision} onChange={event => setDecision(event.target.value)} className="mt-1 w-full rounded-xl p-3"><option value="investigate">Needs investigation</option><option value="correction_required">Correction required</option><option value="externally_reconciled">Reconciled with external evidence</option></select></label>
        <label className="block"><span className="block text-sm font-bold">Transaction or support-case reference{decision === "externally_reconciled" ? " (required)" : ""}</span><input value={reference} onChange={event => setReference(event.target.value)} maxLength={300} required={decision === "externally_reconciled"} className="mt-1 w-full rounded-xl p-3" /></label>
        <label className="block"><span className="block text-sm font-bold">Evidence and reasoning</span><textarea value={note} onChange={event => setNote(event.target.value)} required minLength={10} maxLength={2000} rows={4} className="mt-1 w-full rounded-xl p-3" /></label>
        <button className={button} disabled={busy}>Record review</button>
      </form>
      <h3 className="font-bold">Review history</h3>{evidence.reviews.length ? evidence.reviews.map(item => <p key={item.id} className="text-sm">{item.created_at} · {item.actor_name} · {item.action.split(".").at(-1)?.replaceAll("_", " ")}: {item.summary}</p>) : <p>No reviews recorded.</p>}
    </section>}
  </main>;
}
