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
