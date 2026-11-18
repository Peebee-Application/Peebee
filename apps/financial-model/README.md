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

## Forecast modules

Use **Home → Dashboard → Forecast modules** to include or exclude whole revenue channels and their parts. An excluded channel keeps its individual selections and saved assumptions. Rides groups Boda, Car, Rideshare, self-drive and rider plans. Enabling Rideshare without an existing revenue line creates an editable zero-value assumption.

Use **Applies to** on a direct cost, staff role, operating expense, existing asset, or planned purchase to assign it to one or more modules. The line stays in the forecast while any assigned module is on. A percentage-based direct cost uses the revenue of its active assigned modules. Lines with no assignment are company-wide.

## Technology costs

In **Model → Assumptions → Costs → Operating expenses**, select **Add discovered technology costs** for an existing forecast. New forecasts include the same lines. The list covers Cloudflare hosting, D1, R2, Stream, Realtime and Workers AI, plus the other video providers, Gemini, email, SMS, WhatsApp, maps, domains, and GitHub builds. Each card identifies the billing unit and links to vendor pricing where available. Integration support does not confirm an active paid plan. Public rates were checked on November 17, 2026. Starting usage and invoice amounts are left at zero until supplied. Use a **Monthly bill** for known invoices and **Base bill + metered usage** for variable charges. Set an exchange rate on each USD meter that has projected paid usage.

For a gradual ramp, set an annual or monthly growth rate. Usage charges increase with volume above the included allowance. For a planned price or volume change, set the last month of the current phase and select **Add next phase**. It starts the following month with the projected amount or usage carried forward. Edit the new phase for the changed plan. Use the same start and end month for a one-off charge. The SG&A monthly schedule shows each phase in its applicable months.

## Assumptions backups

Use **Settings → Download saved assumptions** to save the current forecast inputs as a JSON file. **Upload assumptions backup** replaces the current assumptions after confirmation. The app recalculates a complete forecast immediately and opens incomplete drafts for review. In the shared app, the replacement applies to all authorized editors. If another editor saves first, reload the shared version before trying the upload again.

## Forecast settings

Open **Model → Forecast settings** for the company profile, opening balances, fiscal tax and VAT, revenue channels, direct costs, staffing, operating expenses, depreciation, inventory, funding, scenarios and valuation. Edit balances and individual items from their section. Set a shared default and leave an item’s override blank to inherit it. An explicit zero remains an override.

Use the launch month on each revenue stream to delay revenue. For acquisition, the campaign starts at launch unless a separate month is set. Pre-launch acquisition builds the customer base before sales begin. The paid budget can grow by a percentage or fixed amount, up to a monthly cap. The paid budget flows into Marketing & Growth. The historical cutoff is recorded for reference. Forecast statements begin at the selected forecast start date.

## Workbook pages

Open **Workbook → Model Map** for the full 20-sheet directory. Every sheet has a bookmarkable page. **Schedules → SG&A > Staff** covers headcount and payroll, while **Schedules → SG&A** covers operating expense categories and total SG&A. Both link directly to their own assumption editors.

Use **Workbook → Actuals** to record monthly historical results. Historical results stay separate from the forecast and are available to signed-in editors. **Data Exports** provides forecast CSV, historical-results CSV and the saved assumptions backup. **FS-Month (AI Summary)** builds its narrative directly from forecast figures. **Change Log** lists app releases.

## Reports and exports

Revenue drivers include units, subscriptions, monthly revenue, and a percentage of transaction or payout value. The **Revenue by channel** report contains source rows, channel subtotals and consolidated revenue. Costs, working capital, investment, funding, valuation and financial statements are consolidated for Peebee.

The **Analysis** tab covers revenue, cash, funding, profitability, working capital, break-even and scenarios. Select monthly or annual periods and choose a date range. Hover or use the arrow keys on a focused chart to inspect a period. **View chart data** lists the values, and the analysis CSV exports the current selection. Use **Download model CSV** to save a snapshot of all assumptions and reports.

The model estimates collections and supplier payments from sales and purchases spread evenly within 30-day model months. It measures funding gaps at month end. Income tax defaults to monthly payments. Fiscal settlement uses year-to-date profit and optional quarterly payments. Historical statements and income tax loss carryforwards are outside the forecast. VAT is a separate opt-in forecast. Edit the assumptions in the app to recalculate.

Run the engine checks with `node --test apps/financial-model/model.test.cjs` from the repository root.


## Workbook comparison

Reviewed against the saved formulas in the 20-tab reference workbook. The workbook opens with a USD SaaS sample; its example values are not Peebee assumptions.

| Workbook area | Peebee behavior and remaining differences |
| --- | --- |
| Intro, Settings, Assumptions | Admin sign-in, forecast dates and currency, editable channel assumptions and module inclusion. Statements use calendar-year groupings. The workbook can set an actuals cutoff and historical company balances for existing tax obligations. Peebee models opening balances, including VAT and income tax owed, and records the actuals cutoff for reference. Actual periods are not imported into the forecast. |
| Revenue, Consolidated models | Peebee has 13 business channels and editable order, fee, unit, and subscriber drivers. The workbook has organic/paid acquisition, marketing budget and acquisition cost, conversion, churn, and marketplace buyer/seller drivers. Order streams can opt into an acquisition forecast: organic traffic and paid budget produce signups, activation and churn determine active customers, and order frequency drives revenue. Each modeled campaign budget feeds SG&A once. A shared seller/buyer marketplace cohort and supply capacity are still missing. The workbook links staffing to payroll; connecting agents to rider and merchant onboarding is an additional Peebee requirement. Some dormant marketplace branches contain broken references. |
| COGS | Peebee supports monthly costs, percentage costs scoped to active modules, target inventory, supplier terms, and recoverable VAT. The workbook also calculates drivers such as cost per active customer and per-order fulfillment, and has explicit inventory movements. |
| SG&A > Staff | Single Hire, Scaling Team, Disabled, and Fixed Team. Scaling starts with one batch, recurs every 1, 3, 6, or 12 months, stops at the cap, and respects the inclusive last paid month. Monthly or annual salary, burden, and annual raises feed the statements. The workbook's Cap Table link has no target sheet in this copy. Equity grants and stock options are outside the staff schedule. |
| SG&A | Staff & Payroll plus Marketing & Growth, Professional Services, Rent, Tech Support & Services, Insurance, Utilities, and Other Expenses. Each has a rollup and operating expense groups show recoverable VAT. Vendor presets, paid usage, expense growth and later phases are editable. Use the linked order-stream budget for marketing campaigns that drive customer acquisition. Keep other marketing costs as separate expense cards. |
| CAPEX and funding | Opening assets, scheduled purchases, automatic replacement, depreciation, unit inventory, debt and equity. Hiring equipment can be expensed or capitalized, with optional replacements per purchase. The loan schedule supports equal principal and fixed monthly payments. |
| Taxes | Optional VAT charged, credits on supplier purchases and operating expenses, opening VAT balance, and settlement after month, quarter, or fiscal year end. Peebee takes net prices and costs; it computes VAT once at the entered rate. Credits roll forward. Income tax can settle monthly or after fiscal year close, with optional quarterly estimates. Manual adjustments and income-tax loss carryforwards remain outside the forecast. |
| Dashboard, FS-Month, FS-Annual, Dashboard Charts | Linked statement views, charts, scenario comparisons, funding gaps and DCF. Peebee does not include workbook-specific milestone rows or other-income and other-expense sections. |
| Actuals, Data Exports, Pitch Deck Output, FS-Month (AI Summary) | Peebee provides workbook pages for manual historical entries, separate exports, presentation metrics and summaries computed from the forecast. Historical entries stay separate from forecast periods. |
| Model Map, Change Log | The Model Map links the sheets and explains their relationships. Change Log lists Peebee app releases. Shared assumption edits use revision checks. |

Open **Model → Assumptions → Costs** to edit staffing, expense categories, hiring equipment and VAT timing. Use **Schedules → SG&A > Staff**, **SG&A** and **CAPEX** to trace the results. Existing drafts without a role type retain their fixed headcount, salary and pay timing. Review any generic legacy expenses assigned to Other Expenses and categorize them as needed.

The workbook link from role inputs to expenses can be followed in `SG&A > Staff!D36:N38`, then `SG&A!D64:D66` (headcount) and `SG&A!D116:D118` (loaded pay), then rows 40, 144 and 11 (headcount, payroll and consolidated payroll). `SG&A!D150:D160` contains the linked marketing budget, category total, and VAT. The workbook divides the rate by 100 twice on the marketing VAT row. Peebee applies each entered VAT rate once to the net base. `SG&A!D238` and `CAPEX!D65` show the alternative postings for equipment per increase in headcount.

The CAPEX build follows the workbook’s asset categories and depreciation schedule (`Assumptions!J109:K116`, `CAPEX!A54:CI84`), inventory movements (`CAPEX!A19:CI45`) and debt roll-forward (`CAPEX!A88:CI93`). Edit assets under **Assumptions → Investment**. Set a unit inventory plan under **Costs → Direct costs**, then use its inventory code on extra orders and write-offs under **Working capital**. Set the payment method on each loan under **Funding**. **Schedules → CAPEX** shows inventory, fixed assets and debt in monthly or annual columns. **Schedules → Working capital** shows trade balances and VAT.

Peebee compounds replacement prices at the entered annual rate over the elapsed months. It values on-hand inventory using a moving average. Orders needed within lead time at forecast start are shown as orders placed before the forecast. Unreceived orders appear as commitments, with inventory, tax and payables recognized on receipt. Unit demand can follow unit-priced sales in the assigned modules or be entered separately. Fixed loan payments amortize each draw independently, with principal and interest starting the month after draw.
