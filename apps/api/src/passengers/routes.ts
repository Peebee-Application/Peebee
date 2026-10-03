import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getDeliverySettings } from "../lib/settings.js";

/** A phone number reduced to digits (and a leading +), so "0772 123 456" and
 * "+256772123456" compare equal and an obviously wrong entry is rejected. */
export function cleanPhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export const passengerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().max(30).transform((v, ctx) => {
    const phone = cleanPhone(v);
    if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number." });
    return phone ?? "";
  }),
});

/** Whether booking for someone else is switched on AND its migration is applied. */
export async function rideForOtherAvailable(): Promise<boolean> {
  if (!(await hasColumn("orders", "passenger_name"))) return false;
  return (await getDeliverySettings()).rideForOtherEnabled;
}

export const passengerRoutes = new Hono();
passengerRoutes.use("*", requireAuth);

/** People a customer books rides for ("Mum", "Brian") — reusable contacts. */
passengerRoutes.get("/passengers", async (c) => {
  const user = c.get("user");
  // `enabled` tells the app whether to offer "ride for someone else" at all
  // (admin switch on and migration applied), so it never promises what the
  // server would quietly ignore.
  const enabled = await rideForOtherAvailable();
  if (!(await hasTable("saved_passengers"))) return c.json({ passengers: [], enabled });
  const res = await db.execute({ sql: "SELECT * FROM saved_passengers WHERE user_id = ? ORDER BY created_at ASC", args: [user.sub] });
  return c.json({ passengers: res.rows, enabled });
});

passengerRoutes.post("/passengers", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("saved_passengers"))) return c.json({ error: "unavailable", message: "Not ready yet." }, 503);
  const parsed = passengerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  // The same number twice is the same person: update the name instead.
  const existing = await db.execute({ sql: "SELECT id FROM saved_passengers WHERE user_id = ? AND phone = ?", args: [user.sub, parsed.data.phone] });
  const found = existing.rows[0] as { id?: string } | undefined;
  const id = found?.id ?? newId("psg");
  if (found) await db.execute({ sql: "UPDATE saved_passengers SET name = ? WHERE id = ?", args: [parsed.data.name, id] });
  else await db.execute({ sql: "INSERT INTO saved_passengers (id, user_id, name, phone) VALUES (?, ?, ?, ?)", args: [id, user.sub, parsed.data.name, parsed.data.phone] });
  const res = await db.execute({ sql: "SELECT * FROM saved_passengers WHERE id = ?", args: [id] });
  return c.json({ passenger: res.rows[0] }, 201);
});

passengerRoutes.delete("/passengers/:id", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("saved_passengers"))) return c.json({ ok: true });
  await db.execute({ sql: "DELETE FROM saved_passengers WHERE id = ? AND user_id = ?", args: [c.req.param("id"), user.sub] });
  return c.json({ ok: true });
});
