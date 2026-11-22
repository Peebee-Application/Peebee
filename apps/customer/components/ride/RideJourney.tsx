"use client";

import { rideArrivalPayment, type OrderDetail, type OrderRating } from "@peebee/shared";
import { Ambulance, Bike, Car, CheckCircle2, CreditCard, Crown, MapPin, Navigation, ReceiptText, Route, Smartphone, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RideApplicants } from "./RideApplicants";
import { RideSearch } from "./RideSearch";
import { LiveTrackingMap } from "../LiveTrackingMap";
import { RateDeliveryCard } from "../RateDeliveryCard";
import { BottomDrawer } from "../BottomDrawer";
import { useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
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
  onCashPaid,
  onCancel,
  onChanged,
  onRated,
  canCancel,
  paymentRequired = false,
}: {
  detail: OrderDetail;
  busy: boolean;
  error: string | null;
  onComplete: () => Promise<void>;
  onCashPaid: () => Promise<void>;
  onCancel: () => void;
  onChanged: () => void;
  onRated: (rating: OrderRating) => void;
  canCancel: boolean;
  paymentRequired?: boolean;
}) {
  const { order } = detail;
  const router = useRouter();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const trip = useRideTripDetails(order);
  const moment = rideMoment(order.stage, !!order.rider_id);
  const group = trip.car?.serviceGroup;
  const moving = trip.car?.vehicleKind === "cargo";
  const Kind = group === "ambulance" ? "Ambulance" : group === "luxury" ? "Luxury ride" : moving ? "moving vehicle" : trip.car ? "Car" : trip.vehicleKnown ? "Boda" : "ride";
  const KindIcon = group === "ambulance" ? Ambulance : group === "luxury" ? Crown : moving ? Truck : trip.car ? Car : trip.vehicleKnown ? Bike : Route;
  const firstName = (order.rider_name ?? trip.car?.driverName ?? "").split(" ")[0] || null;
  const destination = order.destination_area || order.destination_address?.split(",")[0] || "your destination";

  const paid = detail.payments.some((p) => p.type === "collection" && p.status === "successful");
  const cash = order.payment_rail === "float";
  const arrivalPayment = rideArrivalPayment(detail);
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

  useRegisterNavPrimaryAction(moment === "riding" ? {
    label: "I’VE ARRIVED", confirmation: true, confirmationLabel: "I’VE ARRIVED", closeToHome: true,
    disabled: busy || !order.pin_code, busy, onClick: onComplete,
  } : moment === "arrived" ? arrivalPayment.receiptAvailable ? {
    label: "View receipt", icon: ReceiptText, closeToHome: true, onClick: () => setReceiptOpen(true),
  } : cash ? {
    label: arrivalPayment.cashReported ? "Waiting for rider" : "I have Paid", icon: CheckCircle2, closeToHome: true,
    disabled: busy || arrivalPayment.cashReported, busy, onClick: onCashPaid,
  } : {
    label: "Check payment", icon: Wallet, closeToHome: true, disabled: busy, onClick: () => router.push(`/orders/${order.id}/pay`),
  } : null, 10);

  if (order.stage === "Cancelled") return <div className="ride-search"><header className="ride-search-heading"><h1>Ride cancelled</h1></header><Link href="/ride" className="flex min-h-14 items-center justify-center rounded-full bg-gold px-5 text-lg font-bold text-ink-gold">Back to rides</Link></div>;

  if (moment === "finding" && !order.rider_id && !scheduled) return <RideSearch
    key={order.id} detail={detail} label={Kind} icon={KindIcon} busy={busy} error={error}
    canCancel={canCancel} paymentRequired={paymentRequired} onCancel={onCancel} onChanged={onChanged}
  />;


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

      {moment === "arrived" && (
        <>
          <section className="home-card space-y-1 text-center" aria-label="Fare">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {arrivalPayment.noCharge ? "No payment due" : arrivalPayment.receiptAvailable ? "Paid" : arrivalPayment.cashReported ? "Awaiting rider confirmation" : cash ? "To pay" : "Payment not confirmed"}
            </p>
            <p className="text-3xl font-bold tabular-nums text-ink">{fare != null ? formatUgx(fare) : "—"}</p>
            <p className="text-sm text-ink-500">
              {arrivalPayment.noCharge ? "Nothing to pay" : cash
                ? arrivalPayment.cashSettled ? "In cash to your rider" : arrivalPayment.cashReported ? "You reported paying cash to your rider" : `Hand the cash to ${firstName ?? "your rider"}`
                : arrivalPayment.digitalPaid ? arrivalPayment.method : "Check your payment status in the app"}
            </p>
            {arrivalPayment.digitalPaid && <p className="pt-2 text-sm text-ink-500">No cash to hand over</p>}
          </section>
          {order.stage === "Settle" && <section className="home-card"><RateDeliveryCard orderId={order.id} rating={detail.rating} onRated={onRated} /></section>}
        </>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {canCancel && moment !== "arrived" && (
        <button type="button" onClick={onCancel} className="mx-auto block min-h-10 px-4 text-sm font-bold text-ink-500">Cancel ride</button>
      )}
      <BottomDrawer isOpen={receiptOpen && arrivalPayment.receiptAvailable} onClose={() => setReceiptOpen(false)} title="Trip receipt">
        <div className="space-y-4 text-[17px]">
          <div className="flex justify-center"><CheckCircle2 size={40} className="text-gold" aria-hidden /></div>
          <p className="text-center font-bold">{arrivalPayment.noCharge ? "No payment due" : "Paid"}</p>
          <p className="text-center text-3xl font-bold tabular-nums">{fare != null ? formatUgx(fare) : "—"}</p>
          <p className="flex items-center justify-center gap-2">{arrivalPayment.method === "Card" ? <CreditCard size={24} aria-hidden /> : arrivalPayment.method === "Mobile money" ? <Smartphone size={24} aria-hidden /> : <Wallet size={24} aria-hidden />}{arrivalPayment.method}</p>
          {!cash && arrivalPayment.collected !== fare && <p className="text-center text-sm text-ink-500">Amount collected: {formatUgx(arrivalPayment.collected)}</p>}
          <dl className="space-y-3"><div><dt className="text-sm text-ink-500">Pickup</dt><dd>{order.pickup_area || "Pickup location"}</dd></div><div><dt className="text-sm text-ink-500">Destination</dt><dd>{destination}</dd></div><div><dt className="text-sm text-ink-500">Ride reference</dt><dd className="break-all">{order.id}</dd></div></dl>
          <button type="button" onClick={() => setReceiptOpen(false)} className="flex min-h-14 w-full items-center justify-center rounded-full bg-gold px-5 font-bold text-ink-gold">Done</button>
        </div>
      </BottomDrawer>
    </div>
  );
}
