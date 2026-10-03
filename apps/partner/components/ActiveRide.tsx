"use client";

import type { CarDriverActive } from "@tuma/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;

/** The driver's ride in progress, with the one action that's next for its stage. */
export function ActiveRide({ ride, onChange }: { ride: NonNullable<CarDriverActive["active"]>; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const stage = ride.stage;
  let hint = "";
  let action: { label: string; go: () => Promise<unknown> } | null = null;
  if (stage === "Create" || stage === "Match") hint = "Waiting for the customer to pay. You'll be able to start once they have.";
  else if (["Shop", "Substitute", "Approve"].includes(stage)) action = { label: "Start trip to pickup", go: () => api.deliverOrder(ride.id) };
  else if (stage === "Deliver") action = { label: "I've arrived", go: () => api.arrivedOrder(ride.id) };
  else if (stage === "Arrived") action = { label: "Passenger / cargo on board", go: () => api.pickedUpOrder(ride.id) };
  else if (stage === "PickedUp") hint = "On the way. At the destination, the customer confirms with their PIN.";
  else if (stage === "Handover") action = { label: "Complete ride and get paid", go: () => api.settleOrder(ride.id) };

  return (
    <section className="home-card space-y-3 border-l-4 border-l-gold">
      <div className="flex items-center justify-between">
        <p className="font-bold text-ink">Ride in progress</p>
        <span className="rounded-full bg-gold/15 px-2 py-1 text-[10px] font-black uppercase text-ink">{stage}</span>
      </div>
      <p className="text-sm text-ink">{ride.customer_name}</p>
      <p className="text-xs text-ink-500">From: {ride.pickup_address ?? "—"}</p>
      <p className="text-xs text-ink-500">To: {ride.destination_address ?? "—"}</p>
      <p className="text-sm font-bold text-ink">{ugx(ride.estimated_total)}</p>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {action && (
        <button disabled={busy} onClick={() => run(action!.go)} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">
          {busy ? "Please wait…" : action.label}
        </button>
      )}
    </section>
  );
}
