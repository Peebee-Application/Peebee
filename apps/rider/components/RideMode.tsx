"use client";

import type { OrderDetail } from "@peebee/shared";
import { CheckCircle2, Loader2, MapPin, MessageCircle, Navigation, Phone, UserCheck, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { formatUgx } from "../lib/order-display";
import { leaveRideMode } from "../lib/ride-mode";
import { CustomerAvatar } from "./CustomerAvatar";
import { DeliveryNavigation } from "./DeliveryNavigation";

const BIG_BUTTON =
  "flex min-h-16 w-full items-center justify-center gap-3 rounded-full bg-gold px-6 text-xl font-extrabold text-ink-gold shadow-[0_6px_16px_rgba(201,162,39,0.35)] disabled:opacity-60";

/**
 * Ride mode: the rider is moving, so the app is one screen with one job.
 * Where to, who with, one big button. No tabs, no lists, no navigation.
 * (The shell hides its header and bottom bar while this is showing.)
 */
export function RideMode({
  detail,
  busy,
  error,
  run,
  onCancel,
  onDone,
}: {
  detail: OrderDetail;
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { order } = detail;
  const stops = detail.rideStops ?? [];
  const nextStop = stops.find((s) => s.status !== "done") ?? null;
  const [dropped, setDropped] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const passenger = (order.passenger_name ?? order.customer_name ?? "").trim().split(/\s+/)[0] || "Passenger";
  const phone = order.passenger_phone ?? null;
  const fare = order.delivery_fee ?? order.final_total ?? order.estimated_total;

  // What the rider is doing right now, in one glance.
  let phase: string;
  let PhaseIcon = Navigation;
  let place: string;
  let address: string | null;
  if (order.stage === "Deliver") {
    phase = "To pickup";
    place = order.pickup_area ?? "Pickup";
    address = order.pickup_address;
  } else if (order.stage === "Arrived") {
    phase = "At pickup";
    PhaseIcon = UserCheck;
    place = passenger;
    address = order.pickup_area;
  } else if (order.stage === "PickedUp" && nextStop) {
    phase = `Stop ${nextStop.position}`;
    place = nextStop.area ?? nextStop.address ?? `Stop ${nextStop.position}`;
    address = nextStop.status === "arrived" ? "Waiting at stop" : null;
  } else if (order.stage === "PickedUp") {
    phase = dropped ? "Dropped off" : "Trip";
    PhaseIcon = dropped ? CheckCircle2 : MapPin;
    place = order.destination_area ?? "Destination";
    address = order.destination_address;
  } else {
    phase = "Trip done";
    PhaseIcon = CheckCircle2;
    place = "Trip done";
    address = null;
  }

  // The one big action (or the navigation that leads to it).
  let action: React.ReactNode;
  if (order.stage === "Deliver") {
    action = (
      <DeliveryNavigation
        orderId={order.id}
        destinationLat={order.pickup_lat}
        destinationLng={order.pickup_lng}
        busy={busy}
        onConfirmDelivery={() => void run(() => api.arrivedOrder(order.id))}
        confirmButtonLabel="I’m here"
        confirmModalDescription="Tell the passenger you’ve reached the pickup point."
      />
    );
  } else if (order.stage === "Arrived") {
    action = (
      <button type="button" disabled={busy} onClick={() => void run(() => api.pickedUpOrder(order.id))} className={BIG_BUTTON}>
        <UserCheck className="h-7 w-7" aria-hidden /> On board
      </button>
    );
  } else if (order.stage === "PickedUp" && nextStop?.status === "pending") {
    action = (
      <DeliveryNavigation
        key={`stop-${nextStop.position}`}
        orderId={order.id}
        destinationLat={nextStop.lat}
        destinationLng={nextStop.lng}
        busy={busy}
        onConfirmDelivery={() => void run(() => api.arrivedAtStop(order.id, nextStop.position))}
        confirmButtonLabel={`At stop ${nextStop.position}`}
        confirmModalDescription="Confirm you’ve reached this stop."
      />
    );
  } else if (order.stage === "PickedUp" && nextStop?.status === "arrived") {
    action = (
      <button type="button" disabled={busy} onClick={() => void run(() => api.continueFromStop(order.id, nextStop.position))} className={BIG_BUTTON}>
        <Navigation className="h-7 w-7" aria-hidden /> Continue
      </button>
    );
  } else if (order.stage === "PickedUp" && !dropped) {
    action = (
      <DeliveryNavigation
        orderId={order.id}
        destinationLat={order.destination_lat}
        destinationLng={order.destination_lng}
        busy={busy}
        onConfirmDelivery={() => setDropped(true)}
        confirmButtonLabel="Dropped off"
        confirmModalDescription="Confirm the passenger is at their destination. They finish the trip on their phone."
      />
    );
  } else if (order.stage === "PickedUp") {
    action = <Waiting text="Passenger is confirming" order={order.id} onLeave={onDone} />;
  } else {
    // Handover: the passenger has confirmed, the rider collects the pay.
    action = (
      <button type="button" disabled={busy} onClick={() => void run(() => api.settleOrder(order.id))} className={BIG_BUTTON}>
        <Wallet className="h-7 w-7" aria-hidden /> Get paid {fare != null ? formatUgx(fare) : ""}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-cream px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="main" aria-live="polite">
      <div className="mx-auto flex h-full w-full max-w-lg flex-col">
        <header className="flex items-center justify-between gap-3">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gold/15 px-4 text-base font-bold text-ink">
            <PhaseIcon className="h-5 w-5 text-gold" aria-hidden /> {phase}
          </span>
          <span className="text-2xl font-extrabold tabular-nums text-ink">{fare != null ? formatUgx(fare) : ""}</span>
        </header>

        {stops.length > 0 && (
          <ol className="mt-3 flex gap-1.5" aria-label={`${stops.length} stop${stops.length === 1 ? "" : "s"}`}>
            {stops.map((s) => (
              <li key={s.position} className={`h-1.5 flex-1 rounded-full ${s.status === "done" ? "bg-green" : s.status === "arrived" ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />
            ))}
          </ol>
        )}

        <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-gold">
            <PhaseIcon className="h-10 w-10" aria-hidden />
          </span>
          <h1 className="break-words text-4xl font-extrabold leading-tight text-ink">{place}</h1>
          {address && <p className="max-w-xs text-lg text-ink-500">{address}</p>}
          {order.stage === "Deliver" && order.eta_minutes ? (
            <p className="rounded-full bg-[rgb(var(--surface-muted))] px-4 py-1.5 text-lg font-bold text-ink">~{order.eta_minutes} min</p>
          ) : null}
        </section>

        <div className="space-y-4">
          {order.customer_id && (
            <div className="flex items-center gap-3">
              <CustomerAvatar customerId={order.customer_id} />
              <p className="min-w-0 flex-1 truncate text-xl font-bold text-ink">{passenger}</p>
              {phone && (
                <a href={`tel:${phone}`} aria-label={`Call ${passenger}`} className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
                  <Phone className="h-6 w-6" aria-hidden />
                </a>
              )}
              <Link href={`/chat/${order.customer_id}`} aria-label={`Chat with ${passenger}`} className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink">
                <MessageCircle className="h-6 w-6" aria-hidden />
              </Link>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-base text-red-700">{error}</p>}
          {busy && <Loader2 className="mx-auto h-6 w-6 animate-spin text-gold" aria-label="Please wait" />}

          {action}

          {order.stage === "Deliver" && (
            confirmCancel ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmCancel(false)} className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] text-base font-bold text-ink">Keep</button>
                <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 flex-1 rounded-full bg-red-600 text-base font-bold text-white disabled:opacity-60">Cancel ride</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmCancel(true)} className="mx-auto flex min-h-11 items-center gap-1.5 px-4 text-base font-bold text-red-600">
                <X className="h-5 w-5" aria-hidden /> Cancel
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** The passenger finishes the trip on their phone. If they never do, the rider can leave this one ride behind. */
function Waiting({ text, order, onLeave }: { text: string; order: string; onLeave: () => void }) {
  return (
    <div className="space-y-3 text-center">
      <p className="flex items-center justify-center gap-2 text-xl font-bold text-ink">
        <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden /> {text}
      </p>
      <button type="button" onClick={() => { leaveRideMode(order); onLeave(); }} className="min-h-11 px-4 text-base font-bold text-ink-500">
        Back to jobs
      </button>
    </div>
  );
}
