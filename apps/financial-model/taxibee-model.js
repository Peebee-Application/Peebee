(() => {
  const defaultConfig = {
    launchStart: "2027-01",
    udbLoan: "550000000",
    udbEquity: "420000000",
    udbEquityStakePct: "30",
    cashGrants: "0",
    appCapexM0: "35000000",
    prelaunchExpense: "25000000",
    initialVans: "5",
    unitVanCapex: "157690000",
    loanRatePct: "12",
    loanTenorYears: "6",
    loanGraceYears: "1",
    appraisalFeePct: "0.5",
    forcedSalePct: "80",
    agfGuaranteePct: "75",
    citRatePct: "30",
    udbDiscountRatePct: "12",
    equityHurdleRatePct: "18",
    vanLifeYears: "6",
    techLifeYears: "5",
    exitEbitdaMultiple: "4",
    minDscrCovenant: "1.5",
    cashGateFloor: "100000000",
    gatedTechMaintenance: "10000000",
    seatsPerVan: "13",
    tripsPerDay: "6",
    operatingDaysPerMonth: "26",
    y1SeatFare: "17000",
    fuelPerTrip: "29000",
    tollPerTrip: "5000",
    hubFeePerTrip: "3000",
    gatewayFeePct: "1.5",
    driversPerVan: "1.2",
    driverSalaryMonthly: "2860000",
    nssfRatePct: "10",
    insurancePerVan: "970000",
    maintenancePerVan: "1500000",
    amenitiesPerVan: "450000",
    licencesPerVan: "51000",
    y1CorpOverheadMonthly: "26700000",
    arPctAnnualRev: "3",
    apPctAnnualCosts: "4",
  };

  const defaultRamp = [
    { month: "Jan-27", load: "40" },
    { month: "Feb-27", load: "45" },
    { month: "Mar-27", load: "50" },
    { month: "Apr-27", load: "55" },
    { month: "May-27", load: "58" },
    { month: "Jun-27", load: "62" },
    { month: "Jul-27", load: "65" },
    { month: "Aug-27", load: "68" },
    { month: "Sep-27", load: "70" },
    { month: "Oct-27", load: "72" },
    { month: "Nov-27", load: "74" },
    { month: "Dec-27", load: "75" },
  ];

  const defaultSchedule = [
    { year: "2027", newVans: "0", load: "", fare: "", ancillaryPct: "6", costInflation: "1", corpOverhead: "", techCapex: "0" },
    { year: "2028", newVans: "3", load: "72", fare: "17500", ancillaryPct: "8", costInflation: "1.03", corpOverhead: "460000000", techCapex: "30000000" },
    { year: "2029", newVans: "6", load: "75", fare: "18000", ancillaryPct: "10", costInflation: "1.06", corpOverhead: "680000000", techCapex: "50000000" },
    { year: "2030", newVans: "10", load: "75", fare: "18500", ancillaryPct: "12", costInflation: "1.09", corpOverhead: "1050000000", techCapex: "100000000" },
    { year: "2031", newVans: "14", load: "76", fare: "19000", ancillaryPct: "14", costInflation: "1.12", corpOverhead: "1550000000", techCapex: "150000000" },
  ];

  const defaultStress = [
    { key: "base", name: "Base Case (Plan)", loadMult: "1", fareOverride: "", costMult: "1" },
    { key: "low-load", name: "Scenario A: Low Load (-15%)", loadMult: "0.85", fareOverride: "", costMult: "1" },
    { key: "fare-drop", name: "Scenario B: Fare Drop (UGX 15,000 flat)", loadMult: "1", fareOverride: "15000", costMult: "1" },
    { key: "cost-infl", name: "Scenario C: Cost Inflation (+15%)", loadMult: "1", fareOverride: "", costMult: "1.15" },
    { key: "severe", name: "Scenario D: Severe Stress (-15% Load, 15k Fare, +10% Cost)", loadMult: "0.85", fareOverride: "15000", costMult: "1.1" },
  ];

  const configKeys = Object.keys(defaultConfig);
  const rampKeys = ["month", "load"];
  const scheduleKeys = ["year", "newVans", "load", "fare", "ancillaryPct", "costInflation", "corpOverhead", "techCapex"];
  const stressKeys = ["key", "name", "loadMult", "fareOverride", "costMult"];

  function defaultState() {
    return structuredClone({
      taxibeeMode: "vip-fleet",
      taxibeeConfig: [{ ...defaultConfig }],
      taxibeeRamp: defaultRamp,
      taxibeeSchedule: defaultSchedule,
      taxibeeStress: defaultStress,
    });
  }

  function sanitizeRow(row, keys, fallback) {
    const source = row && typeof row === "object" ? row : {};
    return Object.fromEntries(keys.map(key => [
      key,
      typeof source[key] === "string" ? source[key].slice(0, 160) : String(fallback?.[key] ?? ""),
    ]));
  }

  function readState(answers = {}) {
    const mode = answers.taxibeeMode === "fly-express" ? "fly-express" : "vip-fleet";
    const rawConfig = Array.isArray(answers.taxibeeConfig) ? answers.taxibeeConfig[0] : null;
    const config = sanitizeRow(rawConfig, configKeys, defaultConfig);
    const rawRamp = Array.isArray(answers.taxibeeRamp) && answers.taxibeeRamp.length === 12 ? answers.taxibeeRamp : defaultRamp;
    const ramp = defaultRamp.map((base, i) => sanitizeRow(rawRamp[i], rampKeys, base));
    const rawSchedule = Array.isArray(answers.taxibeeSchedule) && answers.taxibeeSchedule.length === 5 ? answers.taxibeeSchedule : defaultSchedule;
    const schedule = defaultSchedule.map((base, i) => sanitizeRow(rawSchedule[i], scheduleKeys, base));
    const rawStress = Array.isArray(answers.taxibeeStress) && answers.taxibeeStress.length ? answers.taxibeeStress : defaultStress;
    const stress = rawStress.slice(0, 10).map((row, i) => sanitizeRow(row, stressKeys, defaultStress[i] || defaultStress[0]));
    return { taxibeeMode: mode, taxibeeConfig: [config], taxibeeRamp: ramp, taxibeeSchedule: schedule, taxibeeStress: stress };
  }

  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const nonNeg = (value, fallback = 0) => Math.max(0, num(value, fallback));
  const posInt = (value, fallback = 1) => Math.max(1, Math.round(num(value, fallback)));

  function parseStartYM(value) {
    const match = /^((?:19|20|21)\d{2})-(0[1-9]|1[0-2])$/.exec(String(value || "").trim());
    return match ? { year: Number(match[1]), month: Number(match[2]) } : { year: 2027, month: 1 };
  }

  function ymIndex(year, month) {
    return year * 12 + (month - 1);
  }

  function formatMonthShort(year, month) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[(month - 1) % 12]}-${String(year).slice(-2)}`;
  }

  function npv(rate, cashflows) {
    return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
  }

  function irr(cashflows) {
    if (!cashflows.length) return null;
    const hasPos = cashflows.some(v => v > 0);
    const hasNeg = cashflows.some(v => v < 0);
    if (!hasPos || !hasNeg) return null;
    let lo = -0.95;
    let hi = 10;
    let fLo = npv(lo, cashflows);
    let fHi = npv(hi, cashflows);
    while (fLo * fHi > 0 && hi < 1000) {
      hi *= 2;
      fHi = npv(hi, cashflows);
    }
    if (fLo * fHi > 0) return null;
    for (let i = 0; i < 120; i++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid, cashflows);
      if (Math.abs(fMid) < 1e-6) return mid;
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
    }
    return (lo + hi) / 2;
  }

  function parseInputs(answers = {}) {
    const state = readState(answers);
    const c = state.taxibeeConfig[0];
    const start = parseStartYM(c.launchStart);
    const udbLoan = nonNeg(c.udbLoan, 550e6);
    const udbEquity = nonNeg(c.udbEquity, 420e6);
    const udbEquityStake = Math.min(1, Math.max(0, nonNeg(c.udbEquityStakePct, 30) / 100));
    const cashGrants = nonNeg(c.cashGrants, 0);
    const appCapexM0 = nonNeg(c.appCapexM0, 35e6);
    const prelaunchExpense = nonNeg(c.prelaunchExpense, 25e6);
    const initialVans = Math.max(1, Math.round(nonNeg(c.initialVans, 5)));
    const unitVanCapex = nonNeg(c.unitVanCapex, 157.69e6);
    const loanRate = nonNeg(c.loanRatePct, 12) / 100;
    const loanTenorYears = posInt(c.loanTenorYears, 6);
    const loanGraceYears = Math.min(loanTenorYears - 1, Math.max(0, Math.round(nonNeg(c.loanGraceYears, 1))));
    const appraisalFeeRate = nonNeg(c.appraisalFeePct, 0.5) / 100;
    const forcedSaleRate = nonNeg(c.forcedSalePct, 80) / 100;
    const agfGuaranteeRate = nonNeg(c.agfGuaranteePct, 75) / 100;
    const citRate = nonNeg(c.citRatePct, 30) / 100;
    const udbDiscountRate = nonNeg(c.udbDiscountRatePct, 12) / 100;
    const equityHurdleRate = nonNeg(c.equityHurdleRatePct, 18) / 100;
    const vanLifeYears = posInt(c.vanLifeYears, 6);
    const techLifeYears = posInt(c.techLifeYears, 5);
    const exitEbitdaMultiple = nonNeg(c.exitEbitdaMultiple, 4);
    const minDscrCovenant = nonNeg(c.minDscrCovenant, 1.5);
    const cashGateFloor = nonNeg(c.cashGateFloor, 100e6);
    const gatedTechMaintenance = nonNeg(c.gatedTechMaintenance, 10e6);
    const seatsPerVan = nonNeg(c.seatsPerVan, 13);
    const tripsPerDay = nonNeg(c.tripsPerDay, 6);
    const operatingDaysPerMonth = nonNeg(c.operatingDaysPerMonth, 26);
    const y1SeatFare = nonNeg(c.y1SeatFare, 17000);
    const fuelPerTrip = nonNeg(c.fuelPerTrip, 29000);
    const tollPerTrip = nonNeg(c.tollPerTrip, 5000);
    const hubFeePerTrip = nonNeg(c.hubFeePerTrip, 3000);
    const gatewayFeeRate = nonNeg(c.gatewayFeePct, 1.5) / 100;
    const driversPerVan = nonNeg(c.driversPerVan, 1.2);
    const driverSalaryMonthly = nonNeg(c.driverSalaryMonthly, 2860000);
    const nssfRate = nonNeg(c.nssfRatePct, 10) / 100;
    const insurancePerVan = nonNeg(c.insurancePerVan, 970000);
    const maintenancePerVan = nonNeg(c.maintenancePerVan, 1500000);
    const amenitiesPerVan = nonNeg(c.amenitiesPerVan, 450000);
    const licencesPerVan = nonNeg(c.licencesPerVan, 51000);
    const y1CorpOverheadMonthly = nonNeg(c.y1CorpOverheadMonthly, 26700000);
    const arPct = nonNeg(c.arPctAnnualRev, 3) / 100;
    const apPct = nonNeg(c.apPctAnnualCosts, 4) / 100;

    const rampLoads = state.taxibeeRamp.map((row, idx) => ({
      monthIndex: idx + 1,
      label: formatMonthShort(start.year + Math.floor((start.month - 1 + idx) / 12), ((start.month - 1 + idx) % 12) + 1),
      load: Math.min(1, Math.max(0, nonNeg(row.load, 0) / 100)),
    }));
    const y1AvgLoad = rampLoads.reduce((s, r) => s + r.load, 0) / rampLoads.length;

    let runningVans = initialVans;
    const schedule = state.taxibeeSchedule.map((row, idx) => {
      const newVans = idx === 0 ? 0 : Math.max(0, Math.round(nonNeg(row.newVans, 0)));
      runningVans = idx === 0 ? initialVans : runningVans + newVans;
      return {
        yearIndex: idx + 1,
        calendarYear: start.year + idx,
        activeVans: runningVans,
        newVans,
        loadFactor: idx === 0 ? y1AvgLoad : Math.min(1, Math.max(0, nonNeg(row.load, 75) / 100)),
        seatFare: idx === 0 ? y1SeatFare : nonNeg(row.fare, y1SeatFare),
        ancillaryRate: nonNeg(row.ancillaryPct, 6) / 100,
        costInflation: Math.max(0.01, num(row.costInflation, 1)),
        corpOverhead: idx === 0 ? y1CorpOverheadMonthly * 12 : nonNeg(row.corpOverhead, y1CorpOverheadMonthly * 12),
        techCapex: nonNeg(row.techCapex, 0),
      };
    });

    const stress = state.taxibeeStress.map(row => ({
      key: row.key || "custom",
      name: row.name || "Scenario",
      loadMult: nonNeg(row.loadMult, 1),
      fareOverride: row.fareOverride !== "" && Number.isFinite(Number(row.fareOverride)) && Number(row.fareOverride) > 0
        ? Number(row.fareOverride) : null,
      costMult: nonNeg(row.costMult, 1),
    }));

    return {
      mode: state.taxibeeMode,
      raw: state,
      start,
      udbLoan, udbEquity, udbEquityStake, cashGrants, appCapexM0, prelaunchExpense,
      initialVans, unitVanCapex, loanRate, loanTenorYears, loanGraceYears,
      appraisalFeeRate, forcedSaleRate, agfGuaranteeRate, citRate,
      udbDiscountRate, equityHurdleRate, vanLifeYears, techLifeYears,
      exitEbitdaMultiple, minDscrCovenant, cashGateFloor, gatedTechMaintenance,
      seatsPerVan, tripsPerDay, operatingDaysPerMonth, y1SeatFare,
      fuelPerTrip, tollPerTrip, hubFeePerTrip, gatewayFeeRate,
      driversPerVan, driverSalaryMonthly, nssfRate,
      insurancePerVan, maintenancePerVan, amenitiesPerVan, licencesPerVan,
      y1CorpOverheadMonthly, arPct, apPct,
      rampLoads, y1AvgLoad, schedule, stress,
    };
  }

  function simulateHorizon(p, opts = {}) {
    const {
      loadMult = 1,
      fareOverride = null,
      costMult = 1,
      applyGate = false,
      horizon = 5,
    } = opts;
    const totalSources = p.udbLoan + p.udbEquity + p.cashGrants;
    const initialFleetCapex = p.initialVans * p.unitVanCapex;
    const appraisalFee = p.udbLoan * p.appraisalFeeRate;
    const m0Cash = totalSources - initialFleetCapex - p.appCapexM0 - p.prelaunchExpense - appraisalFee;
    const directCostPerTrip = p.fuelPerTrip + p.tollPerTrip + p.hubFeePerTrip;
    const driverPayrollPerVan = p.driversPerVan * p.driverSalaryMonthly * (1 + p.nssfRate);
    const vanFixedPerVan = p.insurancePerVan + p.maintenancePerVan + p.amenitiesPerVan + p.licencesPerVan;
    const amortYears = Math.max(1, p.loanTenorYears - p.loanGraceYears);
    const annualPrincipal = p.udbLoan / amortYears;
    const y1Corp = p.y1CorpOverheadMonthly * 12;

    let endCash = m0Cash;
    let prevAR = 0;
    let prevAP = 0;
    let debt = p.udbLoan;
    let netFleet = initialFleetCapex;
    let netTech = p.appCapexM0;
    let retained = -(p.prelaunchExpense + appraisalFee);
    let activeVans = p.initialVans;
    const fleetCohorts = [{ cost: initialFleetCapex, rem: p.vanLifeYears }];
    const techCohorts = [{ cost: p.appCapexM0, rem: p.techLifeYears }];
    const rows = [];

    for (let y = 0; y < horizon; y++) {
      const cfg = p.schedule[y];
      const unitVanCost = p.unitVanCapex * cfg.costInflation;
      let buyVans = cfg.newVans;
      let gated = false;
      if (applyGate && y > 0) {
        const availableForVans = endCash - p.cashGateFloor - cfg.techCapex;
        const maxAffordable = availableForVans > 0 ? Math.floor(availableForVans / unitVanCost) : 0;
        buyVans = Math.min(cfg.newVans, Math.max(0, maxAffordable));
        gated = buyVans < cfg.newVans;
      }
      const vans = y === 0 ? p.initialVans : activeVans + buyVans;
      const loadFactor = Math.min(1, cfg.loadFactor * loadMult);
      const seatFare = fareOverride ?? cfg.seatFare;
      const seatRevenue = vans * p.seatsPerVan * p.tripsPerDay * p.operatingDaysPerMonth * 12 * loadFactor * seatFare;
      const ancillaryRevenue = seatRevenue * cfg.ancillaryRate;
      const totalRevenue = seatRevenue + ancillaryRevenue;
      const directTripCosts = vans * p.tripsPerDay * p.operatingDaysPerMonth * 12 * directCostPerTrip * cfg.costInflation * costMult;
      const gatewayFees = totalRevenue * p.gatewayFeeRate;
      const cogs = directTripCosts + gatewayFees;
      const grossProfit = totalRevenue - cogs;
      const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
      const driverPayroll = vans * driverPayrollPerVan * 12 * cfg.costInflation * costMult;
      const vanFixedOpex = vans * vanFixedPerVan * 12 * cfg.costInflation * costMult;
      const fleetOpex = driverPayroll + vanFixedOpex;
      const corpBase = (applyGate && y > 0 && vans < cfg.activeVans)
        ? y1Corp + (cfg.corpOverhead - y1Corp) * (vans / cfg.activeVans)
        : cfg.corpOverhead;
      const corpOpex = corpBase * costMult;
      const totalOpex = fleetOpex + corpOpex;
      const ebitda = grossProfit - totalOpex;
      const ebitdaMargin = totalRevenue > 0 ? ebitda / totalRevenue : 0;

      const techCapex = (applyGate && y > 0 && buyVans === 0)
        ? Math.min(cfg.techCapex, p.gatedTechMaintenance)
        : cfg.techCapex;
      const vanCapex = buyVans * unitVanCost;
      const totalCapex = vanCapex + techCapex;

      if (vanCapex > 0) fleetCohorts.push({ cost: vanCapex, rem: p.vanLifeYears });
      if (techCapex > 0) techCohorts.push({ cost: techCapex, rem: p.techLifeYears });
      let depFleet = 0;
      let depTech = 0;
      for (const cohort of fleetCohorts) {
        if (cohort.rem > 0) {
          depFleet += cohort.cost / p.vanLifeYears;
          cohort.rem -= 1;
        }
      }
      for (const cohort of techCohorts) {
        if (cohort.rem > 0) {
          depTech += cohort.cost / p.techLifeYears;
          cohort.rem -= 1;
        }
      }
      const da = depFleet + depTech;
      const ebit = ebitda - da;
      const interest = debt * p.loanRate;
      const ebt = ebit - interest;
      const tax = Math.max(0, ebt * p.citRate);
      const pat = ebt - tax;
      const netMargin = totalRevenue > 0 ? pat / totalRevenue : 0;

      const ar = totalRevenue * p.arPct;
      const ap = (cogs + totalOpex) * p.apPct;
      const deltaNwc = (ar - prevAR) - (ap - prevAP);
      const cfo = pat + da - deltaNwc;
      const principal = y < p.loanGraceYears ? 0 : Math.min(debt, annualPrincipal);
      const netCashChange = cfo - totalCapex - principal;
      const openingCash = endCash;
      endCash = openingCash + netCashChange;
      const openingDebt = debt;
      debt = Math.max(0, debt - principal);
      netFleet = netFleet + vanCapex - depFleet;
      netTech = netTech + techCapex - depTech;
      retained += pat;

      const totalAssets = endCash + ar + netFleet + netTech;
      const paidInEquity = p.udbEquity + p.cashGrants;
      const totalLiabilitiesAndEquity = ap + debt + paidInEquity + retained;
      const bsCheck = totalAssets - totalLiabilitiesAndEquity;
      const cfads = ebitda - tax - deltaNwc;
      const debtService = interest + principal;
      const dscr = debtService > 0 ? cfads / debtService : null;
      const nopat = ebit - Math.max(0, ebit) * p.citRate;
      const fcff = nopat + da - deltaNwc - totalCapex;

      rows.push({
        yearIndex: y + 1,
        calendarYear: cfg.calendarYear,
        vans,
        buyVans,
        gated,
        loadFactor,
        seatFare,
        seatRevenue,
        ancillaryRevenue,
        totalRevenue,
        directTripCosts,
        gatewayFees,
        cogs,
        grossProfit,
        grossMargin,
        driverPayroll,
        vanFixedOpex,
        fleetOpex,
        corpOpex,
        totalOpex,
        ebitda,
        ebitdaMargin,
        depFleet,
        depTech,
        da,
        ebit,
        interest,
        ebt,
        tax,
        pat,
        netMargin,
        ar,
        ap,
        nwc: ar - ap,
        deltaNwc,
        cfo,
        vanCapex,
        techCapex,
        totalCapex,
        principal,
        netCashChange,
        openingCash,
        endCash,
        openingDebt,
        debt,
        netFleet,
        netTech,
        totalAssets,
        paidInEquity,
        retained,
        totalLiabilitiesAndEquity,
        bsCheck,
        cfads,
        debtService,
        dscr,
        fcff,
      });

      prevAR = ar;
      prevAP = ap;
      activeVans = vans;
    }

    const sumKey = key => rows.reduce((acc, r) => acc + r[key], 0);
    const last = rows[rows.length - 1];
    const m0Outflow = -(initialFleetCapex + p.appCapexM0 + p.prelaunchExpense + appraisalFee);
    const bookTerminalValue = last.netFleet + last.netTech + last.nwc;
    const projectCashFlows = [
      m0Outflow,
      ...rows.map((r, i) => r.fcff + (i === rows.length - 1 ? bookTerminalValue : 0)),
    ];
    const projectNpvUdb = npv(p.udbDiscountRate, projectCashFlows);
    const projectNpvEquity = npv(p.equityHurdleRate, projectCashFlows);
    const projectIrr = irr(projectCashFlows);
    const minDscr = rows.reduce((min, r) => (r.dscr != null && r.dscr < min ? r.dscr : min), Infinity);
    const minCash = rows.reduce((min, r) => (r.endCash < min ? r.endCash : min), Infinity);
    const cumulativeRevenue = sumKey("totalRevenue");
    const cumulativeEbitda = sumKey("ebitda");
    const cumulativePat = sumKey("pat");
    const enterpriseValueY5 = horizon === 5 ? p.exitEbitdaMultiple * last.ebitda : null;
    const equityValueY5 = horizon === 5 ? enterpriseValueY5 - last.debt + last.endCash : null;
    const udbStakeValueY5 = horizon === 5 ? equityValueY5 * p.udbEquityStake : null;
    const udbMoicY5 = horizon === 5 && p.udbEquity > 0 ? udbStakeValueY5 / p.udbEquity : null;

    return {
      horizon,
      rows,
      totals: {
        seatRevenue: sumKey("seatRevenue"),
        ancillaryRevenue: sumKey("ancillaryRevenue"),
        totalRevenue: cumulativeRevenue,
        cogs: sumKey("cogs"),
        grossProfit: sumKey("grossProfit"),
        grossMargin: cumulativeRevenue > 0 ? sumKey("grossProfit") / cumulativeRevenue : 0,
        fleetOpex: sumKey("fleetOpex"),
        corpOpex: sumKey("corpOpex"),
        totalOpex: sumKey("totalOpex"),
        ebitda: cumulativeEbitda,
        ebitdaMargin: cumulativeRevenue > 0 ? cumulativeEbitda / cumulativeRevenue : 0,
        da: sumKey("da"),
        ebit: sumKey("ebit"),
        interest: sumKey("interest"),
        ebt: sumKey("ebt"),
        tax: sumKey("tax"),
        pat: cumulativePat,
        netMargin: cumulativeRevenue > 0 ? cumulativePat / cumulativeRevenue : 0,
        deltaNwc: sumKey("deltaNwc"),
        cfo: sumKey("cfo"),
        totalCapex: sumKey("totalCapex"),
        principal: sumKey("principal"),
        netCashChange: sumKey("netCashChange"),
        endCash: last.endCash,
        debt: last.debt,
        endingVans: last.vans,
        cfads: sumKey("cfads"),
        debtService: sumKey("debtService"),
        minDscr: Number.isFinite(minDscr) ? minDscr : null,
        minCash: Number.isFinite(minCash) ? minCash : m0Cash,
        fcff: sumKey("fcff"),
      },
      valuation: {
        m0Outflow,
        bookTerminalValue,
        projectCashFlows,
        projectNpvUdb,
        projectNpvEquity,
        projectIrr,
        enterpriseValueY5,
        equityValueY5,
        udbStakeValueY5,
        udbMoicY5,
      },
    };
  }

  function compute(answers = {}) {
    const p = parseInputs(answers);
    const totalSources = p.udbLoan + p.udbEquity + p.cashGrants;
    const initialFleetCapex = p.initialVans * p.unitVanCapex;
    const appraisalFee = p.udbLoan * p.appraisalFeeRate;
    const m0CashBuffer = totalSources - initialFleetCapex - p.appCapexM0 - p.prelaunchExpense - appraisalFee;
    const forcedSaleValue = initialFleetCapex * p.forcedSaleRate;
    const collateralCoverage = p.udbLoan > 0 ? forcedSaleValue / p.udbLoan : 0;
    const agfGuaranteeValue = p.udbLoan * p.agfGuaranteeRate;

    const directCostPerTrip = p.fuelPerTrip + p.tollPerTrip + p.hubFeePerTrip;
    const tripsPerMonth = p.tripsPerDay * p.operatingDaysPerMonth;
    const driverPayrollPerVan = p.driversPerVan * p.driverSalaryMonthly * (1 + p.nssfRate);
    const vanFixedOpexPerVan = p.insurancePerVan + p.maintenancePerVan + p.amenitiesPerVan + p.licencesPerVan;
    const maxMonthlySeatRev = p.seatsPerVan * tripsPerMonth * p.y1SeatFare;
    const monthlyDirectTripCosts = tripsPerMonth * directCostPerTrip;
    const totalMonthlyVanOpCostBeforeGw = monthlyDirectTripCosts + driverPayrollPerVan + vanFixedOpexPerVan;
    const netSeatRevPerFullLoad = maxMonthlySeatRev * (1 - p.gatewayFeeRate);
    const breakevenLoadFactor = netSeatRevPerFullLoad > 0 ? totalMonthlyVanOpCostBeforeGw / netSeatRevPerFullLoad : 0;
    const seatRevAt75 = maxMonthlySeatRev * 0.75;
    const netContributionAt75 = seatRevAt75 * (1 - p.gatewayFeeRate) - totalMonthlyVanOpCostBeforeGw;

    // Year 1 Monthly Launch Ramp & Liquidity Tracker
    let rampCash = m0CashBuffer;
    let troughCash = m0CashBuffer;
    let troughMonth = "M0";
    let operatingBreakevenMonth = null;
    let cashflowBreakevenMonth = null;
    const y1AncillaryRate = p.schedule[0].ancillaryRate;
    const monthlyInterestY1 = p.udbLoan * p.loanRate / 12;

    const rampMonths = p.rampLoads.map(entry => {
      const vans = p.initialVans;
      const seatRevenue = vans * p.seatsPerVan * tripsPerMonth * entry.load * p.y1SeatFare;
      const ancillaryRevenue = seatRevenue * y1AncillaryRate;
      const totalRevenue = seatRevenue + ancillaryRevenue;
      const directTripCosts = vans * monthlyDirectTripCosts;
      const gatewayFees = totalRevenue * p.gatewayFeeRate;
      const totalCogs = directTripCosts + gatewayFees;
      const grossProfit = totalRevenue - totalCogs;
      const driverPayroll = vans * driverPayrollPerVan;
      const vanFixedOpex = vans * vanFixedOpexPerVan;
      const corpOverhead = p.y1CorpOverheadMonthly;
      const totalOpex = driverPayroll + vanFixedOpex + corpOverhead;
      const ebitda = grossProfit - totalOpex;
      const interest = monthlyInterestY1;
      const netCashFlow = ebitda - interest;
      rampCash += netCashFlow;
      if (operatingBreakevenMonth === null && ebitda > 0) operatingBreakevenMonth = entry;
      if (cashflowBreakevenMonth === null && netCashFlow > 0) cashflowBreakevenMonth = entry;
      if (rampCash < troughCash) {
        troughCash = rampCash;
        troughMonth = entry.label;
      }
      return {
        monthIndex: entry.monthIndex,
        label: entry.label,
        vans,
        loadFactor: entry.load,
        seatRevenue,
        ancillaryRevenue,
        totalRevenue,
        directTripCosts,
        gatewayFees,
        totalCogs,
        grossProfit,
        driverPayroll,
        vanFixedOpex,
        corpOverhead,
        totalOpex,
        ebitda,
        interest,
        netCashFlow,
        endingCash: rampCash,
      };
    });

    const sumRamp = key => rampMonths.reduce((acc, r) => acc + r[key], 0);
    const rampTotals = {
      vans: p.initialVans,
      loadFactor: p.y1AvgLoad,
      seatRevenue: sumRamp("seatRevenue"),
      ancillaryRevenue: sumRamp("ancillaryRevenue"),
      totalRevenue: sumRamp("totalRevenue"),
      directTripCosts: sumRamp("directTripCosts"),
      gatewayFees: sumRamp("gatewayFees"),
      totalCogs: sumRamp("totalCogs"),
      grossProfit: sumRamp("grossProfit"),
      driverPayroll: sumRamp("driverPayroll"),
      vanFixedOpex: sumRamp("vanFixedOpex"),
      corpOverhead: sumRamp("corpOverhead"),
      totalOpex: sumRamp("totalOpex"),
      ebitda: sumRamp("ebitda"),
      interest: sumRamp("interest"),
      netCashFlow: sumRamp("netCashFlow"),
      endingCash: rampMonths[rampMonths.length - 1]?.endingCash ?? m0CashBuffer,
    };

    const model3y = simulateHorizon(p, { horizon: 3 });
    const model5y = simulateHorizon(p, { horizon: 5 });

    // UDB Loan 6-Year Amortization & DSCR Schedule
    const amortYears = Math.max(1, p.loanTenorYears - p.loanGraceYears);
    const annualPrincipal = p.udbLoan / amortYears;
    let loanBalance = p.udbLoan;
    const debtSchedule = [];
    for (let y = 0; y < p.loanTenorYears; y++) {
      const opening = loanBalance;
      const interest = opening * p.loanRate;
      const principal = y < p.loanGraceYears ? 0 : Math.min(opening, annualPrincipal);
      const totalService = interest + principal;
      const closing = Math.max(0, opening - principal);
      debtSchedule.push({
        loanYear: y + 1,
        calendarYear: p.start.year + y,
        opening,
        interest,
        principal,
        totalService,
        closing,
        phase: y < p.loanGraceYears
          ? `${p.loanGraceYears * 12}-Mo Principal Grace (Interest Only)`
          : "Equal Principal Amortization",
      });
      loanBalance = closing;
    }
    const debtTotals = {
      opening: p.udbLoan,
      interest: debtSchedule.reduce((s, r) => s + r.interest, 0),
      principal: debtSchedule.reduce((s, r) => s + r.principal, 0),
      totalService: debtSchedule.reduce((s, r) => s + r.totalService, 0),
      closing: debtSchedule[debtSchedule.length - 1]?.closing ?? 0,
      phase: `Fully Amortized by Dec ${p.start.year + p.loanTenorYears - 1}`,
    };

    const dscrCovenant = model5y.rows.map(r => ({
      loanYear: r.yearIndex,
      calendarYear: r.calendarYear,
      ebitda: r.ebitda,
      cfads: r.cfads,
      debtService: r.debtService,
      dscr: r.dscr,
      minCovenant: p.minDscrCovenant,
      compliant: r.dscr != null && r.dscr >= p.minDscrCovenant,
    }));

    // Credit Committee Stress Tests & CapEx-Gating Resilience Matrix
    const stressResults = p.stress.map(sc => {
      const unconstrained = simulateHorizon(p, {
        loadMult: sc.loadMult,
        fareOverride: sc.fareOverride,
        costMult: sc.costMult,
        applyGate: false,
        horizon: 5,
      });
      const gateNeeded = unconstrained.totals.minCash < p.cashGateFloor;
      const gated = gateNeeded
        ? simulateHorizon(p, {
            loadMult: sc.loadMult,
            fareOverride: sc.fareOverride,
            costMult: sc.costMult,
            applyGate: true,
            horizon: 5,
          })
        : unconstrained;
      const y1 = unconstrained.rows[0];
      const y2Gated = gated.rows[1];
      const y5Gated = gated.rows[4];
      const y1Compliant = y1.dscr != null && y1.dscr >= p.minDscrCovenant;
      const y2Positive = y2Gated.dscr != null && y2Gated.dscr >= 1;

      let creditVerdict;
      let gateAction;
      if (!gateNeeded && y1Compliant && y2Gated.dscr >= p.minDscrCovenant) {
        creditVerdict = "COMPLIANT - Full organic scale";
        gateAction = `No gate triggered — full organic ${y5Gated.vans}-van rollout`;
      } else if (gated.totals.minCash < 0 || (y2Gated.dscr != null && y2Gated.dscr < 0)) {
        creditVerdict = "TRIGGERS MONTH-3 STOP RULE";
        gateAction = "Month-3 Stop Rule halts operations before losses mount";
      } else if (y5Gated.vans > p.initialVans) {
        creditVerdict = y1Compliant ? `SOLVENT - Meets Y1 ${p.minDscrCovenant.toFixed(2)}x DSCR` : "SOLVENT - Caps fleet expansion";
        gateAction = `Caps fleet at ${y5Gated.vans} vans; eliminates negative cash risk`;
      } else if (y1Compliant && y2Positive) {
        creditVerdict = `SOLVENT - Meets Y1 ${p.minDscrCovenant.toFixed(2)}x DSCR`;
        gateAction = "Pauses expansion vans; services 100% of UDB debt";
      } else {
        creditVerdict = "SOLVENT - Pauses Y2 van expansion";
        gateAction = `Pauses expansion vans; preserves UGX ${(gated.totals.minCash / 1e6).toFixed(1)}M+ liquidity`;
      }

      return {
        ...sc,
        y1,
        y2GatedDscr: y2Gated.dscr,
        y5Fleet: y5Gated.vans,
        gatedMinCash: gated.totals.minCash,
        gatedY5Cash: y5Gated.endCash,
        unconstrainedMinCash: unconstrained.totals.minCash,
        gateNeeded,
        creditVerdict,
        gateAction,
      };
    });

    return {
      inputs: p,
      capital: {
        totalSources,
        initialFleetCapex,
        appraisalFee,
        m0CashBuffer,
        m0Expensed: p.prelaunchExpense + appraisalFee,
        m0Outflow: model5y.valuation.m0Outflow,
      },
      collateral: {
        forcedSaleValue,
        collateralCoverage,
        agfGuaranteeValue,
      },
      unitEconomics: {
        directCostPerTrip,
        tripsPerMonth,
        driverPayrollPerVan,
        vanFixedOpexPerVan,
        maxMonthlySeatRev,
        monthlyDirectTripCosts,
        totalMonthlyVanOpCostBeforeGw,
        breakevenLoadFactor,
        seatRevAt75,
        netContributionAt75,
      },
      ramp: {
        months: rampMonths,
        totals: rampTotals,
        operatingBreakevenMonth,
        cashflowBreakevenMonth,
        troughCash,
        troughMonth,
      },
      model3y,
      model5y,
      debtSchedule,
      debtTotals,
      dscrCovenant,
      stressResults,
    };
  }

  // Build calendar-aligned monthly overlay lines so Taxibee VIP Fleet rolls
  // directly into Peebee's consolidated 3-statement forecast with zero BS check error.
  function consolidatedOverlay(answers = {}) {
    const data = compute(answers);
    const p = data.inputs;
    const fcStart = parseStartYM(answers.start || p.raw.taxibeeConfig[0].launchStart);
    const horizon = Math.max(1, Math.min(84, Math.round(num(answers.months, 36))));
    const fcStartIdx = ymIndex(fcStart.year, fcStart.month);
    const launchIdx = ymIndex(p.start.year, p.start.month);
    const m0Idx = launchIdx - 1;
    const m0Month = m0Idx - fcStartIdx + 1; // 1-based model month for M0 (<=0 if before forecast start)
    const launchMonth = launchIdx - fcStartIdx + 1;

    // AR = 3% of Annual Revenue = (0.03 * 12) = 0.36 months = 10.8 days in 30-day model month
    // AP = 4% of Annual Costs = (0.04 * 12) = 0.48 months = 14.4 days in 30-day model month
    const arDays = String(Number((p.arPct * 360).toFixed(4)));
    const apDays = String(Number((p.apPct * 360).toFixed(4)));

    const seatRevSeries = Array(horizon).fill(0);
    const ancRevSeries = Array(horizon).fill(0);
    const tripCostSeries = Array(horizon).fill(0);
    const gatewayCostSeries = Array(horizon).fill(0);
    const driverHeadcountSeries = Array(horizon).fill(0);
    const driverWagesSeries = Array(horizon).fill(0);
    const driverBenefitsSeries = Array(horizon).fill(0);
    const vanFixedSeries = Array(horizon).fill(0);
    const corpOverheadSeries = Array(horizon).fill(0);
    const prelaunchSeries = Array(horizon).fill(0);

    const directCostPerTrip = p.fuelPerTrip + p.tollPerTrip + p.hubFeePerTrip;
    const tripsPerMonth = p.tripsPerDay * p.operatingDaysPerMonth;
    const vanFixedPerVan = p.insurancePerVan + p.maintenancePerVan + p.amenitiesPerVan + p.licencesPerVan;

    for (let i = 0; i < horizon; i++) {
      const curIdx = fcStartIdx + i;
      if (curIdx === m0Idx) {
        prelaunchSeries[i] = data.capital.m0Expensed;
      }
      if (curIdx < launchIdx) continue;
      const offset = curIdx - launchIdx; // 0 = Jan 2027 (Y1 M1)
      const yearIdx = Math.floor(offset / 12);
      const monthInYear = offset % 12;
      const cfg = p.schedule[Math.min(yearIdx, p.schedule.length - 1)];
      const vans = cfg.activeVans;
      const load = yearIdx === 0 ? p.rampLoads[monthInYear].load : cfg.loadFactor;
      const seatRev = vans * p.seatsPerVan * tripsPerMonth * load * cfg.seatFare;
      const ancRev = seatRev * cfg.ancillaryRate;
      const totalRev = seatRev + ancRev;
      const tripCost = vans * tripsPerMonth * directCostPerTrip * cfg.costInflation;
      const gwCost = totalRev * p.gatewayFeeRate;
      const drivers = vans * p.driversPerVan;
      const wages = drivers * p.driverSalaryMonthly * cfg.costInflation;
      const benefits = wages * p.nssfRate;
      const vanFixed = vans * vanFixedPerVan * cfg.costInflation;
      const corp = cfg.corpOverhead / 12;

      seatRevSeries[i] = seatRev;
      ancRevSeries[i] = ancRev;
      tripCostSeries[i] = tripCost;
      gatewayCostSeries[i] = gwCost;
      driverHeadcountSeries[i] = drivers;
      driverWagesSeries[i] = wages;
      driverBenefitsSeries[i] = benefits;
      vanFixedSeries[i] = vanFixed;
      corpOverheadSeries[i] = corp;
    }

    const vanLifeMonths = p.vanLifeYears * 12;
    const techLifeMonths = p.techLifeYears * 12;
    const ownedAssets = [];
    const investments = [];
    const accounts = [];
    const existingLoans = [];
    const newLoans = [];
    const contributions = [];

    // Initial M0 Capital Structure:
    // If M0 is BEFORE forecast start (e.g. forecast starts Jan 2027), M0 assets, cash buffer, and debt are opening balances!
    // If M0 is INSIDE forecast (e.g. forecast starts Nov 2026), M0 transactions happen in month m0Month!
    const m0InForecast = m0Month >= 1 && m0Month <= horizon;
    const m0BeforeForecast = m0Month <= 0;

    if (m0BeforeForecast) {
      // Advance opening book values if forecast starts after launchIdx
      const elapsedMonthsBeforeStart = Math.max(0, fcStartIdx - launchIdx);
      const elapsedYearsBeforeStart = Math.floor(elapsedMonthsBeforeStart / 12);
      const remVanLife = Math.max(1, vanLifeMonths - elapsedMonthsBeforeStart);
      const remVanBook = Math.max(0, data.capital.initialFleetCapex * (1 - elapsedMonthsBeforeStart / vanLifeMonths));
      if (remVanBook > 0) {
        ownedAssets.push({ name: "Taxibee · Initial VIP Fleet (5 Vans)", assetClass: "other", amount: String(remVanBook), life: String(remVanLife), replacement: "none", moduleScope: "taxipress" });
      }
      const remTechLife = Math.max(1, techLifeMonths - elapsedMonthsBeforeStart);
      const remTechBook = Math.max(0, p.appCapexM0 * (1 - elapsedMonthsBeforeStart / techLifeMonths));
      if (remTechBook > 0) {
        ownedAssets.push({ name: "Taxibee · App Upgrade & Scheduling Platform", assetClass: "infrastructure", amount: String(remTechBook), life: String(remTechLife), replacement: "none", moduleScope: "taxipress" });
      }
      if (data.capital.m0CashBuffer > 0 && elapsedMonthsBeforeStart === 0) {
        accounts.push({ name: "Taxibee · M0 Working Capital Buffer (UDB)", amount: String(data.capital.m0CashBuffer) });
      }
      const amortYears = Math.max(1, p.loanTenorYears - p.loanGraceYears);
      const principalRepaidBefore = Math.max(0, elapsedYearsBeforeStart - p.loanGraceYears) * (p.udbLoan / amortYears);
      const openingDebt = Math.max(0, p.udbLoan - principalRepaidBefore);
      const remLoanMonths = Math.max(1, p.loanTenorYears * 12 - elapsedMonthsBeforeStart);
      const remGraceMonths = Math.max(0, p.loanGraceYears * 12 - elapsedMonthsBeforeStart);
      if (openingDebt > 0) {
        existingLoans.push({
          name: "Taxibee · UDB Women Prosper Asset Loan",
          amount: String(openingDebt),
          rate: String(p.loanRate * 100),
          term: String(remLoanMonths),
          graceMonths: String(remGraceMonths),
          principalCadence: "annual",
          repayment: "principal",
        });
      }
    } else if (m0InForecast) {
      if (p.udbEquity + p.cashGrants > 0) {
        contributions.push({ name: "Taxibee · UDB Minority Equity (30% Stake)", amount: String(p.udbEquity + p.cashGrants), month: String(m0Month) });
      }
      if (p.udbLoan > 0) {
        newLoans.push({
          name: "Taxibee · UDB Women Prosper Asset Loan",
          amount: String(p.udbLoan),
          month: String(m0Month),
          rate: String(p.loanRate * 100),
          term: String(p.loanTenorYears * 12),
          graceMonths: String(p.loanGraceYears * 12),
          principalCadence: "annual",
          drawAtMonthEnd: "yes",
          repayment: "principal",
        });
      }
      if (data.capital.initialFleetCapex > 0 && launchMonth >= 1 && launchMonth <= horizon) {
        investments.push({
          name: `Taxibee · Initial VIP Fleet (${p.initialVans} Vans)`,
          assetClass: "other",
          amount: String(data.capital.initialFleetCapex),
          month: String(m0Month),
          depreciationStart: String(launchMonth),
          life: String(vanLifeMonths),
          replacement: "none",
          moduleScope: "taxipress",
        });
      } else if (data.capital.initialFleetCapex > 0) {
        investments.push({
          name: `Taxibee · Initial VIP Fleet (${p.initialVans} Vans)`,
          assetClass: "other",
          amount: String(data.capital.initialFleetCapex),
          month: String(m0Month),
          life: String(vanLifeMonths),
          replacement: "none",
          moduleScope: "taxipress",
        });
      }
      if (p.appCapexM0 > 0) {
        investments.push({
          name: "Taxibee · App Upgrade & Scheduling Platform",
          assetClass: "infrastructure",
          amount: String(p.appCapexM0),
          month: String(m0Month),
          ...(launchMonth >= 1 && launchMonth <= horizon ? { depreciationStart: String(launchMonth) } : {}),
          life: String(techLifeMonths),
          replacement: "none",
          moduleScope: "taxipress",
        });
      }
    }

    // Expansion Fleet & Annual Tech CapEx (Y2..Y5, purchased at start of each calendar year)
    for (let y = 1; y < p.schedule.length; y++) {
      const cfg = p.schedule[y];
      const purchaseMonth = launchMonth + y * 12;
      if (purchaseMonth < 1 || purchaseMonth > horizon) continue;
      if (cfg.newVans > 0) {
        const vanCost = cfg.newVans * p.unitVanCapex * cfg.costInflation;
        investments.push({
          name: `Taxibee · Y${y + 1} Expansion Fleet (${cfg.newVans} Vans)`,
          assetClass: "other",
          amount: String(vanCost),
          month: String(purchaseMonth),
          life: String(vanLifeMonths),
          replacement: "none",
          moduleScope: "taxipress",
        });
      }
      if (cfg.techCapex > 0) {
        investments.push({
          name: `Taxibee · Y${y + 1} Tech & App CapEx`,
          assetClass: "infrastructure",
          amount: String(cfg.techCapex),
          month: String(purchaseMonth),
          life: String(techLifeMonths),
          replacement: "none",
          moduleScope: "taxipress",
        });
      }
    }

    const streams = [
      { name: "VIP Seat Fare Revenue", method: "schedule", schedule: seatRevSeries, days: arDays, vatRate: "0" },
      { name: "Ancillary Revenue (Parcels, Luggage, Ads)", method: "schedule", schedule: ancRevSeries, days: arDays, vatRate: "0" },
    ];
    const directCosts = [
      { name: "Taxibee · Direct Trip Costs (Fuel, Tolls, Hub)", basis: "schedule", schedule: tripCostSeries, category: "other", stock: "0", inventoryDays: "0", payableDays: apDays, vatRate: "0", moduleScope: "taxipress" },
      { name: "Taxibee · Payment Gateway Fees", basis: "schedule", schedule: gatewayCostSeries, category: "processing", stock: "0", inventoryDays: "0", payableDays: apDays, vatRate: "0", moduleScope: "taxipress" },
    ];
    const staff = [
      {
        name: "Taxibee · VIP Van Drivers (incl. NSSF)",
        department: "Operations",
        roleType: "schedule",
        headcountSeries: driverHeadcountSeries,
        wagesSeries: driverWagesSeries,
        benefitsSeries: driverBenefitsSeries,
        moduleScope: "taxipress",
      },
    ];
    const expenses = [
      { name: "Taxibee · Van Fixed OpEx (Ins, Maint, Wi-Fi, Lic)", category: "other", basis: "schedule", schedule: vanFixedSeries, vatRate: "0", moduleScope: "taxipress" },
      { name: "Taxibee · Corporate Overhead", category: "other", basis: "schedule", schedule: corpOverheadSeries, vatRate: "0", moduleScope: "taxipress" },
      ...(m0InForecast && data.capital.m0Expensed > 0 ? [{
        name: "Taxibee · Pre-Launch Licensing & UDB Appraisal Fee",
        category: "professional",
        basis: "schedule",
        schedule: prelaunchSeries,
        vatRate: "0",
        moduleScope: "taxipress",
      }] : []),
    ];

    return {
      data,
      streams,
      directCosts,
      staff,
      expenses,
      accounts,
      ownedAssets,
      investments,
      existingLoans,
      newLoans,
      contributions,
    };
  }

  function computeFlyExpress(answers = {}) {
    const rawStreams = Array.isArray(answers["channel-taxipress"]) ? answers["channel-taxipress"] : [];
    const activeStreams = rawStreams.filter(row => row && row.enabled !== "no");
    const taxRate = Math.max(0, Math.min(1, num(answers.tax, 30) / 100));
    const start = parseStartYM(answers.start || defaultConfig.launchStart);
    const horizonMonths = 60;
    const months = [];
    let cumCash = 0;
    let prevAR = 0;
    let prevAP = 0;
    let retained = 0;

    // Scoped Fly Express direct costs & operating expenses assigned exclusively to taxipress
    const hasTaxipressScope = row => typeof row?.moduleScope === "string"
      && row.moduleScope.split(",").includes("taxipress") && row.enabled !== "no" && row.roleType !== "disabled";
    const scopedDirect = (answers.directCosts || []).filter(hasTaxipressScope);
    const scopedExpenses = (answers.expenses || []).filter(hasTaxipressScope);
    const scopedStaff = (answers.staff || []).filter(hasTaxipressScope);

    const streamTrackers = activeStreams.map(row => ({
      name: row.name || "Commission stream",
      method: row.method || "orders",
      orders: nonNeg(row.orders, 0),
      orderValue: nonNeg(row.orderValue, 0),
      rate: nonNeg(row.rate, 0) / 100,
      units: nonNeg(row.units, 0),
      price: nonNeg(row.price, 0),
      amount: nonNeg(row.amount, 0),
      transactionValue: nonNeg(row.transactionValue, 0),
      active: nonNeg(row.active, 0),
      newSubscribers: nonNeg(row.newSubscribers, 0),
      churn: nonNeg(row.churn, 0) / 100,
      growth: num(row.growth, 0) / 100,
      days: nonNeg(row.days, 0),
      launchMonth: Math.max(1, Math.round(nonNeg(row.launchMonth, 1))),
    }));

    function simulateFly(opts = {}) {
      const { volumeMult = 1, rateDeltaPct = 0, fareMult = 1 } = opts;
      const monthly = [];
      let cash = 0;
      let arPrev = 0;
      let apPrev = 0;
      let ret = 0;
      const subState = streamTrackers.map(s => s.active);

      for (let i = 0; i < horizonMonths; i++) {
        const m = i + 1;
        const year = start.year + Math.floor((start.month - 1 + i) / 12);
        const calMonth = ((start.month - 1 + i) % 12) + 1;
        const label = formatMonthShort(year, calMonth);

        const byStream = streamTrackers.map((s, idx) => {
          if (m < s.launchMonth) return { name: s.name, method: s.method, bookings: 0, volume: 0, revenue: 0, ar: 0 };
          const elapsed = m - s.launchMonth;
          const scale = Math.pow(Math.max(0, 1 + s.growth), elapsed);
          let bookings = 0;
          let volume = 0;
          let revenue = 0;
          if (s.method === "orders") {
            bookings = s.orders * scale * volumeMult;
            volume = bookings * s.orderValue * fareMult;
            const effRate = Math.max(0, s.rate + rateDeltaPct / 100);
            revenue = volume * effRate;
          } else if (s.method === "units") {
            bookings = s.units * scale * volumeMult;
            revenue = bookings * s.price * fareMult;
          } else if (s.method === "percentage") {
            volume = s.transactionValue * scale * volumeMult * fareMult;
            const effRate = Math.max(0, s.rate + rateDeltaPct / 100);
            revenue = volume * effRate;
          } else if (s.method === "subscription") {
            const joining = s.newSubscribers * scale * volumeMult;
            subState[idx] = subState[idx] * (1 - s.churn) + joining;
            bookings = subState[idx];
            revenue = bookings * s.price * fareMult;
          } else {
            revenue = s.amount * scale * volumeMult * fareMult;
          }
          const ar = revenue * (s.days / 30);
          return { name: s.name, method: s.method, bookings, volume, revenue, ar };
        });

        const totalRevenue = byStream.reduce((acc, r) => acc + r.revenue, 0);
        const totalBookings = byStream.reduce((acc, r) => acc + r.bookings, 0);
        const totalVolume = byStream.reduce((acc, r) => acc + r.volume, 0);

        const cogs = scopedDirect.reduce((acc, row) => {
          if (row.basis === "rate") return acc + totalRevenue * (nonNeg(row.rate, 0) / 100);
          if (row.basis === "fixed") return acc + nonNeg(row.amount, 0) * Math.pow(1 + num(row.growth, 0) / 100, Math.floor(i / 12));
          return acc;
        }, 0);
        const payroll = scopedStaff.reduce((acc, row) => {
          const startM = Math.max(1, Math.round(nonNeg(row.month, 1)));
          const endM = row.endMonth ? Math.round(nonNeg(row.endMonth, 84)) : 84;
          if (m < startM || m > endM) return acc;
          const pay = row.salaryBasis === "annual" ? nonNeg(row.annualSalary, 0) / 12 : nonNeg(row.amount, 0);
          const hc = row.roleType === "single" ? 1 : nonNeg(row.headcount, 0);
          const raised = pay * Math.pow(1 + num(row.growth, 0) / 100, Math.floor((m - startM) / 12));
          return acc + hc * raised * (1 + nonNeg(row.burden, 0) / 100);
        }, 0);
        const expenses = scopedExpenses.reduce((acc, row) => {
          const startM = Math.max(1, Math.round(nonNeg(row.month, 1)));
          const endM = row.endMonth ? Math.round(nonNeg(row.endMonth, 84)) : 84;
          if (m < startM || m > endM) return acc;
          const periods = row.cadence === "monthly" ? (m - startM) : Math.floor((m - startM) / 12);
          return acc + nonNeg(row.amount, 0) * Math.pow(1 + num(row.growth, 0) / 100, periods);
        }, 0);

        const grossProfit = totalRevenue - cogs;
        const opex = payroll + expenses;
        const ebitda = grossProfit - opex;
        const tax = Math.max(0, ebitda * taxRate);
        const pat = ebitda - tax;
        const ar = byStream.reduce((acc, r) => acc + r.ar, 0);
        const ap = 0;
        const deltaNwc = (ar - arPrev) - (ap - apPrev);
        const cfo = pat - deltaNwc;
        cash += cfo;
        ret += pat;
        const totalAssets = cash + ar;
        const totalLiabEq = ap + ret;
        const bsCheck = totalAssets - totalLiabEq;

        monthly.push({
          monthIndex: m,
          yearIndex: Math.floor(i / 12) + 1,
          calendarYear: year,
          label,
          byStream,
          bookings: totalBookings,
          volume: totalVolume,
          totalRevenue,
          cogs,
          grossProfit,
          payroll,
          expenses,
          opex,
          ebitda,
          tax,
          pat,
          ar,
          ap,
          nwc: ar - ap,
          deltaNwc,
          cfo,
          endCash: cash,
          retained: ret,
          totalAssets,
          totalLiabEq,
          bsCheck,
        });
        arPrev = ar;
        apPrev = ap;
      }

      const annual = Array.from({ length: 5 }, (_, y) => {
        const slice = monthly.slice(y * 12, (y + 1) * 12);
        const last = slice[slice.length - 1];
        const sumK = key => slice.reduce((acc, r) => acc + r[key], 0);
        const rev = sumK("totalRevenue");
        const gp = sumK("grossProfit");
        const ebitda = sumK("ebitda");
        const pat = sumK("pat");
        const streamTotals = streamTrackers.map((s, idx) => ({
          name: s.name,
          revenue: slice.reduce((acc, r) => acc + (r.byStream[idx]?.revenue || 0), 0),
          bookings: slice.reduce((acc, r) => acc + (r.byStream[idx]?.bookings || 0), 0),
        }));
        return {
          yearIndex: y + 1,
          calendarYear: start.year + y,
          streamTotals,
          bookings: sumK("bookings"),
          volume: sumK("volume"),
          totalRevenue: rev,
          cogs: sumK("cogs"),
          grossProfit: gp,
          grossMargin: rev > 0 ? gp / rev : 0,
          payroll: sumK("payroll"),
          expenses: sumK("expenses"),
          opex: sumK("opex"),
          ebitda,
          ebitdaMargin: rev > 0 ? ebitda / rev : 0,
          tax: sumK("tax"),
          pat,
          netMargin: rev > 0 ? pat / rev : 0,
          deltaNwc: sumK("deltaNwc"),
          cfo: sumK("cfo"),
          endCash: last.endCash,
          ar: last.ar,
          ap: last.ap,
          retained: last.retained,
          totalAssets: last.totalAssets,
          totalLiabEq: last.totalLiabEq,
          bsCheck: last.bsCheck,
          fcff: ebitda - Math.max(0, ebitda) * taxRate - sumK("deltaNwc"),
        };
      });

      const summarize = horizon => {
        const rows = annual.slice(0, horizon);
        const last = rows[rows.length - 1];
        const sumK = key => rows.reduce((acc, r) => acc + r[key], 0);
        const rev = sumK("totalRevenue");
        const ebitda = sumK("ebitda");
        const pat = sumK("pat");
        const cfs = [0, ...rows.map((r, i) => r.fcff + (i === rows.length - 1 ? (r.ar - r.ap) : 0))];
        return {
          horizon,
          rows,
          totals: {
            bookings: sumK("bookings"),
            volume: sumK("volume"),
            totalRevenue: rev,
            cogs: sumK("cogs"),
            grossProfit: sumK("grossProfit"),
            grossMargin: rev > 0 ? sumK("grossProfit") / rev : 0,
            opex: sumK("opex"),
            ebitda,
            ebitdaMargin: rev > 0 ? ebitda / rev : 0,
            tax: sumK("tax"),
            pat,
            netMargin: rev > 0 ? pat / rev : 0,
            deltaNwc: sumK("deltaNwc"),
            cfo: sumK("cfo"),
            endCash: last.endCash,
            fcff: sumK("fcff"),
          },
          valuation: {
            npv12: npv(0.12, cfs),
            npv18: npv(0.18, cfs),
          },
        };
      };

      return { monthly, annual, model3y: summarize(3), model5y: summarize(5) };
    }

    const base = simulateFly();
    const y1Months = base.monthly.slice(0, 12);
    const sumY1 = key => y1Months.reduce((acc, r) => acc + r[key], 0);
    const y1Totals = {
      bookings: sumY1("bookings"),
      volume: sumY1("volume"),
      totalRevenue: sumY1("totalRevenue"),
      cogs: sumY1("cogs"),
      grossProfit: sumY1("grossProfit"),
      opex: sumY1("opex"),
      ebitda: sumY1("ebitda"),
      tax: sumY1("tax"),
      pat: sumY1("pat"),
      cfo: sumY1("cfo"),
      endCash: y1Months[y1Months.length - 1]?.endCash ?? 0,
    };

    const stressScenarios = [
      { key: "base", name: "Base Case (Fly Express Plan)", volumeMult: 1, rateDeltaPct: 0, fareMult: 1 },
      { key: "vol-down", name: "Scenario A: Booking Volume Drop (-25%)", volumeMult: 0.75, rateDeltaPct: 0, fareMult: 1 },
      { key: "rate-cut", name: "Scenario B: Commission Rate Compression (-1.0 pp)", volumeMult: 1, rateDeltaPct: -1, fareMult: 1 },
      { key: "fare-drop", name: "Scenario C: Average Ticket Fare Drop (-15%)", volumeMult: 1, rateDeltaPct: 0, fareMult: 0.85 },
      { key: "severe", name: "Scenario D: Severe Shock (-35% Vol, -1.0 pp Rate)", volumeMult: 0.65, rateDeltaPct: -1, fareMult: 1 },
    ].map(sc => {
      const res = simulateFly(sc);
      const y1 = res.annual[0];
      const t5 = res.model5y.totals;
      return {
        ...sc,
        y1Revenue: y1.totalRevenue,
        y1Ebitda: y1.ebitda,
        y5Revenue: t5.totalRevenue,
        y5Ebitda: t5.ebitda,
        y5EndCash: t5.endCash,
        verdict: t5.ebitda >= 0 ? "CASH-POSITIVE · Zero Debt Risk" : "OPEX REVIEW · Trim Scoped Costs",
      };
    });

    return {
      start,
      taxRate,
      rawStreams,
      activeStreams,
      streamTrackers,
      y1Months,
      y1Totals,
      model3y: base.model3y,
      model5y: base.model5y,
      stressScenarios,
    };
  }

  function exportCsvRows(answers = {}) {
    if (answers.taxibeeMode === "fly-express") {
      const fly = computeFlyExpress(answers);
      return [
        ["TAXIPRESS · FLY EXPRESS (PARTNER COMMISSION MODEL) — EXPORT"],
        ["Start", `${fly.start.year}-${String(fly.start.month).padStart(2, "0")}`, "Currency", "UGX", "Active Streams", fly.activeStreams.length],
        [],
        ["1. 5-YEAR FLY EXPRESS SUMMARY (UGX)", ...fly.model5y.rows.map(r => `Year ${r.yearIndex} (${r.calendarYear})`), "5-Year Total / End"],
        ["Partner Bookings / Units", ...fly.model5y.rows.map(r => Math.round(r.bookings)), Math.round(fly.model5y.totals.bookings)],
        ["Gross Booking Value (UGX)", ...fly.model5y.rows.map(r => Math.round(r.volume)), Math.round(fly.model5y.totals.volume)],
        ["Peebee Commission & Fee Revenue", ...fly.model5y.rows.map(r => Math.round(r.totalRevenue)), Math.round(fly.model5y.totals.totalRevenue)],
        ["Scoped Direct Costs (COGS)", ...fly.model5y.rows.map(r => Math.round(r.cogs)), Math.round(fly.model5y.totals.cogs)],
        ["Scoped Operating Expenses", ...fly.model5y.rows.map(r => Math.round(r.opex)), Math.round(fly.model5y.totals.opex)],
        ["EBITDA", ...fly.model5y.rows.map(r => Math.round(r.ebitda)), Math.round(fly.model5y.totals.ebitda)],
        ["Net Profit After Tax", ...fly.model5y.rows.map(r => Math.round(r.pat)), Math.round(fly.model5y.totals.pat)],
        ["Cumulative Cash Contribution", ...fly.model5y.rows.map(r => Math.round(r.endCash)), Math.round(fly.model5y.totals.endCash)],
        [],
        ["2. YEAR 1 MONTHLY RAMP (UGX)", ...fly.y1Months.map(m => m.label), "FY Total"],
        ["Total Revenue", ...fly.y1Months.map(m => Math.round(m.totalRevenue)), Math.round(fly.y1Totals.totalRevenue)],
        ["EBITDA", ...fly.y1Months.map(m => Math.round(m.ebitda)), Math.round(fly.y1Totals.ebitda)],
        ["Cumulative Cash", ...fly.y1Months.map(m => Math.round(m.endCash)), Math.round(fly.y1Totals.endCash)],
      ];
    }
    const model = compute(answers);
    const p = model.inputs;
    const m = value => Number((value / 1e6).toFixed(2));
    const pct = value => value == null ? "" : `${(value * 100).toFixed(2)}%`;
    const rows = [
      ["TAXIBEE (PEEBEE GROUP LTD) — FINANCIAL MODEL EXPORT"],
      ["Launch", p.raw.taxibeeConfig[0].launchStart, "Currency", "UGX", "Active Consolidated Mode", p.mode === "vip-fleet" ? "Taxibee (VIP Fleet)" : "TaxiPress (Fly Express)"],
      [],
      ["1. EXECUTIVE COMPARISON", "3-Year (2027-2029)", "5-Year (2027-2031)"],
      ["Ending Active VIP Fleet (Vans)", model.model3y.totals.endingVans, model.model5y.totals.endingVans],
      ["Cumulative Total Revenue (UGX)", Math.round(model.model3y.totals.totalRevenue), Math.round(model.model5y.totals.totalRevenue)],
      ["Cumulative EBITDA (UGX)", Math.round(model.model3y.totals.ebitda), Math.round(model.model5y.totals.ebitda)],
      ["Cumulative Net Profit After Tax (UGX)", Math.round(model.model3y.totals.pat), Math.round(model.model5y.totals.pat)],
      ["Ending Cash Balance (UGX)", Math.round(model.model3y.totals.endCash), Math.round(model.model5y.totals.endCash)],
      ["Remaining UDB Debt Balance (UGX)", Math.round(model.model3y.totals.debt), Math.round(model.model5y.totals.debt)],
      ["Minimum Annual DSCR (x)", model.model3y.totals.minDscr?.toFixed(2) ?? "", model.model5y.totals.minDscr?.toFixed(2) ?? ""],
      [`Project NPV @ ${(p.udbDiscountRate * 100).toFixed(1)}% (UGX)`, Math.round(model.model3y.valuation.projectNpvUdb), Math.round(model.model5y.valuation.projectNpvUdb)],
      ["Project IRR (%)", pct(model.model3y.valuation.projectIrr), pct(model.model5y.valuation.projectIrr)],
      [`UDB ${(p.udbEquityStake * 100).toFixed(0)}% Equity Value @ Y5 (${p.exitEbitdaMultiple}x EBITDA)`, "N/A", Math.round(model.model5y.valuation.udbStakeValueY5)],
      ["UDB MOIC (x)", "N/A", model.model5y.valuation.udbMoicY5?.toFixed(2) ?? ""],
      [],
      ["2. 5-YEAR INTEGRATED MODEL (UGX)", ...model.model5y.rows.map(r => `Year ${r.yearIndex} (${r.calendarYear})`), "5-Year Total / End"],
      ["Active VIP Van Fleet", ...model.model5y.rows.map(r => r.vans), model.model5y.totals.endingVans],
      ["Seat Fare Revenue", ...model.model5y.rows.map(r => Math.round(r.seatRevenue)), Math.round(model.model5y.totals.seatRevenue)],
      ["Ancillary Revenue", ...model.model5y.rows.map(r => Math.round(r.ancillaryRevenue)), Math.round(model.model5y.totals.ancillaryRevenue)],
      ["Total Revenue", ...model.model5y.rows.map(r => Math.round(r.totalRevenue)), Math.round(model.model5y.totals.totalRevenue)],
      ["Direct Costs / COGS", ...model.model5y.rows.map(r => Math.round(r.cogs)), Math.round(model.model5y.totals.cogs)],
      ["Gross Profit", ...model.model5y.rows.map(r => Math.round(r.grossProfit)), Math.round(model.model5y.totals.grossProfit)],
      ["Fleet & Driver OpEx", ...model.model5y.rows.map(r => Math.round(r.fleetOpex)), Math.round(model.model5y.totals.fleetOpex)],
      ["Corporate OpEx", ...model.model5y.rows.map(r => Math.round(r.corpOpex)), Math.round(model.model5y.totals.corpOpex)],
      ["EBITDA", ...model.model5y.rows.map(r => Math.round(r.ebitda)), Math.round(model.model5y.totals.ebitda)],
      ["Depreciation & Amortization", ...model.model5y.rows.map(r => Math.round(r.da)), Math.round(model.model5y.totals.da)],
      ["Finance Costs (Interest)", ...model.model5y.rows.map(r => Math.round(r.interest)), Math.round(model.model5y.totals.interest)],
      ["Corporate Income Tax", ...model.model5y.rows.map(r => Math.round(r.tax)), Math.round(model.model5y.totals.tax)],
      ["Net Profit After Tax (PAT)", ...model.model5y.rows.map(r => Math.round(r.pat)), Math.round(model.model5y.totals.pat)],
      ["Operating Cash Flow (CFO)", ...model.model5y.rows.map(r => Math.round(r.cfo)), Math.round(model.model5y.totals.cfo)],
      ["Capital Expenditures", ...model.model5y.rows.map(r => Math.round(r.totalCapex)), Math.round(model.model5y.totals.totalCapex)],
      ["Principal Repayment", ...model.model5y.rows.map(r => Math.round(r.principal)), Math.round(model.model5y.totals.principal)],
      ["Ending Cash Balance", ...model.model5y.rows.map(r => Math.round(r.endCash)), Math.round(model.model5y.totals.endCash)],
      ["Ending UDB Debt", ...model.model5y.rows.map(r => Math.round(r.debt)), Math.round(model.model5y.totals.debt)],
      ["DSCR (x)", ...model.model5y.rows.map(r => r.dscr?.toFixed(2) ?? ""), model.model5y.totals.minDscr?.toFixed(2) ?? ""],
      [],
      ["3. YEAR 1 MONTHLY RAMP (UGX M)", ...model.ramp.months.map(r => r.label), "FY Total / Avg"],
      ["Load Factor (%)", ...model.ramp.months.map(r => pct(r.loadFactor)), pct(model.ramp.totals.loadFactor)],
      ["Total Revenue (M)", ...model.ramp.months.map(r => m(r.totalRevenue)), m(model.ramp.totals.totalRevenue)],
      ["EBITDA (M)", ...model.ramp.months.map(r => m(r.ebitda)), m(model.ramp.totals.ebitda)],
      ["Monthly Net Cash Flow (M)", ...model.ramp.months.map(r => m(r.netCashFlow)), m(model.ramp.totals.netCashFlow)],
      ["Ending Cash Balance (M)", ...model.ramp.months.map(r => m(r.endingCash)), m(model.ramp.totals.endingCash)],
      [],
      ["4. STRESS TESTS & CAPEX GATE", "Y1 EBITDA (M)", "Y1 DSCR", "Y2 Gated DSCR", "Y5 Fleet", "Gated Min Cash (M)", "Gated Y5 Cash (M)", "Unconstrained Min Cash (M)", "Credit Verdict"],
      ...model.stressResults.map(s => [
        s.name, m(s.y1.ebitda), s.y1.dscr?.toFixed(2) ?? "", s.y2GatedDscr?.toFixed(2) ?? "",
        s.y5Fleet, m(s.gatedMinCash), m(s.gatedY5Cash), m(s.unconstrainedMinCash), s.creditVerdict,
      ]),
    ];
    return rows;
  }

  globalThis.TaxibeeModel = {
    defaultConfig,
    defaultRamp,
    defaultSchedule,
    defaultStress,
    defaultState,
    readState,
    compute,
    computeFlyExpress,
    consolidatedOverlay,
    exportCsvRows,
    npv,
    irr,
  };
})();
