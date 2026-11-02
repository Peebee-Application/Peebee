import { db } from "../db/client.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn } from "../lib/schema.js";
import { agentsOnline } from "./presence.js";

/**
 * Is a person really there? Visitors are told the truth about it: while the team is on, "Talk to a person" connects them;
 * while it is away (outside the hours the admin set, or nobody has the admin app open) they can leave a message that waits
 * for the team, or the assistant keeps helping, whichever the admin chose. All of it is settings (Admin → Support chat).
 */

export type Availability = {
  /** "online": a person can answer now. "offline": nobody can right now. */
  state: "online" | "offline";
  /** Why it is offline. */
  reason: "hours" | "nobody" | null;
  /** What the visitor is offered: talk to a person, leave a message, or nothing (the assistant only). */
  offer: "talk" | "message" | "none";
  /** The hours in words, when the admin set hours: "Monday to Saturday, 8:00 to 20:00 (UTC+3)". */
  hours: string | null;
  agentsOnline: number | null;
};

export type AvailabilitySettings = {
  hoursEnabled: boolean;
  openHour: number;
  closeHour: number;
  days: string[];
  utcOffset: number;
  offlineMode: "leave_message" | "ai_only";
  needsStaff: boolean;
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const clock = (hour: number) => `${hour === 24 ? 0 : hour}:00`;

/** "Monday to Saturday, 8:00 to 20:00 (UTC+3)"; null when hours are not switched on. */
export function describeHours(s: AvailabilitySettings): string | null {
  if (!s.hoursEnabled) return null;
  const picked = ORDER.filter((d) => s.days.includes(d));
  let days = "";
  if (picked.length > 0 && picked.length < 7) {
    const first = ORDER.indexOf(picked[0]);
    const consecutive = picked.every((d, i) => ORDER.indexOf(d) === first + i);
    days = consecutive && picked.length > 2 ? `${DAY_NAMES[picked[0]]} to ${DAY_NAMES[picked[picked.length - 1]]}, ` : `${picked.map((d) => DAY_NAMES[d]).join(", ")}, `;
  }
  return `${days}${clock(s.openHour)} to ${clock(s.closeHour)} (UTC${s.utcOffset >= 0 ? "+" : "−"}${Math.abs(s.utcOffset)})`;
}

/** Pure: is the team on at this moment according to the hours? */
export function withinHours(s: AvailabilitySettings, now: Date): boolean {
  if (!s.hoursEnabled) return true;
  const local = new Date(now.getTime() + s.utcOffset * 3_600_000);
  const day = DAYS[local.getUTCDay()];
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return s.days.includes(day) && hour >= s.openHour && hour < s.closeHour;
}

export function computeAvailability(s: AvailabilitySettings, now: Date, online: number | null, humanEnabled: boolean): Availability {
  const hours = describeHours(s);
  if (!humanEnabled) return { state: "offline", reason: null, offer: "none", hours, agentsOnline: online };
  let reason: Availability["reason"] = null;
  if (!withinHours(s, now)) reason = "hours";
  // Presence is only known once migration 0154 is applied; until then it cannot say that nobody is there.
  else if (s.needsStaff && online === 0) reason = "nobody";
  if (!reason) return { state: "online", reason: null, offer: "talk", hours, agentsOnline: online };
  return { state: "offline", reason, offer: s.offlineMode === "ai_only" ? "none" : "message", hours, agentsOnline: online };
}

const KEYS = ["support_chat_human_enabled", "support_chat_hours_enabled", "support_chat_open_hour", "support_chat_close_hour", "support_chat_open_days", "support_chat_utc_offset_hours", "support_chat_offline_mode", "support_chat_online_needs_staff"];

export async function loadAvailabilitySettings(): Promise<{ settings: AvailabilitySettings; humanEnabled: boolean }> {
  const o = await getOptions(KEYS);
  return {
    humanEnabled: o.support_chat_human_enabled === true,
    settings: {
      hoursEnabled: o.support_chat_hours_enabled === true,
      openHour: Number(o.support_chat_open_hour),
      closeHour: Number(o.support_chat_close_hour),
      days: o.support_chat_open_days as string[],
      utcOffset: Number(o.support_chat_utc_offset_hours),
      offlineMode: o.support_chat_offline_mode === "ai_only" ? "ai_only" : "leave_message",
      needsStaff: o.support_chat_online_needs_staff === true,
    },
  };
}

export async function getAvailability(now = new Date()): Promise<Availability> {
  const { settings, humanEnabled } = await loadAvailabilitySettings();
  return computeAvailability(settings, now, await agentsOnline(), humanEnabled);
}

/** How many chats are waiting, for the queue position text. */
export async function waitingCount(): Promise<number> {
  const res = await db.execute("SELECT COUNT(*) AS n FROM support_chats WHERE status = 'waiting'");
  return Number((res.rows[0] as Record<string, unknown>).n) || 0;
}

export const hasOfflineColumn = () => hasColumn("support_chats", "left_offline");
