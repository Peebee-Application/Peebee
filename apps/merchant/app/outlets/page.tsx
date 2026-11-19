"use client";

import { QrCode } from "@peebee/shared/qr-code";
import { Select } from "@peebee/shared/select";

import type { MerchantCategory, MerchantOutlet } from "@peebee/shared";
import { Building2, Check, ChevronRight, Copy, DoorClosed, DoorOpen, LocateFixed, MapPin, Plus, QrCode as QrIcon, Store, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { AccountFrame, ErrorNote, Pill, useBack } from "../../components/account/AccountUI";
import { BottomSheet } from "../../components/store/BottomSheet";
import { PageHeader, card, fieldCls, labelCls } from "../../components/store/StoreUI";

export default function OutletsPage() {
  const { merchant } = useAuth();
  const back = useBack("/account");
  const [outlets, setOutlets] = useState<MerchantOutlet[]>([]);
  const [categories, setCategories] = useState<MerchantCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");

  const load = useCallback(async () => { if (merchant) { const [o, c] = await Promise.all([api.merchantOutlets(merchant.id), api.merchantCategories()]); setOutlets(o.outlets); setCategories(c.categories); setCategoryId((old) => old || c.categories[0]?.id || ""); setLoaded(true); } }, [merchant]);
  useEffect(() => { load().catch((cause) => { setError(errorMessage(cause)); setLoaded(true); }); }, [load]);
  function capture() { setBusy(true); setSheetError(""); navigator.geolocation.getCurrentPosition((p) => { setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); }, () => { setSheetError("Location is required for payment proximity checks."); setBusy(false); }, { enableHighAccuracy: true, timeout: 15_000 }); }
  async function add(event: React.FormEvent) { event.preventDefault(); if (!merchant) return; if (!name.trim()) { setSheetError("Type the outlet name."); return; } if (!location) { setSheetError("Capture the location first."); return; } setBusy(true); setSheetError(""); try { await api.createMerchantOutlet(merchant.id, { name: name.trim(), categoryId, address: address || undefined, ...location }); setAdding(false); setName(""); setAddress(""); setLocation(null); await load(); } catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(false); } }
  async function changeStatus(outlet: MerchantOutlet) { if (!merchant) return; setBusy(true); setError(""); try { await api.updateMerchantOutlet(merchant.id, outlet.id, { status: outlet.status === "active" ? "closed" : "active" }); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  function copy(code: string) { void navigator.clipboard?.writeText(code).then(() => { setCopied(code); window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000); }).catch(() => undefined); }

  const canManage = merchant?.member_role !== "cashier";
  return (
    <AccountFrame testId="outlets">
      <PageHeader title="Outlets" count={loaded ? outlets.length : undefined} onBack={back} backLabel="Back" />
      <ErrorNote message={error} />
      {canManage && (
        <button type="button" aria-label="Add outlet" onClick={() => { setSheetError(""); setAdding(true); }} data-testid="add-outlet"
          className="flex min-h-[72px] w-full items-center gap-3.5 rounded-[24px] bg-gold px-[18px] text-left text-[21px] font-black text-ink-gold shadow-[0_10px_26px_rgb(var(--gold)/0.35)] active:scale-[.98]">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-black text-gold"><Plus className="h-7 w-7" strokeWidth={3} /></span>
          <span className="flex-1">Add outlet</span><ChevronRight className="h-7 w-7" strokeWidth={3} />
        </button>
      )}
      {loaded && outlets.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 rounded-[30px] border-2 border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 py-8 text-center">
          <span className="grid h-24 w-24 place-items-center rounded-[30px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Store className="h-12 w-12" /></span>
          <p className="text-[22px] font-black text-ink">No outlets yet</p>
        </div>
      )}
      {outlets.map((outlet) => {
        const open = outlet.status === "active";
        return (
          <div key={outlet.id} className={`${card} flex flex-col gap-3.5 p-4`} data-testid={`outlet-${outlet.id}`}>
            <div className="flex items-center gap-3.5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Building2 className="h-[30px] w-[30px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[21px] font-black leading-tight text-ink">{outlet.name}</p>
                <p className="mt-0.5 break-words text-[16px] font-bold text-ink-500">{[outlet.category_name, outlet.address || "No address"].filter(Boolean).join(" · ")}</p>
              </div>
              <Pill cls={open ? "bg-green-600/12 text-green-700 dark:text-green-300" : "bg-[rgb(var(--surface-muted))] text-ink-500"}>{open ? "Open" : outlet.status === "suspended" ? "Paused" : "Closed"}</Pill>
            </div>
            <div className="flex items-center gap-3 rounded-[20px] bg-[#0a0a0a] px-4 py-3.5 text-white">
              <div className="min-w-0 flex-1"><p className="text-[15px] font-bold text-white/65">Rider pay code</p><p className="break-all font-mono text-[28px] font-black tracking-[.08em] text-gold" data-testid="outlet-code">{outlet.code}</p></div>
              <button type="button" onClick={() => setQrFor(qrFor === outlet.id ? null : outlet.id)} aria-label={`Show QR code for ${outlet.name}`} aria-expanded={qrFor === outlet.id} data-testid="outlet-qr"
                className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[18px] bg-gold text-ink-gold active:scale-95"><QrIcon className="h-[30px] w-[30px]" /></button>
            </div>
            {qrFor === outlet.id && <div className="flex justify-center rounded-[20px] bg-white p-3"><QrCode value={outlet.code} size={200} className="p-2" label={`QR code for ${outlet.name}`} /></div>}
            <div className={`grid gap-2.5 ${canManage ? "grid-cols-2" : "grid-cols-1"}`}>
              <button type="button" onClick={() => copy(outlet.code)} data-testid="outlet-copy" className="flex min-h-[60px] items-center justify-center gap-2 rounded-full border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-[18px] font-black text-ink active:scale-[.98]">
                {copied === outlet.code ? <Check className="h-[22px] w-[22px] text-green-600" strokeWidth={3} /> : <Copy className="h-[22px] w-[22px]" />}{copied === outlet.code ? "Copied" : "Copy"}
              </button>
              {canManage && (
                <button type="button" disabled={busy} onClick={() => changeStatus(outlet)} data-testid="outlet-status" className="flex min-h-[60px] items-center justify-center gap-2 rounded-full border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-[18px] font-black text-ink active:scale-[.98] disabled:opacity-50">
                  {open ? <DoorClosed className="h-[22px] w-[22px]" /> : <DoorOpen className="h-[22px] w-[22px]" />}{open ? "Close" : "Reopen"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {adding && (
        <BottomSheet title="Add outlet" onClose={() => setAdding(false)} testId="add-outlet-sheet"
          footer={<button type="submit" form="add-outlet-form" disabled={busy} data-testid="add-outlet-save" className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-[20px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] active:scale-[.98] disabled:opacity-50"><Plus className="h-6 w-6" strokeWidth={3} /> Add outlet</button>}>
          <form id="add-outlet-form" onSubmit={add} className="space-y-4 pt-1">
            <div><label htmlFor="outlet-name" className={labelCls}><Store className="h-5 w-5 text-gold" /> Outlet name</label><input id="outlet-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} data-testid="outlet-name" /></div>
            <div><label className={labelCls}><Tag className="h-5 w-5 text-gold" /> Category</label><Select aria-label="Business category" required value={categoryId} onValueChange={(value) => setCategoryId(value)} className={fieldCls}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <div><label htmlFor="outlet-address" className={labelCls}><MapPin className="h-5 w-5 text-gold" /> Address</label><input id="outlet-address" value={address} onChange={(e) => setAddress(e.target.value)} className={fieldCls} data-testid="outlet-address" /></div>
            <button type="button" onClick={capture} disabled={busy} data-testid="outlet-locate" className={`flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-[20px] border-2 text-[19px] font-black ${location ? "border-green-600/50 bg-green-600/10 text-green-700 dark:text-green-300" : "border-gold text-ink"}`}>
              {location ? <Check className="h-6 w-6" strokeWidth={3} /> : <LocateFixed className="h-6 w-6 text-gold" />}{location ? "Location captured" : "Capture location"}
            </button>
            <ErrorNote message={sheetError} />
          </form>
        </BottomSheet>
      )}
    </AccountFrame>
  );
}
