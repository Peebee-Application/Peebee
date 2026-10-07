"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

const SWAPPABLE = ["Match", "Shop", "Substitute", "Approve"];

/** Shown on a car ride: its scheduled pickup time, and a way to choose another driver before the trip starts. */
export function CarRideNotice({ orderId, stage, hasDriver, onChanged }: { orderId: string; stage: string; hasDriver: boolean; onChanged: () => void }) {
  const [info, setInfo] = useState<{ scheduledFor: string | null; categoryName?: string; plate?: string; vehicleName?: string; ownerName?: string; driverName?: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.carBookingInfo(orderId).then(setInfo).catch(() => setInfo(null));
  }, [orderId]);

  if (!info) return null;
  const when = info.scheduledFor ? new Date(info.scheduledFor).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" }) : null;
  const canSwap = hasDriver && SWAPPABLE.includes(stage);

  async function swap() {
    setBusy(true);
    setError("");
    try {
      await api.carRematch(orderId);
      setConfirm(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!when && !canSwap && !info.categoryName) return null;
  return (
    <section className="space-y-2 border-t border-[var(--border-faint)] pt-2">
      {info.categoryName && <div className="rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2 text-sm"><p className="font-bold">{info.categoryName}{info.vehicleName ? ` · ${info.vehicleName}` : ""}</p><p className="text-xs text-ink-500">{info.plate}{info.driverName ? ` · Driver ${info.driverName}` : ""}{info.ownerName ? ` · Owner ${info.ownerName}` : ""}</p></div>}
      {when && <p className="text-sm font-semibold text-ink">Scheduled pickup: {when}</p>}
      {canSwap && !confirm && (
        <button type="button" onClick={() => setConfirm(true)} className="text-sm font-bold text-gold">Choose another driver</button>
      )}
      {canSwap && confirm && (
        <div className="space-y-2">
          <p className="text-xs text-ink-500">Your current driver is removed and the ride goes back to other drivers. Anything you paid stays on the ride.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={swap} className="min-h-10 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60">{busy ? "Please wait…" : "Yes, change driver"}</button>
            <button type="button" onClick={() => setConfirm(false)} className="min-h-10 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Keep</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
