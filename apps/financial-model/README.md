# Peebee Financial Model

Open https://financials.peebee.online and sign in with your Peebee Admin account, or continue with an existing Admin session. The Account menu shows your Admin identity and supports changing your password or signing out. Appearance and autosave follow your account across browsers. The site opens one shared forecast for Admin users with Payments management and statistics access. Changes to assumptions save to the shared forecast. If someone saves first, reload their version before editing again. If the shared forecast is empty, an authorized user with an existing browser draft can initialize it from **Settings → Use this browser’s draft**.

Open `index.html` directly for offline development. In that mode, the forecast uses local browser storage.

The default starts this month in UGX and runs for 36 months. Enter Peebee’s forecast income tax rate before generating a forecast. All 13 channels start with editable launch estimates. Order-based commissions use transaction counts, average eligible values and fee rates. Flat fees use chargeable units and average prices. Subscription lines use starting subscribers, new subscriptions, assumed monthly churn and price. Some estimates assume paid features are enabled. Costs, headcounts and collection periods start at zero. Add opening cash, receivables, payables, fixed assets and debt from the books. Add capex, financing and equity from the approved plan. The local file works offline.

## Peebee sources

| Channel | Repository source |
| --- | --- |
| Concierge, Rides, TaxiPress | [Platform settings](../api/src/lib/settings.ts), [car settlement](../api/src/car/service.ts), [TaxiPress settlement](../api/src/taxipress/settlement.ts) |
| Buy | [Marketplace settings](../api/src/lib/settings.ts), [digital and Learn payment options](../api/src/lib/option-registry.ts), [store plan billing](../api/src/marketplace/routes.ts) |
| Work and Services | [Platform settings](../api/src/lib/settings.ts), [Work engine](../../docs/work-engine.md), [Services payments](../api/src/services-platform/payments.ts) |
| Learn | [Platform settings](../api/src/lib/settings.ts), [bundles and school passes](../api/src/education/sales.ts), [school fee payments](../api/src/education/learning.ts), [creator sales routing](../../docs/LEARN_CREATOR_PLATFORM_IMPLEMENTATION.md) |
| Food, Pharmacy and Gas | [Restaurant orders](../api/src/restaurants/routes.ts), [pharmacy orders](../api/src/pharmacy/routes.ts), [gas outlet settlements](../api/src/gas/routes.ts). Use earned Peebee fees from agreements and settlement records. |
| Jobs & Talent | [Platform settings](../api/src/lib/settings.ts), [seeded rules and membership plans](../api/src/db/migrations/0110_talent_jobs.sql) |
| Channels & Ads | [Creator monetization](../../packages/shared/src/channels-config.ts), [ad settings](../api/src/ads/settings.ts) |
| Wallet | [Wallet service](../api/src/wallet/service.ts). Use fees earned by Peebee and exclude customer balances and transfers. |

The starter figures are illustrative. Use Admin settings, actual activity and applicable contracts when modeling current operations. The revenue screens describe the base for each percentage fee and where external payment activity should be counted. Count external revenue once, including sales made through Peebee TV and other customer surfaces in the originating channel.

## Live Admin data

In **Settings → Live Admin data**, use your existing Admin session to retrieve current configured fees and recent live settlement totals, including recorded order counts and average values where the source has those fields. The source list covers order splits, TaxiPress, Work, Learn, Talent, and selected platform ledger fees. The report shows only mapped sources. Review the recorded values before using them as forecasts.

**Apply live fees to forecast** updates compatible rates and prices on matching UGX lines. Order estimates, growth and other assumptions are editable. Applying fees saves the updated assumptions to the shared forecast. The bearer token stays on the Admin origin.

Cloudflare serves the site on the Peebee API Worker under the financials domain. The live endpoint uses Admin authorization and returns aggregate live data. The normal API deployment includes changes to the financial model assets.

## Technology costs

In **Model → Assumptions → Costs → Operating expenses**, select **Add discovered technology costs** for an existing forecast. New forecasts include the same lines. The list covers Cloudflare hosting, D1, R2, Stream, Realtime and Workers AI, plus the other video providers, Gemini, email, SMS, WhatsApp, maps, domains, and GitHub builds. Each card identifies the billing unit and links to vendor pricing where available. Integration support does not confirm an active paid plan. Public rates were checked on November 17, 2026. Starting usage and invoice amounts are left at zero until supplied. Use a **Monthly bill** for known invoices and **Base bill + metered usage** for variable charges. Set an exchange rate on each USD meter that has projected paid usage.

For a gradual ramp, set an annual or monthly growth rate. Usage charges increase with volume above the included allowance. For a planned price or volume change, set the last month of the current phase and select **Add next phase**. It starts the following month with the projected amount or usage carried forward. Edit the new phase for the changed plan. Use the same start and end month for a one-off charge. The SG&A monthly schedule shows each phase in its applicable months.

## Assumptions backups

Use **Settings → Download saved assumptions** to save the current forecast inputs as a JSON file. **Upload assumptions backup** replaces the current assumptions after confirmation. The app recalculates a complete forecast immediately and opens incomplete drafts for review. In the shared app, the replacement applies to all authorized editors. If another editor saves first, reload the shared version before trying the upload again.

## Reports and exports

Revenue drivers include units, subscriptions, monthly revenue, and a percentage of transaction or payout value. The **Revenue by channel** report contains source rows, channel subtotals and consolidated revenue. Costs, working capital, investment, funding, valuation and financial statements are consolidated for Peebee.

The **Analysis** tab covers revenue, cash, funding, profitability, working capital, break-even and scenarios. Select monthly or annual periods and choose a date range. Hover or use the arrow keys on a focused chart to inspect a period. **View chart data** lists the values, and the analysis CSV exports the current selection. Use **Download model CSV** to save a snapshot of all assumptions and reports.

The model estimates collections and supplier payments from sales and purchases spread evenly within 30-day model months. It measures funding gaps at month end. Tax is estimated and paid monthly on positive profit. It excludes VAT, historical actuals and tax loss carryforwards. Edit the assumptions in the app to recalculate.

Run the engine checks with `node --test apps/financial-model/model.test.cjs` from the repository root.
