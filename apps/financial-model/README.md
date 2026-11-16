# Financial Model Builder

Open `index.html` in Chrome, Edge, or Firefox. The planner runs in the browser and has no install step or connection to Peebee accounts. The current draft is saved when browser storage is available. Use **Download model CSV** to keep a copy of the assumptions and all outputs outside the app.

1. Enter a company name, currency, and forecast period.
2. Answer one question at a time. The planner uses your revenue method and answers to show the relevant follow-up questions.
3. Review the answers and generate the forecast. Switch between annual and monthly reports, and between scenarios if enabled.

The model links the income statement, balance sheet, cash flow, and supporting schedules. The overview identifies funding gaps and displays a DCF when you provide valuation assumptions. The example uses fictional inputs.

The supplied workbook informed the structure. This implementation supports one revenue driver, one new fixed-asset purchase, one new loan, and one equity contribution per model. It uses simplified working capital and monthly corporate income taxes and excludes VAT, historical actuals, and tax loss carryforwards. CSV downloads are snapshots of the calculations. To change a driver and recalculate, edit the assumptions in the app.

Run the engine checks with `node --test apps/financial-model/model.test.cjs` from the repository root.
