# Taxibee functional rollout

The customer UI and committed artwork remain the replica. `/?preview=1` is
**practice mode**: sample people, balances, locations and simulated outcomes;
no production account API requests, bookings or payments. Practice can be
restarted without changing a customer's live account.

This is a staged implementation, not a claim that every prototype control
has a production backend. All live work uses Peebee's existing API, identities,
wallet, admin settings and database. Do not create an independent Taxibee backend.

## First functional release

These changes are implemented on `codex/taxibee-live-features`; release evidence
belongs in the PR. A feature being wired does not mean an administrator has
enabled it, a provider is configured, or a real production payment was tested.

| Area | Live implementation and authority |
| --- | --- |
| Public access and authentication | Public home, route browsing and booking preparation; on-demand Customer-style Google or email/phone login/signup using existing Peebee identities. Password reset/change and phone/email verification use shared auth endpoints. Booking requires authentication; sign-in alone never books or pays. |
| Booking progress | Tab session storage preserves allowlisted choices through reload and sign-in; account ownership prevents restoring another customer's draft. Prices/capacity are refreshed, payment consent is cleared, and signing out removes the draft. |
| Screenshots and printing | No protection overlay, blur/focus/visibility hiding or print blocking in live or practice. |
| Departure selection | Current route and queue browsing uses live TaxiPress inventory. Staff-published future departures reserve separate capacity and convert into ordinary queue bookings only when the assigned driver checks in. See the [future departure rollout](TAXIBEE-FUTURE-DEPARTURES.md); its sale switch defaults off. |
| Passengers | Adult/child counters follow available capacity and admin booking/lap rules. Optional child seats are priced and persisted by the shared API; old clients retain the default lap policy. Traveller details include an entered emergency contact. |
| Numbered seats and holds | New departures with a staff-verified 14/18-seat layout use real numbered inventory. Atomic account-owned holds expire, one selection per customer; driver/walk-up seats and other tickets cannot be selected. Best available assigns real numbers without a choice fee. Chosen numbers/fees appear on tickets, downloads and the driver manifest. Reassignment preserves chosen numbers or refunds the whole booking when none can honour them; open tickets use automatic allocation. |
| Luggage | Only offered types appear. Prices and disabled state follow admin config. Items assessed at the stage have no invented up-front price. |
| Open tickets | Existing open-ticket option, exposed only when enabled and the shared API is ready. This is not a discounted return package. |
| Bundled returns | Server-issued quote and linked outbound/return allocations; one wallet debit or provider collection. Open, same-day and date-specific conditions use Kampala dates. Paid returns are redeemed on the reverse route after outbound boarding against real capacity, without another charge. Date changes stay within original validity; unused-return cancellation/expiry refunds its own allocation under the snapshotted admin policy. |
| Offers | Account-eligible offers come from Peebee; entered codes go to server-side payment eligibility/pricing. No client-side discount or fake corporate credit. |
| Tickets | Server codes, printable downloadable ticket, public code-status page, ticket sending, shared-account persistence, receipt link and cancellation. Downloads record their time; current server status determines boarding. |
| Driver | Real public profile fields, booking-assigned phone link and persisted order chat. Missing data is omitted; demo identities and ratings are not substituted. |
| Tracking | New authenticated booking tracking endpoint. Buyer/authorized recipient only; admin-controlled enablement, refresh and stale-location policy; active trips only. No synthetic motion or traffic. |
| Wallet | Balance/history/top-up; wallet funding supplies the shared API's required `useWallet` flag; recipient lookup and explicit transfer review/confirmation; stable idempotency key on an uncertain retry; CSV statement from real ledger entries. |
| Notifications | Wallet alerts and actual booking statuses; marking wallet alerts read calls the shared API. |
| Support | Existing customer support service, AI/staff handoff, persisted conversation, ending/restarting chat, visitor/account-scoped session capability. Admin availability is respected. |
| Contacts and settings | Shared saved passengers/pickup points; display settings persist on this device per customer. Completed journeys may be rated through their shared order. |

The initial public-access release needed no migration. Optional child-seat selections
use the existing details columns or their established pre-migration fallback.
The tracking endpoint reads existing queue location columns. Existing pricing,
ownership and settlement rules remain authoritative.

### Numbered-seat rollout

Apply **`0168_taxipress_numbered_seats.sql`** explicitly through the existing
reviewed database-migration workflow on clean main. App deployment never runs
SQL migrations. This additive migration creates inventory/hold tables and
transactional constraints, adds the booking allocation reference and a taxi
layout-approval flag. Until it is applied, normal bookings keep working and
numbered selection is unavailable. Existing departures are never backfilled.

In Admin → Taxipress, set the hold duration (30–900 seconds), fee per chosen seat
and master numbered-seat switch. In Taxis, approve each vehicle's numbered
layout after checking it against the existing 14/18-seat diagram. Both switches
default off. Only that taxi's next departure receives a numbered inventory;
changing settings does not renumber an active trip. Bookings from older apps
get automatic numbers on those departures, without a seat-choice fee.
Changing a vehicle's plate, route or layout clears its numbered-layout approval.
Drivers see stage-sale seat numbers and can release the exact stage seat when
its passenger leaves. Chosen seats move only onto the same verified layout,
with all chosen numbers available; otherwise the booking is refunded in full.

An unpaid confirmed booking retains the existing admin payment deadline;
selection holds have their separate, shorter deadline. Cancellation, no-show,
abandoned order creation and taxi removal release claims without double-selling.
Open tickets cannot buy a numbered-seat preference: their automatic allocation
may change when redeemed on another taxi. Numbered seats held by another account
are shown unavailable, without exposing account identities or hold capabilities.

Release order: review/merge, explicit migration, shared API, Admin, customer and
partner ticket/manifest surfaces, then Taxibee. Existing service switches and
routes remain under the operator's control. No production seats or payments
are created merely to demonstrate this feature.

### Bundled-return rollout

Apply **`0169_taxipress_return_packages.sql`** explicitly on reviewed clean main,
after 0168. It adds the entitlement table, booking references and transactional
link/refund constraints; deployment does not apply migrations. Older bookings and
the ordinary booking/payment paths remain usable before it lands.

In Admin → Taxipress, configure **Prepaid return packages**, the existing fare
discount, validity days and unused-return refund percentage. The new sales switch
defaults off. Both directions of the same enabled Relay route need active
TaxiPress fares. No service, route or driver is activated by this migration.
Turning off new sales does not remove customers' existing paid entitlements.

Discounts apply to each direction's real passenger fare; luggage is charged for
both journeys and any selected-seat fee applies only outbound. The confirmation
shows each allocation, payment-method total and refund conditions before consent.
Pay using the customer's primary Peebee wallet or one mobile/card provider
collection; Taxibee exposes wallet and mobile money. Cash, stacked offers, other
wallets and open-ticket checkout are excluded from this prepaid product.
The fare has a structural minimum of UGX 1 per leg for payment accounting.

An unused return waits outside ride matching. After outbound boarding, customers
choose a current taxi on the exact reverse direction. Return seats receive
best-available numbers where enabled, with no extra seat-choice charge. This
reserves current capacity, never a future taxi or calendar departure. Same-day
and selected-date returns expire at the end of their Kampala travel day; open
returns expire under admin validity. Date changes cannot extend the original
deadline. Cancellation and expiry credit the unused return's net collection
times the quoted refund percentage to the same customer's wallet/environment.
Each boarded leg settles independently through existing TaxiPress accounting.
Taxi removal that cannot reassign the outbound refunds the unused return in full.

Creation replays the quote ID instead of making duplicate bookings; payment
reservations prevent double charges. Wallet allocations/debit commit atomically;
provider reconciliation resolves linked allocations together. Pending provider
approval blocks cancellation. Interrupted redemption leases recover on cleanup;
only the current lease can publish a return booking. Expiry runs through the
existing TaxiPress cleanup and entitlement-list reads. No live transaction is
created merely to demonstrate this rollout.

Release order: explicit migration, API, Admin and Taxibee. Keep the shared
database, operator settings and practice interface intact. Confirmed sandbox
provider checks do not substitute for production merchant/provider approval.

## Remaining production parity work

The following work is still required. Keep it out of live success paths until
the server can enforce it, while leaving the practice flows available.

1. **Parcel parity beyond shared delivery:** declared-value insurance and guaranteed
   priority departures still need backend rules. Shared direct/relay quotes, real
   orders, collection/delivery codes, photos, checkout, chat and status are connected.
2. **Charter parity beyond Peebee Car:** fixed-day packages and preferred-driver
   guarantees still need backend rules. Approved category booking, optional luxury
   chauffeur hours, configured scheduled pickup, assignment and checkout are connected.
3. **Corporate billing extensions:** staff-approved accounts, traveller budgets,
   wallet repayment and funded named vouchers use the shared API. See the
   [travel-credit rollout](TAXIBEE-TRAVEL-CREDIT.md) for migration 0170 and
   activation. External bank invoice reconciliation, statutory invoices and
   mobile-money voucher split funding are not claimed.
4. **Remaining account capabilities:** production Google origin/provider verification,
   wallet PIN/auto-pay policies, provider delivery and operational verification of
   configured support/safety contacts. Profile photos, verified contact changes,
   observed device-session management and browser push preferences are connected. About links to Peebee's published legal/privacy pages.
5. **Remaining journey tools:** calendar export, saved current-departure
   persistence and configurable search filters. Chat image/voice media,
   real-provider in-app calls and owned lost-property case workflows are connected.
   A saved address is not a new TaxiPress stop or an arbitrary pickup promise.

## Validation and release

- `pnpm --filter api lint`
- Existing Taxipress integration suites plus passenger-pricing tests
- `pnpm --filter taxibee typecheck`, `pnpm test:taxibee`, `pnpm build:taxibee`
- `pnpm --filter taxibee test:browser` uses API fixtures, including interrupted
  transfer retries, public access, Google/email/phone account flows, saved
  booking choices, screenshots/printing, support capabilities and late responses
  after sign-out. CI runs this suite against a local Worker.
- No live money is spent by these tests. Authenticated production/provider
  settlement still needs separate operational verification.
- Review and merge through PR; deploy the shared API first, then Taxibee, from
  clean current `main` through the existing preflight. Select only the intended
  apps in the existing deployment workflow; do not redeploy unrelated apps.

### Parcel and charter integration

No migration or new admin policy is introduced. The public service catalogue respects
existing parcel/ride, relay, Car, luxury and scheduling switches and fleet visibility.
Only approved passenger inventory is offered. Price calculation reuses shared relay
and car formulas; confirmation re-quotes, and payment separately rechecks checkout.
Anonymous progress survives sign-in/reload, with fresh consent; signing out clears
private progress, photos and late responses. A lost creation response requires
checking shared history before a separate new request.

Validation adds `src/taxibee/services.integration.test.ts` (public settings, pricing,
inventory visibility and history ownership) and `scripts/services-smoke.mjs`
(guest preparation, login, relay collection, wallet/mobile money, actual photo/chat
APIs, reload and interrupted-write recovery, scheduled hourly hire and sign-out).
Browser fixtures do not establish live driver availability or provider settlement.

### Account and communications rollout

Apply `0171_customer_account_tools.sql` explicitly. It adds session observations,
contact-change challenges, account push preferences, lost-property case/event/file
tables and optional `push_subscriptions.session_jti`. Existing hot paths check schema
availability and keep their previous behaviour until migration. Session observations
are best-effort and never replace the existing revocation mechanism. Push unregister
is now owner-scoped; registered revoked tokens are excluded from push delivery.

Admin → Customer account and support tools controls switches, OTP limits, polling,
attachment/report limits, session retention and support/safety contacts. Existing Calls
settings choose the real audio provider; mock is never presented as live audio. VAPID
and email/SMS provider credentials are reused, never generated or copied to the browser.
Tests cover account ownership/revocation, new-contact OTP proof, private files,
optimistic staff updates, schema fallback and push filtering. Browser tests use API
fixtures and real Chromium microphone/WebRTC test media; they spend no live money
and do not establish live provider delivery.
