/**
 * Every feature that calls an AI model, in one list. Adding a feature is three steps:
 *   1. add it here (id, label, description);
 *   2. add its on/off switch in apps/api/src/ai/features.ts (FEATURE_HOOKS);
 *   3. make its model call through `withFeatureKey("<id>", model, use)` (apps/api/src/ai/features.ts).
 * It then appears in Admin → AI features with its own on/off switch, and, when the admin separates the keys,
 * gets its own key pool (the admin is asked to add a key for it before the switch can be saved).
 */
export const AI_FEATURES = [
  {
    id: "translation",
    label: "Luganda translation and read-aloud",
    description: "Translates shopping lists into Luganda and reads them aloud (Admin → Luganda audio).",
  },
  {
    id: "support_chat",
    label: "Support chat assistant",
    description: "The AI that answers first in Help & support on the website and in every app (Admin → Support chat).",
  },
  { id: "learn_generation", label: "Learn course generation", description: "Shared personal, school and Merchant Elite AI course authoring." },
  { id: "learn_tutor", label: "Learn personal tutor", description: "Private tutoring grounded in authorized course content." },
] as const;

export type AiFeatureId = (typeof AI_FEATURES)[number]["id"];

export const isAiFeature = (value: unknown): value is AiFeatureId => AI_FEATURES.some((f) => f.id === value);
export const aiFeatureLabel = (id: string | null | undefined): string => AI_FEATURES.find((f) => f.id === id)?.label ?? "Shared keys";

/** "Name: key" or just "key", one per line, as pasted into the admin key boxes. */
export function parseKeyLines(text: string): Array<{ label?: string; key: string }> {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const named = /^(.{1,60}?)\s*:\s*(\S+)$/.exec(l);
    return named ? { label: named[1], key: named[2] } : { key: l };
  });
}

export type AiFeatureStatus = {
  id: AiFeatureId;
  label: string;
  description: string;
  enabled: boolean;
  /** The keys this feature would use right now: the shared pool, or its own when the keys are separated. */
  pool: "shared" | "own";
  /** Enabled keys in this feature's own pool, and how many can take a request now. */
  ownKeys: number;
  ownReady: number;
  /** In separate mode this feature cannot work until it has a key of its own. */
  needsKey: boolean;
  /** The keys it draws from right now (its own, or the shared ones), by the names the admin gave them. */
  keys?: Array<{ id: string; label: string; status: "ready" | "cooling" | "disabled" }>;
};

export type AiFeaturesOverview = {
  /** True when every feature has its own keys; false when one pool serves all of them. */
  separate: boolean;
  /** False until migration 0152_ai_key_features.sql is applied: separating is not available before then. */
  separateAvailable: boolean;
  sharedKeys: number;
  sharedReady: number;
  features: AiFeatureStatus[];
};
