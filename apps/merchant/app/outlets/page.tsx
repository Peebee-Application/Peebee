"use client";

import { Select } from "@peebee/shared/select";

import type { MerchantCategory, MerchantOutlet } from "@peebee/shared";
import { Copy, LocateFixed, Plus, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

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

  return <div className="space-y-5 px-4 py-5"><header className="flex items-start justify-between"><div><h1 className="text-2xl font-black">Outlets</h1><p className="text-sm text-ink-500">Each location has its own rider payment code.</p></div>{merchant?.member_role !== "cashier" && <button onClick={() => setAdding(true)} className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-ink-gold"><Plus/></button>}</header>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {outlets.map((outlet) => <section key={outlet.id} className="home-card space-y-3"><div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold"><Store className="h-5 w-5"/></span><span className="flex-1"><span className="block font-bold">{outlet.name}</span><span className="text-xs text-ink-500">{outlet.category_name} · {outlet.status}</span></span></div><div className="rounded-xl bg-[rgb(var(--surface-muted))] p-4 text-center"><p className="text-[10px] uppercase tracking-widest text-ink-500">Rider payment code</p><p className="mt-1 font-mono text-xl font-black tracking-wider">{outlet.code}</p><button onClick={() => navigator.clipboard.writeText(outlet.code)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-gold"><Copy className="h-3.5 w-3.5"/>Copy code</button></div><p className="text-xs text-ink-500">{outlet.address || "No address supplied"}</p>{merchant?.member_role !== "cashier" && <button disabled={busy} onClick={() => changeStatus(outlet)} className="text-xs font-bold text-gold">{outlet.status === "active" ? "Close outlet" : "Reopen outlet"}</button>}</section>)}
    {adding && <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-4"><form onSubmit={add} className="mx-auto w-full max-w-xl space-y-3 rounded-[24px] bg-[rgb(var(--surface))] p-5"><h2 className="font-bold">Add outlet</h2><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Outlet name" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><Select aria-label="Business category" required value={categoryId} onValueChange={(value) => setCategoryId(value)} className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><button type="button" onClick={capture} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gold font-bold text-gold"><LocateFixed className="h-4 w-4"/>{location ? "Location captured" : "Capture location"}</button><div className="flex gap-2"><button type="button" onClick={() => setAdding(false)} className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] font-bold">Cancel</button><button disabled={busy || !location} className="min-h-11 flex-[2] rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">Add outlet</button></div></form></div>}
  </div>;
}
