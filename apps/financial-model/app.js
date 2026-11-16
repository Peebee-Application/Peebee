(() => {
  const { questions, sections, example, errorFor } = globalThis.FinancialAssumptions;
  const { build, reports, sum } = globalThis.FinancialModel;
  const app = document.querySelector("#app");
  const exampleButton = document.querySelector("#example");
  const newModelButton = document.querySelector("#new-model");
  const storageKey = "peebee-financial-model-v1";
  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const currencyOf = answers => (answers.currency === "other" ? answers.customCurrency : answers.currency || "").toUpperCase();
  const reportOptions = [{ id: "overview", name: "Overview" }, ...reports];
  const activeQuestions = answers => questions.filter(prompt => !prompt.when || prompt.when(answers));
  const firstMissing = answers => activeQuestions(answers).find(prompt => errorFor(prompt, answers[prompt.id], answers));
  const readDraft = () => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      const answers = Object.fromEntries(questions.filter(q => typeof data?.answers?.[q.id] === "string")
        .map(q => [q.id, data.answers[q.id].slice(0, 160)]));
      return { answers, step: data?.step, screen: data?.screen };
    } catch {
      return { answers: {} };
    }
  };
  let { answers, step, screen } = readDraft();
  const pending = firstMissing(answers);
  if (pending) {
    screen = "wizard";
    if (!activeQuestions(answers).some(prompt => prompt.id === step)) step = pending.id;
  } else if (screen !== "report") {
    screen = screen === "wizard" ? "wizard" : "review";
  }
  let editing = false;
  let selectedCase = "Base";
  let selectedReport = "overview";
  let frequency = "Annual";
  let outcomes;
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ answers, step, screen })); } catch { /* Browser storage can be unavailable. */ }
  };

  function render(focusId) {
    exampleButton.hidden = screen !== "wizard";
    newModelButton.hidden = screen === "wizard";
    if (screen === "report") renderReport();
    else if (screen === "review") renderReview();
    else renderQuestion();
    if (focusId) document.getElementById(focusId)?.focus();
  }

  function renderQuestion() {
    const list = activeQuestions(answers);
    const index = Math.max(0, list.findIndex(prompt => prompt.id === step));
    const prompt = list[index];
    step = prompt.id;
    const sectionIndex = sections.indexOf(prompt.section);
    const sectionQuestions = list.filter(item => item.section === prompt.section);
    const sectionStep = sectionQuestions.indexOf(prompt) + 1;
    const done = list.filter(item => !errorFor(item, answers[item.id], answers)).length;
    const value = answers[step] || "";
    const unit = prompt.unit === "currency" ? currencyOf(answers) : prompt.unit;
    const input = prompt.type === "select"
      ? `<select id="answer" aria-labelledby="question-title" aria-describedby="hint error"><option value="">Select an option</option>${prompt.choices.map(([id, label]) => `<option value="${id}" ${id === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`
      : `<div class="field-box"><input id="answer" type="${prompt.type}" autocomplete="off" aria-labelledby="question-title" aria-describedby="hint error${unit ? " unit" : ""}" ${prompt.type === "text" ? 'maxlength="160"' : ""} ${prompt.type === "number" ? `min="${prompt.min}" max="${prompt.withinForecast ? Number(answers.months) : prompt.max}" step="${prompt.step || "any"}"` : ""}
        value="${escape(value)}" placeholder="${escape(prompt.placeholder ?? "")}">${unit ? `<span id="unit">${escape(unit)}</span>` : ""}</div>`;
    app.innerHTML = `<div class="layout">
      <nav class="rail" aria-label="Assumption sections"><h2>Model assumptions</h2><ol class="steps">
        ${sections.map((section, i) => {
          const complete = i < sectionIndex && list.filter(item => item.section === section).every(item => !errorFor(item, answers[item.id], answers));
          return `<li><button type="button" data-section="${i}" ${i === sectionIndex ? 'aria-current="step"' : ""} ${i > sectionIndex ? "disabled" : ""}><span aria-hidden="true" class="dot">${complete ? "✓" : i + 1}</span>${section}</button></li>`;
        }).join("")}
      </ol></nav>
      <form class="question" id="question-form" novalidate>
        <div class="progress-head"><span>${prompt.section} · Section ${sectionIndex + 1} of ${sections.length}</span><span>Question ${sectionStep} of ${sectionQuestions.length}</span></div>
        <progress aria-label="Applicable assumptions answered" value="${done}" max="${list.length}"></progress>
        <h1 id="question-title">${escape(prompt.label)}</h1>
        <p class="hint" id="hint">${escape(prompt.hint)}</p>
        ${input}
        <p id="error" class="error" role="alert" hidden></p>
        ${prompt.suggestion ? `<p class="suggestion"><button type="button" id="suggestion" class="text-button">Use ${escape(prompt.suggestion)}</button></p>` : ""}
        <div class="actions"><button type="button" id="back" class="button secondary" ${!index && !editing ? "disabled" : ""}>${editing ? "Cancel edit" : "Back"}</button>
          <button type="submit" class="button gold">${editing ? "Save answer" : index === list.length - 1 ? "Review assumptions" : "Continue"} <span aria-hidden="true">→</span></button></div>
      </form></div>`;
    const field = document.querySelector("#answer");
    const error = document.querySelector("#error");
    const capturedValue = () => field.value.trim();
    field.addEventListener("input", () => {
      field.removeAttribute("aria-invalid");
      error.hidden = true;
      if (!editing) {
        answers[step] = capturedValue();
        save();
      }
    });
    document.querySelector("#suggestion")?.addEventListener("click", () => {
      field.value = prompt.suggestion;
      field.dispatchEvent(new Event("input"));
      field.focus();
    });
    document.querySelector("#question-form").addEventListener("submit", event => {
      event.preventDefault();
      const inputValue = capturedValue();
      const issue = errorFor(prompt, inputValue, answers);
      if (issue) {
        error.textContent = issue;
        error.hidden = false;
        field.setAttribute("aria-invalid", "true");
        field.focus();
        return;
      }
      answers[step] = inputValue;
      const wasEditing = editing;
      editing = false;
      const current = activeQuestions(answers);
      const next = current[current.indexOf(prompt) + 1];
      if (next && !wasEditing) goTo(next.id);
      else showReview();
    });
    document.querySelector("#back").addEventListener("click", () => {
      if (editing) {
        editing = false;
        showReview();
      } else if (index) goTo(list[index - 1].id);
    });
    app.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => {
      editing = false;
      goTo(list.find(item => item.section === sections[Number(button.dataset.section)]).id);
    }));
  }

  function goTo(id, edit = false) {
    editing = edit;
    step = id;
    screen = "wizard";
    save();
    render("answer");
  }

  function showReview() {
    const missing = firstMissing(answers);
    if (missing) {
      goTo(missing.id);
      return;
    }
    screen = "review";
    save();
    render("review-title");
  }

  function displayAnswer(prompt, value) {
    if (prompt.type === "select") return prompt.choices.find(([id]) => id === value)?.[1] || "";
    if (prompt.type !== "number") return value;
    const unit = prompt.unit === "currency" ? currencyOf(answers) : prompt.unit;
    return `${numberFormat.format(value)}${unit === "%" ? "%" : unit ? " " + unit : ""}`;
  }

  function renderReview() {
    const list = activeQuestions(answers);
    app.innerHTML = `<div class="review-head"><div><h1 id="review-title" tabindex="-1">Review assumptions</h1><p class="muted">${escape(answers.company)} · ${escape(currencyOf(answers))}</p></div>
      <button type="button" id="generate" class="button gold">Generate forecast <span aria-hidden="true">→</span></button></div>
      <div class="review-grid">${sections.map(section => `<section class="panel"><h2>${section}</h2><dl>${list.filter(prompt => prompt.section === section).map(prompt =>
        `<div><dt>${escape(prompt.label)}</dt><dd><button class="text-button" data-edit="${prompt.id}" aria-label="${escape("Edit: " + prompt.label)}">${escape(displayAnswer(prompt, answers[prompt.id]))}</button></dd></div>`).join("")}</dl></section>`).join("")}</div>`;
    app.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => goTo(button.dataset.edit, true)));
    document.querySelector("#generate").addEventListener("click", () => {
      if (firstMissing(answers)) return showReview();
      screen = "report";
      outcomes = null;
      selectedReport = "overview";
      selectedCase = "Base";
      frequency = "Annual";
      save();
      render("report-title");
    });
  }

  function modelAnswers() {
    return Object.fromEntries(activeQuestions(answers).map(prompt => [prompt.id, answers[prompt.id]]));
  }

  const lineValue = (row, field) => typeof field === "function" ? field(row) : row[field];
  const format = (value, style) => value === null ? "—" : (style === "rate" ? percentFormat : numberFormat).format(value === 0 || (style !== "rate" && Math.abs(value) < 0.005) ? 0 : value);
  const money = value => `${currencyOf(answers)} ${format(value)}`;
  const table = (name, columns, rows) => `<div class="table-wrap" tabindex="0" role="region" aria-label="${escape(name)}">
    <table aria-label="${escape(name)}"><thead><tr><th scope="col">${escape(name)}</th>${columns.map(label => `<th scope="col">${escape(label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, cells, total]) => `<tr${total ? ' class="total"' : ""}><th scope="row">${escape(label)}</th>${cells.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const metric = (label, value, context) => `<div class="panel metric"><span>${label}</span><strong>${escape(value)}</strong><small>${escape(context)}</small></div>`;
  const radio = (items, selected, type) => items.map(([id, label]) =>
    `<button type="button" id="${type}-${id}" data-${type}="${id}" aria-pressed="${id === selected}">${escape(label)}</button>`).join("");

  function overview(model) {
    const yearOne = model.months.slice(0, 12);
    const yearOneLabel = `First ${yearOne.length} ${yearOne.length === 1 ? "month" : "months"}`;
    const last = model.months.at(-1);
    const maxRevenue = Math.max(1, ...model.annual.map(row => row.revenue));
    const comparison = [
      ["Monthly sales growth", item => format(item.growth, "rate")],
      ["Total forecast revenue", item => money(sum(item.months, "revenue"))],
      ["Total forecast EBITDA", item => money(sum(item.months, "ebitda"))],
      ["Ending cash", item => money(item.months.at(-1).cash)],
      ["Peak funding gap", item => money(item.fundingGap)],
    ];
    if (model.valuation) comparison.push(["DCF enterprise value", item => money(item.valuation.enterprise)]);
    return `<div class="metrics">
      ${metric("Revenue", money(sum(yearOne, "revenue")), yearOneLabel)}
      ${metric("EBITDA", money(sum(yearOne, "ebitda")), yearOneLabel)}
      ${metric("Ending cash", money(last.cash), last.period)}
      ${metric("Peak funding gap", money(model.fundingGap), model.shortfall ? `Lowest cash in ${model.lowCash.period}` : "Cash stays at or above zero")}
      </div>
      ${model.shortfall ? `<p class="notice">Cash first falls below zero in <strong>${model.shortfall.period}</strong>. The forecast shows the shortfall before any additional financing.</p>` : ""}
      <div class="stack"><section class="panel"><h2>Revenue by calendar year</h2><ul class="plot">
        ${model.annual.map(row => `<li><span>${row.period}</span><span class="track" aria-hidden="true"><span class="bar" style="width:${100 * row.revenue / maxRevenue}%"></span></span><strong title="${escape(money(row.revenue))}">${escape(compactFormat.format(row.revenue))}</strong></li>`).join("")}
      </ul></section>
      ${outcomes.length > 1 ? `<section class="panel"><h2>Scenario comparison</h2>${table("Metric", outcomes.map(item => item.name), comparison.map(([label, read]) => [label, outcomes.map(read)]))}</section>` : ""}
      ${model.valuation ? `<section class="panel"><h2>Discounted cash flow</h2><dl>
        <div><dt>Present value of forecast cash flows</dt><dd>${escape(money(model.valuation.pvFlows))}</dd></div>
        <div><dt>Present value of the exit value</dt><dd>${escape(money(model.valuation.pvExit))}</dd></div>
        <div><dt>Enterprise value</dt><dd>${escape(money(model.valuation.enterprise))}</dd></div>
        <div><dt>Equity value after opening cash and debt</dt><dd>${escape(money(model.valuation.equity))}</dd></div>
      </dl></section>` : ""}
      <details class="panel"><summary>Model methodology</summary>
        <p class="muted">Revenue grows monthly from one sales driver. Payroll and overhead change at forecast anniversaries. Receivables use sales, inventory uses direct costs, and payables use purchases on a 30-day basis. Purchases stay at or above zero, so inventory above target runs down through sales.</p>
        <p class="muted">Fixed assets depreciate straight-line. Debt uses equal principal payments. Opening equity is derived from opening assets and liabilities. Corporate income tax is paid monthly on positive profit. The model excludes VAT, historical statements, and tax loss carryforwards.</p>
        <p class="muted">Annual flows sum the included months. Balance sheet values use the final month of each calendar year shown. Any cash shortfall remains visible until funding or operating cash flow covers it.</p>
      </details></div>`;
  }

  function visibleLines(report) {
    return report.lines.filter(([, , , method]) => !method || method === answers.revenueMethod);
  }

  function renderReport() {
    outcomes ||= build(modelAnswers());
    const model = outcomes.find(item => item.name === selectedCase);
    const report = reports.find(item => item.id === selectedReport);
    const rows = frequency === "Annual" ? model.annual : model.months;
    const options = [`<div class="segmented" role="group" aria-label="Scenario">${radio(outcomes.map(item => [item.name, item.name]), selectedCase, "case")}</div>`,
      report ? `<div class="segmented" role="group" aria-label="Reporting period">${radio([["Annual", "Annual"], ["Monthly", "Monthly"]], frequency, "frequency")}</div>` : ""];
    app.innerHTML = `<div class="report-head"><div><h1 id="report-title" tabindex="-1">${escape(answers.company)}</h1>
        <p class="muted">Financial forecast · ${escape(currencyOf(answers))} · ${model.months[0].period} to ${model.months.at(-1).period}</p></div>
        <div class="toolbar"><button type="button" id="review" class="button secondary">Edit assumptions</button>
        <button type="button" id="download" class="button gold">Download model CSV <span aria-hidden="true">↓</span></button></div></div>
      <nav class="report-nav" aria-label="Financial reports">${radio(reportOptions.map(item => [item.id, item.name]), selectedReport, "report")}</nav>
      ${outcomes.length > 1 || report ? `<div class="toolbar">${options.slice(outcomes.length > 1 ? 0 : 1).join("")}
        ${report ? '<button type="button" id="download-report" class="button secondary small">Download this view</button>' : ""}</div>` : ""}
      ${report ? table(report.name, rows.map(row => row.period), visibleLines(report).map(([label, field, style]) =>
        [label, rows.map(row => format(lineValue(row, field), style)), style === "total"])) : overview(model)}`;
    document.querySelector("#review").addEventListener("click", showReview);
    document.querySelector("#download").addEventListener("click", downloadAll);
    document.querySelector("#download-report")?.addEventListener("click", () => {
      download([["Company", answers.company], ["Currency", currencyOf(answers)], ["Scenario", model.name], ...csvTable(report, rows)],
        `${model.name.toLowerCase()}-${frequency.toLowerCase()}-${report.id}`);
    });
    for (const [type, select] of [
      ["case", value => { selectedCase = value; }],
      ["report", value => { selectedReport = value; }],
      ["frequency", value => { frequency = value; }],
    ]) {
      app.querySelectorAll(`[data-${type}]`).forEach(button => button.addEventListener("click", () => {
        select(button.dataset[type]);
        render(button.id);
      }));
    }
  }

  function csvTable(report, rows) {
    return [[report.name, ...rows.map(row => row.period)], ...visibleLines(report).map(([label, field, style]) =>
      [style === "rate" ? `${label} (%)` : label, ...rows.map(row => {
        const value = lineValue(row, field);
        return value === null ? "" : Number((style === "rate" ? value * 100 : value).toFixed(6));
      })])];
  }

  function downloadAll() {
    const rows = [["Company", answers.company], ["Currency", currencyOf(answers)], [], ["Assumptions", "Value"]];
    for (const prompt of activeQuestions(answers)) rows.push([prompt.label, displayAnswer(prompt, answers[prompt.id])]);
    for (const model of outcomes) {
      rows.push([], ["Scenario", model.name], ["Monthly sales growth (%)", model.growth * 100], ["Peak funding gap", model.fundingGap],
        ["First negative cash month", model.shortfall?.period || ""], ["Lowest cash month", model.lowCash.period]);
      if (model.valuation) rows.push(["Present value of forecast cash flows", model.valuation.pvFlows], ["Present value of exit value", model.valuation.pvExit],
        ["DCF enterprise value", model.valuation.enterprise], ["DCF equity value", model.valuation.equity]);
      for (const [label, periods] of [["Annual", model.annual], ["Monthly", model.months]]) {
        rows.push([], [label]);
        for (const report of reports) rows.push(...csvTable(report, periods), []);
      }
    }
    download(rows, "financial-model");
  }

  function download(rows, suffix) {
    const csvCell = value => {
      if (typeof value === "number") return String(value);
      const text = String(value ?? "");
      const sanitized = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u.test(text) ? "'" + text : text;
      return '"' + sanitized.replaceAll('"', '""') + '"';
    };
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${answers.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "company"}-${suffix}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  newModelButton.addEventListener("click", () => {
    if (!window.confirm("Start a new model and replace the current draft?")) return;
    answers = {};
    outcomes = null;
    goTo("company");
  });

  exampleButton.addEventListener("click", () => {
    if (Object.values(answers).some(Boolean) && !window.confirm("Replace the current draft with the example?")) return;
    answers = { ...example };
    editing = false;
    showReview();
  });

  render();
})();
