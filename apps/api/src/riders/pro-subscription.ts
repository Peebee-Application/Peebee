/**
 * Rider "Pro" — a separate, optional paid tier from the job-activation
 * subscription in ./subscription.ts. Unlocks whichever premium features an
 * admin has individually flipped to require it (Luganda list-audio, Stage
 * Savings Circles) rather than gating job matching itself. Same recurring/
 * one-time-lifetime shape and mobile-money payment path as the base
 * subscription, deliberately — see ../lib/settings.ts's pro_* settings,
 * this file's renewProSubscriptions() (called from the same daily Cron
 * sweep in ../worker.ts as renewSubscriptions()), and ../riders/routes.ts
 * for the pay/poll endpoints a rider actually hits. Unlike the base
 * subscription, admin may offer BOTH pricing modes at once — a rider then
 * picks which to buy.
 */

import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getRiderChargeNumber } from "./momo-number.js";
import { getPlatformEnvironment, getProSettings, type ProSettings, type SubscriptionCadence } from "../lib/settings.js";
import { checkPaymentStatus, initiateCollection } from "../payments/service.js";

type Row = Record<string, unknown>;

/** Sentinel "paid through" for a one-time lifetime charge — see
 * ./subscription.ts's identical constant for why. */
const LIFETIME_SENTINEL = "9999-12-31 23:59:59";

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

/** What a successful charge right now buys the rider — a lifetime sentinel
 * for "once", or one cadence period from now for "recurring". */
export function nextProPaidThrough(mode: "recurring" | "once", cadence: SubscriptionCadence): string {
  return mode === "once" ? LIFETIME_SENTINEL : addCadence(toSqliteTimestamp(new Date()), cadence);
}

export function isProSubscriptionCurrent(rider: {
  pro_status?: string | null;
  pro_paid_through?: string | null;
}): boolean {
  if (rider.pro_status !== "active" || !rider.pro_paid_through) return false;
  return new Date(normalizeSqliteTimestamp(rider.pro_paid_through)).getTime() >= Date.now();
}

export type RiderProSubscriptionView = {
  enabled: boolean;
  recurringEnabled: boolean;
  recurringAmount: number;
  recurringCadence: SubscriptionCadence;
  onetimeEnabled: boolean;
  onetimeAmount: number;
  status: "inactive" | "active" | "past_due";
  current: boolean;
  mode: "recurring" | "once" | null;
  paidThrough: string | null;
};

/** Everything a rider's account screen needs to render their Pro state and
 * decide which purchase button(s), if any, to show. */
export async function getRiderProSubscriptionView(riderId: string): Promise<RiderProSubscriptionView> {
  const [settings, riderRes] = await Promise.all([
    getProSettings(),
    db.execute({ sql: "SELECT pro_status, pro_paid_through, pro_mode FROM riders WHERE user_id = ?", args: [riderId] }),
  ]);
  const rider = (riderRes.rows[0] as Row | undefined) ?? {};
  const status = (rider.pro_status as string) === "active" || (rider.pro_status as string) === "past_due"
    ? (rider.pro_status as "active" | "past_due")
    : "inactive";
  return {
    enabled: settings.enabled,
    recurringEnabled: settings.recurringEnabled,
    recurringAmount: settings.recurringAmount,
    recurringCadence: settings.recurringCadence,
    onetimeEnabled: settings.onetimeEnabled,
    onetimeAmount: settings.onetimeAmount,
    status,
    current: isProSubscriptionCurrent(rider),
    mode: (rider.pro_mode as "recurring" | "once" | null) ?? null,
    // null for a lifetime subscriber (the sentinel isn't a real date to
    // show) and for anyone who's never paid.
    paidThrough:
      rider.pro_paid_through && rider.pro_paid_through !== LIFETIME_SENTINEL
        ? (rider.pro_paid_through as string)
        : null,
  };
}

/**
 * Daily Cron sweep (see ../worker.ts scheduled(), alongside the base
 * subscription's renewSubscriptions()) — finds every recurring Pro
 * subscriber whose paid-through date has passed and attempts to charge
 * them again. A "once" (lifetime) subscriber's paid_through is the far
 * sentinel, so they never show up here.
 */
export async function renewProSubscriptions(): Promise<{ attempted: number; renewed: number; pastDue: number }> {
  const settings = await getProSettings();
  if (!settings.enabled || !settings.recurringEnabled) {
    return { attempted: 0, renewed: 0, pastDue: 0 };
  }
  const environment = await getPlatformEnvironment();

  const dueRes = await db.execute({
    sql: `SELECT user_id, momo_msisdn FROM riders
          WHERE pro_status IN ('active', 'past_due') AND pro_mode = 'recurring'
          AND pro_paid_through IS NOT NULL AND pro_paid_through < datetime('now')`,
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
        sql: "UPDATE riders SET pro_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
        args: [riderId],
      });
      pastDue += 1;
      continue;
    }

    const paymentId = newId("rpp");
    try {
      const initiated = await initiateCollection({
        referenceId: paymentId,
        msisdn,
        amount: settings.recurringAmount,
        narrative: "Peebee rider Pro renewal",
        forceMock: environment === "sandbox",
      });
      const periodEnd = nextProPaidThrough("recurring", settings.recurringCadence);
      await db.execute({
        sql: `INSERT INTO rider_pro_subscription_payments (id, rider_id, mode, amount, provider, provider_ref, msisdn, status, period_start, period_end, environment)
              VALUES (?, ?, 'recurring', ?, ?, ?, ?, 'pending', datetime('now'), ?, ?)`,
        args: [paymentId, riderId, settings.recurringAmount, initiated.provider, initiated.providerRef, msisdn, periodEnd, environment],
      });
      // Same near-instant poll-once rationale as ./subscription.ts's
      // renewSubscriptions() — a Cron sweep can't wait for a rider to open
      // the app and trigger a refresh themselves.
      const status = await checkPaymentStatus({ provider: initiated.provider, provider_ref: initiated.providerRef, created_at: toSqliteTimestamp(new Date()) });
      if (status === "successful") {
        await db.execute({
          sql: "UPDATE rider_pro_subscription_payments SET status = 'successful', updated_at = datetime('now') WHERE id = ?",
          args: [paymentId],
        });
        await db.execute({
          sql: "UPDATE riders SET pro_status = 'active', pro_paid_through = ?, updated_at = datetime('now') WHERE user_id = ?",
          args: [periodEnd, riderId],
        });
        renewed += 1;
      } else {
        await db.execute({
          sql: "UPDATE riders SET pro_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
          args: [riderId],
        });
        pastDue += 1;
      }
    } catch (err) {
      console.error(`Pro subscription renewal failed for rider ${riderId}:`, err);
      await db.execute({
        sql: "UPDATE riders SET pro_status = 'past_due', updated_at = datetime('now') WHERE user_id = ?",
        args: [riderId],
      });
      pastDue += 1;
    }
  }

  return { attempted: due.length, renewed, pastDue };
}
