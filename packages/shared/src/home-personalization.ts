/** Operating rules for the customer home. Persisted with the existing home setting. */
export const DEFAULT_HOME_PERSONALIZATION = {
  enabled: true,
  historyEnabled: true,
  clockEnabled: true,
  clockHoldSeconds: 4,
  morningHour: 5,
  afternoonHour: 12,
  eveningHour: 17,
  nightHour: 22,
  commuteEndHour: 10,
  lunchEndHour: 15,
  historyDays: 60,
  historyLimit: 50,
  routineMinTrips: 2,
  weekendHelp: true,
  rideSuggestions: true,
  foodSuggestions: true,
  learningSuggestions: true,
};
export type HomePersonalizationSettings = typeof DEFAULT_HOME_PERSONALIZATION;
export function resolveHomePersonalization(value: unknown): HomePersonalizationSettings {
  const out = { ...DEFAULT_HOME_PERSONALIZATION };
  if (!value || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;
  for (const key of ["enabled", "historyEnabled", "clockEnabled", "weekendHelp", "rideSuggestions", "foodSuggestions", "learningSuggestions"] as const) {
    if (typeof v[key] === "boolean") out[key] = v[key];
  }
  for (const [key, min, max] of [["clockHoldSeconds", 2, 60], ["morningHour", 0, 23], ["afternoonHour", 0, 23], ["eveningHour", 0, 23], ["nightHour", 0, 23], ["commuteEndHour", 0, 23], ["lunchEndHour", 0, 23], ["historyDays", 1, 365], ["historyLimit", 1, 100], ["routineMinTrips", 1, 50]] as const) {
    const n = v[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max) out[key] = n;
  }
  if (!(out.morningHour < out.afternoonHour && out.afternoonHour < out.eveningHour && out.eveningHour < out.nightHour
    && out.commuteEndHour > out.morningHour && out.commuteEndHour <= out.afternoonHour
    && out.lunchEndHour > out.afternoonHour && out.lunchEndHour <= out.eveningHour)) {
    for (const key of ["morningHour", "afternoonHour", "eveningHour", "nightHour", "commuteEndHour", "lunchEndHour"] as const) out[key] = DEFAULT_HOME_PERSONALIZATION[key];
  }
  return out;
}
export type HomeHistoryEntry = {
  id: string;
  createdAt: string;
  kind: "ride" | "food" | "shopping" | "parcel";
  destination: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
};
