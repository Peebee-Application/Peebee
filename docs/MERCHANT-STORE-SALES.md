# Merchant Store upgrade journey

The approved Store sales design uses three complete sliding hero cards, one mutually exclusive Pro/Elite detail panel, and an always-visible link to `/store/compare`. Pro focuses on its Peebee storefront and live selling. Elite presents its website tools, POS, stock, customers, Relay, digital products and courses. The comparison groups the complete offering and provides both upgrade paths.

The hero images represent a grocery, an electronics shop and a bakery. The electronics shopkeeper uses a smartphone, following the requested photo reference. Photography is illustrative AI-generated artwork; text, navigation, prices, buttons and controls are real HTML. WebP assets live under `apps/merchant/public/store-upgrade/`.

`GET /v1/merchants/me/store/plan-comparison` is read-only for active members of the selected merchant, including businesses without stores. It exposes no owner phone, receipts or payment state. Owner-only upgrade confirmation remains enforced by the existing checkout endpoints. Team members can explore both sales panels and the full comparison, then consult their owner through Team.

Prices, product limits, catalog/live/advertising switches, Elite availability and custom-domain notes come from current Admin configuration. The new `merchant_upgrade_carousel_autoplay` and `merchant_upgrade_carousel_seconds` settings appear in Admin Commerce options and use existing validation and activity logging. The carousel pauses for focus, hover and hidden tabs, supports manual arrows/dots/swipe, and respects reduced motion. Tabs support keyboard navigation. Comparison cells have accessible inclusion labels.

No migration, subscription rewrite or new payment flow is required. Website comparison rows describe Elite's managed website customization and page-building tools; the Peebee marketplace storefront remains governed by its existing catalog entitlement.
