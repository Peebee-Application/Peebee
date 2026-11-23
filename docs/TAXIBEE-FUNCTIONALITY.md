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
| Departure selection | Route/direction/vehicle selection uses current queue IDs and running routes, never source demo routes or fallback departures. |
| Passengers | Adult/child counters follow available capacity and admin booking/lap rules. Optional child seats are priced and persisted by the shared API; old clients retain the default lap policy. Traveller details include an entered emergency contact. |
| Numbered seats and holds | New departures with a staff-verified 14/18-seat layout use real numbered inventory. Atomic account-owned holds expire, one selection per customer; driver/walk-up seats and other tickets cannot be selected. Best available assigns real numbers without a choice fee. Chosen numbers/fees appear on tickets, downloads and the driver manifest. Reassignment preserves chosen numbers or refunds the whole booking when none can honour them; open tickets use automatic allocation. |
| Luggage | Only offered types appear. Prices and disabled state follow admin config. Items assessed at the stage have no invented up-front price. |
| Open tickets | Existing open-ticket option, exposed only when enabled and the shared API is ready. This is not a discounted return package. |
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

## Remaining production parity work

The following work is still required. Keep it out of live success paths until
the server can enforce it, while leaving the practice flows available.

1. **Return packages:** server quote and linked outbound/return entitlement,
   configured discounts/expiry, route/direction validity, date changes,
   redemption and partial cancellation/refund accounting. Two unrelated bookings
   must not be advertised as an atomic prepaid return package.
2. **Parcel parity beyond shared delivery:** declared-value insurance and guaranteed
   priority departures still need backend rules. Shared direct/relay quotes, real
   orders, collection/delivery codes, photos, checkout, chat and status are connected.
3. **Charter parity beyond Peebee Car:** fixed-day packages and preferred-driver
   guarantees still need backend rules. Approved category booking, optional luxury
   chauffeur hours, configured scheduled pickup, assignment and checkout are connected.
4. **Corporate and voucher parity:** shared offers are connected, but the
   prototype's corporate account/credit and voucher settlement models are not.
   They need real account authorization, limits, eligibility and accounting.
5. **Remaining account capabilities:** production Google origin/provider verification,
   profile photos and verified contact changes, wallet PIN/auto-pay policies,
   browser push/preference integration, session/security history, and verified
   support/safety contacts. About links to Peebee's published legal/privacy pages.
6. **Remaining journey tools:** real scheduled dates/calendar export, saved
   departure persistence, configurable search filters, chat media and in-app
   call controls, formal lost-property/support-case workflows and attachments.
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
