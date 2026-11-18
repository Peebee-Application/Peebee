(() => {
  const { upgradeDraft, byId, expenseGroups, acquisition, staffDepartments, assetCategories, directCostCategories } = globalThis.FinancialLineItems;
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
    [key, ["name", "method", "basis", "priceCurrency", "cadence", "roleType", "department", "salaryBasis", "category", "assetClass", "replacement", "repayment", "inventoryCode", "inventoryDemand", "openingUnitCost", "movement", "budgetScaling", "orderForecast", "revenueStreamIndexes"].includes(key) ? value : Number(value || 0)]));
  const assetLife = (answers, assetClass) => Number(answers["assetLife_" + (assetClass || "other")] ||
    assetCategories.find(([id]) => id === assetClass)?.[2] || assetCategories.at(-1)[2]);
  const definedValue = (override, fallback) => override == null || override === "" ? fallback : override;

  function resolvedLine(id, row, answers) {
    const line = numericLine(row);
    if (id === "streams") {
      if (row.marketingCap === "") delete line.marketingCap;
      line.marketingVATRate = Number(definedValue(row.marketingVATRate, answers.vatSgaDefault || 0));
    }
    if (id === "ownedAssets" || id === "investments") {
      const life = assetLife(answers, row.assetClass);
      if (id === "investments") line.life = Number(definedValue(row.life, life));
      line.replacementLife = Number(definedValue(row.replacementLife, life));
      line.assetInflation = Number(definedValue(row.assetInflation, answers.assetInflationDefault || 0));
    }
    if (id === "existingLoans" || id === "newLoans") {
      line.rate = Number(definedValue(row.rate, answers.loanRateDefault || 0));
      line.term = Number(definedValue(row.term, answers.loanTermDefault || 24));
    }
    if (id === "expenses" || id === "directCosts") {
      line.vatRate = Number(definedValue(row.vatRate, (id === "expenses" ? answers.vatSgaDefault : answers.vatCogsDefault) || 0));
    }
    if (id === "directCosts" && row.basis === "inventory") {
      line.unitCost = Number(definedValue(row.unitCost, answers.inventoryCostDefault || 0));
      line.minOrder = Number(definedValue(row.minOrder, answers.inventoryMinDefault || 1));
      line.leadMonths = Number(definedValue(row.leadMonths, answers.inventoryLeadDefault || 0));
    }
    return line;
  }

  const amounts = answers => Object.fromEntries(Object.keys(byId).map(id => [
    id, (answers[id] || []).map(row => resolvedLine(id, row, answers)),
  ]));
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
    const modelMonth = elapsed + 1;
    const launch = line.launchMonth || 1;
    const launched = modelMonth >= launch;
    const useAcquisition = acquisition(line);
    if (!launched && !useAcquisition) return { revenue: 0, units: 0, joining: 0, leaving: 0, active: 0, price: line.price,
      volume: 0, feeRate: 0, orderValue: numeric(line, "orderValue"), marketingSpend: 0, paidSignups: 0,
      organicVisits: 0, organicSignups: 0, customerStarts: 0, customerLosses: 0, customers: 0 };
    if (modelMonth === launch && !useAcquisition) prior = null;
    elapsed = Math.max(0, modelMonth - launch);
    const { method, price } = line;
    const rate = Math.max(-1, (numeric(line, "growth") + adjustment) / 100);
    const scale = launched ? (1 + rate) ** elapsed : 0;
    const campaignElapsed = modelMonth - (line.campaignMonth || launch);
    const uncappedBudget = !useAcquisition || campaignElapsed < 0 ? 0 : line.budgetScaling === "amount"
      ? line.marketingBudget + campaignElapsed * line.marketingStep
      : line.marketingBudget * (1 + line.marketingGrowth / 100) ** campaignElapsed;
    const marketingSpend = Math.min(line.marketingCap ?? Infinity, uncappedBudget);
    const paidSignups = useAcquisition ? marketingSpend / line.signupCost : 0;
    const organicVisits = useAcquisition ? line.organicTraffic * scale : 0;
    const organicSignups = useAcquisition ? organicVisits * line.organicConversion / 100 : 0;
    const customerStarts = useAcquisition ? (organicSignups + paidSignups) * line.customerActivation / 100 : 0;
    const openingCustomers = useAcquisition ? prior?.customers ?? line.openingCustomers : 0;
    const customerLosses = useAcquisition && (launched || campaignElapsed >= 0) ? openingCustomers * line.customerChurn / 100 : 0;
    const customers = openingCustomers - customerLosses + customerStarts;
    const units = method === "units" ? line.units * scale
      : method !== "orders" || !launched ? 0 : useAcquisition ? customers * line.ordersPerCustomer : line.orders * scale;
    const joining = method === "subscription" ? line.newSubscribers * scale : 0;
    const opening = prior?.active ?? numeric(line, "active");
    const churn = method === "subscription" ? line.churn / 100 : 0;
    const leaving = opening * churn;
    const active = opening * (1 - churn) + joining;
    const volume = method === "orders" ? units * line.orderValue : method === "percentage" ? line.transactionValue * scale : 0;
    const feeRate = (method === "percentage" || method === "orders") ? line.rate / 100 : 0;
    const revenue = (method === "percentage" || method === "orders") ? volume * feeRate
      : method === "direct" ? line.amount * scale : (method === "units" ? units : active) * price;
    return { revenue, units, joining, leaving, active, price, volume, feeRate, orderValue: numeric(line, "orderValue"),
      marketingSpend, paidSignups, organicVisits, organicSignups, customerStarts, customerLosses, customers };
  }

  function firstMonthSale(row) {
    const line = resolvedLine("streams", row, {});
    const launch = line.launchMonth || 1;
    const first = acquisition(line) ? Math.min(line.campaignMonth || launch, launch) : launch;
    let result;
    for (let month = first; month <= launch; month++) result = sale(line, result, month - 1, 0);
    return result;
  }

  function directCost(line, prior, revenue, elapsed) {
    const cogs = line.basis === "fixed" ? line.amount * (1 + line.growth / 100) ** Math.floor(elapsed / 12) : revenue * line.rate / 100;
    const opening = prior?.stock ?? numeric(line, "stock");
    const stock = stockAfter(opening, cogs, numeric(line, "inventoryDays"));
    const purchases = Math.max(0, cogs + stock - opening);
    return { cogs, stock, purchases, orderUnits: 0, receivedUnits: 0, lossUnits: 0, soldUnits: 0, closingUnits: 0,
      pendingUnits: 0, pendingValue: 0, openingOrders: 0, opening: 0, openingUnits: 0, soldCost: 0, lossCost: 0, averageCost: 0 };
  }

  const openingInventory = line => line.openingUnits * (line.openingUnitCost == null || line.openingUnitCost === "" ? line.unitCost : Number(line.openingUnitCost));

  function inventorySchedule(line, movements, horizon, salesUnits) {
    const extraOrders = Array(horizon + line.leadMonths).fill(0);
    const losses = Array(horizon).fill(0);
    for (const entry of movements) {
      if (entry.inventoryCode.toLowerCase() !== line.inventoryCode.toLowerCase() || entry.month > horizon) continue;
      if (entry.movement === "order") extraOrders[entry.month - 1 + line.leadMonths] += entry.units;
      if (entry.movement === "loss") losses[entry.month - 1] += entry.units;
    }
    let closingUnits = line.openingUnits;
    let stock = openingInventory(line);
    const schedule = Array.from({ length: horizon }, (_, i) => {
      const opening = stock;
      const openingUnits = closingUnits;
      const soldUnits = Math.round(salesUnits?.[i] ?? line.monthlyUnits * (1 + line.unitGrowth / 100) ** i);
      const lossUnits = losses[i];
      const shortage = soldUnits + lossUnits - closingUnits - extraOrders[i];
      const receivedUnits = extraOrders[i] + (shortage > 0 ? Math.max(shortage, line.minOrder) : 0);
      const purchases = receivedUnits * line.unitCost;
      const available = closingUnits + receivedUnits;
      const averageCost = available ? (stock + purchases) / available : line.unitCost;
      const soldCost = soldUnits * averageCost;
      const lossCost = lossUnits * averageCost;
      const cogs = soldCost + lossCost;
      closingUnits = available - soldUnits - lossUnits;
      stock = closingUnits * averageCost;
      return { opening, openingUnits, cogs, soldCost, lossCost, stock, purchases, receivedUnits, soldUnits, lossUnits, closingUnits, averageCost };
    });
    return schedule.map((row, i) => {
      const receipts = arrival => schedule[arrival]?.receivedUnits ?? extraOrders[arrival] ?? 0;
      const orderUnits = receipts(i + line.leadMonths);
      const pendingUnits = Array.from({ length: line.leadMonths }, (_, offset) => receipts(i + 1 + offset))
        .reduce((sum, units) => sum + units, 0);
      const openingOrders = i === 0 ? schedule.slice(0, line.leadMonths).reduce((sum, entry) => sum + entry.receivedUnits, 0) : 0;
      return { ...row, orderUnits, pendingUnits, pendingValue: pendingUnits * line.unitCost, openingOrders };
    });
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
    const active = elapsed >= 0 && (!line.endMonth || month <= line.endMonth) && line.roleType !== "disabled";
    if (!active) return { amount: 0, headcount: 0, wages: 0, benefits: 0 };
    const pay = line.salaryBasis === "annual" ? line.annualSalary / 12 : line.amount;
    const base = pay * (1 + line.growth / 100) ** Math.floor(elapsed / 12);
    const headcount = line.roleType === "scaling"
      ? Math.min(line.maxTeamSize, line.hiresPerPeriod * (1 + Math.floor(elapsed / line.hiringInterval)))
      : line.roleType === "single" ? 1 : line.headcount;
    const wages = headcount * base;
    const benefits = wages * line.burden / 100;
    return { amount: wages + benefits, headcount, wages, benefits };
  }

  const staffPreview = (row, month) => staffExpense(numericLine(row), month);

  function asset(line, prior, month, existing) {
    const initialMonth = existing ? 1 : line.month;
    const firstReplacement = initialMonth + line.life;
    const replacing = line.replacement === "cycle" && month >= firstReplacement;
    const life = replacing && existing ? line.replacementLife : line.life;
    const elapsed = replacing ? (month - firstReplacement) % life : month - initialMonth;
    const purchase = !existing && month === initialMonth ? line.amount : 0;
    const replacement = replacing && elapsed === 0
      ? (existing ? line.replacementCost : line.amount) * (1 + line.assetInflation / 100) ** ((month - initialMonth) / 12)
      : 0;
    const capex = purchase + replacement;
    const opening = prior?.assets ?? (existing ? line.amount : 0);
    const available = opening + capex;
    const cohortCost = replacing && elapsed === 0 ? replacement : prior?.cohortCost ?? line.amount;
    const depreciation = elapsed < 0 || elapsed >= life ? 0
      : elapsed === life - 1 ? available : Math.min(available, cohortCost / life);
    return { opening, purchase, replacement, capex, depreciation, assets: available - depreciation, cohortCost,
      assetClass: line.assetClass || "other" };
  }

  function assetPreview(row, horizon, existing, answers = {}) {
    const line = resolvedLine(existing ? "ownedAssets" : "investments", row, answers);
    let prior;
    return Array.from({ length: horizon }, (_, i) => {
      prior = asset(line, prior, i + 1, existing);
      return { month: i + 1, ...prior };
    });
  }

  function loan(line, prior, month, existing) {
    const opening = prior?.debt ?? (existing ? line.amount : 0);
    const draw = !existing && line.month === month ? line.amount : 0;
    const elapsed = month - (existing ? 0 : line.month);
    const rate = line.rate / 1200;
    const fixedPayment = line.repayment === "payment";
    const interest = (opening + (fixedPayment ? 0 : draw)) * rate;
    const installment = fixedPayment && rate > 0
      ? line.amount * rate / -Math.expm1(-line.term * Math.log1p(rate)) - interest
      : line.amount / line.term;
    const principal = elapsed > 0 ? (elapsed >= line.term ? opening : Math.min(opening, Math.max(0, installment))) : 0;
    return { opening, draw, principal, debt: opening + draw - principal, interest };
  }

  const detailFlows = {
    streams: ["revenue", "units", "joining", "leaving", "volume", "marketingSpend", "paidSignups", "organicVisits", "organicSignups", "customerStarts", "customerLosses"],
    directCosts: ["cogs", "purchases", "vat", "orderUnits", "receivedUnits", "lossUnits", "soldUnits", "openingOrders", "soldCost", "lossCost"],
    staff: ["amount", "wages", "benefits"],
    expenses: ["amount", "vat"],
    accounts: ["amount"],
    receivables: ["settled"],
    payables: ["settled"],
    ownedAssets: ["purchase", "replacement", "capex", "depreciation"],
    investments: ["purchase", "replacement", "capex", "depreciation"],
    existingLoans: ["principal", "interest"],
    newLoans: ["draw", "principal", "interest"],
    contributions: ["amount"],
  };
  const flows = ["vatSales", "vatPurchases", "vatExpenses", "vatMarketing", "vatPayment", "deltaVAT", "paidMarketing", "headcountAdded", "equipmentExpense", "equipmentPurchase", "equipmentReplacement", "equipmentCapex", "equipmentDepreciation", "revenue", "cogs", "gross", "payroll", "overhead", "ebitda", "depreciation", "ebit", "interest",
    "pretax", "tax", "incomeTaxPayment", "profit", "deltaAR", "deltaStock", "deltaAP", "deltaWC", "purchases", "operating", "investing",
    "financing", "netCash", "capex", "draw", "principal", "equityRaised", "freeCash"];

  function toAnnual(months) {
    return [...new Set(months.map(row => row.year))].map(year => {
      const rows = months.filter(row => row.year === year);
      const last = rows.at(-1);
      const period = rows.length === 12 ? String(year) : `${year} (${rows.length} mo.)`;
      const details = Object.fromEntries(Object.entries(last.details).map(([id, list]) => [id,
        list.map((item, i) => {
          const result = { ...item };
          if ("opening" in result) result.opening = rows[0].details[id][i].opening;
          if ("openingUnits" in result) result.openingUnits = rows[0].details[id][i].openingUnits;
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
    const vatCadence = { monthly: 1, quarterly: 3, annual: 12 }[answers.vatCadence] || 0;
    const vatOn = (amount, line) => vatCadence ? amount * numeric(line, "vatRate") / 100 : 0;
    const initialCash = total(items.accounts);
    const initialDebt = total(items.existingLoans);
    const stockAtOpen = items.directCosts.reduce((value, row) =>
      value + (row.basis === "inventory" ? openingInventory(row) : numeric(row, "stock")), 0);
    const inventory = items.directCosts.map(row => {
      if (row.basis !== "inventory") return null;
      const streams = row.revenueStreamIndexes ? row.revenueStreamIndexes.map(index => items.streams[index]) : items.streams;
      const unitStreams = streams.filter(stream => stream.method === "units");
      const salesUnits = row.inventoryDemand === "sales" ? Array.from({ length: n("months") }, (_, elapsed) =>
        unitStreams.reduce((units, stream) => units + sale(stream, null, elapsed, growthAdjustment).units, 0)) : null;
      return inventorySchedule(row, items.inventoryMovements, n("months"), salesUnits);
    });
    const initialAR = total(items.receivables);
    const initialAP = total(items.payables);
    const openingVATBalance = vatCadence ? n("openingVAT") : 0;
    const openingIncomeTax = n("openingIncomeTax");
    const openingEquity = initialCash + initialAR + stockAtOpen + total(items.ownedAssets) - initialAP - initialDebt - openingVATBalance - openingIncomeTax;
    const openingCapital = Number(definedValue(answers.openingCapital, openingEquity));
    const fiscalTax = answers.incomeTaxTiming === "fiscal";
    const fiscalStart = n("fiscalStart") || 1;
    let fiscalProfit = 0;
    let fiscalAccrued = 0;
    let fiscalPaid = 0;
    let incomeTaxCarry = 0;
    let previous = { cash: initialCash, ar: initialAR, stock: stockAtOpen, ap: initialAP, vatBalance: openingVATBalance,
      retained: openingEquity - openingCapital, capital: openingCapital, incomeTaxBalance: openingIncomeTax, details: {} };
    const months = [];
    for (let i = 0; i < n("months"); i++) {
      const month = i + 1;
      const year = startYear + Math.floor((startMonth + i) / 12);
      const calendarMonth = (startMonth + i) % 12 + 1;
      const period = `${year}-${String(calendarMonth).padStart(2, "0")}`;
      const current = (group, evaluate) => items[group].map((line, index) => evaluate(line, previous.details[group]?.[index], index));
      const streams = current("streams", (line, prior, index) => {
        const result = sale(line, prior, i, growthAdjustment);
        const vat = vatOn(result.revenue, line);
        const grossSales = result.revenue + vat;
        const ar = tradeBalance(grossSales, numeric(line, "days"), months, "streams", index, "grossSales");
        return { ...result, vat, grossSales, ar };
      });
      const revenue = sum(streams, "revenue");
      const directCosts = current("directCosts", (line, prior, index) => {
        const eligibleRevenue = line.revenueStreamIndexes
          ? line.revenueStreamIndexes.reduce((amount, stream) => amount + streams[stream].revenue, 0)
          : revenue;
        const result = inventory[index]?.[i] ?? directCost(line, prior, eligibleRevenue, i);
        const vat = vatOn(result.purchases, line);
        const grossPurchases = result.purchases + vat;
        const ap = tradeBalance(grossPurchases, numeric(line, "payableDays"), months, "directCosts", index, "grossPurchases");
        return { ...result, vat, grossPurchases, ap,
          category: line.category || (line.name === "Payment provider fees borne by Peebee" ? "processing" : "other") };
      });
      const cogs = sum(directCosts, "cogs");
      const staff = current("staff", line => ({ ...staffExpense(line, month), department: line.department }));
      const expenses = current("expenses", line => {
        const result = operatingExpense(line, month);
        return { ...result, category: line.category, vat: vatOn(result.amount, line) };
      });
      const vatSales = sum(streams, "vat");
      const vatPurchases = sum(directCosts, "vat");
      const vatMarketing = items.streams.reduce((value, line, index) => value +
        (vatCadence ? streams[index].marketingSpend * numeric(line, "marketingVATRate") / 100 : 0), 0);
      const vatExpenses = sum(expenses, "vat") + vatMarketing;
      const openingVAT = previous.vatBalance || 0;
      const vatPayment = vatCadence && (calendarMonth - 1 - n("vatYearEnd")) % vatCadence === 0 ? Math.max(0, openingVAT) : 0;
      const vatBalance = openingVAT + vatSales - vatPurchases - vatExpenses - vatPayment;
      const vatReceivable = Math.max(0, -vatBalance);
      const vatPayable = Math.max(0, vatBalance);
      const deltaVAT = openingVAT - vatBalance;
      const payroll = total(staff);
      const headcount = sum(staff, "headcount");
      const headcountAdded = Math.max(0, headcount - (previous.headcount || 0));
      const equipmentSpend = headcountAdded * n("hireEquipmentCost");
      const equipmentExpense = answers.hireEquipment === "expense" ? equipmentSpend : 0;
      const equipmentPurchase = answers.hireEquipment === "capital" ? equipmentSpend : 0;
      const paidMarketing = sum(streams, "marketingSpend");
      const overhead = total(expenses) + paidMarketing + equipmentExpense;
      const gross = revenue - cogs;
      const ebitda = gross - payroll - overhead;
      const ownedAssets = current("ownedAssets", (line, prior) => asset(line, prior, month, true));
      const investments = current("investments", (line, prior) => asset(line, prior, month, false));
      const fixed = ownedAssets.concat(investments);
      const equipmentLife = n("hireEquipmentLife");
      const equipmentReplacement = answers.hireEquipment === "capital" && answers.hireEquipmentReplacement === "cycle" && equipmentLife > 0
        ? (months[i - equipmentLife]?.equipmentCapex || 0) * (1 + n("hireEquipmentInflation") / 100) ** (equipmentLife / 12)
        : 0;
      const equipmentCapex = equipmentPurchase + equipmentReplacement;
      const equipmentDepreciation = answers.hireEquipment === "capital" && equipmentLife > 0
        ? (equipmentCapex + months.slice(Math.max(0, i - equipmentLife + 1)).reduce((value, row) => value + row.equipmentCapex, 0)) / equipmentLife
        : 0;
      const equipmentAssets = Math.max(0, (previous.equipmentAssets || 0) + equipmentCapex - equipmentDepreciation);
      const capex = sum(fixed, "capex") + equipmentCapex;
      const depreciation = sum(fixed, "depreciation") + equipmentDepreciation;
      const assets = sum(fixed, "assets") + equipmentAssets;
      const ebit = ebitda - depreciation;
      const existingLoans = current("existingLoans", (line, prior) => loan(line, prior, month, true));
      const newLoans = current("newLoans", (line, prior) => loan(line, prior, month, false));
      const debtLines = existingLoans.concat(newLoans);
      const draw = sum(debtLines, "draw");
      const debt = sum(debtLines, "debt");
      const interest = sum(debtLines, "interest");
      const principal = sum(debtLines, "principal");
      const pretax = ebit - interest;
      const fiscalMonth = (calendarMonth - fiscalStart + 12) % 12;
      if (fiscalTax && fiscalMonth === 0) {
        incomeTaxCarry += fiscalAccrued - fiscalPaid;
        fiscalProfit = fiscalAccrued = fiscalPaid = 0;
      }
      fiscalProfit += pretax;
      const fiscalEstimate = Math.max(0, fiscalProfit) * taxRate;
      const tax = fiscalTax ? fiscalEstimate - fiscalAccrued : Math.max(0, pretax) * taxRate;
      fiscalAccrued = fiscalEstimate;
      let regularTaxPayment = fiscalTax ? 0 : tax;
      if (fiscalTax && calendarMonth === n("taxSettlementMonth")) {
        regularTaxPayment = Math.max(0, incomeTaxCarry);
        incomeTaxCarry -= regularTaxPayment;
      }
      if (fiscalTax && answers.taxInstallments === "quarterly" && [2, 5, 8].includes(fiscalMonth)) {
        const installment = Math.max(0, fiscalEstimate - fiscalPaid);
        regularTaxPayment += installment;
        fiscalPaid += installment;
      }
      const priorTaxPayment = month === (n("openingIncomeTaxMonth") || 1) ? openingIncomeTax : 0;
      const incomeTaxPayment = regularTaxPayment + priorTaxPayment;
      const incomeTaxBalance = previous.incomeTaxBalance + tax - incomeTaxPayment;
      const incomeTaxPayable = Math.max(0, incomeTaxBalance);
      const incomeTaxReceivable = Math.max(0, -incomeTaxBalance);
      const profit = pretax - tax;

      const receivables = outstanding(items.receivables, month);
      const payables = outstanding(items.payables, month);
      const ar = sum(streams, "ar") + total(receivables);
      const stock = sum(directCosts, "stock");
      const purchases = sum(directCosts, "purchases");
      const ap = sum(directCosts, "ap") + total(payables);
      const wc = ar + stock - ap - vatBalance;
      const deltaAR = ar - previous.ar;
      const deltaStock = stock - previous.stock;
      const deltaAP = ap - previous.ap;
      const deltaWC = deltaAR + deltaStock - deltaAP + deltaVAT;
      const operating = profit + depreciation - deltaWC + tax - incomeTaxPayment;
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
      const currentAssets = cashAsset + ar + stock + vatReceivable + incomeTaxReceivable;
      const totalAssets = currentAssets + assets;
      const liabilities = ap + debt + vatPayable + incomeTaxPayable;
      const totalSources = liabilities + equity + cashShortfall;
      const check = totalAssets - totalSources;
      const freeCash = ebit - Math.max(0, ebit) * taxRate + depreciation - deltaWC - capex;
      const details = { streams, directCosts, staff, expenses, accounts, receivables, payables, ownedAssets, investments, existingLoans, newLoans, contributions };
      const row = { period, year, headcount, headcountAdded, equipmentExpense, equipmentPurchase, equipmentReplacement, equipmentCapex, equipmentDepreciation, equipmentAssets,
        paidMarketing, vatSales, vatPurchases, vatExpenses, vatMarketing, vatBalance, vatPayment, vatReceivable, vatPayable, deltaVAT, revenue, cogs, gross, payroll, overhead, ebitda, depreciation, ebit, interest, pretax, tax, incomeTaxPayment, incomeTaxBalance, incomeTaxPayable, incomeTaxReceivable, profit,
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
      detail("streams", "organicVisits", "Organic visits", "count", acquisition),
      detail("streams", "organicSignups", "Organic signups", "count", acquisition),
      detail("streams", "paidSignups", "Paid signups", "count", acquisition),
      detail("streams", "customerStarts", "New active customers", "count", acquisition),
      detail("streams", "customerLosses", "Customers lost", "count", acquisition),
      detail("streams", "customers", "Closing active customers", "count", acquisition),
      detail("streams", "marketingSpend", "Paid acquisition budget", "detail", acquisition),
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
      detail("staff", "amount", "Payroll"), ["Payroll", "payroll", "total"], detail("expenses", "amount", "Operating expense"), ["Equipment expensed for hires", "equipmentExpense"], ["Paid customer acquisition", "paidMarketing"], ["Operating expenses", "overhead", "total"],
      ["EBITDA", "ebitda", "footer"], ["EBITDA margin", margin("ebitda"), "rate"],
      ...assetLines("depreciation", "Depreciation"), ["Depreciation · Hiring equipment", "equipmentDepreciation"], ["Depreciation", "depreciation", "total"], ["Operating profit", "ebit", "total"],
      ...loanLines("interest", "Interest"), ["Interest expense", "interest", "total"],
      ["Profit before tax", "pretax"], ["Income tax", "tax"], ["Net income", "profit", "footer"], ["Net margin", margin("profit"), "rate"],
    ] },
    { id: "balance", name: "Balance sheet", lines: [
      ["Cash and cash equivalents", "cashAsset"],
      detail("streams", "ar", "Forecast receivable"), detail("receivables", "amount", "Opening receivable"), ["Accounts receivable", "ar", "total"],
      detail("directCosts", "stock", "Stock", "detail", row => row.basis === "inventory" || Number(row.stock) > 0 || Number(row.inventoryDays) > 0), ["Inventory", "stock", "total"], ["VAT receivable", "vatReceivable"], ["Income tax receivable", "incomeTaxReceivable"],
      ["Current assets", "currentAssets", "total"], ...assetLines("assets", "Book value"), ["Book value · Hiring equipment", "equipmentAssets"], ["Net fixed assets", "assets", "total"], ["Total assets", "totalAssets", "footer"],
      detail("directCosts", "ap", "Forecast payable", "detail", row => Number(row.payableDays) > 0), detail("payables", "amount", "Opening payable"), ["Accounts payable", "ap", "total"],
      ...loanLines("debt", "Loan balance"), ["Debt outstanding", "debt", "total"], ["VAT payable", "vatPayable"], ["Income tax payable", "incomeTaxPayable"], ["Total liabilities", "liabilities", "total"],
      ["Invested capital and contributions", "capital"], ["Retained earnings", "retained"], ["Total equity", "equity", "total"],
      ["Unfunded cash shortfall", "cashShortfall"], ["Total liabilities, equity and unfunded cash shortfall", "totalSources", "footer"], ["Balance sheet difference", row => Math.abs(row.check) < halfCent ? 0 : row.check],
    ] },
    { id: "cashflow", name: "Cash flow", lines: [
      ["Opening cash", "openingCash", "total"], ["Net income", "profit"], ["Depreciation add-back", "depreciation"],
      ["Cash impact of change in receivables", row => -row.deltaAR], ["Cash impact of change in inventory", row => -row.deltaStock],
      ["Cash impact of change in payables", "deltaAP"], ["Cash impact of change in VAT", row => -row.deltaVAT], ["Working capital cash impact", row => -row.deltaWC, "total"], ["Income tax accrual less payments", row => row.tax - row.incomeTaxPayment], ["Operating cash flow", "operating", "total"],
      ...assetLines("capex", "Purchase or replacement").map(line => ({ ...line, sign: -1 })), ["Hiring equipment purchases", row => -row.equipmentCapex], ["Capital expenditure", row => -row.capex, "total"], ["Investing cash flow", "investing", "total"],
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
      ["Payroll", "payroll", "total"], detail("expenses", "amount", "Operating expense"), ["Equipment expensed for hires", "equipmentExpense"], ["Paid customer acquisition", "paidMarketing"], ["Operating expenses", "overhead", "total"],
      detail("accounts", "amount", "Opening cash account"), detail("receivables", "settled", "Collection of opening balance"),
      detail("payables", "settled", "Payment of opening balance"), ["Net working capital", "wc", "total"], ["Change in working capital", "deltaWC"],
      ...assetLines("capex", "Asset purchase or replacement"), ...assetLines("depreciation", "Depreciation"), ...assetLines("assets", "Remaining book value"),
      ...loanLines("interest", "Interest"), ...loanLines("principal", "Principal payment"), ...loanLines("debt", "Loan balance"),
      detail("contributions", "amount", "Equity"), ["Unlevered free cash flow", "freeCash", "footer"],
    ] },
  ];


  const scheduleReports = [
    { id: "cogs", name: "COGS (Costs)", note: "COGS feeds gross profit in the financial statements. Peebee calculates each cost from its monthly expense or its share of revenue. Purchases and closing inventory reflect inventory targets.", lines: [
      detail("directCosts", "cogs", "Cost of goods sold"),
      ...directCostCategories.map(([id, label]) => [label, row =>
        sum(row.details.directCosts.filter(cost => cost.category === id), "cogs"), "total"]),
      ["Total COGS", "cogs", "footer"],
      detail("directCosts", "purchases", "Inventory and supply purchases"), ["Total purchases", "purchases", "footer"],
      detail("directCosts", "stock", "Closing inventory"), ["Recoverable VAT on purchases", "vatPurchases"], ["Total closing inventory", "stock", "footer"],
    ] },
    { id: "sga", name: "SG&A", note: "Total SG&A adds payroll and operating expenses. EBITDA is gross profit less SG&A.", lines: [
      ["Staff and payroll", "payroll"],
      ...expenseGroups.flatMap(([id, label]) => [
        detail("expenses", "amount", label, "detail", row => (row.category || "other") === id),
        ...(id === "marketing" ? [detail("streams", "marketingSpend", "Paid acquisition", "detail", acquisition)] : []),
        ...(id === "other" ? [["Equipment expensed for hires", "equipmentExpense"]] : []),
        [label, row => row.details.expenses.reduce((total, expense) => total + (expense.category === id ? expense.amount : 0),
          id === "other" ? row.equipmentExpense : id === "marketing" ? row.paidMarketing : 0), "total"],
        ["Recoverable VAT · " + label, row => sum(row.details.expenses.filter(expense => expense.category === id), "vat")
          + (id === "marketing" ? row.vatMarketing : 0)],
      ]),
      ["Total operating expenses", "overhead", "total"], ["Recoverable VAT paid on operating expenses", "vatExpenses"], ["Total SG&A", row => row.payroll + row.overhead, "footer"],
      ["SG&A as a share of revenue", row => row.revenue ? (row.payroll + row.overhead) / row.revenue : null, "rate"],
    ] },
    { id: "staff-schedule", name: "SG&A > Staff", note: "Payroll follows each role’s hiring plan, pay dates, annual raises and employer costs. Annual headcount shows the last forecast month of the year.", lines: [
      detail("staff", "headcount", "Closing headcount", "count"),
      ...staffDepartments.map(([department]) => [department + " · Closing headcount",
        row => sum(row.details.staff.filter(role => role.department === department), "headcount"), "count"]),
      ["Total closing headcount", "headcount", "footer"],
      ["Net headcount additions", "headcountAdded", "count"],
      detail("staff", "wages", "Wages"), detail("staff", "benefits", "Payroll taxes and benefits"),
      detail("staff", "amount", "Total cost by role"),
      ...staffDepartments.map(([department]) => [department + " · Payroll",
        row => total(row.details.staff.filter(role => role.department === department)), "total"]),
      ["Total staff and payroll", "payroll", "footer"],
    ] },
    { id: "taxes", name: "Taxes", lines: [
      ["Income tax expense", "tax"], ["Income tax paid", "incomeTaxPayment"],
      ["Closing income tax payable", "incomeTaxPayable"], ["Closing income tax receivable", "incomeTaxReceivable"],
      ["VAT charged on sales", "vatSales"], ["Recoverable VAT on purchases", "vatPurchases"],
      ["Recoverable VAT on operating expenses", "vatExpenses"], ["VAT paid", "vatPayment"],
      ["Closing VAT payable", "vatPayable"], ["Closing VAT receivable", "vatReceivable"],
    ] },
    { id: "working-capex", name: "Working capital", lines: [
        detail("streams", "ar", "Forecast receivable"), detail("receivables", "amount", "Outstanding opening receivable"),
        ["Closing receivables", "ar", "total"], ["Closing inventory", "stock"], detail("directCosts", "ap", "Supplier payable"),
        detail("payables", "amount", "Outstanding opening payable"), ["Closing payables", "ap", "total"],
        ["VAT charged on sales", "vatSales"], ["Recoverable VAT on purchases", "vatPurchases"],
        ["Recoverable VAT on operating expenses", "vatExpenses"], ["VAT payments", "vatPayment"],
        ["VAT receivable", "vatReceivable"], ["VAT payable", "vatPayable"],
        ["Closing net working capital", "wc", "footer"], ["Change in net working capital", "deltaWC"], ["Working capital cash impact", row => -row.deltaWC],
    ] },
    { id: "capex", name: "CAPEX",
      note: "Fixed assets roll forward from opening book value plus purchases less depreciation. Inventory orders become payables or cash costs on receipt. The debt schedule separates draws, interest and principal.",
      sections: [{ name: "Inventory orders and valuation", lines: [
        ...[["openingUnits", "Opening inventory units", "count"], ["openingOrders", "Units ordered before forecast", "count"], ["orderUnits", "Units ordered", "count"],
          ["receivedUnits", "Units received", "count"], ["soldUnits", "Units sold", "count"], ["lossUnits", "Units written off", "count"],
          ["closingUnits", "Closing inventory units", "count"], ["pendingUnits", "Units on order at month end", "count"],
          ["pendingValue", "Unreceived order commitments", "detail"], ["opening", "Opening inventory book value", "detail"],
          ["purchases", "Cost of inventory received", "detail"], ["soldCost", "Cost of units sold", "detail"], ["lossCost", "Cost of write-offs", "detail"],
          ["averageCost", "Average cost per unit", "detail"], ["stock", "Closing inventory book value", "detail"]
        ].map(([key, label, style]) => detail("directCosts", key, label, style, item => item.basis === "inventory")),
        ["Total closing inventory", "stock", "footer"],
      ] }, { name: "Fixed assets and capital expenditure", lines: [
        ...assetLines("opening", "Opening book value"),
        detail("investments", "purchase", "Planned purchase"),
        ...assetLines("replacement", "Automatic replacement").map(line => ({ ...line, filter: item => item.replacement === "cycle" })),
        ["Hiring equipment purchases", "equipmentPurchase"], ["Hiring equipment replacements", "equipmentReplacement"],
        ...assetCategories.map(([id, label]) => [label + " · CAPEX", row =>
          row.details.ownedAssets.concat(row.details.investments).reduce((value, asset) => value + (asset.assetClass === id ? asset.capex : 0),
            id === "computers" ? row.equipmentCapex : 0)]),
        ["Total capital expenditure", "capex", "footer"],
        ...assetLines("depreciation", "Depreciation"), ["Depreciation · Hiring equipment", "equipmentDepreciation"], ["Total depreciation", "depreciation", "total"],
        ...assetLines("assets", "Closing book value"), ["Book value · Hiring equipment", "equipmentAssets"], ["Net fixed assets", "assets", "total"],
      ] }, { name: "Loans and repayment", lines: [
        ...loanLines("opening", "Opening principal"), detail("newLoans", "draw", "Loan draw"), ...loanLines("interest", "Interest"),
        ...loanLines("principal", "Principal repaid"), ...loanLines("debt", "Closing principal"), ["Total debt service", row => row.interest + row.principal], ["Closing debt", "debt", "footer"],
      ] }],
    },
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

  globalThis.FinancialModel = { build, firstMonthSale, expensePreview, staffPreview, assetPreview, reports, revenueDrivers, scheduleReports, statementReports: statementReports(), linesFor, sum, halfCent, ForecastRangeError };
})();
