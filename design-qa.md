# Food storefront design QA

Final result: pass

Compared the two user-supplied references with rendered mobile screenshots in the same comparison input on 2026-10-06. The references are inspiration rather than an exact screenshot clone: the requested edge-to-edge cover, owner colours, two dish rails, full-page details, accordion and persistent order bar supersede the old screenshot. Existing Peebee typography, colour tokens and navigation are retained.

## Evidence

Local browser viewport override: 390 × 844 CSS pixels; browser screenshots returned at approximately 374 × 812 pixels. No device frame was added. The reference photos contain phone chrome and multiple mockups; comparisons use their content regions, not pixel-level alignment.

- [Cover](docs/qa/food-storefront/food-storefront-cover.png): first menu image used when cover is absent, square edges, bottom fade, back left and independent logo right.
- [Dish rails](docs/qa/food-storefront/food-featured-dishes.png): featured first, main dishes second, 3:4 cards, truncated titles, rating/price bottom and order count top right.
- [Dish detail](docs/qa/food-storefront/food-dish-detail.png): full-screen image, overlapping glass panel, accordion, required options and persistent bottom action.
- [Scrolled detail](docs/qa/food-storefront/food-dish-scrolled.png): reviews and recommendations, fixed back and price/order bar, main navigation absent.

All screenshots use isolated fictional preview data and existing demo food photos. The business logo shown is a fixture; it is not a real business upload. No production customers, reviews or orders were changed for QA. Temporary API fixtures and overrides were removed before commit.

## Comparison

No actionable P0/P1/P2 visual mismatch found in the captured screens.

- Typography: existing bold sans-serif hierarchy; cover/business and dish names readable. Reference samosa typeface is intentionally not imported into the production design system.
- Spacing/layout: full-width 9:16 cover; large portrait cards; partial next card indicates horizontal scrolling. Detail panel overlaps the image and leaves room for the fixed action. Phone controls remain reachable.
- Colours: existing ink/cream/gold and shared owner-selected Forest scene in screenshots; no new palette. The customer scene returns to Cove on leaving the business scope.
- Images: actual food photos remain sharp; first-menu fallback preserves a real image. Transparent business logos use contain sizing. Missing photos/logos have explicit icon placeholders.
- Content: real dish titles, UGX pricing, visible required options and empty/unavailable review states. No fabricated production ratings or order counts.
- Motion: dish rails gently enter from left to right on intersection; reduced-motion preferences disable animation.
- Interaction: expandable description, option and quantity price recalculation (large ×2 = UGX 48,000), saved review feedback, Add to order returns to menu with the cart retained. Reviews require an owned received order on the API.

Standard desktop scrollbars visible in the phone-sized browser evidence are a P3 polish detail; the final rail CSS hides the horizontal scrollbar without disabling scrolling. This does not affect hierarchy or functionality.

## Validation and deployment notes

- Full API suite: 165 passed, zero failed.
- Additional cover/logo separation and fallback integration checks passed.
- API and affected app TypeScript checks passed.
- Production builds and CI are checked during release.
- Manual migration: `apps/api/src/db/migrations/0080_food_storefront.sql`, applied to live D1 and all four new columns/table/indexes verified on 2026-10-06. Existing hot paths retain schema guards.
- Dish counts and review eligibility start with orders carrying the new menu-item identifier. Historical name-only order lines are not guessed or backfilled.
