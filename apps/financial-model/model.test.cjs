const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./line-items.js");
require("./assumptions.js");
require("./model.js");
const { example, questions, errorFor } = globalThis.FinancialAssumptions;
const { build, sum } = globalThis.FinancialModel;

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
}

test("example inputs validate and every scenario reconciles through the final period", () => {
  const answers = { ...example, start: "2026-10" };
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
  const forecast = { ...example, scenarios: "no", months: "14", start: "2026-01",
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
