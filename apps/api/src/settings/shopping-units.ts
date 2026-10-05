import { z } from "zod";
import { DEFAULT_SHOPPING_UNIT_SETTINGS, SHOPPING_UNIT_IDS } from "@peebee/shared";
import { getSetting } from "../lib/settings.js";

const unit = z.enum(SHOPPING_UNIT_IDS as [typeof SHOPPING_UNIT_IDS[number], ...typeof SHOPPING_UNIT_IDS[number][]]);
export const shoppingUnitSettingsSchema = z.object({
  enabled: z.boolean(), autoSelect: z.boolean(), allowCustom: z.boolean(), allowBudget: z.boolean(),
  suggestedCount: z.number().int().min(1).max(6),
  minimumPrefixLength: z.number().int().min(2).max(10),
  customUnitMaxLength: z.number().int().min(1).max(60),
  fallbackUnits: z.array(unit).min(1).max(SHOPPING_UNIT_IDS.length),
  rules: z.array(z.object({
    keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    units: z.array(unit).min(1).max(SHOPPING_UNIT_IDS.length),
    priority: z.number().int().min(0).max(100),
  })).max(100),
}).refine((config) => config.allowBudget || config.fallbackUnits.some((id) => id !== "budget"), { message: "Choose a fallback unit available when buying by amount is off." });

export async function getShoppingUnitSettings() {
  try {
    const raw = await getSetting("shopping_units_config");
    const parsed = shoppingUnitSettingsSchema.safeParse(JSON.parse(raw || "null"));
    if (parsed.success) return parsed.data;
  } catch { /* Missing or malformed stored settings use safe defaults. */ }
  return structuredClone(DEFAULT_SHOPPING_UNIT_SETTINGS);
}
