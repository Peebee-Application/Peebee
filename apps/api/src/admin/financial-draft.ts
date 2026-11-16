import { z } from "zod";
import { db } from "../db/client.js";

const key = "financial_model_shared_draft";
const line = z.record(z.string().max(64), z.string().max(160));
export const draftInput = z.object({
  revision: z.string().uuid().nullable(),
  answers: z.record(z.string().max(80), z.union([z.string().max(160), z.array(line).max(250)]))
    .refine(answers => typeof answers.company === "string" && Object.keys(answers).length <= 300)
    .refine(answers => new TextEncoder().encode(JSON.stringify(answers)).byteLength <= 120_000),
}).strict();

type SaveInput = z.infer<typeof draftInput>;
type Draft = { revision: string; answers: SaveInput["answers"] };

export async function getFinancialDraft(): Promise<Draft | null> {
  const result = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  const raw = result.rows[0]?.value;
  return typeof raw === "string" ? JSON.parse(raw) as Draft : null;
}

export async function saveFinancialDraft({ revision, answers }: SaveInput) {
  const draft: Draft = { revision: crypto.randomUUID(), answers };
  const raw = JSON.stringify(draft);
  const result = await db.execute(revision === null
    ? { sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", args: [key, raw] }
    : { sql: "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND json_extract(value, '$.revision') = ?",
        args: [raw, key, revision] });
  return result.rowsAffected === 1 ? draft : null;
}
