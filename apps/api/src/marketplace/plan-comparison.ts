import type { Context } from "hono";
import { db } from "../db/client.js";
import { getOptions } from "../lib/option-settings.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { planPrice } from "./plan-purchase.js";
import { storePlan } from "./plans.js";

/** Read-only plan discovery for every active team member, including businesses with no store yet.
 * Checkout, receipts and confirmation continue to use their existing owner-only endpoints. */
export async function merchantPlanComparison(c: Context) {
  const selected = c.req.header("X-Merchant-Id") ?? null;
  const member = (await db.execute({ sql: "SELECT merchant_id, role FROM merchant_members WHERE user_id=? AND status='active' AND (? IS NULL OR merchant_id=?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END LIMIT 1", args: [c.get("user").sub, selected, selected] })).rows[0];
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);
  const [settings, options, stores] = await Promise.all([
    getMarketplaceSettings(),
    getOptions(["merchant_plan_pro_features", "merchant_plan_elite_features", "merchant_upgrade_carousel_autoplay", "merchant_upgrade_carousel_seconds", "storefront_domain_mode"]),
    db.execute({ sql: "SELECT * FROM stores WHERE merchant_id=? LIMIT 1", args: [String(member.merchant_id)] }),
  ]);
  const current = stores.rows[0] ? (await storePlan(stores.rows[0], settings)).plan : "merchant";
  const pro = options.merchant_plan_pro_features as string[];
  const elite = options.merchant_plan_elite_features as string[];
  const row = (key: string, label: string, p: boolean | string, e: boolean | string, note?: string) => ({ key, label, pro: p, elite: e, ...(note ? { note } : {}) });
  const catalog = [pro.includes("catalog"), elite.includes("catalog")];
  return c.json({
    merchantId: String(member.merchant_id), current, canUpgrade: member.role === "owner", setupRequired: !stores.rows[0],
    carousel: { autoplay: options.merchant_upgrade_carousel_autoplay === true, seconds: Number(options.merchant_upgrade_carousel_seconds) },
    free: settings.proPricingMode === "free", liveEnabled: settings.liveEnabled,
    plans: {
      pro: { enabled: true, monthly: planPrice(settings, "pro_live", "monthly"), yearly: planPrice(settings, "pro_live", "yearly"), catalog: catalog[0], live: pro.includes("live") && settings.liveEnabled },
      elite: { enabled: settings.eliteEnabled, monthly: planPrice(settings, "elite", "monthly"), yearly: planPrice(settings, "elite", "yearly"), catalog: catalog[1], live: elite.includes("live") && settings.liveEnabled },
    },
    groups: [
      { title: "Sell online", rows: [row("storefront", "Product storefront in Peebee", catalog[0], catalog[1]), row("listings", "Product photos & listings", catalog[0], catalog[1]), row("live", "Live selling", pro.includes("live") && settings.liveEnabled, elite.includes("live") && settings.liveEnabled), row("products", "Product capacity", catalog[0] ? `${settings.proMaxProducts.toLocaleString("en-US")} items` : false, catalog[1] ? `${settings.eliteMaxProducts.toLocaleString("en-US")} items` : false), row("collections", "Product collections", catalog[0] ? String(settings.proMaxCollections) : false, catalog[1] ? String(settings.eliteMaxCollections) : false), row("promotions", "Promotion planning", pro.includes("ads"), elite.includes("ads"))] },
      { title: "Your own website", rows: [row("website", "E-commerce website & page builder", false, catalog[1]), row("themes", "Website themes & branding", false, catalog[1]), row("link", "Shareable website link", false, catalog[1]), row("domain", "Custom domain support", false, catalog[1], options.storefront_domain_mode === "subdomain_plus_verified_custom_domains" ? "Requires domain verification." : "Custom domains are not currently available; use your Peebee address.")] },
      { title: "Run your business", rows: [row("pos", "Point of sale (POS)", false, true), row("stock", "Stock & inventory", false, true), row("outlets", "Outlets & stock transfers", false, true), row("suppliers", "Suppliers & purchase orders", false, true), row("customers", "Customer management & loyalty", false, true), row("reports", "Sales & business reports", false, true), row("bundles", "Product bundles", false, catalog[1])] },
      { title: "Deliver & expand", rows: [row("relay", "Relay delivery", false, true, "Available on supported routes; delivery charges apply."), row("digital", "Digital products", false, true), row("courses", "Premium courses", false, true), row("wholesale", "Wholesale quotes", false, true), row("winback", "Customer win-back tools", false, true)] },
    ],
  });
}
