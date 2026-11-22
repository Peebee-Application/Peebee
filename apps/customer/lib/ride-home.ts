/** Pure helpers for the Ride home (/ride): when-chips, place predictions,
 * fare maths and trip progress. Kept free of React so they can be unit tested. */
import { roundFare } from "@peebee/shared";

export type ScheduleRules = { maxAdvanceHours: number | null; minLeadMinutes: number };

/** A "when" choice: null = now, otherwise a local `YYYY-MM-DDTHH:mm` string
 * (the same format RideModal's datetime-local input uses). */
export type WhenChoice = { id: string; label: string; at: string | null };

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Is a local datetime string inside the scheduling window? */
export function withinSchedule(at: string, rules: ScheduleRules, now: Date = new Date()): boolean {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  const lead = (t - now.getTime()) / 60_000;
  if (lead < rules.minLeadMinutes) return false;
  if (rules.maxAdvanceHours != null && lead > rules.maxAdvanceHours * 60) return false;
  return true;
}

/** Quick chips: Now, In 30 min, In 1 hour, Tonight 19:00, Tomorrow 07:00 — only
 * the ones the admin's scheduling window allows. Minutes are rounded up to 5. */
export function whenChoices(rules: ScheduleRules | null, nowOk: boolean, now: Date = new Date()): WhenChoice[] {
  const out: WhenChoice[] = [];
  if (nowOk) out.push({ id: "now", label: "Now", at: null });
  if (!rules) return out;
  const roundUp = (d: Date) => { const r = new Date(d); r.setSeconds(0, 0); r.setMinutes(Math.ceil(r.getMinutes() / 5) * 5); return r; };
  const inMinutes = (m: number) => roundUp(new Date(now.getTime() + m * 60_000));
  const candidates: Array<[string, string, Date]> = [];
  const firstLead = Math.max(30, rules.minLeadMinutes);
  candidates.push(["in-30", firstLead === 30 ? "In 30 min" : `In ${firstLead} min`, inMinutes(firstLead + 1)]);
  if (firstLead < 60) candidates.push(["in-60", "In 1 hour", inMinutes(61)]);
  const tonight = new Date(now); tonight.setHours(19, 0, 0, 0);
  candidates.push(["tonight", "Tonight 19:00", tonight]);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(7, 0, 0, 0);
  candidates.push(["tomorrow", "Tomorrow 07:00", tomorrow]);
  for (const [id, label, d] of candidates) {
    const at = toLocalInput(d);
    if (withinSchedule(at, rules, now) && !out.some((c) => c.at === at)) out.push({ id, label, at });
  }
  return out;
}

/** Short label for a chosen time, e.g. "Today 19:00" or "Fri 06:40". */
export function whenLabel(at: string | null, now: Date = new Date()): string {
  if (!at) return "Now";
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "Now";
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Today ${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${hm}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hm}`;
}

type Labelled = { label: string };

/** "Usual" destination for this time of day: weekday mornings → a saved
 * Work/Office place, afternoons and evenings → a saved Home. */
export function predictUsual<T extends Labelled>(saved: T[], now: Date = new Date()): T | null {
  const h = now.getHours();
  const weekday = now.getDay() >= 1 && now.getDay() <= 5;
  const find = (re: RegExp) => saved.find((s) => re.test(s.label)) ?? null;
  if (weekday && h >= 5 && h < 11) return find(/\b(work|office)\b/i);
  if (h >= 15 && h < 23) return find(/\bhome\b/i);
  return null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Same boda estimate RideModal books with (rate × straight-line km, admin minimum). */
export function bodaFare(distanceKm: number | null, ratePerKm: number | null | undefined, minimum: number | null | undefined): number | null {
  if (distanceKm == null || ratePerKm == null || !Number.isFinite(ratePerKm)) return null;
  return roundFare(distanceKm * ratePerKm, minimum ?? undefined);
}

/** The same estimate before rounding (null when a minimum fare decided it), for the "rounded up from…" note. */
export function bodaExact(distanceKm: number | null, ratePerKm: number | null | undefined, minimum: number | null | undefined): number | null {
  if (distanceKm == null || ratePerKm == null || !Number.isFinite(ratePerKm)) return null;
  const exact = distanceKm * ratePerKm;
  return exact > (minimum ?? 0) ? Math.round(exact) : null;
}

/** Local fallback for a per-km category fare when /v1/car/quote can't answer. */
export function categoryFare(distanceKm: number | null, ratePerKm: number, minimum: number): number {
  return distanceKm == null ? minimum : roundFare(distanceKm * ratePerKm, minimum);
}

/** Arrival clock time for a trip that starts at `departAt` (null = now). */
export function arrivalLabel(minutes: number | null, departAt: string | null, now: Date = new Date()): string | null {
  if (minutes == null) return null;
  const start = departAt ? new Date(departAt) : now;
  if (!Number.isFinite(start.getTime())) return null;
  return new Date(start.getTime() + minutes * 60_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** 0–1 progress through a ride's stages, for the live-trip card. */
export function rideProgress(stage: string): number {
  switch (stage) {
    case "Create": return 0.12;
    case "Fund": return 0.2;
    case "Match": return 0.32;
    case "Shop": return 0.45;
    case "Deliver": return 0.7;
    case "Arrived": return 0.85;
    case "PickedUp": return 0.9;
    case "Handover": return 0.95;
    case "Settle": return 1;
    default: return 0.3;
  }
}

export function formatUgx(n: number): string {
  return `UGX ${n.toLocaleString("en-UG")}`;
}
