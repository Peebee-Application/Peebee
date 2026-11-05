"use client";

import { QrCode } from "@peebee/shared/qr-code";
import { Select } from "@peebee/shared/select";

import type { MerchantCategory, MerchantOutlet } from "@peebee/shared";
import { Copy, LocateFixed, Plus, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Accordion } from "../../components/Accordion";

export default function OutletsPage() {
  const { merchant } = useAuth();
  const [outlets, setOutlets] = useState<MerchantOutlet[]>([]);
  const [categories, setCategories] = useState<MerchantCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => { if (merchant) { const [o, c] = await Promise.all([api.merchantOutlets(merchant.id), api.merchantCategories()]); setOutlets(o.outlets); setCategories(c.categories); setCategoryId((old) => old || c.categories[0]?.id || ""); } }, [merchant]);
  useEffect(() => { load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  function capture() { setBusy(true); navigator.geolocation.getCurrentPosition((p) => { setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); }, () => { setError("Location is required for payment proximity checks."); setBusy(false); }, { enableHighAccuracy: true, timeout: 15_000 }); }
  async function add(event: React.FormEvent) { event.preventDefault(); if (!merchant || !location) return; setBusy(true); setError(""); try { await api.createMerchantOutlet(merchant.id, { name, categoryId, address: address || undefined, ...location }); setAdding(false); setName(""); setAddress(""); setLocation(null); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function changeStatus(outlet: MerchantOutlet) { if (!merchant) return; setBusy(true); try { await api.updateMerchantOutlet(merchant.id, outlet.id, { status: outlet.status === "active" ? "closed" : "active" }); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }

  const field = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-4 text-lg";
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header className="flex items-center justify-between gap-3"><h1 className="text-3xl font-black">Outlets</h1>{merchant?.member_role !== "cashier" && <button aria-label="Add outlet" onClick={() => setAdding(true)} className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-ink-gold"><Plus className="h-7 w-7" aria-hidden /></button>}</header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {outlets.length === 0 && <div className="home-card flex flex-col items-center gap-2 py-10 text-center"><Store className="h-12 w-12 text-ink-500" aria-hidden /><p className="text-lg font-bold text-ink-500">No outlets yet</p></div>}
    {outlets.map((outlet, index) => <Accordion key={outlet.id} title={outlet.name} icon={Store} summary={outlet.status} defaultOpen={index === 0}>
      <div className="rounded-xl bg-[rgb(var(--surface-muted))] p-4 text-center">
        <p className="text-base text-ink-500">Rider payment code</p>
        <p className="mt-1 font-mono text-3xl font-black tracking-wider">{outlet.code}</p>
        <div className="mt-3 flex justify-center"><QrCode value={outlet.code} size={170} className="p-2 shadow-sm" label={`QR code for ${outlet.name}`} /></div>
        <button onClick={() => navigator.clipboard.writeText(outlet.code)} className="mt-3 inline-flex min-h-12 items-center gap-2 px-4 text-lg font-bold text-gold"><Copy className="h-5 w-5" aria-hidden />Copy code</button>
      </div>
      <p className="text-base text-ink-500">{outlet.category_name} · {outlet.address || "No address"}</p>
      {merchant?.member_role !== "cashier" && <button disabled={busy} onClick={() => changeStatus(outlet)} className="min-h-14 w-full rounded-full border border-gold text-lg font-bold text-gold">{outlet.status === "active" ? "Close outlet" : "Reopen outlet"}</button>}
    </Accordion>)}
    {adding && <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-4"><form onSubmit={add} className="mx-auto w-full max-w-xl space-y-3 rounded-[24px] bg-[rgb(var(--surface))] p-5"><h2 className="text-xl font-bold">Add outlet</h2><input required aria-label="Outlet name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Outlet name" className={field} /><Select aria-label="Business category" required value={categoryId} onValueChange={(value) => setCategoryId(value)} className={field}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><input aria-label="Address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className={field} /><button type="button" onClick={capture} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-gold text-lg font-bold text-gold"><LocateFixed className="h-6 w-6" aria-hidden />{location ? "Location captured" : "Capture location"}</button><div className="flex gap-2"><button type="button" onClick={() => setAdding(false)} className="min-h-14 flex-1 rounded-full border border-[var(--border-faint)] text-lg font-bold">Cancel</button><button disabled={busy || !location} className="min-h-14 flex-[2] rounded-full bg-gold text-lg font-bold text-ink-gold disabled:opacity-50">Add outlet</button></div></form></div>}
  </div>;
}
