export const SHOPPING_UNITS = {
  pcs: { label: "Pieces", short: "pcs", order: "pieces" },
  kg: { label: "Kilograms (kg)", short: "kg", order: "kg" },
  g: { label: "Grams (g)", short: "g", order: "g" },
  l: { label: "Litres (L)", short: "L", order: "L" },
  ml: { label: "Millilitres (ml)", short: "ml", order: "ml" },
  m: { label: "Metres (m)", short: "m", order: "m" },
  bunch: { label: "Bunches", short: "bunch", order: "bunch" },
  cluster: { label: "Clusters", short: "cluster", order: "cluster" },
  bundle: { label: "Bundles", short: "bundle", order: "bundle" },
  bag: { label: "Bags", short: "bag", order: "bag" },
  box: { label: "Boxes", short: "box", order: "box" },
  packet: { label: "Packets", short: "packet", order: "packet" },
  pair: { label: "Pairs", short: "pair", order: "pair" },
  set: { label: "Sets", short: "set", order: "set" },
  roll: { label: "Rolls", short: "roll", order: "roll" },
  sack: { label: "Sacks", short: "sack", order: "sack" },
  basket: { label: "Baskets", short: "basket", order: "basket" },
  heap: { label: "Heaps", short: "heap", order: "heap" },
  budget: { label: "Buy by amount", short: "UGX", order: "budget" },
} as const;
export type ShoppingStandardUnit = keyof typeof SHOPPING_UNITS;
export type ShoppingUnit = ShoppingStandardUnit | "other";
export const SHOPPING_UNIT_IDS = Object.keys(SHOPPING_UNITS) as ShoppingStandardUnit[];
export type ShoppingUnitRule = { keywords: string[]; units: ShoppingStandardUnit[]; priority: number };
export type ShoppingUnitSettings = {
  enabled: boolean;
  autoSelect: boolean;
  allowCustom: boolean;
  allowBudget: boolean;
  suggestedCount: number;
  minimumPrefixLength: number;
  customUnitMaxLength: number;
  fallbackUnits: ShoppingStandardUnit[];
  rules: ShoppingUnitRule[];
};
const rule = (keywords: string, units: ShoppingStandardUnit[], priority = 0): ShoppingUnitRule => ({ keywords: keywords.split(","), units, priority });
export const DEFAULT_SHOPPING_UNIT_SETTINGS: ShoppingUnitSettings = {
  enabled: true, autoSelect: true, allowCustom: true, allowBudget: true,
  suggestedCount: 3, minimumPrefixLength: 3, customUnitMaxLength: 40,
  fallbackUnits: ["pcs", "kg", "l"],
  rules: [
    rule("matooke,matoke,amatooke", ["bunch", "cluster", "kg"]),
    rule("rice,beans,flour,matooke flour,banana flour,sugar,maize,posho,groundnuts,peas,lentils,omuceere,obuwunga", ["kg", "bag", "packet"]),
    rule("milk,water,juice,oil,paint,petrol,diesel,amata,amazi", ["l", "ml", "packet"]),
    rule("greens,spinach,sukuma wiki,dodo,nakati", ["bundle", "kg", "pcs"]),
    rule("tomatoes,onions,potatoes,carrots,oranges,apples,bananas", ["kg", "pcs", "bag"]),
    rule("eggs,eggi,amagi", ["pcs", "box", "packet"]),
    rule("charcoal,amakala", ["sack", "bag", "kg"]),
    rule("shoes,socks,gloves,slippers,sandals,engatto", ["pair", "pcs", "set"]),
    rule("nails,screws,bolts", ["packet", "kg", "box"]),
    rule("fabric,cloth,wire,cable,rope,timber", ["m", "roll", "pcs"]),
    rule("cement,sand,gravel", ["bag", "sack", "kg"]),
    rule("soap,bread,chairs,plates,cups,books", ["pcs", "packet", "box"]),
    rule("matooke chips,banana chips,biscuits,cookies,crisps", ["packet", "box", "pcs"]),
    rule("worth,buy for,for ugx", ["budget"], 20),
    rule("bag,bags", ["bag", "kg", "pcs"], 10),
    rule("box,boxes", ["box", "pcs", "packet"], 10),
    rule("packet,packets,pack,packs", ["packet", "pcs", "kg"], 10),
    rule("pair,pairs", ["pair", "pcs", "set"], 10),
    rule("set,sets", ["set", "pcs", "pair"], 10),
    rule("roll,rolls", ["roll", "m", "pcs"], 10),
    rule("sack,sacks", ["sack", "bag", "kg"], 10),
    rule("bunch,bunches", ["bunch", "cluster", "pcs"], 10),
    rule("bundle,bundles", ["bundle", "pcs", "kg"], 10),
    rule("kg,kilo,kilos,kilogram,kilograms", ["kg", "g", "bag"], 10),
    rule("litre,litres,liter,liters", ["l", "ml", "packet"], 10),
    rule("metre,metres,meter,meters", ["m", "roll", "pcs"], 10),
  ],
};
function normalize(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim();
}
/** Ordered phrase/word matching with safe last-word prefixes, never substrings
 * inside unrelated words. Matching happens locally; rules are admin-managed. */
export function suggestShoppingUnits(name: string, config: ShoppingUnitSettings): ShoppingStandardUnit[] {
  const text = normalize(name);
  const lastWord = text.split(" ").at(-1) ?? "";
  const matches = config.enabled ? config.rules.map((entry, index) => {
    const specificity = Math.max(0, ...entry.keywords.map((word) => {
      const keyword = normalize(word);
      if (!keyword) return 0;
      if (` ${text} `.includes(` ${keyword} `)) return keyword.length + 100;
      if (lastWord.length >= config.minimumPrefixLength && !keyword.includes(" ") && keyword.startsWith(lastWord)) return lastWord.length;
      return 0;
    }));
    return { entry, index, score: specificity ? entry.priority * 1000 + specificity : 0 };
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index) : [];
  const candidates = [...matches.flatMap(({ entry }) => entry.units), ...config.fallbackUnits];
  const unique = [...new Set(candidates)].filter((unit) => config.allowBudget || unit !== "budget");
  return unique.slice(0, config.suggestedCount);
}
export type ShoppingEntry = { name: string; quantity: string; unitCost: string; unit: ShoppingUnit; customUnit?: string; unitSource?: "auto" | "manual" };
export function shoppingNamePatch(item: ShoppingEntry, name: string, config: ShoppingUnitSettings): Partial<ShoppingEntry> {
  if (!config.enabled || !config.autoSelect || item.unitSource === "manual") return { name };
  const unit = suggestShoppingUnits(name, config)[0] ?? "pcs";
  const changedMode = (item.unit === "budget") !== (unit === "budget");
  return { name, unit, customUnit: "", ...(unit !== item.unit ? { unitCost: "" } : {}), ...(changedMode ? { quantity: "1" } : {}) };
}
export function shoppingItemTotal(item: ShoppingEntry): number {
  return (Number(item.unitCost) || 0) * (item.unit === "budget" ? 1 : Number(item.quantity) || 0);
}
export function serializeShoppingItem(item: ShoppingEntry) {
  const name = item.name.trim();
  const unitCost = Number(item.unitCost) || 0;
  if (item.unit === "budget") {
    if (!(unitCost > 0)) throw new Error("Enter an amount to spend.");
    return { name: `${name} (buy for UGX ${unitCost.toLocaleString("en-UG")})`, quantity: 1, unitCost };
  }
  const label = item.unit === "other" ? item.customUnit?.trim() : SHOPPING_UNITS[item.unit].order;
  if (!label) throw new Error("Enter a custom buying unit.");
  return { name: item.unit === "pcs" ? name : `${name} (${label || "unit"})`, quantity: Math.max(1, Number(item.quantity) || 1), unitCost };
}
