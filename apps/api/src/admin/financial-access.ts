import type { Context, Next } from "hono";
import { db } from "../db/client.js";

export const financialAccessKey = "financial_model_staff_access:";

export async function requireFinancialAccess(c: Context, next: Next) {
  const staff = c.get("user");
  if (staff?.adminRole === "super_admin") return next();
  if (staff?.role === "admin" && staff.adminRole) {
    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = ?",
      args: [financialAccessKey + staff.sub],
    });
    if (result.rows[0]?.value === "1") return next();
  }
  return c.json({ error: "forbidden", message: "Ask a Peebee Super Admin to grant you Financials access." }, 403);
}
