# Merchant security and UI remediation

## Changes

- Stock writes validate product/outlet membership and restrict conflict updates to the same store. Transfers and POS inventory, loyalty and sale records commit in one batch, with conditional stock debits. Duplicate product lines are aggregated before checking stock.
- POS and transfer clients retain a request identifier across retries; the server replays an existing result instead of moving stock again. Existing callers without identifiers remain compatible.
- Refund completion, payout debit, buyer credit, wallet ledger, double-entry ledger and access revocation commit together. Refunds use the original sale/enrollment environment. Unverifiable historical payments require reconciliation instead of guessing which balance to debit.
- Digital/LMS creation tools and new digital sales require effective Elite access; refunds for existing purchases remain available after expiry. Sensitive reads require the admin-configured digital-management permission; ordinary product responses never include unsold licence keys. Live starts respect the admin switch, effective plan and a supplied HTTPS hosted stream.
- The selected merchant travels in `X-Merchant-Id`; membership, role and entitlement checks resolve within that business. Stale saved selections are replaced with an actual membership.
- Manual POS unit-price overrides are off by default. Admin can enable **Allow manual POS prices** in the Plans options page. This uses the existing settings registry, settings-route validation and activity logging. Ownership and stock checks always apply.
- Empty digital catalogs stay empty. Failed store requests show a retry state rather than creation onboarding; failed modules are identified, with previously loaded records preserved where available. Stale business-load responses are ignored.
- Reporting now explicitly covers **all-time recorded POS sales**, using current product costs and estimated fees. It excludes online orders, refunds, tax and operating expenses. Missing costs remain unavailable and negative contributions remain negative; unsold inventory is never substituted for sales.
- Advertising is explicitly a local planning preview with no charge or submission. Fabricated ad/live/LMS metrics, camera-broadcast implications and replay claims are removed. WhatsApp handoffs are saved as drafts rather than delivered campaigns.
- Phone headers reflow, navigation exposes remaining pages through More, desktop operations use more width, and Elite tools use a visible grid. The plan comparison uses readable descriptions, monthly/yearly choices, a consistent access explanation and a personal-wallet funding link.
- Password recovery uses the existing verified reset API. Inputs have associated labels; account identifiers retain their labels; the outlet add icon is named. Manager/cashier wallets explain the required settlement role instead of presenting permission failures as zero balances.

## Database and rollout

**No migration is introduced by this change.** It uses existing tables/columns and the existing option registry's safe default. Do not mark old partially completed refunds as repaired automatically: reconcile historical refund transactions, customer wallet entries and merchant balances before applying any corrective money movement.

D1 batches execute transactionally and roll back when a statement fails: [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/observability/find-expensive-queries/). A zero-row conditional update is not itself an error, so each required debit is followed by `requireChangedRow`, which aborts the batch if it did not change one row. The regression suite exercises both losing concurrent requests and failures after earlier writes.

## Validation

- Ten new API regressions cover tenant isolation, concurrent transfers, secret reads, plan/admin gates, overselling and duplicate lines, refund rollback/retry/environment isolation, selected-business permissions, real empty catalogs, missing costs/losses and safe retries.
- Existing marketplace/LMS integration tests: six passed.
- Existing security suite: 71 passed.
- Local API tests use the repository app/migrations and a Node SQLite compatibility shim because the Windows libsql native binding cannot load. CI must also run the repository's normal libsql tests on Linux.
- Local browser verification used a disposable seeded database: signed-out recovery, normal sign-in, phone header/navigation, the More menu, Elite navigation, empty LMS/catalog, labelled digital creation and a successful product publication, and explicit no-charge ad preview. No production records or payments were changed.
- Screenshots and detailed audit evidence remain in the original workspace's `.audit-local` folder; they are not production assets or repository credentials.

The real advertising integration, camera broadcast/recording, and a comprehensive accounting P&L are not implemented by these repairs; the UI now describes the capabilities that actually exist.
