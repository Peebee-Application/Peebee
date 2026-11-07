"use client";

import type { OrderRow, RideStop } from "@peebee/shared";
import { CalendarClock, MessageCircle, Phone, Share2, ShieldCheck } from "lucide-react";
import { useChatDrawer } from "../../lib/chat-drawer";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useCalls } from "../../lib/calls-context";
import { stageLabel } from "../../lib/order-display";
import { rideProgress, whenLabel, toLocalInput } from "../../lib/ride-home";
import { RiderProfileModal } from "../RiderProfileModal";

type CarInfo = { scheduledFor: string | null; categoryName?: string; plate?: string; vehicleName?: string; driverName?: string };
type RiderFacts = { verified: boolean; vehicleInfo: string | null; rating: number | null };

/** Extra fields some order payloads carry (Peebee Car joins, practice mode). */
type CarFields = { car_plate?: string | null; car_make?: string | null; car_model?: string | null };

export function useRideTripDetails(order: OrderRow | null) {
  const [car, setCar] = useState<CarInfo | null>(null);
  const [rider, setRider] = useState<RiderFacts | null>(null);
  const orderId = order?.id ?? null;
  const riderId = order?.rider_id ?? null;

  useEffect(() => {
    if (!orderId) return setCar(null);
    let live = true;
    api.carBookingInfo(orderId).then((info) => live && setCar(info)).catch(() => live && setCar(null));
    return () => { live = false; };
  }, [orderId]);

  // Riders who offered to take the ride have a public track record; others don't, and that's fine.
  useEffect(() => {
    if (!orderId || !riderId) return setRider(null);
    let live = true;
    api.getApplicantProfile(orderId, riderId)
      .then((p) => {
        if (!live) return;
        const ratings = p.reviews.map((r) => r.rating).filter((r) => Number.isFinite(r));
        setRider({ verified: p.verified, vehicleInfo: p.vehicleInfo, rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null });
      })
      .catch(() => live && setRider(null));
    return () => { live = false; };
  }, [orderId, riderId]);

  return { car, rider };
}

/** Concept 3's live-trip card: who's coming, in what, and one-tap chat / call / share. */
export function RideTripCard({ order, car, rider, stops = [] }: { order: OrderRow; car: CarInfo | null; rider: RiderFacts | null; stops?: RideStop[] }) {
  const { openThread } = useChatDrawer();
  const { startCall } = useCalls();
  const [shared, setShared] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const extra = order as OrderRow & CarFields;
  const name = order.rider_name ?? car?.driverName ?? null;
  const firstName = name?.split(" ")[0] ?? null;
  const scheduled = car?.scheduledFor && new Date(car.scheduledFor).getTime() > Date.now() ? car.scheduledFor : null;
  const plate = car?.plate ?? extra.car_plate ?? null;
  const vehicle = car?.vehicleName ?? ([extra.car_make, extra.car_model].filter(Boolean).join(" ") || rider?.vehicleInfo || null);
  const awaitingPayment = !!order.rider_id && order.stage === "Match" && order.payment_rail === "escrow";
  const atStop = order.stage === "PickedUp" ? stops.find((s) => s.status === "arrived") : undefined;
  const status = atStop
    ? `At stop ${atStop.position}${atStop.area ? ` · ${atStop.area}` : ""}`
    : scheduled
    ? `Scheduled · ${whenLabel(toLocalInput(new Date(scheduled)))}`
    : awaitingPayment
      ? `${firstName ?? "Your rider"} is matched · pay to start`
      : order.rider_id && order.stage === "Shop"
        ? `${firstName ?? "Your rider"} is confirmed · getting ready`
      : order.rider_id && order.eta_minutes != null && order.stage === "Deliver"
        ? `${firstName ?? "Your rider"} · ${order.eta_minutes} min away`
        : order.rider_id && firstName && order.stage === "Arrived"
          ? `${firstName} is here`
          : stageLabel(order.stage, order.type, true);
  const facts = [plate, vehicle, rider?.rating != null ? `★ ${rider.rating.toFixed(1)}` : null].filter(Boolean).join(" · ");
  const progress = rideProgress(order.stage);

  async function share() {
    const to = order.destination_area || order.destination_address?.split(",")[0] || "my destination";
    const link = order.share_token ? `${window.location.origin}/trip/${order.share_token}` : null;
    const text = `I'm on a Peebee ride${name ? ` with ${name}` : ""}${plate ? ` (${plate})` : ""} to ${to}.${link ? "" : ` Status: ${stageLabel(order.stage, order.type, true)}.`}`;
    try {
      if (navigator.share) {
        await navigator.share(link ? { text, url: link } : { text });
        return;
      }
      await navigator.clipboard?.writeText(link ? `${text} ${link}` : text);
      setShared("Trip details copied");
    } catch {
      /* the share sheet was dismissed */
    }
  }

  const btn = "ride-trip-card__btn flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold";
  return (
    <section aria-label="Your ride" aria-live="polite" className="ride-trip-card relative overflow-hidden rounded-[22px] p-3.5 pb-3">
      {/* Tapping who is coming opens their profile, with Call and Chat. */}
      <button type="button" disabled={!order.rider_id} aria-haspopup="dialog" onClick={() => setProfileOpen(true)} className="relative flex w-full items-center gap-3 text-left">
        <span className="ride-trip-card__avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold">
          {scheduled ? <CalendarClock className="h-5 w-5" aria-hidden /> : (name ?? "P").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-ink">{name || scheduled ? status : "Finding your rider…"}</span>
          <span className="flex items-center gap-1 truncate text-xs text-ink-500">
            {rider?.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green" aria-label="Verified" />}
            <span className="truncate">{facts || (order.destination_area ? `To ${order.destination_area}` : stageLabel(order.stage, order.type, true))}</span>
          </span>
        </span>
        {order.pin_code && <span className="shrink-0 rounded-full bg-gold/15 px-2 py-1 text-[10px] font-bold tracking-wider text-ink" aria-label={`Trip PIN ${order.pin_code}`}>PIN {order.pin_code}</span>}
      </button>
      {stops.length > 0 && (
        <ol className="relative mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5" aria-label={`${stops.length} stop${stops.length === 1 ? "" : "s"} on the way`}>
          {stops.map((s) => (
            <li
              key={s.position}
              className={`ride-stop-chip flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.status === "done" ? "is-done" : s.status === "arrived" ? "is-here" : ""}`}
            >
              <span className="ride-stop-chip__n" aria-hidden>{s.status === "done" ? "✓" : s.position}</span>
              <span className="max-w-[120px] truncate">{s.area ?? s.address ?? `Stop ${s.position}`}</span>
              <span className="sr-only">{s.status === "done" ? ", done" : s.status === "arrived" ? ", rider is here" : ", coming up"}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="relative mt-3 flex gap-2">
        {order.rider_id && (
          <>
            <button type="button" onClick={() => openThread({ type: "rider", id: order.rider_id! })} aria-label={`Chat with ${firstName ?? "your rider"}`} className={btn}><MessageCircle className="h-4 w-4" aria-hidden />Chat</button>
            <button type="button" onClick={() => startCall({ calleeId: order.rider_id!, orderId: order.id })} aria-label={`Call ${firstName ?? "your rider"} in the app`} className={btn}><Phone className="h-4 w-4" aria-hidden />Call</button>
          </>
        )}
        <button type="button" onClick={() => void share()} className={btn}><Share2 className="h-4 w-4" aria-hidden />Share trip</button>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-[3px] ride-trip-card__track" role="progressbar" aria-label="Trip progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span className="block h-full ride-gold-fill" style={{ width: `${progress * 100}%` }} />
      </span>
      {shared && <p role="status" className="relative mt-2 text-xs font-semibold text-ink-500">{shared}</p>}
      {profileOpen && order.rider_id && (
        <RiderProfileModal
          orderId={order.id}
          applicant={{ riderId: order.rider_id, riderName: name ?? "Your rider", distanceKm: null, outOfServiceRange: false, avgRating: rider?.rating ?? null, reviewCount: 0, recommendCount: 0, commentCount: 0, recentComments: [] }}
          onCall={() => startCall({ calleeId: order.rider_id!, orderId: order.id })}
          onChat={() => { setProfileOpen(false); openThread({ type: "rider", id: order.rider_id! }); }}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </section>
  );
}
