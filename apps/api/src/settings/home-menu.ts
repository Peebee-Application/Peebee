import { z } from "zod";
import { DEFAULT_HOME_MENU, HIVE_SHORTCUT_IDS, resolveHomeMenu, type HomeMenuSettings } from "@peebee/shared";
import { getSetting } from "../lib/settings.js";

const label = z.string().trim().min(1).max(20);
const hiveShortcut = z.object({ id: z.enum(HIVE_SHORTCUT_IDS), label, enabled: z.boolean() });

export const homeMenuSchema = z.object({
  header: z.object({ chatEnabled: z.boolean() }).optional(),
  navigation: z.object({ streamLabel: label, exploreLabel: label, spacesLabel: label, spacesEnabled: z.boolean(), confirmPercent: z.number().int().min(60).max(95).optional() }).optional(),
  clusters: z.object({
    ride: z.object({ label }),
    shopping: z.object({ label }),
    food: z.object({ label }),
    learn: z.object({ label }),
    hive: z.object({ label }),
  }),
  hive: z.object({
    eyebrow: z.string().trim().min(1).max(60),
    altLabel: z.string().trim().max(20).optional(),
    labelSeconds: z.number().int().min(2).max(30).optional(),
    description: z.string().trim().min(1).max(200),
    shortcuts: z.array(hiveShortcut).min(1).max(HIVE_SHORTCUT_IDS.length),
    hireBanner: z.object({ enabled: z.boolean(), title: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(160) }),
  }),
}).superRefine((menu, ctx) => {
  const ids = menu.hive.shortcuts.map((s) => s.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hive", "shortcuts"], message: "Each shortcut can appear only once." });
  // Structural safety rail: the Hive page must always offer something to tap.
  if (!menu.hive.shortcuts.some((s) => s.enabled) && !menu.hive.hireBanner.enabled) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hive", "shortcuts"], message: "Keep at least one Hive shortcut or the Hire banner on." });
  }
});

/** Never throws: a missing or malformed stored value falls back to the built-in names. */
export async function getHomeMenuSettings(): Promise<HomeMenuSettings> {
  try {
    const raw = await getSetting("home_menu_config");
    const parsed = JSON.parse(raw || "null");
    if (parsed && typeof parsed === "object") return resolveHomeMenu(parsed);
  } catch { /* Missing or malformed stored settings use the defaults. */ }
  return structuredClone(DEFAULT_HOME_MENU);
}
