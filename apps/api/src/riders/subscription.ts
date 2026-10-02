/**
 * Rider subscription billing — a recurring or one-time-lifetime fee a
 * rider must pay (to their own mobile money number on file) before
 * they're matchable for jobs, when the admin has it turned on. See
 * ../lib/settings.ts's monetization_subscription_* settings, this file's
 * renewSubscriptions() (called from ../worker.ts's daily Cron sweep for
 * recurring renewals), and ../riders/routes.ts for the pay/poll endpoints
 * a rider actually hits.
 */

import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getRiderChargeNumber } from "./momo-number.js";
import { getMonetizationSettings, getPlatformEnvironment, type MonetizationSettings, type SubscriptionCadence } from "../lib/settings.js";
import { checkPaymentStatus, initiateCollection } from "../payments/service.js";

type Row = Record<string, unknown>;

/** Sentinel "paid through" for a one-time lifetime charge — far enough out
 * that the same ">= now" check used for recurring cadences also means
 * "permanently active" here, with no second code path needed. */
const LIFETIME_SENTINEL = "9999-12-31 23:59:59";

/** SQLite's `datetime('now')` has no timezone marker; without normalizing
 * it first, `new Date(...)` in a non-UTC-default runtime would parse it as
 * local time instead of UTC. Same fix used throughout the mock payment
 * adapters. */
function normalizeSqliteTimestamp(raw: string): string {
  return /Z|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
}

function toSqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function addCadence(fromIso: string, cadence: SubscriptionCadence): string {
  const d = new Date(normalizeSqliteTimestamp(fromIso));
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return toSqliteTimestamp(d);
}

/** What a successful charge right now buys the rider — a lifetime
 * sentinel for "once", or one cadence period from now for "recurring". */
export function nextPaidThrough(settings: Pick<MonetizationSettings, "subscriptionMode" | "subscriptionCadence">): string {
  return settings.subscriptionMode === "once" ? LIFETIME_SENTINEL : addCadence(toSqliteTimestamp(new Date()), settings.subscriptionCadence);
}

export function isSubscriptionCurrent(rider: {
  subscription_status?: string | null;
  subscription_paid_through?: string | null;
}): boolean {
  if (rider.subscription_status !== "active" || !rider.subscription_paid_through) return false;
  return new Date(normalizeSqliteTimestamp(rider.subscription_paid_through)).getTime() >= Date.now();
}

export type RiderSubscriptionView = {
  required: boolean;
  mode: MonetizationSettings["subscriptionMode"];
  amount: number;
  cadence: MonetizationSettings["subscriptionCadence"];
  status: "inactive" | "active" | "past_due";
  current: boolean;
  paidThrough: string | null;
};

/** Everything a rider's account screen needs to render their subscription
 * state and decide whether to show a "pay to activate" prompt. */
export async function getRiderSubscriptionView(riderId: string): Promise<RiderSubscriptionView> {
  const [settings, riderRes] = await Promise.all([
    getMonetizationSettings(),
    db.execute({ sql: "SELECT subscription_status, subscription_paid_through FROM riders WHERE user_id = ?", args: [riderId] }),
  ]);
  const rider = (riderRes.rows[0] as Row | undefined) ?? {};
  const status = (rider.subscription_status as string) === "active" || (rider.subscription_status as string) === "past_due"
    ? (rider.subscription_status as "active" | "past_due")
    : "inactive";
  return {
    required: settings.subscriptionEnabled,
    mode: settings.subscriptionMode,
    amount: settings.subscriptionAmount,
    cadence: settings.subscriptionCadence,
    status,
    current: isSubscriptionCurrent(rider),
    // null for a lifetime subscriber (the sentinel isn't a real date to
    // show) and for anyone who's never paid.
    paidThrough:
      rider.subscription_paid_through && rider.subscription_paid_through !== LIFETIME_SENTINEL
        ? (rider.subscription_paid_through as string)
        : null,
  };
}

/**
 * Daily Cron sweep (see ../worker.ts scheduled()) — finds every recurring
 * subscriber whose paid-through date has passed and attempts to charge
 * them again. A "once" (lifetime) subscriber's paid_through is the far
 * sentinel, so they never show up here. Runs against whichever platform
 * environment is currently active; a sandbox rider's renewal is forced
 * through the mock adapter same as any other sandbox payment.
 */
export async function renewSubscriptions(): Promise<{ attempted: number; renewed: number; pastDue: number }> {
  const settings = await getMonetizationSettings();
  if (!settings.subscriptionEnabled || settings.subscriptionMode !== "recurring") {
    return { attempted: 0, renewed: 0, pastDue: 0 };
  }
  const environment = await getPlatformEnvironment();

  const dueRes = await db.execute({
    sql: `SELECT user_id, momo_msisdn FROM riders
          WHERE subscription_status IN ('active', 'past_due')
          AND subscription_paid_through IS NOT NULL AND subscription_paid_through < datetime('now')`,
    args: [],
  });
  const due = dueRes.rows as Row[];

  let renewed = 0;
  let pastDue = 0;
  for (const rider of due) {
    const riderId = rider.user_id as string;
    const msisdn = await getRiderChargeNumber(riderId);
    if (!msisdn) {
      await db.execute({
        sql: "UPDATE riders SET subscription_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
        args: [riderId],
      });
      pastDue += 1;
      continue;
    }

    const paymentId = newId("rsp");
    try {
      const initiated = await initiateCollection({
        referenceId: paymentId,
        msisdn,
        amount: settings.subscriptionAmount,
        narrative: "Tuma rider subscription renewal",
        forceMock: environment === "sandbox",
      });
      await db.execute({
        sql: `INSERT INTO rider_subscription_payments (id, rider_id, mode, amount, provider, provider_ref, msisdn, status, period_start, period_end, environment)
              VALUES (?, ?, 'recurring', ?, ?, ?, ?, 'pending', datetime('now'), ?, ?)`,
        args: [
          paymentId,
          riderId,
          settings.subscriptionAmount,
          initiated.provider,
          initiated.providerRef,
          msisdn,
          nextPaidThrough(settings),
          environment,
        ],
      });
      // Direct-push mobile money adapters (Yo!, MTN, Airtel, and every
      // mock) resolve near-instantly for a Cron sweep's purposes — poll
      // once right away rather than leaving it pending until a rider
      // happens to open the app and trigger a refresh, which is what the
      // customer/rider-initiated flows rely on elsewhere.
      const status = await checkPaymentStatus({ provider: initiated.provider, provider_ref: initiated.providerRef, created_at: toSqliteTimestamp(new Date()) });
      if (status === "successful") {
        await db.execute({
          sql: "UPDATE rider_subscription_payments SET status = 'successful', updated_at = datetime('now') WHERE id = ?",
          args: [paymentId],
        });
        await db.execute({
          sql: "UPDATE riders SET subscription_status = 'active', subscription_paid_through = ?, updated_at = datetime('now') WHERE user_id = ?",
          args: [nextPaidThrough(settings), riderId],
        });
        renewed += 1;
      } else {
        await db.execute({
          sql: "UPDATE riders SET subscription_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
          args: [riderId],
        });
        pastDue += 1;
      }
    } catch (err) {
      console.error(`Subscription renewal failed for rider ${riderId}:`, err);
      await db.execute({
        sql: "UPDATE riders SET subscription_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
        args: [riderId],
      });
      pastDue += 1;
    }
  }

  return { attempted: due.length, renewed, pastDue };
}
