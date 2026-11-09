import {
  deriveProductOptions,
  normaliseOptionKey,
  parseOptionMeta,
  validateVariations,
  variantPairs,
  type OptionInput,
  type ProductVariationSettings,
  type StoredOptionMeta,
} from "@peebee/shared";
import { z } from "zod";
import { executeBatch, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn } from "../lib/schema.js";
import { getProductVariationSettings } from "../settings/product-variations.js";

type Row = Record<string, unknown>;

const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

export const variationsSchema = z.object({
  options: z.array(z.object({
    name: z.string().trim().min(1).max(30),
    display: z.enum(["swatch", "chips", "dropdown"]).optional(),
    values: z.array(z.object({
      value: z.string().trim().min(1).max(40),
      hex: hex.optional(),
      imageUrl: z.string().trim().url().max(400).optional(),
    })).min(1).max(40),
  })).max(3).default([]),
  variants: z.array(z.object({
    id: z.string().max(60).optional(),
    values: z.array(z.string().trim().min(1).max(40)).max(3).default([]),
    title: z.string().trim().max(120).optional(),
    price: z.number().int().positive(),
    compare_at_price: z.number().int().positive().nullish(),
    sku: z.string().trim().max(40).nullish(),
    barcode: z.string().trim().max(40).nullish(),
    inventory_quantity: z.number().int().nonnegative().default(100),
    image_url: z.string().trim().url().max(400).or(z.literal("")).nullish(),
  })).max(200).default([]),
});

export type VariationsInput = z.infer<typeof variationsSchema>;

export class VariationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const MESSAGES: Record<string, (detail?: string) => string> = {
  too_many_options: (d) => `A product can have at most ${d} options.`,
  too_many_variants: (d) => `A product can have at most ${d} variants.`,
  option_not_allowed: (d) => `"${d}" is not one of the options Peebee allows. Pick one from the list.`,
  duplicate_option: (d) => `"${d}" is used twice.`,
  duplicate_value: (d) => `Duplicate value: ${d}.`,
  empty_option: (d) => `Add at least one value to "${d}".`,
  variant_values_mismatch: () => "Each variant needs one value for every option.",
  duplicate_variant: (d) => `Two variants are both "${d}".`,
};

/** Throws a VariationError with a merchant-readable message when the choices break the admin's rules. */
export function checkVariations(input: VariationsInput, settings: ProductVariationSettings): void {
  const options: OptionInput[] = input.options.map((o) => ({ name: o.name, display: o.display, values: o.values }));
  const problem = validateVariations(options, input.variants.map((v) => ({ values: v.values })), settings);
  if (problem) throw new VariationError(problem.issue, (MESSAGES[problem.issue] ?? (() => "Invalid variations."))(problem.detail));
}

/** Swatch colours, images and display choices live in options_json, keyed by normalised option name. */
export function optionMetaFor(input: VariationsInput): StoredOptionMeta {
  const meta: StoredOptionMeta = {};
  for (const option of input.options) {
    const values: Record<string, { hex?: string; imageUrl?: string }> = {};
    for (const v of option.values) if (v.hex || v.imageUrl) values[v.value] = { ...(v.hex ? { hex: v.hex.toLowerCase() } : {}), ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}) };
    meta[normaliseOptionKey(option.name)] = { ...(option.display ? { display: option.display } : {}), ...(Object.keys(values).length ? { values } : {}) };
  }
  return meta;
}

/**
 * Replaces a product's options and variants in one batch. Existing variants are matched by id so carts and orders that
 * point at them keep working; variants not in the request are removed.
 * Columns added by migration 0160 are used only when they exist; until then up to two options are stored.
 */
export async function writeProductVariations(productId: string, existingIds: string[], input: VariationsInput, settings: ProductVariationSettings): Promise<void> {
  checkVariations(input, settings);
  const hasOption3 = await hasColumn("store_product_variants", "option3_name");
  const hasBarcode = await hasColumn("store_product_variants", "barcode");
  const hasPosition = await hasColumn("store_product_variants", "position");
  const hasMeta = await hasColumn("store_products", "options_json");
  if (input.options.length > 2 && !hasOption3) {
    throw new VariationError("migration_pending", "A third option needs a database update that has not been applied yet. Use up to two options for now.");
  }

  const keep = new Set(input.variants.map((v) => v.id).filter((id): id is string => !!id && existingIds.includes(id)));
  const statements: DbStatement[] = [];
  for (const id of existingIds) if (!keep.has(id)) statements.push({ sql: "DELETE FROM store_product_variants WHERE id = ? AND product_id = ?", args: [id, productId] });

  input.variants.forEach((v, index) => {
    const slots = input.options.map((o, i) => ({ name: o.name, value: v.values[i] ?? "" }));
    const title = v.title || v.values.join(" / ") || "Default";
    const columns: Record<string, unknown> = {
      title,
      option1_name: slots[0]?.name ?? null, option1_value: slots[0]?.value ?? null,
      option2_name: slots[1]?.name ?? null, option2_value: slots[1]?.value ?? null,
      price: v.price,
      compare_at_price: v.compare_at_price ?? null,
      sku: v.sku || "",
      inventory_quantity: v.inventory_quantity,
      image_url: v.image_url || null,
    };
    if (hasOption3) { columns.option3_name = slots[2]?.name ?? null; columns.option3_value = slots[2]?.value ?? null; }
    if (hasBarcode) columns.barcode = v.barcode || "";
    if (hasPosition) columns.position = index;
    const names = Object.keys(columns);
    if (v.id && keep.has(v.id)) {
      statements.push({ sql: `UPDATE store_product_variants SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ? AND product_id = ?`, args: [...names.map((n) => columns[n]), v.id, productId] });
    } else {
      statements.push({ sql: `INSERT INTO store_product_variants (id, product_id, ${names.join(", ")}) VALUES (?, ?, ${names.map(() => "?").join(", ")})`, args: [newId("var"), productId, ...names.map((n) => columns[n])] });
    }
  });

  const productSets = ["has_variants = ?"];
  const productArgs: unknown[] = [input.variants.length > 0 ? 1 : 0];
  if (hasMeta) { productSets.push("options_json = ?"); productArgs.push(JSON.stringify(optionMetaFor(input))); }
  statements.push({ sql: `UPDATE store_products SET ${productSets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...productArgs, productId] });
  await executeBatch(statements);
}

/** Adds the shopper-facing `options` list (and each variant's values) to a product row. `publicView` hides internal fields. */
export function withOptions(product: Row, variants: Row[], settings: ProductVariationSettings, publicView = false): Row {
  const meta = parseOptionMeta(product.options_json);
  const options = deriveProductOptions(variants as never[], settings, meta);
  const { options_json: _meta, ...rest } = product;
  return {
    ...rest,
    variants: variants.map((v) => {
      const { barcode: _barcode, position: _position, ...open } = v;
      return { ...(publicView ? open : v), values: variantPairs(v as never).map((p) => p.value) };
    }),
    options,
  };
}

export { getProductVariationSettings };
