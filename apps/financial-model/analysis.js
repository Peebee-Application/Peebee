(() => {
  const comparisonMetrics = [["revenue", "Revenue"], ["ebitda", "EBITDA"], ["cash", "Ending cash"]];
  const measure = (key, label) => [label, row => row[key]];
  const rate = key => row => {
    const value = row[key] / row.revenue;
    return Number.isFinite(value * 100) ? value : null;
  };

  function buildAnalysis({ model, outcomes, rows, frequency, answers, groups, state }) {
    const sourceRows = frequency === "Annual" ? "annual" : "months";
    const from = Math.min(state.from ?? 0, rows.length - 1);
    const to = Math.min(Math.max(from, state.to ?? rows.length - 1), rows.length - 1);
    const selected = rows.slice(from, to + 1);
    const periods = selected.map(row => row.period);
    const chart = (id, title, description, measures, options = {}) => ({
      id, title, description, periods, ...options,
      series: measures.map(([label, read]) => ({ label, values: selected.map(read) })),
    });

    const fixedCosts = answers.directCosts.flatMap((item, index) => item.basis === "fixed" ? [index] : []);
    const variableRate = answers.directCosts.reduce((total, item) => total + (item.basis === "rate" ? Number(item.rate) / 100 : 0), 0);
    const useForecastMargin = answers.directCosts.some(item => item.basis === "inventory" || (item.basis === "rate" && item.revenueStreamIndexes && Number(item.rate) > 0));
    const contribution = 1 - variableRate;
    const breakEven = row => {
      const fixedDirectCosts = fixedCosts.reduce((total, index) => total + row.details.directCosts[index].cogs, 0);
      if (useForecastMargin && !row.revenue) return null;
      const margin = useForecastMargin ? 1 - (row.cogs - fixedDirectCosts) / row.revenue : contribution;
      return margin > 1e-12 ? (row.payroll + row.overhead + fixedDirectCosts) / margin : null;
    };

    const charts = [
      chart("earnings", "Revenue and earnings", "Compare revenue, gross profit and EBITDA for each period.", [
        measure("revenue", "Revenue"), measure("gross", "Gross profit"), measure("ebitda", "EBITDA"),
      ]),
      chart("cash", "Cash and funding needs", "Closing cash below zero shows a funding need. Annual charts use the final month shown for each year.", [
        measure("cash", "Closing cash"), ["Funding needed", row => row.cashShortfall],
      ]),
      chart("cash-flow", "Cash flow by activity", "Compare cash generated or used by operations, investment and financing.", [
        measure("operating", "Operating"), measure("investing", "Investing"), measure("financing", "Financing"),
      ], { type: "bars" }),
      chart("margins", "Profit margins", "Margins use the revenue of each period. Periods with zero revenue have no margin.", [
        ["Gross margin", rate("gross")], ["EBITDA margin", rate("ebitda")], ["Net margin", rate("profit")],
      ], { unit: "rate" }),
      chart("working-capital", "Working capital", "Compare closing receivables, inventory, payables and net working capital.", [
        measure("ar", "Receivables"), measure("stock", "Inventory"), measure("ap", "Payables"), measure("wc", "Net working capital"),
      ]),
      chart("break-even", "Operating break-even", useForecastMargin
        ? "Break-even revenue uses the forecast contribution margin for each period, including inventory costs and module-specific expenses."
        : contribution > 1e-12
        ? "Revenue needed to cover payroll, overhead and fixed direct costs after variable direct costs."
        : "Sales cannot cover fixed operating costs when variable direct costs consume 100% or more of revenue.", [
        measure("revenue", "Forecast revenue"), ["Break-even revenue", breakEven],
      ]),
    ];

    if (outcomes.length > 1) {
      const metric = comparisonMetrics.find(([key]) => key === state.metric) || comparisonMetrics[2];
      charts.push(chart("scenarios", "Scenario comparison", "Compare all modeled scenarios on the same scale and time window.",
        outcomes.map(item => [item.name, (_, i) => item[sourceRows][from + i][metric[0]]]),
        { metric: metric[0], metricLabel: metric[1] }));
    }

    const group = groups?.find(item => item.key === state.group);
    const components = groups && !group ? groups.map(item => ({ name: item.name, streams: item.streams }))
      : (group?.streams ?? answers.streams.map((stream, index) => ({ name: stream.name, index })))
        .map(stream => ({ name: stream.name, streams: [stream] }));
    const totals = answers.streams.map((_, index) => selected.reduce((total, row) => total + row.details.streams[index].revenue, 0));
    const totalRevenue = group ? group.streams.reduce((total, stream) => total + totals[stream.index], 0)
      : totals.reduce((total, value) => total + value, 0);
    const mix = components.map(({ name, streams }) => {
      const value = streams.reduce((total, stream) => total + totals[stream.index], 0);
      return { name, value, share: totalRevenue ? value / totalRevenue : null };
    }).sort((a, b) => b.value - a.value);
    return { charts, mix, groups, group, totalRevenue, rows, from, to, periods, frequency, scenario: model.name };
  }

  function exportRows(analysis, currency) {
    const rows = [["Scenario", analysis.scenario], ["Frequency", analysis.frequency],
      ["From", analysis.periods[0]], ["To", analysis.periods.at(-1)], ["Currency", currency]];
    for (const chart of analysis.charts) {
      rows.push([], [chart.metricLabel ? `${chart.title} · ${chart.metricLabel}` : chart.title],
        ["Period", ...chart.series.map(series => chart.unit === "rate" ? `${series.label} (%)` : series.label)]);
      chart.periods.forEach((period, i) => rows.push([period, ...chart.series.map(series => {
        const value = series.values[i];
        return value === null ? "" : chart.unit === "rate" ? value * 100 : value;
      })]));
    }
    rows.push([], [analysis.group ? `Revenue mix · ${analysis.group.name}` : "Revenue mix"],
      ["Source", "Revenue", "Share (%)"], ...analysis.mix.map(item => [item.name, item.value, item.share === null ? "" : item.share * 100]),
      ["Total", analysis.totalRevenue, analysis.totalRevenue > 0 ? 100 : ""]);
    return rows;
  }

  function monthlyEarnings(rows, currency) {
    const measures = [
      measure("revenue", "Revenue"),
      ["Cost of goods sold", row => -row.cogs],
      ["Expenses", row => -(row.payroll + row.overhead + row.depreciation + row.interest + row.tax)],
      measure("profit", "Net income"),
    ];
    return {
      id: "monthly-earnings",
      title: "Revenue and expenses",
      description: `Monthly forecast in ${currency}. Expenses include payroll, overhead, depreciation, interest, and tax.`,
      type: "stacked",
      periods: rows.map(row => row.period),
      series: measures.map(([label, read]) => ({ label, values: rows.map(read) })),
    };
  }

  function renderChart(chart, { escape, format, table }, controls = "") {
    const data = chart.periods.map((period, index) => [period, chart.series.map(item => format(item.values[index], chart.unit))]);
    return `<section class="panel analysis-card">
      <h2 id="analysis-heading-${chart.id}">${escape(chart.title)}</h2>
      <p class="muted">${escape(chart.description)}</p>
      ${controls}
      <ul class="chart-legend${chart.type ? ` chart-legend-${chart.type}` : ""}">${chart.series.map((series, i) => `<li><span class="legend-swatch swatch-${i}" aria-hidden="true"></span>${escape(series.label)}</li>`).join("")}</ul>
      <canvas class="forecast-chart" data-chart="${chart.id}" tabindex="0" aria-label="${escape(chart.title)}. Use the arrow keys to inspect forecast periods." aria-describedby="chart-readout-${chart.id}"></canvas>
      <div class="chart-readout" id="chart-readout-${chart.id}" aria-live="polite"></div>
      <details class="chart-data"><summary>View chart data</summary>
        ${table("Period", chart.series.map(item => item.label), data)}
      </details>
    </section>`;
  }

  function renderAnalysis(analysis, { escape, format, table, currency }) {
    const { charts, rows, from, to, mix, group, groups, totalRevenue } = analysis;
    const options = (items, selected) => items.map(([key, label]) => `<option value="${escape(key)}" ${key === selected ? "selected" : ""}>${escape(label)}</option>`).join("");
    const periods = rows.map((row, index) => [index, row.period]);
    const select = (id, label, items, selected) => `<label class="analysis-control" for="${id}"><span>${label}</span><select id="${id}">${options(items, selected)}</select></label>`;
    const chartsHtml = charts.map(chart => renderChart(chart, { escape, format, table },
      chart.metric ? select("analysis-metric", "Compare", comparisonMetrics, chart.metric) : ""));
    const mixHtml = `<section class="panel analysis-card">
      <h2>Revenue mix</h2>
      <p class="muted">Share of ${group ? "the selected channel’s" : "total"} revenue in the selected window.</p>
      ${groups ? select("analysis-group", "Breakdown", [["", "All channels"], ...groups.map(item => [item.key, item.name])], group?.key ?? "") : ""}
      ${totalRevenue > 0 ? `<dl class="mix-list">${mix.map(({ name, value, share }) => `<div>
        <dt>${escape(name)}</dt><dd>${escape(format(value))} <span class="muted">· ${escape(format(share, "rate"))}</span></dd>
        <span class="track" aria-hidden="true"><span class="bar" style="width:${share * 100}%"></span></span>
      </div>`).join("")}</dl>` : '<p class="muted">Revenue mix is unavailable when forecast revenue is zero.</p>'}
    </section>`;
    return `<section class="analysis-view" aria-label="Forecast analysis">
      <div class="analysis-head"><div><h2>Forecast analysis</h2><p class="muted">${escape(analysis.scenario)} case · Amounts in ${escape(currency)}</p></div>
      <div class="analysis-controls">${select("analysis-from", "From", periods, from)}${select("analysis-to", "To", periods, to)}
      <button type="button" id="analysis-download" class="button secondary small">Download analysis CSV</button></div></div>
      <div class="analysis-grid">${chartsHtml.slice(0, 2).join("")}${mixHtml}${chartsHtml.slice(2).join("")}</div>
    </section>`;
  }

  globalThis.FinancialAnalysis = { buildAnalysis, renderAnalysis, renderChart, monthlyEarnings, exportRows };
})();
