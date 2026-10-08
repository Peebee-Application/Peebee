import { db } from "../db/client.js";
import { hasColumn } from "./schema.js";

const suffix = (id: string) => id.replaceAll("-", "").slice(-16).toUpperCase();

export const accountCodeFor = (id: string) => `PB-${suffix(id)}`;
export const riderCodeFor = (userId: string) => `RDR-${suffix(userId)}`;
export const merchantCodeFor = (merchantId: string) => `MER-${suffix(merchantId)}`;

/** Safe to call while migration 0081 rolls out; legacy databases simply skip it. */
export async function ensureAccountCode(userId: string): Promise<void> {
  if (await hasColumn("users", "account_code")) {
    await db.execute({
      sql: "UPDATE users SET account_code=COALESCE(NULLIF(account_code,''), ?) WHERE id=?",
      args: [accountCodeFor(userId), userId],
    });
  }
}

export async function ensureRiderCode(userId: string): Promise<void> {
  if (await hasColumn("riders", "rider_code")) {
    await db.execute({
      sql: "UPDATE riders SET rider_code=COALESCE(NULLIF(rider_code,''), ?) WHERE user_id=?",
      args: [riderCodeFor(userId), userId],
    });
  }
}

export async function ensureMerchantCode(merchantId: string): Promise<void> {
  if (await hasColumn("merchants", "merchant_code")) {
    await db.execute({
      sql: "UPDATE merchants SET merchant_code=COALESCE(NULLIF(merchant_code,''), ?) WHERE id=?",
      args: [merchantCodeFor(merchantId), merchantId],
    });
  }
}
