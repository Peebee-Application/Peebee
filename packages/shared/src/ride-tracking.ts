export type RideTrackingSettings = {
  enabled: boolean;
  showEstimates: boolean;
  locationIntervalSeconds: number;
  staleAfterSeconds: number;
  routeRefreshSeconds: number;
};

export const DEFAULT_RIDE_TRACKING_SETTINGS: RideTrackingSettings = {
  enabled: true,
  showEstimates: true,
  locationIntervalSeconds: 5,
  staleAfterSeconds: 60,
  routeRefreshSeconds: 30,
};

export function locationTimestamp(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

export function isFreshLocation(value: string | null | undefined, now: number, staleSeconds: number): boolean {
  const age = now - locationTimestamp(value);
  return Number.isFinite(age) && age >= -5000 && age <= staleSeconds * 1000;
}

export function rideIsEnRoute(stage: string): boolean {
  return ["Deliver", "Arrived", "Handover", "Settle"].includes(stage);
}

export function travelMinutes(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, Math.ceil(seconds / 60)) : null;
}
