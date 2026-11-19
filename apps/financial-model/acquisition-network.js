(() => {
  const flowFields = ["paidCustomers", "organicCustomers", "riderCustomers", "merchantCustomers", "referralCustomers",
    "partnerCustomers", "duplicateCustomers", "ridersAdded", "merchantsAdded", "requestedOrders", "unservedOrders", "failedOrders", "riderCapacity", "merchantCapacity", "networkSpend"];
  const number = (row, key, fallback = 0) => Number(row[key] ?? fallback);
  const percent = (row, key, fallback = 0) => number(row, key, fallback) / 100;
  const sourceKey = row => JSON.stringify([row.moduleKey || "", row.demandGroup || ""]);
  const scope = row => (row.moduleScope || "").split(",").filter(Boolean);
  function assignedStaff(items, line, month, staffExpense) {
    const networks = items.streams.filter(row => row.orderForecast === "network");
    return items.staff.reduce((sum, role) => {
      const modules = scope(role);
      const eligible = networks.filter(source => !modules.length || modules.includes(source.moduleKey));
      const share = eligible.includes(line) ? 1 / eligible.length : 0;
      const headcount = staffExpense(role, month).headcount * share;
      return { riders: sum.riders + headcount * number(role, "ridersPerAgent"),
        merchants: sum.merchants + headcount * number(role, "merchantsPerAgent") };
    }, { riders: 0, merchants: 0 });
  }
  function step(line, base, prior, month, staff) {
    const live = month >= (line.launchMonth || 1);
    const retainedRiders = (prior?.activeRiders ?? number(line, "openingRiders")) * (live ? 1 - percent(line, "riderChurn") : 1);
    const retainedMerchants = (prior?.activeMerchants ?? number(line, "openingMerchants")) * (live ? 1 - percent(line, "merchantChurn") : 1);
    const ridersAdded = live ? staff.riders * percent(line, "riderActivation", 100) : 0;
    const merchantsAdded = live ? staff.merchants * percent(line, "merchantActivation", 100) : 0;
    const activeRiders = retainedRiders + ridersAdded;
    const activeMerchants = retainedMerchants + merchantsAdded;
    const retainedCustomers = (prior?.customers ?? number(line, "openingCustomers")) - base.customerLosses;
    const raw = {
      paidCustomers: base.paidSignups * percent(line, "customerActivation"),
      organicCustomers: base.organicSignups * percent(line, "customerActivation"),
      riderCustomers: live ? retainedRiders * number(line, "riderReferrals") * percent(line, "riderConversion") : 0,
      merchantCustomers: live ? retainedMerchants * number(line, "merchantReferrals") * percent(line, "merchantConversion") : 0,
      referralCustomers: live ? retainedCustomers * number(line, "customerReferrals") * percent(line, "referralConversion") : 0,
      partnerCustomers: live ? number(line, "partnerLeads") * percent(line, "partnerConversion") : 0,
    };
    const rawStarts = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const uniqueShare = 1 - percent(line, "acquisitionOverlap");
    const sources = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value * uniqueShare]));
    const customerStarts = rawStarts * uniqueShare;
    const customers = retainedCustomers + customerStarts;
    const requestedOrders = live ? customers * number(line, "ordersPerCustomer") : 0;
    const riderCapacity = activeRiders * number(line, "workingDays") * number(line, "riderOrders");
    const merchantCapacity = activeMerchants * number(line, "merchantOrders");
    const fulfillable = line.capacityMode === "on" ? Math.min(requestedOrders, riderCapacity, merchantCapacity) : requestedOrders;
    const units = fulfillable * percent(line, "completionRate", 100);
    const volume = units * number(line, "orderValue");
    const networkSpend = (live ? number(line, "partnerBudget") : 0)
      + sources.riderCustomers * number(line, "riderReward") + sources.merchantCustomers * number(line, "merchantReward")
      + sources.referralCustomers * number(line, "customerReward");
    return { ...base, ...sources, customerStarts, customers, activeRiders, activeMerchants, ridersAdded, merchantsAdded,
      requestedOrders, riderCapacity, merchantCapacity, unservedOrders: requestedOrders - fulfillable,
      failedOrders: fulfillable - units, units, volume, revenue: volume * base.feeRate, networkSpend,
      duplicateCustomers: rawStarts - customerStarts };
  }
  function linkedSale(line, base, source) {
    const units = source?.units || 0;
    const volume = line.method === "orders" ? units * line.orderValue : 0;
    return { ...base, units, volume, revenue: line.method === "orders" ? volume * base.feeRate : units * line.price,
      marketingSpend: 0, networkSpend: 0, customers: 0, customerStarts: 0, customerLosses: 0,
      paidSignups: 0, organicVisits: 0, organicSignups: 0 };
  }
  globalThis.FinancialNetwork = { step, assignedStaff, linkedSale, sourceKey, flowFields };
})();
