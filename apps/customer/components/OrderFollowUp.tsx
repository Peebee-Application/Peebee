"use client";
import { FollowUpMessages } from "@peebee/shared/follow-up-messages";
import { DEFAULT_ATTENTION_SETTINGS, playNotificationSoundOnce, type AttentionParty, type AttentionSettings, type OrderRow } from "@peebee/shared";
import { BellRing, Bike, CarTaxiFront, Check, ChevronLeft, MapPin, Megaphone, MessageCircle, Phone, ShoppingBag, Store, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useCalls } from "../lib/calls-context";
import { useChatDrawer } from "../lib/chat-drawer";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../lib/nav-primary-action";
import { BrandHeader } from "./BrandHeader";

const reasons = ["Ask for an update", "I’m outside", "Please check my order"];
export function OrderFollowUp({ order, itemCount, enabled = true }: { order: OrderRow; itemCount: number; enabled?: boolean }) {
  const { user } = useAuth();
  const { startCall } = useCalls();
  const { openThread } = useChatDrawer();
  const [open, setOpen] = useState(false), [parties, setParties] = useState<AttentionParty[]>([]), [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState<AttentionSettings>(DEFAULT_ATTENTION_SETTINGS), [available, setAvailable] = useState(false), [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reason, setReason] = useState(reasons[0]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [arrival, setArrival] = useState(false);
  const [messageParty, setMessageParty] = useState<AttentionParty | null>(null);
  const arrivalDialog = useRef<HTMLDialogElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const active = !["Cancelled", "Expired", "Settle", "Handover"].includes(order.stage);
  const selected = parties.find((p) => p.userId === selectedId) ?? parties[0];
  const arrivalKey = `peebee-arrival:${user?.id}:${order.id}:${order.rider_id}`;
  const name = order.rider_name?.split(/\s+/)[0] || "Your rider";
  useEffect(() => {
    let live = true;
    api.getAttentionSettings().then((r) => { if (live) { setSettings(r.settings); setAvailable(r.available); setSettingsLoaded(true); } }).catch(() => {});
    return () => { live = false; };
  }, [order.id]);
  useEffect(() => {
    if (!enabled || !active) return;
    let live = true;
    api.getFollowUp(order.id).then((r) => { if (live) setParties(r.parties); }).catch((e) => { if (live && open) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [order.id, order.rider_id, order.stage, enabled, active, open]);
  useEffect(() => {
    if (!settingsLoaded || !enabled || !settings.arrivalEnabled || order.stage !== "Arrived" || !user) return;
    try {
      if (localStorage.getItem(arrivalKey)) return;
      localStorage.setItem(arrivalKey, "shown");
    } catch { /* The mounted component still presents only once. */ }
    // Synchronize a newly received arrival with its per-account persisted presentation marker.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArrival(true);
    playNotificationSoundOnce(`arrival-${order.id}`);
  }, [arrivalKey, order.id, order.stage, settings.arrivalEnabled, settingsLoaded, enabled, user]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (arrival && arrivalDialog.current && !arrivalDialog.current.open) arrivalDialog.current.showModal();
  }, [arrival]);
  useRegisterNavPrimaryAction(enabled && active && !arrival ? { label: "FOLLOW UP", icon: BellRing, onClick: () => { setError(""); setOpen(true); } } : null, 1);
  useRegisterNavBack(open, () => setOpen(false), 2);
  async function call() {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await api.startAttention(order.id, { recipientId: selected.userId, reason, mode: "tap" }); setOpen(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  function message() {
    if (!selected) return;
    setOpen(false); setMessageParty(selected);
  }
  return <>
    {messageParty && <FollowUpMessages api={api} orderId={order.id} recipientId={messageParty.userId} name={messageParty.name} onClose={() => setMessageParty(null)} />} 
    {arrival && active && order.stage === "Arrived" && settings.arrivalEnabled && <dialog ref={arrivalDialog} onCancel={() => setArrival(false)} onClose={() => setArrival(false)} aria-label="Your rider has arrived" className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-cream p-0 text-ink">
      <BrandHeader />
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg flex-col gap-4 px-5 pb-5 pt-4">
        <p className="text-sm text-ink-500">Order #{order.id.slice(-6)} · {order.restaurant_name || order.store_name || "Your delivery"}</p>
        <div className="flex items-center justify-between gap-2 text-sm">{["Preparing", "On the way", "Arrived"].map((label, i) => <div key={label} className="flex flex-1 flex-col items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold text-ink-gold">{i === 2 ? <MapPin aria-hidden /> : <Check aria-hidden />}</span><strong>{label}</strong></div>)}</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="relative flex h-36 w-36 items-center justify-center"><BellRing className="h-36 w-36 text-gold" strokeWidth={1.5} aria-hidden /><Bike className="absolute top-12 h-12 w-12 text-ink" strokeWidth={1.75} aria-hidden /></span>
          <h1 className="text-4xl font-black tracking-tight">{name} is outside</h1>
          <p className="text-base text-ink-500">Your rider has arrived with your order.<br />Please meet {name} at the handoff spot.</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] p-4"><ShoppingBag aria-hidden /><strong>{order.restaurant_name || order.store_name || "Your order"}</strong><span className="text-sm text-ink-500">· {itemCount} items</span></div>
        <button type="button" className="flex min-h-14 items-center justify-center gap-3 rounded-full bg-gold text-xl font-extrabold text-ink-gold" disabled={busy} onClick={async () => {
          if (!order.rider_id || lock.current) return;
          lock.current = true; setBusy(true); setError("");
          try { await api.sendFollowUpMessage(order.id, order.rider_id, "I’m coming"); setArrival(false); }
          catch (e) { setError(errorMessage(e)); }
          finally { lock.current = false; setBusy(false); }
        }}><Check aria-hidden />I’m coming</button>
        <button type="button" className="flex min-h-12 items-center justify-center gap-3 rounded-full border border-ink font-bold" onClick={() => { setArrival(false); if (order.rider_id) openThread({ type: "rider", id: order.rider_id }); }}><MessageCircle aria-hidden />Message rider</button>
        {error && <p role="alert" className="text-sm">{error}</p>}
        <button type="button" className="text-center text-sm font-bold underline" onClick={() => setArrival(false)}>Back to order</button>
      </div>
    </dialog>}
    <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="follow-up-dialog" aria-labelledby="follow-up-title">
      <div className="follow-up-sheet">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/25" aria-hidden />
        <button type="button" aria-label="Close follow up" className="absolute right-5 top-5 p-1" onClick={() => setOpen(false)}><X aria-hidden /></button>
        <h2 id="follow-up-title" className="text-2xl font-extrabold">Follow up</h2>
        <p className="mb-5 mt-1 text-base text-ink-500">Get details on your order&apos;s progress</p>
        <fieldset className="space-y-2"><legend className="sr-only">Who to call</legend>{parties.map((p) => {
          const Icon = p.role === "rider" ? Bike : p.role === "taxi" ? CarTaxiFront : Store;
          return <label key={`${p.role}:${p.userId}`} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 font-bold ${selected?.userId === p.userId ? "border-gold bg-gold/40" : "border-[var(--border-faint)]"}`}><Icon className="h-6 w-6 shrink-0" aria-hidden /><span className="flex-1">{p.label} · {p.name}</span><input type="radio" name="follow-up-recipient" value={p.userId} checked={selected?.userId === p.userId} onChange={() => setSelectedId(p.userId)} className="h-5 w-5 accent-ink" /></label>;
        })}</fieldset>
        {!parties.length && <p role="status" className="py-4 text-sm">No delivery contact is assigned yet.</p>}
        <label className="mb-5 mt-6 block space-y-2 text-sm font-bold"><span>Reason</span><select className="min-h-11 w-full rounded-xl px-3 font-normal" value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label>
        <div className="flex gap-2"><button type="button" disabled={!selected} onClick={() => { if (selected) { setOpen(false); startCall({ calleeId: selected.userId, orderId: order.id, restaurantId: selected.restaurantId }); } }} className="follow-up-secondary"><Phone aria-hidden />Voice call</button><button type="button" disabled={!selected} onClick={message} className="follow-up-secondary"><MessageCircle aria-hidden />Message</button></div>
        {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
        {(!available || !settings.enabled) && <p role="status" className="mt-4 text-sm">Follow-up calls are not available yet.</p>}
      </div>
      <nav aria-label="Follow up action" className="follow-up-footer"><button type="button" aria-label="Back to order" onClick={() => setOpen(false)}><ChevronLeft aria-hidden /></button><button type="button" disabled={!selected || busy || !available || !settings.enabled} aria-busy={busy} onClick={() => void call()}><Megaphone aria-hidden /><strong>{busy ? "CALLING…" : `CALL ${selected?.label.toUpperCase() ?? "CONTACT"}`}</strong></button></nav>
    </dialog>
  </>;
}
