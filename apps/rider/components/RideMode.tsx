"use client";

import type { OrderDetail } from "@peebee/shared";
import { CheckCircle2, Loader2, MapPin, MessageCircle, Navigation, Phone, User, UserCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { formatUgx } from "../lib/order-display";
import { useCalls } from "../lib/calls-context";
import { DeliveryNavigation } from "./DeliveryNavigation";
import { JobAction } from "./JobAction";
import { Modal } from "./Modal";

/** Passenger-only presentation. Backend stages retain their existing transitions. */
export function RideMode({ detail, busy, error, run, onCancel, onDone }: {
  detail: OrderDetail; busy: boolean; error: string | null;
  run: (action: () => Promise<unknown>) => Promise<void>;
  onCancel: () => void; onDone: () => void;
}) {
  const { order } = detail;
  const { startCall } = useCalls();
  const nextStop = (detail.rideStops ?? []).find((stop) => stop.status !== "done");
  const [dropped, setDropped] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const passenger = order.passenger_name?.trim() || order.customer_name?.trim() || "Passenger";
  const firstName = passenger.split(/\s+/)[0];
  const pickup = ["Shop", "Substitute", "Approve", "Deliver", "Arrived"].includes(order.stage);
  const waiting = ["Create", "Match", "Fund"].includes(order.stage);
  const completed = order.stage === "Settle";
  const onTrip = order.stage === "PickedUp";
  const headingPickup = pickup && order.stage !== "Arrived";
  const title = waiting ? "Awaiting payment" : completed ? "Trip complete" : order.stage === "Handover" ? "Trip confirmed" : order.stage === "Arrived" ? "At pickup" : headingPickup ? `Pick up ${firstName}` : nextStop ? (nextStop.status === "arrived" ? `At stop ${nextStop.position}` : `Head to stop ${nextStop.position}`) : dropped ? "Awaiting confirmation" : onTrip ? "Passenger on board" : "Ride closed";
  const place = pickup || waiting ? order.pickup_area : nextStop?.area ?? order.destination_area;
  const address = pickup || waiting ? order.pickup_address : nextStop?.address ?? order.destination_address;
  const locationLabel = pickup || waiting ? "Pickup" : nextStop ? `Stop ${nextStop.position}` : "Drop-off";
  const fare = order.delivery_fee ?? order.final_total ?? order.estimated_total;
  const canCancel = ["Match", "Fund", "Shop", "Substitute", "Approve", "Deliver"].includes(order.stage);
  const actionButton = (label: string, action: () => void, Icon = UserCheck) => <JobAction><button type="button" disabled={busy} onClick={action} className="job-primary"><Icon aria-hidden />{busy ? "Processing…" : label}</button></JobAction>;
  const navigate = (lat: number | null, lng: number | null, key: string, label: string, confirm: string, description: string, action: () => void, before?: () => Promise<unknown>) => <DeliveryNavigation
    key={key} orderId={order.id} navigationKey={`${order.id}:${key}`} destinationLat={lat} destinationLng={lng} busy={busy}
    navigationLabel={label} confirmTitle={confirm} confirmButtonLabel={confirm} confirmModalDescription={description}
    onBeforeNavigate={before} onConfirmDelivery={action} />;

  let action: React.ReactNode = null;
  if (headingPickup) action = navigate(order.pickup_lat, order.pickup_lng, "pickup", "Navigate to pickup", "At pickup", "Confirm you have reached the passenger’s pickup point.", () => void run(() => api.arrivedOrder(order.id)), order.stage !== "Deliver" ? () => api.deliverOrder(order.id) : undefined);
  else if (order.stage === "Arrived") action = actionButton("Passenger on board", () => void run(() => api.pickedUpOrder(order.id)));
  else if (onTrip && nextStop?.status === "arrived") action = actionButton("Continue trip", () => void run(() => api.continueFromStop(order.id, nextStop.position)), Navigation);
  else if (onTrip && nextStop) action = navigate(nextStop.lat, nextStop.lng, `stop-${nextStop.position}`, "Navigate to stop", `At stop ${nextStop.position}`, "Confirm you have reached this stop.", () => void run(() => api.arrivedAtStop(order.id, nextStop.position)));
  else if (onTrip && !dropped) action = navigate(order.destination_lat, order.destination_lng, "drop-off", "Navigate to drop-off", "Confirm drop-off", "The passenger confirms completion on their phone.", () => setDropped(true));
  else if (onTrip) action = <p className="flex items-center gap-3 text-lg" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden />Passenger is confirming</p>;
  else if (order.stage === "Handover") action = actionButton("Settle trip", () => void run(() => api.settleOrder(order.id)), Wallet);

  return <div className="job-screen">
    <header className="job-heading"><h1>{title}</h1><p>Passenger ride · #{order.id.slice(-6)}</p></header>
    <section className="job-glass job-destination" aria-label={locationLabel}>
      <span className="job-icon"><MapPin aria-hidden /></span><div className="min-w-0"><p className="job-eyebrow">{locationLabel}</p><h2>{place || address || "Location pending"}</h2>{address && address !== place && <p className="job-address">{address}</p>}</div>
    </section>
    {(pickup || waiting) && order.destination_area && <p className="job-later">Drop-off: {order.destination_area}</p>}
    <section aria-label="Passenger" className="job-contact-section">
      <div className="job-contact"><span className="job-icon"><User aria-hidden /></span><div><h2>{passenger}</h2><p>Passenger</p></div></div>
      <div className="job-contact-actions">
        {order.passenger_phone ? <a className="job-secondary" href={`tel:${order.passenger_phone}`}><Phone aria-hidden />Call passenger</a> : <button className="job-secondary" type="button" disabled={!order.customer_id} onClick={() => order.customer_id && startCall({ calleeId: order.customer_id, orderId: order.id })}><Phone aria-hidden />Call passenger</button>}
        {order.customer_id && <Link className="job-secondary" href={`/chat/${order.customer_id}`}><MessageCircle aria-hidden />Message</Link>}
      </div>
    </section>
    <section className="job-glass job-fare" aria-label="Trip fare"><span>Trip fare</span><strong>{fare != null ? formatUgx(fare) : "Pending"}</strong></section>
    {completed && <div className="job-status"><CheckCircle2 className="h-12 w-12 text-gold" aria-hidden /><h2>Trip complete</h2><button type="button" className="job-secondary" onClick={onDone}>Back to jobs</button></div>}
    {waiting && <p className="text-lg text-ink-500" role="status">Waiting for the passenger’s payment</p>}
    {error && <p role="alert" className="text-base text-red-600">{error}</p>}
    {action}
    {canCancel && <button type="button" className="min-h-14 text-base font-semibold text-ink-500 underline" onClick={() => setConfirmCancel(true)}>Cancel ride</button>}
    {order.stage === "Match" && order.payment_rail === "escrow" && <button type="button" disabled={busy} className="job-secondary" onClick={() => void run(async () => { await api.closeUnpaidOrder(order.id); onDone(); })}>Close unpaid ride</button>}
    {confirmCancel && <Modal title="Cancel ride?" onClose={() => setConfirmCancel(false)}><div className="grid grid-cols-2 gap-3"><button type="button" className="job-secondary" onClick={() => setConfirmCancel(false)}>Keep ride</button><button type="button" disabled={busy} className="min-h-14 rounded-full bg-red-600 font-bold text-white" onClick={onCancel}>Cancel ride</button></div></Modal>}
  </div>;
}
