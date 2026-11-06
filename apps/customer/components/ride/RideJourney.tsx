"use client";

import type { OrderDetail, OrderRating } from "@peebee/shared";
import { Bike, Car, CheckCircle2, MapPin, Navigation, Wallet } from "lucide-react";
import Link from "next/link";
import { RideApplicants } from "./RideApplicants";
import { LiveTrackingMap } from "../LiveTrackingMap";
import { RateDeliveryCard } from "../RateDeliveryCard";
import { SwipeToConfirm } from "../SwipeToConfirm";
import { formatUgx } from "../../lib/order-display";
import { RideStopsList } from "./RideStopsList";
import { RideTripCard, useRideTripDetails } from "./RideTripCard";

/** The four things a rider-passenger cares about, in order. Everything before the rider is moving is "finding". */
export type RideMoment = "finding" | "ready" | "onway" | "here" | "riding" | "arrived";

export function rideMoment(stage: string, hasRider = false): RideMoment {
  switch (stage) {
    // Paid and matched, the rider has not set off yet: the ride is confirmed, nobody is being searched for any more.
    case "Shop": return hasRider ? "ready" : "finding";
    case "Deliver": return "onway";
    case "Arrived": return "here";
    case "PickedUp": return "riding";
    case "Handover":
    case "Settle": return "arrived";
    default: return "finding";
  }
}

const STEPS: RideMoment[] = ["ready", "onway", "here", "riding", "arrived"];

/**
 * A ride is not a shopping order: no timeline, no item lists, no breakdown.
 * One screen that says what is happening right now — on the way, here,
 * ride on, arrived — with the map, the rider, and the money only at the end.
 */
export function RideJourney({
  detail,
  busy,
  error,
  onComplete,
  onCancel,
  onChanged,
  onRated,
  canCancel,
}: {
  detail: OrderDetail;
  busy: boolean;
  error: string | null;
  onComplete: () => Promise<void>;
  onCancel: () => void;
  onChanged: () => void;
  onRated: (rating: OrderRating) => void;
  canCancel: boolean;
}) {
  const { order } = detail;
  const trip = useRideTripDetails(order);
  const moment = rideMoment(order.stage, !!order.rider_id);
  const kind = trip.car?.categoryName || trip.car?.vehicleName ? "car" : "boda";
  const Kind = kind === "car" ? "Car" : "Boda";
  const KindIcon = kind === "car" ? Car : Bike;
  const firstName = (order.rider_name ?? trip.car?.driverName ?? "").split(" ")[0] || null;
  const destination = order.destination_area || order.destination_address?.split(",")[0] || "your destination";

  const paid = detail.payments.some((p) => p.type === "collection" && p.status === "successful");
  const cash = order.payment_rail === "float";
  const fare = order.final_total ?? order.delivery_fee ?? order.estimated_total ?? null;
  const awaitingPay = moment === "finding" && !!order.rider_id && order.stage === "Match" && !cash && !paid;
  // A booking made for later keeps its pickup time; once the rider is moving the live stages take over.
  const scheduled = moment === "finding" ? trip.car?.scheduledFor ?? null : null;

  let title: string;
  let sub: string | null;
  if (moment === "ready") {
    title = `Your ${Kind} is confirmed`;
    sub = `${firstName ?? "Your rider"} is getting ready to come to you`;
  } else if (moment === "onway") {
    title = `Your ${Kind} is on the way`;
    sub = [firstName, order.eta_minutes ? `~${order.eta_minutes} min away` : null].filter(Boolean).join(" · ") || null;
  } else if (moment === "here") {
    title = "Your ride is here";
    sub = firstName ? `${firstName} is waiting at your pickup point` : "Your rider is waiting at your pickup point";
  } else if (moment === "riding") {
    title = "Ride on…";
    sub = `To ${destination}${order.eta_minutes ? ` · ~${order.eta_minutes} min` : ""}`;
  } else if (moment === "arrived") {
    title = "You’ve arrived!";
    sub = destination;
  } else if (awaitingPay) {
    title = `Pay to confirm your ${Kind}`;
    sub = firstName ? `${firstName} is matched` : "Your rider is matched";
  } else {
    title = scheduled ? "Ride booked" : `Finding your ${Kind}…`;
    sub = scheduled ? new Date(scheduled).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" }) : paid && !order.rider_id ? "Paid. Waiting for a rider to take it" : "This usually takes a minute";
  }

  const at = STEPS.indexOf(moment);

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-6 pt-5">
      <header className="space-y-3" aria-live="polite">
        {moment !== "finding" && (
          <ol className="flex gap-1.5" aria-label="Ride progress">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === at ? "step" : undefined} className={`h-1.5 flex-1 rounded-full ${i <= at ? "ride-gold-fill" : "bg-[rgb(var(--surface-muted))]"}`} />
            ))}
          </ol>
        )}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
            {moment === "arrived" ? <CheckCircle2 className="h-6 w-6" aria-hidden /> : moment === "riding" ? <Navigation className="h-6 w-6" aria-hidden /> : moment === "finding" && !awaitingPay ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" aria-hidden />
            ) : <KindIcon className="h-6 w-6" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight text-ink">{title}</h1>
            {sub && <p className="truncate text-sm text-ink-500">{sub}</p>}
          </div>
        </div>
      </header>

      {moment === "finding" && !order.rider_id && order.matching_mode === "customer_selects" && (
        <RideApplicants orderId={order.id} kind={Kind} onSelected={onChanged} />
      )}

      {awaitingPay && (
        <Link href={`/orders/${order.id}/pay`} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gold px-4 text-[15px] font-bold text-ink-gold">
          <Wallet className="h-5 w-5" aria-hidden /> Pay{fare != null ? ` ${formatUgx(fare)}` : ""}
        </Link>
      )}

      {(moment === "onway" || moment === "here" || moment === "riding") && <LiveTrackingMap order={order} events={detail.events} />}

      {(order.rider_id || scheduled) && moment !== "arrived" && (
        <RideTripCard order={order} car={trip.car} rider={trip.rider} stops={detail.rideStops ?? []} />
      )}

      {moment !== "arrived" && (
        <section className="flex items-start gap-3 px-1" aria-label="Your trip">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="truncate text-ink-500">{order.pickup_area ?? "Pickup"}</p>
            {(detail.rideStops?.length ?? 0) > 0 && <RideStopsList stops={detail.rideStops!} />}
            <p className="truncate font-semibold text-ink">{destination}</p>
          </div>
        </section>
      )}

      {moment === "riding" && (
        <SwipeToConfirm label="Slide when you’ve arrived" confirmedLabel="Trip complete" onConfirm={onComplete} disabled={busy || !order.pin_code} />
      )}

      {moment === "arrived" && (
        <>
          <section className="home-card space-y-1 text-center" aria-label="Fare">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {cash && order.stage !== "Settle" ? "To pay" : "Paid"}
            </p>
            <p className="text-3xl font-bold tabular-nums text-ink">{fare != null ? formatUgx(fare) : "—"}</p>
            <p className="text-sm text-ink-500">
              {cash
                ? order.stage === "Settle" ? "In cash to your rider" : `Hand the cash to ${firstName ?? "your rider"}`
                : paid ? "In the app — nothing more to pay" : "Settled in the app"}
            </p>
          </section>
          {order.stage === "Settle" && <section className="home-card"><RateDeliveryCard orderId={order.id} rating={detail.rating} onRated={onRated} /></section>}
        </>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {canCancel && moment !== "arrived" && (
        <button type="button" onClick={onCancel} className="mx-auto block min-h-10 px-4 text-sm font-bold text-ink-500">Cancel ride</button>
      )}
    </div>
  );
}
