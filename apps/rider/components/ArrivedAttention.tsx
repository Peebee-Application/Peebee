"use client";
import { FollowUpMessages } from "@peebee/shared/follow-up-messages";
import { DEFAULT_ATTENTION_SETTINGS, type AttentionParty, type OrderRow } from "@peebee/shared";
import { useAttentionCall } from "@peebee/shared/use-attention-call";
import { Bell, BellRing, MapPin, MessageCircle, Phone, ShoppingBag, Store, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useCalls } from "../lib/calls-context";

export function ArrivedAttention({ order, itemCount }: { order: OrderRow; itemCount: number }) {
  const [parties, setParties] = useState<AttentionParty[]>([]), [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState(DEFAULT_ATTENTION_SETTINGS), [available, setAvailable] = useState(false), [loadError, setLoadError] = useState("");
  const [messageParty, setMessageParty] = useState<AttentionParty | null>(null);
  const { startCall } = useCalls();
  const selected = parties.find((p) => p.userId === selectedId) ?? parties.find((p) => p.role === "customer");
  const call = useAttentionCall(api, order.id, selected?.userId, settings);
  const gesture = useRef<ReturnType<typeof setTimeout> | null>(null), didHold = useRef(false);
  useEffect(() => {
    let live = true;
    Promise.all([api.getFollowUp(order.id), api.getAttentionSettings()]).then(([r, s]) => { if (live) { setParties(r.parties.filter((p) => p.role !== "rider")); setSettings(s.settings); setAvailable(s.available); } }).catch((e) => { if (live) setLoadError(errorMessage(e)); });
    const cancelPending = () => { if (gesture.current) clearTimeout(gesture.current); gesture.current = null; };
    window.addEventListener("blur", cancelPending);
    document.addEventListener("visibilitychange", cancelPending);
    return () => { live = false; cancelPending(); window.removeEventListener("blur", cancelPending); document.removeEventListener("visibilitychange", cancelPending); };
  }, [order.id]);
  function press() {
    didHold.current = false;
    gesture.current = setTimeout(() => { didHold.current = true; gesture.current = null; void call.begin("I’m outside"); }, settings.holdDelayMilliseconds);
  }
  function release(cancel = false) {
    if (gesture.current) clearTimeout(gesture.current);
    gesture.current = null;
    if (didHold.current || cancel) call.stop();
    else void call.tap("I’m outside");
  }
  const label = selected?.label.toLowerCase() || "customer";
  return <div className="space-y-5 px-4 pb-8 pt-4">
    {messageParty && <FollowUpMessages api={api} orderId={order.id} recipientId={messageParty.userId} name={messageParty.name} onClose={() => setMessageParty(null)} />}
    <header><h1 className="text-3xl font-extrabold">At the customer</h1><p className="mt-1 text-sm text-ink-500">Order #{order.id.slice(-6)} · {order.restaurant_name || order.store_name || "Your delivery"}</p><span className="mt-3 inline-flex items-center gap-2 rounded-full bg-gold/20 px-3 py-1 text-sm font-bold"><MapPin className="h-4 w-4" aria-hidden />Arrived</span></header>
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] p-4"><ShoppingBag className="h-7 w-7" aria-hidden /><div><strong>{order.restaurant_name || order.store_name || "Your order"}</strong><p className="text-sm text-ink-500">{itemCount} items · Ready for handoff</p></div></div>
    <div role="group" aria-label="Who to call" className="flex flex-wrap gap-1 rounded-xl border border-[var(--border-faint)] p-1">{parties.map((p) => { const Icon = p.role === "customer" ? User : Store; return <button type="button" key={p.userId} aria-pressed={selected?.userId === p.userId} onClick={() => { call.stop(); setSelectedId(p.userId); }} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-3 font-bold ${selected?.userId === p.userId ? "bg-gold text-ink-gold" : "text-ink"}`}><Icon className="h-5 w-5" aria-hidden />{p.label}</button>; })}</div>
    <button type="button" disabled={!selected || !available || !settings.enabled || (call.busy && !call.holding)}
      aria-label={`Call ${label}. Tap once or hold to keep calling. Release to stop.`} aria-pressed={call.holding}
      onPointerDown={(e) => { if (!e.isPrimary || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); press(); }}
      onPointerUp={() => release()} onPointerCancel={() => release(true)} onLostPointerCapture={() => { if (call.holding) call.stop(); }}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); release(); } }}
      onClick={(e) => { if (e.detail === 0 && !gesture.current) void call.tap("I’m outside"); }}
      onContextMenu={(e) => e.preventDefault()}
      className="flex min-h-52 w-full touch-none select-none flex-col items-center justify-center gap-3 rounded-[2rem] border-[5px] border-gold bg-black px-5 py-6 text-white outline-offset-4 disabled:opacity-50">
      {call.holding ? <BellRing className="h-12 w-12 text-gold" aria-hidden /> : <Bell className="h-12 w-12 text-gold" aria-hidden />}
      <strong className="text-2xl font-extrabold">{call.holding ? `Calling ${label}…` : `Call ${label}`}</strong>
      <span className="text-sm">{call.holding ? "Release to stop." : "Tap once, or hold to keep calling."}</span>
      {call.holding && <><span className="font-bold tabular-nums">00:{Math.floor(call.elapsed).toString().padStart(2, "0")} / 00:{settings.maxHoldSeconds.toString().padStart(2, "0")}</span><progress className="attention-progress h-2 w-full" max={settings.maxHoldSeconds} value={call.elapsed} aria-label="Calling time" /></>}
    </button>
    {(call.error || loadError) && <p role="alert" className="text-sm">{call.error || loadError}</p>}
    {(!available || !settings.enabled) && !loadError && <p role="status" className="text-sm text-ink-500">Follow-up calls are not available yet.</p>}
    <div className="flex gap-2"><button type="button" disabled={!selected} onClick={() => selected && startCall({ calleeId: selected.userId, orderId: order.id, restaurantId: selected.restaurantId })} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border-faint)] font-bold"><Phone className="h-5 w-5" aria-hidden />Voice call</button><button type="button" disabled={!selected} onClick={() => selected && setMessageParty(selected)} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border-faint)] font-bold"><MessageCircle className="h-5 w-5" aria-hidden />Message</button></div>
  </div>;
}
