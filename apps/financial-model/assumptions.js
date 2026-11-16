(() => {
  const { byId, fieldsFor, upgradeDraft } = globalThis.FinancialLineItems;
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

  const sections = ["Company", "Revenue", "Costs", "Working capital", "Investment", "Funding", "Scenarios"];
  const questions = [
    question("company", "Company", "What is your company name?", "This name appears on your forecast and exports.", { type: "text", placeholder: "e.g. Acacia Studio" }),
    choice("currency", "Company", "Which currency do you plan in?", "Use this currency for every amount you enter.",
      [["UGX", "UGX · Ugandan shilling"], ["USD", "USD · US dollar"], ["KES", "KES · Kenyan shilling"], ["TZS", "TZS · Tanzanian shilling"], ["RWF", "RWF · Rwandan franc"], ["EUR", "EUR · Euro"], ["GBP", "GBP · British pound"], ["ZAR", "ZAR · South African rand"], ["NGN", "NGN · Nigerian naira"], ["CAD", "CAD · Canadian dollar"], ["AUD", "AUD · Australian dollar"], ["other", "Another currency"]]),
    question("customCurrency", "Company", "What is the three-letter currency code?", "For example, GHS for Ghanaian cedi.", { type: "text", pattern: "[A-Za-z]{3}", when: is("currency", "other") }),
    question("start", "Company", "When should the forecast begin?", "Choose the first month you want to forecast.", { type: "month", suggestion: currentMonth }),
    number("months", "Company", "How far ahead do you want to plan?", "Enter 1 to 84 months. Annual columns group months by calendar year.", { ...period, suggestion: "36" }),
    byId.streams, byId.directCosts, byId.staff, byId.expenses,
    percent("tax", "Costs", "What income tax rate should the model use?", "The model estimates and pays tax on positive profit monthly. Enter 0 if exempt."),
    byId.accounts, byId.receivables, byId.payables,
    byId.ownedAssets, byId.investments,
    byId.existingLoans, byId.newLoans, byId.contributions,
    confirm("scenarios", "Scenarios", "Would you like to compare scenarios?", "Add a downside and upside forecast by applying an adjustment to each stream’s monthly sales growth."),
    percent("downside", "Scenarios", "How much lower is growth in the downside case?", "Enter percentage points below base growth. For example, 2 points reduces 5% growth to 3%.", { ...yes("scenarios"), unit: "percentage points" }),
    percent("upside", "Scenarios", "How much higher is growth in the upside case?", "Enter percentage points above base growth.", { ...yes("scenarios"), unit: "percentage points" }),
    confirm("valuation", "Scenarios", "Would you like a discounted cash flow valuation?", "The model discounts unlevered forecast cash flows and an optional exit value."),
    percent("discountRate", "Scenarios", "What annual discount rate should be used?", "Enter the weighted average cost of capital you want to use in the DCF.", yes("valuation")),
    amount("exitValue", "Scenarios", "What is the enterprise exit value?", "Enter the value at the end of the forecast, or 0 to value forecast cash flows alone.", yes("valuation")),
  ];

  const example = upgradeDraft({
    company: "Acacia Studio", currency: "USD", start: currentMonth, months: "36",
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

  function itemError(prompt, rows, answers) {
    const names = new Set();
    for (const [index, row] of rows.entries()) {
      for (const field of fieldsFor(prompt, row)) {
        const issue = errorFor(field, row[field.id], answers);
        if (issue) return { id: `item-${index}-${field.id}`, message: `Line ${index + 1}, ${field.label}: ${issue}` };
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
    if (typeof value !== "string" || !value.trim()) return "Enter an answer to continue.";
    if (prompt.type === "select" && !prompt.choices.some(([id]) => id === value)) return "Choose one of the listed options.";
    if (prompt.type === "month" && !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value)) return "Enter a valid month between 1900 and 2199.";
    if (prompt.pattern && !new RegExp(`^${prompt.pattern}$`).test(value.trim())) return "Enter a three-letter currency code.";
    if (prompt.type !== "number") return "";
    const n = Number(value);
    const max = prompt.withinForecast ? Number(answers.months) : prompt.max;
    if (!Number.isFinite(n) || n < prompt.min || n > max) return `Enter a value from ${prompt.min.toLocaleString()} to ${max.toLocaleString()}.`;
    if (prompt.step === 1 && !Number.isInteger(n)) return "Enter a whole number.";
    return "";
  }

  globalThis.FinancialAssumptions = { questions, sections, example, errorFor, itemError };
})();
