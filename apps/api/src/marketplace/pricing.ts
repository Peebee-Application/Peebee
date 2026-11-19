import { db } from "../db/client.js";
import { findPublicStore } from "./public.js";
import { hasTable } from "../lib/schema.js";

type Row = Record<string, unknown>;

export type ClientCheckoutItem = {
  productId: string;
  storeId: string;
  title: string;
  price: number;
  quantity: number;
  variantId?: string;
  variantTitle?: string;
  imageUrl?: string;
};

export type PricingFailure = { ok: false; status: 400 | 409; error: string; message: string; productId: string };
export type PricingSuccess<T extends ClientCheckoutItem> = { ok: true; items: T[] };

/**
 * Structural rail: an order is priced from the catalogue, never from the request.
 * The client's `price`, `title`, `variantTitle` and `imageUrl` are replaced with what the store actually sells,
 * and a product that is unknown, inactive, in another store's catalogue or out of stock is refused.
 *
 * `demoCatalog` is the platform-owned demo catalogue (prices set by Peebee, not by a merchant), used only for the
 * demo store ids it lists.
 */
export async function priceCheckoutItems<T extends ClientCheckoutItem>(
  items: T[],
  demoCatalog: Record<string, Row[]>,
): Promise<PricingSuccess<T> | PricingFailure> {
  const haveTables = (await hasTable("store_products")) && (await hasTable("stores"));
  const priced: T[] = [];
  // Quantity already claimed per product/variant within this bag, so two lines can't both take the last unit.
  const claimed = new Map<string, number>();
  const sellableStores = new Map<string, boolean>();

  for (const item of items) {
    const fail = (status: 400 | 409, error: string, message: string): PricingFailure => ({ ok: false, status, error, message, productId: item.productId });

    let product: Row | null = null;
    let variants: Row[] = [];
    let fromDb = false;

    if (haveTables) {
      const res = await db.execute({
        sql: `SELECT p.* FROM store_products p JOIN stores s ON s.id = p.store_id
              WHERE p.id = ? AND p.store_id = ? AND p.status = 'active' AND s.status = 'active'`,
        args: [item.productId, item.storeId],
      });
      product = (res.rows[0] as Row | undefined) ?? null;
      if (product) {
        if (!sellableStores.has(item.storeId)) sellableStores.set(item.storeId, !!await findPublicStore(item.storeId));
        if (!sellableStores.get(item.storeId)) return fail(409, "store_unavailable", "This store is not accepting new online orders.");
        fromDb = true;
        const vRes = await db.execute({ sql: "SELECT * FROM store_product_variants WHERE product_id = ?", args: [item.productId] });
        variants = vRes.rows as Row[];
      }
    }
    if (!product) {
      const demo = (demoCatalog[item.storeId] ?? []).find((p) => p.id === item.productId);
      if (demo) {
        product = demo;
        variants = (demo.variants as Row[] | undefined) ?? [];
      }
    }
    if (!product) return fail(400, "unknown_product", "An item in your bag is no longer sold by this store.");

    let unitPrice = Number(product.price);
    let stock: number | null = product.track_inventory === 0 || product.track_inventory === false
      ? null
      : product.inventory_quantity != null ? Number(product.inventory_quantity) : null;
    let variantTitle: string | undefined;
    let stockKey = `p:${item.productId}`;

    if (item.variantId) {
      const variant = variants.find((v) => String(v.id) === item.variantId);
      if (!variant) return fail(400, "unknown_variant", "An option in your bag is no longer available.");
      unitPrice = Number(variant.price);
      variantTitle = String(variant.title);
      if (variant.inventory_quantity != null && stock !== null) stock = Number(variant.inventory_quantity);
      stockKey = `v:${item.variantId}`;
    } else if (variants.length > 0 && fromDb) {
      // A product with options must be bought as one of them.
      return fail(400, "variant_required", "Choose an option for this item.");
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) return fail(400, "unpriced_product", "This item cannot be ordered right now.");

    const already = claimed.get(stockKey) ?? 0;
    if (stock !== null && already + item.quantity > stock) {
      return fail(409, "out_of_stock", `Only ${Math.max(0, stock - already)} left of ${String(product.title)}.`);
    }
    claimed.set(stockKey, already + item.quantity);

    priced.push({
      ...item,
      title: String(product.title),
      price: Math.round(unitPrice),
      variantTitle,
      imageUrl: product.image_url ? String(product.image_url) : undefined,
    });
  }

  return { ok: true, items: priced };
}
