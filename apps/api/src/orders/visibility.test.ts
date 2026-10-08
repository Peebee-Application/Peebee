import assert from "node:assert/strict";
import test from "node:test";
import { redactOrder } from "./visibility.js";

test("food outlet code is shown only to the assigned rider and admins", () => {
  const order = {
    id: "food-order",
    customer_id: "customer-1",
    rider_id: "rider-1",
    pin_code: "1234",
    share_token: "private-link",
    restaurant_outlet_code: "FOOD-123",
    restaurant_outlet_name: "Main Kitchen",
  };

  const rider = redactOrder(order, { sub: "rider-1", role: "rider" });
  assert.equal(rider?.restaurant_outlet_code, "FOOD-123");
  assert.equal(rider?.pin_code, undefined);
  assert.equal(rider?.share_token, undefined);

  const customer = redactOrder(order, { sub: "customer-1", role: "customer" });
  assert.equal(customer?.restaurant_outlet_code, undefined);
  assert.equal(customer?.pin_code, "1234");

  const admin = redactOrder(order, { sub: "admin-1", role: "admin" });
  assert.equal(admin?.restaurant_outlet_code, "FOOD-123");

  const unrelatedCustomer = redactOrder(order, { sub: "customer-2", role: "customer" });
  assert.equal(unrelatedCustomer?.restaurant_outlet_code, undefined);
  assert.equal(unrelatedCustomer?.pin_code, undefined);
});
