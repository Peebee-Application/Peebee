/** What the customer app's main menu calls things. Names, order and on/off are
 * admin settings so a name can be changed without a release; the built-in
 * defaults are only the starting point. */

export const HOME_CLUSTER_IDS = ["ride", "shopping", "food", "learn", "hive"] as const;
export type HomeClusterId = (typeof HOME_CLUSTER_IDS)[number];

/** The shortcuts inside Hive. Clean, Laundry and Fix are things Peebee delivers at a standard price.
 * "workers" is for quick odd jobs and "hire" for a project or longer contract; both find a person through Peebee Hire. */
export const HIVE_SHORTCUT_IDS = ["clean", "laundry", "fix", "workers", "hire"] as const;
export type HiveShortcutId = (typeof HIVE_SHORTCUT_IDS)[number];

export type HomeMenuSettings = {
  clusters: Record<HomeClusterId, { label: string }>;
  /** The bar at the top of the customer app. */
  header: { chatEnabled: boolean };
  navigation: { streamLabel: string; exploreLabel: string; spacesLabel: string; spacesEnabled: boolean; confirmPercent: number };
  hive: {
    eyebrow: string;
    description: string;
    /** A second name for the main button that swaps with the first one; empty keeps a single name. */
    altLabel: string;
    /** How long each name shows before the swap, in seconds. */
    labelSeconds: number;
    /** Order here is the order customers see. */
    shortcuts: { id: HiveShortcutId; label: string; enabled: boolean }[];
    /** The "Need a person instead?" section under the Hive services, which holds the Workers and Hire shortcuts. */
    hireBanner: { enabled: boolean; title: string; text: string };
  };
};

export const DEFAULT_HOME_MENU: HomeMenuSettings = {
  header: { chatEnabled: true },
  navigation: { streamLabel: "Stream", exploreLabel: "Explore", spacesLabel: "Spaces", spacesEnabled: true, confirmPercent: 85 },
  clusters: {
    ride: { label: "Ride" },
    shopping: { label: "Buy" },
    food: { label: "Eat" },
    learn: { label: "Learn" },
    hive: { label: "Work" },
  },
  hive: {
    eyebrow: "Peebee gets it done",
    altLabel: "",
    labelSeconds: 4,
    description: "Laundry, cleaning and repairs at a clear price. Tell us what you need and Peebee takes care of it.",
    shortcuts: [
      { id: "clean", label: "Clean", enabled: true },
      { id: "laundry", label: "Laundry", enabled: true },
      { id: "fix", label: "Fix", enabled: true },
      { id: "workers", label: "Work", enabled: true },
      { id: "hire", label: "Talent", enabled: true },
    ],
    hireBanner: {
      enabled: true,
      title: "Need a person instead?",
      text: "Get a worker for a quick odd job, or hire someone for a project or a longer contract.",
    },
  },
};

/** Fills any gap in a stored value with the defaults so a partial or old value never breaks the menu.
 * Hive shortcuts keep the admin's order; any shortcut missing from it is appended. */
export function resolveHomeMenu(stored: Partial<HomeMenuSettings> | null | undefined): HomeMenuSettings {
  const base = DEFAULT_HOME_MENU;
  const clusters = { ...base.clusters };
  for (const id of HOME_CLUSTER_IDS) {
    const label = stored?.clusters?.[id]?.label?.trim();
    if (label) clusters[id] = { label };
  }
  const seen = new Set<HiveShortcutId>();
  const shortcuts: HomeMenuSettings["hive"]["shortcuts"] = [];
  for (const item of stored?.hive?.shortcuts ?? []) {
    const fallback = base.hive.shortcuts.find((s) => s.id === item.id);
    if (!fallback || seen.has(item.id)) continue;
    seen.add(item.id);
    shortcuts.push({ id: item.id, label: item.label?.trim() || fallback.label, enabled: item.enabled !== false });
  }
  for (const fallback of base.hive.shortcuts) if (!seen.has(fallback.id)) shortcuts.push({ ...fallback });
  const banner = stored?.hive?.hireBanner;
  return {
    header: { chatEnabled: stored?.header?.chatEnabled ?? base.header.chatEnabled },
    navigation: {
      streamLabel: stored?.navigation?.streamLabel?.trim() || base.navigation.streamLabel,
      exploreLabel: stored?.navigation?.exploreLabel?.trim() || base.navigation.exploreLabel,
      spacesLabel: stored?.navigation?.spacesLabel?.trim() || base.navigation.spacesLabel,
      spacesEnabled: stored?.navigation?.spacesEnabled ?? base.navigation.spacesEnabled,
      confirmPercent: Number.isFinite(stored?.navigation?.confirmPercent) ? Math.max(60, Math.min(95, Math.round(stored!.navigation!.confirmPercent))) : base.navigation.confirmPercent,
    },
    clusters,
    hive: {
      eyebrow: stored?.hive?.eyebrow?.trim() || base.hive.eyebrow,
      description: stored?.hive?.description?.trim() || base.hive.description,
      // An empty alternate name is a choice (one fixed name), so only a missing value falls back.
      altLabel: typeof stored?.hive?.altLabel === "string" ? stored.hive.altLabel.trim().slice(0, 20) : base.hive.altLabel,
      labelSeconds: Number.isFinite(stored?.hive?.labelSeconds) ? Math.min(30, Math.max(2, Math.round(stored!.hive!.labelSeconds as number))) : base.hive.labelSeconds,
      shortcuts,
      hireBanner: {
        enabled: banner?.enabled ?? base.hive.hireBanner.enabled,
        title: banner?.title?.trim() || base.hive.hireBanner.title,
        text: banner?.text?.trim() || base.hive.hireBanner.text,
      },
    },
  };
}
