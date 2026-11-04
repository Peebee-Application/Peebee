/**
 * Proves a saved mobile money number belongs to the person who saved it, and gates cash-outs on that proof.
 *
 * A six-digit code is sent by SMS to the number itself (never to the account's sign-up number). Entering it marks the
 * saved number verified. Whether a withdrawal REQUIRES a verified number is an Admin setting
 * (withdrawal_numbers_require_verification); it is off until the migration is applied and an admin turns it on, so
 * nothing changes for anyone before then. The throttles here (one code a minute, five an hour, five wrong guesses per
 * code, ten minutes of life) are safety rails against SMS abuse and guessing, not product behaviour.
 */

import { normalizeUgandaMsisdn } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getWithdrawalNumbersRequireVerification } from "../lib/settings.js";
import { generateCode, hashCode, timingSafeEqual } from "../verify/otp.js";
import { isAfricasTalkingConfigured, sendVerificationSms } from "../verify/sms.js";

type Row = Record<string, unknown>;

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;
const MAX_WRONG_ATTEMPTS = 5;

export async function verificationAvailable(): Promise<boolean> {
  return (await hasColumn("saved_mobile_numbers", "verified_at")) && (await hasTable("number_verification_codes"));
}

/** Same number, whatever the formatting: 0772…, +256772…, 256772… all compare equal. */
export function samePhone(a: string, b: string): boolean {
  const na = normalizeUgandaMsisdn(a);
  const nb = normalizeUgandaMsisdn(b);
  if (na && nb) return na === nb;
  return a.replace(/\D/g, "") === b.replace(/\D/g, "");
}

function sqliteMs(value: string): number {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

export type SendResult =
  | { ok: true; devCode?: string }
  | { ok: false; status: 404 | 409 | 429 | 502 | 503; error: string; message?: string; retryAfterSeconds?: number };

export async function sendNumberCode(userId: string, numberId: string): Promise<SendResult> {
  if (!(await verificationAvailable())) return { ok: false, status: 503, error: "migration_pending", message: "Number verification isn't available yet." };
  const found = await db.execute({ sql: "SELECT * FROM saved_mobile_numbers WHERE id = ? AND owner_id = ?", args: [numberId, userId] });
  const number = found.rows[0] as Row | undefined;
  if (!number) return { ok: false, status: 404, error: "not_found" };
  if (number.verified_at) return { ok: false, status: 409, error: "already_verified", message: "This number is already verified." };

  const recent = await db.execute({
    sql: "SELECT created_at FROM number_verification_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
    args: [userId],
  });
  const times = (recent.rows as Row[]).map((r) => sqliteMs(String(r.created_at)));
  const last = times[0];
  if (last != null) {
    const remaining = RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - last);
    if (remaining > 0) return { ok: false, status: 429, error: "too_soon", retryAfterSeconds: Math.ceil(remaining / 1000) };
  }
  const inLastHour = times.filter((t) => Date.now() - t < 3_600_000).length;
  if (inLastHour >= MAX_CODES_PER_HOUR) {
    return { ok: false, status: 429, error: "too_many_codes", message: "Too many codes requested. Try again in an hour.", retryAfterSeconds: 3600 };
  }

  const configured = isAfricasTalkingConfigured();
  // Never mint a usable code that cannot be delivered, outside explicit local development.
  if (!configured && process.env.ENVIRONMENT !== "development") {
    return { ok: false, status: 503, error: "sms_unavailable", message: "Text messages aren't set up yet, so numbers can't be verified." };
  }

  const phone = String(number.phone);
  const to = normalizeUgandaMsisdn(phone);
  const code = generateCode();
  // A newer code replaces any earlier unused one for this number.
  await db.execute({ sql: "UPDATE number_verification_codes SET consumed_at = datetime('now') WHERE number_id = ? AND consumed_at IS NULL", args: [numberId] });
  await db.execute({
    sql: "INSERT INTO number_verification_codes (id, user_id, number_id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [newId("nvc"), userId, numberId, phone, await hashCode(code), new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString()],
  });

  if (configured) {
    try {
      await sendVerificationSms(to ? `+${to}` : phone, code);
    } catch (err) {
      console.error("Number verification SMS failed:", err instanceof Error ? err.message : err);
      return { ok: false, status: 502, error: "send_failed", message: "Couldn't send the code. Please try again." };
    }
    return { ok: true };
  }
  console.log(`[verify] number code for ${phone}: ${code}`);
  return { ok: true, devCode: code };
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 410 | 429 | 503; error: string; message?: string };

export async function confirmNumberCode(userId: string, numberId: string, code: string): Promise<ConfirmResult> {
  if (!(await verificationAvailable())) return { ok: false, status: 503, error: "migration_pending", message: "Number verification isn't available yet." };
  const found = await db.execute({ sql: "SELECT * FROM saved_mobile_numbers WHERE id = ? AND owner_id = ?", args: [numberId, userId] });
  const number = found.rows[0] as Row | undefined;
  if (!number) return { ok: false, status: 404, error: "not_found" };

  const latest = await db.execute({
    sql: "SELECT * FROM number_verification_codes WHERE number_id = ? AND user_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
    args: [numberId, userId],
  });
  const otp = latest.rows[0] as Row | undefined;
  if (!otp || sqliteMs(String(otp.created_at)) + 24 * 3_600_000 < Date.now()) {
    return { ok: false, status: 410, error: "no_active_code", message: "Request a new code." };
  }
  // The code belongs to the digits it was sent to; if the number was edited since, it no longer proves anything.
  if (!samePhone(String(otp.phone), String(number.phone))) {
    return { ok: false, status: 410, error: "no_active_code", message: "This number changed. Request a new code." };
  }
  if (Date.parse(String(otp.expires_at)) < Date.now()) return { ok: false, status: 410, error: "expired", message: "That code has expired. Request a new one." };
  if (Number(otp.attempts) >= MAX_WRONG_ATTEMPTS) return { ok: false, status: 429, error: "too_many_attempts", message: "Too many wrong codes. Request a new one." };

  if (!timingSafeEqual(await hashCode(code), String(otp.code_hash))) {
    await db.execute({ sql: "UPDATE number_verification_codes SET attempts = attempts + 1 WHERE id = ?", args: [String(otp.id)] });
    return { ok: false, status: 400, error: "wrong_code", message: "That code isn't right." };
  }

  await db.execute({ sql: "UPDATE number_verification_codes SET consumed_at = datetime('now') WHERE id = ?", args: [String(otp.id)] });
  await db.execute({ sql: "UPDATE saved_mobile_numbers SET verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [numberId] });
  return { ok: true };
}

/**
 * The one rule every cash-out to a saved number goes through. Returns null when the withdrawal may go ahead, or the
 * error to send back. Off (null) when the admin switch is off or the migration has not been applied, so a deploy
 * before the migration, or before an admin opts in, never blocks anyone.
 */
export async function withdrawalNumberBlocked(userId: string, msisdn: string): Promise<{ error: string; message: string } | null> {
  if (!(await getWithdrawalNumbersRequireVerification())) return null;
  if (!(await verificationAvailable())) return null;
  const res = await db.execute({
    sql: "SELECT phone FROM saved_mobile_numbers WHERE owner_id = ? AND purpose = 'withdrawal' AND verified_at IS NOT NULL",
    args: [userId],
  });
  if ((res.rows as Row[]).some((r) => samePhone(String(r.phone), msisdn))) return null;
  return {
    error: "number_not_verified",
    message: "Verify this mobile money number before withdrawing to it. Save it under your withdrawal numbers and enter the code we text you.",
  };
}
