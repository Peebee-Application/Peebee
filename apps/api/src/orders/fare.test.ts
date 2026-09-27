import assert from "node:assert/strict";
import test from "node:test";
import { roundFare } from "@tuma/shared";

test("fares use the UGX 350 cutoff within each UGX 500 interval", () => {
  const examples = [
    [0, 500], [102, 500], [499, 500], [500, 500],
    [850, 500], [851, 1_000], [1_000, 1_000],
    [2_102, 2_000], [2_349, 2_000], [2_350, 2_000],
    [2_350.01, 2_500], [2_351, 2_500], [2_500, 2_500],
    [2_850, 2_500], [2_851, 3_000], [3_000, 3_000],
  ];
  for (const [amount, expected] of examples) {
    assert.equal(roundFare(amount), expected, `fare for UGX ${amount}`);
  }
});

test("rounding preserves configured minimum fares and valid denominations", () => {
  assert.equal(roundFare(102, 2_000), 2_000);
  assert.equal(roundFare(2_102, 2_500), 2_500);
  assert.equal(roundFare(102, 2_100), 2_500);
  for (let amount = 0; amount <= 10_000; amount += 17) {
    const fare = roundFare(amount);
    assert.ok(fare >= 500);
    assert.equal(fare % 500, 0);
    assert.equal(roundFare(fare), fare);
  }
});
