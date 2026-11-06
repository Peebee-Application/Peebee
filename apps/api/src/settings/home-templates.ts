import { z } from "zod";
import { DEFAULT_HOME_TEMPLATES, HOME_TEMPLATE_IDS, HOME_SHORTCUT_IDS, HOME_TEMPLATE_LIMITS, resolveHomeTemplates, type HomeTemplatesSettings } from "@peebee/shared";
import { getSetting } from "../lib/settings.js";

const limits = HOME_TEMPLATE_LIMITS;
const seconds = z.number().int().min(limits.minSeconds).max(limits.maxSeconds);
export const homeTemplatesSchema = z.object({
  enabled: z.boolean(),
  rotateOnReturn: z.boolean().default(DEFAULT_HOME_TEMPLATES.rotateOnReturn),
  templates: z.array(z.enum(HOME_TEMPLATE_IDS)).min(1).max(HOME_TEMPLATE_IDS.length),
  eligibleShortcuts: z.array(z.enum(HOME_SHORTCUT_IDS)).min(1).max(HOME_SHORTCUT_IDS.length),
  preferredShortcuts: z.array(z.enum(HOME_SHORTCUT_IDS)).max(HOME_SHORTCUT_IDS.length),
  preferredWeight: z.number().int().min(1).max(limits.maxWeight),
  shortcutCount: z.number().int().min(1).max(limits.maxShortcuts),
  minIntervalSeconds: seconds,
  maxIntervalSeconds: seconds,
  interactionPauseSeconds: z.number().int().min(1).max(limits.maxInteractionSeconds),
  exploreTypeMs: z.number().int().min(20).max(300).default(DEFAULT_HOME_TEMPLATES.exploreTypeMs),
  exploreHoldSeconds: z.number().int().min(2).max(30).default(DEFAULT_HOME_TEMPLATES.exploreHoldSeconds),
  exploreLines: z.array(z.object({ module: z.enum(["ride", "eat", "buy", "work", "learn"]), text: z.string().trim().min(1).max(120) })).min(1).max(30).default(DEFAULT_HOME_TEMPLATES.exploreLines),
}).superRefine((config, ctx) => {
  for (const key of ["templates", "eligibleShortcuts", "preferredShortcuts"] as const) {
    if (new Set(config[key]).size !== config[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Each item can appear only once." });
  }
  if (config.maxIntervalSeconds < config.minIntervalSeconds) ctx.addIssue({ code: "custom", path: ["maxIntervalSeconds"], message: "The maximum interval must be at least the minimum." });
  if (config.preferredShortcuts.some((id) => !config.eligibleShortcuts.includes(id))) ctx.addIssue({ code: "custom", path: ["preferredShortcuts"], message: "Most-used shortcuts must also be eligible." });
});

/** Existing settings table; no new columns and no migration dependency. */
export async function getHomeTemplatesSettings(): Promise<HomeTemplatesSettings> {
  try { return resolveHomeTemplates(JSON.parse((await getSetting("home_templates_config")) || "null")); }
  catch { return resolveHomeTemplates(null); }
}
