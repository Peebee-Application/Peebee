import { ORDER_STAGES, type OrderRow, type OrderStageValue } from "@peebee/shared";

export const STAGE_LABELS: Record<OrderStageValue, string> = {
  Create: "New order",
  Match: "Matched",
  Fund: "Awaiting funding",
  Shop: "Shopping",
  Substitute: "Substitution review",
  Approve: "Approved",
  Deliver: "Delivering",
  Arrived: "Arrived",
  PickedUp: "Trip in progress",
  Handover: "Handover",
  Settle: "Completed",
};

export function stageIndex(stage: string): number {
  const i = ORDER_STAGES.indexOf(stage as OrderStageValue);
  return i === -1 ? 0 : i;
}

export function stageProgressPct(stage: string): number {
  return Math.round(((stageIndex(stage) + 1) / ORDER_STAGES.length) * 100);
}

export function stageLabel(stage: string, type?: OrderRow["type"], isRide?: boolean): string {
  if (type === "parcel" && stage === "Shop") return isRide ? "Matched — head to pickup" : "Picking up";
  if (isRide && stage === "Deliver") return "Heading to pickup";
  if (isRide && stage === "Arrived") return "At pickup";
  return STAGE_LABELS[stage as OrderStageValue] ?? stage;
}

export function formatUgx(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `UGX ${amount.toLocaleString("en-UG")}`;
}

/** Takes only the fields it reads, so it works for both a full order
 * and the deliberately thinner AvailableJob from the open-jobs feed. */
type TitleableOrder = Pick<OrderRow, "id" | "type" | "customer_name" | "destination_area" | "is_ride">;

export function jobTitle(order: TitleableOrder): string {
  if (order.type !== "parcel") {
    const firstName = order.customer_name?.trim().split(/\s+/)[0];
    if (firstName) return `${firstName}'s List`;
  }
  const noun = order.is_ride ? "Ride" : order.type === "parcel" ? "Parcel" : "Delivery";
  return order.destination_area ? `${noun} to ${order.destination_area}` : `Job #${order.id.slice(-6)}`;
}

/** Four-way split riders actually think in — a food order is stored as
 * `type: 'shopping'` with `restaurant_id` set, and a passenger ride is
 * stored as `type: 'parcel'` with `is_ride` set (see
 * apps/api/src/db/migrations/0034_order_restaurant.sql and
 * 0039_ride_orders.sql), so neither is a distinct OrderType and both have
 * to be derived here. */
export type JobCategory = "parcel" | "ride" | "shopping" | "food";

export function jobCategory(order: Pick<OrderRow, "type" | "restaurant_id" | "is_ride">): JobCategory {
  if (order.type === "parcel") return order.is_ride ? "ride" : "parcel";
  return order.restaurant_id ? "food" : "shopping";
}

export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  parcel: "Parcels",
  ride: "Rides",
  shopping: "Shopping",
  food: "Food",
};
