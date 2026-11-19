import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getOption } from "../lib/option-settings.js";
import { hasColumn } from "../lib/schema.js";
import { getMarketplaceSettings, getPlatformEnvironment } from "../lib/settings.js";

export type NewStore = {
  name: string;
  category: "groceries" | "stores";
  sub_category?: string;
  description?: string;
  announcement?: string;
  phone?: string;
  whatsapp_number?: string;
  address?: string;
  min_order_amount?: number;
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-");
}

export type StoreChannels = {
  /** 'active' publishes the store; 'draft' keeps it hidden until it is published. */
  status?: "active" | "draft";
  listedInApp?: boolean;
  webStoreEnabled?: boolean;
};

export type CreatedStore = { ok: true; storeId: string; slug: string; trialExpiresAt: string } | { ok: false; error: "reserved_name"; message: string };

/**
 * The one place a store row is made, used by the merchant app and by the sign-up website, so both give the same store:
 * a reserved name is refused, the address is the name plus a short id, and a Pro Live trial starts.
 */
export async function createStoreForMerchant(merchantId: string, input: NewStore, channels: StoreChannels = {}): Promise<CreatedStore> {
  const storeId = newId("store");
  const baseSlug = slugify(input.name);
  const reservedNames = await getOption<string[]>("storefront_reserved_subdomains");
  const compactSlug = baseSlug.replace(/-/g, "");
  if (reservedNames.some((r) => r === baseSlug || r.replace(/-/g, "") === compactSlug)) {
    return { ok: false, error: "reserved_name", message: "That store name can't be used because it could be mistaken for a Peebee page. Please choose another name." };
  }
  const slug = `${baseSlug}-${storeId.slice(-4)}`;
  const environment = await getPlatformEnvironment();
  const settings = await getMarketplaceSettings();
  // Automatic Pro Live trial so sellers experience live selling immediately.
  const trialExpiresAt = new Date(Date.now() + settings.proTrialDays * 86400000).toISOString();

  await db.execute({
    sql: `INSERT INTO stores (
      id, merchant_id, name, slug, category, sub_category, description,
      announcement, phone, whatsapp_number, address, min_order_amount,
      pro_tier, pro_expires_at, status, environment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      storeId, merchantId, input.name, slug, input.category, input.sub_category || "general", input.description || "",
      input.announcement || "Welcome to our store! Shop online for fast delivery.", input.phone || "", input.whatsapp_number || "",
      input.address || "", input.min_order_amount || settings.minOrderAmountUgx, settings.proTrialDays > 0 ? "pro_live" : "free", settings.proTrialDays > 0 ? trialExpiresAt : null,
      channels.status ?? "active", environment,
    ],
  });
  if (channels.listedInApp !== undefined && (await hasColumn("stores", "listed_in_app"))) {
    await db.execute({ sql: "UPDATE stores SET listed_in_app = ? WHERE id = ?", args: [channels.listedInApp ? 1 : 0, storeId] });
  }
  if (channels.webStoreEnabled !== undefined && (await hasColumn("stores", "web_store_enabled"))) {
    await db.execute({ sql: "UPDATE stores SET web_store_enabled = ? WHERE id = ?", args: [channels.webStoreEnabled ? 1 : 0, storeId] });
  }
  return { ok: true, storeId, slug, trialExpiresAt };
}
