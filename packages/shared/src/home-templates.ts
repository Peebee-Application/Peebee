/** The ten approved home layouts. IDs match the customer's design shortlist. */
export const HOME_TEMPLATES = [
  { id: "04", name: "The Day Ticket", title: "A little help. A better day." },
  { id: "07", name: "The Open Book", title: "What’s the plan today?" },
  { id: "08", name: "The City Line", title: "Your day. Connected." },
  { id: "09", name: "The Cut-Paper Poster", title: "Make room for your day." },
  { id: "11", name: "The Pinboard", title: "What needs doing today?" },
  { id: "12", name: "The Folded Index", title: "A simpler kind of day." },
  { id: "16", name: "The Daily Diary", title: "Make today a little easier." },
  { id: "17", name: "The Errands Clipboard", title: "Let’s get it sorted." },
  { id: "18", name: "The Desk Sorter", title: "A place for every little errand." },
  { id: "20", name: "The Address Book", title: "Keep the everyday close at hand." },
] as const;
export const HOME_TEMPLATE_IDS = ["04", "07", "08", "09", "11", "12", "16", "17", "18", "20"] as const;
export type HomeTemplateId = (typeof HOME_TEMPLATE_IDS)[number];

export type HomeShortcut = {
  id: string; label: string; description: string; href: string; module: string;
  icon: "bike" | "car" | "people" | "truck" | "parcel" | "bus" | "crown" | "ambulance" | "list" | "basket" | "store" | "pill" | "food" | "chef" | "bread" | "juice" | "clean" | "laundry" | "fix" | "worker" | "hire" | "book" | "live" | "tv" | "award" | "chat" | "spotlight";
  availability?: "luxury" | "ambulance" | "taxipress" | "hire" | "workers";
  hiveShortcut?: "clean" | "laundry" | "fix" | "workers" | "hire";
};

/** Customer destinations, not back-office feature switches without a customer screen. */
export const HOME_SHORTCUTS = [
  { id: "boda", label: "Boda", description: "Book a motorbike ride", href: "/ride/boda", module: "ride.boda", icon: "bike" },
  { id: "car", label: "Car", description: "Book a car ride", href: "/ride/car", module: "ride.car", icon: "car" },
  { id: "carpool", label: "Rideshare", description: "Share a trip", href: "/carpool", module: "ride.car.carpool", icon: "people" },
  { id: "selfdrive", label: "Selfdrive", description: "Rent a car", href: "/rent", module: "ride.car.selfdrive", icon: "car" },
  { id: "move", label: "Move", description: "Move a larger load", href: "/ride/move", module: "ride.move", icon: "truck" },
  { id: "parcel", label: "Parcel", description: "Send something", href: "/deliver/parcel", module: "deliver.parcel", icon: "parcel" },
  { id: "taxipress", label: "Taxipress", description: "Find a shared taxi", href: "/ride/taxipress", module: "ride.taxipress", icon: "bus", availability: "taxipress" },
  { id: "luxury", label: "VIP", description: "Book a luxury ride", href: "/ride/luxury", module: "ride.luxury", icon: "crown", availability: "luxury" },
  { id: "ambulance", label: "Ambulance", description: "Patient transport", href: "/ride/ambulance", module: "ride.ambulance", icon: "ambulance", availability: "ambulance" },
  { id: "shopping", label: "Shopping list", description: "Write your list", href: "/shoplist", module: "buy.shopping", icon: "list" },
  { id: "groceries", label: "Groceries", description: "Shop the essentials", href: "/groceries", module: "buy.shopping", icon: "basket" },
  { id: "stores", label: "Stores", description: "Browse local stores", href: "/stores", module: "buy.marketplace", icon: "store" },
  { id: "pharmacy", label: "Pharmacy", description: "Find medicine", href: "/pharmacy", module: "buy.pharmacy", icon: "pill" },
  { id: "restaurants", label: "Restaurants", description: "Find a meal", href: "/restaurants", module: "buy.food", icon: "food" },
  { id: "kitchens", label: "Kitchens", description: "Discover local cooking", href: "/kitchens", module: "buy.food", icon: "food" },
  { id: "streetfood", label: "Streetfood", description: "Food from nearby cooks", href: "/streetfood", module: "buy.food", icon: "chef" },
  { id: "juices", label: "Juices", description: "Something refreshing", href: "/juices", module: "buy.food", icon: "juice" },
  { id: "bakeries", label: "Bakeries", description: "Bread, cakes and pastries", href: "/bakeries", module: "buy.food", icon: "bread" },
  { id: "clean", label: "Clean", description: "Get help with cleaning", href: "/services/clean", module: "hive.work", icon: "clean", hiveShortcut: "clean" },
  { id: "laundry", label: "Laundry", description: "Laundry pickup and care", href: "/services/laundry", module: "hive.work", icon: "laundry", hiveShortcut: "laundry" },
  { id: "fix", label: "Fix", description: "Repairs and servicing", href: "/services/fix", module: "hive.work", icon: "fix", hiveShortcut: "fix" },
  { id: "workers", label: "Workers", description: "Find help nearby", href: "/services/hire/workers?segment=informal", module: "hive.hire.search", icon: "worker", hiveShortcut: "workers", availability: "workers" },
  { id: "hire", label: "Hire", description: "Find people for a project", href: "/services/hire", module: "hive.hire", icon: "hire", hiveShortcut: "hire", availability: "hire" },
  { id: "learn", label: "Discover learning", description: "Find your next course", href: "/learn", module: "learn", icon: "book" },
  { id: "myclass", label: "My Class", description: "Continue your learning", href: "/learn/my", module: "learn", icon: "book" },
  { id: "liveclasses", label: "Live classes", description: "Join a class", href: "/learn/live", module: "learn.live", icon: "live" },
  { id: "tv", label: "TV Learn", description: "Learning on your TV", href: "/learn/tv", module: "learn.tv", icon: "tv" },
  { id: "certificates", label: "Certificates", description: "Your achievements", href: "/learn/certificates", module: "learn.certificates", icon: "award" },
  { id: "connect", label: "Connect", description: "Your learning community", href: "/learn/connect", module: "learn", icon: "chat" },
  { id: "spotlight", label: "Spotlight", description: "Discover what’s new", href: "/spotlight", module: "channels", icon: "spotlight" },
] as const satisfies readonly HomeShortcut[];
export type HomeShortcutId = (typeof HOME_SHORTCUTS)[number]["id"];
export const HOME_SHORTCUT_IDS = HOME_SHORTCUTS.map((s) => s.id) as [HomeShortcutId, ...HomeShortcutId[]];

/** Bounds protect timers and renderable layouts; all operating values below are editable in Admin. */
export const HOME_TEMPLATE_LIMITS = { minSeconds: 10, maxSeconds: 86400, maxShortcuts: 6, maxWeight: 20, maxInteractionSeconds: 120 } as const;
export type HomeTemplatesSettings = {
  enabled: boolean;
  templates: HomeTemplateId[];
  eligibleShortcuts: HomeShortcutId[];
  preferredShortcuts: HomeShortcutId[];
  preferredWeight: number;
  shortcutCount: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  interactionPauseSeconds: number;
  exploreTypeMs: number;
  exploreHoldSeconds: number;
};
export const DEFAULT_HOME_TEMPLATES: HomeTemplatesSettings = {
  enabled: true,
  templates: [...HOME_TEMPLATE_IDS],
  eligibleShortcuts: [...HOME_SHORTCUT_IDS],
  preferredShortcuts: [],
  preferredWeight: 3,
  shortcutCount: 4,
  minIntervalSeconds: 90,
  maxIntervalSeconds: 180,
  interactionPauseSeconds: 15,
  exploreTypeMs: 65,
  exploreHoldSeconds: 5,
};

/** Reject malformed persisted data as a whole; never make a broken timer or dead-end home. */
export function resolveHomeTemplates(value: unknown): HomeTemplatesSettings {
  const fallback = () => structuredClone(DEFAULT_HOME_TEMPLATES);
  if (!value || typeof value !== "object") return fallback();
  const v = value as Record<string, unknown>;
  const ids = <T extends string>(a: unknown, valid: readonly T[]): a is T[] => Array.isArray(a) && a.length > 0 && a.every((id) => valid.includes(id)) && new Set(a).size === a.length;
  const integer = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
  const limits = HOME_TEMPLATE_LIMITS;
  if (typeof v.enabled !== "boolean" || !ids(v.templates, HOME_TEMPLATE_IDS) || !ids(v.eligibleShortcuts, HOME_SHORTCUT_IDS)
    || !Array.isArray(v.preferredShortcuts) || !v.preferredShortcuts.every((id) => (v.eligibleShortcuts as unknown[]).includes(id))
    || new Set(v.preferredShortcuts).size !== v.preferredShortcuts.length
    || !integer(v.preferredWeight, 1, limits.maxWeight) || !integer(v.shortcutCount, 1, limits.maxShortcuts)
    || !integer(v.minIntervalSeconds, limits.minSeconds, limits.maxSeconds) || !integer(v.maxIntervalSeconds, limits.minSeconds, limits.maxSeconds)
    || v.minIntervalSeconds > v.maxIntervalSeconds || !integer(v.interactionPauseSeconds, 1, limits.maxInteractionSeconds)) return fallback();
  if (v.exploreTypeMs !== undefined && !integer(v.exploreTypeMs, 20, 300)) return fallback();
  if (v.exploreHoldSeconds !== undefined && !integer(v.exploreHoldSeconds, 2, 30)) return fallback();
  return structuredClone({ ...v, exploreTypeMs: v.exploreTypeMs ?? DEFAULT_HOME_TEMPLATES.exploreTypeMs,
    exploreHoldSeconds: v.exploreHoldSeconds ?? DEFAULT_HOME_TEMPLATES.exploreHoldSeconds }) as HomeTemplatesSettings;
}

export type HomeAvailability = {
  on: (module: string) => boolean;
  special: { luxury: boolean; ambulance: boolean };
  taxipress: boolean;
  hire: { hire: boolean; workers: boolean };
  hive: readonly { id: string; label: string; enabled: boolean }[];
};
export function availableHomeShortcuts(config: HomeTemplatesSettings, availability: HomeAvailability): HomeShortcut[] {
  const eligible = new Set<string>(config.eligibleShortcuts);
  return (HOME_SHORTCUTS as readonly HomeShortcut[]).filter((s) => {
    if (!eligible.has(s.id) || !availability.on(s.module)) return false;
    if (s.hiveShortcut && !availability.hive.some((h) => h.id === s.hiveShortcut && h.enabled)) return false;
    if (s.availability === "taxipress") return availability.taxipress;
    if (s.availability === "hire" || s.availability === "workers") return availability.hire[s.availability];
    if (s.availability) return availability.special[s.availability];
    return true;
  }).map((s) => ({ ...s, label: availability.hive.find((h) => h.id === s.hiveShortcut)?.label ?? s.label }));
}

const unit = (random: () => number) => Math.min(1 - Number.EPSILON, Math.max(0, random()));
export function randomHomeInterval(config: HomeTemplatesSettings, random = Math.random): number {
  return (config.minIntervalSeconds + Math.floor(unit(random) * (config.maxIntervalSeconds - config.minIntervalSeconds + 1))) * 1000;
}
export function nextHomeTemplate(ids: readonly HomeTemplateId[], previous?: HomeTemplateId, random = Math.random): HomeTemplateId {
  const alternatives = ids.filter((id) => id !== previous);
  const pool = alternatives.length ? alternatives : ids;
  return pool[Math.floor(unit(random) * pool.length)] ?? HOME_TEMPLATE_IDS[0];
}

/** Weighted sampling without replacement: preferred entries appear more often, never twice in one screen. */
export function pickHomeShortcuts<T extends { id: string }>(available: readonly T[], config: HomeTemplatesSettings, random = Math.random): T[] {
  const pool = [...available];
  const preferred = new Set<string>(config.preferredShortcuts);
  const chosen: T[] = [];
  while (pool.length && chosen.length < config.shortcutCount) {
    const weight = (entry: T) => preferred.has(entry.id) ? config.preferredWeight : 1;
    let target = unit(random) * pool.reduce((sum, entry) => sum + weight(entry), 0);
    let index = 0;
    for (; index < pool.length - 1; index++) { target -= weight(pool[index]!); if (target < 0) break; }
    chosen.push(pool.splice(index, 1)[0]!);
  }
  return chosen;
}
