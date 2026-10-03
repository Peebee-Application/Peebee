import { randomInt } from "./random.js";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newPin(): string {
  return String(1000 + randomInt(9000));
}

/** A private, unguessable token for a trip link the booker shares with the
 * passenger — the token itself is the only credential on that public page. */
export function newShareToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
