# Peebee Shopping Concierge Business Plan

Working investor draft | Kampala and Entebbe, Uganda | 11 November 2026

## Executive summary

Peebee Shopping Concierge connects a customer with a rider who accepts a shopping list, buys the goods and delivers them. The first markets are Kampala and Entebbe in Uganda. The business is pre-launch and has no paying customers, as confirmed by the founder.

The product supports local shopping in the form customers already use: quantities, bunches, bundles, heaps and other units, purchases defined by a spending amount, and recorded voice lists. The customer specifies what to buy and where to deliver. The platform coordinates the rider, customer approvals, payment, delivery and settlement. A rider can propose a different delivery fee for the customer to accept or reject.

The commercial proposition is convenient, dependable local shopping at a customer-acceptable total cost. The initial investment case should establish that customers repeat purchases, riders earn enough after their costs, and Peebee retains enough income to cover the service. Existing technology lowers the amount of new product development required; it does not demonstrate demand or profitability.

The pricing table uses the UGX 3,000 shopping delivery default. The three-year planning scenario tests a share of that existing charge as Peebee income. At 36,000 completed orders in Year 3, it produces UGX 17.28 million in collected platform fees and a UGX 53.328 million operating loss under the stated payment and staffing assumptions. Mobile money costs on the full shopping basket and the small fee retained per order drive the result.

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

Shopping starts with the goods budget plus the flat Admin delivery charge. The code defaults are UGX 3,000 delivery and zero service, processing and commission fees. The deployed settings endpoint requires authentication, so live overrides remain unverified. The examples assume an unchanged list, zero discounts and zero additional charges.

| Goods budget | Delivery | Customer total | Delivery as share of goods |
| ---: | ---: | ---: | ---: |
| UGX 10,000 | UGX 3,000 | **UGX 13,000** | 30% |
| UGX 20,000 | UGX 3,000 | **UGX 23,000** | 15% |
| UGX 40,000 | UGX 3,000 | **UGX 43,000** | 7.5% |
| UGX 60,000 | UGX 3,000 | **UGX 63,000** | 5% |

The flat charge takes a larger share of smaller baskets. A rider can propose a different delivery charge for the customer to approve. Confirm how the approved change appears in settlement before using it in revenue projections. [Delivery source audit](DELIVERY_SOURCE_AUDIT.md)

## Revenue and income per order

The model tests one existing Admin control, a **15% delivery commission**, with customer surcharges at zero. This is a planning assumption for testing rider economics. Default UGX 500 fee rounding makes 15% of UGX 3,000 payable as UGX 500, an effective 16.7% share. The rider earns UGX 2,500 before fuel, time and other costs when the commission is recovered. With the commission switch off, the rider keeps UGX 3,000 and Peebee earns UGX 0 in modeled fees. The customer total stays UGX 63,000 in both cases.

Yo! Payments publishes 3% on inbound mobile money and UGX 500 for a payout in the UGX 60,001–500,000 band, with possible network fees. Flutterwave also publishes 3% on local wallet and mobile money collections. The scenario uses 3% on the full checkout and one UGX 500 payout allowance per digital order. Actual provider contract rates, payout batching, additional network charges and applicable taxes need verification. [Yo! Payments tariffs](https://paymentsweb.yo.co.ug/index.php/how-it-works) · [Flutterwave Uganda pricing](https://www.flutterwave.com/ug/pricing)

| Per order at a UGX 60,000 goods budget | Cash | Mobile money |
| --- | ---: | ---: |
| Customer total | 63,000 | 63,000 |
| Goods purchase or reimbursement | 60,000 | 60,000 |
| Rider gross delivery earnings after full commission | 2,500 | 2,500 |
| Peebee commission assessed | 500 | 500 |
| Expected commission collected | 475 | 500 |
| Collection and payout cost to Peebee | 0 | 2,390 |
| Other variable operating cost | 150 | 150 |
| **Peebee contribution before fixed costs** | **325** | **−2,040** |

Amounts are in UGX. Cash assumes recovery of 95% of the fee owed through the rider wallet and no provider charge per cash order. It allows UGX 25 in uncollected commission per order. The UGX 150 allowance for variable support, communications and losses is a placeholder. Digital assumes the rider is reimbursed through a payout and Peebee absorbs the modeled payment costs. The model covers cash and mobile money. Card, wallet top-up economics, subscriptions, discounts and merchant income are outside this scenario. Goods purchased for the customer and rider earnings are pass-through amounts in the management forecast.

## Three-year financial projections

The volume scenario averages 500, 1,500 and 3,000 completed orders per month in Years 1–3 across Kampala and Entebbe. At two orders per active customer each month, that implies 250, 750 and 1,500 active customers respectively. These are planning inputs for a pre-launch business. The UGX 60,000 reference basket and 80% cash share are held constant to make the economics visible.

The fixed budget starts at UGX 2 million per month, with UGX 1 million for dispatch and operations, UGX 600,000 for customer support and acquisition, and UGX 400,000 for shared technology and administration. It scales to UGX 3 million and UGX 4 million monthly in Years 2 and 3. These are provisional expense allowances. The forecast is before tax, one-time setup costs and any separate facility for shopping funds.

| Financial measure, UGX million except orders | Year 1 | Year 2 | Year 3 |
| --- | ---: | ---: | ---: |
| Completed orders | 6,000 | 18,000 | 36,000 |
| Goods purchased | 360.000 | 1,080.000 | 2,160.000 |
| Total customer order value | 378.000 | 1,134.000 | 2,268.000 |
| Delivery charges included in customer totals | 18.000 | 54.000 | 108.000 |
| Peebee commission assessed | 3.000 | 9.000 | 18.000 |
| **Peebee fee income after collection losses** | **2.880** | **8.640** | **17.280** |
| Payment costs | (2.868) | (8.604) | (17.208) |
| Other variable costs | (0.900) | (2.700) | (5.400) |
| Contribution | (0.888) | (2.664) | (5.328) |
| Fixed operating costs | (24.000) | (36.000) | (48.000) |
| **Operating income or loss** | **(24.888)** | **(38.664)** | **(53.328)** |

At 80% cash, fee income averages UGX 480 per order and variable costs average UGX 628. Each additional order reduces contribution by UGX 148 under those assumptions. The three-year operating deficit is UGX 116.88 million before setup and financing. At the unchanged commission-off code default and the same Year 3 volume and costs, Peebee fee income is UGX 0 and the operating loss is UGX 70.608 million.

| Cash share | Contribution per order, UGX | Year 3 operating result, UGX million |
| ---: | ---: | ---: |
| 50% | −857.50 | −78.870 |
| 80% | −148.00 | −53.328 |
| 95% | 206.75 | −40.557 |
| 100% | 325.00 | −36.300 |

Contribution turns positive above about 86.3% cash under these inputs. With 95% cash, UGX 48 million in annual fixed costs would require about 232,165 completed orders for operating break-even. At the planned 36,000 orders, even the all-cash case leaves a deficit. The investment case therefore depends on testing a lower cost of serving and settling orders, stronger retained income within acceptable customer and rider economics, or a different scale of operations. [Model script](model.py) · [Calculated scenarios](financial-model.json)

## Delivery distance and assignment

Shopping's flat fee is separate from parcel delivery's distance-priced fare. Parcel defaults include UGX 1,000 per km and a UGX 2,000 minimum. Road distances use routing when available or a default straight-line multiplier of 1.3. These are not automatically shopping charges. The Admin pricing screen explicitly says that distance bands do not apply to shopping's flat fee.

For a free-form shopping list, rider proximity is measured relative to the customer destination. Known store or restaurant pickups use their pickup point. Matching initially broadcasts within 1 km, then 2 km and 3 km in 20 second intervals before removing that staged restriction. A rider's own visibility range can still apply; the global code default is 20 km, with per-rider overrides.

The configured 7 km service range is used to flag out-of-range matches. It must not be described as a universal hard delivery boundary. Rider fee proposals can respond to an out-of-range assignment. That behaviour matters to the actual customer price and rider acceptance rate.

Kampala and Entebbe are the confirmed launch markets. Operational planning should examine local trips within each area and distinguish any cross-area shopping. The app's matching and fee rules do not by themselves prove that every trip in those markets is economical at a flat charge. Coverage and price decisions must reflect actual travel, shopping locations and rider acceptance.

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

The current model replaces the withdrawn tariff scenario. It uses the verified code-default price, published provider benchmarks and disclosed assumptions for commission, payment mix, recovery, volume and costs. [Model script](model.py) · [Calculated scenarios](financial-model.json)
