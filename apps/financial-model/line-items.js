(() => {
  const text = (id, label) => ({ id, label, type: "text" });
  const num = (id, label, options = {}) => ({ id, label, type: "number", min: 0, max: 1e12, ...options });
  const amount = (id, label, options) => num(id, label, { unit: "currency", ...options });
  const pct = (id, label, options) => num(id, label, { max: 100, unit: "%", ...options });
  const growth = label => pct("growth", label, { min: -100, initial: "0" });
  const vat = label => pct("vatRate", label, { optional: true });
  const month = (id, label, initial) => num(id, label, { min: 1, withinForecast: true, step: 1, initial });
  const life = (id, label) => num(id, label, { min: 1, max: 600, step: 1 });
  const settlement = label => num("month", label, { min: 1, max: 600, step: 1, initial: "1" });
  const days = (id, label) => num(id, label, { max: 365, initial: "0" });
  const select = (id, label, choices, initial) => ({ id, label, choices, initial, type: "select" });
  const name = text("name", "Line item name");
  const group = (id, section, label, hint, item, fields, presets = [], required = false) =>
    ({ id, section, label, hint, item, fields: [name, ...fields], presets, required, type: "items" });
  const metered = row => row.basis === "usage";
  const expenseGroups = [
    ["marketing", "Marketing & Growth", ["Marketing", "Google Ads", "HubSpot"]],
    ["professional", "Professional Services", ["Legal", "Professional fees and compliance", "Accounting"]],
    ["rent", "Rent", ["Office rent", "Equipment rent", "Rent and utilities"]],
    ["technology", "Tech Support & Services", ["Google Workspace", "IT support"]],
    ["insurance", "Insurance", ["Insurance", "Employee insurance", "Asset insurance"]],
    ["utilities", "Utilities", ["Power", "Internet", "Phone"]],
    ["other", "Other Expenses", ["Bank fees", "Travel"]],
  ];
  const presetExpenseCategories = new Map(expenseGroups.flatMap(([id, , names]) => names.map(name => [name, id])));
  const expenseFields = [
    select("category", "Expense category", expenseGroups.map(([id, label]) => [id, label]), "other"),
    select("basis", "Cost basis", [["fixed", "Monthly bill"], ["usage", "Base bill + metered usage"]], "fixed"),
    amount("amount", "Monthly bill or base fee", { initial: "0" }),
    { ...select("priceCurrency", "Unit price currency", [["model", "Forecast currency"], ["USD", "USD"]], "model"), when: metered },
    num("unitCost", "Price per billable unit", { initial: "0", when: metered }),
    num("quantity", "Usage in the first active month", { initial: "0", when: metered }),
    num("included", "Units included each month", { initial: "0", when: metered }),
    num("fx", "Forecast currency per USD", { min: 0.000001, optional: true, when: row => metered(row) && row.priceCurrency === "USD" }),
    month("month", "First expense month", "1"),
    num("endMonth", "Last expense month (optional)", { min: 1, max: 84, step: 1, optional: true }),
    select("cadence", "Apply growth", [["annual", "Annually"], ["monthly", "Monthly"]], "annual"),
    growth("Cost or usage growth per interval"), vat("Recoverable VAT rate (optional)"),
  ];

  function expenseDefaults(row) {
    return { basis: "fixed", priceCurrency: "model", cadence: "annual",
      category: presetExpenseCategories.get(row.name) || "other", ...row };
  }

  const staffDepartments = [
    ["Operations", ["CEO", "COO", "Office Manager"]],
    ["Product", ["CTO", "VP of Product", "UI/UX", "Senior developers", "Junior developers"]],
    ["Sales", ["VP of Sales", "Senior Sales", "Junior Sales"]],
    ["Marketing", ["VP of Marketing/CMO", "Senior Marketing", "Junior Marketing"]],
    ["Customer Support", ["Head of Customer Support", "Senior Customer Support", "Junior Customer Support"]],
    ["Finance and Administration", []],
  ];
  const acquisition = row => row.method === "orders" && row.orderForecast === "acquisition";
  const paidRole = row => row.roleType !== "disabled";
  const scalingTeam = row => row.roleType === "scaling";
  const groups = [
    group("streams", "Revenue", "What are your revenue streams?", "Add each product, service or income stream and enter how it earns revenue. Collection days estimate the sales still owed at month end.", "revenue stream", [
      select("method", "Revenue driver", [["units", "Units × price"], ["subscription", "Subscriptions × monthly price"], ["direct", "Monthly sales amount"], ["orders", "Orders × average value × fee rate"], ["percentage", "Percentage of transaction or payout"]], "units"),
      num("units", "Units sold in first month", { when: row => row.method === "units" }),
      { ...select("orderForecast", "Forecast orders from", [["growth", "Starting orders and growth"], ["acquisition", "Customer acquisition and retention"]], "growth"),
        optional: true, when: row => row.method === "orders" },
      num("orders", "Estimated orders or transactions in month one", { step: 1, initial: "0", when: row => row.method === "orders" && !acquisition(row) }),
      num("openingCustomers", "Active customers before month one", { initial: "0", when: acquisition }),
      num("organicTraffic", "Organic visits in month one", { initial: "0", when: acquisition }),
      pct("organicConversion", "Organic visits that become signups", { initial: "0", when: acquisition }),
      amount("marketingBudget", "First-month paid marketing budget", { initial: "0", when: acquisition }),
      pct("marketingVATRate", "Recoverable VAT on paid marketing (optional)", { optional: true, when: acquisition }),
      pct("marketingGrowth", "Monthly marketing budget change", { min: -100, initial: "0", when: acquisition }),
      amount("signupCost", "Cost per paid signup", { min: 0.000001, initial: "1", when: acquisition }),
      pct("customerActivation", "Signups that become active customers", { initial: "0", when: acquisition }),
      pct("customerChurn", "Monthly active customer churn", { initial: "0", when: acquisition }),
      num("ordersPerCustomer", "Monthly orders per active customer", { initial: "1", when: acquisition }),
      amount("orderValue", "Average eligible value per order", { initial: "0", when: row => row.method === "orders" }),
      num("active", "Subscribers before month one", { when: row => row.method === "subscription", initial: "0" }),
      num("newSubscribers", "New subscribers in first month", { when: row => row.method === "subscription" }),
      pct("churn", "Monthly subscriber churn", { when: row => row.method === "subscription", initial: "0" }),
      amount("price", "Price per unit or subscriber", { when: row => row.method === "units" || row.method === "subscription" }),
      amount("amount", "First-month revenue", { when: row => row.method === "direct" }),
      amount("transactionValue", "First-month transaction or payout value", { when: row => row.method === "percentage" }),
      pct("rate", "Percentage earned", { initial: "0", when: row => row.method === "percentage" || row.method === "orders" }),
      { ...growth("Monthly sales growth"), when: row => !acquisition(row) },
      { ...pct("growth", "Monthly organic traffic growth", { min: -100, initial: "0", when: acquisition }) },
      days("days", "Customer payment days"), vat("VAT charged on sales (optional)"),
    ], ["Product sales", "Services", "Subscriptions", "Transaction fees", "Revenue share"], true),
    group("directCosts", "Costs", "What does it cost to deliver your sales?", "Add production, delivery and payment costs as a share of revenue or a monthly amount. Include stock and supplier terms where they apply.", "direct cost", [
      select("basis", "Cost basis", [["rate", "Percentage of applicable revenue"], ["fixed", "Monthly amount"]], "rate"),
      pct("rate", "Share of applicable revenue", { when: row => row.basis === "rate" }),
      amount("amount", "Starting monthly cost", { when: row => row.basis === "fixed" }),
      { ...growth("Annual cost change"), when: row => row.basis === "fixed" },
      amount("stock", "Opening inventory at cost", { initial: "0" }),
      days("inventoryDays", "Target inventory days"),
      days("payableDays", "Supplier payment days"), vat("Recoverable VAT on purchases (optional)"),
    ], ["Payment provider fees borne by Peebee", "Fulfilment costs borne by Peebee", "Promotions and credits funded by Peebee"]),
    {
      ...group("staff", "Costs", "Which roles or teams will you pay?",
        "Choose a single hire, a scaling team, or a fixed team. Disabled roles keep their assumptions. Raises apply every 12 paid months from the first paid month.", "role", [
        { ...select("department", "Department", staffDepartments.map(([department]) => [department, department]), ""), optional: true },
        select("roleType", "Role type", [["single", "Single Hire"], ["scaling", "Scaling Team"], ["fixed", "Fixed Team"], ["disabled", "Disabled"]], "single"),
        num("headcount", "Fixed headcount", { initial: "1", when: row => row.roleType === "fixed" }),
        { ...select("salaryBasis", "Salary basis", [["monthly", "Monthly"], ["annual", "Annual"]], "monthly"), when: paidRole },
        amount("amount", "Monthly salary per person", { when: row => paidRole(row) && row.salaryBasis !== "annual" }),
        amount("annualSalary", "Starting annual salary per person", { when: row => paidRole(row) && row.salaryBasis === "annual" }),
        pct("burden", "Employer taxes and benefits", { initial: "0", when: paidRole }),
        { ...month("month", "First paid month", "1"), when: paidRole },
        num("endMonth", "Last paid month (optional)", { min: 1, max: 84, step: 1, optional: true, when: paidRole }),
        { ...growth("Annual salary change"), when: paidRole },
        num("hiresPerPeriod", "Hires per period", { min: 1, step: 1, initial: "1", when: scalingTeam }),
        { ...select("hiringInterval", "Add hires", [["1", "Every month"], ["3", "Every quarter"], ["6", "Every six months"], ["12", "Every twelve months"]], "3"), when: scalingTeam },
        num("maxTeamSize", "Maximum team size", { min: 1, step: 1, initial: "5", when: scalingTeam }),
      ], staffDepartments.flatMap(([, roles]) => roles)),
      presetRows: staffDepartments.flatMap(([department, roles]) => roles.map(name => ({ name, department }))),
      presetGroups: staffDepartments.filter(([, roles]) => roles.length),
    },
    {
      ...group("expenses", "Costs", "What are your operating expenses?", "Categorize expenses for the SG&A schedule. Enter an invoice amount or forecast usage above a monthly allowance. Use growth or later phases for changes in price or usage.", "expense",
        expenseFields, [...presetExpenseCategories.keys()]),
      presetRows: [...presetExpenseCategories].map(([name, category]) => ({ name, category })),
      presetGroups: expenseGroups.map(([, label, names]) => [label, names]),
    },
    group("accounts", "Working capital", "Where is your opening cash held?", "Add the opening amount for each bank account, cash balance, or cash equivalent.", "cash account", [
      amount("amount", "Opening cash balance"),
    ], ["Operating bank account", "Peebee-owned mobile money", "Cash on hand"]),
    group("receivables", "Working capital", "Who already owes the business money?", "List existing invoices or customer balances and when each is expected to be collected. Balances settling after the forecast stay outstanding. New sales receivables use each stream’s terms.", "receivable", [
      amount("amount", "Opening amount owed"), settlement("Collection month"),
    ]),
    group("payables", "Working capital", "Who does the business already owe?", "List existing supplier balances and when they will be paid. Balances settling after the forecast stay outstanding. New purchases use each direct cost’s terms.", "payable", [
      amount("amount", "Opening amount due"), settlement("Payment month"),
    ]),
    group("ownedAssets", "Investment", "Which fixed assets do you already own?", "Use the current book value and remaining useful life for each asset or asset group.", "existing asset", [
      amount("amount", "Opening book value"), life("life", "Remaining useful life in months"),
    ], ["Equipment", "Vehicles", "Furniture"]),
    group("investments", "Investment", "What fixed assets will you buy?", "List planned purchases and enter when each asset goes into use. Straight-line depreciation begins in the purchase month.", "purchase", [
      amount("amount", "Purchase cost"), month("month", "Purchase month", "1"), life("life", "Useful life in months"),
    ], ["Equipment", "Vehicles", "Technology"]),
    group("existingLoans", "Funding", "Which loans are already outstanding?", "Enter the remaining principal, annual interest and repayment term for each loan. Principal is paid in equal installments from month one.", "existing loan", [
      amount("amount", "Opening loan principal"), pct("rate", "Annual interest rate"), life("term", "Months left to repay"),
    ]),
    group("newLoans", "Funding", "What new loans will you take out?", "Enter each loan draw. Interest starts in the draw month and equal principal installments start the following month.", "planned loan", [
      amount("amount", "Loan principal"), month("month", "Draw month", "1"), pct("rate", "Annual interest rate"), life("term", "Repayment term in months"),
    ]),
    group("contributions", "Funding", "What equity contributions do you expect?", "List each owner or investor contribution and when it will arrive.", "contribution", [
      amount("amount", "Equity contribution"), month("month", "Contribution month", "1"),
    ], ["Owner contribution", "Investor funding"]),
  ];
  const channels = {
    ...group("channels", "Revenue", "Which channels earn income?", "Review Peebee’s business lines. You can rename, remove or add a channel.", "channel", [],
      [], true),
    keyed: true,
  };
  const byId = Object.fromEntries(groups.map(group => [group.id, group]));
  const channelStreams = {
    ...byId.streams,
    hint: "Add the revenue this channel earns from customers or partners. Exclude transfers between your channels and count each source of revenue once.",
    presets: ["Transaction fees", "Revenue share", "Subscriptions", "Product sales", "Services"],
  };
  const fieldsFor = (group, row) => group.fields.filter(field => !field.when || field.when(row));

  function upgradeDraft(old) {
    const answers = { hireEquipment: "none", vatCadence: "off", ...old };
    const carry = (id, keys, used, row) => {
      if (Array.isArray(old[id]) || !keys.some(key => old[key] != null && old[key] !== "")) return;
      answers[id] = used ? [row] : [];
    };
    carry("streams", ["revenueMethod", "revenue", "units", "active", "newSubscribers", "price", "growth"], true, {
      name: "Sales", method: old.revenueMethod || "", amount: old.revenue, units: old.units,
      active: old.active, newSubscribers: old.newSubscribers, churn: old.churn, price: old.price,
      growth: old.growth, days: old.arDays ?? "0",
    });
    carry("directCosts", ["cogsRate", "openingInventory", "inventoryDays", "apDays"],
      [old.cogsRate, old.openingInventory, old.inventoryDays, old.apDays].some(value => Number(value) > 0), {
        name: "Direct costs", basis: "rate", rate: old.cogsRate ?? "0", stock: old.openingInventory ?? "0",
        inventoryDays: old.inventoryDays ?? "0", payableDays: old.apDays ?? "0",
      });
    carry("staff", ["payroll"], Number(old.payroll) > 0, { name: "Payroll", headcount: "1", amount: old.payroll, burden: "0", month: "1", growth: old.payrollGrowth ?? "0" });
    carry("expenses", ["overhead"], Number(old.overhead) > 0, { name: "Operating expenses", amount: old.overhead, month: "1", growth: old.overheadGrowth ?? "0" });
    for (const [id, key, label, fields] of [
      ["accounts", "cash", "Opening cash", {}],
      ["receivables", "openingAR", "Opening receivables", { month: "1" }],
      ["payables", "openingAP", "Opening payables", { month: "1" }],
      ["ownedAssets", "openingAssets", "Existing fixed assets", { life: old.openingLife }],
      ["investments", "capex", "Capital expenditure", { month: old.capexMonth, life: old.capexLife }],
      ["existingLoans", "openingDebt", "Opening loan", { rate: old.openingRate, term: old.openingTerm }],
      ["newLoans", "loan", "New loan", { month: old.loanMonth, rate: old.loanRate, term: old.loanTerm }],
      ["contributions", "funding", "Equity contribution", { month: old.fundingMonth }],
    ]) carry(id, [key], Number(old[key]) > 0, { name: label, amount: old[key], ...fields });
    if (Array.isArray(answers.staff)) {
      answers.staff = answers.staff.filter(row => row && typeof row === "object").map(row => ({
        roleType: row.headcount === "1" ? "single" : "fixed", salaryBasis: "monthly", ...row,
      }));
    }
    if (Array.isArray(answers.expenses)) {
      const technologyNames = globalThis.PeebeeDefaults?.technologyCosts.map(([name]) => name) || [];
      answers.expenses = answers.expenses.filter(row => row && typeof row === "object").map(row => expenseDefaults({
        ...(technologyNames.some(name => row.name === name || row.name?.startsWith(name + " · next phase")) ? { category: "technology" } : {}),
        ...row,
      }));
    }
    return answers;
  }

  const scopedCostGroups = new Set(["directCosts", "staff", "expenses", "ownedAssets", "investments"]);
  globalThis.FinancialLineItems = { byId, channels, channelStreams, fieldsFor, upgradeDraft, scopedCostGroups, expenseGroups, expenseDefaults, acquisition, staffDepartments };
})();
