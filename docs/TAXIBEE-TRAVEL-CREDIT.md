# Corporate travel credit and funded vouchers

This extends shared Peebee orders, payments, wallets and settlement. The replica
and isolated practice mode are preserved. Existing promotional offers remain
discounts; a prepaid travel voucher is a separately funded payment source.

## Rollout and approvals

Apply `apps/api/src/db/migrations/0170_travel_credit.sql` explicitly from reviewed,
clean main after 0169. Deploy API first, then Admin and Taxibee. New tables hold
accounts, members, vouchers, per-order allocations and an immutable transaction
ledger. The migration also replaces the return-refund trigger to avoid duplicate
traveller wallet credits. Existing records are not converted, credited or enrolled.
Hot paths guard the schema until migration. Both sales switches default off.

Admin → Taxipress → **Corporate credit & funded travel vouchers** requires
`payments.manage`. Configure availability, maximum new voucher amount and validity;
the amount limit defaults to zero. Create an inactive company account with its
verified Peebee customer owner and approved credit limit. Activate it separately,
then authorize each traveller with per-booking and monthly budgets. Both budgets
default to zero. Spending uses the Kampala calendar month and net charges after
refunds. A return bundle's complete total counts against its per-booking budget.
Staff changes are activity-logged. Suspension blocks new spending while refunds
and repayment remain available. Rollout does not enable routes or service switches.

## Accounting

Corporate funding records a **receivable**, not a bank/mobile-money receipt.
Peebee fronts the quoted fare under the approved limit. Each `corporate_credit`
authorization funds its order so the existing boarding/trip settlement pays drivers
normally. The owner reviews the statement and repays from their primary Peebee cash
wallet. Repayment atomically debits real funds with an idempotent reference. A refund
after repayment remains company credit (negative outstanding), never traveller cash.
There is no claim of external bank invoice reconciliation, statutory invoice
generation, automatic debt collection or interest.

Voucher issuance atomically debits the issuer's primary cash wallet. Codes are
random and stored hashed; only the named recipient can spend them. Recipients can
select assigned vouchers without retaining a code. Any fare beyond voucher value
is paid from the recipient's primary wallet in the same transaction. Mobile-money
split funding is not offered. Unused value returns only to the issuer on cancellation
or expiry, including later booking refunds to a closed voucher. The Worker sweep
and voucher-list reads perform expiry. Promotional wallet credit is not spent on
issuance or corporate repayment.

Final review shows the complete fare, sponsored allocation and wallet remainder.
Both total and sponsored amount must still match at funding. All grouped orders,
limits, debits, collections, fees and ledger entries commit atomically. Return legs
remain independent settlement allocations; redemption does not charge again.
Cancellation refunds under existing policy, split proportionally using cumulative
rounding: company credit returns to the company, voucher value to voucher/issuer,
and only the original wallet-funded share becomes traveller cash. The generic
parcel/hire cancellation path and unused-return trigger skip their old duplicate
wallet credit. Ordinary wallet/mobile refunds retain their existing path.

Quoted fares use the wallet fee schedule and do not stack promotional offer codes.
Extra waiting/cancellation/service charges retain the shared trip's existing terms
and traveller-wallet payment path; approval covers the reviewed fare, not unlimited
extras. Existing matching, relay pay-before-rider, capacity, boarding and scheduling
rules remain authoritative. Shopping orders are excluded. No corporate account or
voucher promises a driver, departure or additional capacity.

## Ownership review and checks

D1 is SQLite-based and has no PostgreSQL-style native row-level security policies.
Isolation is enforced by verified-token middleware, bound owner/environment
predicates, membership checks and transactional constraints. Parameterization alone
is not authorization. Statements/repayment require the owner; finance staff need
`payments.manage`. Travellers see usable budgets, not the company's debt/credit
limit. Voucher lists require issuer/recipient identity; cancellation requires the
issuer and spending requires the named recipient. Conditional funding repeats
customer/environment predicates. Live/sandbox funds and entitlements are separate.
Statements explicitly show the most recent 500 ledger entries and are not presented
as complete historical tax invoices.

Tests cover foreign orders/statements, staff permissions, revoked membership,
sandbox separation, budgets, concurrent spending, retries, frozen wallet remainders,
changed funding consent, full driver settlement, proportional refunds, unused
returns, generic parcel/hire cancellation, repayments and expiry. Browser fixtures
cover review, renewed consent and mobile/desktop management. No production money,
booking, account approval or voucher is created merely for release verification.

Future-departure scheduling begins only after this feature is tested, merged,
deployed and verified live.
