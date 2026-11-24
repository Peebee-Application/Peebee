# Taxibee implementation checklist

Work from the current `origin/main` on focused branches. Keep the existing UI
and practice preview intact. Implement live behavior through Peebee's shared API,
services, database and Admin controls; do not claim preview behavior is a live
integration.

Status key: `[ ]` not started, `[~]` implementation in progress or awaiting
verification, `[x]` implemented in the current branch (release checks may remain).

## Production readiness

- [~] Verify production Google sign-in origin and provider configuration. On
  2026-11-24, the public API returned a configured Google client ID; the Google
  Console authorized-origin list and a real customer sign-in still need provider
  console/operator verification.
- [ ] Verify configured email, SMS, push, audio-call, and support/safety contact
  delivery; document failures and operator follow-up.
- [ ] Decide wallet PIN and auto-pay policy with the product/finance owners, then
  enforce approved rules in shared payment APIs and Admin controls.
- [x] Verify current future-departure switch and public schedule inventory:
  production Taxipress is disabled, scheduled departures are disabled, and no
  public departures are published (checked 2026-11-24). Staff configuration is
  still required before any schedule can be sold.

## Journey tools

- [x] Export calendar events for confirmed journeys using authoritative departure
  times and Kampala timezone handling. In progress: paid scheduled tickets and
  current stage bookings with an explicitly estimated departure time.
- [~] Persist saved departures server-side per customer and environment, with
  device-local fallback until migration 0173 is applied; remove inactive queue
  entries from the customer list.
- [x] Add configurable vehicle, minimum-space and estimated-time filters over
  authoritative Peebee departure results. Filter preferences are per-account on
  this device; they never alter server availability or fares.

## Parcel parity

- [ ] Define declared-value cover, eligibility, limits, fees, claims and refund
  rules with the responsible operator/provider.
- [ ] Implement server-quoted, server-enforced parcel insurance and record the
  purchased cover on the shared order.
- [ ] Define and implement guaranteed priority departure eligibility, capacity,
  pricing, fulfillment, cancellation and refund rules.
- [ ] Keep both options unavailable in live checkout until backend enforcement
  and any required provider/coverage approval are verified.

## Charter parity

- [ ] Define fixed-day package duration, inclusions, availability, pricing,
  cancellation and refund rules.
- [ ] Implement fixed-day packages through shared Car/charter APIs and Admin.
- [ ] Define preferred-driver matching, substitution, response and refund rules;
  distinguish a preference from a confirmed guarantee.
- [ ] Implement only guarantees dispatch can enforce and verify end to end.

## Corporate billing extensions

- [ ] Finance review: bank invoice reconciliation, matching rules, audit trail,
  reversals and access controls.
- [ ] Legal/finance review: statutory invoice requirements and jurisdictional
  validation; do not label statements as tax invoices prematurely.
- [ ] Define mobile-money plus voucher split funding, consent, reconciliation,
  idempotency, retries and source-preserving refunds.
- [ ] Implement approved API, Admin and ledger changes; preserve existing company
  receivables, wallet repayments, voucher ownership and settlement behavior.

## Release per feature group

- [ ] Add coverage for ownership, authorization, stale quotes, retries, provider
  failures, refunds and migration fallback where applicable.
- [x] Run the journey-slice checks: API lint, Taxibee typecheck, unit tests,
  build, saved-departure integration coverage and the full browser suite.
- [ ] Commit and push from a clean task branch; open a PR and review its scope.
- [ ] Apply reviewed migrations explicitly when applicable, deploy shared services
  before Taxibee (explicit `apps=taxibee` workflow dispatch), and verify live
  behavior without creating unintended charges.
- [ ] Enable customer-facing options only after operating configuration and
  end-to-end verification are complete.
