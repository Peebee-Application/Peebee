import type { Context, Next } from "hono";
import { db } from "../db/client.js";
import { hasPeebeeRole } from "../auth/roles.js";
import { hasTable } from "../lib/schema.js";

export async function personalWalletIsActive(userId: string): Promise<boolean> {
  if (!(await hasTable("personal_wallets"))) return hasPeebeeRole(userId, "customer");
  const result = await db.execute({ sql: "SELECT 1 FROM personal_wallets WHERE user_id=?", args: [userId] });
  return !!result.rows[0];
}

export async function activatePersonalWallet(userId: string): Promise<boolean> {
  if (!(await hasTable("personal_wallets"))) return false;
  await db.execute({
    sql: "INSERT OR IGNORE INTO personal_wallets (user_id, activated_by) VALUES (?, ?)",
    args: [userId, userId],
  });
  return personalWalletIsActive(userId);
}

export async function requireActivePersonalWallet(c: Context, next: Next) {
  const user = c.get("user") as { sub?: string } | undefined;
  if (!user?.sub || !(await personalWalletIsActive(user.sub))) {
    return c.json({
      error: "personal_wallet_not_active",
      message: "Activate your personal wallet before using wallet payments or transfers.",
    }, 409);
  }
  await next();
}
