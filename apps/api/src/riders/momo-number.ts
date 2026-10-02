import { db } from "../db/client.js";

/** The mobile money number to charge a rider for a subscription (weekly or
 * Pro). Riders now manage numbers as saved lists (Account → Payout), so the
 * legacy single riders.momo_msisdn is often empty even though they have a
 * number on file. Order: legacy field, then their primary saved payment
 * number, then their primary saved payout number. */
export async function getRiderChargeNumber(userId: string): Promise<string | null> {
  const res = await db.execute({
    sql: `SELECT COALESCE(
            NULLIF((SELECT momo_msisdn FROM riders WHERE user_id = ?), ''),
            (SELECT phone FROM saved_mobile_numbers WHERE owner_id = ? AND purpose = 'payment'
               ORDER BY is_primary DESC, created_at ASC LIMIT 1),
            (SELECT phone FROM saved_mobile_numbers WHERE owner_id = ? AND purpose = 'withdrawal'
               ORDER BY is_primary DESC, created_at ASC LIMIT 1)
          ) AS msisdn`,
    args: [userId, userId, userId],
  });
  return ((res.rows[0] as { msisdn?: string | null } | undefined)?.msisdn as string | null | undefined) ?? null;
}
