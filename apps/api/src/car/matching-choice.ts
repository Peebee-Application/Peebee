import type { MatchingMode } from "@peebee/shared";
import type { CarMatchingMode } from "../lib/settings.js";

/**
 * How a Peebee Car ride finds its driver. A customer who has chosen in their account how their requests are accepted
 * ("Auto accept" = first to claim, "Approve" = drivers apply and the customer picks) gets that for car rides too, when
 * the admin lets customers choose; everyone else gets the admin's car setting. An ambulance always goes to the nearest
 * free one: nobody waits to pick a driver in an emergency.
 */
export function resolveCarMatchingMode(input: {
  ambulance: boolean;
  adminMode: CarMatchingMode;
  followCustomerChoice: boolean;
  customerMode: string | null | undefined;
  enabledModes: readonly MatchingMode[];
}): CarMatchingMode {
  if (input.ambulance) return "first_to_claim";
  const mode = input.customerMode;
  if (
    input.followCustomerChoice &&
    (mode === "first_to_claim" || mode === "customer_selects") &&
    input.enabledModes.includes(mode)
  ) {
    return mode;
  }
  return input.adminMode;
}
