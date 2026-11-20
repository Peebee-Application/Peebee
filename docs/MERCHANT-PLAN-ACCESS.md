# Merchant plan access

Merchant defaults to accepting payments with a Merchant Code, outlet management,
wallet/settlements and account management. Its Store screen is a payments and
plans hub; it has no Catalog, Add item, Preview, Live, Ads or Elite tools.

The API returns the effective `plan.features` alongside the selected business's
plan. Store tiles, dedicated item/live screens and server routes use these same
permissions. Pro includes catalog, live and advertising tools by default. Elite
retains those and its existing advanced-tool checks. Team permissions and Admin's
module switches still apply in addition to the plan.

Admin → Commerce options → Merchant plans controls the catalog/live/advertising
choices for each tier. Empty choices mean no access; they never fall back to
enabling the first tool. Product limits do not grant catalog access by themselves.

Free pricing changes the price of an upgrade, not the subscription. Legacy flags
do not automatically turn a Merchant into Elite. An explicitly assigned active
Pro/Elite tier remains valid. Zero trial days disables the automatic trial.

Expiry/downgrade preserves products, stock, receipts and past purchases. A
payments-only storefront cannot accept new online sales, but existing refunds,
ledger history, settlements and ending a broadcast remain serviceable. Practice
shopping scenarios select eligible Pro stores too.

No migration or bulk rewrite of merchant subscriptions is required.
