import { suggestShoppingUnits, type ShoppingStandardUnit, type ShoppingUnitSettings } from "@peebee/shared";

/** One line of the Buy home "What do you need today?" box, before it becomes a shopping-list item. */
export type ParsedListItem = {
  name: string;
  quantity: string;
  unit: ShoppingStandardUnit | "other";
  customUnit?: string;
  /** True when the quantity had no unit and one was guessed from the item name. */
  unitGuessed: boolean;
};

const UNIT_WORDS: Record<string, ShoppingStandardUnit | { other: string }> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", grams: "g", gram: "g",
  l: "l", ltr: "l", ltrs: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  ml: "ml",
  m: "m", metre: "m", metres: "m",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
  bunch: "bunch", bunches: "bunch", cluster: "cluster", bundle: "bundle", bundles: "bundle",
  bag: "bag", bags: "bag", box: "box", boxes: "box", packet: "packet", packets: "packet", pkt: "packet",
  pair: "pair", pairs: "pair", set: "set", roll: "roll", rolls: "roll", sack: "sack", sacks: "sack",
  basket: "basket", heap: "heap", heaps: "heap",
  tray: { other: "tray" }, trays: { other: "tray" }, crate: { other: "crate" }, dozen: { other: "dozen" },
  loaf: { other: "loaf" }, loaves: { other: "loaf" }, bottle: { other: "bottle" }, bottles: { other: "bottle" },
};
const NUMBER_WORDS: Record<string, string> = { a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", ten: "10", half: "0.5" };
const NUM = String.raw`(\d+(?:[.,]\d+)?|a|an|one|two|three|four|five|six|ten|half)`;

function unitOf(word: string | undefined): { unit: ShoppingStandardUnit | "other"; customUnit?: string } | null {
  if (!word) return null;
  const u = UNIT_WORDS[word.toLowerCase()];
  if (!u) return null;
  return typeof u === "string" ? { unit: u } : { unit: "other", customUnit: u.other };
}
const num = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? s.replace(",", ".");
const tidy = (s: string) => s.replace(/^(of|x)\s+/i, "").replace(/\s+/g, " ").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Turns one phrase ("2kg tomatoes", "tray of eggs", "basmati 5", "milk") into an item. */
export function parseListPhrase(raw: string, settings: ShoppingUnitSettings): ParsedListItem | null {
  const text = raw.trim().replace(/[.;]+$/, "");
  if (!text) return null;
  let quantity = "1";
  let unitInfo: ReturnType<typeof unitOf> = null;
  let name = text;
  let hadNumber = false;
  const lead = new RegExp(String.raw`^${NUM}?\s*([a-z]+)?\b\s*(?:of\s+)?(.+)$`, "i").exec(text);
  const trail = new RegExp(String.raw`^(.+?)\s+${NUM}\s*([a-z]+)?$`, "i").exec(text);
  const unitFirst = /^([a-z]+)\s+of\s+(.+)$/i.exec(text);
  if (lead && lead[1] && /^\d/.test(lead[1]) || (lead && lead[1] && lead[3] && (unitOf(lead[2]) || lead[2]))) {
    // "2kg tomatoes", "2 kg tomatoes", "a tray of eggs", "3 avocados"
    const u = unitOf(lead[2]);
    quantity = num(lead[1]!);
    hadNumber = true;
    unitInfo = u;
    name = u ? lead[3]! : `${lead[2] ?? ""} ${lead[3]}`;
  } else if (unitFirst && unitOf(unitFirst[1])) {
    // "tray of eggs"
    unitInfo = unitOf(unitFirst[1]);
    name = unitFirst[2]!;
  } else if (trail) {
    // "basmati 5", "tomatoes 2kg"
    quantity = num(trail[2]!);
    hadNumber = true;
    unitInfo = unitOf(trail[3]);
    name = unitInfo || !trail[3] ? trail[1]! : `${trail[1]} ${trail[3]}`;
  }
  name = tidy(name);
  if (!name) return null;
  let unitGuessed = false;
  if (!unitInfo) {
    const suggested = settings.enabled ? suggestShoppingUnits(name, settings)[0] : undefined;
    unitInfo = { unit: suggested && suggested !== "budget" ? suggested : "pcs" };
    unitGuessed = hadNumber && unitInfo.unit !== "pcs";
  }
  return { name: cap(name), quantity: Number(quantity) > 0 ? quantity : "1", unit: unitInfo.unit, customUnit: unitInfo.customUnit, unitGuessed };
}

/** Splits free text ("2kg tomatoes, tray of eggs and 1L milk") into items. */
export function parseListText(text: string, settings: ShoppingUnitSettings): ParsedListItem[] {
  return text
    .split(/[,\n;]+|\s+and\s+|\s+na\s+/i)
    .map((p) => parseListPhrase(p, settings))
    .filter((x): x is ParsedListItem => !!x)
    .slice(0, 30);
}

export function unitLabel(item: Pick<ParsedListItem, "quantity" | "unit" | "customUnit">): string {
  if (item.unit === "other") return `${item.quantity} ${item.customUnit ?? ""}`.trim();
  if (item.unit === "pcs") return item.quantity === "1" ? "1" : `${item.quantity} pcs`;
  const short: Record<string, string> = { l: "L" };
  return `${item.quantity} ${short[item.unit] ?? item.unit}`;
}

/** Best price match from loaded marketplace products, by whole-word name overlap. */
export function matchPrice(name: string, products: Array<{ title: string; price: number }>): number | null {
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(es|s)$/, ""));
  if (!words.length) return null;
  for (const p of products) {
    const t = p.title.toLowerCase();
    if (words.every((w) => t.includes(w)) && p.price > 0) return p.price;
  }
  return null;
}

/** In-Buy collections opened from section headers. Groceries, Stores and Pharma stay on the bottom nav. */
export const BUY_DEALS_HREF = "/shopping/deals";
export const BUY_NEARBY_HREF = "/shopping/nearby";

/** How far a downward pull must travel before it opens Spotlight.
 * A touch distance for this gesture, not a business limit. */
export const BUY_SPOTLIGHT_PULL_THRESHOLD = 96;
/** Cap so the reveal stays a peek instead of dragging the page away. */
export const BUY_SPOTLIGHT_PULL_MAX = 168;

/** `idle` at rest, `pulling` before the threshold, `commit` once it is met. */
export function spotlightPullDecision(distancePx: number): "idle" | "pulling" | "commit" {
  if (!(distancePx > 0)) return "idle";
  return distancePx >= BUY_SPOTLIGHT_PULL_THRESHOLD ? "commit" : "pulling";
}

/** Category names that loaded products actually have, in first-seen order. */
export function buyCategoryNames(products: Array<{ category_name?: string | null }>, limit = 12): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const product of products) {
    const name = product.category_name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

/** Live featured items first, then the rest, capped. Order is stable within a type. */
export function buyFeaturedSpots<T extends { type: string }>(spots: T[], limit = 5): T[] {
  return [...spots].sort((a, b) => Number(b.type === "live") - Number(a.type === "live")).slice(0, limit);
}

/** Customer-facing words for an active shopping order's stage. */
export function shoppingStageLabel(stage: string): string {
  const map: Record<string, string> = {
    pending: "Finding a shopper", matching: "Finding a shopper", searching: "Finding a shopper",
    matched: "Shopper on the way to the shop", assigned: "Shopper on the way to the shop", accepted: "Shopper on the way to the shop",
    shopping: "Shopping your list", at_store: "Shopping your list", purchasing: "Shopping your list",
    picked_up: "On the way to you", in_transit: "On the way to you", delivering: "On the way to you", en_route: "On the way to you",
    arrived: "Arrived", delivered: "Delivered",
  };
  return map[stage] ?? stage.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
