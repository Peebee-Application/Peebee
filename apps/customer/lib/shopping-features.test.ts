import assert from "node:assert/strict";
import test from "node:test";
import { resolveShoppingFeatures } from "@peebee/shared";

test("shopping features stay off and drop blank slides", () => {
  const features = resolveShoppingFeatures({
    heroEnabled: true,
    heroSlides: [
      { id: "", title: "  ", subtitle: "", href: "https://evil.example", imageUrl: "" },
      { id: "milk", title: "Fresh milk", subtitle: "Today", href: "/groceries", imageUrl: "/products/farm-fresh-milk.jpg" },
    ],
  });
  assert.equal(features.cameraSearchEnabled, false);
  assert.equal(features.memberBadgeEnabled, false);
  assert.equal(features.heroSlides.length, 1);
  assert.equal(features.heroSlides[0]?.href, "/groceries");
  assert.equal(resolveShoppingFeatures({ membershipBannerHref: "https://evil.example" }).membershipBannerHref, "/account");
});
