(() => {
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
  const nonzero = id => ({ when: answers => Number(answers[id]) > 0 });
  const period = { min: 1, max: 84, step: 1, unit: "months" };

  const sections = ["Company", "Revenue", "Costs", "Working capital", "Investment", "Funding", "Scenarios"];
  const questions = [
    question("company", "Company", "What is your company name?", "This name appears on your forecast and exports.", { type: "text", placeholder: "e.g. Acacia Studio" }),
    choice("currency", "Company", "Which currency do you plan in?", "Use this currency for every amount you enter.",
      [["UGX", "UGX · Ugandan shilling"], ["USD", "USD · US dollar"], ["KES", "KES · Kenyan shilling"], ["TZS", "TZS · Tanzanian shilling"], ["RWF", "RWF · Rwandan franc"], ["EUR", "EUR · Euro"], ["GBP", "GBP · British pound"], ["ZAR", "ZAR · South African rand"], ["NGN", "NGN · Nigerian naira"], ["CAD", "CAD · Canadian dollar"], ["AUD", "AUD · Australian dollar"], ["other", "Another currency"]]),
    question("customCurrency", "Company", "What is the three-letter currency code?", "For example, GHS for Ghanaian cedi.", { type: "text", pattern: "[A-Za-z]{3}", when: is("currency", "other") }),
    question("start", "Company", "When should the forecast begin?", "Choose the first month you want to forecast.", { type: "month", suggestion: currentMonth }),
    number("months", "Company", "How far ahead do you want to plan?", "Enter 1 to 84 months. Annual columns group months by calendar year.", { ...period, suggestion: "36" }),
    choice("revenueMethod", "Revenue", "How do you earn revenue?", "Choose the driver that best describes your main revenue stream.",
      [["units", "Units sold × average price"], ["subscription", "Subscriptions × monthly price"], ["direct", "Monthly revenue amount"]]),
    number("units", "Revenue", "How many units will you sell in month one?", "A unit can be a product, job, booking, or another billable item.", { unit: "units", when: is("revenueMethod", "units") }),
    number("active", "Revenue", "How many subscribers are active before month one?", "Enter zero if you are starting from scratch.", { unit: "subscribers", when: is("revenueMethod", "subscription") }),
    number("newSubscribers", "Revenue", "How many subscribers will join in month one?", "New subscribers are billed in the month they join.", { unit: "subscribers", when: is("revenueMethod", "subscription") }),
    percent("churn", "Revenue", "What share of subscribers will leave each month?", "Churn applies to the opening subscriber base.", { when: is("revenueMethod", "subscription") }),
    amount("price", "Revenue", "What is your average selling price?", "Enter the amount per unit or per subscriber per month, excluding sales tax.", { when: answers => Boolean(answers.revenueMethod) && answers.revenueMethod !== "direct" }),
    amount("revenue", "Revenue", "How much revenue do you expect in month one?", "Enter total sales for the first forecast month, excluding sales tax.", { when: is("revenueMethod", "direct") }),
    percent("growth", "Revenue", "How quickly will sales grow each month?", "Applies to units sold, new subscribers, or direct revenue. A negative rate models a decline.", { min: -100, suggestion: "0" }),
    percent("cogsRate", "Costs", "What share of revenue goes to direct costs?", "Include product costs, delivery, hosting, and payment fees as applicable. Enter 0 if none."),
    amount("payroll", "Costs", "What is your starting monthly payroll?", "Include wages, employer taxes, and benefits. Enter 0 if none."),
    percent("payrollGrowth", "Costs", "How much will payroll change each year?", "Applied at each forecast anniversary. Include raises and planned staffing changes.", { ...nonzero("payroll"), min: -100, suggestion: "0" }),
    amount("overhead", "Costs", "What are your other monthly operating expenses?", "Include rent, software, marketing, and professional fees. Enter 0 if none."),
    percent("overheadGrowth", "Costs", "How much will overhead change each year?", "Applied at each forecast anniversary.", { ...nonzero("overhead"), min: -100, suggestion: "0" }),
    percent("tax", "Costs", "What income tax rate should the model use?", "The model estimates and pays tax on positive profit monthly. Enter 0 if exempt."),
    amount("cash", "Working capital", "How much cash do you have at the start?", "Use your opening cash and bank balances. Enter 0 for a new company."),
    amount("openingAR", "Working capital", "How much do customers already owe you?", "Enter opening accounts receivable. The forecast releases the opening balance through working capital."),
    amount("openingInventory", "Working capital", "What inventory value do you already hold?", "Enter its cost at the start of the forecast, or 0 if none."),
    amount("openingAP", "Working capital", "How much do you already owe suppliers?", "Enter opening trade payables, or 0 if none."),
    number("arDays", "Working capital", "How many days do customers take to pay?", "Enter 0 for payment at sale. Used to estimate accounts receivable.", { unit: "days", max: 365, suggestion: "0" }),
    number("inventoryDays", "Working capital", "How many days of inventory will you hold?", "Enter 0 if you carry no stock. Forecast inventory is based on direct costs.", { unit: "days", max: 365, suggestion: "0" }),
    number("apDays", "Working capital", "How many days do you take to pay suppliers?", "Enter 0 for immediate payment. Used to estimate accounts payable from inventory-adjusted purchases.", { unit: "days", max: 365, suggestion: "0" }),
    amount("openingAssets", "Investment", "What is the opening book value of fixed assets?", "Use net carrying value after depreciation. Enter 0 if none."),
    number("openingLife", "Investment", "How much useful life do those assets have left?", "The remaining book value is depreciated evenly over this period.", { ...period, max: 600, ...nonzero("openingAssets") }),
    amount("capex", "Investment", "How much will you invest in new fixed assets?", "Enter a one-time purchase of equipment or other depreciable assets. Enter 0 if none."),
    number("capexMonth", "Investment", "When will you buy the new fixed assets?", "Month 1 is your first forecast month.", { ...period, withinForecast: true, ...nonzero("capex") }),
    number("capexLife", "Investment", "How long will the new assets last?", "Uses straight-line depreciation starting in the purchase month.", { ...period, max: 600, ...nonzero("capex") }),
    amount("openingDebt", "Funding", "How much loan principal is outstanding today?", "Enter 0 if the business has no opening debt."),
    percent("openingRate", "Funding", "What is the annual interest rate on opening debt?", "The model calculates monthly interest on outstanding principal.", nonzero("openingDebt")),
    number("openingTerm", "Funding", "How long is left to repay opening debt?", "Principal is repaid in equal monthly installments starting in month one.", { ...period, max: 600, ...nonzero("openingDebt") }),
    amount("loan", "Funding", "How much new borrowing do you plan?", "Enter a single new loan amount, or 0 if none."),
    number("loanMonth", "Funding", "In which month will the loan be drawn?", "Month 1 is your first forecast month.", { ...period, withinForecast: true, ...nonzero("loan") }),
    percent("loanRate", "Funding", "What is the annual interest rate on the new loan?", "Interest starts in the draw month. Principal repayments begin the following month.", nonzero("loan")),
    number("loanTerm", "Funding", "Over how many months will you repay the new loan?", "Principal is repaid in equal monthly installments.", { ...period, max: 600, ...nonzero("loan") }),
    amount("funding", "Funding", "How much new equity funding do you plan?", "Enter a one-time contribution from owners or investors, or 0 if none."),
    number("fundingMonth", "Funding", "In which month will equity funding arrive?", "Month 1 is your first forecast month.", { ...period, withinForecast: true, ...nonzero("funding") }),
    confirm("scenarios", "Scenarios", "Would you like to compare scenarios?", "Add a downside and upside forecast by changing monthly sales growth."),
    percent("downside", "Scenarios", "How much lower is growth in the downside case?", "Enter percentage points below base growth. For example, 2 points reduces 5% growth to 3%.", { ...yes("scenarios"), unit: "percentage points" }),
    percent("upside", "Scenarios", "How much higher is growth in the upside case?", "Enter percentage points above base growth.", { ...yes("scenarios"), unit: "percentage points" }),
    confirm("valuation", "Scenarios", "Would you like a discounted cash flow valuation?", "The model discounts unlevered forecast cash flows and an optional exit value."),
    percent("discountRate", "Scenarios", "What annual discount rate should be used?", "Enter the weighted average cost of capital you want to use in the DCF.", yes("valuation")),
    amount("exitValue", "Scenarios", "What is the enterprise exit value?", "Enter the value at the end of the forecast, or 0 to value forecast cash flows alone.", yes("valuation")),
  ];

  const example = {
    company: "Acacia Studio", currency: "USD", start: currentMonth, months: "36",
    revenueMethod: "units", units: "600", price: "45", growth: "3", cogsRate: "36",
    payroll: "9200", payrollGrowth: "8", overhead: "3800", overheadGrowth: "5", tax: "25",
    cash: "25000", openingAR: "3000", openingAP: "2000", openingInventory: "6000",
    arDays: "14", inventoryDays: "25", apDays: "20", openingAssets: "12000", openingLife: "36",
    capex: "18000", capexMonth: "4", capexLife: "48", openingDebt: "0",
    loan: "10000", loanMonth: "4", loanRate: "12", loanTerm: "24", funding: "0",
    scenarios: "yes", downside: "2", upside: "1", valuation: "yes", discountRate: "15", exitValue: "0",
  };

  function errorFor(prompt, value, answers) {
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

  globalThis.FinancialAssumptions = { questions, sections, example, errorFor };
})();
