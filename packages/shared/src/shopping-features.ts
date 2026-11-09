/** Admin switches for shopping capabilities that do not have a live backend yet.
 * Every switch defaults off. Copy the admin types is real content; catalogue facts are not invented here. */
export type ShoppingHeroSlide = {
  id: string;
  title: string;
  subtitle: string;
  /** In-app path, starting with /. */
  href: string;
  imageUrl: string;
};

export type ShoppingFeatureSettings = {
  cameraSearchEnabled: boolean;
  memberBadgeEnabled: boolean;
  memberBadgeLabel: string;
  inStoreCodeEnabled: boolean;
  membershipBannerEnabled: boolean;
  membershipBannerTitle: string;
  membershipBannerBody: string;
  membershipBannerHref: string;
  heroEnabled: boolean;
  heroSlides: ShoppingHeroSlide[];
};

export const DEFAULT_SHOPPING_FEATURES: ShoppingFeatureSettings = {
  cameraSearchEnabled: false,
  memberBadgeEnabled: false,
  memberBadgeLabel: "Peebee member",
  inStoreCodeEnabled: false,
  membershipBannerEnabled: false,
  membershipBannerTitle: "",
  membershipBannerBody: "",
  membershipBannerHref: "/account",
  heroEnabled: false,
  heroSlides: [],
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function path(value: unknown, fallback: string): string {
  const next = text(value, 200);
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

/** Fills gaps and drops slides that have no title, so a partial save cannot render blank cards. */
export function resolveShoppingFeatures(stored: Partial<ShoppingFeatureSettings> | null | undefined): ShoppingFeatureSettings {
  const base = { ...DEFAULT_SHOPPING_FEATURES, ...(stored ?? {}) };
  const slides = Array.isArray(stored?.heroSlides) ? stored.heroSlides : [];
  return {
    cameraSearchEnabled: base.cameraSearchEnabled === true,
    memberBadgeEnabled: base.memberBadgeEnabled === true,
    memberBadgeLabel: text(base.memberBadgeLabel, 40) || DEFAULT_SHOPPING_FEATURES.memberBadgeLabel,
    inStoreCodeEnabled: base.inStoreCodeEnabled === true,
    membershipBannerEnabled: base.membershipBannerEnabled === true,
    membershipBannerTitle: text(base.membershipBannerTitle, 80),
    membershipBannerBody: text(base.membershipBannerBody, 180),
    membershipBannerHref: path(base.membershipBannerHref, "/account"),
    heroEnabled: base.heroEnabled === true,
    heroSlides: slides.slice(0, 6).flatMap((slide, index) => {
      const title = text(slide?.title, 80);
      if (!title) return [];
      return [{
        id: text(slide?.id, 40) || `slide-${index + 1}`,
        title,
        subtitle: text(slide?.subtitle, 120),
        href: path(slide?.href, "/shopping"),
        imageUrl: text(slide?.imageUrl, 400),
      }];
    }),
  };
}
