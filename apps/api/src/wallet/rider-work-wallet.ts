import { db } from "../db/client.js";
import type { PlatformEnvironment } from "../lib/settings.js";

type Row = Record<string, unknown>;
const column = (environment: PlatformEnvironment) => environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";

/** Rider work earnings and commission adjustments stay in riders.wallet_balance. */
export async function creditRiderWorkWallet(userId: string, amount: number, environment: PlatformEnvironment): Promise<number | null> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Rider work-wallet credits must be positive whole UGX amounts");
  const balanceColumn = column(environment);
  const result = await db.execute({
    sql: `UPDATE riders SET ${balanceColumn}=${balanceColumn}+?, updated_at=datetime('now') WHERE user_id=?`,
    args: [amount, userId],
  });
  if (!result.rowsAffected) return null;
  const balance = await db.execute({ sql: `SELECT ${balanceColumn} AS balance FROM riders WHERE user_id=?`, args: [userId] });
  return Number((balance.rows[0] as Row | undefined)?.balance ?? 0);
}

/** Cash fees may create a rider work-wallet debt, offset by later payouts. */
export async function debitRiderWorkWalletAllowNegative(userId: string, amount: number, environment: PlatformEnvironment): Promise<number | null> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Rider work-wallet debits must be positive whole UGX amounts");
  const balanceColumn = column(environment);
  const result = await db.execute({
    sql: `UPDATE riders SET ${balanceColumn}=${balanceColumn}-?, updated_at=datetime('now') WHERE user_id=?`,
    args: [amount, userId],
  });
  if (!result.rowsAffected) return null;
  const balance = await db.execute({ sql: `SELECT ${balanceColumn} AS balance FROM riders WHERE user_id=?`, args: [userId] });
  return Number((balance.rows[0] as Row | undefined)?.balance ?? 0);
}
