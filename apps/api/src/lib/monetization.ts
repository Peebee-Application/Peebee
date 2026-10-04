/**
 * Pure fee-math for the monetization mechanisms an admin can toggle on
 * (Settings → Monetization) — delivery commission, a customer-facing
 * service fee, and a transaction/processing fee split however they like
 * between customer and rider. No DB access here; ../orders/routes.ts calls
 * this once at Fund time (to know what to actually collect) and persists
 * the result to order_fees so Settle later withholds the rider's cut
 * without needing to recompute against settings that may have changed in
 * between.
 *
 * Deliberately excluded: float-rail orders (no money ever passes through
 * Peebee to take a cut of) and, for the processing fee specifically,
 * wallet-funded orders (no external payment rail actually processed
 * anything). See computeCheckoutFees' `payingWithWallet` param.
 */

import type { MonetizationSettings } from "./settings.js";
import type { OrderType } from "@peebee/shared";

export type CheckoutFees = {
  /** 100% platform revenue, added on top of what the customer pays. */
  serviceFee: number;
  /** Processing-fee portion charged to the customer, also added on top. */
  processingFeeCustomer: number;
  /** Processing-fee portion that'll be withheld from the rider's payout
   * later — computed now (not at Settle) so it can't drift if the
   * processing fee rate changes mid-order. */
  processingFeeRider: number;
  /** Delivery-commission portion that'll be withheld from the rider's
   * payout at Settle. */
  deliveryCommission: number;
  /** Sum of everything added on top of the base item+delivery amount —
   * this is what actually gets charged at Fund time. */
  totalSurcharge: number;
};

function round(n: number): number {
  return Math.round(n);
}

/** A service fee can never be as large as the fare it is charged on: it is
 * capped at the admin-set share of the base amount (Settings → Monetization,
 * "Highest service fee", 1–99%). Without a cap a typo in admin (a 100% rate,
 * or a flat amount above the fare) doubled customers' bills. */
export const DEFAULT_SERVICE_FEE_MAX_SHARE_PERCENT = 50;

/**
 * baseAmount is what the order would cost with monetization off (items +
 * delivery fee, or just delivery fee for a parcel ride). deliveryFee is
 * that same figure's delivery-only portion, since commission and the
 * rider-borne processing fee only ever apply there — never to item cost.
 */
export function computeCheckoutFees(
  settings: MonetizationSettings,
  input: { baseAmount: number; deliveryFee: number; orderType: OrderType; payingWithWallet: boolean },
): CheckoutFees {
  const rawServiceFee = settings.serviceFeeEnabled
    ? round(settings.serviceFeeType === "flat" ? settings.serviceFeeValue : (input.baseAmount * settings.serviceFeeValue) / 100)
    : 0;
  const maxShare = Math.min(99, Math.max(1, settings.serviceFeeMaxSharePercent ?? DEFAULT_SERVICE_FEE_MAX_SHARE_PERCENT));
  const serviceFee = Math.min(rawServiceFee, Math.floor((Math.max(0, input.baseAmount) * maxShare) / 100));

  let processingFeeCustomer = 0;
  let processingFeeRider = 0;
  // No external payment rail moves money for a wallet-funded order, so
  // there's no real processing cost to recover here.
  if (settings.processingFeeEnabled && !input.payingWithWallet) {
    const total = round((input.baseAmount * settings.processingFeePercent) / 100);
    if (settings.processingFeeMode === "customer") {
      processingFeeCustomer = total;
    } else if (settings.processingFeeMode === "rider") {
      processingFeeRider = total;
    } else {
      processingFeeCustomer = round((total * settings.processingFeeSplitCustomerPercent) / 100);
      processingFeeRider = total - processingFeeCustomer;
    }
  }

  const deliveryCommission = settings.deliveryCommissionEnabled
    ? round(
        (input.deliveryFee *
          (input.orderType === "parcel"
            ? settings.deliveryCommissionParcelPercent
            : settings.deliveryCommissionShoppingPercent)) /
          100,
      )
    : 0;

  return {
    serviceFee,
    processingFeeCustomer,
    processingFeeRider,
    deliveryCommission,
    totalSurcharge: serviceFee + processingFeeCustomer,
  };
}

/**
 * What the rider actually gets credited at Settle, given what escrow (or
 * the wallet debit) actually collected and the fee breakdown locked in at
 * Fund time. `collected` includes the surcharge (service fee + any
 * customer-borne processing fee) on top of the base item+delivery amount —
 * none of that surcharge is ever the rider's, on top of withholding the
 * commission and the rider-borne processing fee. Floored at 0 — a
 * shortfall in collection (see ../orders/routes.ts settle handler) eats
 * into the rider's share before it could ever go negative on the
 * platform's books.
 */
export function riderPayout(collected: number, fees: CheckoutFees): number {
  return Math.max(0, collected - fees.totalSurcharge - fees.deliveryCommission - fees.processingFeeRider);
}

/**
 * Whether a rider is allowed to take on new jobs at all, given how cash
 * (float-rail) platform fees are collected — see ../orders/routes.ts
 * POST /orders/:id/settle. "wallet" mode never restricts this: a negative
 * balance just nets against the rider's next payout. "deposit" mode treats
 * the reserve as a hard floor — a rider whose balance has been eaten into
 * below it can't claim/apply for anything new until they top back up,
 * exactly the "you cannot buy any other orders" rule this was asked for.
 */
export function isCashDepositOk(
  walletBalance: number,
  cashFeeSource: MonetizationSettings["cashFeeSource"],
  reserve: { enabled: boolean; amount: number },
): boolean {
  if (cashFeeSource !== "deposit" || !reserve.enabled) return true;
  return walletBalance >= reserve.amount;
}
