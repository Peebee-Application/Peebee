export type TxWhen =
  | { kind: "today"; time: string }
  | { kind: "yesterday" }
  | { kind: "weekday"; day: string; time: string }
  | { kind: "date"; label: string };

function parseWhen(iso: string): Date | null {
  const value = iso.trim();
  if (!value) return null;
  const normalised = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Today 14:02, Yesterday, Mon 18:40, or a localised date. Never a raw ISO string. */
export function describeTxWhen(iso: string, now = new Date()): TxWhen {
  const date = parseWhen(iso);
  if (!date) return { kind: "date", label: iso };
  const time = clock(date);
  const diff = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (diff === 0) return { kind: "today", time };
  if (diff === 1) return { kind: "yesterday" };
  if (diff > 1 && diff < 7) return { kind: "weekday", day: date.toLocaleDateString(undefined, { weekday: "short" }), time };
  const sameYear = date.getFullYear() === now.getFullYear();
  return {
    kind: "date",
    label: date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" }),
  };
}
