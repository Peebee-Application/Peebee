# Shopping and delivery source audit

Reviewed 10 November 2026 against product commit `4871a68f9e475728c7e45624d817a7f06968d671`. This is a source audit, not a live settings read, performance benchmark or end-to-end production test. The original pricing recommendation and dependent financial projections have been withdrawn following founder feedback.

## Customer ordering and checkout

- `apps/customer/app/orders/new/page.tsx` redirects to the home screen. The active list-creation UI is `apps/customer/components/home/ShoppingListModal.tsx`, not the retired standalone form.
- The modal supports a typed list and a recorded voice list. Typed lines carry item budgets or quantities and unit costs; the voice path requires a recording and a positive shopping total. The customer then selects a delivery location.
- `packages/shared/src/shopping-units.ts` supports pieces, kilograms, bunches, bundles, heaps, sacks, custom units and buying by UGX amount. A budget entry is serialized as one line with the specified amount, not multiplied by an arbitrary quantity. The service is designed for local shopping, including purchases defined by spending amount, not only supermarket catalogue orders.
- The modal fetches `shoppingDeliveryFee`, displays goods plus delivery and sends the goods estimate separately to `POST /orders`. The backend adds delivery once. The order initially uses the escrow rail; checkout can subsequently select another supported method.
- `apps/api/src/orders/routes.ts`, the shopping order-creation branch, uses the summed list prices when every line is priced; otherwise it uses the supplied shopping estimate. It adds `roundFare(shoppingDeliveryFee)` and stores that fee separately. That branch does not invoke the parcel distance-pricing engine.
- `GET /orders/:id/checkout` computes the selected payment quote. Mobile money and card use the non-wallet surcharge calculation; wallet omits the processing-fee calculation; cash quotes the order base amount. Offers can reduce the amount, and shared wallets exist in the customer checkout. Neither wallet funding nor offers should be assumed economically free.
- The default shopping delivery setting is UGX 3,000. Service-fee, delivery-commission and processing-fee defaults are disabled with zero values. Under those defaults, an unchanged UGX 60,000 goods estimate produces a UGX 63,000 quote. This excludes additional configured charges, offers, approved changes and live overrides. It is not a proposed new tariff or a claim about the live account.

## Rider assignment and distance

- `apps/api/src/orders/matching.ts` measures proximity to the pickup for a parcel or a known store/restaurant pickup; a free-form shopping list without a pickup uses the customer's destination. These are different matching anchors.
- The broadcast radius in that file is 1 km for the first 20 seconds, then 2 km, then 3 km, and then no staged-radius restriction after 60 seconds. These are current implementation constants, not a delivery-time promise or an Admin-configured service-area policy.
- `rider_visibility_range_km` defaults to 20 km, with a per-rider override and zero meaning no limit. `beyondRiderRange` still applies when broadcast has widened; a fully open broadcast does not necessarily mean every rider can claim the job.
- `service_range_km` defaults to 7 km. The rider and order routes use it to mark `outOfServiceRange` and record an out-of-range match. It must not be presented as a universal hard customer delivery boundary.
- Enabled matching modes default to `first_to_claim` and `customer_selects`. Admin settings also define a 90 second nearest-window setting, a five minute assignment setting and a 15 minute unpaid-match release setting. Mode, stage, rider eligibility and available candidates govern actual behaviour; these values are not observed match times or guarantees of assignment.
- `apps/api/src/orders/unpaid-release.ts` frees eligible plain unpaid assignments after the configured inactivity period, excluding pending payments and special order types. A matched rider cannot be assumed available for a second order while the first remains active.

## Fare rules that belong to other delivery paths

- Parcel delivery defaults are UGX 1,000 per km and a UGX 2,000 minimum. `apps/api/src/lib/road-distance.ts` uses an OSRM-compatible server when configured and successful, otherwise straight-line distance times a road factor, default 1.3.
- `apps/api/src/costing/fares.ts` and `packages/shared/src/pricing.ts` implement distance bands and other configured pricing components. The free-form shopping creation branch does not use those components to calculate its flat delivery charge.
- `apps/admin/app/pricing/page.tsx` explicitly states that bands and distance settings do not apply to shopping's flat fee. `apps/admin/app/settings/delivery/page.tsx` exposes the shopping charge separately from the parcel per-km rate and minimum.
- Relay and marketplace delivery have their own routes and cost structures. They cannot be used as evidence of Shopping Concierge's cost or promise without tracing the actual originating order path.

## Rider fee proposals and goods substitutions

- `apps/rider/app/jobs/[id]/page.tsx` lets a rider propose a new delivery fee. It calculates a proposed order total from the current implied goods amount plus the requested delivery fee. A voice reason is also supported.
- `apps/customer/app/orders/[id]/page.tsx` presents the proposal and lets the customer accept or reject it. A higher fee is therefore not necessarily a mandatory blanket surcharge.
- There is an accounting consistency issue to validate before forecasting from this flow: the approval handler in `apps/api/src/orders/routes.ts` updates `final_total` but updates `delivery_fee` only for parcel orders. A shopping proposal presented as a delivery-fee change can therefore leave the stored delivery component unchanged. `checkout-breakdown.ts` derives goods as total less stored delivery. This is a source-level finding; it has not been reproduced against production and no application change is included here.
- Goods substitutions have separate approval records. Approved price changes after funding are not proof that more customer money was collected. The settlement handler releases no more than collected funds.

## Timing, tracking and completion

- The delivery endpoint records departure and an ETA supplied by the rider, an existing ETA, or a fallback of 15 minutes. The fallback is not measured shopping duration, actual journey time or a customer service-level guarantee.
- The arrival endpoint records `rider_arrived_at`. Handover requires a four-digit PIN; settlement follows. `order_events` preserves stage timestamps that can support event-based duration calculations.
- `job_expiry` defaults to six hours for unserved jobs. The sweep excludes orders that have an assigned rider. It is not a six-hour maximum shopping or delivery duration.
- The first draft's four completed orders per rider per day and 60 to 90 minute tasks were judgement assumptions. No performance dataset was queried to support them. They must not drive a funding requirement until measured or supported by an explicitly accepted planning hypothesis.

## Money movement and reporting

- The legacy prepaid settlement includes goods reimbursement in the rider payout after completion. Customer prepayment does not establish an immediate purchasing advance.
- `apps/api/src/merchants/service.ts` implements separately gated merchant allocations. Live merchant payment defaults are off and require active custody approval. Treating this as universally available purchasing finance would be incorrect.
- Cash quotes and cash settlement differ from prepaid: the settlement handler recovers configured platform fees from the rider wallet. The comment in `monetization.ts` saying cash is excluded is not sufficient evidence; the actual cash settlement call applies fee calculations. Any cash economics must follow the executable path.
- Additional Money flow commission can sit alongside monetisation commission. Rider subscriptions, incentives, discounts, waiting and cancellation charges have separate settings and ledger paths. Their possible existence does not establish active revenue or cost rates.
- `GET /admin/stats/orders` counts orders without a settled-stage restriction, sums `final_total` as `revenue` and sums stored `order_fees` components as `profit`. It does not establish completed paid order volume or net profit; its comment also identifies the absence of cash-order fee receipts from that fee-row sum. Customer goods value and processing recovery must not be interpreted as retained net profit.
- The separate overview `settledGmv` query restricts to `Settle`, but remains order value across the selected environment, not module-specific net revenue. Live, sandbox and local/shared practice activity must be separated.

## Implications for the revised business plan

Use the existing local-list shopping service as the operating description. Retain the code-default UGX 3,000 only as a reference until live settings are verified. Do not recommend a UGX 6,000 charge, UGX 2,000 added service fee, 25% commission or 2% customer processing charge without an accepted commercial basis. Do not treat the withdrawn UGX 160 million funding scenario as an amount to raise.

Build the next financial model from the actual fee policy and measured or accepted inputs: completed paid lists, basket sizes, agreed delivery fees, all-in payment costs, purchasing-fund access, rider travel and shopping time, paid and idle hours, refunds and failed orders, retained fees, support cost and shared operating costs. Define results by service origin and environment so restaurant and marketplace orders are not silently counted as free-form concierge shopping.

No live settings, application code, migrations or deployments were changed in this audit.
