"use client";

import type { AttentionParty, OrderDetail } from "@peebee/shared";
import { FollowUpMessages } from "@peebee/shared/follow-up-messages";
import { MapPin, MessageCircle, Phone, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useCalls } from "../lib/calls-context";
import { formatUgx } from "../lib/order-display";

export function GoodsOverview({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  const { startCall } = useCalls();
  const [parties, setParties] = useState<AttentionParty[]>([]);
  const [messageParty, setMessageParty] = useState<AttentionParty | null>(null);
  useEffect(() => {
    let live = true;
    api.getFollowUp(order.id).then((result) => { if (live) setParties(result.parties); }).catch(() => {});
    return () => { live = false; };
  }, [order.id]);
  const firstLeg = detail.relay?.legs.find((leg) => leg.leg === 1);
  const lastLeg = detail.relay?.legs.find((leg) => leg.leg === 3);
  const firstMile = order.stage === "Deliver" && !!firstLeg?.handoffCode;
  const relayCollection = order.stage === "Deliver" && !firstMile && lastLeg?.status === "assigned";
  const collecting = ["Shop", "Substitute", "Approve"].includes(order.stage);
  const waiting = ["Create", "Match", "Fund"].includes(order.stage);
  const list = order.type === "shopping" && !order.restaurant_id && !order.store_id;
  const kind = order.restaurant_id ? "Food order" : order.store_id ? "Store order" : order.type === "parcel" ? "Parcel" : "Shopping list";
  const title = order.stage === "Cancelled" ? "Delivery cancelled" : firstMile ? "Relay handoff" : relayCollection ? (detail.relay?.dropMode === "station" ? "Collect at station" : "Collect from taxi") : collecting ? (list ? "Shop the list" : order.restaurant_id ? "Collect food" : order.store_id ? "Collect items" : "Collect parcel") : waiting ? "Awaiting payment" : order.stage === "Settle" ? "Delivery complete" : order.stage === "Handover" ? "Handoff confirmed" : "Deliver to customer";
  const location = firstMile ? firstLeg?.toName : relayCollection ? detail.relay?.station?.name ?? lastLeg?.fromName : collecting || waiting ? order.restaurant_outlet_name ?? order.restaurant_name ?? order.store_name ?? order.pickup_area : order.destination_area;
  const address = firstMile || relayCollection ? null : collecting || waiting ? order.pickup_address ?? order.store_address : order.destination_address;
  const party = firstMile || relayCollection ? parties.find((p) => p.role === "taxi") : collecting && !list && order.type !== "parcel" ? parties.find((p) => p.role === "business") : parties.find((p) => p.role === "customer");
  const contactLabel = firstMile || relayCollection ? "taxi" : collecting && order.type === "parcel" ? "sender" : party?.label.toLowerCase() ?? "customer";
  return <>
    {messageParty && <FollowUpMessages api={api} orderId={order.id} recipientId={messageParty.userId} name={messageParty.name} onClose={() => setMessageParty(null)} />}
    <header className="job-heading"><h1>{title}</h1><p>{firstMile ? "First-mile" : relayCollection ? "Last-mile" : kind} · #{order.id.slice(-6)}</p></header>
    <section className="job-glass job-destination" aria-label="Current stop"><span className="job-icon"><MapPin aria-hidden /></span><div className="min-w-0"><p className="job-eyebrow">{firstMile ? "Next handoff" : relayCollection || collecting || waiting ? "Pickup" : "Customer drop-off"}</p><h2>{location || (list ? "Shop at a merchant" : address || "Location pending")}</h2>{address && address !== location && <p className="job-address">{address}</p>}</div></section>
    {collecting && order.destination_area && <p className="job-later">Deliver to: {order.destination_area}</p>}
    {relayCollection && order.destination_area && <p className="job-later">Next: {order.destination_area}</p>}
    {party && <section className="job-contact-section" aria-label="Contact"><div className="job-contact"><span className="job-icon"><User aria-hidden /></span><div><h2>{party.name}</h2><p>{contactLabel}</p></div></div><div className="job-contact-actions"><button type="button" className="job-secondary" onClick={() => startCall({ calleeId: party.userId, orderId: order.id, restaurantId: party.restaurantId })}><Phone aria-hidden />Call {contactLabel}</button><button type="button" className="job-secondary" onClick={() => setMessageParty(party)}><MessageCircle aria-hidden />Message</button></div></section>}
    <section className="job-glass job-fare" aria-label="Delivery fee"><span>Delivery fee</span><strong>{formatUgx(firstMile ? firstLeg?.fee : relayCollection ? lastLeg?.fee : order.delivery_fee)}</strong></section>
  </>;
}
