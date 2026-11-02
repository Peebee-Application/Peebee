# Merchant completion tracker

Scope: finish the merchant workflows identified after PRs 330 and 333. Advertising has two equally important merchant-selectable routes: Peebee placements and external ads. External integrations cover both Meta (Facebook/Instagram) and Google Ads (user decisions, 2026-11-02). Existing contributor work on main is preserved.

## Shared promotion source

Create content once: an ad creative, publication/post or store item is a canonical owned source, promotable to Peebee, Meta and Google Ads, individually or together. Campaigns reference that source rather than requiring merchants to recreate it for each destination. Store the reviewed content revision/snapshot on each delivery so editing the source cannot silently replace approved or running ads. Verify source ownership and publication eligibility server-side. Each destination has independent audience, budget/currency, account, provider-specific creative adjustments, moderation, remote IDs, delivery status and measured results. Pause, rejection or retry on one destination must not change another destination. Expose genuine partial success and let merchants retry only failed deliveries. Repeated submission must not create duplicate remote campaigns or duplicate charges.

## Delivery order and acceptance gates

1. **Verification baseline and refund reconciliation — in progress.** Build permission-gated, paginated evidence review/export and immutable staff decisions. Never treat a same-amount historical credit as proof. Historical balance corrections need individually verified original transaction evidence and an explicit execution decision; reviewing a case must not move funds.
2. **Financial reporting — pending.** Consolidate recorded POS, online and digital sales, refunds, expenses, fees and settlement. Dates, outlet filters and exports must reconcile to source rows. Unknown historical costs/taxes stay unknown.
3. **Advertising — pending.** Provide two first-class routes: Peebee placements, and external ads with Meta and Google Ads account connections. Connect Peebee merchant campaigns and creative review to existing ad decisions/beacons. Reserve budgets and enforce caps, charging/refunds, pause/resume and actual results. Test event forgery, retries and races. External campaigns use the selected provider's account, billing, validation and reporting; never present a Peebee-only placement as an external campaign.
4. **Broadcasting and replay — pending.** Reuse video adapters and live infrastructure; implement merchant camera preview, authenticated publishing, viewer playback, interruption recovery, ending and replay lifecycle. Test configured, disabled and unavailable providers. Real credentials are an external setup dependency.
5. **WhatsApp delivery — pending.** Add configured provider sending, approved templates, consent, queued delivery, deduplicated retries, delivery webhooks and opt-out handling. Keep manual sharing. Real provider credentials/templates are external dependencies.
6. **Cross-feature verification — pending.** Cover owner/manager/cashier across Free/Pro/Elite, expiry, admin disable, tenant isolation, retries/concurrency, session restoration, offline, responsive UI and accessibility. Provider mocks exercise failure paths but do not replace a real provider smoke test.

## Release rules

Every deliverable is committed/published on a codex branch, checked against current origin/main, verified, merged by PR, then deployed from clean main through scripts/preflight-deploy.mjs. New behaviour is admin-controlled with safe defaults and activity logging. Any manual migration is named in its PR and code tolerates its absence. Production verification avoids unapproved money movements, broadcasts and bulk messages.

## Current evidence

- Refund review reads original sale/refund ledger postings and linked wallet credit; no purchase access token or licence key is returned.
- Review decisions record the evidence fingerprint, staff identity, reasoning and external reference when applicable. Changed evidence requires a new review.
- A review is an operational assessment, not an accounting repair. No live historical cases have been adjudicated or corrected by this implementation.
