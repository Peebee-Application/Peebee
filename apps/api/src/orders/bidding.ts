import { roundFare, type MatchingMode } from "@tuma/shared";
import { getBiddingSettings, getMatchingSettings, type BiddingSettings } from "../lib/settings.js";

type Row = Record<string, unknown>;

export type BiddingState = {
  /** Bids are accepted on this order right now. */
  active: boolean;
  /** The price the app calculated (never changes once a bid replaces the total). */
  appPrice: number | null;
  /** Lowest/highest total a bid may name; null when bidding isn't active. */
  min: number | null;
  max: number | null;
};

const OFF: BiddingState = { active: false, appPrice: null, min: null, max: null };

/** The price the app itself worked out for this order. */
export function appPriceOf(order: Row): number | null {
  const price = order.app_price ?? order.estimated_total;
  return typeof price === "number" ? price : price != null ? Number(price) : null;
}

/**
 * Whether riders/drivers may bid on this order, and within what range.
 * All of these must hold: the admin switched bidding on; "customer selects"
 * (several applications, customer chooses) is an enabled matching mode and is
 * this order's mode; and it is a ride or parcel (whose whole total is the
 * delivery price) — shopping and food orders have items, so they never bid.
 */
export function computeBidding(order: Row, settings: BiddingSettings, enabledModes: MatchingMode[]): BiddingState {
  if (!settings.enabled) return OFF;
  if (!enabledModes.includes("customer_selects") || order.matching_mode !== "customer_selects") return OFF;
  const isRideOrParcel = order.is_ride === 1 || order.is_ride === true || (order.type === "parcel" && !order.restaurant_id);
  if (!isRideOrParcel) return OFF;
  const appPrice = appPriceOf(order);
  if (appPrice == null || appPrice <= 0) return OFF;
  return {
    active: true,
    appPrice,
    min: roundFare((appPrice * settings.minPercent) / 100),
    max: roundFare((appPrice * settings.maxPercent) / 100),
  };
}

export async function loadBiddingContext(): Promise<{ settings: BiddingSettings; enabledModes: MatchingMode[] }> {
  const [settings, matching] = await Promise.all([getBiddingSettings(), getMatchingSettings()]);
  return { settings, enabledModes: matching.enabledModes };
}

/** Checks a bid against the limits. Returns the rounded bid, or an error message. */
export function validateBid(state: BiddingState, bid: number): { bid: number } | { error: string } {
  if (!state.active || state.min == null || state.max == null) return { error: "Bidding isn't available on this job." };
  const rounded = roundFare(bid);
  if (rounded < state.min || rounded > state.max) {
    return { error: `Your price must be between UGX ${state.min.toLocaleString("en-UG")} and UGX ${state.max.toLocaleString("en-UG")}.` };
  }
  return { bid: rounded };
}
