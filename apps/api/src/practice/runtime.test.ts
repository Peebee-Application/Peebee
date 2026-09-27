import assert from "node:assert/strict";
import test from "node:test";
import {
  createPracticeFetch,
  isPracticeJourneyComplete,
  startPracticeMode,
} from "@tuma/shared";

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
