/**
 * Product variations: options (Colour, Size, ...), their values, and the variants those combine into.
 *
 * Merchants build products from options the admin has agreed (or custom ones, if admin allows). Admin also chooses which
 * agreed options expand in place on Buy-home cards. Everything here is pure so the API, merchant app and customer app
 * agree on the same rules.
 */

export type VariationDisplay = "swatch" | "chips" | "dropdown";

/** An option kind the admin has agreed, e.g. Colour or Size. */
export type VariationType = {
  /** Normalised id, e.g. "color". */
  key: string;
  /** What shoppers and merchants see, e.g. "Colour". */
  name: string;
  display: VariationDisplay;
  /** Expands in place on Buy-home cards. */
  showOnBuyCard: boolean;
  /** Quick picks offered to merchants. Merchants may add their own values. */
  suggestedValues: string[];
};

export type ProductVariationSettings = {
  /** Master switch for the in-place expand on Buy-home cards. */
  quickAddEnabled: boolean;
  /** How many agreed options one card may expand (1 or 2). */
  maxCardOptions: number;
  /** Merchants may add options that are not on the agreed list. Those never expand on a Buy card. */
  allowCustomOptions: boolean;
  maxOptionsPerProduct: number;
  maxVariantsPerProduct: number;
  types: VariationType[];
};

export const DEFAULT_PRODUCT_VARIATIONS: ProductVariationSettings = {
  quickAddEnabled: true,
  maxCardOptions: 2,
  allowCustomOptions: true,
  maxOptionsPerProduct: 3,
  maxVariantsPerProduct: 100,
  types: [
    { key: "color", name: "Colour", display: "swatch", showOnBuyCard: true, suggestedValues: ["Black", "White", "Red", "Blue", "Green", "Yellow", "Brown", "Grey"] },
    { key: "size", name: "Size", display: "chips", showOnBuyCard: true, suggestedValues: ["XS", "S", "M", "L", "XL", "XXL"] },
    { key: "storage", name: "Storage", display: "chips", showOnBuyCard: false, suggestedValues: ["64GB", "128GB", "256GB", "512GB"] },
    { key: "material", name: "Material", display: "chips", showOnBuyCard: false, suggestedValues: ["Cotton", "Leather", "Plastic", "Metal"] },
    { key: "flavour", name: "Flavour", display: "chips", showOnBuyCard: false, suggestedValues: [] },
    { key: "pack", name: "Pack size", display: "chips", showOnBuyCard: false, suggestedValues: ["Single", "6 pack", "12 pack"] },
  ],
};

const SYNONYMS: Record<string, string> = {
  colour: "color", colours: "color", colors: "color", sizes: "size", "pack size": "pack", "pack-size": "pack", packs: "pack", flavor: "flavour", flavors: "flavour", flavours: "flavour",
};

/** "Colour", " colors " and "COLOR" are the same option. */
export function normaliseOptionKey(name: string): string {
  const key = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return SYNONYMS[key] ?? key;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Fills gaps and drops malformed types, so a partial save cannot leave Buy cards or the merchant editor broken. */
export function resolveProductVariations(stored: Partial<ProductVariationSettings> | null | undefined): ProductVariationSettings {
  const base = { ...DEFAULT_PRODUCT_VARIATIONS, ...(stored ?? {}) };
  const seen = new Set<string>();
  const incoming = Array.isArray(stored?.types) ? stored.types : DEFAULT_PRODUCT_VARIATIONS.types;
  const types: VariationType[] = [];
  for (const raw of incoming.slice(0, 12)) {
    const name = text(raw?.name, 30);
    if (!name) continue;
    const key = normaliseOptionKey(text(raw?.key, 30) || name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const values = Array.isArray(raw?.suggestedValues) ? raw.suggestedValues : [];
    const suggestedValues: string[] = [];
    for (const value of values) {
      const v = text(value, 30);
      if (v && !suggestedValues.some((x) => x.toLowerCase() === v.toLowerCase())) suggestedValues.push(v);
      if (suggestedValues.length >= 30) break;
    }
    types.push({
      key,
      name,
      display: raw?.display === "swatch" || raw?.display === "dropdown" ? raw.display : "chips",
      showOnBuyCard: raw?.showOnBuyCard === true,
      suggestedValues,
    });
  }
  return {
    quickAddEnabled: base.quickAddEnabled !== false,
    maxCardOptions: int(base.maxCardOptions, 1, 2, 2),
    allowCustomOptions: base.allowCustomOptions !== false,
    maxOptionsPerProduct: int(base.maxOptionsPerProduct, 1, 3, 3),
    maxVariantsPerProduct: int(base.maxVariantsPerProduct, 1, 200, 100),
    types,
  };
}

export type ProductOptionValue = { value: string; /** "#rrggbb" for colour swatches. */ hex?: string; imageUrl?: string };

export type ProductOption = {
  key: string;
  name: string;
  display: VariationDisplay;
  /** True only for agreed options the admin allows on cards. */
  showOnBuyCard: boolean;
  values: ProductOptionValue[];
};

/** Option columns as stored on a variant row (up to three). */
export type VariantLike = {
  id?: string;
  title?: string | null;
  option1_name?: string | null; option1_value?: string | null;
  option2_name?: string | null; option2_value?: string | null;
  option3_name?: string | null; option3_value?: string | null;
  price?: number;
  compare_at_price?: number | null;
  inventory_quantity?: number | null;
  image_url?: string | null;
  sku?: string | null;
};

export type OptionPair = { name: string; key: string; value: string };

export function variantPairs(variant: VariantLike): OptionPair[] {
  const out: OptionPair[] = [];
  const slots: Array<[string | null | undefined, string | null | undefined]> = [
    [variant.option1_name, variant.option1_value],
    [variant.option2_name, variant.option2_value],
    [variant.option3_name, variant.option3_value],
  ];
  for (const [name, value] of slots) {
    const n = text(name, 30);
    const v = text(value, 40);
    if (n && v) out.push({ name: n, key: normaliseOptionKey(n), value: v });
  }
  return out;
}

const COLOR_HEX: Record<string, string> = {
  black: "#111111", white: "#ffffff", red: "#d92d20", blue: "#2563eb", green: "#16a34a", yellow: "#facc15", orange: "#f97316",
  purple: "#7c3aed", pink: "#ec4899", brown: "#7c4a2d", grey: "#6b7280", gray: "#6b7280", beige: "#d6c3a1", navy: "#1e3a8a",
  teal: "#0d9488", gold: "#c9a227", silver: "#c0c0c0", cream: "#f5efe0", maroon: "#7f1d1d", khaki: "#b5a642", tan: "#c19a6b",
};

export function colorHex(value: string): string | undefined {
  const v = String(value ?? "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
  return COLOR_HEX[v.toLowerCase()];
}

/** Stored per-option metadata (swatch colours, images, chosen display), keyed by normalised option key. */
export type StoredOptionMeta = Record<string, { display?: VariationDisplay; values?: Record<string, { hex?: string; imageUrl?: string }> }>;

export function parseOptionMeta(raw: unknown): StoredOptionMeta {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredOptionMeta) : {};
  } catch {
    return {};
  }
}

/** Builds the option list a shopper sees from the variant rows, so products made before options existed still work. */
export function deriveProductOptions(variants: VariantLike[], settings: ProductVariationSettings, meta: StoredOptionMeta = {}): ProductOption[] {
  const order: string[] = [];
  const byKey = new Map<string, ProductOption>();
  for (const variant of variants) {
    for (const pair of variantPairs(variant)) {
      let option = byKey.get(pair.key);
      if (!option) {
        const type = settings.types.find((t) => t.key === pair.key);
        const stored = meta[pair.key];
        option = {
          key: pair.key,
          name: type?.name ?? pair.name,
          display: stored?.display ?? type?.display ?? (pair.key === "color" ? "swatch" : "chips"),
          showOnBuyCard: type?.showOnBuyCard === true,
          values: [],
        };
        byKey.set(pair.key, option);
        order.push(pair.key);
      }
      if (!option.values.some((v) => v.value.toLowerCase() === pair.value.toLowerCase())) {
        const stored = meta[pair.key]?.values?.[pair.value];
        const value: ProductOptionValue = { value: pair.value };
        const hex = stored?.hex ?? (option.display === "swatch" ? colorHex(pair.value) : undefined);
        if (hex) value.hex = hex;
        if (stored?.imageUrl) value.imageUrl = stored.imageUrl;
        option.values.push(value);
      }
    }
  }
  return order.map((key) => byKey.get(key)!);
}

/** The options a Buy-home card expands: only agreed options the admin switched on, capped. Empty when the feature is off. */
export function cardOptions(options: ProductOption[], settings: ProductVariationSettings): ProductOption[] {
  if (!settings.quickAddEnabled) return [];
  return options.filter((o) => o.showOnBuyCard && o.values.length > 0).slice(0, settings.maxCardOptions);
}

export type Selection = Record<string, string>;

function pairsOf(variant: VariantLike): Selection {
  const out: Selection = {};
  for (const p of variantPairs(variant)) out[p.key] = p.value.toLowerCase();
  return out;
}

/** The variant that matches every chosen option, or null while the choice is incomplete. */
export function findVariant<T extends VariantLike>(variants: T[], options: ProductOption[], selection: Selection): T | null {
  if (options.some((o) => !selection[o.key])) return null;
  return variants.find((v) => {
    const have = pairsOf(v);
    return options.every((o) => have[o.key] === selection[o.key].toLowerCase());
  }) ?? null;
}

function inStock(variant: VariantLike, tracked: boolean): boolean {
  return !tracked || (variant.inventory_quantity ?? 1) > 0;
}

/** Whether choosing `value` for `optionKey` (keeping the rest of the selection) still leaves a purchasable variant. */
export function isValueAvailable(variants: VariantLike[], optionKey: string, value: string, selection: Selection, tracked = true): boolean {
  return variants.some((v) => {
    const have = pairsOf(v);
    if (have[optionKey] !== value.toLowerCase()) return false;
    if (!inStock(v, tracked)) return false;
    return Object.entries(selection).every(([k, val]) => k === optionKey || !val || have[k] === val.toLowerCase());
  });
}

/** Starts from the first purchasable variant so a card never opens on a sold-out combination. */
export function defaultSelection(variants: VariantLike[], options: ProductOption[], tracked = true): Selection {
  const first = variants.find((v) => inStock(v, tracked)) ?? variants[0];
  const have = first ? pairsOf(first) : {};
  const out: Selection = {};
  for (const o of options) {
    const match = o.values.find((v) => v.value.toLowerCase() === have[o.key]);
    if (match) out[o.key] = match.value;
  }
  return out;
}

/** Keeps the shopper's choices when they change one option, moving others only if the combination does not exist. */
export function selectValue(variants: VariantLike[], options: ProductOption[], selection: Selection, optionKey: string, value: string, tracked = true): Selection {
  const next: Selection = { ...selection, [optionKey]: value };
  if (findVariant(variants, options, next)) return next;
  const fit = variants.find((v) => pairsOf(v)[optionKey] === value.toLowerCase() && inStock(v, tracked)) ?? variants.find((v) => pairsOf(v)[optionKey] === value.toLowerCase());
  if (!fit) return next;
  const have = pairsOf(fit);
  const out: Selection = {};
  for (const o of options) {
    const match = o.values.find((v) => v.value.toLowerCase() === have[o.key]);
    out[o.key] = match?.value ?? next[o.key] ?? "";
  }
  return out;
}

/** "Black / M" */
export function variantTitleFor(values: string[]): string {
  return values.filter(Boolean).join(" / ");
}

export type OptionInput = { name: string; values: ProductOptionValue[]; display?: VariationDisplay };

export type VariantInput = {
  id?: string;
  title: string;
  /** Values in option order. */
  values: string[];
  price: number;
  compare_at_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  inventory_quantity: number;
  image_url?: string | null;
};

/** Cartesian product of the options. Rows that already exist (same values) keep their price, stock and SKU. */
export function buildVariantMatrix(
  options: OptionInput[],
  existing: VariantInput[],
  defaults: { price: number; inventory_quantity: number },
  max: number,
): { variants: VariantInput[]; truncated: boolean } {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (usable.length === 0) return { variants: [], truncated: false };
  let combos: string[][] = [[]];
  for (const option of usable) combos = combos.flatMap((combo) => option.values.map((v) => [...combo, v.value]));
  const keyOf = (values: string[]) => values.map((v) => v.toLowerCase()).join("\u0001");
  const known = new Map(existing.map((v) => [keyOf(v.values), v]));
  const truncated = combos.length > max;
  const variants = combos.slice(0, max).map((values) => {
    const prior = known.get(keyOf(values));
    return prior
      ? { ...prior, values, title: variantTitleFor(values) }
      : { title: variantTitleFor(values), values, price: defaults.price, inventory_quantity: defaults.inventory_quantity };
  });
  return { variants, truncated };
}

export type VariationIssue =
  | "too_many_options"
  | "too_many_variants"
  | "option_not_allowed"
  | "duplicate_option"
  | "duplicate_value"
  | "empty_option"
  | "variant_values_mismatch"
  | "duplicate_variant";

/** Structural validation used by the API and the merchant editor. Returns the first problem, or null. */
export function validateVariations(
  options: OptionInput[],
  variants: Pick<VariantInput, "values">[],
  settings: ProductVariationSettings,
): { issue: VariationIssue; detail?: string } | null {
  if (options.length > settings.maxOptionsPerProduct) return { issue: "too_many_options", detail: String(settings.maxOptionsPerProduct) };
  if (variants.length > settings.maxVariantsPerProduct) return { issue: "too_many_variants", detail: String(settings.maxVariantsPerProduct) };
  const keys = new Set<string>();
  for (const option of options) {
    const key = normaliseOptionKey(option.name);
    if (!key || option.values.length === 0) return { issue: "empty_option", detail: option.name };
    if (keys.has(key)) return { issue: "duplicate_option", detail: option.name };
    keys.add(key);
    if (!settings.allowCustomOptions && !settings.types.some((t) => t.key === key)) return { issue: "option_not_allowed", detail: option.name };
    const values = new Set<string>();
    for (const v of option.values) {
      const lower = v.value.trim().toLowerCase();
      if (values.has(lower)) return { issue: "duplicate_value", detail: `${option.name}: ${v.value}` };
      values.add(lower);
    }
  }
  const seen = new Set<string>();
  for (const variant of variants) {
    if (variant.values.length !== options.length) return { issue: "variant_values_mismatch" };
    // Variants with no options (plain "Small pack" style rows) are told apart by their title, not their values.
    if (options.length === 0) continue;
    const id = variant.values.map((v) => v.toLowerCase()).join("\u0001");
    if (seen.has(id)) return { issue: "duplicate_variant", detail: variant.values.join(" / ") };
    seen.add(id);
  }
  return null;
}
