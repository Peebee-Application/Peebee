import { z } from "zod";
import { DEFAULT_RIDE_TRACKING_SETTINGS } from "@peebee/shared";
import { getSetting } from "../lib/settings.js";

export const rideTrackingSchema = z.object({
  enabled: z.boolean(),
  showEstimates: z.boolean(),
  locationIntervalSeconds: z.number().int().min(3).max(60),
  staleAfterSeconds: z.number().int().min(15).max(300),
  routeRefreshSeconds: z.number().int().min(15).max(300),
}).refine((value) => value.staleAfterSeconds >= value.locationIntervalSeconds * 2, {
  message: "Stale location threshold must allow at least two location updates.",
});

export async function getRideTrackingSettings() {
  try {
    const parsed = rideTrackingSchema.safeParse(JSON.parse(await getSetting("ride_tracking")));
    if (parsed.success) return parsed.data;
  } catch { /* Use safe defaults for missing or malformed settings. */ }
  return { ...DEFAULT_RIDE_TRACKING_SETTINGS };
}
