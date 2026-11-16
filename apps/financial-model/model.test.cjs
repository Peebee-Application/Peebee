const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./line-items.js");
require("./assumptions.js");
require("./model.js");
require("./peebee-defaults.js");
require("./channels.js");
const { questions, errorFor } = globalThis.FinancialAssumptions;
const { build, sum } = globalThis.FinancialModel;
const { upgradeDraft } = globalThis.FinancialLineItems;

const forecastFixture = upgradeDraft({
  company: "Acacia Studio", currency: "USD", start: "2026-10", months: "36",
  streams: [
    { name: "Product sales", method: "units", units: "500", price: "45", growth: "3", days: "14" },
    { name: "Design services", method: "direct", amount: "4500", growth: "3", days: "30" },
  ],
  directCosts: [
    { name: "Materials", basis: "rate", rate: "31", stock: "6000", inventoryDays: "25", payableDays: "20" },
    { name: "Payment fees", basis: "rate", rate: "5", stock: "0", inventoryDays: "0", payableDays: "0" },
  ],
  staff: [
    { name: "Production", headcount: "4", amount: "1500", burden: "10", month: "1", growth: "8" },
    { name: "Operations", headcount: "1", amount: "2600", burden: "0", month: "1", growth: "8" },
  ],
  expenses: [
    { name: "Rent", amount: "1800", month: "1", growth: "5" },
    { name: "Software", amount: "400", month: "1", growth: "5" },
    { name: "Marketing", amount: "1300", month: "1", growth: "5" },
    { name: "Professional fees", amount: "300", month: "1", growth: "5" },
  ],
  tax: "25", cash: "25000", openingAR: "3000", openingAP: "2000", openingAssets: "12000", openingLife: "36",
  capex: "18000", capexMonth: "4", capexLife: "48", openingDebt: "0",
  loan: "10000", loanMonth: "4", loanRate: "12", loanTerm: "24", funding: "0",
  scenarios: "yes", downside: "2", upside: "1", valuation: "yes", discountRate: "15", exitValue: "0",
});

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
}

test("forecast inputs validate and every scenario reconciles through the final period", () => {
  const answers = { ...forecastFixture, start: "2026-10" };
  for (const prompt of questions.filter(q => !q.when || q.when(answers))) {
    assert.equal(errorFor(prompt, answers[prompt.id], answers), "", prompt.id);
  }
  const models = build(answers);
  const [downside, base, upside] = models;
  assert.equal(base.annual[0].period, "2026 (3 mo.)");
  assert.equal(base.annual.at(-1).period, "2029 (9 mo.)");
  assert.equal(base.months[0].revenue, 27_000);
  assert.ok(downside.months[11].revenue < base.months[11].revenue);
  assert.ok(base.months[11].revenue < upside.months[11].revenue);
  for (const model of models) {
    assert.equal(model.months.length, 36);
    for (const row of model.months) {
      near(row.check, 0);
      near(row.openingCash + row.operating + row.investing + row.financing, row.cash);
    }
    near(sum(model.annual, "profit"), sum(model.months, "profit"));
    assert.equal(model.annual[0].cash, model.months[2].cash);
    assert.equal(model.annual[0].openingCash, model.months[0].openingCash);
  }
});

test("subscription churn, asset depreciation, financing, and DCF use the entered timing", () => {
  const [model] = build({
    start: "2026-01", months: "4", revenueMethod: "subscription", active: "20", churn: "10",
    newSubscribers: "5", price: "10", cash: "20", openingAssets: "40", openingLife: "2",
    capex: "90", capexLife: "3", capexMonth: "2", funding: "50", fundingMonth: "4",
    openingDebt: "24", openingTerm: "2", openingRate: "12", loan: "40", loanTerm: "2", loanRate: "12", loanMonth: "2",
    valuation: "yes", exitValue: "60", discountRate: "0",
  });
  const [first, second, third, fourth] = model.months;
  near(first.revenue, 230);
  near(second.revenue, 257);
  assert.deepEqual(model.months.map(row => row.depreciation), [20, 50, 30, 30]);
  assert.deepEqual(model.months.map(row => row.principal), [12, 12, 20, 20]);
  assert.deepEqual(model.months.map(row => row.debt), [12, 40, 20, 0]);
  near(first.interest, .24);
  near(second.interest, .52);
  near(third.interest, .4);
  near(fourth.interest, .2);
  near(fourth.equityRaised, 50);
  near(model.valuation.enterprise, sum(model.months, "freeCash") + 60);
  near(model.valuation.equity, model.valuation.enterprise + 20 - 24);
});

test("opening inventory runs down through sales and the funding gap stays visible", () => {
  const [model] = build({ start: "2026-12", months: "2", revenueMethod: "direct", revenue: "100",
    cogsRate: "50", openingInventory: "500", payroll: "1000", tax: "25" });
  const [first, second] = model.months;
  assert.equal(first.stock, 450);
  assert.equal(second.purchases, 0);
  assert.equal(first.tax, 0);
  assert.equal(first.cash, -900);
  assert.equal(second.cash, -1800);
  assert.equal(model.shortfall.period, "2026-12");
  assert.equal(model.fundingGap, 1800);
  near(second.check, 0);
});


test("named lines roll into linked statements, with independent schedules and annual totals", () => {
  const { linesFor, reports } = globalThis.FinancialModel;
  const forecast = { ...forecastFixture, scenarios: "no", months: "14", start: "2026-01",
    expenses: [
      { name: "Rent", amount: "100", month: "1", growth: "10" },
      { name: "Software", amount: "25", month: "3", growth: "20" },
    ],
    receivables: [{ name: "Invoice 42", amount: "500", month: "3" }],
    contributions: [{ name: "Owner", amount: "80", month: "4" }, { name: "Investor", amount: "200", month: "9" }],
  };
  const [base] = build(forecast);
  const incomes = linesFor(reports.find(report => report.id === "income"), forecast);
  const cell = label => incomes.find(([name]) => name === label)[1];
  const rent = cell("Operating expense · Rent");
  const software = cell("Operating expense · Software");
  near(rent(base.months[0]), 100);
  near(rent(base.months[12]), 110);
  near(software(base.months[1]), 0);
  near(software(base.months[2]), 25);
  near(software(base.months[12]), 25);
  near(software(base.annual[0]), 250);
  near(rent(base.annual[0]), 1200);
  near(base.annual[0].overhead, 1450);
  near(base.months[1].details.receivables[0].amount, 500);
  near(base.months[2].details.receivables[0].amount, 0);
  near(base.months[2].details.receivables[0].settled, 500);
  near(base.annual[0].equityRaised, 280);
  for (const row of base.months) near(row.check, 0);
});

test("independent cash ledger agrees with all three statements and a nonzero-rate DCF", () => {
  const [base] = build({
    start: "2026-11", months: "2", tax: "25", valuation: "yes", discountRate: "21", exitValue: "600",
    streams: [{ name: "Sales", method: "direct", amount: "300", growth: "-50", days: "45" }],
    directCosts: [{ name: "Stock", basis: "rate", rate: "40", stock: "20", inventoryDays: "15", payableDays: "45" }],
    staff: [{ name: "Staff", amount: "50", headcount: "1", burden: "10", month: "1", growth: "0" }],
    expenses: [{ name: "Rent", amount: "20", month: "1", growth: "0" }],
    accounts: [{ name: "Bank", amount: "300" }],
    receivables: [{ name: "Opening invoice", amount: "80", month: "2" }],
    payables: [{ name: "Opening bill", amount: "40", month: "1" }],
    ownedAssets: [{ name: "Existing equipment", amount: "40", life: "4" }],
    investments: [{ name: "New equipment", amount: "60", life: "6", month: "2" }],
    existingLoans: [{ name: "Old loan", amount: "60", rate: "12", term: "3" }],
    newLoans: [{ name: "New loan", amount: "90", rate: "12", term: "3", month: "2" }],
  });
  const [nov, dec] = base.months;
  // November has only new credit sales and purchases. December collects half of
  // November's sales plus the opening invoice, and pays half of November's purchases.
  near(nov.ar, 380);
  near(nov.stock, 60);
  near(nov.purchases, 160);
  near(nov.ap, 160);
  near(nov.operating, 0 - 40 - 55 - 20 - 0.6 - 23.6);
  near(nov.cash, 140.8);
  near(nov.profit, 70.8);
  near(nov.totalAssets, 610.8);
  near(nov.liabilities, 200);
  near(nov.equity, 410.8);
  near(dec.ar, 300);
  near(dec.stock, 30);
  near(dec.purchases, 30);
  near(dec.ap, 110);
  near(dec.operating, 150 + 80 - 80 - 55 - 20 - 1.3);
  near(dec.cash, 224.5);
  near(dec.profit, -6.3);
  near(dec.totalAssets, 624.5);
  near(dec.liabilities, 220);
  near(dec.equity, 404.5);
  for (const row of base.months) near(row.totalAssets, row.liabilities + row.equity);
  const [annual] = base.annual;
  assert.equal(annual.period, "2026 (2 mo.)");
  near(annual.revenue, 450);
  near(annual.gross, 270);
  near(annual.ebitda, 120);
  near(annual.depreciation, 30);
  near(annual.profit, 64.5);
  near(annual.openingCash, 300);
  near(annual.cash, 224.5);
  near(annual.ar, 300);
  near(nov.freeCash, -138.75);
  near(dec.freeCash, 15);
  near(base.valuation.pvFlows, -122.0324258574582);
  near(base.valuation.pvExit, 581.2375836908785);
  near(base.valuation.enterprise, 459.20515783342034);
  near(base.valuation.equity, 699.2051578334203);
});

test("long terms never recognize future sales or purchases and opening balances can settle after the forecast", () => {
  const [base] = build({
    start: "2026-01", months: "4",
    streams: [{ name: "Sales", method: "direct", amount: "100", growth: "0", days: "90" }],
    directCosts: [{ name: "Supplier", basis: "fixed", amount: "60", growth: "0", stock: "0", inventoryDays: "0", payableDays: "90" }],
    receivables: [{ name: "Opening invoice", amount: "17", month: "5" }],
    payables: [{ name: "Opening bill", amount: "11", month: "5" }],
  });
  assert.deepEqual(base.months.map(row => row.ar), [117, 217, 317, 317]);
  assert.deepEqual(base.months.map(row => row.ap), [71, 131, 191, 191]);
  assert.deepEqual(base.months.map(row => row.cash), [0, 0, 0, 40]);
  assert.equal(base.fundingGap, 0);
  for (const [id, item] of [["receivables", base.months[0].details.receivables[0]], ["payables", base.months[0].details.payables[0]]]) {
    const prompt = questions.find(question => question.id === id);
    assert.equal(errorFor(prompt, [{ name: "Opening balance", amount: String(item.amount), month: "5" }], { months: "4" }), "");
  }
});

test("half-cent funding gaps and their balance sheet presentation agree", () => {
  const baseAnswers = { start: "2026-01", months: "1" };
  const [base] = build({ ...baseAnswers, overhead: "0.005" });
  assert.equal(base.shortfall.period, "2026-01");
  assert.equal(base.fundingGap, 0.005);
  const [jan] = base.months;
  assert.equal(jan.cash, -0.005);
  assert.equal(jan.cashAsset, 0);
  assert.equal(jan.cashShortfall, 0.005);
  assert.equal(jan.liabilities, 0);
  assert.equal(jan.totalAssets, 0);
  assert.equal(jan.totalSources, 0);
  const [tiny] = build({ ...baseAnswers, overhead: "0.004" });
  assert.equal(tiny.shortfall, undefined);
  assert.equal(tiny.fundingGap, 0);
});

test("full churn preserves new signups and the engine rejects precision-breaking amounts", () => {
  const base = { start: "2026-01", months: "1" };
  const [churn] = build({ ...base, revenueMethod: "subscription", active: "1000000000000",
    newSubscribers: "0.00001", churn: "100", price: "100000" });
  near(churn.months[0].details.streams[0].active, 0.00001);
  near(churn.months[0].revenue, 1);
  assert.throws(() => build({ ...base, revenueMethod: "units", units: "1000000000000", price: "1000000000000" }),
    globalThis.FinancialModel.ForecastRangeError);
});

test("channel subtotals roll up only recognized revenue in every scenario", () => {
  const { consolidate } = globalThis.FinancialChannels;
  const { answers, report } = consolidate({
    start: "2026-01", months: "2", scenarios: "yes", downside: "5", upside: "5",
    channels: [{ key: "concierge", name: "Concierge" }, { key: "buy", name: "Buy" }],
    "channel-concierge": [
      { name: "Commission", method: "percentage", transactionValue: "10000", rate: "2.5", growth: "10", days: "60" },
      { name: "Rider share", method: "percentage", transactionValue: "4000", rate: "10", growth: "0", days: "0" },
      { name: "Subscriptions", method: "subscription", active: "10", newSubscribers: "0", price: "30", churn: "0", growth: "0", days: "0" },
    ],
    "channel-buy": [{ name: "Commission", method: "units", units: "100", price: "5", growth: "0", days: "0" }],
    "channel-removed": [{ name: "Old sales", method: "direct", amount: "2000" }],
  });
  const [downside, base, upside] = build(answers);
  const [jan, feb] = base.months;
  const labels = Object.fromEntries(report.lines.map(([name, field]) => [name, typeof field === "function" ? field : row => row[field]]));
  near(labels["Concierge total"](jan), 950);
  near(labels["Buy total"](jan), 500);
  near(labels["Consolidated revenue"](jan), 1450);
  near(feb.ar, 525);
  near(labels["Concierge total"](base.annual[0]), 1925);
  near(labels["Consolidated revenue"](base.annual[0]), 2925);
  near(base.annual[0].details.streams[0].volume, 21000);
  near(base.annual[0].details.streams[0].feeRate, 0.025);

  for (const scenario of [downside, base, upside]) {
    for (const row of [...scenario.months, ...scenario.annual]) {
      near(labels["Concierge total"](row) + labels["Buy total"](row), row.revenue);
      near(row.totalAssets, row.totalSources);
    }
  }
  assert.ok(downside.months[1].revenue < feb.revenue);
  assert.ok(upside.months[1].revenue > feb.revenue);
});

test("analysis uses the selected rows, reconciles revenue mix, and computes break-even from fixed and variable costs", () => {
  require("./analysis.js");
  const { buildAnalysis, exportRows } = globalThis.FinancialAnalysis;
  const { consolidate } = globalThis.FinancialChannels;
  const { answers, groups } = consolidate({
    start: "2026-12", months: "3", scenarios: "yes", downside: "5", upside: "5",
    channels: [{ key: "concierge", name: "Concierge" }, { key: "buy", name: "Buy" }],
    "channel-concierge": [
      { name: "Fees", method: "direct", amount: "150", growth: "0", days: "0" },
      { name: "Subscriptions", method: "direct", amount: "50", growth: "0", days: "0" },
    ],
    "channel-buy": [{ name: "Marketplace", method: "direct", amount: "100", growth: "0", days: "0" }],
    directCosts: [
      { name: "Payment fees", basis: "rate", rate: "20", stock: "0", inventoryDays: "0", payableDays: "0" },
      { name: "Hosting", basis: "fixed", amount: "20", growth: "0", stock: "0", inventoryDays: "0", payableDays: "0" },
    ],
    staff: [{ name: "Operations", amount: "70", headcount: "1", burden: "0", growth: "0", month: "1" }],
    expenses: [{ name: "Rent", amount: "30", growth: "0", month: "1" }],
  });
  const outcomes = build(answers);
  const model = outcomes[1];
  const run = ({ frequency = "Monthly", ...state } = {}) => buildAnalysis({
    model, outcomes, frequency, rows: frequency === "Monthly" ? model.months : model.annual, answers, groups, state,
  });
  const monthly = run({ from: 1, to: 2, metric: "revenue", group: "concierge" });
  assert.deepEqual(monthly.periods, ["2027-01", "2027-02"]);
  assert.equal(monthly.totalRevenue, 400);
  assert.deepEqual(monthly.mix, [{ name: "Fees", value: 300, share: 0.75 }, { name: "Subscriptions", value: 100, share: 0.25 }]);
  const chart = (analysis, id) => analysis.charts.find(item => item.id === id);
  near(chart(monthly, "earnings").series[2].values[0], 120);
  near(chart(monthly, "margins").series[1].values[0], 0.4);
  near(chart(monthly, "break-even").series[1].values[0], 150);
  near(chart(monthly, "scenarios").series[2].values[0], 315);

  const annual = run({ frequency: "Annual" });
  assert.deepEqual(annual.periods, ["2026 (1 mo.)", "2027 (2 mo.)"]);
  near(chart(annual, "break-even").series[1].values[1], 300);
  near(annual.mix.reduce((total, item) => total + item.value, 0), 900);
  assert.ok(exportRows(monthly, "UGX").some(row => row[0] === "Fees" && row[2] === 75));
});

test("analysis leaves undefined margins and break-even values blank", () => {
  require("./analysis.js");
  const answers = {
    start: "2026-01", months: "1",
    streams: [{ name: "Sales", method: "direct", amount: "0", growth: "0", days: "0" }],
    directCosts: [{ name: "Fees", basis: "rate", rate: "100", stock: "0", inventoryDays: "0", payableDays: "0" }],
  };
  const outcomes = build(answers);
  const [model] = outcomes;
  const analysis = globalThis.FinancialAnalysis.buildAnalysis({ model, outcomes, rows: model.months, frequency: "Monthly", answers, state: {} });
  assert.equal(analysis.mix[0].share, null);
  assert.equal(analysis.charts.find(item => item.id === "break-even").series[1].values[0], null);
  assert.deepEqual(analysis.charts.find(item => item.id === "margins").series.map(series => series.values[0]), [null, null, null]);
});

test("Peebee defaults cover the platform, remain editable, and require a tax assumption", () => {
  const { createDefaults } = globalThis.PeebeeDefaults;
  const { questionsFor, consolidate } = globalThis.FinancialChannels;
  const draft = createDefaults();
  assert.equal(draft.company, "Peebee");
  assert.equal(draft.currency, "UGX");
  assert.equal(draft.channels.length, 13);
  const prompts = questionsFor(questions, draft).filter(q => !q.when || q.when(draft));
  assert.deepEqual(prompts.filter(q => errorFor(q, draft[q.id], draft)).map(q => q.id), ["tax"]);

  draft.tax = "0";
  const channelModel = consolidate(draft);
  const [baseline] = build(channelModel.answers);
  assert.ok(baseline.months.every(row => row.revenue === 0 && row.cash === 0));

  draft["channel-buy"][0].transactionValue = "1000000";
  draft["channel-rides"][2].amount = "25000";
  const edited = consolidate(draft);
  const [forecast] = build(edited.answers);
  assert.equal(forecast.months[0].revenue, 125000);
  assert.equal(edited.report.lines.find(([label]) => label === "Peebee Buy total")[1](forecast.months[0]), 100000);
  assert.equal(createDefaults()["channel-buy"][0].transactionValue, "0");
});

test("order estimates use eligible order value and preserve assumptions when applying live fees", () => {
  require("./live.js");
  const draft = globalThis.PeebeeDefaults.createDefaults();
  const [parcel] = draft["channel-concierge"];
  assert.equal(parcel.orders, "300");
  assert.equal(globalThis.FinancialLive.applyRates(draft, [
    { channel: "concierge", name: parcel.name, kind: "flat", value: 1000 },
  ]), 0);
  assert.equal(globalThis.FinancialLive.applyRates(draft, [
    { channel: "concierge", name: parcel.name, kind: "percent", value: 12 },
  ]), 1);
  assert.equal(parcel.orderValue, "5000");
  const [forecast] = build(globalThis.FinancialChannels.consolidate(draft).answers);
  const first = forecast.months[0].details.streams[0];
  assert.equal(first.units, 300);
  assert.equal(first.volume, 1_500_000);
  assert.equal(first.revenue, 180_000);
});
