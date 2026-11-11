# Peebee Shopping Concierge Business Plan

Working investor draft | Kampala and Entebbe, Uganda | 11 November 2026

## Executive summary

Peebee Shopping Concierge connects a customer with a rider who accepts a shopping list, buys the goods and delivers them. The first markets are Kampala and Entebbe in Uganda. The business is pre-launch and has no paying customers, as confirmed by the founder.

The product supports local shopping in the form customers already use: quantities, bunches, bundles, heaps and other units, purchases defined by a spending amount, and recorded voice lists. The customer specifies what to buy and where to deliver. The platform coordinates the rider, customer approvals, payment, delivery and settlement. A rider can propose a different delivery fee for the customer to accept or reject.

The commercial proposition is convenient, dependable local shopping at a customer-acceptable total cost. The initial investment case should establish that customers repeat purchases, riders earn enough after their costs, and Peebee retains enough income to cover the service. Existing technology lowers the amount of new product development required; it does not demonstrate demand or profitability.

The launch pricing policy combines a distance-based Boda fare with UGX 1,000 for shopping. Peebee earns 5% of the goods and fulfilment subtotal, split equally between the customer and rider. On a UGX 60,000 basket with a 1 km delivery, the customer pays UGX 64,575 and Peebee assesses UGX 3,150 in gross fees. At 36,000 completed orders, the Year 3 scenario projects UGX 111.132 million in collected fee income and UGX 33.412 million in operating income after payment costs and provider fee tax. The illustrative result after corporate income tax is UGX 23.388 million before setup and financing costs.

## Service and customer need

The core service is a shopping errand carried out by one rider. It can serve customers who need goods but cannot conveniently make the shopping trip themselves. Repeat household shopping is a use case to validate; small-office replenishment is another. The product evidence does not justify restricting the business to affluent households or treating supermarket catalogue buying as the only use case.

The active list form supports typed items and a voice recording with an overall shopping budget. A customer can specify quantities and unit costs or an amount to spend on an item. These features matter to a service intended for ordinary local shopping. Customer research should test when using the service is preferable to shopping personally or arranging purchases with a familiar rider, and what total charge is acceptable for those circumstances.

The goods budget, delivery charge and any other applicable charges must remain understandable. The platform should not be described as earning a margin on every grocery purchase: the reviewed free-form shopping flow does not establish a compulsory markup on goods. Purchases are funds used on the customer's behalf, rather than Peebee's retained sales revenue.

This plan covers free-form Shopping Concierge. Food, pharmacy, catalogue marketplace purchases, parcels and relay delivery have separate product paths and should have separate business plans. Technical use of a shared shopping order type does not make their economics interchangeable.

## How the existing app works

The active customer entry point is the shopping-list modal on the home experience. The older standalone new-order form redirects to the home screen. The modal collects a list or voice note, goods estimate and delivery location, displays the configured delivery charge and opens checkout.

The server uses the list's prices when every item has a price; otherwise it uses the submitted goods estimate. It adds the configured shopping delivery charge once and stores that charge separately from the order total. Free-form shopping has no required pickup location, since the rider's shopping location is not fixed at creation.

The order is matched to a rider according to the available matching mode. For ordinary direct shopping, checkout payment requires an assigned rider. Payment options and prices are calculated by the server; they are not a single fixed surcharge common to every method. The customer checkout supports mobile money, available card payments, wallets and cash, with applicable eligibility conditions. It also supports shared wallets and offers. Their commercial costs and activation must be verified rather than assumed.

During shopping, a rider can propose substitutions for customer approval. The rider can also request a different delivery fee with a written or recorded reason. The customer can accept or reject that request. At delivery, the app records departure and arrival and uses a handover PIN before settlement.

The source review found a consistency issue requiring validation: the shopping fee-proposal UI describes a delivery-fee change, but the approval handler changes the order's final total without updating the shopping order's stored delivery-fee field. This can affect the displayed goods split and fee attribution. It is a product readiness item, not a reason to invent a replacement pricing policy. No code change is included in this plan.

## Customer pricing

The launch policy uses the same distance fare as Boda and adds **UGX 1,000 for shopping**. The Boda component has a **UGX 2,000 minimum fare**. At 1 km in the illustration, that gives UGX 2,000 for the ride plus UGX 1,000 for shopping. Peebee then applies the customer’s 2.5% share to goods plus ride plus shopping. Prices are in UGX.

The fare engine supports marginal distance bands. The current repository defaults use UGX 1,500/km and a UGX 2,500 minimum for passenger Boda, with no Boda taper configured. The UGX 2,000 minimum exists in the parcel defaults and is the founder’s minimum for this plan. Live Admin settings are unverified. The longer-distance examples assume UGX 1,500/km for the first 2 km and UGX 1,000/km thereafter. Those illustrative thresholds and rates need confirmation in Admin. The 5% examples use exact arithmetic. The existing checkout fee rounding and cash collection path need to support the split before launch. [Current fare defaults](https://github.com/Peebee-Application/Peebee/blob/a08210e890f745cf867e63ddc45dd0959d1b5951/apps/api/src/lib/settings.ts) · [Distance-band engine](https://github.com/Peebee-Application/Peebee/blob/a08210e890f745cf867e63ddc45dd0959d1b5951/packages/shared/src/pricing.ts)

| Goods budget | Road distance, km | Boda fare | Shopping fee | Delivery with shopping | Customer Peebee fee, 2.5% | Customer total |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 1 | 2,000 | 1,000 | 3,000 | 325 | **13,325** |
| 20,000 | 2 | 3,000 | 1,000 | 4,000 | 600 | **24,600** |
| 40,000 | 3 | 4,000 | 1,000 | 5,000 | 1,125 | **46,125** |
| 60,000 | 1 | 2,000 | 1,000 | 3,000 | 1,575 | **64,575** |
| 60,000 | 5 | 6,000 | 1,000 | 7,000 | 1,675 | **68,675** |

## Peebee income and rider earnings per order

Both 2.5% shares use the same subtotal of goods plus delivery with shopping. The customer share is added to the subtotal. The rider share is deducted from the ride and shopping earnings, with goods purchase reimbursement accounted for separately. Peebee’s gross fee is the sum of the two shares. The former delivery-to-goods percentage column measured the size of the fulfilment charge relative to the basket. The two fee columns below show the actual platform percentages and their value in UGX.

| Goods budget | Road distance, km | Goods plus delivery | Customer pays Peebee, 2.5% | Rider pays Peebee, 2.5% | Gross Peebee fee, 5% | Rider earnings after fee, before own costs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 1 | 13,000 | 325 | 325 | **650** | 2,675 |
| 20,000 | 2 | 24,000 | 600 | 600 | **1,200** | 3,400 |
| 40,000 | 3 | 45,000 | 1,125 | 1,125 | **2,250** | 3,875 |
| 60,000 | 1 | 63,000 | 1,575 | 1,575 | **3,150** | 1,425 |
| 60,000 | 5 | 67,000 | 1,675 | 1,675 | **3,350** | 5,325 |

At the 1 km, UGX 60,000 example, the customer’s UGX 64,575 covers UGX 60,000 of goods, UGX 1,425 of rider earnings and UGX 3,150 in Peebee fees. A larger basket increases the rider fee even at the same distance, so the pilot should measure rider acceptance and net earnings by basket size.

## Aggregator charges and mobile money taxes per order

The model assumes Peebee absorbs the payment costs inside its 5% fee. The aggregator charges 3% of the customer payment to collect by mobile money. The model adds one mobile money payout per order, at UGX 1,000 for these payout amounts. Flutterwave bundles mobile money collection into its 3% rate. Any separately invoiced operator charge or wallet cash-out levy would need its own amount and payer. [Flutterwave Uganda pricing](https://www.flutterwave.com/ug/pricing)

Flutterwave’s help page lists a 15% tax on Uganda transaction fees. The illustration applies 15% to both the collection and payout fees as a planning allowance. URA lists an 18% standard VAT rate, so confirm the provider invoice, tax classification and payout tax treatment. The 15% allowance uses the provider fees as its base. [Flutterwave merchant tax table](https://flutterwave.com/gb/support/pricing/value-added-tax-vat-for-flutterwave-merchants) · [URA taxation handbook](https://ura.go.ug/wp-content/uploads/2024/12/Taxation-Handbook-FY-2024-25.pdf)

| Goods budget and trip | Gross Peebee fee | Aggregator collection, 3% | Mobile money payout | Provider fee tax, 15% | Total payment cost | Peebee after payment costs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 · 1 km | 650.00 | 399.75 | 1,000.00 | 209.96 | 1,609.71 | **-959.71** |
| 20,000 · 2 km | 1,200.00 | 738.00 | 1,000.00 | 260.70 | 1,998.70 | **-798.70** |
| 40,000 · 3 km | 2,250.00 | 1,383.75 | 1,000.00 | 357.56 | 2,741.31 | **-491.31** |
| 60,000 · 1 km | 3,150.00 | 1,937.25 | 1,000.00 | 440.59 | 3,377.84 | **-227.84** |
| 60,000 · 5 km | 3,350.00 | 2,060.25 | 1,000.00 | 459.04 | 3,519.29 | **-169.29** |

All amounts are UGX. For cash paid directly to the rider, the model assigns zero per-order aggregator and payout charges. It allows for partial recovery of the rider’s 2.5% share. Any separately billed cost of funding or withdrawing wallet balances depends on the settlement arrangement.

## Three-year financial projections

The planning scenario uses 6,000, 18,000 and 36,000 completed orders across Kampala and Entebbe. The reference order is UGX 60,000 of goods with a 1 km delivery. The assumed mix is 80% cash and 20% mobile money. The model assumes full recovery of the customer share and 95% recovery of the rider share on cash orders. Digital orders assume full recovery of both shares. The cash checkout and settlement path requires alignment to collect the shares from their intended payers.

At that mix, Peebee collects an average of UGX 3,087 per order. Payment charges and provider fee tax average UGX 675.57. After UGX 150 in other variable costs, contribution averages UGX 2,261.43. Fixed costs are assumed at UGX 2 million, UGX 3 million and UGX 4 million per month across the three years. Setup and financing costs sit outside the operating projection.

The corporate income tax line applies 30% to positive modeled operating income as a proxy for chargeable income. Loss relief, allowances and other Peebee modules’ results would affect actual tax. [URA corporate income tax](https://ura.go.ug/en/ask-ura-commissioner-general-30/)

| Financial measure, UGX million except orders | Year 1 | Year 2 | Year 3 |
| --- | ---: | ---: | ---: |
| Completed orders | 6,000 | 18,000 | 36,000 |
| Goods purchased | 360.000 | 1,080.000 | 2,160.000 |
| Total paid by customers | 387.450 | 1,162.350 | 2,324.700 |
| Ride and shopping charges | 18.000 | 54.000 | 108.000 |
| Customer 2.5% assessed | 9.450 | 28.350 | 56.700 |
| Rider 2.5% assessed | 9.450 | 28.350 | 56.700 |
| Gross Peebee fees assessed | 18.900 | 56.700 | 113.400 |
| **Peebee fee income after collection losses** | 18.522 | 55.566 | 111.132 |
| Aggregator collection costs | (2.325) | (6.974) | (13.948) |
| Mobile money payout costs | (1.200) | (3.600) | (7.200) |
| Tax on provider fees | (0.529) | (1.586) | (3.172) |
| Other variable costs | (0.900) | (2.700) | (5.400) |
| Contribution | 13.569 | 40.706 | 81.412 |
| Fixed operating costs | (24.000) | (36.000) | (48.000) |
| Paid search and social media | (4.000) | 0.000 | 0.000 |
| **Operating income or loss** | (14.431) | 4.706 | 33.412 |
| Illustrative corporate income tax | 0.000 | (1.412) | (10.023) |
| **Result after illustrative income tax** | (14.431) | 3.294 | 23.388 |

The base case assumes Peebee has no output VAT obligation on the modeled fees. URA’s annual registration threshold is UGX 300 million in taxable turnover from 1 July 2026. Peebee’s registration and overall taxable turnover across modules govern applicability. If the 5% fee is VAT-inclusive and taxable at 18%, a fully collected UGX 3,150 fee contains UGX 480.51 in VAT. With no input tax credit assumed, the same Year 3 scenario would show UGX 16.459 million in operating income and UGX 11.521 million after illustrative corporate income tax. [URA VAT threshold notice](https://ura.go.ug/en/revised-value-added-tax-registration-threshold/)

At 80% cash, Year 3 operating break-even requires about 21,226 completed orders under the base assumptions. With all orders paid by mobile money, the reference order loses UGX 377.84 in contribution after variable costs and the Year 3 operating loss is UGX 61.602 million. The model includes five payment mixes. [Model script](model.py) · [Calculated scenarios](financial-model.json)

## Delivery distance and assignment

Shopping and Boda are separate modules that share the distance-fare approach in the launch plan. The reviewed shopping order-creation code still uses a flat fee. Automatic road distance, the shared distance tariff and the shopping add-on are launch requirements. For the model, chargeable distance is the road distance from the rider’s proposed shop to the customer.

For a free-form shopping list, rider proximity is measured relative to the customer destination. Known store or restaurant pickups use their pickup point. Matching initially broadcasts within 1 km, then 2 km and 3 km in 20 second intervals before removing that staged restriction. A rider's own visibility range can still apply; the global code default is 20 km, with per-rider overrides.

The configured 7 km service range is used to flag out-of-range matches. It must not be described as a universal hard delivery boundary. Rider fee proposals can respond to an out-of-range assignment. That behaviour matters to the actual customer price and rider acceptance rate.

The launch workflow prioritises riders near the customer so they can shop locally and keep travel costs down. The rider proposes the shop and the app calculates the road distance and quote. The customer reviews changes before agreeing to the purchase. If an item is unavailable, the rider reports why and asks the customer to approve a substitution or remove the item. Measure local and cross-area trips separately in Kampala and Entebbe.

## Purchasing funds and settlement

Customer prepayment and rider purchasing liquidity are separate. In the standard prepaid flow, the rider's settlement includes reimbursement of the goods after completion. The code reviewed does not establish that a rider receives purchasing cash immediately when the customer pays. The business needs to establish what funds riders use at the shop and how long reimbursement takes to become usable.

The merchant-payment flow provides a separate mechanism for shopping principal and merchant allocations. Live use requires feature activation and active custody approval; its code defaults leave it off. It cannot be treated as universally available funding for purchases at every shop or market.

For cash orders, the rider funds purchases and collects from the customer on delivery. The settlement handler recovers applicable platform fees from the rider wallet. Cash, wallet and external-payment orders therefore need separate economic calculations. The revised plan does not exclude cash or mandate prepayment as a new launch policy without an agreed commercial and operational basis.

An approved price increase after collection is not proof of additional funds received. Settlement limits release to funds collected. Before forecasting refunds, reimbursements or increased shopping budgets, validate the complete path for collecting any shortfall and returning any unused money. Customer principal must remain separate from Peebee operating capital.

## Market and competition

Uganda Bureau of Statistics reports 1,797,722 people and 529,057 households in Kampala Capital City in the 2024 census profile. These are city-boundary counts, not a Kampala-plus-Entebbe customer estimate. They provide a population frame, not a measured paid-shopping market. [UBOS Kampala census profile](https://www.ubos.org/wp-content/uploads/2025/06/Kampala-Capital-City-Census-2024-Profile-Report.pdf)

UCC reported 36.3 million active mobile money accounts and 18.5 million internet subscriptions as of December 2025 in a May 2026 publication. Accounts and subscriptions are not unique consumers. The figures support investigating digital ordering and payment but do not supply Peebee's conversion, repeat use or market share. [UCC digital access update](https://www.ucc.co.ug/uganda-communications-commission-a-snapshot-of-gains-impact-and-progress/)

Glovo's current Kampala page lists groceries and shops among its categories. Retailer-arranged delivery, familiar riders and shopping personally are further alternatives to examine. Their actual availability, total prices and reliability should be compared for the same tasks and locations. This draft makes no claim that Peebee is the cheapest, fastest or the only available option. [Glovo Kampala](https://glovoapp.com/en/ug/kampala)

Peebee's positioning should be tested around getting a customer's actual list bought correctly at an acceptable total cost, including local units, budgets, voice communication and customer approval of changes. The value has to be demonstrated in completed paid shopping tasks. No numerical market-share assumption is used to manufacture a revenue forecast.

## Operating metrics required for the business model

Existing events, order fields, payments and ledgers supply a foundation for measurement. The following definitions should govern the model rather than treating every order or dashboard total as a completed commercial transaction.

| Metric | Definition and business purpose |
| --- | --- |
| Completed paid shopping lists | Concierge-originated orders that reach settlement, with payment evidence appropriate to the rail; exclude sandbox, practice and other module origins. |
| Customer total cost | Goods purchased, agreed delivery and applicable charges, less genuine discounts; distinguish estimates from actual collected amounts. |
| Rider acceptance and matching time | Eligible offers and acceptances, with elapsed time from availability to assignment; account for reopened and unpaid assignments. |
| Shopping and delivery duration | Separate assignment, funding, shopping, departure, arrival and handover intervals using the relevant events. |
| Travel and purchasing cost | Actual rider travel, shop waiting, fuel, other expenses and funds tied up before settlement. |
| Rider earnings | Retained earnings after reimbursements are removed and platform deductions and rider costs are accounted for. |
| Peebee contribution | Retained fee income and recovery less actual provider costs, variable support, Peebee-funded incentives and expected loss costs. |
| Repeat use and acquisition cost | Customers who place subsequent paid orders, measured by mature cohorts; acquisition spending divided by first-time paying customers attributable to it. |
| Reliability and losses | Completion, cancellations, missing or incorrect goods, approved changes, refunds, unresolved shortfalls and reconciliation differences. |

The app's 15 minute delivery ETA fallback is not measured fulfilment time. The six-hour unserved-job expiry is not a six-hour shopping promise. The previous assumptions of four jobs per rider per day and 60 to 90 minute tasks have no queried performance evidence and are withdrawn as a forecasting basis.

The Admin order statistics endpoint also needs careful interpretation: its order count is not restricted to settled orders; its revenue sum uses order totals; and its profit sum uses stored fee components, with limitations for cash orders. These values must not be copied into an investor model as completed order volume, Peebee revenue or net profit. See the [delivery source audit](DELIVERY_SOURCE_AUDIT.md) for the exact source paths and limitations.

## Commercial launch and funding approach

**Proposed funding ask: UGX 44 million** for launch setup, paid search and social media, and the first 12 months of Shopping Concierge operations in Kampala and Entebbe. A broader awareness campaign adds a provisional UGX 30 million, bringing the funding envelope to **UGX 74 million**. The operating budget assumes shared Peebee infrastructure, a small team and riders providing their own motorcycles.

| Use of funds | UGX million | Basis |
| --- | ---: | --- |
| One-time launch setup | 12 | 6 for checkout, distance pricing and fee split work, 2 for payment testing and compliance preparation, 2 for rider recruitment and training, and 2 for pilot materials and community activation |
| Operating runway | 22 | Funds the peak operating cash deficit in the downside case, rounded up from 21.61 |
| Paid search and social media | 4 | 1.5 for search and 2.5 for social media |
| Working capital reserve | 4 | 3 for purchasing and settlement timing, equivalent to 50 reference baskets at UGX 60,000, and 1 for refunds and disputes |
| Contingency | 2 | Unplanned launch costs or payment charges |
| **Core ask** | **44** | |

The monthly operating budget is UGX 2 million in Year 1, or UGX 24 million before order contribution and paid ads. In the base case, 6,000 orders generate UGX 13.57 million in contribution, leaving a UGX 10.43 million core operating shortfall and a UGX 14.43 million loss after digital ads. Core operating cash needs peak at UGX 10.84 million in month 10. Reserving the entire digital budget alongside setup, working capital and contingency brings the base funding need to about UGX 32.84 million. Years 2 and 3 have no separately budgeted paid campaign. Update them when campaign performance and the follow-on budget are known.

The core ask covers a downside case with 3,000 Year 1 orders, a 50% cash mix, and VAT included in the existing Peebee fee at 18% with no input credit assumed. Contribution in that case averages about UGX 797 per order. The core operating cash deficit reaches UGX 21.61 million in month 12, with the paid campaign funded separately in the use-of-funds table. The working capital allowance covers temporary exposure and should be resized using actual settlement timing, refund experience and the agreed funding arrangement.

Use the first 90 days after launch to target 500 completed orders across the two markets and verify paid repeat orders, rider earnings, and contribution by payment method. At base-case contribution of UGX 2,261 per order, about 885 orders per month cover the Year 1 operating budget. Review spending and rollout pace against those results before expanding rider coverage or acquisition spend. [Monthly funding model](financial-model.json)

### Advertising and broader awareness

Use paid search to reach people already looking for grocery shopping or delivery in the service areas. Use paid social to show how sending a shopping list works and build recognition around local markets and neighbourhoods. Spend UGX 500,000 across both channels in an initial test. Release the rest as completed first orders, repeat purchases and contribution justify it. Track acquisition cost as campaign spend divided by new customers who complete a paid order, and compare it with contribution from those customers over 90 days.

Radio and outdoor placements can build recognition beyond the people reached by digital ads. Start with stations serving the launch areas and billboard sites near markets or along routes riders already serve. TV can show the shopping and delivery process. A newspaper placement can introduce the service and explain coverage. Give each channel a distinct offer code, link or phone prompt so Peebee can compare orders from the areas that received the campaign.

| Optional awareness spending | UGX million | What to price |
| --- | ---: | --- |
| Local radio | 5 | Repeated spots and presenter mentions for Kampala and Entebbe audiences |
| Billboards | 10 | Limited placements near active service areas, including artwork, printing, installation and permits where applicable |
| Television | 8 | A limited package of spots or demonstrations with an agreed schedule |
| Newspapers | 4 | Targeted print or e-paper placements |
| Production and measurement | 3 | Creative work, translations and campaign tracking |
| **Additional awareness budget** | **30** | |
| **Total ask with broader awareness** | **74** | |

These are spending allowances. Radio Sapientia lists UGX 40,000 for a 30-second commercial. BrandAds estimates UGX 3 million to UGX 9.5 million per month for standard billboard rental, with printing and installation separate. Vision Group publishes TV, radio and newspaper rate cards. Its older newspaper card lists UGX 3.15 million for a quarter-page colour New Vision placement. A meaningful campaign needs current written quotes showing locations, number of spots, production, taxes and duration. The UGX 30 million allowance is for a limited campaign across the two launch markets. [Radio Sapientia](https://www.radiosapientia.com/marketing/) · [BrandAds billboard estimates](https://brandads.co.ug/advertising-cost-in-uganda/) · [Vision Group rate cards](https://www.visiongroup.co.ug/rate-card/) · [New Vision historical print card](https://www.visiongroup.co.ug/wp-content/uploads/2023/06/VG-newspaper-ratecard.pdf)

Keep the additional UGX 30 million as a separate funding tranche. Release it when the initial launch shows reliable rider coverage and fulfilment, repeat paid orders and enough contribution to sustain the proposed campaign. At unchanged order volume, spending both ad budgets increases the Year 1 operating loss to UGX 44.43 million. The model assigns no increase in orders until there is evidence of the campaign's effect. [Financial scenarios](financial-model.json)

Prepare and validate the existing flow before paid launch: rider purchasing capacity, accurate prices and fee disclosure, approved payment arrangements, delivery and handover, settlement, withdrawals, refunds and complaint handling. Rider recruitment should match actual order density and earnings rather than an assumed large roster.

Use early paid shopping orders in Kampala and Entebbe to establish actual basket sizes, total charges accepted, rider costs, duration, repeat use and loss experience. Separate full-price activity from subsidies and report each launch area and payment method distinctly. Avoid promoting a fixed completion time before the service can support it.

Refresh the model with verified fees, payout costs, completed order volume, retention and rider capacity as pilot data becomes available. Allocate ongoing technology, support, payment administration and shared management costs to this module.


## Governance and investor diligence

Confirm the company's legal identity, ownership, software and brand rights, rider engagement arrangements, tax obligations, insurance and relevant permissions. The Bank of Uganda oversees payment-service and payment-system activities; the exact arrangement for Peebee's collections, wallet and code-labelled escrow needs qualified confirmation. Code and ledger records are not regulatory approval. [Bank of Uganda payment framework](https://bou.or.ug/financial_infrastructure_innovation)

UCC publishes courier licence categories and application requirements. Confirm their application to the planned operating model and coverage. PDPO publishes data registration and compliance guidance relevant to handling customer and rider information. No approval or licence is claimed in this draft. [UCC postal and courier licensing](https://www.ucc.co.ug/postal-and-courier/), [PDPO knowledge centre](https://pdpo.go.ug/knowledge-center)

The investor case remains a pre-launch validation case. The strongest next evidence is affordable orders that customers repeat, adequate rider net earnings, reliable money movement and positive retained contribution. Those findings should determine growth spending and the funding request.

## Evidence and status

Founder-confirmed facts are Uganda as the market, Kampala and Entebbe first, no paying customers yet and one rider accepting the list, buying and delivering. The founder rejected the first draft's proposed customer price. No willingness-to-pay study has been presented as completed.

Product evidence is pinned to commit `4871a68f9e475728c7e45624d817a7f06968d671`. The [source audit](DELIVERY_SOURCE_AUDIT.md) covers the active customer list and checkout, rider workflow, Admin pricing and monetisation, matching, distance calculation, fee changes, payment and reporting paths. Code defaults are distinguished from unknown live overrides and measured performance.

The model uses the founder’s UGX 2,000 minimum ride fare, UGX 1,000 shopping fee and 5% Peebee fee. The distance bands, order volumes, payment mix and cost estimates are planning assumptions. The fare defaults were rechecked against origin/main at commit `a08210e890f745cf867e63ddc45dd0959d1b5951`. [Model script](model.py) · [Calculated scenarios](financial-model.json)
