import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TIME_FEES, timeFeeNotice, timeFeePolicy } from "@tuma/shared";

test("default cancellation and waiting fees are simple UGX 500 charges", () => {
  const policy = timeFeePolicy(DEFAULT_TIME_FEES, 2_102);
  assert.deepEqual(policy, { cancellationFee: 500, waitingFee: 500, freeWaitingMinutes: 5 });
  assert.match(timeFeeNotice(policy, true), /UGX 500/);
  assert.match(timeFeeNotice(policy, true), /5 minutes/);
});

test("percentage fees still resolve to a whole UGX 500 denomination", () => {
  const policy = timeFeePolicy({
    ...DEFAULT_TIME_FEES,
    cancellationType: "percent",
    cancellationValue: 10,
    waitingType: "percent",
    waitingValue: 20,
  }, 2_351);
  assert.equal(policy.cancellationFee, 500);
  assert.equal(policy.waitingFee, 500);
  assert.equal(policy.cancellationFee % 500, 0);
  assert.equal(policy.waitingFee % 500, 0);
});
