# Peebee Financial Model

Open `index.html` in Chrome, Edge, or Firefox. A fresh browser opens the review of Peebee’s multichannel assumptions. Edit any assumption from that review, then generate the forecast. Drafts are saved in browser storage when available. **Reset to Peebee defaults** replaces the current draft after confirmation. Existing multichannel drafts open automatically.

The default starts this month in UGX and runs for 36 months. Enter Peebee’s forecast income tax rate before generating a forecast. Revenue volumes, growth, collection terms, operating costs and headcounts start at zero for editing. Add opening cash, receivables, payables, fixed assets and debt from the books. Add capex, financing and equity from the approved plan. The app uses repository defaults and can be used offline.

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

Check current Admin settings and applicable contracts before entering volumes. Paid activity for features that start off or use free billing is zero until Peebee charges for the feature. The revenue screens describe the base for each percentage fee and where external payment activity should be counted. Count external revenue once, including sales made through Peebee TV and other customer surfaces in the originating channel.

## Reports and exports

Revenue drivers include units, subscriptions, monthly revenue, and a percentage of transaction or payout value. The **Revenue by channel** report contains source rows, channel subtotals and consolidated revenue. Costs, working capital, investment, funding, valuation and financial statements are consolidated for Peebee.

The **Analysis** tab covers revenue, cash, funding, profitability, working capital, break-even and scenarios. Select monthly or annual periods and choose a date range. Hover or use the arrow keys on a focused chart to inspect a period. **View chart data** lists the values, and the analysis CSV exports the current selection. Use **Download model CSV** to save a snapshot of all assumptions and reports.

The model estimates collections and supplier payments from sales and purchases spread evenly within 30-day model months. It measures funding gaps at month end. Tax is estimated and paid monthly on positive profit. It excludes VAT, historical actuals and tax loss carryforwards. Edit the assumptions in the app to recalculate.

Run the engine checks with `node --test apps/financial-model/model.test.cjs` from the repository root.
