# Financial Model Builder

Open `index.html` in Chrome, Edge, or Firefox. The planner runs in the browser and has no install step or connection to Peebee accounts. The current draft is saved when browser storage is available. Use **Download model CSV** to keep a copy of the assumptions and all outputs outside the app.

1. Enter a company name, currency, and forecast period.
2. Use one screen per category. Add applicable line items from the suggested names or enter your own. Complete all the lines on that screen before continuing.
3. Review the answers and generate the forecast. Switch between annual and monthly reports, and between scenarios if enabled.

Revenue streams may use units, subscriptions, or a monthly sales amount. Enter direct costs, payroll roles, and expenses separately. The wizard also supports multiple opening cash accounts, existing receivables and payables, inventory balances by direct cost, existing and new assets, outstanding and planned loans, and equity contributions. The statements and supporting schedules roll the named lines into totals. The overview identifies funding gaps and displays a DCF when you enter valuation assumptions.

Existing drafts carry their original summary values forward as named line items. Edit or replace a carried-forward line to provide more detail. The example uses fictional inputs.

The supplied workbook informed the structure. The model estimates working capital on a 30-day basis and pays income tax monthly on positive profit. It excludes VAT, historical actuals, and tax loss carryforwards. CSV downloads are snapshots. To recalculate, edit the assumptions in the app.

Run the engine checks with `node --test apps/financial-model/model.test.cjs` from the repository root.
