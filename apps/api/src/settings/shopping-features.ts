import { resolveShoppingFeatures, type ShoppingFeatureSettings } from "@peebee/shared";
import { z } from "zod";
import { getSetting, setSetting } from "../lib/settings.js";

const path = z.string().trim().max(200).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Use an in-app path starting with /.");

export const shoppingFeaturesSchema = z.object({
  cameraSearchEnabled: z.boolean(),
  memberBadgeEnabled: z.boolean(),
  memberBadgeLabel: z.string().trim().min(1).max(40),
  inStoreCodeEnabled: z.boolean(),
  membershipBannerEnabled: z.boolean(),
  membershipBannerTitle: z.string().trim().max(80),
  membershipBannerBody: z.string().trim().max(180),
  membershipBannerHref: path,
  heroEnabled: z.boolean(),
  heroSlides: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120),
    href: path,
    imageUrl: z.string().trim().max(400),
  })).max(6),
});

export async function getShoppingFeatureSettings(): Promise<ShoppingFeatureSettings> {
  try {
    return resolveShoppingFeatures(JSON.parse(await getSetting("shopping_features")));
  } catch {
    return resolveShoppingFeatures(null);
  }
}

export async function setShoppingFeatureSettings(next: ShoppingFeatureSettings): Promise<void> {
  await setSetting("shopping_features", JSON.stringify(resolveShoppingFeatures(next)));
}
