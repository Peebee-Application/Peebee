(() => {
  function forecast(answers, name = "Base", growthAdjustment = 0) {
    const n = id => Number(answers[id] || 0);
    const startMonth = Number(answers.start.slice(5, 7)) - 1;
    const startYear = Number(answers.start.slice(0, 4));
    const growth = Math.max(-1, (n("growth") + growthAdjustment) / 100);
    const taxRate = n("tax") / 100;
    const method = answers.revenueMethod;
    const openingEquity = n("cash") + n("openingAR") + n("openingInventory") + n("openingAssets") - n("openingAP") - n("openingDebt");
    let previous = {
      cash: n("cash"), ar: n("openingAR"), stock: n("openingInventory"), ap: n("openingAP"),
      assets: n("openingAssets"), oldDebt: n("openingDebt"), newDebt: 0,
      retained: 0, capital: openingEquity, active: n("active"),
    };
    const months = [];
    for (let i = 0; i < n("months"); i++) {
      const month = i + 1;
      const year = startYear + Math.floor((startMonth + i) / 12);
      const period = `${year}-${String((startMonth + i) % 12 + 1).padStart(2, "0")}`;
      const scale = (1 + growth) ** i;
      const units = method === "units" ? n("units") * scale : 0;
      const newSubscribers = method === "subscription" ? n("newSubscribers") * scale : 0;
      const churned = method === "subscription" ? previous.active * n("churn") / 100 : 0;
      const active = previous.active + newSubscribers - churned;
      const revenue = method === "direct" ? n("revenue") * scale : (method === "units" ? units : active) * n("price");
      const cogs = revenue * n("cogsRate") / 100;
      const gross = revenue - cogs;
      const payroll = n("payroll") * (1 + n("payrollGrowth") / 100) ** Math.floor(i / 12);
      const overhead = n("overhead") * (1 + n("overheadGrowth") / 100) ** Math.floor(i / 12);
      const ebitda = gross - payroll - overhead;
      const capex = month === n("capexMonth") ? n("capex") : 0;
      const oldDep = month <= n("openingLife") ? n("openingAssets") / n("openingLife") : 0;
      const newDep = month >= n("capexMonth") && month < n("capexMonth") + n("capexLife") ? n("capex") / n("capexLife") : 0;
      const depreciation = Math.min(previous.assets + capex, oldDep + newDep);
      const assets = Math.max(0, previous.assets + capex - depreciation);
      const ebit = ebitda - depreciation;

      const draw = month === n("loanMonth") ? n("loan") : 0;
      const oldPrincipal = previous.oldDebt > 0
        ? (month >= n("openingTerm") ? previous.oldDebt : Math.min(previous.oldDebt, n("openingDebt") / n("openingTerm"))) : 0;
      const elapsed = month - n("loanMonth");
      const newPrincipal = elapsed > 0 && previous.newDebt > 0
        ? (elapsed >= n("loanTerm") ? previous.newDebt : Math.min(previous.newDebt, n("loan") / n("loanTerm"))) : 0;
      const oldDebt = previous.oldDebt - oldPrincipal;
      const newDebt = previous.newDebt + draw - newPrincipal;
      const debt = oldDebt + newDebt;
      const interest = (previous.oldDebt * n("openingRate") + (previous.newDebt + draw) * n("loanRate")) / 1200;
      const principal = oldPrincipal + newPrincipal;
      const pretax = ebit - interest;
      const tax = Math.max(0, pretax) * taxRate;
      const profit = pretax - tax;

      const ar = revenue * n("arDays") / 30;
      const stock = Math.max(previous.stock - cogs, cogs * n("inventoryDays") / 30);
      const purchases = Math.max(0, cogs + stock - previous.stock);
      const ap = purchases * n("apDays") / 30;
      const wc = ar + stock - ap;
      const deltaWC = wc - (previous.ar + previous.stock - previous.ap);
      const operating = profit + depreciation - deltaWC;
      const investing = -capex;
      const equityRaised = month === n("fundingMonth") ? n("funding") : 0;
      const financing = equityRaised + draw - principal;
      const netCash = operating + investing + financing;
      const openingCash = previous.cash;
      const cash = openingCash + netCash;

      const retained = previous.retained + profit;
      const capital = previous.capital + equityRaised;
      const equity = capital + retained;
      const currentAssets = cash + ar + stock;
      const totalAssets = currentAssets + assets;
      const liabilities = ap + debt;
      const check = totalAssets - liabilities - equity;
      const freeCash = ebit - Math.max(0, ebit) * taxRate + depreciation - deltaWC - capex;
      months.push({ period, year, revenue, units, active, newSubscribers, churned, cogs, gross, payroll, overhead,
        ebitda, depreciation, ebit, interest, pretax, tax, profit, ar, stock, ap, wc, deltaWC, purchases, assets,
        currentAssets, totalAssets, oldDebt, newDebt, debt, liabilities, capital, retained, equity, check,
        operating, investing, financing, netCash, openingCash, cash, capex, draw, principal, equityRaised, freeCash });
      previous = { cash, ar, stock, ap, assets, oldDebt, newDebt, retained, capital, active };
    }

    const flows = ["units", "newSubscribers", "churned", "revenue", "cogs", "gross", "payroll", "overhead", "ebitda",
      "depreciation", "ebit", "interest", "pretax", "tax", "profit", "deltaWC", "purchases", "operating", "investing",
      "financing", "netCash", "capex", "draw", "principal", "equityRaised", "freeCash"];
    const annual = [...new Set(months.map(row => row.year))].map(year => {
      const rows = months.filter(row => row.year === year);
      const period = rows.length === 12 ? String(year) : `${year} (${rows.length} mo.)`;
      const result = { ...rows.at(-1), period, openingCash: rows[0].openingCash };
      for (const key of flows) result[key] = sum(rows, key);
      return result;
    });
    const lowCash = months.reduce((low, row) => row.cash < low.cash ? row : low);
    const shortfall = months.find(row => row.cash < -0.005);
    const rate = n("discountRate") / 100;
    const pvFlows = months.reduce((total, row, i) => total + row.freeCash / (1 + rate) ** ((i + 1) / 12), 0);
    const pvExit = n("exitValue") / (1 + rate) ** (months.length / 12);
    return {
      name, growth, months, annual, lowCash, shortfall, fundingGap: Math.max(0, -lowCash.cash),
      valuation: answers.valuation === "yes" ? { pvFlows, pvExit, enterprise: pvFlows + pvExit, equity: pvFlows + pvExit + n("cash") - n("openingDebt") } : null,
    };
  }

  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const margin = key => row => row.revenue ? row[key] / row.revenue : null;
  const reports = [
    { id: "income", name: "Income statement", lines: [
      ["Revenue", "revenue", "total"], ["Direct costs", "cogs"], ["Gross profit", "gross", "total"], ["Gross margin", margin("gross"), "rate"],
      ["Payroll", "payroll"], ["Operating expenses", "overhead"], ["EBITDA", "ebitda", "total"], ["EBITDA margin", margin("ebitda"), "rate"],
      ["Depreciation", "depreciation"], ["Operating profit", "ebit", "total"], ["Interest expense", "interest"],
      ["Profit before tax", "pretax"], ["Income tax", "tax"], ["Net income", "profit", "total"], ["Net margin", margin("profit"), "rate"],
    ] },
    { id: "balance", name: "Balance sheet", lines: [
      ["Cash before additional financing", "cash"], ["Accounts receivable", "ar"], ["Inventory", "stock"], ["Current assets", "currentAssets", "total"],
      ["Net fixed assets", "assets"], ["Total assets", "totalAssets", "total"], ["Accounts payable", "ap"], ["Debt outstanding", "debt"],
      ["Total liabilities", "liabilities", "total"], ["Opening equity and contributions", "capital"], ["Forecast retained earnings", "retained"],
      ["Total equity", "equity", "total"], ["Total liabilities and equity", row => row.liabilities + row.equity, "total"],
      ["Balance sheet difference", "check"],
    ] },
    { id: "cashflow", name: "Cash flow", lines: [
      ["Opening cash", "openingCash", "total"], ["Net income", "profit"], ["Depreciation add-back", "depreciation"],
      ["Working capital cash impact", row => -row.deltaWC], ["Operating cash flow", "operating", "total"],
      ["Capital expenditure", row => -row.capex], ["Investing cash flow", "investing", "total"],
      ["Equity raised", "equityRaised"], ["Loan proceeds", "draw"], ["Principal repaid", row => -row.principal],
      ["Financing cash flow", "financing", "total"], ["Net change in cash", "netCash", "total"], ["Ending cash", "cash", "total"],
    ] },
    { id: "schedules", name: "Supporting schedules", lines: [
      ["Units sold", "units", "count", "units"], ["New subscribers", "newSubscribers", "count", "subscription"],
      ["Subscribers lost", "churned", "count", "subscription"], ["Closing subscribers", "active", "count", "subscription"],
      ["Revenue", "revenue", "total"], ["Direct costs", "cogs"], ["Payroll", "payroll"], ["Operating expenses", "overhead"],
      ["Accounts receivable", "ar"], ["Inventory", "stock"], ["Purchases", "purchases"], ["Accounts payable", "ap"],
      ["Net working capital", "wc", "total"], ["Change in working capital", "deltaWC"],
      ["Capital expenditure", "capex"], ["Depreciation", "depreciation"], ["Closing net fixed assets", "assets", "total"],
      ["Opening loan balance remaining", "oldDebt"], ["New borrowing balance remaining", "newDebt"], ["Closing debt", "debt", "total"],
      ["Interest expense", "interest"], ["Principal repaid", "principal"], ["Unlevered free cash flow", "freeCash", "total"],
    ] },
  ];

  function build(answers) {
    const base = forecast(answers);
    return answers.scenarios === "yes" ? [
      forecast(answers, "Downside", -Number(answers.downside)), base, forecast(answers, "Upside", Number(answers.upside)),
    ] : [base];
  }

  globalThis.FinancialModel = { build, reports, sum };
})();
