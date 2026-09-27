import { roundFare } from "./fare.js";

export type TimeFeeSettings = {
  cancellationEnabled: boolean;
  cancellationType: "flat" | "percent";
  cancellationValue: number;
  waitingEnabled: boolean;
  waitingType: "flat" | "percent";
  waitingValue: number;
  freeWaitingMinutes: number;
};

export const DEFAULT_TIME_FEES: TimeFeeSettings = {
  cancellationEnabled: true, cancellationType: "flat", cancellationValue: 500,
  waitingEnabled: true, waitingType: "flat", waitingValue: 500, freeWaitingMinutes: 5,
};

export type TimeFeePolicy = { cancellationFee: number; waitingFee: number; freeWaitingMinutes: number };
export type OrderTimeFees = TimeFeePolicy & {
  canCancel: boolean;
  cancellationDue: number;
  waitingStartedAt: string | null;
  waitingEndsAt: string | null;
  waitingDue: number;
  charged: Array<{ id: string; kind: "cancellation" | "waiting"; amount: number; note: string }>;
};

export function timeFeePolicy(settings: TimeFeeSettings, fare: number): TimeFeePolicy {
  const fee = (enabled: boolean, type: "flat" | "percent", value: number) =>
    enabled ? roundFare(type === "flat" ? value : Math.max(0, fare) * value / 100) : 0;
  return {
    cancellationFee: fee(settings.cancellationEnabled, settings.cancellationType, settings.cancellationValue),
    waitingFee: fee(settings.waitingEnabled, settings.waitingType, settings.waitingValue),
    freeWaitingMinutes: settings.freeWaitingMinutes,
  };
}

export function timeFeeNotice(policy: TimeFeePolicy, ride: boolean): string {
  const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;
  const cancellation = ride && policy.cancellationFee > 0
    ? `Cancelling after your rider sets off costs ${ugx(policy.cancellationFee)}.` : "";
  const waiting = policy.waitingFee > 0
    ? `${policy.freeWaitingMinutes} minutes of waiting are free. After that, a one-time waiting fee of ${ugx(policy.waitingFee)} applies.` : "";
  return [cancellation, waiting, cancellation || waiting ? "Fees come from your main wallet. If it goes below zero, your next top-up clears the amount owed." : ""].filter(Boolean).join(" ");
}
