"use client";

import type { CarDriverActive } from "@tuma/shared";
import { MessageCircle, Navigation } from "lucide-react";
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
      {ride.passenger_name ? (
        <p className="text-sm text-ink">
          Passenger: <span className="font-bold">{ride.passenger_name}</span>
          {ride.passenger_phone && (
            <>
              {" · "}
              <a href={`tel:${ride.passenger_phone}`} className="font-bold text-gold underline">{ride.passenger_phone}</a>
            </>
          )}
          <span className="block text-xs text-ink-500">Booked by {ride.customer_name}</span>
        </p>
      ) : (
        <p className="text-sm text-ink">{ride.customer_name}</p>
      )}
      <p className="text-xs text-ink-500">From: {ride.pickup_address ?? "—"}</p>
      <p className="text-xs text-ink-500">To: {ride.destination_address ?? "—"}</p>
      <p className="text-sm font-bold text-ink">{ugx(ride.estimated_total)}</p>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
      {(() => {
        // Heading to the passenger until they're aboard, then to the destination.
        const toDestination = stage === "PickedUp" || stage === "Handover";
        const lat = toDestination ? ride.destination_lat : ride.pickup_lat;
        const lng = toDestination ? ride.destination_lng : ride.pickup_lng;
        if (lat == null || lng == null) return null;
        return (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-gold/15 text-sm font-bold text-ink"
          >
            <Navigation className="h-4 w-4" />
            Navigate to {toDestination ? "destination" : "pickup"}
          </a>
        );
      })()}
      <button type="button" onClick={() => setChatOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gold/15 text-sm font-bold text-ink">
        <MessageCircle className="h-4 w-4" />
        {chatOpen ? "Hide chat" : `Chat with ${ride.customer_name}`}
      </button>
      {chatOpen && user && <RideChat orderId={ride.id} myId={user.id} />}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {action && (
        <button disabled={busy} onClick={() => run(action!.go)} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">
          {busy ? "Please wait…" : action.label}
        </button>
      )}
    </section>
  );
}
