"use client";

import { ChevronsRight, Loader2, ShoppingBag } from "lucide-react";
import { useRef, useState } from "react";
import { useHomeMenu } from "../lib/home-menu";
import type { NavPrimaryAction } from "../lib/nav-primary-action";

/** One action surface for every page; the page retains validation, payment and retry ownership. */
export function NavAction({ action }: { action: NavPrimaryAction }) {
  const Icon = action.icon;
  return action.confirmation ? <NavConfirmation key={`${action.label}:${action.detail ?? ""}`} action={action} /> : <button
    type="button" className="customer-nav-action customer-nav-swap" onClick={action.onClick}
    disabled={action.disabled || action.busy} aria-busy={action.busy || undefined}
    aria-label={[action.label, action.sublabel, action.detail].filter(Boolean).join(", ")}>
    {action.busy ? <Loader2 className="animate-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : action.tone === "cart" ? <ShoppingBag aria-hidden /> : null}
    <span className="customer-nav-action-label"><strong>{action.label}</strong>{action.sublabel && <small>{action.sublabel}</small>}</span>
    {action.detail && <span className="customer-nav-action-detail">{action.detail}</span>}
  </button>;
}

function NavConfirmation({ action }: { action: NavPrimaryAction }) {
  const threshold = useHomeMenu().navigation.confirmPercent / 100;
  const label = /^(slide|swipe)\b/i.test(action.label) ? action.label : /^pay\b/i.test(action.label) ? "Slide to pay" : "Slide to confirm";
  const detail = action.detail ?? (label !== action.label ? action.label : action.sublabel);
  const gesture = useRef<{ id: number; start: number; distance: number; max: number } | null>(null);
  const lock = useRef(false);
  const [distance, setDistance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const blocked = action.disabled || action.busy || submitting;
  const reset = () => { gesture.current = null; setDistance(0); };
  const confirm = async () => {
    if (blocked || lock.current) return;
    lock.current = true;
    setSubmitting(true);
    try { await action.onClick(); }
    catch { /* The page shows its own validation/payment error. Never announce success here. */ }
    finally { lock.current = false; setSubmitting(false); reset(); }
  };
  return <button type="button" className="customer-nav-confirm customer-nav-swap" disabled={blocked}
    aria-label={`Slide to confirm: ${[action.label, action.sublabel, action.detail].filter(Boolean).join(", ")}. Keyboard: press Enter or Space to confirm.`}
    aria-busy={action.busy || submitting || undefined}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void confirm(); } }}
    onClick={(e) => { if (e.detail === 0) void confirm(); }}
    onPointerDown={(e) => {
      if (blocked || !e.isPrimary || e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // A deliberate gesture starts on the handle; tapping the far end never pays.
      if (e.clientX - rect.left > 62) return;
      gesture.current = { id: e.pointerId, start: e.clientX, distance: 0, max: Math.max(0, rect.width - 64) };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={(e) => {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      g.distance = Math.max(0, Math.min(g.max, e.clientX - g.start));
      setDistance(g.distance);
    }}
    onPointerUp={(e) => {
      const g = gesture.current;
      const commit = g && g.id === e.pointerId && g.max > 0 && g.distance >= g.max * threshold;
      reset();
      if (commit) void confirm();
    }}
    onPointerCancel={reset} onLostPointerCapture={reset}>
    <span className="customer-nav-confirm-label"><strong>{action.busy || submitting ? "Please wait…" : label}</strong>{detail && <small>{detail}</small>}</span>
    <span className="customer-nav-confirm-thumb" style={{ transform: `translateX(${distance}px)` }}>{action.busy || submitting ? <Loader2 className="animate-spin" aria-hidden /> : <ChevronsRight aria-hidden />}</span>
  </button>;
}
