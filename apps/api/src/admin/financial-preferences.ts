import { z } from "zod";
import { db } from "../db/client.js";

const prefix = "financial_model_preferences:";
const preferences = z.object({
  appearance: z.enum(["dark", "light", "system", "auto"]),
  autosave: z.boolean(),
});
export const preferencesPatch = preferences.partial().strict().refine(value => Object.keys(value).length > 0);
type PreferencesPatch = z.infer<typeof preferencesPatch>;
const defaults = { appearance: "system", autosave: false } as const;

export async function getFinancialPreferences(userId: string) {
  const result = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [prefix + userId] });
  const raw = result.rows[0]?.value;
  const stored = typeof raw === "string" ? preferencesPatch.safeParse(JSON.parse(raw)) : null;
  return { ...defaults, ...(stored?.success ? stored.data : {}) };
}

export async function saveFinancialPreferences(userId: string, patch: PreferencesPatch) {
  await db.execute({
    sql: `INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = json_patch(settings.value, excluded.value), updated_at = datetime('now')`,
    args: [prefix + userId, JSON.stringify(patch)],
  });
}
