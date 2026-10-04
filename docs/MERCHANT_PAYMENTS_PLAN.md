# Peebee Merchant Payments and Order-Funds Plan

Status: Living implementation artifact
Version: 0.4
Decision date: 2026-09-26
Owners: Peebee product, engineering, finance, operations, and compliance

## 1. Purpose

This document consolidates the agreed direction for handling customer-funded shopping orders, rider spending, merchant payments, rider earnings, provider fees, withdrawals, fraud, KYC, settlement, and incentive abuse.

It is deliberately written as both a product specification and a sequenced build plan. Each phase must be completed and verified before the dependent phase begins.

## 2. Agreed product decisions

1. Customer shopping money must originate from a real, successfully verified customer payment.
2. The shopping principal is protected. Provider fees, taxes, Peebee revenue, commissions, and rider earnings must never silently reduce the amount available to buy the customer's goods.
3. A rider does not own the shopping principal. The rider receives limited authority to allocate an order's shopping budget to verified merchants.
4. Peebee Merchant will onboard the approved retail categories listed in section 7.1. Restaurants remain in the dedicated Peebee Restaurant app. Informal market vendors move to a later Merchant Lite rollout.
5. A merchant payment is primarily an internal allocation from an order balance to a merchant payable balance. It should not trigger a Mobile Money transfer for every purchase.
6. Merchant withdrawals remain available, but merchants should be encouraged to batch settlements. Instant settlement may carry a disclosed fee; scheduled settlement may be free or subsidized.
7. Rider withdrawals remain available for delivery earnings, reimbursements, tips, and bonuses. Shopping principal should increasingly bypass the rider wallet.
8. At launch, a rider may have only one active funded shopping order.
9. A rider cannot receive or apply for another order until the current order is delivered and customer-confirmed, or reaches another support-approved terminal state.
10. Completion cannot rely only on the rider pressing a button. Customer handover confirmation is required, normally through a PIN.
11. Rider and merchant KYC will be strong and risk-based.
12. Incentive farming involving coordinated customer, rider, and merchant accounts must be explicitly detected and prevented.
13. Peebee should use licensed payment providers for custody and settlement. The Peebee database mirrors obligations; it must not create unbacked money.

## 3. The problem being solved

The naive flow creates repeated fee leakage:

```text
Customer MoMo -> payment provider -> Peebee -> rider MoMo -> cash withdrawal -> merchant
```

Possible costs include:

- The customer's network or bill-payment charge.
- Provider collection fees.
- Peebee's service fee or commission.
- Provider outbound/disbursement fees.
- Mobile-network bulk-payment charges.
- Rider agent-withdrawal fees.
- Cash-withdrawal excise duty.

If those costs are taken from the shopping principal, a customer who budgets UGX 50,000 will not receive UGX 50,000 of goods. Peebee must either gross up the collection, absorb the cost, or remove unnecessary money movements.

The target model removes the rider cash-out step for participating merchants.

## 4. Target money flow

```text
Customer pays once
        |
        v
Licensed provider holds Peebee's collected funds
        |
        v
Peebee order spending balance
        |
        +---- Rider authorizes UGX 30,000 ---> Merchant A payable
        |
        +---- Rider authorizes UGX 15,000 ---> Merchant B payable
        |
        +---- Rider authorizes  UGX 5,000 ---> Merchant C payable
        |
        v
Unused order balance is reconciled or returned

Merchant payables -> batched/instant provider settlement -> merchant MoMo/bank
Delivery earnings -> rider earnings balance -> rider MoMo withdrawal
```

Internal allocations must not cause external provider fees. External fees should normally occur only on customer collection and merchant/rider settlement.

## 5. Terminology

- **Shopping principal:** Money intended exclusively to purchase the customer's goods.
- **Order spending balance:** The remaining shopping principal available for an order.
- **Merchant payable:** Peebee's recorded obligation to a merchant after a valid purchase.
- **Rider earnings:** Delivery earnings, tips, bonuses, and approved reimbursements owned by the rider.
- **Pending balance:** Recorded value that cannot yet be withdrawn because a risk or settlement condition remains.
- **Available balance:** Backed value that is eligible for settlement or withdrawal.
- **Settlement:** Moving actual funds through a licensed provider to a merchant or rider destination.
- **Shopping advance:** A controlled exception allowing a rider to receive funds where no participating merchant is available.
- **Provider clearing balance:** Peebee's mirrored record of money collected or paid through a provider.

Avoid describing Peebee balances as independent digital currency. Until the legal structure is approved, they are accounting records for customer order funds and amounts payable.

## 6. Order and rider state rules

### 6.1 One-active-order launch rule

A rider may have only one active funded shopping order. The rider is ineligible for new orders until the current one reaches one of these states:

- Delivered and confirmed by the customer.
- Cancelled before shopping begins.
- Goods returned and affected merchant payments reversed.
- Customer unavailable, with a support-approved reschedule or return flow.
- Dispute resolved and the order administratively closed.

The rider must not become permanently trapped when a customer is unavailable. Every non-standard terminal state needs evidence, a timeout, and an auditable support override.

### 6.2 Customer confirmation

- The normal completion proof is a customer handover PIN.
- The rider cannot generate, view, or override the customer's PIN.
- A support fallback may use delivery GPS, timestamped evidence, chat/call history, and an administrator decision.
- Rider delivery earnings are released only after completion is verified.

### 6.3 Future concurrency

Multiple simultaneous orders are not part of the launch scope. Later, trusted riders may receive a capacity of two or more orders, with completely separate spending balances and risk limits.

## 7. Merchant product

The general retail product is branded as **Peebee Merchant**. Restaurants retain the dedicated **Peebee Restaurant** app and onboarding flow. Restaurant balances may use the shared merchant ledger internally, but Restaurant must not appear as a selectable category in Peebee Merchant.

### 7.1 Merchant capabilities

The approved public onboarding categories, in display order, are:

1. Supermarket
2. Retail Shop
3. Boutique
4. Convenience Store / Mini-Mart
5. Pharmacy & Health
6. Electronics & Appliances
7. Beauty & Cosmetics
8. Bakery & Confectionery
9. Butchery & Fresh Meat
10. Liquor, Wine & Spirits
11. Hardware & Home Improvement
12. Stationery & Bookstore
13. Furniture & Home Decor
14. Pet Store & Agrovet
15. Jewelry & Accessories
16. Auto Parts & Accessories
17. Florist & Gift Shop

This taxonomy is the source of truth for new general-merchant applications. Internal finance categories and historical records must not be exposed automatically in onboarding.

- Merchant onboarding and KYC.
- Business/store profile and one or more locations.
- Owner and staff roles.
- Static merchant QR and merchant code.
- Dynamic payment request with amount and expiry.
- Immediate server-confirmed sale notification.
- Pending and available balances.
- Transaction and receipt history.
- Refund/reversal workflow.
- Settlement schedule and withdrawal destination.
- Instant withdrawal with disclosed cost.
- Support and dispute history.
- Optional catalog, stock, and order-management features later.

### 7.2 Merchant Lite

Not every market vendor should be forced to install a large application. Merchant Lite should support:

- A printed static QR code.
- A short merchant code.
- SMS confirmation.
- A lightweight PWA.
- USSD or assisted onboarding where commercially practical.

A static QR identifies the merchant; it does not itself prove the transaction amount. The rider enters the amount and both sides receive server confirmation.

## 8. Rider-to-merchant purchase protocol

1. Customer payment is verified and the order spending balance becomes funded.
2. The assigned rider enters the shopping stage.
3. Merchant generates a dynamic request or presents a static merchant identity.
4. Rider scans or enters the merchant code.
5. Peebee displays merchant identity, purchase amount, order reference, and remaining budget.
6. Rider confirms the purchase.
7. Peebee atomically debits the order spending balance and creates an irrevocable merchant payable. Low-risk purchases become available immediately; specifically flagged purchases enter a visible risk hold.
8. Peebee issues an immutable transaction reference.
9. Merchant receives confirmation directly from Peebee, never from a rider screenshot.
10. Customer immediately sees the merchant, amount, timestamp, and remaining shopping balance.
11. Rider attaches a receipt or item evidence where required.

### 8.1 Required authorization checks

A merchant purchase is allowed only when:

- The customer collection is successful and verified.
- The order environment and payment environment match.
- The rider is assigned to that order.
- The order is in an allowed shopping state.
- The merchant and location are active and verified.
- The merchant is not the rider or a prohibited related account.
- The amount is positive and does not exceed the remaining shopping balance.
- The request nonce is valid, unused, and unexpired.
- The same purchase reference has not already been applied.
- Customer approval exists for any substitution or budget increase that requires it.
- Location, device, and velocity checks pass or the transaction is routed for review. Fifty metres is a positive proximity signal, not a universal hard gate; accuracy, freshness, evidence, and clearly remote scans determine the action.

### 8.2 Prohibited merchant transactions

- Cash back.
- Payments without a funded order.
- Payments above the order's remaining budget.
- Rider self-payments or payments to related accounts.
- Reusing a payment code or reference.
- Splitting transactions solely to evade limits.
- Merchant-to-rider refunds outside the Peebee reversal process.

## 9. Ledger and reconciliation requirements

Peebee needs a double-entry ledger before merchant balances are introduced. Mutable balance columns alone are not sufficient for marketplace settlement.

### 9.1 Minimum ledger accounts

- Provider clearing by provider, currency, and environment.
- Customer order funds.
- Order spending balance.
- Merchant pending payable.
- Merchant available payable.
- Rider pending earnings.
- Rider available earnings.
- Platform service-fee revenue.
- Provider and network fees.
- Refunds and disputes.
- Promotional expense and promotional clawbacks.
- Risk reserve or loss account.

Every entry must balance, use integer UGX amounts, have an idempotency key, identify its source event, and retain an immutable audit trail.

### 9.2 Example ledger movements

Customer collection verified:

```text
Increase provider clearing asset
Increase customer order-funds liability
```

Merchant purchase:

```text
Decrease order spending liability
Increase merchant pending payable
```

Merchant settlement:

```text
Decrease merchant available payable
Decrease provider clearing asset
```

Order completion:

```text
Increase rider delivery-earnings payable
Recognize Peebee revenue according to the locked order fee schedule
Reconcile or return unused shopping principal
```

### 9.3 Daily reconciliation

For every provider and environment:

```text
Opening provider balance
+ verified collections
- verified external payouts
- provider fees
- refunds and chargebacks
= expected closing provider balance
```

The expected closing balance must reconcile to provider statements and Peebee's outstanding customer, merchant, and rider obligations. Any difference should stop or limit withdrawals until reviewed.

## 10. Fee policy

### 10.1 Protected shopping principal

Provider fees, Peebee commission, delivery commission, cash-out charges, and withdrawal tax cannot be deducted from the shopping principal without an explicit customer-approved budget change.

### 10.2 Recommended allocation

- Customer network payment charge: normally charged by the customer's network.
- Collection cost: recovered through a customer transaction/processing fee or absorbed by Peebee.
- Peebee service fee: a transparent customer line item or agreed merchant commission.
- Merchant allocation: no external fee when it is an internal ledger movement.
- Merchant settlement: merchant pays instant-settlement cost; scheduled settlement may be subsidized.
- Rider shopping cash-out: customer/Peebee covers it when cash is necessary to fulfil the order.
- Rider earnings cash-out: rider pays instant-withdrawal cost; scheduled settlement may be subsidized.
- Delivery commission: applied only to delivery earnings, never to item cost.

### 10.3 Gross-up

When a provider charges a percentage against the collected total, the required customer charge is calculated by grossing up rather than merely adding the percentage:

```text
gross collection = required net proceeds / (1 - collection rate)
```

Tiered and fixed costs are added to required net proceeds before the percentage gross-up. All fee schedules must be versioned with effective dates so an order keeps the pricing accepted at checkout.

### 10.4 Customer disclosure

Checkout should distinguish at least:

- Items budget.
- Delivery fee.
- Peebee service fee.
- Payment/cash-access fee where applicable.
- Total charged.

## 11. Merchant settlement policy

Merchant goods handover and customer delivery are separate obligations. Once the rider and merchant dual-confirm a legitimate goods handover, the merchant payable is created and normally becomes withdrawable immediately. It does not wait for customer delivery.

- Low-risk confirmed purchase: immediately available.
- Transaction with a specific fraud or evidence alert: held for auditable review.
- Provider payout submitted with an unknown outcome: remains in settlement transit and cannot be retried.
- Customer delivery failure after a legitimate merchant sale: handled against the rider, customer, platform risk reserve, insurance, or investigation outcome—not automatically charged back to the merchant.

If a legitimate merchant supplied goods and the rider later failed to deliver, the merchant should not automatically bear the loss. Recovery should come from the responsible rider, rider reserve, Peebee risk reserve, insurance, or an investigation outcome.

## 12. KYC and trust tiers

### 12.1 Rider KYC

- Government-issued identity and NIN validation.
- Face/selfie and liveness verification where available.
- Verified Mobile Money payout number ownership.
- Address and emergency-contact verification.
- Device binding and account-recovery controls.
- References, training, and operational approval.
- Risk-based order-value and concurrency limits.
- Re-verification after material account changes.

### 12.2 Merchant KYC

Merchant Lite may begin with:

- Government-issued identity and NIN.
- Verified phone number and settlement destination.
- Face/photo verification.
- Shop/stall photograph and geolocation.
- Market association or local reference where appropriate.
- Device binding.
- Low initial limits and delayed settlement.

Formal businesses may additionally provide:

- Business registration.
- Tax identification.
- Bank or business Mobile Money account.
- Beneficial owner information.
- Staff accounts and branch details.

Higher trust tiers receive higher limits and faster availability. KYC reduces anonymity but does not replace transaction controls.

## 13. Fraud and collusion controls

### 13.1 Rider-merchant collusion

A real customer-funded order can still be drained if a rider pays a colluding merchant without receiving goods. Controls include:

- One active funded shopping order per rider at launch.
- Order-value and merchant-payment limits.
- Merchant and rider proximity checks.
- Receipt or item evidence.
- Real-time customer payment notifications.
- New-merchant settlement holds.
- Related-party detection.
- No cash-back policy.
- Customer handover confirmation before rider earnings release.
- Account freezes and support review for undelivered funded orders.

### 13.2 Incentive farming

Threat: a coordinated customer, rider, and merchant circulate their own money through real-looking orders to collect referral rewards, subsidized delivery, promotional credits, ratings, or other benefits.

Promotional benefits must be granted only after external payment verification and successful customer-confirmed delivery. Qualification must consider linked identities and behavior.

Signals include:

- Shared device, device fingerprint, IP, or installation identifiers.
- Reused customer payment MSISDN and rider/merchant payout MSISDN.
- Shared identity, address, emergency contact, or beneficial owner.
- Customer, rider, and merchant repeatedly transacting only with each other.
- Repetitive order values, timing, items, routes, or merchant locations.
- Orders created and completed unusually quickly.
- Promotion value disproportionate to genuine commercial activity.
- Merchant payments immediately followed by withdrawals.
- Multiple accounts controlled from one device or location.
- Failed deliveries or reversals after rewards are issued.

Controls:

- Delay promotional rewards until the order is settled and outside the immediate dispute window.
- Cap rewards per person, device, household, payment number, merchant, and time period.
- Exclude related-party and self-funded transactions.
- Apply a cooling period to new accounts.
- Require minimum genuine spend excluding fees and promotional value.
- Keep promotions in a separate non-withdrawable ledger until vested.
- Support reward reversal and clawback.
- Freeze linked accounts during investigation.
- Record every eligibility decision and contributing signal.
- Provide an appeal and manual-review process.

Promotional loss limits must be configurable independently from ordinary order limits.

### 13.3 Other threats

- Stolen customer Mobile Money credentials.
- Account takeover after KYC.
- Merchant code substitution.
- Replay and duplicate requests.
- Fake or altered receipts.
- Refund abuse.
- Settlement-destination changes immediately before withdrawal.
- Provider webhook forgery.
- Administrator abuse.

Sensitive changes require step-up authentication, notifications, cooling periods, and immutable audit records.

## 14. Disputes, returns, and exceptions

Every money-moving action needs a reversal model.

- Merchant entered wrong amount before rider confirmation: cancel request.
- Wrong amount after confirmation but before settlement: controlled reversal.
- Goods returned: merchant-authorized reversal to the order balance.
- Partial fulfilment: partial reversal.
- Customer unavailable: reschedule, return goods, or support decision.
- Merchant supplied goods but rider failed to deliver: protect legitimate merchant and pursue rider/risk reserve.
- Customer disputes item quality: evidence-based support process; do not automatically reverse an unrelated delivery payment.
- Provider payout fails: restore payable balance exactly once.

No party should send money directly to another phone number to resolve an in-app dispute. All corrections must pass through Peebee's auditable reversal path.

## 15. Provider strategy and constraints

### 15.1 Current Peebee state

- Flutterwave uses V3 Standard Checkout for collections.
- The current Flutterwave adapter does not implement disbursements.
- Yo! Payments integration implements both `acdepositfunds` and `acwithdrawfunds`.
- Rider wallet settlement and withdrawal screens already exist.
- The current Peebee fee engine supports service fees, processing percentages, and delivery commission, but not provider-specific tiered payouts, agent cash-out tariffs, or tax gross-up.

Live withdrawal must never silently fall back to a mock provider. A missing real disbursement rail must fail closed and preserve the user's balance.

### 15.2 Flutterwave

Flutterwave split payments support marketplace subaccounts and can be useful when the seller is known before customer collection, such as a restaurant order. For general shopping, merchants and exact allocations are often unknown until the rider is shopping, so collection-time splits cannot fully implement the target flow.

Flutterwave payout subaccounts are currently documented as NGN-only and should not be assumed to support UGX merchant wallets.

### 15.3 Yo! Payments

Yo! Payments supports Mobile Money collection and disbursement. Its public subaccount description focuses on delegated account access, not clearly on independent marketplace merchant settlement. Peebee must obtain written confirmation of managed merchant/subaccount, API withdrawal, limits, fees, settlement, safeguarding, and reconciliation capabilities.

### 15.4 Provider due diligence

Before production merchant balances:

- Confirm Uganda marketplace/aggregator approval.
- Confirm whether customer funds are immediately available for payouts.
- Confirm merchant onboarding/KYC responsibilities.
- Confirm safeguarding and settlement-account structure.
- Confirm API collection and payout limits.
- Confirm exact negotiated fees and taxes.
- Confirm webhook signing and retry behavior.
- Confirm provider transaction-status query behavior. Webhooks are advisory; Peebee actively polls operations that remain pending for more than 120 seconds.
- Confirm chargeback, reversal, and dispute rules.
- Confirm static-IP or allowlisting requirements.
- Confirm service-level expectations and support escalation.
- Obtain legal advice on payment-service and stored-value implications.

## 16. Security and audit requirements

- Server-side authorization for every transaction.
- Idempotency keys for collection, purchase, reversal, and settlement.
- Signed and expiring merchant-payment requests.
- Verified provider webhooks with replay protection.
- No secret keys or provider credentials in customer, rider, or merchant clients.
- Encryption for sensitive identity and payout data.
- Role-based administrator permissions and approval thresholds.
- Dual approval for large manual adjustments or withdrawals.
- Append-only financial audit trail.
- Balance invariants checked continuously.
- Production and sandbox balances completely isolated.
- Alerting for reconciliation differences, unusual velocity, and failed payouts.

## 17. Proposed data model

Names are provisional; migrations must follow the repository's established conventions.

- `merchants`
- `merchant_locations`
- `merchant_staff`
- `merchant_kyc_cases`
- `merchant_payment_requests`
- `merchant_purchases`
- `merchant_settlement_accounts`
- `merchant_settlements`
- `ledger_accounts`
- `ledger_transactions`
- `ledger_entries`
- `order_spending_accounts`
- `payment_fee_schedules`
- `risk_decisions`
- `promotion_programs`
- `promotion_eligibility_events`
- `promotion_rewards`
- `disputes`
- `financial_adjustments`

Do not store a financial balance without also being able to reconstruct and verify it from immutable ledger entries.

## 18. Build sequence

### Phase 0 — Commercial, legal, and provider validation

- Obtain written Yo!/Flutterwave answers listed in provider due diligence.
- Decide provider custody and settlement architecture.
- Approve fee ownership and customer disclosures.
- Approve KYC tiers, retention, and privacy requirements.
- Establish initial order, merchant, settlement, and promotional risk limits.

Exit condition: finance, operations, compliance, and engineering agree on the legally supported money flow.

### Phase 1 — Financial foundation

- Build the double-entry ledger.
- Introduce order spending accounts.
- Separate shopping principal, rider earnings, platform revenue, and provider costs.
- Add idempotency and balance invariants.
- Add daily provider reconciliation.
- Remove all live-to-mock fallback behavior for money movement.

Exit condition: every existing collection, wallet credit, refund, and withdrawal can be represented and reconciled without unbacked balances.

### Phase 2 — Formal merchant identity

- Add merchant role, onboarding, KYC, stores, staff, settlement destinations, and trust tiers for smartphone-equipped formal merchants.
- Add static QR and merchant codes.
- Add merchant transaction notifications and basic transaction history.
- Add administrator KYC review and suspension controls.

Exit condition: a verified merchant can be identified reliably at a physical purchase location.

### Phase 3 — Rider-to-merchant purchasing

- Add dynamic payment requests and rider confirmation.
- Debit order spending balance and credit merchant pending payable atomically.
- Add customer real-time purchase feed and remaining budget.
- Add receipts, reversals, substitutions, and budget limits.
- Enforce one active funded shopping order per rider.

Exit condition: a complete multi-merchant shopping order can be fulfilled without sending shopping principal to the rider's Mobile Money wallet.

### Phase 4 — Merchant settlement

- Add pending-to-available policy.
- Add scheduled and instant settlement options.
- Integrate the approved real payout provider.
- Add payout status webhooks/polling and exactly-once failure restoration.
- Run a two-minute reconciliation heartbeat; actively query operations pending for 120 seconds and never retry an unknown disbursement.
- Add reconciliation and finance/admin reporting.

Exit condition: merchants can receive backed, auditable settlements without manual finance intervention.

### Phase 5 — Fraud, collusion, and incentives

- Build related-party and device-link analysis.
- Add risk rules, velocity limits, and settlement holds.
- Add promotion vesting, caps, non-withdrawable pending rewards, reversals, and clawbacks.
- Add investigation queues and account-link visualization.
- Add loss and fraud reporting.

Exit condition: incentives cannot be issued solely because an order record exists; they require verified external funding, genuine fulfilment signals, and successful delivery.

### Phase 6 — Merchant application and restaurant convergence

- Launch the dedicated Peebee Merchant application for smartphone-equipped formal merchants.
- Bring restaurant balances, settlement, staff, and reporting onto the same ledger.
- Add optional catalog, pricing, inventory, offers, and order management.
- Introduce Merchant Lite only after the formal-merchant financial flow is stable, using simplified KYC, static codes, SMS/lightweight confirmation, and lower limits.

Exit condition: restaurants and general merchants use one consistent financial and identity platform.

### Implementation snapshot — 2026-09-26

Implemented in the repository:

- Double-entry ledger, provider/environment segregation, order spending accounts, balance invariants, and financial operation locks.
- Formal merchant identity, private KYC-document upload, administrator review/activation, outlets, GPS coordinates, staff roles, and settlement destinations.
- Rider-to-merchant order allocations with exact-amount dual confirmation, budget enforcement, idempotency, proximity risk checks, customer-visible purchase records, and disputes.
- Merchant payable balances, settlement quotes/requests/history, fail-closed disbursement behavior, and webhook-plus-poller reconciliation.
- A dedicated installable Peebee Merchant web application covering onboarding, payments, transaction history, wallet, withdrawals, outlets, KYC, team management, and role-limited cashier access.
- A separately gated sandbox merchant environment enabled by default: it preserves KYC/admin approval, pending provider states, failures, reconciliation, and settlement history while forcing all money movement through the simulator and skipping only the 24-hour live destination cooldown.
- The executable sandbox walkthrough is documented in `docs/SANDBOX_MERCHANT_TESTING.md`.
- Restaurant finance endpoints use the same merchant ledger foundation; restaurant-specific interface convergence remains incremental product work.
- Administrator merchant/KYC controls, custody balances, reconciliation views, risk review, and financial controls.

Deliberately not live-enabled until operational prerequisites are complete:

- Licensed-provider confirmation of the Uganda custody/safeguarding and merchant-settlement model.
- Negotiated live UGX payout configuration, limits, fee schedules, and reconciliation credentials.
- Compliance approval of KYC, privacy, dispute, reserve, and settlement policies.
- Production deployment, migration, R2 KYC-document storage binding, and controlled pilot activation.
- Merchant Lite, SMS/USSD support, informal-market onboarding, advanced incentives, and multi-order rider capacity.

### Phase 7 — Scale and optimization

- Introduce carefully limited multi-order capacity for proven riders.
- Add smart settlement batching and negotiated fee routing.
- Add merchant digital reuse only after legal/provider approval.
- Add provider failover backed by real prefunded liquidity and reconciliation.
- Add advanced risk scoring and operational forecasting.

## 19. Launch acceptance criteria

The merchant-payment system cannot launch with real money until:

- No purchase can exceed verified customer-funded order money.
- Shopping principal cannot be consumed by platform or payout fees.
- Every financial mutation creates balanced immutable entries.
- Duplicate requests cannot double-charge or double-credit.
- The customer sees every merchant purchase promptly.
- The merchant receives confirmation directly from Peebee.
- The rider cannot take another funded order before the current one is resolved.
- Merchant and rider payout destinations are verified and protected by a cooling period after change.
- Failed settlements restore balances exactly once.
- Mock providers cannot process live-environment money movement.
- Provider statements reconcile to Peebee liabilities.
- Merchant and rider KYC, suspension, dispute, and appeal paths are operational.
- Promotion rewards have vesting, related-party checks, caps, and clawback support.
- Operations can freeze withdrawals without corrupting balances.
- Legal and provider approvals are documented.

## 20. Metrics and operating controls

- Customer collection success rate.
- Merchant-payment success rate.
- Median time from rider confirmation to merchant notification.
- Orders completed without rider cash withdrawal.
- External transaction cost as a percentage of GMV.
- Merchant settlement cost per sale and per settlement batch.
- Reconciliation difference by provider.
- Undelivered funded orders.
- Merchant-payment reversals and disputes.
- Rider-merchant related-party alerts.
- Promotional rewards issued, vested, reversed, and lost to abuse.
- Settlement failure and exactly-once restoration rate.
- Customer, rider, and merchant support cases per 1,000 orders.

## 21. Open decisions

- Which provider will custody and settle UGX merchant funds?
- Will Peebee charge the customer, merchant, or a combination for payment processing?
- What scheduled settlement cadence will be free or subsidized?
- What instant settlement fee will apply?
- What initial merchant and rider transaction limits will apply?
- What review SLA and evidence standard will apply to specifically risk-held purchases?
- What rider reserve, insurance, or risk-fund mechanism covers non-delivery after a legitimate merchant sale?
- Which KYC vendor or verification process will be used?
- Which merchant categories require formal registration versus Merchant Lite KYC?
- What evidence is mandatory for a merchant purchase and a support override?
- How are unused shopping balances returned or retained with customer consent?
- What promotion types will exist, and what are their vesting and clawback rules?

## 22. Reference material

Checked on 2026-09-25:

- Flutterwave split payments: https://developer.flutterwave.com/docs/split-payments
- Flutterwave settlements: https://developer.flutterwave.com/docs/settlements
- Flutterwave mobile-money transfers: https://developer.flutterwave.com/docs/mobile-money
- Flutterwave payout subaccounts: https://developer.flutterwave.com/docs/payout-subaccount
- Yo! Payments account and transaction fees: https://paymentsweb.yo.co.ug/index.php/how-it-works
- Yo! Payments subaccounts: https://paymentsweb.yo.co.ug/index.php/features/72-sub-accounts
- Yo! Payments user agreement: https://www.yo.co.ug/?page_id=106
- Official Yo! Payments API library: https://github.com/YO-Uganda/YoPaymentsPHP/blob/master/YoAPI.php
- MTN Uganda Mobile Money tariffs: https://www.mtn.co.ug/tariffs/mobile-money-tariffs/
- Uganda Revenue Authority 2024/25 tax amendments: https://ura.go.ug/wp-content/uploads/2024/06/Tax-amendments-2024-25-1.pdf

## 23. Decision log

### 2026-09-25

- Adopt merchant-directed shopping payments as the target architecture.
- Protect shopping principal from all fees and commissions.
- Keep rider withdrawal for earnings and exception-based shopping advances.
- Enforce one active funded shopping order per rider at launch.
- Require customer-confirmed delivery before normal order completion.
- Apply strong, tiered rider and merchant KYC.
- Treat incentive farming as a first-class fraud threat involving linked customer, rider, and merchant identities.
- Build the financial ledger and provider controls before merchant balances or promotions.
- Make the merchant payable available after dual-confirmed goods handover rather than customer delivery, except for transaction-specific risk holds.
- Use webhook-plus-poller reconciliation with a 120-second first active query and no retry while a disbursement outcome is unknown.
- Launch formal merchants first and defer informal sellers to Merchant Lite.
- Require documented licensed-provider custody/safeguarding approval before enabling live merchant payments.
- Use GPS proximity as an accuracy-aware risk signal; reject clearly remote accurate scans, but do not make 50 metres a brittle universal gate.

### 2026-09-26

- Implement a dedicated Peebee Merchant application for formal merchants rather than extending Merchant Lite first.
- Keep cashiers outlet-scoped and exclude them from balances, withdrawals, KYC, team administration, and dispute creation.
- Require business registration, tax identification, owner identity, and business-registration evidence before administrator activation.
- Keep all live merchant-money features behind an explicit feature flag until provider, legal, and compliance prerequisites are documented.
