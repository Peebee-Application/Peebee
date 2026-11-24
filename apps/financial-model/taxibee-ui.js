(() => {
  const { compute, computeFlyExpress, defaultState, readState, exportCsvRows } = globalThis.TaxibeeModel;

  const ugxFmt = new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 });
  const dec1Fmt = new Intl.NumberFormat("en-UG", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dec2Fmt = new Intl.NumberFormat("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct1Fmt = new Intl.NumberFormat("en-UG", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct2Fmt = new Intl.NumberFormat("en-UG", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtUgx = value => {
    if (value == null || !Number.isFinite(value)) return "—";
    const rounded = Math.round(value);
    return ugxFmt.format(rounded === 0 ? 0 : rounded);
  };
  const fmtM = value => {
    if (value == null || !Number.isFinite(value)) return "—";
    const scaled = Math.abs(value) < 5e4 ? 0 : value / 1e6;
    return `${dec1Fmt.format(scaled)}M`;
  };
  const fmtMNum = value => {
    if (value == null || !Number.isFinite(value)) return "—";
    const scaled = Math.abs(value) < 5e4 ? 0 : value / 1e6;
    return dec1Fmt.format(scaled);
  };
  const fmtX = value => value == null || !Number.isFinite(value) ? "—" : `${dec2Fmt.format(Math.abs(value) < 0.005 ? 0 : value)}x`;
  const fmtPct1 = value => value == null || !Number.isFinite(value) ? "—" : pct1Fmt.format(Math.abs(value) < 0.0005 ? 0 : value);
  const fmtPct2 = value => value == null || !Number.isFinite(value) ? "—" : pct2Fmt.format(Math.abs(value) < 0.00005 ? 0 : value);

  const views = [
    ["taxibee-dashboard", "Executive Dashboard", "3-Year vs 5-Year financial dashboard, headline KPIs, and 5-year scaling performance."],
    ["taxibee-assumptions", "Assumptions & Capital", "Editable capital structure, loan terms, unit economics, 5-year fleet schedule, and live per-van breakeven check."],
    ["taxibee-ramp", "Y1 Monthly Ramp", "Month-by-month Year 1 launch ramp, operating and cash-flow breakeven, and liquidity trough tracker."],
    ["taxibee-3y", "3-Year Model", "Version 1 integrated P&L, cash flow, balance sheet, DSCR, and conservative book-value DCF (2027–2029)."],
    ["taxibee-5y", "5-Year Model", "Version 2 integrated P&L, cash flow, balance sheet, DSCR, DCF, and Year 5 equity valuation (2027–2031)."],
    ["taxibee-debt", "Loan & DSCR", "Simple fleet loan schedule with manually adjustable interest rate, tenor, grace period, and DSCR coverage."],
    ["taxibee-stress", "Stress Tests & Gate", "Load, fare, and cost shocks comparing unconstrained cash flows against the UGX 100M CapEx gate."],
  ];

  const viewSet = new Set(views.map(([id]) => id));
  const viewById = new Map(views.map(entry => [entry[0], entry]));

  function renderTable(escape, caption, columns, rows) {
    const renderRow = row => {
      if (row.section) {
        return `<tr class="taxibee-section-row"><th scope="row" colspan="${columns.length + 1}">${escape(row.section)}</th></tr>`;
      }
      const cls = row.style === "footer" ? "total" : row.style === "total" || row.style === "detail" ? row.style : "";
      const cells = row.cells.map(cell => {
        if (cell && typeof cell === "object" && "html" in cell) return `<td${cell.cls ? ` class="${cell.cls}"` : ""}>${cell.html}</td>`;
        return `<td>${escape(cell)}</td>`;
      }).join("");
      return `<tr${cls ? ` class="${cls}"` : ""}><th scope="row">${escape(row.label)}</th>${cells}</tr>`;
    };
    const body = rows.filter(r => r.style !== "footer").map(renderRow).join("");
    const foot = rows.filter(r => r.style === "footer").map(renderRow).join("");
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escape(caption)}">
      <table aria-label="${escape(caption)}">
        <thead><tr><th scope="col">${escape(caption)}</th>${columns.map(col => `<th scope="col">${escape(col)}</th>`).join("")}</tr></thead>
        <tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}
      </table>
    </div>`;
  }

  function modeBanner(escape, model, answers, guestMode) {
    const mode = answers.taxibeeMode === "fly-express" ? "fly-express" : "vip-fleet";
    const channel = (answers.channels || []).find(c => c.key === "taxipress");
    const channelOn = !channel || channel.enabled !== "no";
    const statusCopy = !channelOn
      ? "Taxibee channel is currently switched Off in Dashboard → Forecast modules."
      : mode === "vip-fleet"
        ? "VIP Fleet is active and rolling fleet revenue, direct costs, driver payroll, van OpEx, CapEx, and fleet loan schedules into Peebee’s consolidated statements."
        : "TaxiPress (Fly Express) partner commission lines are active in Peebee’s consolidated statements. Switch to VIP Fleet to roll this owned-fleet model into consolidated reports.";
    return `<section class="panel taxibee-mode-bar" aria-label="Taxibee operating model switch">
      <div class="taxibee-mode-copy">
        <strong>Consolidated Peebee Mode · Taxibee (formerly TaxiPress)</strong>
        <p class="muted">${escape(statusCopy)}</p>
      </div>
      <div class="taxibee-mode-controls">
        <div class="segmented" role="group" aria-label="Taxibee business model mode">
          <button type="button" data-taxibee-mode="vip-fleet" aria-pressed="${mode === "vip-fleet"}" ${guestMode ? "disabled" : ""}>Taxibee · VIP Fleet</button>
          <button type="button" data-taxibee-mode="fly-express" aria-pressed="${mode === "fly-express"}" ${guestMode ? "disabled" : ""}>TaxiPress · Fly Express</button>
        </div>
        ${!guestMode ? '<button type="button" class="button secondary small" id="taxibee-export-csv">Export Taxibee CSV ↓</button>' : ""}
      </div>
    </section>`;
  }

  function renderDashboardBars(escape, rows) {
    const maxRev = Math.max(1, ...rows.map(r => r.totalRevenue));
    const maxCashDebt = Math.max(1, ...rows.map(r => Math.max(Math.abs(r.endCash), r.debt)));
    return `<div class="taxibee-chart-grid">
      <section class="panel">
        <h2>5-Year Revenue &amp; EBITDA (UGX Millions)</h2>
        <div class="taxibee-bar-list">
          ${rows.map(r => `<div class="taxibee-bar-group">
            <div class="taxibee-bar-head"><span>${r.calendarYear} (${r.vans} vans)</span><strong>Rev ${fmtM(r.totalRevenue)} · EBITDA ${fmtM(r.ebitda)} (${fmtPct1(r.ebitdaMargin)})</strong></div>
            <div class="taxibee-bar-tracks">
              <div class="track" title="Revenue ${fmtM(r.totalRevenue)}"><span class="bar" style="width:${(100 * r.totalRevenue / maxRev).toFixed(1)}%"></span></div>
              <div class="track" title="EBITDA ${fmtM(r.ebitda)}"><span class="bar taxibee-bar-ink" style="width:${Math.max(0, 100 * r.ebitda / maxRev).toFixed(1)}%"></span></div>
            </div>
          </div>`).join("")}
        </div>
        <p class="muted taxibee-legend"><span><i class="taxibee-swatch-gold"></i>Total Revenue</span><span><i class="taxibee-swatch-ink"></i>EBITDA</span></p>
      </section>
      <section class="panel">
        <h2>Ending Cash vs Remaining Fleet Loan (UGX Millions)</h2>
        <div class="taxibee-bar-list">
          ${rows.map(r => `<div class="taxibee-bar-group">
            <div class="taxibee-bar-head"><span>${r.calendarYear} · DSCR ${fmtX(r.dscr)}</span><strong>Cash ${fmtM(r.endCash)} · Loan ${fmtM(r.debt)}</strong></div>
            <div class="taxibee-bar-tracks">
              <div class="track" title="Ending Cash ${fmtM(r.endCash)}"><span class="bar" style="width:${Math.max(0, 100 * r.endCash / maxCashDebt).toFixed(1)}%"></span></div>
              <div class="track" title="Loan Balance ${fmtM(r.debt)}"><span class="bar taxibee-bar-muted" style="width:${Math.max(0, 100 * r.debt / maxCashDebt).toFixed(1)}%"></span></div>
            </div>
          </div>`).join("")}
        </div>
        <p class="muted taxibee-legend"><span><i class="taxibee-swatch-gold"></i>Ending Cash</span><span><i class="taxibee-swatch-muted"></i>Remaining Loan Balance</span></p>
      </section>
    </div>`;
  }

  function renderDashboard(escape, model) {
    const p = model.inputs;
    const m3 = model.model3y;
    const m5 = model.model5y;
    const y1Margin = fmtPct1(m5.rows[0].ebitdaMargin);
    const y5Margin = fmtPct1(m5.rows[4].ebitdaMargin);
    const kpis = [
      ["Total Launch Financing (M0)", `UGX ${fmtM(model.capital.totalSources)}`, `Equity ${fmtM(p.udbEquity)} + Loan ${fmtM(p.udbLoan)} @ ${fmtPct1(p.loanRate)} p.a.`],
      ["5-Year Cumulative Revenue", `UGX ${fmtM(m5.totals.totalRevenue)}`, `Fleet scales ${p.initialVans} → ${m5.totals.endingVans} VIP vans`],
      ["5-Year Ending Cash", `UGX ${fmtM(m5.totals.endCash)}`, `Opening buffer ${fmtM(model.capital.m0CashBuffer)} · Y1 trough ${fmtM(model.ramp.troughCash)}`],
      ["Minimum Annual DSCR", fmtX(m5.totals.minDscr), `Target covenant ${fmtX(p.minDscrCovenant)} · 5Y IRR ${fmtPct1(m5.valuation.projectIrr)}`],
    ];
    const compareRows = [
      { label: "Ending Active VIP Fleet (Vans)", cells: [String(m3.totals.endingVans), String(m5.totals.endingVans), `Self-funded organic scale from ${p.initialVans}-van pilot`] },
      { label: "Cumulative Total Revenue (UGX)", cells: [fmtUgx(m3.totals.totalRevenue), fmtUgx(m5.totals.totalRevenue), "Kampala-Entebbe core + regional expansion Y4–Y5"], style: "total" },
      { label: "Cumulative EBITDA (UGX)", cells: [fmtUgx(m3.totals.ebitda), fmtUgx(m5.totals.ebitda), `Expands from ${y1Margin} (Y1) to ${y5Margin} (Y5) margin`], style: "total" },
      { label: "Cumulative Net Profit After Tax (UGX)", cells: [fmtUgx(m3.totals.pat), fmtUgx(m5.totals.pat), `After ${fmtPct1(p.citRate)} statutory corporate income tax`] },
      { label: "Ending Cash Balance (UGX)", cells: [fmtUgx(m3.totals.endCash), fmtUgx(m5.totals.endCash), `Opening M0 buffer: UGX ${fmtM(model.capital.m0CashBuffer)}; Trough: UGX ${fmtM(model.ramp.troughCash)}`] },
      { label: "Remaining Fleet Loan Balance (UGX)", cells: [fmtUgx(m3.totals.debt), fmtUgx(m5.totals.debt), `Initial UGX ${fmtM(p.udbLoan)} @ ${fmtPct1(p.loanRate)}; retired in Year ${p.loanTenorYears} (${p.start.year + p.loanTenorYears - 1})`] },
      { label: "Minimum Annual DSCR (x)", cells: [fmtX(m3.totals.minDscr), fmtX(m5.totals.minDscr), `Meets minimum ${fmtX(p.minDscrCovenant)} target every year`], style: "total" },
      { label: `Project NPV @ ${fmtPct1(p.udbDiscountRate)} Discount Rate (UGX)`, cells: [fmtUgx(m3.valuation.projectNpvUdb), fmtUgx(m5.valuation.projectNpvUdb), "Conservative book terminal value (no exit multiple)"] },
      { label: "Project IRR (%)", cells: [fmtPct1(m3.valuation.projectIrr), fmtPct1(m5.valuation.projectIrr), "Strong capital efficiency on asset-backed fleet"] },
      { label: `Investor ${fmtPct1(p.udbEquityStake)} Equity Value @ Y5 (${p.exitEbitdaMultiple.toFixed(1)}x EBITDA)`, cells: ["N/A (Hold)", fmtUgx(m5.valuation.udbStakeValueY5), `${dec1Fmt.format(m5.valuation.udbMoicY5 ?? 0)}x MOIC on UGX ${fmtM(p.udbEquity)} equity`], style: "footer" },
    ];
    const perfRows = m5.rows.map(r => ({
      label: String(r.calendarYear),
      cells: [String(r.vans), fmtMNum(r.totalRevenue), fmtMNum(r.ebitda), fmtMNum(r.pat), fmtMNum(r.endCash), fmtMNum(r.debt), fmtX(r.dscr)],
    }));
    return `<div class="metrics">
        ${kpis.map(([label, value, sub]) => `<div class="panel metric">
          <span>${escape(label)}</span>
          <div class="metric-value"><strong>${escape(value)}</strong></div>
          <small>${escape(sub)}</small>
        </div>`).join("")}
      </div>
      <section class="panel">
        <h2>1. Headline Comparison: Version 1 (3-Year) vs Version 2 (5-Year)</h2>
        ${renderTable(escape, "Key Performance Metric", [
          `Version 1: 3-Year (${p.start.year}–${p.start.year + 2})`,
          `Version 2: 5-Year (${p.start.year}–${p.start.year + 4})`,
          "Benchmark / Notes",
        ], compareRows)}
      </section>
      <section class="panel">
        <h2>2. 5-Year Performance Summary Table (UGX Millions)</h2>
        ${renderTable(escape, "Year", ["Vans", "Revenue (M)", "EBITDA (M)", "Net Profit (M)", "Ending Cash (M)", "Loan Balance (M)", "DSCR (x)"], perfRows)}
      </section>
      ${renderDashboardBars(escape, m5.rows)}`;
  }

  function renderAssumptions(escape, model, answers, guestMode) {
    const state = readState(answers);
    const cfg = state.taxibeeConfig[0];
    const p = model.inputs;
    const ue = model.unitEconomics;
    const ro = guestMode ? "disabled" : "";
    const inputCell = (key, value, unit, note, type = "number", step = "any") => ({
      label: "",
      input: `<div class="field-box taxibee-input-box"><input type="${type}" step="${step}" data-tb-config="${escape(key)}" value="${escape(value)}" ${ro}>${unit ? `<span>${escape(unit)}</span>` : ""}</div>`,
      note,
    });
    const configRow = (label, key, unit, note, type = "number", step = "any") => ({
      label,
      cells: [
        { html: inputCell(key, cfg[key], unit, note, type, step).input, cls: "taxibee-input-cell" },
        unit,
        note,
      ],
    });
    const calcRow = (label, value, unit, note, style = "total") => ({
      label,
      cells: [value, unit, note],
      style,
    });

    const sec1 = [
      configRow("Launch Start Month", "launchStart", "YYYY-MM", "Month 1 of Year 1 ramp (M0 financing occurs the prior month)", "month"),
      configRow("Fleet Asset Acquisition Loan", "udbLoan", "UGX", "Simple term loan used for fleet acquisition"),
      configRow("Investor Equity Investment", "udbEquity", "UGX", "Equity contribution covering fleet match & working capital"),
      configRow("Investor Equity Stake", "udbEquityStakePct", "%", "Ownership share for Y5 exit equity valuation and MOIC"),
      configRow("Cash Grants (Conservative Base)", "cashGrants", "UGX", "Optional non-dilutive grant funding (default UGX 0)"),
      calcRow("Total Sources of Capital (M0)", fmtUgx(model.capital.totalSources), "UGX", "Total launch financing (Loan + Equity + Grants)"),
      calcRow(`Initial Fleet CapEx (${p.initialVans} VIP Vans @ ${fmtM(p.unitVanCapex)})`, fmtUgx(model.capital.initialFleetCapex), "UGX", "High-roof Hiace + VIP refit + registration & stamp duty", "detail"),
      configRow("App Upgrade CapEx (Scheduling & Pricing)", "appCapexM0", "UGX", "Fixed departure timetable, dynamic pricing, IP registration"),
      configRow("Pre-Launch Incorporation & Licensing (Expensed M0)", "prelaunchExpense", "UGX", "URSB, URA, PDPO, KCCA, MoWT s.70A app auth, launch marketing"),
      calcRow(`Upfront Loan Appraisal Fee (${p.appraisalFeeRate * 100}% of Loan)`, fmtUgx(model.capital.appraisalFee), "UGX", "Upfront loan fee expensed at M0 (set to 0% if none)", "detail"),
      calcRow("Opening Working Capital Cash Buffer (M0)", fmtUgx(model.capital.m0CashBuffer), "UGX", `Absorbs Y1 launch trough (UGX ${fmtM(model.ramp.troughCash)} min in ${model.ramp.troughMonth})`, "footer"),
    ];

    const sec2 = [
      configRow("Initial Fleet Size (Year 1 Pilot)", "initialVans", "Vans", "Kampala-Entebbe VIP shuttle launch route", "number", "1"),
      configRow("Unit CapEx per Refitted 13-Seat VIP Van", "unitVanCapex", "UGX", "2018–2020 Hiace (140M) + 15.5M refit + transfer/reg/duty"),
      configRow("Loan Annual Interest Rate", "loanRatePct", "% p.a.", "Manually adjustable annual interest rate", "number", "0.25"),
      configRow("Loan Total Tenor", "loanTenorYears", "Years", "Total repayment period in years", "number", "1"),
      configRow("Principal Grace Period", "loanGraceYears", "Years", "Interest-only years before principal amortization starts (0 for none)", "number", "1"),
      configRow("Loan Appraisal Fee Rate", "appraisalFeePct", "%", "Upfront fee as % of loan principal (set to 0 if not applicable)", "number", "0.1"),
      configRow("Minimum DSCR Target", "minDscrCovenant", "x", "Target Debt Service Coverage Ratio benchmark", "number", "0.1"),
      configRow("Van Forced-Sale Valuation Haircut", "forcedSalePct", "%", "Estimated forced-sale value % of financed vans"),
      calcRow("Vans Forced-Sale Collateral Value", fmtUgx(model.collateral.forcedSaleValue), "UGX", `Estimated asset value of ${p.initialVans} vans`),
      calcRow("Van-Only Collateral Coverage of Loan", fmtPct1(model.collateral.collateralCoverage), "%", "Asset coverage ratio against loan principal"),
      configRow("Corporate Income Tax Rate (Uganda URA)", "citRatePct", "%", "Statutory CIT; passenger fares remain VAT-exempt"),
      configRow("Project Discount Rate (WACC)", "udbDiscountRatePct", "%", "Primary DCF appraisal discount rate"),
      configRow("Equity Hurdle Discount Rate", "equityHurdleRatePct", "%", "Secondary equity hurdle benchmark"),
      configRow("Van Depreciation Useful Life (Straight-Line)", "vanLifeYears", "Years", "Book depreciation life for Hiace VIP fleet", "number", "1"),
      configRow("App / Tech Amortization Life (Straight-Line)", "techLifeYears", "Years", "Software & telematics capitalization life", "number", "1"),
      configRow("Year 5 Exit EBITDA Multiple", "exitEbitdaMultiple", "x", "Conservative 4.0x EBITDA multiple for Y5 equity valuation"),
      configRow("CapEx-Gating Minimum Cash Buffer", "cashGateFloor", "UGX", "Minimum cash reserve rule triggering CapEx gate under stress"),
    ];

    const sec3 = [
      configRow("Seats per VIP Van", "seatsPerVan", "Seats", "Refitted from 18-seater high-roof to 13 VIP seats", "number", "1"),
      configRow("Trips per Van per Operating Day", "tripsPerDay", "Trips/day", "3 round-trips daily on Kampala-Entebbe (~35 km)"),
      configRow("Operating Days per Month", "operatingDaysPerMonth", "Days/mo", "6 operating days/week (4 maintenance days/mo)"),
      configRow("Year 1 Base Seat Fare", "y1SeatFare", "UGX", "Dynamic range UGX 15,000–20,000; VAT-exempt"),
      configRow("Fuel Cost per Trip", "fuelPerTrip", "UGX", "Kampala-Entebbe ~35 km diesel/petrol cost"),
      configRow("Expressway Toll per Trip", "tollPerTrip", "UGX", "Entebbe-Kampala Expressway toll"),
      configRow("Hub / Stage Parking Fee per Trip", "hubFeePerTrip", "UGX", "Terminal / stage marshaling fee"),
      calcRow("Total Direct Cost per Trip", fmtUgx(ue.directCostPerTrip), "UGX", "Sum of fuel + toll + hub fee"),
      configRow("Mobile Money / Payment Gateway Fee", "gatewayFeePct", "% of Rev", "1.5% collection fee on gross receipts"),
      configRow("Drivers per Van (Shift Coverage)", "driversPerVan", "Drivers", "6 employee drivers for 5 vans (rest rotation)"),
      configRow("Gross Monthly Salary per Driver", "driverSalaryMonthly", "UGX", "Employee driver pay (fixed + performance)"),
      configRow("Employer NSSF Contribution Rate", "nssfRatePct", "%", "Statutory 10% employer NSSF contribution"),
      calcRow("Monthly Driver Payroll Cost per Van (incl. NSSF)", fmtUgx(ue.driverPayrollPerVan), "UGX", "Fully loaded employee driver cost per van"),
      configRow("Monthly Insurance per Van", "insurancePerVan", "UGX", "Comprehensive PSV commercial cover"),
      configRow("Monthly Maintenance & Tyres per Van", "maintenancePerVan", "UGX", "Preventive service & wear-and-tear reserve"),
      configRow("Monthly Wi-Fi, Cleaning & Branding per Van", "amenitiesPerVan", "UGX", "VIP cabin amenities & daily sanitization"),
      configRow("Monthly Licences & Inspections per Van", "licencesPerVan", "UGX", "PSV operator licence, inspection & advance tax"),
      calcRow("Total Monthly Van Fixed OpEx (excl. Driver)", fmtUgx(ue.vanFixedOpexPerVan), "UGX", "Insurance + Maintenance + Wi-Fi/Clean + Licences"),
      configRow("Year 1 Monthly Corporate Overhead (Total)", "y1CorpOverheadMonthly", "UGX/mo", "Office staff+NSSF (13.2M), Mktg (6M), Rent (3.5M), Cloud (2.5M), Legal (1.5M)"),
      configRow("Accounts Receivable (% of Annual Revenue)", "arPctAnnualRev", "%", "B2B corporate / hotel billing receivables"),
      configRow("Accounts Payable (% of Annual COGS + OpEx)", "apPctAnnualCosts", "%", "Supplier & payroll accrual payables"),
    ];

    const sec4 = [
      calcRow("Max Monthly Seat Revenue per Van (100% Load)", fmtUgx(ue.maxMonthlySeatRev), "UGX", `${p.seatsPerVan} seats × ${p.tripsPerDay} trips × ${p.operatingDaysPerMonth} days × UGX ${fmtUgx(p.y1SeatFare)}`, "detail"),
      calcRow(`Monthly Direct Trip Costs per Van (${ue.tripsPerMonth} Trips)`, fmtUgx(ue.monthlyDirectTripCosts), "UGX", "Fuel + Tolls + Hub Fees", "detail"),
      calcRow("Total Monthly Van Operating Cost (before Gateway)", fmtUgx(ue.totalMonthlyVanOpCostBeforeGw), "UGX", "Trip costs + Driver (+NSSF) + Van Fixed OpEx", "total"),
      calcRow("Van-Level Breakeven Load Factor (%)", fmtPct1(ue.breakevenLoadFactor), "%", "Load needed for a van to cover all direct & van-fixed costs (net of gateway)", "total"),
      calcRow("Monthly Seat Revenue per Van @ 75% Load", fmtUgx(ue.seatRevAt75), "UGX", "Steady-state Kampala-Entebbe target load", "detail"),
      calcRow("Monthly Van Net Contribution @ 75% Load", fmtUgx(ue.netContributionAt75), "UGX", "Cash contribution per van toward corporate overhead & debt", "footer"),
    ];

    const schedCols = [...p.schedule.map(s => `Year ${s.yearIndex} (${s.calendarYear})`), "Notes"];
    const schedInput = (i, field, val, step = "any") =>
      `<div class="field-box taxibee-input-box compact"><input type="number" step="${step}" data-tb-sched="${i}" data-tb-field="${field}" value="${escape(val)}" ${ro}></div>`;
    const schedRows = [
      { label: "Active Fleet Size (Vans)", cells: [...p.schedule.map(s => String(s.activeVans)), "Organically self-funded after Y1"], style: "total" },
      { label: "New Vans Purchased (Start of Year)", cells: [
        "0 (M0)",
        ...state.taxibeeSchedule.slice(1).map((row, idx) => ({ html: schedInput(idx + 1, "newVans", row.newVans, "1"), cls: "taxibee-input-cell" })),
        `Initial ${p.initialVans} vans acquired at M0`,
      ] },
      { label: "Average Annual Load Factor (%)", cells: [
        fmtPct1(p.y1AvgLoad),
        ...state.taxibeeSchedule.slice(1).map((row, idx) => ({ html: schedInput(idx + 1, "load", row.load, "0.1"), cls: "taxibee-input-cell" })),
        "Y1 linked dynamically to Monthly Ramp",
      ] },
      { label: "Average Seat Fare (UGX)", cells: [
        fmtUgx(p.y1SeatFare),
        ...state.taxibeeSchedule.slice(1).map((row, idx) => ({ html: schedInput(idx + 1, "fare", row.fare, "100"), cls: "taxibee-input-cell" })),
        "~3% annual inflation adjustment",
      ] },
      { label: "Ancillary Revenue (% of Seat Rev)", cells: [
        ...state.taxibeeSchedule.map((row, idx) => ({ html: schedInput(idx, "ancillaryPct", row.ancillaryPct, "0.1"), cls: "taxibee-input-cell" })),
        "Parcels, luggage, corporate B2B, ads",
      ] },
      { label: "Unit Cost Inflation Index", cells: [
        ...state.taxibeeSchedule.map((row, idx) => ({ html: schedInput(idx, "costInflation", row.costInflation, "0.01"), cls: "taxibee-input-cell" })),
        "3% p.a. cost inflation on fuel/maint/pay",
      ] },
      { label: "Annual Corporate Overhead (UGX)", cells: [
        fmtUgx(p.schedule[0].corpOverhead),
        ...state.taxibeeSchedule.slice(1).map((row, idx) => ({ html: schedInput(idx + 1, "corpOverhead", row.corpOverhead, "1000000"), cls: "taxibee-input-cell" })),
        "Scales with fleet & regional hubs",
      ] },
      { label: "Annual Tech & App CapEx (UGX)", cells: [
        ...state.taxibeeSchedule.map((row, idx) => ({ html: schedInput(idx, "techCapex", row.techCapex, "1000000"), cls: "taxibee-input-cell" })),
        "App upgrades, telematics, EV prep",
      ] },
    ];

    return `<section class="panel">
        <div class="review-section-head">
          <h2>1. Capital Structure &amp; Financing Terms (Month 0)</h2>
          ${!guestMode ? '<button type="button" class="button secondary small" id="taxibee-reset-defaults">Reset Taxibee defaults</button>' : ""}
        </div>
        <p class="muted">Every input updates the Y1 Ramp, 3-Year, 5-Year, Loan &amp; DSCR, Stress Tests, and Peebee consolidated statements dynamically.</p>
        ${renderTable(escape, "Line Item", ["Value", "Units / %", "Notes"], sec1)}
      </section>
      <section class="panel">
        <h2>2. Asset, Loan &amp; Valuation Parameters</h2>
        ${renderTable(escape, "Parameter", ["Value", "Units / %", "Notes"], sec2)}
      </section>
      <section class="panel">
        <h2>3. Operational Unit Economics Inputs (Per Van — Year 1 Base)</h2>
        ${renderTable(escape, "Input", ["Value", "Units / %", "Notes"], sec3)}
      </section>
      <section class="panel">
        <h2>4. Live Per-Van Monthly Unit Economics Check (Year 1)</h2>
        ${renderTable(escape, "Metric", ["Calculated Value", "Units", "Basis"], sec4)}
      </section>
      <section class="panel">
        <h2>5. 5-Year Fleet Scaling, Pricing &amp; Inflation Schedule</h2>
        ${renderTable(escape, "Scaling Driver", schedCols, schedRows)}
      </section>
      <section class="panel">
        <h2>6. Year 1 Monthly Load Factor Ramp (%)</h2>
        <p class="muted">Edit each month’s target load factor (%) to update Year 1 monthly cash flow and the Year 1 annual average (${fmtPct1(p.y1AvgLoad)}).</p>
        <div class="taxibee-ramp-grid">
          ${state.taxibeeRamp.map((row, i) => `<label class="taxibee-ramp-cell">
            <span>${escape(model.ramp.months[i].label)}</span>
            <div class="field-box taxibee-input-box compact">
              <input type="number" step="0.5" min="0" max="100" data-tb-ramp="${i}" value="${escape(row.load)}" ${ro}>
              <span>%</span>
            </div>
          </label>`).join("")}
        </div>
      </section>`;
  }

  function renderRamp(escape, model) {
    const r = model.ramp;
    const cols = [...r.months.map(m => m.label), "FY Total / Avg"];
    const rows = [
      { label: "Active VIP Van Fleet", cells: [...r.months.map(m => String(m.vans)), String(r.totals.vans)] },
      { label: "Monthly Average Load Factor (%)", cells: [...r.months.map(m => fmtPct1(m.loadFactor)), fmtPct1(r.totals.loadFactor)], style: "detail" },
      { label: "Seat Fare Revenue", cells: [...r.months.map(m => fmtUgx(m.seatRevenue)), fmtUgx(r.totals.seatRevenue)] },
      { label: "Ancillary Revenue (Parcels, Luggage, Ads)", cells: [...r.months.map(m => fmtUgx(m.ancillaryRevenue)), fmtUgx(r.totals.ancillaryRevenue)] },
      { label: "Total Revenue", cells: [...r.months.map(m => fmtUgx(m.totalRevenue)), fmtUgx(r.totals.totalRevenue)], style: "total" },
      { label: "Direct Trip Costs (Fuel, Tolls, Hub)", cells: [...r.months.map(m => fmtUgx(m.directTripCosts)), fmtUgx(r.totals.directTripCosts)], style: "detail" },
      { label: `Payment Gateway Fees (${(model.inputs.gatewayFeeRate * 100).toFixed(1)}%)`, cells: [...r.months.map(m => fmtUgx(m.gatewayFees)), fmtUgx(r.totals.gatewayFees)], style: "detail" },
      { label: "Total Direct Costs (COGS)", cells: [...r.months.map(m => fmtUgx(m.totalCogs)), fmtUgx(r.totals.totalCogs)] },
      { label: "Gross Profit", cells: [...r.months.map(m => fmtUgx(m.grossProfit)), fmtUgx(r.totals.grossProfit)], style: "total" },
      { label: `Driver Payroll (incl. ${(model.inputs.nssfRate * 100).toFixed(0)}% NSSF)`, cells: [...r.months.map(m => fmtUgx(m.driverPayroll)), fmtUgx(r.totals.driverPayroll)], style: "detail" },
      { label: "Van Fixed OpEx (Ins, Maint, Wi-Fi, Lic)", cells: [...r.months.map(m => fmtUgx(m.vanFixedOpex)), fmtUgx(r.totals.vanFixedOpex)], style: "detail" },
      { label: "Corporate Overhead", cells: [...r.months.map(m => fmtUgx(m.corpOverhead)), fmtUgx(r.totals.corpOverhead)], style: "detail" },
      { label: "Total Operating Expenses (OpEx)", cells: [...r.months.map(m => fmtUgx(m.totalOpex)), fmtUgx(r.totals.totalOpex)] },
      { label: "EBITDA (Operating Cash Flow)", cells: [...r.months.map(m => fmtUgx(m.ebitda)), fmtUgx(r.totals.ebitda)], style: "total" },
      { label: `Monthly Loan Interest (${(model.inputs.loanRate * 100).toFixed(2).replace(/\.?0+$/, "")}% p.a.)`, cells: [...r.months.map(m => fmtUgx(m.interest)), fmtUgx(r.totals.interest)] },
      { label: "Monthly Net Cash Flow (Pre-Tax)", cells: [...r.months.map(m => fmtUgx(m.netCashFlow)), fmtUgx(r.totals.netCashFlow)], style: "total" },
      { label: "Ending Cash Balance (Pre-Tax)", cells: [...r.months.map(m => fmtUgx(m.endingCash)), fmtUgx(r.totals.endingCash)], style: "footer" },
    ];
    const maxCash = Math.max(1, model.capital.m0CashBuffer, ...r.months.map(m => Math.abs(m.endingCash)));
    return `<div class="metrics">
        <div class="panel metric"><span>Opening M0 Cash Buffer</span><div class="metric-value"><strong>UGX ${fmtM(model.capital.m0CashBuffer)}</strong></div><small>Post-fleet, app, licensing &amp; loan fee</small></div>
        <div class="panel metric"><span>Operating Breakeven</span><div class="metric-value"><strong>${escape(r.operatingBreakevenMonth ? `Month ${r.operatingBreakevenMonth.monthIndex} (${r.operatingBreakevenMonth.label})` : "Not reached")}</strong></div><small>First month with positive EBITDA</small></div>
        <div class="panel metric"><span>Cash-Flow Breakeven</span><div class="metric-value"><strong>${escape(r.cashflowBreakevenMonth ? `Month ${r.cashflowBreakevenMonth.monthIndex} (${r.cashflowBreakevenMonth.label})` : "Not reached")}</strong></div><small>First month positive after loan interest</small></div>
        <div class="panel metric"><span>Y1 Liquidity Trough</span><div class="metric-value"><strong>UGX ${fmtM(r.troughCash)}</strong></div><small>Lowest cash in ${escape(r.troughMonth)}</small></div>
      </div>
      <section class="panel">
        <h2>Year 1 Monthly Launch Ramp &amp; Liquidity Tracker (UGX)</h2>
        ${renderTable(escape, "Line Item (UGX)", cols, rows)}
      </section>
      <section class="panel">
        <h2>Year 1 Pre-Tax Ending Cash Trajectory</h2>
        <ul class="plot">
          <li><span>M0 Opening</span><span class="track"><span class="bar" style="width:${Math.max(0, 100 * model.capital.m0CashBuffer / maxCash).toFixed(1)}%"></span></span><strong>UGX ${fmtM(model.capital.m0CashBuffer)}</strong></li>
          ${r.months.map(m => `<li><span>${escape(m.label)}</span><span class="track"><span class="bar" style="width:${Math.max(0, 100 * m.endingCash / maxCash).toFixed(1)}%"></span></span><strong>UGX ${fmtM(m.endingCash)}</strong></li>`).join("")}
        </ul>
      </section>`;
  }

  function renderIntegratedModel(escape, model, horizonModel) {
    const p = model.inputs;
    const rows = horizonModel.rows;
    const t = horizonModel.totals;
    const v = horizonModel.valuation;
    const h = horizonModel.horizon;
    const cols = [...rows.map(r => `Year ${r.yearIndex} (${r.calendarYear})`), `${h}-Year Total / End`];
    const tableRows = [
      { section: "A. Operational Drivers" },
      { label: "Active VIP Van Fleet (Units)", cells: [...rows.map(r => String(r.vans)), String(t.endingVans)] },
      { label: "Average Annual Load Factor (%)", cells: [...rows.map(r => fmtPct1(r.loadFactor)), "—"] },
      { label: "Average Seat Fare (UGX)", cells: [...rows.map(r => fmtUgx(r.seatFare)), "—"] },
      { section: "B. Income Statement (Profit & Loss)" },
      { label: "Seat Fare Revenue", cells: [...rows.map(r => fmtUgx(r.seatRevenue)), fmtUgx(t.seatRevenue)] },
      { label: "Ancillary Revenue (Parcels, Luggage, Ads)", cells: [...rows.map(r => fmtUgx(r.ancillaryRevenue)), fmtUgx(t.ancillaryRevenue)] },
      { label: "Total Revenue", cells: [...rows.map(r => fmtUgx(r.totalRevenue)), fmtUgx(t.totalRevenue)], style: "total" },
      { label: "Direct Costs / COGS (Fuel, Tolls, Hub, Gateway)", cells: [...rows.map(r => fmtUgx(r.cogs)), fmtUgx(t.cogs)] },
      { label: "Gross Profit", cells: [...rows.map(r => fmtUgx(r.grossProfit)), fmtUgx(t.grossProfit)], style: "total" },
      { label: "Gross Margin (%)", cells: [...rows.map(r => fmtPct1(r.grossMargin)), fmtPct1(t.grossMargin)], style: "detail" },
      { label: `Driver Payroll (+${(p.nssfRate * 100).toFixed(0)}% NSSF) & Van Fixed OpEx`, cells: [...rows.map(r => fmtUgx(r.fleetOpex)), fmtUgx(t.fleetOpex)] },
      { label: "Corporate Operating Expenses (OpEx)", cells: [...rows.map(r => fmtUgx(r.corpOpex)), fmtUgx(t.corpOpex)] },
      { label: "EBITDA", cells: [...rows.map(r => fmtUgx(r.ebitda)), fmtUgx(t.ebitda)], style: "total" },
      { label: "EBITDA Margin (%)", cells: [...rows.map(r => fmtPct1(r.ebitdaMargin)), fmtPct1(t.ebitdaMargin)], style: "detail" },
      { label: `Depreciation & Amortization (${p.vanLifeYears}-yr Vans / ${p.techLifeYears}-yr Tech)`, cells: [...rows.map(r => fmtUgx(r.da)), fmtUgx(t.da)] },
      { label: "Operating Profit (EBIT)", cells: [...rows.map(r => fmtUgx(r.ebit)), fmtUgx(t.ebit)], style: "total" },
      { label: `Finance Costs (Loan ${(p.loanRate * 100).toFixed(2).replace(/\.?0+$/, "")}% Interest)`, cells: [...rows.map(r => fmtUgx(r.interest)), fmtUgx(t.interest)] },
      { label: "Earnings Before Tax (EBT)", cells: [...rows.map(r => fmtUgx(r.ebt)), fmtUgx(t.ebt)] },
      { label: `Corporate Income Tax (${(p.citRate * 100).toFixed(1)}%)`, cells: [...rows.map(r => fmtUgx(r.tax)), fmtUgx(t.tax)] },
      { label: "Net Profit After Tax (PAT)", cells: [...rows.map(r => fmtUgx(r.pat)), fmtUgx(t.pat)], style: "total" },
      { label: "Net Profit Margin (%)", cells: [...rows.map(r => fmtPct1(r.netMargin)), fmtPct1(t.netMargin)], style: "detail" },
      { section: "C. Cash Flow Statement" },
      { label: "Net Profit After Tax (PAT)", cells: [...rows.map(r => fmtUgx(r.pat)), fmtUgx(t.pat)] },
      { label: "(+) Depreciation & Amortization", cells: [...rows.map(r => fmtUgx(r.da)), fmtUgx(t.da)] },
      { label: "(-) Change in Net Working Capital (Delta NWC)", cells: [...rows.map(r => fmtUgx(-r.deltaNwc)), fmtUgx(-t.deltaNwc)] },
      { label: "Net Cash from Operating Activities (CFO)", cells: [...rows.map(r => fmtUgx(r.cfo)), fmtUgx(t.cfo)], style: "total" },
      { label: "(-) Capital Expenditures (Expansion Vans & Tech)", cells: [...rows.map(r => fmtUgx(-r.totalCapex)), fmtUgx(-t.totalCapex)] },
      { label: "(-) Loan Principal Repayment", cells: [...rows.map(r => fmtUgx(-r.principal)), fmtUgx(-t.principal)] },
      { label: "Net Change in Cash", cells: [...rows.map(r => fmtUgx(r.netCashChange)), fmtUgx(t.netCashChange)] },
      { label: "Ending Cash Balance", cells: [...rows.map(r => fmtUgx(r.endCash)), fmtUgx(t.endCash)], style: "total" },
      { section: "D. Balance Sheet & Debt Coverage" },
      { label: "Cash & Cash Equivalents", cells: [...rows.map(r => fmtUgx(r.endCash)), fmtUgx(t.endCash)] },
      { label: `Accounts Receivable (${(p.arPct * 100).toFixed(1)}% of Rev)`, cells: [...rows.map(r => fmtUgx(r.ar)), fmtUgx(rows[h - 1].ar)] },
      { label: "Property, Plant & Equipment (Net Fleet)", cells: [...rows.map(r => fmtUgx(r.netFleet)), fmtUgx(rows[h - 1].netFleet)] },
      { label: "Intangible Assets (Net App & Tech)", cells: [...rows.map(r => fmtUgx(r.netTech)), fmtUgx(rows[h - 1].netTech)] },
      { label: "TOTAL ASSETS", cells: [...rows.map(r => fmtUgx(r.totalAssets)), fmtUgx(rows[h - 1].totalAssets)], style: "total" },
      { label: `Accounts Payable (${(p.apPct * 100).toFixed(1)}% of COGS + OpEx)`, cells: [...rows.map(r => fmtUgx(r.ap)), fmtUgx(rows[h - 1].ap)] },
      { label: "Fleet Loan Balance", cells: [...rows.map(r => fmtUgx(r.debt)), fmtUgx(t.debt)] },
      { label: "Paid-In Share Capital (Investor Equity)", cells: [...rows.map(r => fmtUgx(r.paidInEquity)), fmtUgx(rows[h - 1].paidInEquity)] },
      { label: "Retained Earnings", cells: [...rows.map(r => fmtUgx(r.retained)), fmtUgx(rows[h - 1].retained)] },
      { label: "TOTAL LIABILITIES & EQUITY", cells: [...rows.map(r => fmtUgx(r.totalLiabilitiesAndEquity)), fmtUgx(rows[h - 1].totalLiabilitiesAndEquity)], style: "total" },
      { label: "Balance Sheet Check (Must Equal 0)", cells: [...rows.map(r => fmtUgx(Math.abs(r.bsCheck) < 1 ? 0 : r.bsCheck)), fmtUgx(Math.abs(rows[h - 1].bsCheck) < 1 ? 0 : rows[h - 1].bsCheck)] },
      { label: "Cash Flow Available for Debt Service (CFADS)", cells: [...rows.map(r => fmtUgx(r.cfads)), fmtUgx(t.cfads)] },
      { label: "Total Debt Service (Interest + Principal)", cells: [...rows.map(r => fmtUgx(r.debtService)), fmtUgx(t.debtService)] },
      { label: "Debt Service Coverage Ratio (DSCR)", cells: [...rows.map(r => fmtX(r.dscr)), `Min ${fmtX(t.minDscr)}`], style: "total" },
      { label: "Unlevered Free Cash Flow (FCFF)", cells: [...rows.map(r => fmtUgx(r.fcff)), fmtUgx(t.fcff)], style: "footer" },
    ];

    const valCols = ["M0 (Launch)", ...rows.map(r => `Year ${r.yearIndex} (${r.calendarYear})`)];
    const valRows = [
      { label: "Project Cash Flow (incl. Book Terminal Value)", cells: v.projectCashFlows.map(fmtUgx), style: "total" },
    ];
    return `<section class="panel">
        <h2>Version ${h === 3 ? "1: 3-Year" : "2: 5-Year"} Integrated Financial Model (${p.start.year} – ${p.start.year + h - 1})</h2>
        <p class="muted">Fleet scales organically ${rows.map(r => r.vans).join(" → ")} VIP vans · 100% dynamic formulas · Currency: UGX.</p>
        ${renderTable(escape, "Financial Line Item (UGX)", cols, tableRows)}
      </section>
      <section class="panel">
        <h2>E. ${h}-Year Project Valuation &amp; Returns (Conservative Book Terminal Value)</h2>
        ${renderTable(escape, "Unlevered Cash Flow Stream (UGX)", valCols, valRows)}
        <dl class="taxibee-dl">
          <div><dt>Conservative Book Terminal Value (Net PPE + Net Tech + NWC)</dt><dd>UGX ${fmtUgx(v.bookTerminalValue)}</dd></div>
          <div><dt>${h}-Year Project NPV @ ${fmtPct1(p.udbDiscountRate)} (Discount Rate)</dt><dd>UGX ${fmtUgx(v.projectNpvUdb)}</dd></div>
          <div><dt>${h}-Year Project NPV @ ${fmtPct1(p.equityHurdleRate)} (Equity Hurdle Rate)</dt><dd>UGX ${fmtUgx(v.projectNpvEquity)}</dd></div>
          <div><dt>${h}-Year Project IRR (%)</dt><dd>${fmtPct1(v.projectIrr)}</dd></div>
          ${h === 5 ? `<div><dt>Year 5 Enterprise Value (Conservative ${p.exitEbitdaMultiple.toFixed(1)}x EBITDA)</dt><dd>UGX ${fmtUgx(v.enterpriseValueY5)}</dd></div>
            <div><dt>Year 5 Equity Value (EV − Debt + Cash)</dt><dd>UGX ${fmtUgx(v.equityValueY5)}</dd></div>
            <div><dt>Investor ${fmtPct1(p.udbEquityStake)} Equity Stake Value at Year 5 (UGX)</dt><dd>UGX ${fmtUgx(v.udbStakeValueY5)}</dd></div>
            <div><dt>Equity Return Multiple (MOIC on UGX ${fmtM(p.udbEquity)})</dt><dd>${dec1Fmt.format(v.udbMoicY5 ?? 0)}x</dd></div>` : ""}
        </dl>
      </section>`;
  }

  function renderDebt(escape, model, answers, guestMode) {
    const p = model.inputs;
    const cfg = readState(answers).taxibeeConfig[0];
    const ro = guestMode ? "disabled" : "";
    const rateLabel = `${(p.loanRate * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    const debtRows = [
      ...model.debtSchedule.map(r => ({
        label: `Year ${r.loanYear}`,
        cells: [String(r.calendarYear), fmtUgx(r.opening), fmtUgx(r.interest), fmtUgx(r.principal), fmtUgx(r.totalService), fmtUgx(r.closing), r.phase],
      })),
      {
        label: "TOTAL",
        cells: [`${p.loanTenorYears} Years`, fmtUgx(model.debtTotals.opening), fmtUgx(model.debtTotals.interest), fmtUgx(model.debtTotals.principal), fmtUgx(model.debtTotals.totalService), fmtUgx(model.debtTotals.closing), model.debtTotals.phase],
        style: "footer",
      },
    ];
    const dscrRows = model.dscrCovenant.map(r => ({
      label: `Year ${r.loanYear}`,
      cells: [
        String(r.calendarYear),
        fmtUgx(r.ebitda),
        fmtUgx(r.cfads),
        fmtUgx(r.debtService),
        fmtX(r.dscr),
        fmtX(r.minCovenant),
        { html: `<span class="taxibee-badge ${r.compliant ? "pass" : "warn"}">${r.compliant ? "COMPLIANT" : "BELOW TARGET"}</span>` },
      ],
    }));
    const loanInput = (label, key, unit, step = "any") => `<label class="taxibee-ramp-cell">
      <span>${escape(label)}</span>
      <div class="field-box taxibee-input-box compact">
        <input type="number" step="${step}" min="0" data-tb-config="${escape(key)}" value="${escape(cfg[key])}" ${ro}>
        ${unit ? `<span>${escape(unit)}</span>` : ""}
      </div>
    </label>`;
    return `<div class="metrics">
        <div class="panel metric"><span>Loan Principal</span><div class="metric-value"><strong>UGX ${fmtM(p.udbLoan)}</strong></div><small>${escape(rateLabel)} p.a. · ${p.loanTenorYears}-Year tenor</small></div>
        <div class="panel metric"><span>Total Interest (${p.loanTenorYears} Yrs)</span><div class="metric-value"><strong>UGX ${fmtM(model.debtTotals.interest)}</strong></div><small>Updates live as you adjust the interest rate</small></div>
        <div class="panel metric"><span>Principal Grace Period</span><div class="metric-value"><strong>${p.loanGraceYears * 12} Months</strong></div><small>${p.loanGraceYears > 0 ? "Interest-only during initial ramp" : "Principal starts Year 1"}</small></div>
        <div class="panel metric"><span>Van Collateral Coverage</span><div class="metric-value"><strong>${fmtPct1(model.collateral.collateralCoverage)}</strong></div><small>UGX ${fmtM(model.collateral.forcedSaleValue)} estimated van value</small></div>
      </div>
      <section class="panel">
        <h2>Simple Loan Terms (Adjustable)</h2>
        <p class="muted">Adjust the loan principal, annual interest rate, tenor, or grace period below to immediately recalculate interest expense, debt service, DSCR, cash flow, and consolidated Peebee statements.</p>
        <div class="taxibee-loan-grid">
          ${loanInput("Loan Principal", "udbLoan", "UGX", "1000000")}
          ${loanInput("Annual Interest Rate", "loanRatePct", "% p.a.", "0.25")}
          ${loanInput("Loan Tenor", "loanTenorYears", "Years", "1")}
          ${loanInput("Grace Period", "loanGraceYears", "Years", "1")}
          ${loanInput("Upfront Fee", "appraisalFeePct", "%", "0.1")}
          ${loanInput("Min DSCR Target", "minDscrCovenant", "x", "0.1")}
        </div>
      </section>
      <section class="panel">
        <h2>1. Annual Loan Repayment Schedule (${p.start.year} – ${p.start.year + p.loanTenorYears - 1})</h2>
        ${renderTable(escape, "Loan Year", ["Calendar Year", "Opening Balance (UGX)", `Interest @ ${rateLabel} (UGX)`, "Principal Repayment (UGX)", "Total Debt Service (UGX)", "Closing Balance (UGX)", "Payment Phase"], debtRows)}
      </section>
      <section class="panel">
        <h2>2. Debt Service Coverage Ratio (DSCR) Summary (Target: ${fmtX(p.minDscrCovenant)})</h2>
        ${renderTable(escape, "Loan Year", ["Calendar Year", "EBITDA (UGX)", "CFADS (UGX)", "Total Debt Service (UGX)", "Projected DSCR", "Target DSCR", "Status"], dscrRows)}
      </section>`;
  }

  function renderStress(escape, model, answers, guestMode) {
    const state = readState(answers);
    const p = model.inputs;
    const ro = guestMode ? "disabled" : "";
    const scInput = (i, field, val, step = "0.05") =>
      `<div class="field-box taxibee-input-box compact"><input type="number" step="${step}" data-tb-stress="${i}" data-tb-field="${field}" value="${escape(val)}" ${ro}></div>`;

    const table1Rows = model.stressResults.map((s, i) => ({
      label: s.name,
      cells: [
        guestMode ? dec2Fmt.format(s.loadMult) : { html: scInput(i, "loadMult", state.taxibeeStress[i].loadMult, "0.05"), cls: "taxibee-input-cell" },
        guestMode ? (s.fareOverride ? fmtUgx(s.fareOverride) : "Plan") : { html: scInput(i, "fareOverride", state.taxibeeStress[i].fareOverride, "500"), cls: "taxibee-input-cell" },
        guestMode ? dec2Fmt.format(s.costMult) : { html: scInput(i, "costMult", state.taxibeeStress[i].costMult, "0.05"), cls: "taxibee-input-cell" },
        fmtMNum(s.y1.ebitda),
        fmtX(s.y1.dscr),
        fmtX(s.y2GatedDscr),
        { html: `<span class="taxibee-badge ${s.creditVerdict.startsWith("TRIGGERS") ? "warn" : "pass"}">${escape(s.creditVerdict)}</span>` },
      ],
    }));

    const table2Rows = model.stressResults.map(s => ({
      label: s.name,
      cells: [
        fmtMNum(s.y1.totalRevenue),
        fmtMNum(s.y1.cogs),
        fmtMNum(s.y1.totalOpex),
        fmtMNum(s.y1.ebitda),
        fmtMNum(s.y1.tax),
        fmtMNum(s.y1.deltaNwc),
        fmtMNum(s.y1.cfads),
      ],
    }));

    const table3Rows = model.stressResults.map(s => ({
      label: s.name,
      cells: [
        String(s.y5Fleet),
        fmtMNum(s.gatedMinCash),
        fmtMNum(s.gatedY5Cash),
        fmtMNum(s.unconstrainedMinCash),
        s.gateAction,
      ],
    }));

    return `<section class="panel">
        <h2>1. Stress Scenario Assumptions &amp; Impact on Year 1 &amp; Year 2 Cash Flows (${p.initialVans}-Van Baseline)</h2>
        <p class="muted">Evaluates Year 1 &amp; Year 2 DSCR, Liquidity Floor, and 5-Year Viability under Load, Fare, and Cost Shocks (Unconstrained vs CapEx-Gated).</p>
        ${renderTable(escape, "Stress Scenario", ["Load Multiplier", "Fare Override (UGX)", "Cost Multiplier", "Y1 EBITDA (UGX M)", "Y1 DSCR (x)", "Y2 DSCR (CapEx-Gated)", "Credit Verdict"], table1Rows)}
      </section>
      <section class="panel">
        <h2>2. Live Year 1 Stress Calculation Engine (UGX Millions)</h2>
        ${renderTable(escape, "Scenario", ["Y1 Revenue (M)", "Y1 COGS (M)", "Y1 OpEx (M)", "Y1 EBITDA (M)", "Y1 Tax (M)", "Y1 Delta NWC (M)", "Y1 CFADS (M)"], table2Rows)}
      </section>
      <section class="panel">
        <h2>3. CapEx-Gating Covenant Rule (Minimum UGX ${fmtM(p.cashGateFloor)} Cash Buffer — 5-Year Outcome)</h2>
        ${renderTable(escape, `Scenario (With UGX ${fmtM(p.cashGateFloor)} Cash Gate)`, ["Y5 Fleet (Vans)", "Min Cash (UGX M)", "Y5 Ending Cash (UGX M)", "Unconstrained Min Cash (M)", "Gate Action Triggered"], table3Rows)}
      </section>`;
  }

  function renderFlyDashboard(escape, fly) {
    const m3 = fly.model3y;
    const m5 = fly.model5y;
    const m1Bookings = fly.y1Months[0]?.bookings ?? 0;
    const maxRev = Math.max(1, ...m5.rows.map(r => r.totalRevenue));
    const maxStreamRev = Math.max(1, ...fly.streamTrackers.map((_, idx) => m5.rows.reduce((s, r) => s + (r.streamTotals[idx]?.revenue || 0), 0)));
    const kpis = [
      ["Capital Structure (Fly Express)", "UGX 0 Debt", "Asset-light partner fleet · Zero van CapEx or collateral"],
      ["5-Year Cumulative Revenue", `UGX ${fmtM(m5.totals.totalRevenue)}`, `${fly.activeStreams.length} active partner streams · ${fmtUgx(m1Bookings)} mo. 1 bookings/units`],
      ["5-Year Cumulative Net Profit", `UGX ${fmtM(m5.totals.pat)}`, `After ${fmtPct1(fly.taxRate)} tax · ${fmtPct1(m5.totals.netMargin)} net margin`],
      ["5-Year Cash Contribution", `UGX ${fmtM(m5.totals.endCash)}`, "No principal or interest obligations · Zero DSCR risk"],
    ];
    const compareRows = [
      { label: "Operating Model", cells: ["Partner Fleet (Fly Express)", "Partner Fleet (Fly Express)", "Asset-light commission marketplace"] },
      { label: "Active Commission & Fee Streams", cells: [String(fly.activeStreams.length), String(fly.activeStreams.length), "Synced with Admin TaxiPress fee rules"] },
      { label: "Cumulative Partner Bookings / Units", cells: [fmtUgx(m3.totals.bookings), fmtUgx(m5.totals.bookings), "Digital seats, cash seats & seat-choice add-ons"] },
      { label: "Cumulative Gross Fare Volume (UGX)", cells: [fmtUgx(m3.totals.volume), fmtUgx(m5.totals.volume), "Partner fares processed through TaxiPress"] },
      { label: "Cumulative Peebee Revenue (UGX)", cells: [fmtUgx(m3.totals.totalRevenue), fmtUgx(m5.totals.totalRevenue), "Commissions & seat-choice fees retained by Peebee"], style: "total" },
      { label: "Cumulative EBITDA (UGX)", cells: [fmtUgx(m3.totals.ebitda), fmtUgx(m5.totals.ebitda), `${fmtPct1(m5.totals.ebitdaMargin)} margin before unallocated corporate overhead`], style: "total" },
      { label: "Cumulative Net Profit After Tax (UGX)", cells: [fmtUgx(m3.totals.pat), fmtUgx(m5.totals.pat), `After ${fmtPct1(fly.taxRate)} corporate income tax`] },
      { label: "Cumulative Cash Contribution (UGX)", cells: [fmtUgx(m3.totals.endCash), fmtUgx(m5.totals.endCash), "Zero vehicle CapEx or fleet maintenance drain"], style: "total" },
      { label: "Fleet CapEx & Fleet Loan", cells: ["UGX 0", "UGX 0", "Vehicles owned & maintained by partner operators"] },
      { label: "Project NPV @ 12.0% (UGX)", cells: [fmtUgx(m3.valuation.npv12), fmtUgx(m5.valuation.npv12), "Discounted unlevered commission cash flows"], style: "footer" },
    ];
    const perfRows = m5.rows.map(r => ({
      label: String(r.calendarYear),
      cells: [
        fmtUgx(r.bookings),
        fmtMNum(r.volume),
        fmtMNum(r.totalRevenue),
        fmtMNum(r.ebitda),
        fmtMNum(r.pat),
        fmtMNum(r.endCash),
        "UGX 0",
      ],
    }));
    const streamTotals5y = fly.streamTrackers.map((s, idx) => ({
      name: s.name,
      rev: m5.rows.reduce((acc, r) => acc + (r.streamTotals[idx]?.revenue || 0), 0),
    }));
    return `<div class="metrics">
        ${kpis.map(([label, value, sub]) => `<div class="panel metric">
          <span>${escape(label)}</span>
          <div class="metric-value"><strong>${escape(value)}</strong></div>
          <small>${escape(sub)}</small>
        </div>`).join("")}
      </div>
      <section class="panel">
        <h2>1. Fly Express Partner Model: 3-Year vs 5-Year Comparison</h2>
        ${renderTable(escape, "Key Performance Metric", [
          `3-Year (${fly.start.year}–${fly.start.year + 2})`,
          `5-Year (${fly.start.year}–${fly.start.year + 4})`,
          "Fly Express Partner Basis",
        ], compareRows)}
      </section>
      <section class="panel">
        <h2>2. 5-Year Fly Express Performance Summary (UGX Millions)</h2>
        ${renderTable(escape, "Year", ["Bookings / Units", "Gross Volume (M)", "Peebee Revenue (M)", "EBITDA (M)", "Net Profit (M)", "Cum. Cash (M)", "Fleet Debt"], perfRows)}
      </section>
      <div class="taxibee-chart-grid">
        <section class="panel">
          <h2>5-Year Commission Revenue &amp; EBITDA (UGX Millions)</h2>
          <div class="taxibee-bar-list">
            ${m5.rows.map(r => `<div class="taxibee-bar-group">
              <div class="taxibee-bar-head"><span>${r.calendarYear}</span><strong>Rev ${fmtM(r.totalRevenue)} · EBITDA ${fmtM(r.ebitda)}</strong></div>
              <div class="taxibee-bar-tracks">
                <div class="track"><span class="bar" style="width:${(100 * r.totalRevenue / maxRev).toFixed(1)}%"></span></div>
                <div class="track"><span class="bar taxibee-bar-ink" style="width:${Math.max(0, 100 * r.ebitda / maxRev).toFixed(1)}%"></span></div>
              </div>
            </div>`).join("")}
          </div>
          <p class="muted taxibee-legend"><span><i class="taxibee-swatch-gold"></i>Peebee Revenue</span><span><i class="taxibee-swatch-ink"></i>EBITDA</span></p>
        </section>
        <section class="panel">
          <h2>5-Year Revenue Mix by Fly Express Stream</h2>
          <div class="taxibee-bar-list">
            ${streamTotals5y.map(st => `<div class="taxibee-bar-group">
              <div class="taxibee-bar-head"><span>${escape(st.name)}</span><strong>UGX ${fmtM(st.rev)}</strong></div>
              <div class="taxibee-bar-tracks">
                <div class="track"><span class="bar" style="width:${(100 * st.rev / maxStreamRev).toFixed(1)}%"></span></div>
              </div>
            </div>`).join("") || '<p class="muted">No active Fly Express streams enabled.</p>'}
          </div>
        </section>
      </div>`;
  }

  function renderFlyAssumptions(escape, fly, answers, guestMode) {
    const ro = guestMode ? "disabled" : "";
    const streams = Array.isArray(answers["channel-taxipress"]) ? answers["channel-taxipress"] : [];
    const numInput = (idx, field, val, step = "any") =>
      `<div class="field-box taxibee-input-box compact"><input type="number" step="${step}" data-fly-idx="${idx}" data-fly-field="${field}" value="${escape(val ?? "")}" ${ro}></div>`;
    const rows = streams.map((row, idx) => {
      const isOrders = row.method === "orders";
      const isUnits = row.method === "units";
      const active = row.enabled !== "no";
      const m1Rev = fly.y1Months[0]?.byStream.find(s => s.name === row.name)?.revenue ?? 0;
      return {
        label: row.name || `Stream ${idx + 1}`,
        cells: [
          { html: `<label class="forecast-switch"><input type="checkbox" data-fly-idx="${idx}" data-fly-toggle="enabled" ${active ? "checked" : ""} ${ro}><span>${active ? "On" : "Off"}</span></label>` },
          isOrders ? "Orders × Fare × %" : isUnits ? "Units × Fee" : escape(row.method || "direct"),
          isOrders ? { html: numInput(idx, "orders", row.orders, "1"), cls: "taxibee-input-cell" }
            : isUnits ? { html: numInput(idx, "units", row.units, "1"), cls: "taxibee-input-cell" } : "—",
          isOrders ? { html: numInput(idx, "orderValue", row.orderValue, "500"), cls: "taxibee-input-cell" }
            : isUnits ? { html: numInput(idx, "price", row.price, "100"), cls: "taxibee-input-cell" } : "—",
          isOrders || row.method === "percentage" ? { html: numInput(idx, "rate", row.rate, "0.1"), cls: "taxibee-input-cell" } : "—",
          { html: numInput(idx, "growth", row.growth, "0.5"), cls: "taxibee-input-cell" },
          { html: numInput(idx, "days", row.days, "1"), cls: "taxibee-input-cell" },
          fmtUgx(active ? m1Rev : 0),
        ],
      };
    });
    return `<section class="panel">
        <div class="review-section-head">
          <h2>TaxiPress · Fly Express Revenue Streams (Partner Commission Model)</h2>
          ${!guestMode ? '<button type="button" class="button secondary small" id="taxibee-edit-fly-advanced">Open full Fly Express editor →</button>' : ""}
        </div>
        <p class="muted">Edit Fly Express monthly seat volumes, average fares, commission percentages, flat seat-choice fees, and monthly growth directly here. Changes immediately recalculate all Fly Express views and Peebee’s consolidated statements.</p>
        ${renderTable(escape, "Stream", ["Status", "Driver", "Mo. 1 Orders / Units", "Avg Fare / Fee (UGX)", "Commission (%)", "Mo. Growth (%)", "AR Days", "Mo. 1 Revenue (UGX)"], rows)}
      </section>
      <section class="panel">
        <h2>Capital Structure · Asset-Light Partner Basis</h2>
        <dl class="taxibee-dl">
          <div><dt>Vehicle Ownership</dt><dd>Partner-owned fleet (Fly Express operators)</dd></div>
          <div><dt>Fleet CapEx &amp; Fleet Loan Required</dt><dd>UGX 0</dd></div>
          <div><dt>Corporate Income Tax Rate (from Peebee Model)</dt><dd>${fmtPct1(fly.taxRate)}</dd></div>
          <div><dt>Admin Live Fee Sync</dt><dd>Supported via Model → Admin defaults &amp; Settings → Live Admin data</dd></div>
        </dl>
      </section>`;
  }

  function renderFlyRamp(escape, fly) {
    const cols = [...fly.y1Months.map(m => m.label), "FY Total"];
    const streamRows = fly.streamTrackers.map((st, idx) => ({
      label: st.name,
      cells: [
        ...fly.y1Months.map(m => fmtUgx(m.byStream[idx]?.revenue ?? 0)),
        fmtUgx(fly.y1Months.reduce((acc, m) => acc + (m.byStream[idx]?.revenue ?? 0), 0)),
      ],
      style: "detail",
    }));
    const rows = [
      { label: "Total Bookings / Units", cells: [...fly.y1Months.map(m => fmtUgx(m.bookings)), fmtUgx(fly.y1Totals.bookings)] },
      ...streamRows,
      { label: "Total Peebee Revenue", cells: [...fly.y1Months.map(m => fmtUgx(m.totalRevenue)), fmtUgx(fly.y1Totals.totalRevenue)], style: "total" },
      { label: "Scoped Direct Costs (COGS)", cells: [...fly.y1Months.map(m => fmtUgx(m.cogs)), fmtUgx(fly.y1Totals.cogs)] },
      { label: "Gross Profit", cells: [...fly.y1Months.map(m => fmtUgx(m.grossProfit)), fmtUgx(fly.y1Totals.grossProfit)], style: "total" },
      { label: "Scoped Operating Expenses", cells: [...fly.y1Months.map(m => fmtUgx(m.opex)), fmtUgx(fly.y1Totals.opex)] },
      { label: "EBITDA", cells: [...fly.y1Months.map(m => fmtUgx(m.ebitda)), fmtUgx(fly.y1Totals.ebitda)], style: "total" },
      { label: `Income Tax (${fmtPct1(fly.taxRate)})`, cells: [...fly.y1Months.map(m => fmtUgx(m.tax)), fmtUgx(fly.y1Totals.tax)] },
      { label: "Net Profit After Tax", cells: [...fly.y1Months.map(m => fmtUgx(m.pat)), fmtUgx(fly.y1Totals.pat)], style: "total" },
      { label: "Cumulative Cash Contribution", cells: [...fly.y1Months.map(m => fmtUgx(m.endCash)), fmtUgx(fly.y1Totals.endCash)], style: "footer" },
    ];
    const maxCash = Math.max(1, ...fly.y1Months.map(m => Math.abs(m.endCash)));
    return `<div class="metrics">
        <div class="panel metric"><span>Y1 Partner Bookings</span><div class="metric-value"><strong>${fmtUgx(fly.y1Totals.bookings)}</strong></div><small>Across ${fly.activeStreams.length} Fly Express streams</small></div>
        <div class="panel metric"><span>Y1 Commission Revenue</span><div class="metric-value"><strong>UGX ${fmtM(fly.y1Totals.totalRevenue)}</strong></div><small>Retained Peebee fees &amp; commissions</small></div>
        <div class="panel metric"><span>Y1 EBITDA</span><div class="metric-value"><strong>UGX ${fmtM(fly.y1Totals.ebitda)}</strong></div><small>No vehicle lease or driver payroll burden</small></div>
        <div class="panel metric"><span>Y1 Ending Cash Contribution</span><div class="metric-value"><strong>UGX ${fmtM(fly.y1Totals.endCash)}</strong></div><small>After tax &amp; receivables timing</small></div>
      </div>
      <section class="panel">
        <h2>Year 1 Monthly Fly Express Commission Ramp (UGX)</h2>
        ${renderTable(escape, "Line Item (UGX)", cols, rows)}
      </section>
      <section class="panel">
        <h2>Year 1 Cumulative Cash Contribution</h2>
        <ul class="plot">
          ${fly.y1Months.map(m => `<li><span>${escape(m.label)}</span><span class="track"><span class="bar" style="width:${Math.max(0, 100 * m.endCash / maxCash).toFixed(1)}%"></span></span><strong>UGX ${fmtUgx(m.endCash)}</strong></li>`).join("")}
        </ul>
      </section>`;
  }

  function renderFlyIntegratedModel(escape, fly, horizonModel) {
    const rows = horizonModel.rows;
    const t = horizonModel.totals;
    const h = horizonModel.horizon;
    const cols = [...rows.map(r => `Year ${r.yearIndex} (${r.calendarYear})`), `${h}-Year Total / End`];
    const tableRows = [
      { section: "A. Partner Commission Drivers" },
      { label: "Partner Bookings / Units", cells: [...rows.map(r => fmtUgx(r.bookings)), fmtUgx(t.bookings)] },
      { label: "Gross Fare Volume Processed (UGX)", cells: [...rows.map(r => fmtUgx(r.volume)), fmtUgx(t.volume)] },
      { section: "B. Income Statement (Fly Express Channel)" },
      ...fly.streamTrackers.map((st, idx) => ({
        label: st.name,
        cells: [...rows.map(r => fmtUgx(r.streamTotals[idx]?.revenue ?? 0)), fmtUgx(rows.reduce((s, r) => s + (r.streamTotals[idx]?.revenue ?? 0), 0))],
        style: "detail",
      })),
      { label: "Total Peebee Revenue", cells: [...rows.map(r => fmtUgx(r.totalRevenue)), fmtUgx(t.totalRevenue)], style: "total" },
      { label: "Scoped Direct Costs / COGS", cells: [...rows.map(r => fmtUgx(r.cogs)), fmtUgx(t.cogs)] },
      { label: "Gross Profit", cells: [...rows.map(r => fmtUgx(r.grossProfit)), fmtUgx(t.grossProfit)], style: "total" },
      { label: "Gross Margin (%)", cells: [...rows.map(r => fmtPct1(r.grossMargin)), fmtPct1(t.grossMargin)], style: "detail" },
      { label: "Scoped Operating Expenses", cells: [...rows.map(r => fmtUgx(r.opex)), fmtUgx(t.opex)] },
      { label: "EBITDA", cells: [...rows.map(r => fmtUgx(r.ebitda)), fmtUgx(t.ebitda)], style: "total" },
      { label: "EBITDA Margin (%)", cells: [...rows.map(r => fmtPct1(r.ebitdaMargin)), fmtPct1(t.ebitdaMargin)], style: "detail" },
      { label: `Income Tax (${fmtPct1(fly.taxRate)})`, cells: [...rows.map(r => fmtUgx(r.tax)), fmtUgx(t.tax)] },
      { label: "Net Profit After Tax (PAT)", cells: [...rows.map(r => fmtUgx(r.pat)), fmtUgx(t.pat)], style: "total" },
      { section: "C. Cash Flow & Balance Sheet Contribution" },
      { label: "(-) Change in Net Working Capital", cells: [...rows.map(r => fmtUgx(-r.deltaNwc)), fmtUgx(-t.deltaNwc)] },
      { label: "Net Cash from Operating Activities (CFO)", cells: [...rows.map(r => fmtUgx(r.cfo)), fmtUgx(t.cfo)], style: "total" },
      { label: "Capital Expenditures (Fleet & Tech)", cells: [...rows.map(() => "0"), "0"] },
      { label: "Debt Principal & Interest", cells: [...rows.map(() => "0"), "0"] },
      { label: "Cumulative Cash Contribution", cells: [...rows.map(r => fmtUgx(r.endCash)), fmtUgx(t.endCash)], style: "total" },
      { label: "Accounts Receivable", cells: [...rows.map(r => fmtUgx(r.ar)), fmtUgx(rows[h - 1].ar)] },
      { label: "Retained Earnings Contribution", cells: [...rows.map(r => fmtUgx(r.retained)), fmtUgx(rows[h - 1].retained)] },
      { label: "Balance Sheet Check (Must Equal 0)", cells: [...rows.map(r => fmtUgx(Math.abs(r.bsCheck) < 1 ? 0 : r.bsCheck)), fmtUgx(Math.abs(rows[h - 1].bsCheck) < 1 ? 0 : rows[h - 1].bsCheck)] },
      { label: "Unlevered Free Cash Flow (FCFF)", cells: [...rows.map(r => fmtUgx(r.fcff)), fmtUgx(t.fcff)], style: "footer" },
    ];
    return `<section class="panel">
        <h2>TaxiPress · Fly Express ${h}-Year Financial Model (${fly.start.year} – ${fly.start.year + h - 1})</h2>
        <p class="muted">Asset-light partner commission model · Zero fleet CapEx · Zero fleet loan · Currency: UGX.</p>
        ${renderTable(escape, "Financial Line Item (UGX)", cols, tableRows)}
      </section>
      <section class="panel">
        <h2>${h}-Year Commission Valuation Summary</h2>
        <dl class="taxibee-dl">
          <div><dt>${h}-Year NPV @ 12.0%</dt><dd>UGX ${fmtUgx(horizonModel.valuation.npv12)}</dd></div>
          <div><dt>${h}-Year NPV @ 18.0%</dt><dd>UGX ${fmtUgx(horizonModel.valuation.npv18)}</dd></div>
        </dl>
      </section>`;
  }

  function renderFlyDebt(escape, guestMode) {
    return `<div class="metrics">
        <div class="panel metric"><span>Fleet Loan Balance</span><div class="metric-value"><strong>UGX 0</strong></div><small>No vehicle acquisition loan required</small></div>
        <div class="panel metric"><span>Annual Debt Service</span><div class="metric-value"><strong>UGX 0</strong></div><small>Zero interest or principal burden</small></div>
        <div class="panel metric"><span>Collateral Required</span><div class="metric-value"><strong>None</strong></div><small>Partner operators own &amp; insure vehicles</small></div>
        <div class="panel metric"><span>DSCR Target</span><div class="metric-value"><strong>N/A</strong></div><small>Debt-free commission structure</small></div>
      </div>
      <section class="panel">
        <h2>No Fleet Loan Under TaxiPress · Fly Express Mode</h2>
        <p class="muted">In Fly Express partner-commission mode, Peebee earns digital seat commissions, cash seat commissions, and seat-choice fees on third-party vehicles without taking on vehicle CapEx or a fleet loan.</p>
        ${!guestMode ? '<button type="button" class="button gold" data-taxibee-mode="vip-fleet">Switch to Taxibee · VIP Fleet to view Fleet Loan &amp; DSCR →</button>' : ""}
      </section>`;
  }

  function renderFlyStress(escape, fly) {
    const rows = fly.stressScenarios.map(s => ({
      label: s.name,
      cells: [
        `${Math.round(s.volumeMult * 100)}%`,
        s.rateDeltaPct === 0 ? "Plan" : `${s.rateDeltaPct > 0 ? "+" : ""}${s.rateDeltaPct.toFixed(1)} pp`,
        `${Math.round(s.fareMult * 100)}%`,
        fmtUgx(s.y1Revenue),
        fmtUgx(s.y5Revenue),
        fmtUgx(s.y5Ebitda),
        fmtUgx(s.y5EndCash),
        { html: `<span class="taxibee-badge ${s.y5Ebitda >= 0 ? "pass" : "warn"}">${escape(s.verdict)}</span>` },
      ],
    }));
    return `<section class="panel">
        <h2>TaxiPress · Fly Express Volume, Fare &amp; Commission Stress Matrix</h2>
        <p class="muted">Tests commission revenue and 5-year cash resilience under partner booking volume drops, commission compression, and ticket fare reductions. Because Fly Express carries UGX 0 fleet debt, downside shocks reduce margin without triggering debt-service default.</p>
        ${renderTable(escape, "Stress Scenario", ["Volume Mult.", "Commission Shift", "Fare Mult.", "Y1 Revenue (UGX)", "5Y Revenue (UGX)", "5Y EBITDA (UGX)", "5Y Cash (UGX)", "Resilience Verdict"], rows)}
      </section>`;
  }

  function renderView({ app, viewId, answers, guestMode, escape, onUpdate, onModeChange, onReset, onExport, onEditFlyExpress }) {
    const [, title, description] = viewById.get(viewId) || views[0];
    const isFly = answers.taxibeeMode === "fly-express";
    const model = isFly ? null : compute(answers);
    const fly = isFly ? computeFlyExpress(answers) : null;

    let body = "";
    if (isFly) {
      if (viewId === "taxibee-dashboard") body = renderFlyDashboard(escape, fly);
      else if (viewId === "taxibee-assumptions") body = renderFlyAssumptions(escape, fly, answers, guestMode);
      else if (viewId === "taxibee-ramp") body = renderFlyRamp(escape, fly);
      else if (viewId === "taxibee-3y") body = renderFlyIntegratedModel(escape, fly, fly.model3y);
      else if (viewId === "taxibee-5y") body = renderFlyIntegratedModel(escape, fly, fly.model5y);
      else if (viewId === "taxibee-debt") body = renderFlyDebt(escape, guestMode);
      else if (viewId === "taxibee-stress") body = renderFlyStress(escape, fly);
    } else {
      if (viewId === "taxibee-dashboard") body = renderDashboard(escape, model);
      else if (viewId === "taxibee-assumptions") body = renderAssumptions(escape, model, answers, guestMode);
      else if (viewId === "taxibee-ramp") body = renderRamp(escape, model);
      else if (viewId === "taxibee-3y") body = renderIntegratedModel(escape, model, model.model3y);
      else if (viewId === "taxibee-5y") body = renderIntegratedModel(escape, model, model.model5y);
      else if (viewId === "taxibee-debt") body = renderDebt(escape, model, answers, guestMode);
      else if (viewId === "taxibee-stress") body = renderStress(escape, model, answers, guestMode);
    }

    const headingTitle = isFly ? `TaxiPress (Fly Express) · ${title}` : `Taxibee (VIP Fleet) · ${title}`;
    const headingSub = isFly
      ? `TAXIPRESS · FLY EXPRESS PARTNER COMMISSION MODEL · ${fly.activeStreams.length} Active Streams · Asset-Light (UGX 0 Fleet Loan)`
      : `TAXIBEE (PEEBEE GROUP LTD) · Launch ${model.inputs.raw.taxibeeConfig[0].launchStart} · Launch Financing UGX ${fmtM(model.capital.totalSources)} (${fmtM(model.inputs.udbEquity)} Equity + ${fmtM(model.inputs.udbLoan)} Loan @ ${(model.inputs.loanRate * 100).toFixed(2).replace(/\.?0+$/, "")}% p.a.) · ${description}`;

    app.innerHTML = `<div class="taxibee-root"><header class="workbook-sheet-heading">
        <h1 id="workbook-sheet-title" tabindex="-1">${escape(headingTitle)}</h1>
        <p class="muted">${escape(headingSub)}</p>
      </header>
      <div class="stack">
        ${modeBanner(escape, model, answers, guestMode)}
        ${body}
      </div></div>`;

    const root = app.querySelector(".taxibee-root");
    root.querySelectorAll("[data-taxibee-mode]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (guestMode || btn.getAttribute("aria-pressed") === "true") return;
        onModeChange(btn.dataset.taxibeeMode);
      });
    });

    root.querySelector("#taxibee-export-csv")?.addEventListener("click", () => {
      onExport(exportCsvRows(answers), isFly ? "taxipress-fly-express-model" : "taxibee-vip-fleet-model");
    });

    root.querySelector("#taxibee-edit-fly-advanced")?.addEventListener("click", () => {
      onEditFlyExpress?.();
    });

    root.querySelector("#taxibee-reset-defaults")?.addEventListener("click", () => {
      onReset(() => {
        const fresh = defaultState();
        onUpdate({ ...answers, ...fresh, taxibeeMode: answers.taxibeeMode || fresh.taxibeeMode });
      });
    });

    if (!guestMode) {
      root.addEventListener("change", event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.dataset.flyIdx !== undefined) {
          const idx = Number(input.dataset.flyIdx);
          const list = Array.isArray(answers["channel-taxipress"]) ? answers["channel-taxipress"].map(r => ({ ...r })) : [];
          if (!list[idx]) return;
          if (input.dataset.flyToggle === "enabled") {
            if (input.checked) delete list[idx].enabled;
            else list[idx].enabled = "no";
          } else if (input.dataset.flyField) {
            list[idx][input.dataset.flyField] = input.value.trim().slice(0, 160);
            if (input.dataset.flyField === "rate" || input.dataset.flyField === "price") list[idx].adminFee = "override";
          }
          onUpdate({ ...answers, "channel-taxipress": list });
          return;
        }
        const state = readState(answers);
        let changed = false;
        if (input.dataset.tbConfig) {
          state.taxibeeConfig = [{ ...state.taxibeeConfig[0], [input.dataset.tbConfig]: input.value.trim().slice(0, 160) }];
          changed = true;
        } else if (input.dataset.tbSched !== undefined && input.dataset.tbField) {
          const idx = Number(input.dataset.tbSched);
          state.taxibeeSchedule = state.taxibeeSchedule.map((row, i) =>
            i === idx ? { ...row, [input.dataset.tbField]: input.value.trim().slice(0, 160) } : row);
          changed = true;
        } else if (input.dataset.tbRamp !== undefined) {
          const idx = Number(input.dataset.tbRamp);
          state.taxibeeRamp = state.taxibeeRamp.map((row, i) =>
            i === idx ? { ...row, load: input.value.trim().slice(0, 160) } : row);
          changed = true;
        } else if (input.dataset.tbStress !== undefined && input.dataset.tbField) {
          const idx = Number(input.dataset.tbStress);
          state.taxibeeStress = state.taxibeeStress.map((row, i) =>
            i === idx ? { ...row, [input.dataset.tbField]: input.value.trim().slice(0, 160) } : row);
          changed = true;
        }
        if (changed) onUpdate({ ...answers, ...state });
      });
    }
  }

  globalThis.TaxibeeUI = { views, viewSet, viewById, renderView };
})();
