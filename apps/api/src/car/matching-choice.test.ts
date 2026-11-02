import assert from "node:assert/strict";
import test from "node:test";
import { resolveCarMatchingMode } from "./matching-choice.js";

const BOTH = ["first_to_claim", "customer_selects"] as const;
const base = { ambulance: false, adminMode: "customer_selects", followCustomerChoice: true, customerMode: null, enabledModes: BOTH } as const;

test("a customer who has not chosen gets the admin's car setting", () => {
  assert.equal(resolveCarMatchingMode({ ...base }), "customer_selects");
  assert.equal(resolveCarMatchingMode({ ...base, adminMode: "first_to_claim" }), "first_to_claim");
  assert.equal(resolveCarMatchingMode({ ...base, customerMode: undefined }), "customer_selects");
});

test("a customer's choice overrides the admin's car setting", () => {
  assert.equal(resolveCarMatchingMode({ ...base, customerMode: "first_to_claim" }), "first_to_claim");
  assert.equal(resolveCarMatchingMode({ ...base, adminMode: "first_to_claim", customerMode: "customer_selects" }), "customer_selects");
});

test("the admin can switch the customer's choice off for car rides", () => {
  assert.equal(resolveCarMatchingMode({ ...base, followCustomerChoice: false, customerMode: "first_to_claim" }), "customer_selects");
});

test("a choice the admin has not enabled is ignored", () => {
  assert.equal(resolveCarMatchingMode({ ...base, customerMode: "customer_selects", adminMode: "first_to_claim", enabledModes: ["first_to_claim"] }), "first_to_claim");
});

test("a mode a car ride cannot use falls back to the admin's setting", () => {
  assert.equal(resolveCarMatchingMode({ ...base, customerMode: "nearest_window", enabledModes: [...BOTH, "nearest_window"] }), "customer_selects");
  assert.equal(resolveCarMatchingMode({ ...base, customerMode: "nonsense" }), "customer_selects");
});

test("an ambulance always goes to the nearest free one", () => {
  assert.equal(resolveCarMatchingMode({ ...base, ambulance: true, customerMode: "customer_selects" }), "first_to_claim");
  assert.equal(resolveCarMatchingMode({ ...base, ambulance: true, followCustomerChoice: false }), "first_to_claim");
});
