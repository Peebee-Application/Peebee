import type { OrderRow } from "@peebee/shared";
import { stageLabel, stageProgressPct } from "./order-display";
import { rideProgress } from "./ride-home";
export type HomeActiveOrder = OrderRow & { item_count?: number };
export type ActiveOrderKind = "ride-pickup" | "ride-dropoff" | "parcel" | "shopping" | "catalogue" | "food";
/** The customer-facing category and status always come from the actual order. */
export function activeOrderCard(order: HomeActiveOrder) {
  const dropoff = ["PickedUp", "Handover", "Settle"].includes(order.stage);
  const kind: ActiveOrderKind = order.is_ride ? dropoff ? "ride-dropoff" : "ride-pickup" : order.restaurant_id ? "food" : order.store_id ? "catalogue" : order.type === "parcel" ? "parcel" : "shopping";
  const title = { "ride-pickup": "Ride · Pickup", "ride-dropoff": "Ride · Drop-off", parcel: "Parcel delivery", shopping: "Shopping list", catalogue: "Catalogue order", food: "Food delivery" }[kind];
  const needsPayment = order.stage === "Match" && order.payment_rail === "escrow" && !!order.rider_id;
  const first = order.rider_name?.trim().split(/\s+/)[0] || "Your rider";
  const destination = order.destination_area || "your destination";
  let status: string;
  if (needsPayment) status = "Payment needed to start";
  else if (order.stage === "Fund") status = "Checking payment";
  else if (["Create", "Match"].includes(order.stage)) status = order.rider_id ? "Your rider is matched" : "Finding your rider…";
  else if (order.is_ride) status = ({ Shop: `${first} is getting ready`, Deliver: `${first} is coming to you`, Arrived: "Your rider is at pickup", PickedUp: `On the way to ${destination}`, Handover: `You’ve arrived · ${destination}`, Settle: "Trip complete" } as Record<string,string>)[order.stage] ?? stageLabel(order.stage,order.type,true);
  else if (order.stage === "Shop") {
    const count = typeof order.item_count === "number" && order.item_count > 0 ? ` · ${order.item_count} item${order.item_count === 1 ? "" : "s"}` : "";
    status = kind === "food" ? "Preparing" : kind === "catalogue" ? "Packing" : kind === "parcel" ? "Your rider is collecting" : `Your rider is shopping${count}`;
  } else if (order.stage === "Deliver" || order.stage === "PickedUp") status = kind === "food" ? "Your food is on the way" : kind === "catalogue" ? "Your order is on the way" : kind === "parcel" ? "Your parcel is on the way" : "Your shopping is on the way";
  else if (order.stage === "Arrived") status = "Your rider is outside";
  else if (order.stage === "Handover") status = "Confirming handover";
  else if (order.stage === "Substitute") status = "Review substitutions";
  else if (order.stage === "Approve") status = "Shopping confirmed";
  else status = stageLabel(order.stage,order.type);
  const business = kind === "food" ? order.restaurant_name : kind === "catalogue" ? order.store_name : null;
  if (business && ["Shop", "Deliver", "PickedUp", "Arrived"].includes(order.stage)) status = `${business} · ${status}`;
  const contactAvailable = !!order.rider_id && !["Cancelled", "Settle"].includes(order.stage);
  const pin = order.rider_id && !["Create", "Match", "Fund", "Cancelled", "Settle"].includes(order.stage) ? order.pin_code : null;
  return { kind, title, status, needsPayment, contactAvailable, pin, href: needsPayment ? `/orders/${order.id}/pay` : `/orders/${order.id}`, progress: order.is_ride ? rideProgress(order.stage) : stageProgressPct(order.stage)/100 };
}
