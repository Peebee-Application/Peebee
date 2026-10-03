import assert from "node:assert/strict";
import test from "node:test";
import { computeCheckoutFees, MAX_SERVICE_FEE_SHARE } from "./monetization.js";
import type { MonetizationSettings } from "./settings.js";

const settings = (over: Partial<MonetizationSettings>): MonetizationSettings => ({
  deliveryCommissionEnabled: false,
  deliveryCommissionParcelPercent: 0,
  deliveryCommissionShoppingPercent: 0,
  serviceFeeEnabled: true,
  serviceFeeType: "flat",
  serviceFeeValue: 0,
  processingFeeEnabled: false,
  processingFeePercent: 0,
  processingFeeMode: "customer",
  processingFeeSplitCustomerPercent: 50,
  cashFeeSource: "wallet",
  subscriptionEnabled: false,
  subscriptionMode: "recurring",
  subscriptionAmount: 0,
  subscriptionCadence: "weekly",
  ...over,
});
const ride = { baseAmount: 6500, deliveryFee: 6500, orderType: "parcel" as const, payingWithWallet: false };

test("a service fee is never as large as the fare", () => {
  // The reported case: UGX 6,500 ride, UGX 6,598 of fees (a 100% / 6,500 service fee + 1.5% processing).
  assert.equal(computeCheckoutFees(settings({ serviceFeeType: "percent", serviceFeeValue: 100 }), ride).serviceFee, 3250);
  assert.equal(computeCheckoutFees(settings({ serviceFeeType: "flat", serviceFeeValue: 6500 }), ride).serviceFee, 3250);
  assert.equal(computeCheckoutFees(settings({ serviceFeeType: "flat", serviceFeeValue: 9999 }), ride).serviceFee, 3250);
  assert.ok(MAX_SERVICE_FEE_SHARE < 1);
});

test("sensible service fees are unchanged", () => {
  assert.equal(computeCheckoutFees(settings({ serviceFeeType: "flat", serviceFeeValue: 500 }), ride).serviceFee, 500);
  assert.equal(computeCheckoutFees(settings({ serviceFeeType: "percent", serviceFeeValue: 10 }), ride).serviceFee, 650);
  assert.equal(computeCheckoutFees(settings({ serviceFeeEnabled: false, serviceFeeValue: 500 }), ride).serviceFee, 0);
});

test("the cap doesn't touch the processing fee, and total surcharge stays below the fare", () => {
  const fees = computeCheckoutFees(
    settings({ serviceFeeType: "percent", serviceFeeValue: 100, processingFeeEnabled: true, processingFeePercent: 1.5 }),
    ride,
  );
  assert.equal(fees.processingFeeCustomer, 98);
  assert.equal(fees.totalSurcharge, 3250 + 98);
  assert.ok(fees.totalSurcharge < ride.baseAmount);
});

test("tiny fares can't be eaten by a flat fee", () => {
  assert.equal(computeCheckoutFees(settings({ serviceFeeValue: 500 }), { ...ride, baseAmount: 600, deliveryFee: 600 }).serviceFee, 300);
  assert.equal(computeCheckoutFees(settings({ serviceFeeValue: 500 }), { ...ride, baseAmount: 0, deliveryFee: 0 }).serviceFee, 0);
});
