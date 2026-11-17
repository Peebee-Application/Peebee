(() => {
  const { upgradeDraft, byId } = globalThis.FinancialLineItems;
  const halfCent = 0.005;
  const maxPreciseAmount = Number.MAX_SAFE_INTEGER / 100;

  class ForecastRangeError extends RangeError {
    constructor(scenario, period) {
      super(`The ${scenario.toLowerCase()} forecast exceeds the model’s reliable numerical range (${period}). Review the input amounts, growth rates or forecast length.`);
    }
  }

  function checkPrecision(values, scenario, period) {
    if (values.some(value => typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > maxPreciseAmount))) {
      throw new ForecastRangeError(scenario, period);
    }
  }

  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const total = rows => sum(rows, "amount");
  const numericLine = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, ["name", "method", "basis", "priceCurrency", "cadence"].includes(key) ? value : Number(value || 0)]));
  const amounts = answers => Object.fromEntries(Object.keys(byId).map(id => [id, (answers[id] || []).map(numericLine)]));
  const numeric = (row, key) => row[key] || 0;
  const stockAfter = (opening, cogs, days) => Math.max(opening - cogs, cogs * days / 30);
  const scheduled = (rows, month) => rows.map(row => ({ amount: row.month === month ? row.amount : 0 }));
  const outstanding = (rows, month) => rows.map(row => ({
    amount: row.month > month ? row.amount : 0,
    settled: row.month === month ? row.amount : 0,
  }));

  // Assume activity is evenly distributed within each 30-day model month.
  // Only purchases or sales already forecast can contribute to closing balances.
  function tradeBalance(amount, days, history, group, index, field) {
    const fullMonths = Math.floor(days / 30);
    const fraction = (days % 30) / 30;
    const atAge = age => age === 0 ? amount : history.at(-age)?.details[group][index][field] ?? 0;
    let balance = 0;
    for (let age = 0; age < fullMonths; age++) balance += atAge(age);
    return balance + fraction * atAge(fullMonths);
  }

  function sale(line, prior, elapsed, adjustment) {
    const { method, price } = line;
    const rate = Math.max(-1, (numeric(line, "growth") + adjustment) / 100);
    const scale = (1 + rate) ** elapsed;
    const units = method === "units" ? line.units * scale : method === "orders" ? line.orders * scale : 0;
    const joining = method === "subscription" ? line.newSubscribers * scale : 0;
    const opening = prior?.active ?? numeric(line, "active");
    const churn = method === "subscription" ? line.churn / 100 : 0;
    const leaving = opening * churn;
    const active = opening * (1 - churn) + joining;
    const volume = method === "orders" ? units * line.orderValue : method === "percentage" ? line.transactionValue * scale : 0;
    const feeRate = (method === "percentage" || method === "orders") ? line.rate / 100 : 0;
    const revenue = (method === "percentage" || method === "orders") ? volume * feeRate
      : method === "direct" ? line.amount * scale : (method === "units" ? units : active) * price;
    return { revenue, units, joining, leaving, active, price, volume, feeRate, orderValue: numeric(line, "orderValue") };
  }

  function firstMonthSale(row) {
    return sale(numericLine(row), null, 0, 0);
  }

  function directCost(line, prior, revenue, elapsed) {
    const cogs = line.basis === "fixed" ? line.amount * (1 + line.growth / 100) ** Math.floor(elapsed / 12) : revenue * line.rate / 100;
    const opening = prior?.stock ?? numeric(line, "stock");
    const stock = stockAfter(opening, cogs, numeric(line, "inventoryDays"));
    const purchases = Math.max(0, cogs + stock - opening);
    return { cogs, stock, purchases };
  }

  function operatingExpense(line, month) {
    const elapsed = month - line.month;
    const active = elapsed >= 0 && (!line.endMonth || month <= line.endMonth);
    if (!active) return { amount: 0, quantity: 0, base: 0 };
    const periods = line.cadence === "monthly" ? elapsed : Math.floor(elapsed / 12);
    const scale = (1 + line.growth / 100) ** periods;
    if (line.basis !== "usage") return { amount: line.amount * scale, quantity: 0, base: line.amount * scale };
    const quantity = line.quantity * scale;
    const variable = Math.max(0, quantity - line.included) * line.unitCost * (line.priceCurrency === "USD" ? (line.fx || 0) : 1);
    return { amount: line.amount + variable, quantity, base: line.amount };
  }

  const expensePreview = (row, month) => operatingExpense(numericLine(row), month);

  function staffExpense(line, month) {
    const elapsed = month - line.month;
    const active = elapsed >= 0;
    const base = active ? line.amount * (1 + line.growth / 100) ** Math.floor(elapsed / 12) : 0;
    const headcount = active ? line.headcount : 0;
    const wages = base * headcount;
    const benefits = wages * line.burden / 100;
    return { amount: wages + benefits, headcount, wages, benefits };
  }

  function asset(line, prior, month, existing) {
    const capex = !existing && line.month === month ? line.amount : 0;
    const opening = prior?.assets ?? (existing ? line.amount : 0);
    const available = opening + capex;
    const elapsed = month - (existing ? 1 : line.month);
    const depreciation = elapsed < 0 || elapsed >= line.life ? 0
      : elapsed === line.life - 1 ? available : Math.min(available, line.amount / line.life);
    return { capex, depreciation, assets: available - depreciation };
  }

  function loan(line, prior, month, existing) {
    const opening = prior?.debt ?? (existing ? line.amount : 0);
    const draw = !existing && line.month === month ? line.amount : 0;
    const elapsed = month - (existing ? 0 : line.month);
    const principal = elapsed > 0 ? (elapsed >= line.term ? opening : Math.min(opening, line.amount / line.term)) : 0;
    return { draw, principal, debt: opening + draw - principal, interest: (opening + draw) * line.rate / 1200 };
  }

  const detailFlows = {
    streams: ["revenue", "units", "joining", "leaving", "volume"],
    directCosts: ["cogs", "purchases"],
    staff: ["amount", "wages", "benefits"],
    expenses: ["amount"],
    accounts: ["amount"],
    receivables: ["settled"],
    payables: ["settled"],
    ownedAssets: ["depreciation"],
    investments: ["capex", "depreciation"],
    existingLoans: ["principal", "interest"],
    newLoans: ["draw", "principal", "interest"],
    contributions: ["amount"],
  };
  const flows = ["revenue", "cogs", "gross", "payroll", "overhead", "ebitda", "depreciation", "ebit", "interest",
    "pretax", "tax", "profit", "deltaAR", "deltaStock", "deltaAP", "deltaWC", "purchases", "operating", "investing",
    "financing", "netCash", "capex", "draw", "principal", "equityRaised", "freeCash"];

  function toAnnual(months) {
    return [...new Set(months.map(row => row.year))].map(year => {
      const rows = months.filter(row => row.year === year);
      const last = rows.at(-1);
      const period = rows.length === 12 ? String(year) : `${year} (${rows.length} mo.)`;
      const details = Object.fromEntries(Object.entries(last.details).map(([id, list]) => [id,
        list.map((item, i) => {
          const result = { ...item };
          for (const key of detailFlows[id]) result[key] = rows.reduce((value, row) => value + row.details[id][i][key], 0);
          return result;
        })]));
      const annual = { ...last, details, period, openingCash: rows[0].openingCash };
      for (const key of flows) annual[key] = sum(rows, key);
      return annual;
    });
  }

  function forecast(answers, items, name = "Base", growthAdjustment = 0) {
    const n = id => Number(answers[id] || 0);
    const startMonth = Number(answers.start.slice(5, 7)) - 1;
    const startYear = Number(answers.start.slice(0, 4));
    const taxRate = n("tax") / 100;
    const initialCash = total(items.accounts);
    const initialDebt = total(items.existingLoans);
    const stockAtOpen = items.directCosts.reduce((value, row) => value + numeric(row, "stock"), 0);
    const initialAR = total(items.receivables);
    const initialAP = total(items.payables);
    const openingEquity = initialCash + initialAR + stockAtOpen + total(items.ownedAssets) - initialAP - initialDebt;
    let previous = { cash: initialCash, ar: initialAR, stock: stockAtOpen, ap: initialAP, retained: 0, capital: openingEquity, details: {} };
    const months = [];
    for (let i = 0; i < n("months"); i++) {
      const month = i + 1;
      const year = startYear + Math.floor((startMonth + i) / 12);
      const period = `${year}-${String((startMonth + i) % 12 + 1).padStart(2, "0")}`;
      const current = (group, evaluate) => items[group].map((line, index) => evaluate(line, previous.details[group]?.[index], index));
      const streams = current("streams", (line, prior, index) => {
        const result = sale(line, prior, i, growthAdjustment);
        const ar = tradeBalance(result.revenue, numeric(line, "days"), months, "streams", index, "revenue");
        return { ...result, ar };
      });
      const revenue = sum(streams, "revenue");
      const directCosts = current("directCosts", (line, prior, index) => {
        const result = directCost(line, prior, revenue, i);
        const ap = tradeBalance(result.purchases, numeric(line, "payableDays"), months, "directCosts", index, "purchases");
        return { ...result, ap };
      });
      const cogs = sum(directCosts, "cogs");
      const staff = current("staff", line => staffExpense(line, month));
      const expenses = current("expenses", line => operatingExpense(line, month));
      const payroll = total(staff);
      const overhead = total(expenses);
      const gross = revenue - cogs;
      const ebitda = gross - payroll - overhead;
      const ownedAssets = current("ownedAssets", (line, prior) => asset(line, prior, month, true));
      const investments = current("investments", (line, prior) => asset(line, prior, month, false));
      const fixed = ownedAssets.concat(investments);
      const capex = sum(fixed, "capex");
      const depreciation = sum(fixed, "depreciation");
      const assets = sum(fixed, "assets");
      const ebit = ebitda - depreciation;
      const existingLoans = current("existingLoans", (line, prior) => loan(line, prior, month, true));
      const newLoans = current("newLoans", (line, prior) => loan(line, prior, month, false));
      const debtLines = existingLoans.concat(newLoans);
      const draw = sum(debtLines, "draw");
      const debt = sum(debtLines, "debt");
      const interest = sum(debtLines, "interest");
      const principal = sum(debtLines, "principal");
      const pretax = ebit - interest;
      const tax = Math.max(0, pretax) * taxRate;
      const profit = pretax - tax;

      const receivables = outstanding(items.receivables, month);
      const payables = outstanding(items.payables, month);
      const ar = sum(streams, "ar") + total(receivables);
      const stock = sum(directCosts, "stock");
      const purchases = sum(directCosts, "purchases");
      const ap = sum(directCosts, "ap") + total(payables);
      const wc = ar + stock - ap;
      const deltaAR = ar - previous.ar;
      const deltaStock = stock - previous.stock;
      const deltaAP = ap - previous.ap;
      const deltaWC = deltaAR + deltaStock - deltaAP;
      const operating = profit + depreciation - deltaWC;
      const investing = -capex;
      const accounts = items.accounts.map(line => ({ amount: month === 1 ? line.amount : 0 }));
      const contributions = scheduled(items.contributions, month);
      const equityRaised = total(contributions);
      const financing = equityRaised + draw - principal;
      const netCash = operating + investing + financing;
      const openingCash = previous.cash;
      const cash = openingCash + netCash;
      const retained = previous.retained + profit;
      const capital = previous.capital + equityRaised;
      const equity = capital + retained;
      const cashAsset = Math.max(0, cash);
      const cashShortfall = Math.max(0, -cash);
      const currentAssets = cashAsset + ar + stock;
      const totalAssets = currentAssets + assets;
      const liabilities = ap + debt;
      const totalSources = liabilities + equity + cashShortfall;
      const check = totalAssets - totalSources;
      const freeCash = ebit - Math.max(0, ebit) * taxRate + depreciation - deltaWC - capex;
      const details = { streams, directCosts, staff, expenses, accounts, receivables, payables, ownedAssets, investments, existingLoans, newLoans, contributions };
      const row = { period, year, revenue, cogs, gross, payroll, overhead, ebitda, depreciation, ebit, interest, pretax, tax, profit,
        ar, stock, ap, wc, deltaAR, deltaStock, deltaAP, deltaWC, purchases, assets, cashAsset, cashShortfall, currentAssets, totalAssets, debt, liabilities, totalSources,
        capital, retained, equity, check, operating, investing, financing, netCash, openingCash, cash, capex, draw,
        principal, equityRaised, freeCash, details };
      const itemValues = Object.values(details).flatMap(list => list.flatMap(Object.values));
      checkPrecision([...Object.values(row), ...itemValues], name, period);
      if (Math.abs(check) >= halfCent) throw new ForecastRangeError(name, period);
      months.push(row);
      previous = row;
    }
    const lowCash = months.reduce((low, row) => row.cash < low.cash ? row : low);
    const shortfall = months.find(row => row.cash <= -halfCent);
    const rate = n("discountRate") / 100;
    const pvFlows = months.reduce((value, row, i) => value + row.freeCash / (1 + rate) ** ((i + 1) / 12), 0);
    const pvExit = n("exitValue") / (1 + rate) ** (months.length / 12);
    const annual = toAnnual(months);
    for (const row of annual) {
      checkPrecision([...Object.values(row), ...Object.values(row.details).flatMap(list => list.flatMap(Object.values))], name, row.period);
    }
    const totals = { revenue: sum(months, "revenue"), ebitda: sum(months, "ebitda") };
    checkPrecision(Object.values(totals), name, "forecast totals");
    const valuation = answers.valuation === "yes"
      ? { pvFlows, pvExit, enterprise: pvFlows + pvExit, equity: pvFlows + pvExit + initialCash - initialDebt } : null;
    if (valuation) checkPrecision(Object.values(valuation), name, "the valuation");
    return {
      name, growthAdjustment: growthAdjustment / 100, months, annual, totals, lowCash, shortfall, fundingGap: shortfall ? -lowCash.cash : 0, valuation,
    };
  }

  const margin = key => row => {
    const ratio = row[key] / row.revenue;
    return Number.isFinite(ratio * 100) ? ratio : null;
  };
  const detail = (group, key, prefix, style = "detail", filter = () => true) => ({ group, key, prefix, style, filter });
  const assetLines = (key, prefix) => [detail("ownedAssets", key, prefix), detail("investments", key, prefix)];
  const loanLines = (key, prefix, sign = 1) => [detail("existingLoans", key, prefix), detail("newLoans", key, prefix)].map(line => ({ ...line, sign }));
  const revenueDrivers = [
      detail("streams", "units", "Units sold", "count", row => row.method === "units"),
      detail("streams", "units", "Estimated orders or transactions", "count", row => row.method === "orders"),
      detail("streams", "joining", "New subscribers", "count", row => row.method === "subscription"),
      detail("streams", "leaving", "Subscribers lost", "count", row => row.method === "subscription"),
      detail("streams", "active", "Closing subscribers", "count", row => row.method === "subscription"),
      detail("streams", "price", "Price per unit or subscriber", "detail", row => row.method === "units" || row.method === "subscription"),
      detail("streams", "orderValue", "Average eligible order value", "detail", row => row.method === "orders"),
      detail("streams", "volume", "Transaction or payout volume", "detail", row => row.method === "percentage" || row.method === "orders"),
      detail("streams", "feeRate", "Percentage earned", "rate", row => row.method === "percentage" || row.method === "orders"),
  ];
  const reports = [
    { id: "income", name: "Income statement", lines: [
      detail("streams", "revenue", "Sales"), ["Revenue", "revenue", "total"],
      detail("directCosts", "cogs", "Direct cost"), ["Direct costs", "cogs", "total"], ["Gross profit", "gross", "total"], ["Gross margin", margin("gross"), "rate"],
      detail("staff", "amount", "Payroll"), ["Payroll", "payroll", "total"], detail("expenses", "amount", "Operating expense"), ["Operating expenses", "overhead", "total"],
      ["EBITDA", "ebitda", "footer"], ["EBITDA margin", margin("ebitda"), "rate"],
      ...assetLines("depreciation", "Depreciation"), ["Depreciation", "depreciation", "total"], ["Operating profit", "ebit", "total"],
      ...loanLines("interest", "Interest"), ["Interest expense", "interest", "total"],
      ["Profit before tax", "pretax"], ["Income tax", "tax"], ["Net income", "profit", "footer"], ["Net margin", margin("profit"), "rate"],
    ] },
    { id: "balance", name: "Balance sheet", lines: [
      ["Cash and cash equivalents", "cashAsset"],
      detail("streams", "ar", "Forecast receivable"), detail("receivables", "amount", "Opening receivable"), ["Accounts receivable", "ar", "total"],
      detail("directCosts", "stock", "Stock", "detail", row => Number(row.stock) > 0 || Number(row.inventoryDays) > 0), ["Inventory", "stock", "total"],
      ["Current assets", "currentAssets", "total"], ...assetLines("assets", "Book value"), ["Net fixed assets", "assets", "total"], ["Total assets", "totalAssets", "footer"],
      detail("directCosts", "ap", "Forecast payable", "detail", row => Number(row.payableDays) > 0), detail("payables", "amount", "Opening payable"), ["Accounts payable", "ap", "total"],
      ...loanLines("debt", "Loan balance"), ["Debt outstanding", "debt", "total"], ["Total liabilities", "liabilities", "total"],
      ["Opening equity and contributions", "capital"], ["Forecast retained earnings", "retained"], ["Total equity", "equity", "total"],
      ["Unfunded cash shortfall", "cashShortfall"], ["Total liabilities, equity and unfunded cash shortfall", "totalSources", "footer"], ["Balance sheet difference", row => Math.abs(row.check) < halfCent ? 0 : row.check],
    ] },
    { id: "cashflow", name: "Cash flow", lines: [
      ["Opening cash", "openingCash", "total"], ["Net income", "profit"], ["Depreciation add-back", "depreciation"],
      ["Cash impact of change in receivables", row => -row.deltaAR], ["Cash impact of change in inventory", row => -row.deltaStock],
      ["Cash impact of change in payables", "deltaAP"], ["Working capital cash impact", row => -row.deltaWC, "total"], ["Operating cash flow", "operating", "total"],
      { ...detail("investments", "capex", "Purchase"), sign: -1 }, ["Capital expenditure", row => -row.capex, "total"], ["Investing cash flow", "investing", "total"],
      detail("contributions", "amount", "Equity"), ["Equity raised", "equityRaised", "total"],
      detail("newLoans", "draw", "Loan draw"), ["Loan proceeds", "draw", "total"], ...loanLines("principal", "Principal payment", -1),
      ["Principal repaid", row => -row.principal, "total"], ["Financing cash flow", "financing", "total"],
      ["Net change in cash", "netCash", "total"], ["Ending cash before additional funding", "cash", "footer"],
    ] },
    { id: "schedules", name: "Supporting schedules", lines: [
      ...revenueDrivers,
      detail("streams", "revenue", "Sales"), ["Revenue", "revenue", "total"],
      detail("directCosts", "cogs", "Direct cost"), detail("directCosts", "purchases", "Purchases"), ["Total purchases", "purchases", "total"],
      detail("staff", "headcount", "Closing headcount", "count"), detail("staff", "wages", "Wages"), detail("staff", "benefits", "Employer taxes and benefits"),
      ["Payroll", "payroll", "total"], detail("expenses", "amount", "Operating expense"), ["Operating expenses", "overhead", "total"],
      detail("accounts", "amount", "Opening cash account"), detail("receivables", "settled", "Collection of opening balance"),
      detail("payables", "settled", "Payment of opening balance"), ["Net working capital", "wc", "total"], ["Change in working capital", "deltaWC"],
      detail("investments", "capex", "Asset purchase"), ...assetLines("depreciation", "Depreciation"), ...assetLines("assets", "Remaining book value"),
      ...loanLines("interest", "Interest"), ...loanLines("principal", "Principal payment"), ...loanLines("debt", "Loan balance"),
      detail("contributions", "amount", "Equity"), ["Unlevered free cash flow", "freeCash", "footer"],
    ] },
  ];


  const scheduleReports = [
    { id: "cogs", name: "COGS (Costs)", note: "COGS feeds gross profit in the financial statements. Peebee calculates each cost from its monthly expense or its share of revenue. Purchases and closing inventory reflect inventory targets.", lines: [
      detail("directCosts", "cogs", "Cost of goods sold"), ["Total COGS", "cogs", "footer"],
      detail("directCosts", "purchases", "Inventory and supply purchases"), ["Total purchases", "purchases", "footer"],
      detail("directCosts", "stock", "Closing inventory"), ["Total closing inventory", "stock", "footer"],
    ] },
    { id: "sga", name: "SG&A (Expenses)", note: "Total SG&A adds payroll and operating expenses. EBITDA is gross profit less SG&A.", lines: [
      ["Staff and payroll", "payroll"], detail("expenses", "amount", "Operating expense"),
      ["Total operating expenses", "overhead", "total"], ["Total SG&A", row => row.payroll + row.overhead, "footer"],
      ["SG&A as a share of revenue", row => row.revenue ? (row.payroll + row.overhead) / row.revenue : null, "rate"],
    ] },
    { id: "staff-schedule", name: "SG&A > Staff", note: "Payroll adds wages and employer costs by role. Wages use headcount × monthly pay after annual raises. Annual headcount shows the last forecast month of the year.", lines: [
      detail("staff", "headcount", "Closing headcount", "count"), ["Total closing headcount", row => sum(row.details.staff, "headcount"), "footer"],
      detail("staff", "wages", "Wages"), detail("staff", "benefits", "Payroll taxes and benefits"),
      detail("staff", "amount", "Total cost by role"), ["Total staff and payroll", "payroll", "footer"],
    ] },
    { id: "working-capex", name: "WK + CAPEX", note: "Working capital adds receivables and inventory and subtracts payables. Fixed assets roll forward from opening book value plus purchases less straight-line depreciation.", lines: [
      detail("streams", "ar", "Forecast receivable"), detail("receivables", "amount", "Outstanding opening receivable"),
      ["Closing receivables", "ar", "total"], ["Closing inventory", "stock"], detail("directCosts", "ap", "Supplier payable"),
      detail("payables", "amount", "Outstanding opening payable"), ["Closing payables", "ap", "total"],
      ["Closing net working capital", "wc", "footer"], ["Change in net working capital", "deltaWC"], ["Working capital cash impact", row => -row.deltaWC],
      detail("investments", "capex", "Asset purchase"), ["Total capital expenditure", "capex", "footer"],
      ...assetLines("depreciation", "Depreciation"), ["Total depreciation", "depreciation", "total"],
      ...assetLines("assets", "Closing book value"), ["Net fixed assets", "assets", "total"],
      ...loanLines("interest", "Interest"), ...loanLines("principal", "Principal repaid"), ["Closing debt", "debt", "total"],
    ] },
  ];

  function statementReports() {
    const sections = reports.filter(report => report.id !== "schedules");
    return [["monthly", "FS-Month", "Monthly"], ["annual", "FS-Annual", "Annual"]].map(([id, name, frequency]) => {
      // The workbook floors EBITDA margin at zero and suppresses monthly net margin in loss periods.
      const adjustedSections = sections.map(section => section.id !== "income" ? section : {
        ...section,
        lines: section.lines.map(line => {
          if (line[0] === "EBITDA margin") return [line[0], row => row.revenue ? Math.max(0, row.ebitda / row.revenue) : null, "rate"];
          if (line[0] === "Net margin") return [line[0], row => row.revenue && (frequency === "Annual" || row.profit > 0)
            ? Math.max(0, row.profit / row.revenue) : null, "rate"];
          return line;
        }),
      });
      return { id: `fs-${id}`, name, frequency, sections: adjustedSections,
        note: frequency === "Annual"
          ? "Annual flows sum the months in each calendar year. Closing balances use the final forecast month of that year. Partial years show the month count."
          : "The monthly income statement, balance sheet and cash flow use the same Peebee forecast as the related schedules." };
    });
  }

  function linesFor(report, answers) {
    return report.lines.flatMap(line => Array.isArray(line) ? [line] : (answers[line.group] || []).flatMap((item, index) =>
      line.filter(item) ? [[`${line.prefix} · ${item.name}`, row => (line.sign ?? 1) * row.details[line.group][index][line.key], line.style]] : []));
  }

  function build(rawAnswers) {
    const answers = upgradeDraft(rawAnswers);
    const items = amounts(answers);
    const base = forecast(answers, items);
    return answers.scenarios === "yes" ? [
      forecast(answers, items, "Downside", -Number(answers.downside)), base, forecast(answers, items, "Upside", Number(answers.upside)),
    ] : [base];
  }

  globalThis.FinancialModel = { build, firstMonthSale, expensePreview, reports, revenueDrivers, scheduleReports, statementReports: statementReports(), linesFor, sum, halfCent, ForecastRangeError };
})();
