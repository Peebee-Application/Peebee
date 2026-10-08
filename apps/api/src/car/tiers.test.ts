import test from "node:test";
import assert from "node:assert/strict";
import { acceptsTier, tierFare } from "./tiers.js";

const pricing = { ratePerKm: 2_000, minimumFare: 8_000, comfortPremiumPercent: 30, xlPremiumPercent: 50, xlMinSeats: 6 } as never;

test("normal and large ride sizes match their seat ranges independently from service class", () => {
  const convenientSaloon = { service_class: "convenient", accepts_convenient: 1, seat_capacity: 4, lat: 0, lng: 0 };
  const comfortSaloon = { ...convenientSaloon, service_class: "comfort", accepts_convenient: 0 };
  const minivan = { ...convenientSaloon, seat_capacity: 7 };
  const fiveSeatCar = { ...convenientSaloon, seat_capacity: 5 };
  assert.equal(acceptsTier(convenientSaloon, "convenient", 6, "normal"), true);
  assert.equal(acceptsTier(comfortSaloon, "comfort", 6, "normal"), true);
  assert.equal(acceptsTier(convenientSaloon, "convenient", 6, "large"), false);
  assert.equal(acceptsTier(fiveSeatCar, "convenient", 6, "large"), true);
  assert.equal(acceptsTier(minivan, "convenient", 6, "large"), true);
});

test("comfort and large fares add their configured premiums", () => {
  assert.equal(tierFare(5, "convenient", pricing, "normal"), 10_000);
  assert.equal(tierFare(5, "comfort", pricing, "normal"), 13_000);
  assert.equal(tierFare(5, "convenient", pricing, "large"), 15_000);
  assert.equal(tierFare(5, "comfort", pricing, "large"), 19_500);
});
