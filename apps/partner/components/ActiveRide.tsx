"use client";

import type { CarDriverActive } from "@peebee/shared";
import { MessageCircle, Navigation, Phone } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useRideLocation } from "../lib/use-ride-location";
import { RideChat } from "./RideChat";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;

/** The driver's ride in progress, with the one action that's next for its stage. */
export function ActiveRide({ ride, onChange }: { ride: NonNullable<CarDriverActive["active"]>; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const { user } = useAuth();
  useRideLocation(ride.stage === "Create" ? null : ride.id);

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
  if (stage === "Create" || stage === "Match") hint = "Waiting for the customer to pay.";
  else if (["Shop", "Substitute", "Approve"].includes(stage)) action = { label: "Start", go: () => api.deliverOrder(ride.id) };
  else if (stage === "Deliver") action = { label: "I'm here", go: () => api.arrivedOrder(ride.id) };
  else if (stage === "Arrived") action = { label: "On board", go: () => api.pickedUpOrder(ride.id) };
  else if (stage === "PickedUp") hint = "At the destination the customer confirms with their PIN.";
  else if (stage === "Handover") action = { label: "Get paid", go: () => api.settleOrder(ride.id) };

  const toDestination = stage === "PickedUp" || stage === "Handover";
  const navLat = toDestination ? ride.destination_lat : ride.pickup_lat;
  const navLng = toDestination ? ride.destination_lng : ride.pickup_lng;
  const who = ride.passenger_name ?? ride.customer_name;
  const place = (toDestination ? ride.destination_address : ride.pickup_address) ?? "—";
  return (
    <section className="home-card space-y-4 border-l-4 border-l-gold">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-gold/15 px-4 text-base font-bold text-ink">
          <Navigation className="h-5 w-5 text-gold" aria-hidden /> {toDestination ? "To destination" : stage === "Arrived" ? "At pickup" : "To pickup"}
        </span>
        <strong className="min-w-0 text-right text-xl font-black tabular-nums text-ink">{ugx(ride.estimated_total)}</strong>
      </div>
      <p className="break-words text-3xl font-extrabold leading-tight text-ink">{place}</p>
      {ride.category_kind === "ambulance" && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">Emergency. Go straight to the patient.</p>}
      {ride.trip_note && <p className="text-lg text-ink">{ride.trip_note}</p>}
      {ride.hire_hours ? <p className="text-lg font-bold text-gold">Hired {ride.hire_hours} h after the trip</p> : null}
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-xl font-bold text-ink">{who}</p>
        {ride.passenger_phone && (
          <a href={`tel:${ride.passenger_phone}`} aria-label={`Call ${who}`} className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
            <Phone className="h-6 w-6" aria-hidden />
          </a>
        )}
        {navLat != null && navLng != null && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${navLat},${navLng}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Navigate to ${toDestination ? "destination" : "pickup"}`}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
          >
            <Navigation className="h-6 w-6" aria-hidden />
          </a>
        )}
        <button type="button" onClick={() => setChatOpen((v) => !v)} aria-label={chatOpen ? "Hide chat" : "Chat"} className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
          <MessageCircle className="h-6 w-6" aria-hidden />
        </button>
      </div>
      {chatOpen && user && <RideChat orderId={ride.id} myId={user.id} />}
      {hint && <p className="text-lg text-ink-500">{hint}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {action && (
        <button disabled={busy} onClick={() => run(action!.go)} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold shadow-[0_6px_16px_rgba(201,162,39,0.35)] disabled:opacity-50">
          {busy ? "Please wait…" : action.label}
        </button>
      )}
    </section>
  );
}
