"use client";

import type { OrderDetail } from "@peebee/shared";
import { Circle, LoaderCircle, MapPin, X, type LucideIcon } from "lucide-react";
import localFont from "next/font/local";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { RideApplicants } from "./RideApplicants";

const roboto = localFont({ src: "../../lib/fonts/roboto/Roboto.ttf", display: "swap" });

/** The shared matching screen for on-demand ride services, never a shopping menu. */
export function RideSearch({ detail, label, icon: Icon, busy, error, canCancel, paymentRequired,
  onCancel, onChanged }: {
  detail: OrderDetail; label: string; icon: LucideIcon; busy: boolean; error: string | null;
  canCancel: boolean; paymentRequired: boolean; onCancel: () => void; onChanged: () => void;
}) {
  const { order } = detail;
  const router = useRouter();
  const [offerCount, setOfferCount] = useState(0);
  const choosesRider = order.matching_mode === "customer_selects";
  const paid = detail.payments.some((payment) => payment.type === "collection" && payment.status === "successful");
  const status = offerCount > 0 ? "Choose your rider" : choosesRider ? "Waiting for rider offers" : "Looking for an available driver";
  useRegisterNavBack(true, () => router.push("/ride"));
  // A real payment step retains its parent action; cancellation never hides payment.
  useRegisterNavPrimaryAction(paymentRequired ? null : {
    label: canCancel ? "Cancel search" : "Searching…",
    icon: canCancel ? X : Icon,
    disabled: busy || !canCancel,
    onClick: onCancel,
  }, 10);

  return <div className={`ride-search ${roboto.className}`}>
    <header className="ride-search-heading" aria-live="polite">
      <h1>{offerCount > 0 ? `Choose your ${label}` : `Finding your ${label}`}</h1>
      <p>{status}</p>
    </header>
    <section className="ride-search-glass ride-search-status" aria-label="Search status" aria-live="polite">
      <span className="ride-search-signal"><Icon aria-hidden />{offerCount === 0 && <LoaderCircle className="ride-search-orbit motion-safe:animate-spin" aria-hidden />}</span>
      <h2>{offerCount > 0 ? `${offerCount} rider${offerCount === 1 ? "" : "s"} available` : "Searching nearby"}</h2>
      {paid && <p>Payment received</p>}
    </section>
    <section className="ride-search-glass ride-search-route" aria-label="Your route">
      <div className="ride-search-place"><Circle className="ride-search-pickup" aria-hidden /><div><p>Pickup</p><h2>{order.pickup_area || order.pickup_address || "Pickup location"}</h2>{order.pickup_address && order.pickup_address !== order.pickup_area && <span>{order.pickup_address}</span>}</div></div>
      {(detail.rideStops ?? []).map((stop) => <div className="ride-search-place" key={stop.position}><Circle aria-hidden /><div><p>Stop {stop.position}</p><h2>{stop.area || stop.address || "Stop location"}</h2></div></div>)}
      <div className="ride-search-place"><MapPin aria-hidden /><div><p>Drop-off</p><h2>{order.destination_area || order.destination_address || "Destination"}</h2>{order.destination_address && order.destination_address !== order.destination_area && <span>{order.destination_address}</span>}</div></div>
    </section>
    {choosesRider && <RideApplicants orderId={order.id} kind={label} onSelected={onChanged} hideEmpty onCountChange={setOfferCount} />}
    {error && <p className="ride-search-error" role="alert">{error}</p>}
  </div>;
}
