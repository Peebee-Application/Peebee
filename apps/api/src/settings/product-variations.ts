import { resolveProductVariations, type ProductVariationSettings } from "@peebee/shared";
import { z } from "zod";
import { getSetting, setSetting } from "../lib/settings.js";

export const productVariationsSchema = z.object({
  quickAddEnabled: z.boolean(),
  maxCardOptions: z.number().int().min(1).max(2),
  allowCustomOptions: z.boolean(),
  maxOptionsPerProduct: z.number().int().min(1).max(3),
  maxVariantsPerProduct: z.number().int().min(1).max(200),
  types: z.array(z.object({
    key: z.string().trim().max(30),
    name: z.string().trim().min(1).max(30),
    display: z.enum(["swatch", "chips", "dropdown"]),
    showOnBuyCard: z.boolean(),
    suggestedValues: z.array(z.string().trim().min(1).max(30)).max(30),
  })).max(12),
});

export async function getProductVariationSettings(): Promise<ProductVariationSettings> {
  try {
    return resolveProductVariations(JSON.parse(await getSetting("product_variations")));
  } catch {
    return resolveProductVariations(null);
  }
}

export async function setProductVariationSettings(next: ProductVariationSettings): Promise<void> {
  await setSetting("product_variations", JSON.stringify(resolveProductVariations(next)));
}
