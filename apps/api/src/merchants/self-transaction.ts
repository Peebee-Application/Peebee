import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";

/** Active merchant staff must not buy from a store they operate. */
export async function isActiveMerchantMember(userId: string, merchantId: string): Promise<boolean> {
  if (!(await hasTable("merchant_members"))) return false;
  const result = await db.execute({
    sql: "SELECT 1 FROM merchant_members WHERE user_id = ? AND merchant_id = ? AND status = 'active' LIMIT 1",
    args: [userId, merchantId],
  });
  return result.rows.length > 0;
}

