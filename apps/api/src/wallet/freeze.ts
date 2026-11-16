import { db } from "../db/client.js";
import { hasColumn } from "../lib/schema.js";

type Row = Record<string, unknown>;

/**
 * True when this account cannot send, pay, move money out, or be spent by
 * someone it is shared with. Money can still come in. Missing columns (the
 * migration not applied yet) read as not frozen, so existing payments keep
 * working.
 *
 * `walletId` omitted or "primary" is the original wallet on `users`.
 */
export async function walletIsFrozen(userId: string, walletId?: string | null): Promise<boolean> {
  const named = !!walletId && walletId !== "primary";
  if (named) {
    if (!(await hasColumn("wallets", "frozen_at"))) return false;
    const res = await db.execute({
      sql: "SELECT frozen_at FROM wallets WHERE id = ? AND owner_id = ?",
      args: [walletId, userId],
    });
    return !!(res.rows[0] as Row | undefined)?.frozen_at;
  }
  if (!(await hasColumn("users", "primary_wallet_frozen_at"))) return false;
  const res = await db.execute({
    sql: "SELECT primary_wallet_frozen_at FROM users WHERE id = ?",
    args: [userId],
  });
  return !!(res.rows[0] as Row | undefined)?.primary_wallet_frozen_at;
}

export function frozenBody() {
  return {
    error: "account_frozen" as const,
    message: "This account is frozen. Unfreeze it to send, pay, or move money out. Money can still come in.",
  };
}
