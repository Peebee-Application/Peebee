"use client";

import { FileText, ListChecks, PlusCircle, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { TabBar } from "../../components/TabBar";
import { api, merchantRequest, errorMessage } from "../../lib/api";
import type { MerchantOutlet } from "@peebee/shared";
import { useAuth } from "../../lib/auth-context";

type Row = Record<string, string | number | null>;
type Report = {scope:{environment:string;from:string;until:string;currency:string};availability:{expenseJournal:boolean;posSnapshots:boolean};summary:{pos:Row;unassignedHistoricalPos:Row;ledger:Row[];expenses:Row[];currentBalances:Row|null};pos:Row[];ledger:Row[];entries:Row[];page:number;hasMore:boolean;accounting:{note:string}};
const input = "mt-1 min-h-14 w-full rounded-xl p-3 text-lg";
const button = "min-h-14 rounded-full border border-gold px-6 py-2 text-lg font-bold disabled:opacity-50";
const dateValue = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const money = (value: unknown) => `UGX ${Number(value??0).toLocaleString()}`;
function initialPeriod() { const now=new Date(); return {from:dateValue(new Date(now.getFullYear(),now.getMonth(),1)),to:dateValue(now),outlet:"",page:1}; }

export default function FinancialReportsPage() {
  const {merchant}=useAuth();
  const [draft,setDraft]=useState(initialPeriod);
  const [filters,setFilters]=useState(initialPeriod);
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [tab,setTab]=useState<"summary"|"records"|"add">("summary");
  const [notice,setNotice]=useState("");
  const [entry,setEntry]=useState({category:"operating_expense",amount:"",date:dateValue(new Date()),description:"",reference:"",outlet:""});
  const [voidId,setVoidId]=useState(""); const [voidReason,setVoidReason]=useState("");
  const request=useRef<{payload:string;id:string}|null>(null);
  const epoch=useRef(0);
  const [outlets,setOutlets]=useState<MerchantOutlet[]>([]);
  const [branchError,setBranchError]=useState("");
  const [branchReload,setBranchReload]=useState(0);
  useEffect(()=>{
    let active=true; setOutlets([]); setBranchError("");
    if(!merchant?.id)return;
    void api.merchantOutlets(merchant.id).then(result=>{if(active)setOutlets(result.outlets);}).catch(cause=>{if(active)setBranchError(errorMessage(cause));});
    return ()=>{active=false;};
  },[merchant?.id,branchReload]);
  useEffect(()=>{
    request.current=null;
    setDraft(previous=>({...previous,outlet:""}));
    setFilters(previous=>previous.outlet||previous.page!==1?{...previous,outlet:"",page:1}:previous);
    setEntry(previous=>({...previous,outlet:"",amount:"",description:"",reference:""}));
    setVoidId("");setVoidReason("");setNotice("");
  },[merchant?.id]);
  useEffect(()=>{
    const current=++epoch.current; setReport(null); setLoading(true); setError("");
    const from=new Date(`${filters.from}T00:00:00`), until=new Date(`${filters.to}T00:00:00`); until.setDate(until.getDate()+1);
    if (!Number.isFinite(from.getTime())||!Number.isFinite(until.getTime())||until<=from) {setError("Choose a valid date range.");setLoading(false);return;}
    const query=new URLSearchParams({from:from.toISOString(),until:until.toISOString(),page:String(filters.page)});
    if(filters.outlet.trim())query.set("outletId",filters.outlet.trim());
    void merchantRequest<Report>(`/merchants/me/financial-report?${query}`).then(result=>{if(current===epoch.current)setReport(result);}).catch(cause=>{if(current===epoch.current)setError(errorMessage(cause));}).finally(()=>{if(current===epoch.current)setLoading(false);});
    return ()=>{++epoch.current;};
  },[filters,merchant?.id]);
  async function saveEntry() {
    setSaving(true);setError("");setNotice("");
    try {
      const data={category:entry.category,amountUgx:Number(entry.amount),occurredAt:new Date(`${entry.date}T12:00:00`).toISOString(),description:entry.description.trim(),reference:entry.reference.trim(),outletId:entry.outlet.trim()||null};
      const payload=JSON.stringify(data);
      if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
      await merchantRequest("/merchants/me/financial-entries",{method:"POST",body:{...data,requestId:request.current.id}});
      request.current=null;setEntry({...entry,amount:"",description:"",reference:""});setNotice("Bookkeeping entry recorded. No wallet funds were moved.");setFilters({...filters});
    }catch(cause){setError(errorMessage(cause));}finally{setSaving(false);}
  }
  async function voidEntry() {
    setSaving(true);setError("");setNotice("");
    try {await merchantRequest(`/merchants/me/financial-entries/${encodeURIComponent(voidId)}/void`,{method:"POST",body:{reason:voidReason}});setVoidId("");setVoidReason("");setNotice("Entry voided. Its original amount and audit history remain recorded.");setFilters({...filters});}
    catch(cause){setError(errorMessage(cause));}finally{setSaving(false);}
  }
  function exportPage() {
    if(!report)return;
    const rows=[...report.pos.map(r=>["POS record",r.created_at,r.id,r.payment_method,r.total_amount,r.costUgx,"recorded","",""]),...report.ledger.map(r=>["Ledger movement",r.created_at,r.transaction_id,r.kind,r.amount,"",r.purpose,r.buyer_amount_ugx,r.platform_fee_ugx]),...report.entries.map(r=>["Journal",r.occurred_at,r.id,r.category,r.amount_ugx,"",r.voided_at?"voided":"active","",""])];
    const cell=(value:unknown)=>`"${(typeof value==="string"&&/^[=+\-@\t\r]/.test(value)?"'":"")+String(value??"").replaceAll('"','""')}"`;
    const csv=[["Source","Time (UTC)","Reference","Category","Amount UGX (sources not additive)","POS recorded cost UGX","Status","Digital buyer amount UGX","Digital platform fee UGX"],...rows].map(row=>row.map(cell).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`merchant-statement-${report.scope.environment}-${filters.from}-${filters.to}-page-${report.page}.csv`;a.click();URL.revokeObjectURL(url);
  }
  return <div className="mx-auto max-w-6xl space-y-4 px-4 pb-24 pt-5">
    <header><h1 className="text-3xl font-black">Statements</h1></header>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="rounded-xl bg-green/10 p-4 text-base text-green">{notice}</p>}
    <Accordion title="Period" icon={SlidersHorizontal} summary={`${filters.from.slice(5)} → ${filters.to.slice(5)}`}>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();setFilters({...draft,page:1});}}>
      <label>From<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})} className={input}/></label>
      <label>Through<input type="date" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})} className={input}/></label>
      <label>Branch<select value={draft.outlet} onChange={e=>setDraft({...draft,outlet:e.target.value})} className={input}><option value="">All branches</option>{outlets.map(outlet=><option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><button className={button} disabled={loading}>Load statement</button>
    </form>
<p className="text-xs text-ink-500">Date boundaries use your device time zone. Transaction times and exports use UTC.</p>
    {branchError&&<div><p role="alert">Branches could not load: {branchError}</p><button className={button} onClick={()=>setBranchReload(value=>value+1)}>Retry branches</button></div>}

    </Accordion>
    {loading&&<p role="status" className="py-4 text-center text-lg text-ink-500">Loading…</p>}
    {report&&<>
      <TabBar label="Statement" active={tab} onChange={setTab} tabs={[{id:"summary",label:"Summary",icon:FileText},{id:"records",label:"Records",icon:ListChecks},{id:"add",label:"Add expense",icon:PlusCircle}]} />
      {tab==="summary"&&<div className="space-y-4" role="tabpanel" aria-label="Summary">
      <p className="text-sm font-bold">{report.scope.environment.toUpperCase()} · {filters.from} through {filters.to}</p>
      <section className="space-y-3 rounded-2xl border border-surface-200 p-4"><h2 className="text-lg font-bold">Recorded POS sales</h2><p>{report.summary.pos.count} sales · {money(report.summary.pos.recordedTotal)} after {money(report.summary.pos.discounts)} in discounts and loyalty redemptions.</p><p className="text-sm">Historical POS without a recorded environment: {report.summary.unassignedHistoricalPos.count} records ({money(report.summary.unassignedHistoricalPos.total)}). Excluded from live/sandbox totals.</p></section>
      <section className="space-y-3 rounded-2xl border border-surface-200 p-4"><h2 className="text-lg font-bold">Ledger movements by source</h2>{report.summary.ledger.length?report.summary.ledger.map((r,i)=><p key={i}>{String(r.kind).replaceAll("_"," ")} · {r.purpose}: <strong>{money(r.amount)}</strong></p>):<p>No ledger movements in this period.</p>}<p className="text-sm">Digital sales and refunds, order allocations, fees and settlements appear under their recorded transaction kinds. Pending orders are not treated as received revenue.</p></section>
      <section className="space-y-2 rounded-2xl border border-surface-200 p-4"><h2 className="text-lg font-bold">Recorded expenses and taxes</h2>{report.summary.expenses.length?report.summary.expenses.map(r=><p key={String(r.category)}>{String(r.category).replaceAll("_"," ")}: {money(r.amount)}</p>):<p>No journal expenses recorded for this period.</p>}</section>
      {report.summary.currentBalances&&<section className="rounded-2xl border border-surface-200 p-4"><h2 className="font-bold">Current merchant balances</h2><p>Available {money(report.summary.currentBalances.available)} · Held {money(report.summary.currentBalances.held)} · Settling {money(report.summary.currentBalances.settling)}</p><p className="text-xs">Current balances, not period closing balances.</p></section>}
      <p className="text-sm text-ink-500">{report.accounting.note}</p><button className={button} onClick={exportPage}>Export this page as CSV</button>
      </div>}
      {tab==="records"&&<div className="space-y-4" role="tabpanel" aria-label="Records">
      <section aria-label="Statement source records" className="space-y-2"><h2 className="text-lg font-bold">Source records · page {report.page}</h2>{!report.pos.length&&!report.ledger.length&&!report.entries.length&&<p>No records on this page.</p>}{report.pos.map(r=><article key={String(r.id)} className="rounded-xl border border-surface-200 p-3"><p className="font-bold">POS · {r.receipt_code} · {money(r.total_amount)}</p><p className="text-sm">{r.created_at} UTC · {r.payment_method} · Recorded cost: {r.costUgx==null?"unknown":money(r.costUgx)}</p></article>)}{report.ledger.map(r=><article key={String(r.id)} className="rounded-xl border border-surface-200 p-3"><p className="font-bold">Ledger · {String(r.kind).replaceAll("_"," ")} · {money(r.amount)}</p><p className="break-all text-sm">{r.created_at} UTC · {r.purpose} · {r.reference_id??r.transaction_id}</p>{r.buyer_amount_ugx!=null&&<p className="text-sm">Buyer amount: {money(r.buyer_amount_ugx)} · Platform fee: {money(r.platform_fee_ugx)} · Merchant ledger movement: {money(r.amount)}</p>}</article>)}{report.entries.map(r=><article key={String(r.id)} className="rounded-xl border border-surface-200 p-3"><p className="font-bold">{String(r.category).replaceAll("_"," ")} · {money(r.amount_ugx)} {r.voided_at?"· VOIDED":""}</p><p className="break-all text-sm">{r.occurred_at} UTC · {r.description} · {r.reference}</p>{!r.voided_at&&<button type="button" className={button} onClick={()=>setVoidId(String(r.id))}>Void this entry</button>}</article>)}</section>
      <div className="flex gap-3"><button className={button} disabled={filters.page===1||loading} onClick={()=>setFilters({...filters,page:filters.page-1})}>Previous page</button><button className={button} disabled={!report.hasMore||loading} onClick={()=>setFilters({...filters,page:filters.page+1})}>Next page</button></div>
      </div>}
      {tab==="add"&&<div className="space-y-4" role="tabpanel" aria-label="Add expense">
      {report.availability.expenseJournal?<section className="space-y-3 rounded-2xl border border-surface-200 p-4"><h2 className="text-lg font-bold">Record an expense or tax</h2><p className="text-sm">Bookkeeping only. This does not pay a supplier, transfer money or change your settlement balance.</p><form onSubmit={e=>{e.preventDefault();void saveEntry();}} className="grid gap-3 sm:grid-cols-2">
        <label>Category<select value={entry.category} onChange={e=>setEntry({...entry,category:e.target.value})} className={input}><option value="operating_expense">Operating expense</option><option value="cost_of_goods">Cost of goods</option><option value="tax">Tax</option></select></label>
        <label>Amount (UGX)<input type="number" min="1" step="1" required value={entry.amount} onChange={e=>setEntry({...entry,amount:e.target.value})} className={input}/></label>
        <label>Date<input type="date" required value={entry.date} onChange={e=>setEntry({...entry,date:e.target.value})} className={input}/></label>
        <label>Branch<select value={entry.outlet} onChange={e=>setEntry({...entry,outlet:e.target.value})} className={input}><option value="">Merchant-wide expense</option>{outlets.map(outlet=><option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
        <label>Description<input required minLength={3} maxLength={500} value={entry.description} onChange={e=>setEntry({...entry,description:e.target.value})} className={input}/></label>
        <label>Receipt or reference<input required maxLength={200} value={entry.reference} onChange={e=>setEntry({...entry,reference:e.target.value})} className={input}/></label><button className={button} disabled={saving}>Record entry</button>
      </form></section>:<p>The expense journal is awaiting its database migration. Other available source statements remain accessible.</p>}
      {voidId&&<form className="space-y-3 rounded-2xl border border-surface-200 p-4" onSubmit={e=>{e.preventDefault();void voidEntry();}}><h2 className="font-bold">Void journal entry</h2><p className="text-sm">The original record will remain in the statement.</p><label className="block">Reason<textarea required minLength={10} maxLength={500} value={voidReason} onChange={e=>setVoidReason(e.target.value)} className={input}/></label><div className="flex gap-3"><button className={button} disabled={saving}>Confirm void</button><button type="button" className={button} onClick={()=>setVoidId("")}>Cancel</button></div></form>}
      </div>}
    </>}
  </div>;
}
