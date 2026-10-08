import assert from "node:assert/strict";
import test from "node:test";
import {
  type FoodSellerOrders,
  createPracticeFetch,
  isPracticeJourneyComplete,
  startPracticeMode,
} from "@peebee/shared";

test("Food practice order tabs stay local and follow the sample settlement", async () => {
  installStorage();
  const fetcher = createPracticeFetch("restaurant", (async () => { throw new Error("Must not access live orders"); }) as typeof fetch);
  startPracticeMode("restaurant");
  const first = await (await fetcher("https://api.test/v1/restaurants/me/orders?view=active")).json() as FoodSellerOrders;
  assert.equal(first.orders.length, 1); assert.equal(first.orders[0].stage, "Shop");
  assert.equal((await (await fetcher("https://api.test/v1/restaurants/me/orders?view=history")).json() as FoodSellerOrders).orders.length, 0);
  await fetcher("https://api.test/v1/merchant-payments/mpay_practice/merchant-confirm", { method: "POST", body: "{}" });
  await fetcher("https://api.test/v1/merchants/merchant-practice/settlements", { method: "POST", body: "{}" });
  const history = await (await fetcher("https://api.test/v1/restaurants/me/orders?view=history")).json() as FoodSellerOrders;
  assert.equal(history.orders.length, 1); assert.equal(history.orders[0].stage, "Settle"); assert.deepEqual(history.counts, { active: 0, history: 1 });
});

function installStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, location: { origin: "https://customer.test" } } });
}

test("customer practice runs the real order API contract without reaching live fetch", async () => {
  installStorage();
  let liveCalls = 0;
  const practiceFetch = createPracticeFetch("customer", (async () => {
    liveCalls += 1;
    throw new Error("live fetch must not be called");
  }) as typeof fetch);
  startPracticeMode("customer");

  await practiceFetch("https://api.test/v1/lists", { method: "POST", body: JSON.stringify({ items: [{ name: "Rice", quantity: 1, unitCost: 10_000 }] }) });
  await practiceFetch("https://api.test/v1/orders", { method: "POST", body: JSON.stringify({ type: "shopping", estimatedTotal: 10_000 }) });
  const created = await (await practiceFetch("https://api.test/v1/orders/practice-order")).json() as { order: { stage: string; rider_id: string | null } };
  assert.equal(created.order.stage, "Create");
  assert.equal(created.order.rider_id, null);

  await practiceFetch("https://api.test/v1/orders/practice-order/match", { method: "POST" });
  await practiceFetch("https://api.test/v1/orders/practice-order/fund", { method: "POST", body: "{}" });
  const funded = await (await practiceFetch("https://api.test/v1/orders/practice-order")).json() as { order: { stage: string; rider_id: string | null } };
  assert.equal(funded.order.stage, "Shop");
  assert.equal(funded.order.rider_id, "practice-rider");
  assert.equal(liveCalls, 0);
});

test("practice car picker defaults to normal convenient and assigns random all-distance demo drivers", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("customer", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("customer");
  const config = await (await practiceFetch("https://api.test/v1/car/config")).json() as { serviceTiers: object; categories: Array<{ id: string; seats: number }> };
  assert.ok(config.serviceTiers);
  assert.ok(config.categories.some((category) => category.seats === 4));
  assert.ok(config.categories.some((category) => category.seats === 7));
  const distantOptions = await (await practiceFetch("https://api.test/v1/car/service-options?pickupLat=80&pickupLng=140&destinationLat=-70&destinationLng=-140")).json() as { options: Array<{ size: string; tier: string; nearby: number }> };
  assert.equal(distantOptions.options.length, 4);
  assert.ok(distantOptions.options.every((option) => option.nearby === 2), "practice drivers are available regardless of distance");
  const defaultOption = distantOptions.options.find((option) => option.size === "normal" && option.tier === "convenient");
  assert.equal(defaultOption?.nearby, 2);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    let response = await practiceFetch("https://api.test/v1/car/bookings", { method: "POST", body: JSON.stringify({ vehicleSize: "large", serviceTier: "comfort", pickupLat: 0, pickupLng: 0, destinationLat: 0.01, destinationLng: 0.01 }) });
    assert.equal(response.status, 201);
    let info = await (await practiceFetch("https://api.test/v1/car/bookings/practice-order/info")).json() as { driverName: string; vehicleName: string };
    assert.equal(info.driverName, "Amina Nankya");
    assert.match(info.vehicleName, /Toyota Voxy/);
    Math.random = () => 0.99;
    response = await practiceFetch("https://api.test/v1/car/bookings", { method: "POST", body: JSON.stringify({ vehicleSize: "large", serviceTier: "comfort", pickupLat: -75, pickupLng: 100, destinationLat: 70, destinationLng: -100 }) });
    assert.equal(response.status, 201);
    info = await (await practiceFetch("https://api.test/v1/car/bookings/practice-order/info")).json() as { driverName: string; vehicleName: string };
    assert.equal(info.driverName, "Ruth Atim");
    assert.match(info.vehicleName, /Toyota Noah/);
  } finally {
    Math.random = originalRandom;
  }
});

test("practice parcel fare and stored total use the same rounded amount", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("customer", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("customer");
  for (const [estimatedTotal, expected] of [[3_102, 3_000], [3_350, 3_000], [3_351, 3_500]]) {
    const response = await practiceFetch("https://api.test/v1/orders", {
      method: "POST",
      body: JSON.stringify({ type: "parcel", estimatedTotal }),
    });
    const { order } = await response.json() as { order: { estimated_total: number; delivery_fee: number } };
    assert.equal(order.delivery_fee, expected);
    assert.equal(order.estimated_total, expected);
  }
});

test("merchant practice confirmation marks that role's journey complete", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("merchant", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("merchant");
  assert.equal(isPracticeJourneyComplete("merchant"), false);
  await practiceFetch("https://api.test/v1/merchant-payments/mpay_practice/merchant-confirm", { method: "POST", body: JSON.stringify({ amount: 28_000 }) });
  assert.equal(isPracticeJourneyComplete("merchant"), true);
});
