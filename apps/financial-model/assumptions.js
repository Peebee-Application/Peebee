(() => {
  const { byId, fieldsFor, assetCategories } = globalThis.FinancialLineItems;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const question = (id, section, label, hint, options = {}) => ({ id, section, label, hint, ...options });
  const number = (id, section, label, hint, options = {}) =>
    question(id, section, label, hint, { type: "number", min: 0, max: 1e12, ...options });
  const amount = (id, section, label, hint, options = {}) =>
    number(id, section, label, hint, { unit: "currency", ...options });
  const percent = (id, section, label, hint, options = {}) =>
    number(id, section, label, hint, { unit: "%", max: 100, ...options });
  const choice = (id, section, label, hint, choices, options = {}) =>
    question(id, section, label, hint, { type: "select", choices, ...options });
  const confirm = (id, section, label, hint) =>
    choice(id, section, label, hint, [["yes", "Yes"], ["no", "No"]]);
  const is = (id, value) => answers => answers[id] === value;
  const yes = id => ({ when: is(id, "yes") });
  const period = { min: 1, max: 84, step: 1, unit: "months" };

  const monthsOfYear = Array.from({ length: 12 }, (_, index) => [String(index + 1),
    new Intl.DateTimeFormat("en-UG", { timeZone: "UTC", month: "long" }).format(Date.UTC(2026, index, 1))]);
  const fiscal = is("incomeTaxTiming", "fiscal");
  const sections = ["Company", "Revenue", "Costs", "Working capital", "Investment", "Funding", "Scenarios"];
  const questions = [
    question("companyName", "Company", "Company name", "Name shown on reports and exports.", { type: "text", optional: true }),
    question("lastActualMonth", "Company", "Last recorded actuals month", "Record the historical cutoff for your reference. Forecast reports begin in the forecast start month.", { type: "month", optional: true }),
    choice("currency", "Company", "Which currency do you plan in?", "Use this currency for every amount you enter.",
      [["UGX", "UGX · Ugandan shilling"], ["USD", "USD · US dollar"], ["KES", "KES · Kenyan shilling"], ["TZS", "TZS · Tanzanian shilling"], ["RWF", "RWF · Rwandan franc"], ["EUR", "EUR · Euro"], ["GBP", "GBP · British pound"], ["ZAR", "ZAR · South African rand"], ["NGN", "NGN · Nigerian naira"], ["CAD", "CAD · Canadian dollar"], ["AUD", "AUD · Australian dollar"], ["other", "Another currency"]]),
    question("customCurrency", "Company", "What is the three-letter currency code?", "For example, GHS for Ghanaian cedi.", { type: "text", pattern: "[A-Za-z]{3}", when: is("currency", "other") }),
    question("start", "Company", "When should the forecast begin?", "Choose the first month you want to forecast.", { type: "month", suggestion: currentMonth }),
    number("months", "Company", "How far ahead do you want to plan?", "Enter 1 to 84 months. Annual columns group months by calendar year.", { ...period, suggestion: "36" }),
    byId.streams, byId.directCosts, byId.staff, byId.expenses,
    choice("hireEquipment", "Costs", "How should equipment for new hires be recorded?",
      "Buys one unit for each increase in forecast headcount, including the opening month. Choose where to record the purchase.",
      [["none", "No hiring equipment"], ["expense", "Operating expense"], ["capital", "Capital expenditure"]], { optional: true }),
    amount("hireEquipmentCost", "Costs", "What does equipment cost per added employee?", "Enter the cost of one unit of equipment.",
      { when: answers => ["expense", "capital"].includes(answers.hireEquipment) }),
    number("hireEquipmentLife", "Costs", "How long will the equipment be used?", "Use months. Straight-line depreciation starts in the purchase month.",
      { min: 1, max: 600, step: 1, unit: "months", when: is("hireEquipment", "capital") }),
    choice("hireEquipmentReplacement", "Costs", "Should capitalized hiring equipment be replaced?",
      "Replace each purchase after its useful life, including equipment purchased for later hires.", [["none", "No automatic replacement"], ["cycle", "Replace at end of useful life"]],
      { optional: true, when: is("hireEquipment", "capital") }),
    percent("hireEquipmentInflation", "Costs", "How will hiring equipment replacement prices change each year?",
      "Enter the annual price change between purchases of the same equipment.",
      { min: -100, when: answers => answers.hireEquipment === "capital" && answers.hireEquipmentReplacement === "cycle" }),
    percent("tax", "Costs", "What income tax rate should the model use?", "Enter the income tax rate Peebee should forecast on positive profit. Use 0 if exempt."),
    choice("incomeTaxTiming", "Costs", "Income tax payment schedule", "Choose monthly payments or settlement after the fiscal year closes.",
      [["monthly", "Monthly"], ["fiscal", "Fiscal-year settlement"]], { optional: true }),
    choice("fiscalStart", "Costs", "Fiscal year starts in", "First month of each income tax year.", monthsOfYear, { when: fiscal }),
    choice("taxSettlementMonth", "Costs", "Income tax consolidation month", "The calendar month when the previous fiscal year is settled.", monthsOfYear, { when: fiscal }),
    choice("taxInstallments", "Costs", "Partial income tax payments", "Quarterly payments use the estimated tax on year-to-date profit.",
      [["none", "Disabled"], ["quarterly", "Quarterly"]], { when: fiscal, optional: true }),
    percent("vatSgaDefault", "Costs", "Default recoverable VAT on SG&A", "Applies when an expense has no VAT override.", { optional: true }),
    percent("vatCogsDefault", "Costs", "Default recoverable VAT on COGS", "Applies when a direct cost has no VAT override.", { optional: true }),
    choice("vatCadence", "Costs", "When should the forecast pay VAT?",
      "Enter sales and costs before VAT and set the VAT rates on their cards. Payments settle the previous period’s positive VAT balance. Credits carry forward.",
      [["off", "VAT excluded"], ["monthly", "After each month"], ["quarterly", "After each quarter"], ["annual", "After the fiscal year"]], { optional: true }),
    choice("vatYearEnd", "Costs", "When does the VAT reporting year end?", "The payment is scheduled for the following month. Quarterly boundaries use the same year end.",
      Array.from({ length: 12 }, (_, index) => [String(index + 1), new Intl.DateTimeFormat("en-UG", { timeZone: "UTC", month: "long" }).format(Date.UTC(2026, index, 1))]),
      { when: answers => ["quarterly", "annual"].includes(answers.vatCadence) }),
    amount("openingVAT", "Working capital", "What VAT balance is carried into the forecast?",
      "Enter a positive amount for tax owed or a negative amount for a credit.",
      { min: -1e12, optional: true, when: answers => Boolean(answers.vatCadence && answers.vatCadence !== "off") }),
    amount("openingCapital", "Working capital", "Opening invested capital", "Leave blank to use opening net assets. Entered capital is shown separately from opening retained earnings.", { optional: true }),
    amount("openingIncomeTax", "Working capital", "Opening income tax owed", "Tax owed at forecast start.", { optional: true }),
    number("openingIncomeTaxMonth", "Working capital", "Pay opening income tax in model month", "Use 1 for the first forecast month.", { min: 1, max: 84, step: 1, when: answers => Number(answers.openingIncomeTax) > 0 }),
    byId.accounts, byId.receivables, byId.payables, byId.inventoryMovements, byId.actuals,
    ...assetCategories.map(([key, label, life]) => number("assetLife_" + key, "Investment", label + " default useful life",
      "Used when a new purchase or replacement has no useful life override.", { min: 1, max: 600, step: 1, unit: "months", optional: true, suggestion: life })),
    percent("assetInflationDefault", "Investment", "Default annual replacement price change", "Used when an asset has no inflation override.", { min: -100, optional: true }),
    number("inventoryMinDefault", "Investment", "Default minimum inventory order", "Used when an inventory plan has no minimum override.", { min: 1, step: 1, optional: true }),
    number("inventoryLeadDefault", "Investment", "Default manufacturing lead time", "Used when an inventory plan has no lead time override.", { max: 84, step: 1, unit: "months", optional: true }),
    amount("inventoryCostDefault", "Investment", "Default manufacturing cost per unit", "Used when an inventory plan has no unit-cost override.", { optional: true }),
    byId.ownedAssets, byId.investments,
    percent("loanRateDefault", "Funding", "Default loan interest rate", "Used when a loan has no rate override.", { optional: true }),
    number("loanTermDefault", "Funding", "Default loan repayment term", "Used when a loan has no term override.", { min: 1, max: 600, step: 1, unit: "months", optional: true }),
    byId.existingLoans, byId.newLoans, byId.contributions,
    confirm("scenarios", "Scenarios", "Would you like to compare scenarios?", "Add a downside and upside forecast by applying an adjustment to each stream’s monthly sales growth."),
    percent("downside", "Scenarios", "How much lower is growth in the downside case?", "Enter percentage points below base growth. For example, 2 points reduces 5% growth to 3%.", { ...yes("scenarios"), unit: "percentage points" }),
    percent("upside", "Scenarios", "How much higher is growth in the upside case?", "Enter percentage points above base growth.", { ...yes("scenarios"), unit: "percentage points" }),
    confirm("valuation", "Scenarios", "Would you like a discounted cash flow valuation?", "The model discounts unlevered forecast cash flows and an optional exit value."),
    percent("discountRate", "Scenarios", "What annual discount rate should be used?", "Enter the weighted average cost of capital you want to use in the DCF.", yes("valuation")),
    amount("exitValue", "Scenarios", "What is the enterprise exit value?", "Enter the value at the end of the forecast, or 0 to value forecast cash flows alone.", yes("valuation")),
  ];

  function itemError(prompt, rows, answers) {
    const names = new Set();
    const inventoryCodes = new Set();
    const actualPeriods = new Set();
    for (const [index, row] of rows.entries()) {
      if (!prompt.keyed && row.enabled === "no") continue;
      for (const field of fieldsFor(prompt, row)) {
        const issue = errorFor(field, row[field.id], answers);
        if (issue) return { id: `item-${index}-${field.id}`, message: `Line ${index + 1}, ${field.label}: ${issue}` };
      }
      if (prompt.id === "directCosts" && row.basis === "inventory") {
        const code = row.inventoryCode.toLowerCase();
        if (inventoryCodes.has(code)) return { id: "item-" + index + "-inventoryCode", message: "Give each inventory plan a distinct code." };
        inventoryCodes.add(code);
      }
      if (prompt.id === "actuals") {
        if (actualPeriods.has(row.period)) return { id: "item-" + index + "-period", message: "Use one entry per historical month." };
        if (answers.start && row.period >= answers.start) return { id: "item-" + index + "-period", message: "Enter a month before the forecast starts." };
        actualPeriods.add(row.period);
      }
      if (prompt.id === "inventoryMovements" && !(answers.directCosts || []).some(cost =>
        cost.basis === "inventory" && cost.inventoryCode?.toLowerCase() === row.inventoryCode.toLowerCase())) {
        return { id: "item-" + index + "-inventoryCode", message: "Enter the code of a direct cost that uses Inventory by units." };
      }
      if (prompt.id === "staff" && row.roleType !== "disabled" && row.endMonth && Number(row.endMonth) < Number(row.month)) {
        return { id: `item-${index}-endMonth`, message: `Line ${index + 1}: Last paid month must be on or after the first paid month.` };
      }
      if (prompt.id === "expenses") {
        if (row.endMonth && Number(row.endMonth) < Number(row.month)) {
          return { id: `item-${index}-endMonth`, message: `Line ${index + 1}: Last expense month must be on or after the first month.` };
        }
        if (row.basis === "usage" && row.priceCurrency === "USD" && Number(row.unitCost) > 0 &&
            Number(row.quantity) > 0 && !row.fx) {
          return { id: `item-${index}-fx`, message: `Line ${index + 1}: Enter the exchange rate to convert your USD unit price.` };
        }
      }
      if (prompt.keyed) {
        const name = row.name.toLowerCase();
        if (names.has(name)) return { id: `item-${index}-name`, message: "Give each channel a distinct name." };
        names.add(name);
      }
    }
    return null;
  }

  function errorFor(prompt, value, answers) {
    if (prompt.type === "items") {
      if (!Array.isArray(value)) return "Review these line items to continue.";
      if (prompt.required && !value.length) return `Add at least one ${prompt.item}.`;
      return itemError(prompt, value, answers)?.message || "";
    }
    if (typeof value !== "string" || !value.trim()) return prompt.optional ? "" : "Enter an answer to continue.";
    if (prompt.type === "select" && !prompt.choices.some(([id]) => id === value)) return "Choose one of the listed options.";
    if (prompt.type === "month" && !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value)) return "Enter a valid month between 1900 and 2199.";
    if (prompt.pattern && !new RegExp(`^${prompt.pattern}$`).test(value.trim())) return prompt.patternError || "Enter a three-letter currency code.";
    if (prompt.type !== "number") return "";
    const n = Number(value);
    const max = prompt.withinForecast ? Number(answers.months) : prompt.max;
    if (!Number.isFinite(n) || n < prompt.min || n > max) return `Enter a value from ${prompt.min.toLocaleString()} to ${max.toLocaleString()}.`;
    if (prompt.step === 1 && !Number.isInteger(n)) return "Enter a whole number.";
    return "";
  }

  globalThis.FinancialAssumptions = { questions, sections, currentMonth, errorFor, itemError };
})();
