# Peebee Shopping Concierge Business Plan

Working investor draft | Kampala and Entebbe, Uganda | 11 November 2026

## Executive summary

Peebee Shopping Concierge connects a customer with a rider who accepts a shopping list, buys the goods and delivers them. The first markets are Kampala and Entebbe in Uganda. The business is pre-launch and has no paying customers, as confirmed by the founder.

The product supports local shopping in the form customers already use: quantities, bunches, bundles, heaps and other units, purchases defined by a spending amount, and recorded voice lists. The customer specifies what to buy and where to deliver. The platform coordinates the rider, customer approvals, payment, delivery and settlement. A rider can propose a different delivery fee for the customer to accept or reject.

The commercial proposition is convenient, dependable local shopping at a customer-acceptable total cost. The initial investment case should establish that customers repeat purchases, riders earn enough after their costs, and Peebee retains enough income to cover the service. Existing technology lowers the amount of new product development required; it does not demonstrate demand or profitability.

The launch pricing policy combines a distance-based Boda fare with UGX 1,000 for shopping. Peebee earns 5% of the goods and fulfilment subtotal, split equally between the customer and rider. On a UGX 60,000 basket with a 1 km delivery, the customer pays UGX 64,575 and Peebee assesses UGX 3,150 in gross fees. At 36,000 completed orders, the Year 3 scenario projects UGX 111.132 million in collected fee income and UGX 40.184 million in operating income before tax and setup costs.

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

## Three-year financial projections

The planning scenario keeps the previous volumes of 6,000, 18,000 and 36,000 completed orders across Kampala and Entebbe. It uses the UGX 60,000 goods budget and 1 km trip as a reference order, with 80% cash and 20% mobile money. It assumes full recovery of the customer share and 95% recovery of the rider share on cash orders. Digital orders assume full recovery of both shares. The current cash checkout and settlement path requires verification and alignment to collect the shares from their intended payers.

Mobile money collection is modeled at 3% of the customer total, or UGX 1,937.25 per digital order, using Flutterwave’s published Uganda rate as a benchmark. The model also retains a UGX 500 payout allowance and UGX 150 of other variable costs per order. The payout allowance is a planning input. Actual provider contract rates, payout batching and applicable taxes need verification. [Flutterwave Uganda collection pricing](https://www.flutterwave.com/ug/pricing)

At the assumed payment mix, Peebee collects an average of UGX 3,087 per completed order. Payment costs average UGX 487.45 and contribution averages UGX 2,449.55 after other variable costs. Fixed operating costs are assumed at UGX 2 million, UGX 3 million and UGX 4 million per month across the three years. These projections precede tax, setup costs and any financing for purchasing funds.

| Financial measure, UGX million except orders | Year 1 | Year 2 | Year 3 |
| --- | ---: | ---: | ---: |
| Completed orders | 6,000 | 18,000 | 36,000 |
| Goods purchased | 360.000 | 1080.000 | 2160.000 |
| Total paid by customers | 387.450 | 1162.350 | 2324.700 |
| Ride and shopping charges | 18.000 | 54.000 | 108.000 |
| Customer 2.5% assessed | 9.450 | 28.350 | 56.700 |
| Rider 2.5% assessed | 9.450 | 28.350 | 56.700 |
| Gross Peebee fees assessed | 18.900 | 56.700 | 113.400 |
| **Peebee fee income after collection losses** | 18.522 | 55.566 | 111.132 |
| Payment costs | (2.925) | (8.774) | (17.548) |
| Other variable costs | (0.900) | (2.700) | (5.400) |
| Contribution | 14.697 | 44.092 | 88.184 |
| Fixed operating costs | (24.000) | (36.000) | (48.000) |
| **Operating income or loss** | (9.303) | 8.092 | 40.184 |

At 80% cash, Year 3 operating break-even requires about 19,596 completed orders at the modeled cost base. If all orders use mobile money, contribution drops to UGX 562.75 per order and Year 3 shows a UGX 27.741 million operating loss. These scenarios depend on real payment mix, successful fee collection, and order volumes. The reproducible model includes five payment mixes. [Model script](model.py) · [Calculated scenarios](financial-model.json)

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

Prepare and validate the existing flow before paid launch: rider purchasing capacity, accurate prices and fee disclosure, approved payment arrangements, delivery and handover, settlement, withdrawals, refunds and complaint handling. Rider recruitment should match actual order density and earnings rather than an assumed large roster.

Use early paid shopping orders in Kampala and Entebbe to establish actual basket sizes, total charges accepted, rider costs, duration, repeat use and loss experience. Separate full-price activity from subsidies and report each launch area and payment method distinctly. Avoid promoting a fixed completion time before the service can support it.

Refresh the model with verified fees, payout costs, completed order volume, retention and rider capacity as pilot data becomes available. Allocate ongoing technology, support, payment administration and shared management costs to this module.

Funding need equals validated launch setup costs plus operating cash deficits, required purchasing liquidity and an operating reserve. The projections quantify the operating deficit under the modeled inputs. A funding request also needs costed setup, working capital, payment terms and a credible path to positive contribution.

## Governance and investor diligence

Confirm the company's legal identity, ownership, software and brand rights, rider engagement arrangements, tax obligations, insurance and relevant permissions. The Bank of Uganda oversees payment-service and payment-system activities; the exact arrangement for Peebee's collections, wallet and code-labelled escrow needs qualified confirmation. Code and ledger records are not regulatory approval. [Bank of Uganda payment framework](https://bou.or.ug/financial_infrastructure_innovation)

UCC publishes courier licence categories and application requirements. Confirm their application to the planned operating model and coverage. PDPO publishes data registration and compliance guidance relevant to handling customer and rider information. No approval or licence is claimed in this draft. [UCC postal and courier licensing](https://www.ucc.co.ug/postal-and-courier/), [PDPO knowledge centre](https://pdpo.go.ug/knowledge-center)

The investor case remains a pre-launch validation case. The strongest next evidence is affordable orders that customers repeat, adequate rider net earnings, reliable money movement and positive retained contribution. Those findings should determine growth spending and the funding request.

## Evidence and status

Founder-confirmed facts are Uganda as the market, Kampala and Entebbe first, no paying customers yet and one rider accepting the list, buying and delivering. The founder rejected the first draft's proposed customer price. No willingness-to-pay study has been presented as completed.

Product evidence is pinned to commit `4871a68f9e475728c7e45624d817a7f06968d671`. The [source audit](DELIVERY_SOURCE_AUDIT.md) covers the active customer list and checkout, rider workflow, Admin pricing and monetisation, matching, distance calculation, fee changes, payment and reporting paths. Code defaults are distinguished from unknown live overrides and measured performance.

The model uses the founder’s UGX 2,000 minimum ride fare, UGX 1,000 shopping fee and 5% Peebee fee. The distance bands, order volumes, payment mix and cost estimates are planning assumptions. The fare defaults were rechecked against origin/main at commit `a08210e890f745cf867e63ddc45dd0959d1b5951`. [Model script](model.py) · [Calculated scenarios](financial-model.json)
