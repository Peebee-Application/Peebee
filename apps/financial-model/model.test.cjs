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
  const first = baseline.months[0];
  const channelTotals = channelModel.report.lines.filter(([label]) => draft.channels.some(channel => label === `${channel.name} total`));
  assert.equal(channelTotals.length, 13);
  assert.ok(channelTotals.every(([, getTotal]) => getTotal(first) > 0));

  draft["channel-buy"][0].orders = "501";
  draft["channel-rides"][2].orders = "9";
  const edited = consolidate(draft);
  const [forecast] = build(edited.answers);
  assert.equal(forecast.months[0].revenue - first.revenue, 15_500);
  assert.equal(createDefaults()["channel-buy"][0].orders, "500");
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

test("loading starter revenue into a saved draft preserves custom lines and other assumptions", () => {
  const custom = { name: "Existing partner fee", method: "direct", amount: "50000", growth: "0", days: "5" };
  const draft = {
    channels: [{ key: "buy", name: "Renamed Buy" }, { key: "custom", name: "Other" }],
    "channel-buy": [
      { name: "Standard marketplace commission", method: "percentage", transactionValue: "0", growth: "4", days: "15", rate: "10" },
      custom,
    ],
    "channel-custom": [custom],
    tax: "30",
    expenses: [{ name: "Hosting", amount: "200000" }],
  };
  globalThis.PeebeeDefaults.loadStarterRevenue(draft);
  assert.equal(draft["channel-buy"][0].method, "orders");
  assert.equal(draft["channel-buy"][0].orders, "500");
  assert.equal(draft["channel-buy"][0].growth, "4");
  assert.equal(draft["channel-buy"][0].days, "15");
  assert.deepEqual(draft["channel-buy"][1], custom);
  assert.ok(draft["channel-buy"].some(row => row.name === "Elite marketplace commission"));
  assert.deepEqual(draft["channel-custom"], [custom]);
  assert.equal(draft.tax, "30");
  assert.equal(draft.expenses[0].amount, "200000");
});

test("technology expenses apply monthly growth, billed usage and later phases without overlap", () => {
  const expenses = [
    { name: "Hosting", amount: "100", month: "1", endMonth: "3", cadence: "monthly", growth: "10" },
    { name: "Hosting next phase", amount: "150", month: "4", cadence: "monthly", growth: "0" },
    { name: "Storage", basis: "usage", amount: "10", month: "2", endMonth: "4", cadence: "monthly", growth: "100",
      quantity: "5", included: "8", unitCost: "2", priceCurrency: "USD", fx: "4" },
    { name: "Legacy", amount: "20", month: "1", growth: "25" },
  ];
  const input = upgradeDraft({ ...forecastFixture, expenses, scenarios: "no" });
  const [result] = build(input);
  for (const [index, expected] of [120, 140, 167, 276, 170].entries()) near(result.months[index].overhead, expected);
  near(result.months[12].overhead, 175);
  near(result.annual.reduce((total, year) => total + year.overhead, 0), sum(result.months, "overhead"));
  const prompt = questions.find(question => question.id === "expenses");
  assert.match(errorFor(prompt, input.expenses.map((row, i) => i === 2 ? { ...row, fx: "" } : row), input), /exchange rate/);
  assert.match(errorFor(prompt, input.expenses.map((row, i) => i === 2 ? { ...row, endMonth: "1" } : row), input), /Last expense month/);
});

test("forecast scope excludes selected channels and streams without removing assumptions", () => {
  const { consolidate, forecastModules } = globalThis.FinancialChannels;
  const input = { ...forecastFixture, channels: [
    { key: "rides", name: "Peebee Rides" }, { key: "buy", name: "Peebee Buy", enabled: "no" },
  ], "channel-rides": [
    { name: "Renamed Boda service", forecastGroup: "boda", method: "direct", amount: "120", growth: "0", days: "0", enabled: "no" },
    { name: "Car platform share", method: "direct", amount: "300", growth: "0", days: "0" },
  ], "channel-buy": [{ name: "Marketplace sales", method: "direct", amount: "900", growth: "0", days: "0" }] };
  const { answers, groups } = consolidate(input);
  assert.deepEqual(groups.map(group => group.key), ["rides"]);
  assert.equal(build(answers)[1].months[0].revenue, 300);
  assert.deepEqual(forecastModules(input)[0].parts.map(part => [part.key, part.entries.length]),
    [["boda", 1], ["car", 1], ["rideshare", 0]]);
  assert.equal(input["channel-rides"][0].amount, "120");
  assert.equal(input["channel-buy"][0].amount, "900");
});

test("module assignments scope costs, staffing and assets throughout the forecast", () => {
  const { consolidate } = globalThis.FinancialChannels;
  const sale = (name, amount) => ({ name, method: "direct", amount, growth: "0", days: "0" });
  const input = {
    ...forecastFixture, months: "2", scenarios: "no", valuation: "no",
    channels: [{ key: "rides", name: "Rides" }, { key: "buy", name: "Buy" }, { key: "work", name: "Work" }],
    "channel-rides": [sale("Car", "100")], "channel-buy": [sale("Sales", "200")], "channel-work": [sale("Bookings", "300")],
    directCosts: [
      { name: "Gateway", basis: "rate", rate: "10", moduleScope: "rides,buy" },
      { name: "Fleet contract", basis: "fixed", amount: "12", growth: "0", inventoryDays: "30", payableDays: "30", moduleScope: "rides" },
    ],
    staff: [
      { name: "Dispatch", amount: "20", headcount: "2", burden: "0", growth: "0", month: "1", moduleScope: "rides,buy" },
      { name: "Finance", amount: "90", headcount: "1", burden: "0", growth: "0", month: "1" },
    ],
    expenses: [{ name: "Tools", basis: "fixed", amount: "60", month: "1", growth: "0", moduleScope: "buy" }],
    ownedAssets: [{ name: "Fleet", amount: "120", life: "12", moduleScope: "rides" }],
    investments: [{ name: "Vehicle", amount: "240", life: "12", month: "1", moduleScope: "rides" }],
  };
  const month = (...on) => {
    const scoped = { ...input, channels: input.channels.map(channel => ({ ...channel, enabled: on.includes(channel.key) ? "yes" : "no" })) };
    const { answers } = consolidate(scoped);
    const model = build(answers)[0];
    assert.equal(model.annual[0].cogs, sum(model.months, "cogs"));
    return model.months[0];
  };
  const all = month("rides", "buy", "work");
  assert.deepEqual([all.revenue, all.cogs, all.payroll, all.overhead, all.capex, all.depreciation], [600, 42, 130, 60, 240, 30]);
  const noRides = month("buy", "work");
  assert.deepEqual([noRides.revenue, noRides.cogs, noRides.payroll, noRides.overhead, noRides.capex, noRides.depreciation],
    [500, 20, 130, 60, 0, 0]);
  assert.equal(noRides.stock, 0);
  assert.ok(all.stock > 0);
  assert.ok(all.ap > noRides.ap);
  const work = month("work");
  assert.deepEqual([work.revenue, work.cogs, work.payroll, work.overhead, work.capex], [300, 0, 90, 0, 0]);
  assert.equal(month().payroll, 90);
  assert.equal(input.investments[0].moduleScope, "rides");
  input.staff[1].enabled = "no";
  input.investments[0].enabled = "no";
  const cardsOff = month("rides", "buy", "work");
  assert.deepEqual([cardsOff.payroll, cardsOff.capex, cardsOff.depreciation], [40, 0, 10]);
  delete input.staff[1].enabled;
  delete input.investments[0].enabled;
  const restored = month("rides", "buy", "work");
  assert.deepEqual([restored.payroll, restored.capex, restored.depreciation], [130, 240, 30]);
});

test("workbook hiring modes preserve legacy payroll and roll equipment through both treatments", () => {
  const base = { start: "2027-01", months: "18", tax: "0", hireEquipmentCost: "120", hireEquipmentLife: "2", staff: [
    { name: "Senior Sales", roleType: "single", salaryBasis: "annual", annualSalary: "12000", burden: "5", month: "2", endMonth: "4", growth: "10" },
    { name: "Junior Sales", roleType: "scaling", salaryBasis: "monthly", amount: "100", burden: "10", month: "2", endMonth: "15",
      growth: "10", hiresPerPeriod: "2", hiringInterval: "3", maxTeamSize: "5" },
    { name: "Disabled", roleType: "disabled", amount: "5000", month: "1" },
    { name: "Legacy staff", headcount: "4", amount: "200", burden: "0", month: "1", growth: "0" },
  ] };
  assert.equal(errorFor(questions.find(item => item.id === "staff"), upgradeDraft(base).staff, base), "");
  const [{ months, annual }] = build({ ...base, hireEquipment: "capital" });
  assert.deepEqual(months.slice(0, 9).map(row => row.headcount), [4, 7, 7, 7, 8, 8, 8, 9, 9]);
  assert.deepEqual(months.slice(0, 9).map(row => row.equipmentCapex), [480, 360, 0, 0, 120, 0, 0, 120, 0]);
  assert.deepEqual(months.slice(0, 4).map(row => row.equipmentDepreciation), [240, 420, 180, 0]);
  near(months[1].payroll, 2070);
  near(months[13].payroll, 1405);
  near(months[15].payroll, 800);
  assert.equal(annual[0].headcountAdded, 9);
  assert.equal(annual[0].headcount, 9);
  months.forEach(row => near(row.check, 0));
  const [expense] = build({ ...base, hireEquipment: "expense" });
  assert.equal(expense.months[1].overhead, 360);
  assert.equal(expense.months[1].capex, 0);
  const [legacy] = build(base);
  assert.equal(legacy.months[1].overhead, 0);
});

test("expense rollups and VAT reconcile the cash ledger through a quarter boundary", () => {
  const { linesFor, scheduleReports } = globalThis.FinancialModel;
  const answers = upgradeDraft({ start: "2027-03", months: "3", tax: "0", vatCadence: "quarterly", vatYearEnd: "12", openingVAT: "-5",
    streams: [{ name: "Sales", method: "direct", amount: "100", days: "30", vatRate: "10", growth: "0" }],
    directCosts: [{ name: "Supplier", basis: "fixed", amount: "20", growth: "0", payableDays: "30", vatRate: "10" }],
    expenses: [
      { name: "Google Ads", amount: "10", month: "1", growth: "0", vatRate: "10" },
      { name: "Office rent", amount: "5", month: "1", growth: "0", vatRate: "20" },
    ],
  });
  const [{ months, annual }] = build(answers);
  assert.deepEqual(months.map(row => row.vatPayment), [0, 1, 0]);
  assert.deepEqual(months.map(row => row.vatPayable), [1, 6, 12]);
  assert.deepEqual(months.map(row => row.cash), [-17, 53, 124]);
  months.forEach(row => near(row.check, 0));
  const sga = linesFor(scheduleReports.find(report => report.id === "sga"), answers);
  assert.equal(sga.find(([label]) => label === "Marketing & Growth")[1](annual[0]), 30);
  assert.equal(sga.find(([label]) => label === "Recoverable VAT · Rent")[1](annual[0]), 3);
  assert.equal(build({ ...answers, vatCadence: "off" })[0].months[0].vatPayable, 0);
});

test("acquisition forecasts use one paid budget for order volume and SG&A", () => {
  const [forecast] = build({
    start: "2027-01", months: "2", tax: "0", streams: [{
      name: "Delivery", method: "orders", orderForecast: "acquisition", openingCustomers: "20",
      organicTraffic: "100", growth: "20", organicConversion: "10", marketingBudget: "100", marketingGrowth: "50",
      signupCost: "5", customerActivation: "50", customerChurn: "10", ordersPerCustomer: "2",
      orderValue: "50", rate: "10", days: "0",
    }],
  });
  const [first, next] = forecast.months;
  assert.equal(first.details.streams[0].paidSignups, 20);
  assert.equal(first.details.streams[0].customers, 33);
  assert.equal(first.revenue, 330);
  assert.equal(first.overhead, 100);
  near(next.details.streams[0].customers, 50.7);
  near(next.revenue, 507);
  assert.equal(next.overhead, 150);
  near(next.check, 0);
});

test("disabled funding and working-capital cards stay saved but do not enter forecasts", () => {
  const { consolidate } = globalThis.FinancialChannels;
  const answers = {
    start: "2027-01", months: "1", tax: "0",
    accounts: [{ name: "Bank", amount: "100" }, { name: "Reserve", amount: "200", enabled: "no" }],
    receivables: [{ name: "Uncollectible", enabled: "no" }],
    contributions: [{ name: "Investor", amount: "300", month: "1", enabled: "no" }],
  };
  const fields = questions.find(prompt => prompt.id === "receivables");
  assert.equal(errorFor(fields, answers.receivables, answers), "");
  const [model] = build(consolidate(answers).answers);
  assert.equal(model.months[0].cash, 100);
  assert.equal(answers.accounts[1].amount, "200");
  delete answers.accounts[1].enabled;
  assert.equal(build(consolidate(answers).answers)[0].months[0].cash, 300);
});

test("CAPEX replacement cohorts reconcile with depreciation, cash and fixed assets", () => {
  const [model] = build({
    start: "2027-01", months: "13", tax: "0", accounts: [{ name: "Bank", amount: "5000" }],
    ownedAssets: [{ name: "Fixtures", amount: "120", life: "2", replacement: "cycle",
      replacementCost: "240", replacementLife: "3", assetInflation: "0" }],
    investments: [{ name: "Computers", assetClass: "computers", amount: "100", month: "1", life: "12",
      replacement: "cycle", assetInflation: "21" }],
    staff: [{ name: "Staff", amount: "0", headcount: "1", month: "1", growth: "0", burden: "0" }],
    hireEquipment: "capital", hireEquipmentCost: "60", hireEquipmentLife: "2",
    hireEquipmentReplacement: "cycle", hireEquipmentInflation: "0",
  });
  const { months, annual } = model;
  near(months[0].capex, 160);
  near(months[0].assets, 181.66666666666666);
  near(months[2].capex, 300);
  near(months[2].details.ownedAssets[0].depreciation, 80);
  near(months[5].details.ownedAssets[0].replacement, 240);
  near(months[12].details.investments[0].replacement, 121);
  near(annual[0].details.ownedAssets[0].opening, 120);
  months.forEach((row, i) => {
    near(row.check, 0);
    near(row.investing, -row.capex);
    near(row.assets, (months[i - 1]?.assets ?? 120) + row.capex - row.depreciation);
  });
});

test("inventory receipts, write-offs and commitments reconcile with moving-average COGS", () => {
  const [model] = build({
    start: "2027-01", months: "4", tax: "0", accounts: [{ name: "Bank", amount: "1000" }],
    directCosts: [{ name: "Product", basis: "inventory", inventoryCode: "product", inventoryDemand: "manual", openingUnits: "4",
      openingUnitCost: "8", unitCost: "10", monthlyUnits: "3", unitGrowth: "0", minOrder: "5", leadMonths: "2", payableDays: "0" }],
    inventoryMovements: [
      { inventoryCode: "PRODUCT", movement: "order", month: "1", units: "2" },
      { inventoryCode: "product", movement: "loss", month: "2", units: "1" },
    ],
  });
  const [first, second, third] = model.months.map(row => row.details.directCosts[0]);
  assert.equal(first.openingOrders, 5);
  assert.equal(first.orderUnits, 2);
  assert.equal(first.pendingUnits, 7);
  near(first.cogs, 24);
  near(first.stock, 8);
  assert.equal(second.receivedUnits, 5);
  near(second.lossCost, 58 / 6);
  assert.equal(third.receivedUnits, 2);
  model.months.forEach(row => near(row.check, 0));
  assert.equal(model.annual[0].details.directCosts[0].openingUnits, 4);
  assert.equal(model.annual[0].details.directCosts[0].soldUnits, 12);
});

test("fixed-payment loan separates the draw from repayment and closes after the term", () => {
  const [model] = build({
    start: "2027-01", months: "4", tax: "0",
    newLoans: [{ name: "Loan", amount: "1000", rate: "12", repayment: "payment", month: "2", term: "2" }],
  });
  const [, draw, first, last] = model.months;
  near(draw.draw, 1000);
  near(draw.interest, 0);
  near(first.interest, 10);
  near(first.principal + first.interest, last.principal + last.interest);
  near(last.debt, 0);
  near(first.principal + last.principal, 1000);
  model.months.forEach(row => near(row.check, 0));
});

test("settings defaults feed asset depreciation, inventory, loan terms, and VAT with row overrides", () => {
  const [model] = build({
    start: "2027-01", months: "2", tax: "0", vatCadence: "monthly", vatCogsDefault: "10", vatSgaDefault: "20",
    assetLife_computers: "2", assetInflationDefault: "0", loanRateDefault: "0", loanTermDefault: "2",
    inventoryMinDefault: "5", inventoryLeadDefault: "1", inventoryCostDefault: "10",
    directCosts: [{ name: "Stock", basis: "inventory", inventoryCode: "stock", openingUnits: "0", monthlyUnits: "2", unitGrowth: "0" }],
    expenses: [{ name: "Shared rate", amount: "100", month: "1", growth: "0" }, { name: "Exempt", amount: "100", month: "1", growth: "0", vatRate: "0" }],
    investments: [{ name: "Computers", assetClass: "computers", amount: "120", month: "1" }],
    existingLoans: [{ name: "Loan", amount: "200" }],
  });
  const [first, second] = model.months;
  assert.equal(first.depreciation, 60);
  assert.equal(first.principal, 100);
  assert.equal(first.purchases, 50);
  assert.equal(first.vatPurchases, 5);
  assert.equal(first.vatExpenses, 20);
  assert.equal(second.assets, 0);
  model.months.forEach(row => near(row.check, 0));
});

test("fiscal tax accrual, quarterly payments, opening liability, and April settlement reconcile", () => {
  const [model] = build({
    start: "2027-01", months: "16", tax: "20", incomeTaxTiming: "fiscal", fiscalStart: "1", taxSettlementMonth: "4",
    taxInstallments: "quarterly", openingIncomeTax: "30", openingIncomeTaxMonth: "2",
    openingCapital: "50", accounts: [{ name: "Bank", amount: "100" }],
    streams: [{ name: "Sales", method: "direct", amount: "100", growth: "0", days: "0" }],
  });
  const { months } = model;
  assert.equal(months[0].tax, 20);
  assert.equal(months[0].incomeTaxPayable, 50);
  assert.equal(months[0].capital, 50);
  assert.equal(months[1].incomeTaxPayment, 30);
  assert.equal(months[2].incomeTaxPayment, 60);
  assert.equal(months[15].incomeTaxPayment, 60);
  months.forEach(row => near(row.check, 0));
});

test("revenue starts at launch and an acquisition campaign respects its own start and budget cap", () => {
  const [model] = build({ start: "2027-01", months: "5", tax: "0", streams: [
    { name: "Launch", method: "direct", amount: "10", launchMonth: "2", growth: "100", days: "0" },
    { name: "Acquisition", method: "orders", orderForecast: "acquisition", launchMonth: "2", campaignMonth: "3",
      marketingBudget: "10", budgetScaling: "amount", marketingStep: "7", marketingCap: "20", signupCost: "1",
      openingCustomers: "0", organicTraffic: "0", organicConversion: "0", customerActivation: "100", customerChurn: "0",
      orderValue: "1", ordersPerCustomer: "1", rate: "100", growth: "0", days: "0" },
  ] });
  assert.deepEqual(model.months.map(row => row.details.streams[0].revenue), [0, 10, 20, 40, 80]);
  assert.deepEqual(model.months.map(row => row.paidMarketing), [0, 0, 10, 17, 20]);
  assert.deepEqual(model.months.map(row => row.details.streams[1].units), [0, 0, 10, 27, 47]);
});
