(() => {
  const { questions, sections, errorFor, itemError } = globalThis.FinancialAssumptions;
  const { fieldsFor, upgradeDraft } = globalThis.FinancialLineItems;
  const { build, firstMonthSale, expensePreview, reports, revenueDrivers, scheduleReports, statementReports, linesFor, sum, halfCent, ForecastRangeError } = globalThis.FinancialModel;
  const { questionsFor, consolidate, included, scopeMetadata, forecastModules } = globalThis.FinancialChannels;
  const { buildAnalysis, renderAnalysis, exportRows } = globalThis.FinancialAnalysis;
  const { company, catalog, technologyCosts, infrastructureRows, createDefaults, loadStarterRevenue } = globalThis.PeebeeDefaults;
  const dataNote = "Starter estimates model a launch scenario across all channels. Volumes, average values and unverified fees are illustrative. The scenario includes features that may be off in Admin. Apply available Admin fees to matching lines, and enter Peebee’s costs and opening balances.";
  const stepLabels = {
    currency: "Currency", customCurrency: "Currency code", start: "Forecast start", months: "Forecast length",
    channels: "Revenue channels", directCosts: "Direct costs", staff: "Staffing", expenses: "Operating expenses", tax: "Income tax",
    accounts: "Opening cash", receivables: "Receivables", payables: "Payables", ownedAssets: "Existing assets", investments: "Asset purchases",
    existingLoans: "Outstanding loans", newLoans: "New loans", contributions: "Equity contributions",
    scenarios: "Scenario comparison", downside: "Downside growth", upside: "Upside growth",
    valuation: "DCF valuation", discountRate: "Discount rate", exitValue: "Exit value",
  };
  const stepLabel = item => item.title || stepLabels[item.id] || item.label;
  const app = document.querySelector("#app");
  const storageKey = "peebee-financial-model-multichannel-v1";
  const autosaveKey = "peebee-financial-model-autosave";
  const settingsDialog = document.querySelector("#settings-dialog");
  const unsavedDialog = document.querySelector("#unsaved-dialog");
  const autosaveControls = document.querySelectorAll("[data-autosave]");
  const online = location.hostname === "financials.peebee.online";
  let autosave = false;
  if (!online) {
    try { autosave = localStorage.getItem(autosaveKey) === "true"; } catch { /* This tab still supports the preference. */ }
  }
  function setAutosave(value) {
    autosave = value;
    for (const toggle of autosaveControls) toggle.checked = value;
  }
  setAutosave(autosave);
  for (const control of autosaveControls) {
    control.addEventListener("change", () => {
      if (online) void savePreference("autosave", control.checked);
      else {
        setAutosave(control.checked);
        try { localStorage.setItem(autosaveKey, String(autosave)); } catch { /* Keep the preference in this tab. */ }
      }
    });
  }
  document.querySelector("#open-settings").addEventListener("click", () => settingsDialog.showModal());
  const confirmation = document.querySelector("#confirm-action");
  let confirmedAction;
  function confirmAction(title, detail, label, action) {
    confirmation.querySelector("#confirm-action-title").textContent = title;
    confirmation.querySelector("#confirm-action-detail").textContent = detail;
    confirmation.querySelector("#confirm-action-submit").textContent = label;
    confirmation.returnValue = "";
    confirmedAction = action;
    confirmation.showModal();
  }

  confirmation.addEventListener("close", () => {
    const action = confirmedAction;
    confirmedAction = undefined;
    if (confirmation.returnValue === "confirm") action?.();
  });

  const reportLinks = reports.map(({ id, name }) => [id, name]);
  const navigation = [
    { id: "home", name: "Home", views: [["overview", "Dashboard"], ["intro", "Intro"], ["analysis", "Analysis"]] },
    { id: "model", name: "Model", views: [["assumptions", "Assumptions"], ["workbook-settings", "Forecast settings"]] },
    { id: "schedules", name: "Schedules", views: [["channel-revenue", "Revenue"], ...scheduleReports.map(({ id, name }) => [id, name]),
      ...reportLinks.filter(([id]) => id === "schedules")] },
    { id: "statements", name: "Statements", views: [...statementReports.map(({ id, name }) => [id, name]),
      ...reportLinks.filter(([id]) => id !== "schedules")] },
  ];
  const primaryNav = document.querySelector("#primary-nav");
  const secondaryNav = document.querySelector("#secondary-nav");
  let menuGroup;

  function currentView() {
    if (screen === "report") return selectedReport;
    if (screen === "intro" || screen === "workbook-settings") return screen;
    return "assumptions";
  }

  function renderNavigation() {
    const view = currentView();
    const group = navigation.find(item => item.id === menuGroup) || navigation.find(item => item.views.some(([id]) => id === view));
    primaryNav.innerHTML = radio(navigation.map(item => [item.id, item.name]), group.id, "primary");
    secondaryNav.innerHTML = radio(group.views, view, "view");
  }

  function openView(view, focusId) {
    if (view === currentView() && screen !== "wizard") return;
    navigate(() => {
      if (view === "assumptions") return showReview();
      if (view === "intro" || view === "workbook-settings") {
        screen = view;
      } else {
        const missing = firstMissing(answers);
        if (missing) return goTo(missing.id, true);
        screen = "report";
        selectedReport = view;
      }
      editing = false;
      save();
      render(focusId);
    });
  }

  primaryNav.addEventListener("click", event => {
    const button = event.target.closest("[data-primary]");
    if (!button || button.getAttribute("aria-pressed") === "true") return;
    const group = navigation.find(item => item.id === button.dataset.primary);
    const destination = group.views[0][0];
    if (destination !== "assumptions" && firstMissing(answers)) {
      menuGroup = group.id;
      renderNavigation();
      document.getElementById(button.id).focus();
      return;
    }
    openView(destination, button.id);
  });
  secondaryNav.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (button) openView(button.dataset.view, button.id);
  });

  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const currencyOf = answers => ((answers.currency === "other" ? answers.customCurrency : answers.currency) || "").toUpperCase();
  const availableQuestions = answers => questionsFor(questions, answers);
  const activeQuestions = answers => availableQuestions(answers).filter(prompt => !prompt.when || prompt.when(answers));
  function firstMissing(answers) {
    return activeQuestions(answers).find(prompt => {
      const value = answers[prompt.id];
      if (!prompt.channelId) return errorFor(prompt, value, answers);
      if (!included(answers.channels.find(channel => channel.key === prompt.channelId))) return false;
      const active = Array.isArray(value) ? value.filter(included) : value;
      return Array.isArray(value) && value.length && !active.length ? false : errorFor(prompt, active, answers);
    });
  }
  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; }
  };
  const readDraft = data => {
    try {
      if (!data?.answers) return { answers: createDefaults(), screen: "review" };
      const upgraded = upgradeDraft(data.answers);
      const answers = { company: upgraded.company === "Peebee (illustrative)" ? upgraded.company : company };
      for (const prompt of availableQuestions(upgraded)) {
        const value = upgraded[prompt.id];
        if (prompt.type === "items" && Array.isArray(value)) {
          answers[prompt.id] = value.filter(row => row && typeof row === "object").map(row => {
            const fields = Object.fromEntries(prompt.fields.filter(field => typeof row[field.id] === "string")
              .map(field => [field.id, row[field.id].slice(0, 160)]));
            if (prompt.keyed) return { ...fields, key: row.key, ...scopeMetadata(prompt.id, row) };
            return prompt.channelId ? { ...fields, ...scopeMetadata(prompt.id, row) } : fields;
          });
        } else if (typeof value === "string") {
          answers[prompt.id] = value.slice(0, 160);
        }
      }
      return { answers, step: data.step, screen: data.screen, editing: data.screen === "wizard" && data.editing === true };
    } catch {
      return { answers: createDefaults(), screen: "review" };
    }
  };
  const session = globalThis.SharedForecastSession;
  if (!session && location.hostname === "financials.peebee.online") {
    document.querySelector("#open-settings").hidden = true;
    app.innerHTML = '<p class="notice" role="alert">The Admin session could not load. Refresh the page to try again.</p>';
    return;
  }
  const localDraft = readLocal();
  let { answers, step, screen, editing = false } = readDraft(session ? null : localDraft);
  let revision = null;
  let savedAnswers;
  let queuedAnswers;
  let saving = false;
  let saveError;
  let sharedReady = !session;
  let loadingShared = false;
  let account;
  let preferences;
  const statusBar = document.querySelector("#shared-save");
  const sharedStatus = document.querySelector("#shared-status");
  const retrySave = document.querySelector("#retry-save");
  const reloadShared = document.querySelector("#reload-shared");
  const publishLocal = document.querySelector("#publish-local");
  document.querySelector("#open-settings").hidden = !!session;
  if (screen === "report" && firstMissing(answers)) screen = "review";
  if (!["report", "wizard", "intro", "workbook-settings"].includes(screen)) screen = "review";
  let selectedCase = "Base";
  let selectedReport = "overview";
  let frequency = "Annual";
  let outcomes;
  let analysisState = { windows: {} };
  let detachCharts;
  let dashboardObserver;
  const save = () => {
    if (session) {
      if (!sharedReady) return false;
      const value = JSON.stringify(answers);
      if (value !== savedAnswers || queuedAnswers) {
        queuedAnswers = value;
        window.addEventListener("beforeunload", beforeUnload);
        if (!saveError) void flushShared();
      }
      return true;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ answers, step, screen, editing }));
      return true;
    } catch {
      return false;
    }
  };

  function showSaveStatus(message, error) {
    statusBar.hidden = false;
    sharedStatus.textContent = message;
    retrySave.hidden = !error || error.status === 409;
    reloadShared.hidden = error?.status !== 409;
  }

  async function flushShared() {
    if (saving || !queuedAnswers) return;
    saving = true;
    saveError = undefined;
    showSaveStatus("Saving shared forecast…");
    try {
      while (queuedAnswers) {
        const value = queuedAnswers;
        if (value === savedAnswers) {
          queuedAnswers = undefined;
          break;
        }
        const { draft } = await session.request("save", { revision, answers: JSON.parse(value) });
        revision = draft.revision;
        savedAnswers = value;
        publishLocal.hidden = true;
        if (queuedAnswers === value) queuedAnswers = undefined;
      }
      showSaveStatus("Shared forecast saved");
    } catch (error) {
      saveError = error;
      showSaveStatus(error.message, error);
    } finally {
      saving = false;
      if (!queuedAnswers && !activeEdit?.dirty()) window.removeEventListener("beforeunload", beforeUnload);
    }
  }

  retrySave.addEventListener("click", () => void flushShared());
  reloadShared.addEventListener("click", () => confirmAction(
    "Reload the shared forecast?",
    "This will discard your unsaved changes and open the latest version saved by another editor.",
    "Discard edits and reload",
    () => void loadShared()
  ));

  const accountButton = document.querySelector("#open-account");
  const accountDialog = document.querySelector("#account-dialog");
  const accountStatus = document.querySelector("#account-status");
  const passwordForm = document.querySelector("#password-form");
  const preferenceStatus = document.querySelector("#preference-status");
  const appearanceControl = document.querySelector("#appearance-mode");

  function updateAccount(user) {
    account = user;
    accountButton.hidden = false;
    accountDialog.querySelector("#account-identity").textContent =
      [user.name, user.email || user.phone, "Peebee Admin"].filter(Boolean).join(" · ");
  }

  accountButton.addEventListener("click", () => {
    passwordForm.reset();
    accountStatus.textContent = "";
    accountDialog.showModal();
  });

  passwordForm.addEventListener("submit", async event => {
    event.preventDefault();
    const { currentPassword, newPassword, confirmation } = Object.fromEntries(new FormData(passwordForm));
    if (newPassword !== confirmation) {
      accountStatus.textContent = "The new passwords do not match.";
      return;
    }
    const button = passwordForm.querySelector("button");
    button.disabled = true;
    accountStatus.textContent = "Changing password…";
    try {
      const { user } = await session.request("password", { currentPassword, newPassword });
      const wasRequired = account.forcePasswordChange;
      updateAccount(user);
      passwordForm.reset();
      accountStatus.textContent = "Your Peebee Admin password was changed.";
      if (wasRequired) void loadShared();
    } catch (error) {
      accountStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  accountDialog.addEventListener("close", () => passwordForm.reset());

  function restartSession() {
    sharedReady = false;
    window.removeEventListener("beforeunload", beforeUnload);
    location.reload();
  }

  document.querySelector("#sign-out").addEventListener("click", () => confirmAction(
    "Sign out of Peebee?",
    "This signs you out of Financials and Admin in this browser. Any unsaved changes will be lost.",
    "Sign out",
    async () => {
      try { await session.request("logout"); restartSession(); }
      catch (error) { accountStatus.textContent = error.message; }
    }
  ));

  async function savePreference(key, value) {
    if (!preferences) return;
    const controls = key === "autosave" ? [...autosaveControls] : [appearanceControl];
    if (key === "autosave") setAutosave(value);
    controls.forEach(control => control.disabled = true);
    preferenceStatus.textContent = "Saving to your account…";
    try {
      await session.request("savePreferences", { [key]: value });
      preferences[key] = value;
      preferenceStatus.textContent = "Saved to your account.";
    } catch (error) {
      if (key === "autosave") setAutosave(preferences.autosave);
      else globalThis.ForecastAppearance.set(preferences.appearance);
      preferenceStatus.textContent = error.message;
      if (unsavedDialog.open) unsavedDialog.querySelector("#autosave-save-status").textContent = error.message;
    } finally {
      controls.forEach(control => control.disabled = false);
    }
  }

  document.addEventListener("appearancepreference", event => void savePreference("appearance", event.detail));

  function renderLogin() {
    app.innerHTML = `<section class="panel account-panel"><h1>Sign in</h1>
      <p class="muted">Use your Peebee Admin account to open the shared forecast.</p>
      <form id="financial-login" class="account-form">
        <label>Email or phone<input name="identifier" autocomplete="username" minlength="3" maxlength="160" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="button gold" type="submit">Sign in</button>
        <p id="login-status" role="status"></p>
      </form>
    </section>`;
    const form = app.querySelector("#financial-login");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector("button");
      const status = form.querySelector("#login-status");
      button.disabled = true;
      status.textContent = "Signing in…";
      try {
        const { identifier, password } = Object.fromEntries(new FormData(form));
        const { user } = await session.request("login", { identifier: identifier.trim(), password });
        updateAccount(user);
        form.reset();
        await loadShared();
      } catch (error) {
        form.elements.password.value = "";
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadShared() {
    if (loadingShared) return;
    loadingShared = true;
    if (!sharedReady) app.innerHTML = '<p role="status">Connecting to Peebee Admin…</p>';
    try {
      if (!account) {
        const { user } = await session.request("account");
        updateAccount(user);
      }
      if (account.forcePasswordChange) {
        app.innerHTML = '<section class="panel account-panel"><h1>Set your Admin password</h1><p>Use Account to change the temporary password before opening the forecast.</p></section>';
        return;
      }
      if (!preferences) {
        ({ preferences } = await session.request("preferences"));
        setAutosave(preferences.autosave);
        globalThis.ForecastAppearance.set(preferences.appearance);
      }
      const { draft } = await session.request("load");
      revision = draft?.revision ?? null;
      ({ answers, step, screen, editing = false } = readDraft(draft ? { answers: draft.answers, screen: "report" } : null));
      if (firstMissing(answers)) screen = "review";
      savedAnswers = JSON.stringify(answers);
      queuedAnswers = undefined;
      saveError = undefined;
      outcomes = null;
      sharedReady = true;
      document.querySelector("#open-settings").hidden = false;
      publishLocal.hidden = !!draft || !localDraft?.answers;
      showSaveStatus(draft ? "Shared forecast" : "Shared forecast · Peebee defaults");
      render();
    } catch (error) {
      if (sharedReady) return showSaveStatus(error.message, saveError || error);
      if (error.status === 401) {
        account = undefined;
        preferences = undefined;
        setAutosave(false);
        globalThis.ForecastAppearance.set("system");
        accountButton.hidden = true;
        renderLogin();
        return;
      }
      app.innerHTML = `<section class="panel account-panel"><h1>Peebee Financial Model</h1><p class="muted" role="status">${escape(error.message)}</p>
        <button class="button secondary" id="connect-shared" type="button">Retry connection</button></section>`;
      app.querySelector("#connect-shared").addEventListener("click", () => void loadShared());
    } finally {
      loadingShared = false;
    }
  }

  if (session) window.addEventListener("adminaccountchange", restartSession);

  let activeEdit;
  let pendingNavigation;

  function beforeUnload(event) {
    if (activeEdit?.dirty() && autosave && !activeEdit.issue() && activeEdit.commit() && save() && !session) return;
    if (!activeEdit?.dirty() && !queuedAnswers) return;
    event.preventDefault();
    event.returnValue = true;
  }

  function finishNavigation(action) {
    const from = activeEdit;
    action();
    if (from && activeEdit === from) {
      save();
      render("question-title");
    }
  }

  function navigate(action) {
    if (!activeEdit?.dirty()) {
      action();
    } else if (autosave && !activeEdit.issue() && activeEdit.commit()) {
      finishNavigation(action);
    } else {
      pendingNavigation = action;
      unsavedDialog.querySelector("#unsaved-question").textContent = activeEdit.label;
      unsavedDialog.returnValue = "";
      unsavedDialog.querySelector("#autosave-save-status").textContent = "";
      unsavedDialog.showModal();
    }
  }

  unsavedDialog.addEventListener("close", () => {
    const action = pendingNavigation;
    pendingNavigation = undefined;
    if (action && (unsavedDialog.returnValue === "discard" || (unsavedDialog.returnValue === "save" && activeEdit.commit()))) {
      finishNavigation(action);
    }
  });

  function render(focusId) {
    menuGroup = undefined;
    activeEdit = undefined;
    if (!queuedAnswers) window.removeEventListener("beforeunload", beforeUnload);
    detachCharts?.();
    detachCharts = null;
    dashboardObserver?.disconnect();
    dashboardObserver = null;
    if (screen === "report") renderReport();
    else if (screen === "review") renderReview();
    else if (screen === "intro") app.innerHTML = workbookIntro();
    else if (screen === "workbook-settings") renderWorkbookSettings();
    else renderQuestion();
    renderNavigation();
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
    const sectionSteps = `<ol class="section-steps" role="list" aria-label="${escape(prompt.section)} questions">
      ${sectionQuestions.map(item => `<li><button type="button" data-step="${escape(item.id)}"${item === prompt ? ' aria-current="step"' : ""}>${escape(stepLabel(item))}</button></li>`).join("")}
    </ol>`;
    const done = list.filter(item => !errorFor(item, answers[item.id], answers)).length;
    const value = answers[step] || "";
    const unit = prompt.unit === "currency" ? currencyOf(answers) : prompt.unit;
    const isItems = prompt.type === "items";
    const input = isItems ? '<div id="line-editor"></div>' : prompt.type === "select"
      ? `<select id="answer" aria-labelledby="question-title" aria-describedby="hint error"><option value="">Select an option</option>${prompt.choices.map(([id, label]) => `<option value="${id}" ${id === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`
      : `<div class="field-box"><input id="answer" type="${prompt.type}" autocomplete="off" aria-labelledby="question-title" aria-describedby="hint error${unit ? " unit" : ""}" ${prompt.type === "text" ? 'maxlength="160"' : ""} ${prompt.type === "number" ? `min="${prompt.min}" max="${prompt.withinForecast ? Number(answers.months) : prompt.max}" step="${prompt.step || "any"}"` : ""}
        value="${escape(value)}" placeholder="${escape(prompt.placeholder ?? "")}">${unit ? `<span id="unit">${escape(unit)}</span>` : ""}</div>`;
    app.innerHTML = `<div class="layout">
      <nav class="rail" aria-label="Assumption sections"><h2>Model assumptions</h2><ol class="steps">
        ${sections.map((section, i) => {
          const complete = i !== sectionIndex && list.filter(item => item.section === section).every(item => !errorFor(item, answers[item.id], answers));
          return `<li><button type="button" data-section="${i}" ${i === sectionIndex ? 'class="active-section"' : ""}><span aria-hidden="true" class="dot">${complete ? "✓" : i + 1}</span>${section}</button>${i === sectionIndex ? sectionSteps : ""}</li>`;
        }).join("")}
      </ol></nav>
      <details class="mobile-steps"><summary>${escape(prompt.section)} questions</summary>${sectionSteps}</details>
      <form class="question${isItems ? " item-question" : ""}" id="question-form" novalidate>
        <div class="progress-head"><span>${prompt.section} · Section ${sectionIndex + 1} of ${sections.length}</span><span>Question ${sectionStep} of ${sectionQuestions.length}</span></div>
        <progress aria-label="Applicable assumptions answered" value="${done}" max="${list.length}"></progress>
        ${prompt.subtitle ? `<p class="question-subtitle">${escape(prompt.subtitle)}</p>` : ""}
        <h1 id="question-title" tabindex="-1">${escape(prompt.title || prompt.label)}</h1>
        <p class="hint" id="hint">${escape([prompt.hint, prompt.note].filter(Boolean).join(" "))}</p>
        ${input}
        <p id="error" class="error" role="alert" hidden></p>
        ${prompt.suggestion ? `<p class="suggestion"><button type="button" id="suggestion" class="text-button">Use ${escape(prompt.suggestion)}</button></p>` : ""}
        <p id="save-status" class="muted save-status" role="status"></p>
        <div class="actions"><button type="button" id="back" class="button secondary" ${!index && !editing ? "disabled" : ""}>${editing ? "Back to review" : "Back"}</button>
          <div class="step-actions"><button type="button" class="button secondary" id="save-step">Save</button>
            <button type="submit" class="button gold">Next <span aria-hidden="true">→</span></button></div></div>
      </form></div>`;
    const field = document.querySelector("#answer");
    const error = document.querySelector("#error");
    const saveStatus = document.querySelector("#save-status");
    const clearError = () => {
      app.querySelector('[aria-invalid="true"]')?.removeAttribute("aria-invalid");
      error.hidden = true;
      saveStatus.textContent = "";
    };
    const remember = () => {
      clearError();
      if (activeEdit.dirty()) window.addEventListener("beforeunload", beforeUnload);
      else if (!queuedAnswers) window.removeEventListener("beforeunload", beforeUnload);
    };
    const readItems = isItems ? editItems(prompt, value, remember) : null;
    const capturedValue = () => isItems ? readItems() : field.value.trim();
    const original = JSON.stringify(capturedValue());
    const dirty = () => JSON.stringify(capturedValue()) !== original;
    const issueFor = () => errorFor(prompt, capturedValue(), answers);
    activeEdit = { label: stepLabel(prompt), dirty, issue: issueFor, commit };
    field?.addEventListener("input", remember);
    document.querySelector("#suggestion")?.addEventListener("click", () => {
      field.value = prompt.suggestion;
      field.dispatchEvent(new Event("input"));
      field.focus();
    });
    function commit() {
      const inputValue = capturedValue();
      const issue = errorFor(prompt, inputValue, answers);
      if (issue) {
        error.textContent = issue;
        error.hidden = false;
        const invalid = isItems
          ? document.getElementById(itemError(prompt, inputValue, answers)?.id) || document.querySelector("#add-line")
          : field;
        invalid.setAttribute("aria-invalid", "true");
        invalid.focus();
        return false;
      }
      if (dirty()) outcomes = null;
      answers[step] = inputValue;
      if (prompt.keyed) {
        const active = new Set(activeQuestions(answers).map(item => item.id));
        for (const { key } of inputValue) {
          answers[`channel-${key}`] ??= structuredClone(catalog.find(channel => channel.key === key)?.streams || []);
        }
        for (const id of Object.keys(answers)) {
          if (id.startsWith("channel-") && !active.has(id)) delete answers[id];
        }
      }
      return true;
    }
    document.querySelector("#save-step").addEventListener("click", () => {
      if (!commit()) return;
      const persisted = save();
      render("save-step");
      document.querySelector("#save-status").textContent = persisted ? (session ? "Check shared save status above." : "Saved.") : "Saved for this session. Browser storage is unavailable.";
    });
    document.querySelector("#question-form").addEventListener("submit", event => {
      event.preventDefault();
      if (!commit()) return;
      const current = activeQuestions(answers);
      const next = current[current.findIndex(item => item.id === step) + 1];
      if (next) goTo(next.id, editing);
      else showReview();
    });
    document.querySelector("#back").addEventListener("click", () => {
      if (editing) navigate(showReview);
      else if (index) navigate(() => goTo(list[index - 1].id));
    });
    function openQuestion(questionId) {
      if (questionId !== step) navigate(() => {
        if (activeQuestions(answers).some(item => item.id === questionId)) goTo(questionId, editing);
      });
    }
    app.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => openQuestion(button.dataset.step)));
    app.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => {
      openQuestion(list.find(item => item.section === sections[Number(button.dataset.section)]).id);
    }));
  }

  function editItems(prompt, value, remember) {
    const editor = document.querySelector("#line-editor");
    let rows = Array.isArray(value) ? value.map(row => ({ ...row, ...(prompt.channelId ? scopeMetadata(prompt.id, row) : {}) })) : [];
    const snapshot = () => rows.map(row => ({ ...row }));
    const hasRevenuePreview = prompt.fields.some(field => field.id === "method");
    const expenses = prompt.id === "expenses";
    const costInfo = expenses ? new Map(technologyCosts.map(item => [item[0], item])) : null;
    const missingCosts = () => infrastructureRows(currencyOf(answers)).filter(cost => !rows.some(row => row.name === cost.name));
    const phaseName = " · next phase";
    const updatePresets = () => {
      for (const button of editor.querySelectorAll("[data-preset]")) {
        const label = prompt.presets[Number(button.dataset.preset)];
        const added = rows.some(row => (row.name || "").toLowerCase() === label.toLowerCase());
        button.textContent = `${added ? "✓" : "+"} ${label}`;
        button.disabled = added;
        button.setAttribute("aria-label", added ? `${label} added` : `Add ${label}`);
      }
    };

    const draw = (focusId) => {
      editor.innerHTML = `<div class="line-actions" aria-label="Add ${escape(prompt.item)}">${prompt.presets.map((preset, index) =>
        `<button type="button" class="button secondary small" data-preset="${index}" title="Add ${escape(preset)}">+ ${escape(preset)}</button>`).join("")}
        <button type="button" id="add-line" class="button secondary small">+ Add ${prompt.presets.length ? "custom " : ""}${escape(prompt.item)}</button>
        ${expenses ? `<button type="button" id="add-infrastructure" class="button secondary small"${missingCosts().length ? "" : " disabled"}>+ Add discovered technology costs</button>` : ""}</div>
        ${expenses ? '<p class="muted cost-help">Vendor prices are public benchmarks. Enter billed usage and your exchange rate, or choose Monthly bill for a known invoice. Review any grouped technology budgets before entering the same cost separately. To plan a change, set the last month of this phase and select Add next phase.</p>' : ""}
        ${rows.length ? `<div class="line-list${prompt.id === "channels" ? " channel-list" : ""}">${rows.map((row, index) => `<fieldset class="line-item"><legend>${escape(prompt.item[0].toUpperCase() + prompt.item.slice(1))} ${index + 1}</legend>
          <div class="line-fields">${fieldsFor(prompt, row).map(field => lineField(field, row, index)).join("")}</div>
          ${hasRevenuePreview ? `<output class="revenue-estimate" data-estimate="${index}">${revenueEstimateMarkup(prompt, row)}</output>` : ""}
          ${expenses ? expenseCardExtras(row, index) : ""}
          <button type="button" class="text-button remove-line" id="remove-line-${index}" data-remove="${index}" aria-label="${escape("Remove " + (row.name || prompt.item + " " + (index + 1)))}">Remove</button>
          </fieldset>`).join("")}</div>` : `<p class="empty-items muted">${prompt.required ? "Add a line item to continue." : "No line items added. Continue if this category does not apply."}</p>`}`;
      updatePresets();
      if (focusId) document.getElementById(focusId)?.focus();
    };

    const add = (name = "") => {
      const initial = Object.fromEntries(prompt.fields.map(field => [field.id, field.initial || ""]));
      if (prompt.keyed) {
        const channel = catalog.find(channel => channel.name === name && !rows.some(row => row.key === channel.key));
        initial.key = channel?.key || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
      }
      const preset = prompt.presetRows?.find(row => row.name === name);
      const row = { ...initial, ...preset, name };
      rows.push(prompt.channelId && name ? { ...row, ...scopeMetadata(prompt.id, row) } : row);
      remember();
      const first = name ? fieldsFor(prompt, rows.at(-1))[1]?.id || "name" : "name";
      draw(`item-${rows.length - 1}-${first}`);
    };
    function expenseCardExtras(row, index) {
      const source = costInfo.get(row.name) ?? costInfo.get(row.name?.split(phaseName)[0]);
      const details = source
        ? `<p class="muted cost-help">${source[1] ? `Billing unit: ${escape(source[1])}. ` : ""}
            ${escape(source[5])} ${source[4] ? `<a href="${escape(source[4])}" target="_blank" rel="noopener noreferrer">Vendor pricing</a>` : ""}</p>` : "";
      return `${details}<output class="revenue-estimate" data-cost-estimate="${index}">${expenseEstimateMarkup(prompt, row)}</output>
        <button type="button" class="text-button remove-line next-phase" data-phase="${index}">Add next phase</button>
        <p class="cost-help muted phase-status" data-phase-status="${index}" role="status"></p>`;
    }

    function addPhase(index) {
      const row = rows[index];
      const status = editor.querySelector(`[data-phase-status="${index}"]`);
      const end = Number(row.endMonth || row.month);
      const validMonth = Number.isInteger(end) && end >= Number(row.month) && end < Number(answers.months);
      if (!validMonth) {
        status.textContent = "Choose a last month before the end of the forecast to add another phase.";
        return;
      }
      const nextMonth = end + 1;
      const nextName = row.name.split(phaseName)[0].slice(0, 138) + phaseName;
      if (rows.some(other => other !== row && other.name === nextName && Number(other.month) === nextMonth)) {
        status.textContent = "A phase already starts in that month. Edit the next card to change it.";
        return;
      }
      const projected = expensePreview({ ...row, endMonth: "" }, nextMonth);
      row.endMonth = String(end);
      const next = { ...row, month: String(nextMonth), endMonth: "", name: nextName };
      if (row.basis === "usage" && Number.isFinite(projected.quantity)) next.quantity = String(projected.quantity);
      if (row.basis !== "usage" && Number.isFinite(projected.amount)) next.amount = String(projected.amount);
      rows.splice(index + 1, 0, next);
      remember();
      draw(`item-${index + 1}-amount`);
    }

    editor.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.id === "add-line") add();
      else if (button.id === "add-infrastructure") {
        const added = missingCosts();
        const start = rows.length;
        rows.push(...added);
        remember();
        draw(`item-${start}-name`);
      } else if (button.hasAttribute("data-phase")) addPhase(Number(button.dataset.phase));
      else if (button.hasAttribute("data-preset")) add(prompt.presets[Number(button.dataset.preset)]);
      else if (button.hasAttribute("data-remove")) {
        rows.splice(Number(button.dataset.remove), 1);
        remember();
        draw("add-line");
      }
    });
    editor.addEventListener("input", event => {
      const field = event.target;
      const row = rows[Number(field.dataset.line)];
      if (!row) return;
      row[field.dataset.field] = field.value.trim();
      if (expenses) editor.querySelector(`[data-phase-status="${field.dataset.line}"]`).textContent = "";
      remember();
      if (field.tagName === "SELECT") draw(field.id);
      else if (field.dataset.field === "name") {
        updatePresets();
        const remove = document.getElementById(`remove-line-${field.dataset.line}`);
        remove.setAttribute("aria-label", "Remove " + (row.name || prompt.item + " " + (Number(field.dataset.line) + 1)));
      } else {
        const estimate = editor.querySelector(`[data-estimate="${field.dataset.line}"]`);
        if (estimate) {
          const markup = revenueEstimateMarkup(prompt, row);
          if (estimate.innerHTML !== markup) estimate.innerHTML = markup;
        }
        const costEstimate = editor.querySelector(`[data-cost-estimate="${field.dataset.line}"]`);
        if (costEstimate) {
          const markup = expenseEstimateMarkup(prompt, row);
          if (costEstimate.innerHTML !== markup) costEstimate.innerHTML = markup;
        }
      }
    });
    draw();
    return snapshot;
  }

  function expenseEstimateMarkup(prompt, row) {
    const errorRow = { ...row, name: "Expense" };
    if (itemError(prompt, [errorRow], answers)) return '<span>Complete the cost inputs to see projected expenses.</span>';
    const start = Number(row.month);
    const horizon = Number(answers.months);
    const end = Math.min(Number(row.endMonth || horizon), horizon);
    const sample = [...new Set([start, Math.min(start + 1, end), Math.min(start + 11, end), end])];
    const amounts = sample.map(month => `Month ${month}: ${money(expensePreview(row, month).amount)}`);
    return `<span>Projected expense</span><strong>${escape(amounts.join(" · "))}</strong>`;
  }

  function revenueEstimateMarkup(prompt, row) {
    const method = prompt.fields.find(field => field.id === "method");
    if (errorFor(method, row.method, answers)) return '<span>Choose a revenue driver to see the estimate.</span>';

    const drivers = fieldsFor(prompt, row).filter(field => field.type === "number" && field.id !== "growth" && field.id !== "days");
    if (drivers.some(field => errorFor(field, row[field.id], answers))) {
      return '<span>Complete the revenue inputs to see the month-one estimate.</span>';
    }

    const estimated = firstMonthSale(row);
    const { revenue, units, price, volume, feeRate, orderValue, joining, leaving, active } = estimated;
    const percent = format(feeRate, "rate");
    const count = value => numberFormat.format(value);
    let formula;
    switch (row.method) {
      case "units":
        formula = `${count(units)} units × ${money(price)}`;
        break;
      case "orders":
        formula = `${count(units)} orders × ${money(orderValue)} = ${money(volume)} eligible value · ${percent} fee`;
        break;
      case "percentage":
        formula = `${money(volume)} eligible value × ${percent} fee`;
        break;
      case "subscription":
        formula = `(${count(Number(row.active))} opening − ${count(leaving)} churned + ${count(joining)} new) = ${count(active)} subscribers · ${money(price)} each`;
        break;
      default:
        formula = "Entered first-month sales amount";
    }
    return `<span>${escape(formula)}</span><strong>Month-one Peebee revenue ${escape(money(revenue))}</strong>`;
  }

  function lineField(field, row, index) {
    const id = `item-${index}-${field.id}`;
    const attrs = `id="${id}" data-line="${index}" data-field="${field.id}" aria-describedby="error"`;
    const value = row[field.id] ?? "";
    const unit = field.unit === "currency" ? currencyOf(answers) : field.unit;
    const control = field.type === "select" ? `<select ${attrs}><option value="">Select an option</option>${field.choices.map(([key, label]) =>
      `<option value="${key}" ${key === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`
      : `<div class="field-box"><input ${attrs} type="${field.type}" value="${escape(value)}" autocomplete="off"
        ${field.type === "number" ? `min="${field.min}" max="${field.withinForecast ? Number(answers.months) : field.max}" step="${field.step || "any"}"` : 'maxlength="160"'}>
        ${unit ? `<span aria-hidden="true">${escape(unit)}</span>` : ""}</div>`;
    return `<div class="line-field"><label for="${id}">${escape(field.label)}${unit ? `<span class="sr-only"> (${escape(unit)})</span>` : ""}</label>${control}</div>`;
  }

  function goTo(id, edit = false) {
    editing = edit;
    step = id;
    screen = "wizard";
    save();
    render(availableQuestions(answers).find(prompt => prompt.id === id)?.type === "items" ? "question-title" : "answer");
  }

  function showReview() {
    editing = false;
    screen = "review";
    save();
    render("review-title");
  }

  function displayAnswer(prompt, value) {
    if (prompt.type === "items" && !Array.isArray(value)) return "Enter line items";
    if (prompt.type === "items") return value.length ? `${value.length} ${value.length === 1 ? "line item" : "line items"}` : "None";
    if (!value) return "Enter value";
    if (prompt.type === "select") return prompt.choices.find(([id]) => id === value)?.[1] || "";
    if (prompt.type !== "number") return value;
    const unit = prompt.unit === "currency" ? currencyOf(answers) : prompt.unit;
    const numeric = Number(value);
    const shown = Number(numeric.toFixed(2)) === numeric ? numberFormat.format(numeric) : value;
    return `${shown}${unit === "%" ? "%" : unit ? " " + unit : ""}`;
  }

  function renderReview(forecastError = "") {
    const list = activeQuestions(answers);
    app.innerHTML = `<div class="review-head"><div><h1 id="review-title" tabindex="-1">Review assumptions</h1><p class="muted">${escape(answers.company)} · ${escape(currencyOf(answers))}</p></div>
      <div class="toolbar">
        ${currencyOf(answers) === "UGX" ? '<button type="button" id="starter-revenue" class="button secondary">Load starter revenue estimates</button>' : ""}
        <button type="button" id="generate" class="button gold">Generate forecast <span aria-hidden="true">→</span></button></div></div>
      <p class="notice">${escape(dataNote)}</p>
      ${forecastError ? `<p class="notice" id="forecast-error" role="alert" tabindex="-1">${escape(forecastError)}</p>` : ""}
      <div class="review-grid">${sections.map(section => `<section class="panel"><h2>${section}</h2><dl>${list.filter(prompt => prompt.section === section).map(prompt =>
        `<div class="review-answer"><dt>${escape(prompt.label)}</dt><dd><button class="text-button" data-edit="${prompt.id}" aria-label="${escape("Edit: " + prompt.label)}">${escape(displayAnswer(prompt, answers[prompt.id]))}</button></dd>
          ${prompt.type === "items" && answers[prompt.id]?.length ? `<dd class="review-lines"><details><summary>View line items</summary>
            ${prompt.note ? `<p class="muted">${escape(prompt.note)}</p>` : ""}
            <ul>${answers[prompt.id].map(row => `<li><strong>${escape(row.name)}</strong><ul>${fieldsFor(prompt, row).filter(field => field.id !== "name").map(field =>
              `<li>${escape(field.label)} · ${escape(displayAnswer(field, row[field.id]))}</li>`).join("")}</ul></li>`).join("")}</ul></details></dd>` : ""}</div>`).join("")}</dl></section>`).join("")}</div>`;
    app.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => goTo(button.dataset.edit, true)));
    document.querySelector("#starter-revenue")?.addEventListener("click", () => {
      if (!window.confirm("Replace standard Peebee revenue drivers, volumes and fees with the starter estimates? Custom revenue lines, growth assumptions and costs will be kept.")) return;
      loadStarterRevenue(answers);
      outcomes = null;
      showReview();
    });
    document.querySelector("#generate").addEventListener("click", () => {
      const missing = firstMissing(answers);
      if (missing) return goTo(missing.id, true);
      screen = "report";
      outcomes = null;
      selectedReport = "overview";
      selectedCase = "Base";
      frequency = "Annual";
      analysisState = { windows: {} };
      save();
      render("report-title");
    });
  }

  function modelAnswers() {
    return { company: answers.company, ...Object.fromEntries(activeQuestions(answers).map(prompt => [prompt.id, answers[prompt.id]])) };
  }

  const lineValue = (row, field) => typeof field === "function" ? field(row) : row[field];
  const format = (value, style) => value === null ? "—" : (style === "rate" ? percentFormat : numberFormat).format(value === 0 || (style !== "rate" && Math.abs(value) < halfCent) ? 0 : value);
  const money = value => `${currencyOf(answers)} ${format(value)}`;
  function table(name, columns, rows) {
    const renderRow = ([label, cells, style]) => {
      const rowClass = style === "footer" ? "total" : style === "total" || style === "detail" ? style : "";
      return `<tr${rowClass ? ` class="${rowClass}"` : ""}><th scope="row">${escape(label)}</th>${cells.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`;
    };
    const body = [];
    const footer = [];
    for (const row of rows) (row[2] === "footer" ? footer : body).push(renderRow(row));
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escape(name)}">
      <table aria-label="${escape(name)}"><thead><tr><th scope="col">${escape(name)}</th>${columns.map(label => `<th scope="col">${escape(label)}</th>`).join("")}</tr></thead>
      <tbody>${body.join("")}</tbody>${footer.length ? `<tfoot>${footer.join("")}</tfoot>` : ""}</table></div>`;
  }
  const metric = (label, value, context) => `<div class="panel metric">
    <span>${label}</span>
    <div class="metric-value">
      <strong aria-hidden="true">${escape(compactFormat.format(Math.abs(value) < halfCent ? 0 : value))}</strong>
      <span class="metric-amount">${escape(money(value))}</span>
    </div>
    <small>${escape(context)}</small>
  </div>`;
  const radio = (items, selected, type) => items.map(([id, label]) =>
    `<button type="button" id="${type}-${id}" data-${type}="${id}" aria-pressed="${id === selected}">${escape(label)}</button>`).join("");

  let expandedModules = new Set(["rides"]);
  let moduleSidebarOpen = matchMedia("(min-width: 901px)").matches;
  let scopeMessage = "";

  function moduleControls() {
    const modules = forecastModules(answers);
    const toggle = (id, label, checked, disabled, data) =>
      `<label class="forecast-switch"><span class="forecast-switch-state" aria-hidden="true">${checked ? "On" : "Off"}</span>
        <span class="autosave-switch"><input type="checkbox" role="switch" id="${escape(id)}" aria-label="${escape(label)}"
          ${data} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span class="autosave-track" aria-hidden="true"></span></span></label>`;
    return `<aside class="forecast-scope" aria-labelledby="scope-toggle">
      <h2><button id="scope-toggle" type="button" aria-label="Forecast modules" aria-controls="scope-content"
        aria-expanded="${moduleSidebarOpen}" title="${moduleSidebarOpen ? "Hide forecast modules" : "Show forecast modules"}">
        <span class="scope-toggle-icon" aria-hidden="true"></span><span class="scope-toggle-label">Forecast modules</span>
      </button></h2>
      <div id="scope-content" ${moduleSidebarOpen ? "" : "hidden"}>
      <p class="muted">Choose which revenue to include in the shared forecast. Percentage-based direct costs follow revenue. Company-wide costs stay in the forecast.</p>
      <p class="scope-status" role="status">${escape(scopeMessage)}</p>
      <div class="forecast-modules">${modules.map(({ channel, parts }) => {
        const on = included(channel);
        const count = parts.filter(part => part.entries.some(({ row }) => included(row))).length;
        const { key, name } = channel;
        return `<div class="forecast-module">
          <div class="forecast-module-line"><strong>${escape(name)}</strong>
            ${toggle(`scope-module-${key}`, name, on, false, `data-scope-channel="${escape(key)}"`)}</div>
          ${parts.length ? `<details data-scope-details="${escape(key)}" ${expandedModules.has(key) ? "open" : ""}>
            <summary>${count} of ${parts.length} ${on ? "included" : "selected"}<span class="sr-only"> in ${escape(name)}</span></summary>
            <div class="forecast-module-parts">${parts.map(part => `<div class="forecast-module-line">
              <span>${escape(part.name)}</span>
              ${toggle(`scope-part-${key}-${part.key}`, `${name} · ${part.name}`, part.entries.some(({ row }) => included(row)), !on,
                `data-scope-channel="${escape(key)}" data-scope-part="${escape(part.key)}"`)}
            </div>`).join("")}</div></details>` : ""}
        </div>`;
      }).join("")}</div></div>
    </aside>`;
  }

  function bindModuleControls() {
    const panel = app.querySelector(".forecast-scope");
    if (!panel) return;
    const toggle = panel.querySelector("#scope-toggle");
    const content = panel.querySelector("#scope-content");
    toggle.addEventListener("click", () => {
      moduleSidebarOpen = !moduleSidebarOpen;
      toggle.setAttribute("aria-expanded", moduleSidebarOpen);
      toggle.title = moduleSidebarOpen ? "Hide forecast modules" : "Show forecast modules";
      content.hidden = !moduleSidebarOpen;
    });
    panel.addEventListener("change", event => {
      const input = event.target.closest("input[data-scope-channel]");
      if (!input) return;
      const { scopeChannel: key, scopePart } = input.dataset;
      const streamKey = `channel-${key}`;
      const next = { ...answers, channels: answers.channels.map(row => ({ ...row })), [streamKey]: (answers[streamKey] || []).map(row => ({ ...row })) };
      const module = forecastModules(next).find(item => item.channel.key === key);
      if (!module) return;
      let addedRideshare = false;
      if (scopePart === undefined) {
        if (input.checked) delete module.channel.enabled;
        else module.channel.enabled = "no";
      } else {
        if (!included(module.channel)) return;
        const part = module.parts.find(item => item.key === scopePart);
        if (!part) return;
        if (input.checked && !part.entries.length && key === "rides" && part.key === "rideshare") {
          addedRideshare = true;
          next[streamKey].push({ name: "Rideshare commission", method: "direct", amount: "0", growth: "0", days: "0", forecastGroup: "rideshare" });
        }
        for (const { row } of part.entries) {
          if (input.checked) delete row.enabled;
          else row.enabled = "no";
        }
      }
      expandedModules = new Set([...panel.querySelectorAll("details[open]")].map(detail => detail.dataset.scopeDetails));
      const missing = firstMissing(next);
      if (missing) {
        scopeMessage = `Review ${stepLabel(missing)} in Assumptions before including it.`;
        render(input.id);
        return;
      }
      scopeMessage = addedRideshare ? "Rideshare is on. Enter its expected revenue under Assumptions." : "";
      answers = next;
      outcomes = null;
      if (!save()) scopeMessage = "The forecast was updated for this session. Browser storage is unavailable.";
      render(input.id);
    });
  }

  function overview(model) {
    const yearOne = model.months.slice(0, 12);
    const yearOneLabel = `First ${yearOne.length} ${yearOne.length === 1 ? "month" : "months"}`;
    const last = model.months.at(-1);
    const maxRevenue = Math.max(Number.MIN_VALUE, ...model.annual.map(row => row.revenue));
    const comparison = [
      ["Sales growth adjustment (percentage points)", item => format(item.growthAdjustment * 100)],
      ["Total forecast revenue", item => money(item.totals.revenue)],
      ["Total forecast EBITDA", item => money(item.totals.ebitda)],
      ["Ending cash", item => money(item.months.at(-1).cash)],
      ["Peak funding gap", item => money(item.fundingGap)],
    ];
    if (model.valuation) comparison.push(["DCF enterprise value", item => money(item.valuation.enterprise)]);
    return `<div class="forecast-dashboard">${moduleControls()}<section class="forecast-overview" aria-label="Forecast results"><div class="metrics">
      ${metric("Revenue", sum(yearOne, "revenue"), yearOneLabel)}
      ${metric("EBITDA", sum(yearOne, "ebitda"), yearOneLabel)}
      ${metric("Ending cash", last.cash, last.period)}
      ${metric("Peak funding gap", model.fundingGap, model.shortfall ? `Lowest cash in ${model.lowCash.period}` : "No month-end shortfall at report precision")}
      </div>
      ${model.shortfall ? `<p class="notice">The first month-end cash shortfall is in <strong>${model.shortfall.period}</strong>. The forecast shows the shortfall before any additional financing.</p>` : ""}
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
        <p class="muted">Channel revenue includes external sales. Expenses, funding and the financial statements are calculated for the company as a whole.</p>
        <p class="muted">${escape(dataNote)}</p>
        <p class="muted">Each revenue stream grows from its own driver. Payroll changes on the anniversary of each line’s start month. Operating expenses follow their growth intervals and scheduled phases. Receivables and payables roll forward from sales and purchases already forecast, spread evenly within 30-day model months. Inventory targets use direct costs. Opening receivables and payables settle in the months entered.</p>
        <p class="muted">Fixed assets depreciate straight-line. Debt uses equal principal payments. Opening equity is derived from opening assets and liabilities. Corporate income tax is paid monthly on positive profit. The model excludes VAT, historical statements, and tax loss carryforwards.</p>
        <p class="muted">The workbook-style financial statement views floor EBITDA margin at zero and omit monthly net margin in loss periods.</p>
        <p class="muted">Annual flows sum the included months. Balance sheet values use the final month of each calendar year shown. Reports display up to two decimal places. Totals use unrounded values. Cash shortfalls are measured at month end before additional funding. The balance sheet shows the unmet funding need as a separate amount.</p>
      </details></div></section></div>`;
  }

  function renderWorkbookSettings() {
    const ids = new Set(["currency", "customCurrency", "start", "months", "tax", "accounts", "ownedAssets", "receivables", "payables", "existingLoans"]);
    const entries = activeQuestions(answers).filter(prompt => ids.has(prompt.id));
    app.innerHTML = `<section class="panel workbook-view"><h1>Forecast settings</h1><dl>
      <div><dt>Appearance</dt><dd><button class="text-button" id="appearance-settings" type="button">Change theme</button></dd></div>
      <div><dt>Company</dt><dd>${escape(answers.company)}</dd></div>
      ${entries.map(prompt => `<div><dt>${escape(stepLabel(prompt))}</dt><dd>
        <button class="text-button" data-edit-setting="${prompt.id}" aria-label="${escape("Edit " + stepLabel(prompt))}">
          ${escape(displayAnswer(prompt, answers[prompt.id]))}</button></dd></div>`).join("")}
    </dl></section>`;
    app.querySelector("#appearance-settings").addEventListener("click", () => {
      settingsDialog.showModal();
      settingsDialog.querySelector("#appearance-mode").focus();
    });
    app.querySelectorAll("[data-edit-setting]").forEach(button => button.addEventListener("click", () => goTo(button.dataset.editSetting, true)));
  }

  function workbookIntro() {
    return `<section class="panel workbook-view">
      <h1>About this forecast</h1>
      <p>Settings and assumptions feed the revenue, COGS, expenses, staff, and working capital schedules. FS-Month and FS-Annual show the income statement, balance sheet, and cash flow together.</p>
      <p class="muted">These views use your Peebee assumptions. The reference workbook has other controls for account acquisition, staffing schedules, inventory orders, automatic asset replacement, loan payments, VAT, and fiscal-year tax settlement. Peebee uses its own assumptions and timing in those areas.</p>
    </section>`;
  }

  function renderReport() {
    const { answers: forecastAnswers, groups, report: channelReport } = consolidate(modelAnswers());
    const revenueReport = {
      ...channelReport, name: "Revenue",
      note: "Revenue adds the amounts earned across channels. Review quantities, prices, subscriber movements, and fee rates behind the totals.",
      sections: [{ ...channelReport, name: "Revenue by channel" }, { name: "Revenue drivers", lines: revenueDrivers }],
    };
    const forecastReports = [revenueReport, ...scheduleReports, ...statementReports, ...reports];
    try {
      outcomes ||= build(forecastAnswers);
    } catch (error) {
      if (!(error instanceof ForecastRangeError)) throw error;
      screen = "review";
      save();
      renderReview(error.message);
      document.querySelector("#forecast-error").focus();
      return;
    }
    if (!outcomes.some(item => item.name === selectedCase)) selectedCase = "Base";
    const model = outcomes.find(item => item.name === selectedCase);
    const report = forecastReports.find(item => item.id === selectedReport);
    const reportFrequency = report?.frequency || frequency;
    const rows = reportFrequency === "Annual" ? model.annual : model.months;
    const currency = currencyOf(answers);
    const analysis = selectedReport === "analysis" ? buildAnalysis({
      model, outcomes, rows, frequency, answers: forecastAnswers, groups,
      state: { ...analysisState, ...analysisState.windows[frequency] },
    }) : null;
    const scenarioControl = outcomes.length > 1 ? `<div class="segmented" role="group" aria-label="Scenario">${radio(outcomes.map(item => [item.name, item.name]), selectedCase, "case")}</div>` : "";
    const periodControl = (report && !report.frequency) || analysis ? `<div class="segmented" role="group" aria-label="Reporting period">${radio([["Annual", "Annual"], ["Monthly", "Monthly"]], frequency, "frequency")}</div>` : "";
    const renderTable = section => table(section.name, rows.map(row => row.period), linesFor(section, forecastAnswers).map(([label, field, style]) =>
      [label, rows.map(row => format(lineValue(row, field), style)), style]));
    const reportBody = report ? `<section class="stack workbook-view">
      ${report.note ? `<p class="muted">${escape(report.note)}</p>` : ""}
      ${(report.sections || [report]).map(renderTable).join("")}
    </section>` : "";
    app.innerHTML = `<div class="report-head"><div><h1 id="report-title" tabindex="-1">${escape(answers.company)}</h1>
        <p class="muted">Consolidated financial forecast · ${escape(currencyOf(answers))} · ${model.months[0].period} to ${model.months.at(-1).period}</p></div>
        <div class="report-actions">${scenarioControl}
          <div class="toolbar"><button type="button" id="review" class="button secondary">Edit assumptions</button>
          <button type="button" id="download" class="button gold">Download model CSV <span aria-hidden="true">↓</span></button></div>
        </div></div>
      ${report || analysis ? `<div class="toolbar">${periodControl}
        ${report ? '<button type="button" id="download-report" class="button secondary small">Download this view</button>' : ""}</div>` : ""}
      ${analysis ? renderAnalysis(analysis, { escape, format, table, currency }) : report ? reportBody : overview(model)}`;
    document.querySelector("#review").addEventListener("click", showReview);
    if (analysis) bindAnalysis(analysis, currency);
    if (!analysis && !report) {
      bindModuleControls();
      const dashboard = app.querySelector(".forecast-dashboard");
      dashboardObserver = new ResizeObserver(entries => {
        const pageTop = dashboard.getBoundingClientRect().top + window.scrollY;
        dashboard.style.setProperty("--dashboard-page-top", `${pageTop}px`);
        for (const { target, borderBoxSize } of entries) {
          target.style.setProperty("--dashboard-column-height", `${borderBoxSize[0].blockSize}px`);
        }
      });
      Array.from(dashboard.children).forEach(column => {
        dashboardObserver.observe(column, { box: "border-box" });
      });
    }
    document.querySelector("#download").addEventListener("click", () => downloadAll(forecastReports, forecastAnswers));
    document.querySelector("#download-report")?.addEventListener("click", () => {
      download([["Company", answers.company], ["Currency", currencyOf(answers)], ["Scenario", model.name], ...reportCsv(report, rows, forecastAnswers)],
        `${model.name.toLowerCase()}-${reportFrequency.toLowerCase()}-${report.id}`);
    });
    for (const [type, select] of [
      ["case", value => { selectedCase = value; }],
      ["frequency", value => { frequency = value; }],
    ]) {
      app.querySelectorAll(`[data-${type}]`).forEach(button => button.addEventListener("click", () => {
        select(button.dataset[type]);
        render(button.id);
      }));
    }
  }

  function bindAnalysis(analysis, currency) {
    detachCharts = globalThis.ForecastCharts.mount(app, analysis, format);
    for (const [id, read] of [
      ["analysis-from", value => { analysisState.windows[frequency] = { from: Number(value), to: Math.max(Number(value), analysis.to) }; }],
      ["analysis-to", value => { analysisState.windows[frequency] = { from: Math.min(Number(value), analysis.from), to: Number(value) }; }],
      ["analysis-metric", value => { analysisState.metric = value; }],
      ["analysis-group", value => { analysisState.group = value; }],
    ]) {
      document.getElementById(id)?.addEventListener("change", event => {
        read(event.target.value);
        render(id);
      });
    }
    document.getElementById("analysis-download").addEventListener("click", () => {
      download([["Company", answers.company], ...exportRows(analysis, currency)],
        `analysis-${selectedCase.toLowerCase()}-${frequency.toLowerCase()}`);
    });
  }

  function csvTable(report, rows, forecastAnswers) {
    return [[report.name, ...rows.map(row => row.period)], ...linesFor(report, forecastAnswers).map(([label, field, style]) =>
      [style === "rate" ? `${label} (%)` : label, ...rows.map(row => {
        const value = lineValue(row, field);
        return value === null ? "" : Number((style === "rate" ? value * 100 : value).toFixed(6));
      })])];
  }

  function reportCsv(report, rows, answers) {
    return (report.sections || [report]).flatMap(section => [...csvTable(section, rows, answers), []]);
  }

  function downloadAll(forecastReports, forecastAnswers) {
    const inputValue = (field, value) => field.type === "number" ? Number(value) : displayAnswer(field, value);
    const inputUnit = field => field.unit === "currency" ? currencyOf(answers) : field.unit || "";
    const rows = [["Company", answers.company], ["Currency", currencyOf(answers)],
      ["Model type", "Multi-channel"], ["Revenue basis", "External revenue consolidated across channels"], ["Input basis", dataNote],
      ["Cash shortfall basis", "Month-end cash before additional funding"],
      ["Trade balance basis", "Sales and purchases spread evenly within 30-day model months"],
      [], ["Assumption or category", "Value or line item", "Field", "Line item value", "Unit"]];
    for (const prompt of activeQuestions(answers)) {
      const answer = answers[prompt.id];
      const label = prompt.exportLabel || prompt.label;
      if (prompt.type !== "items") {
        rows.push([prompt.label, inputValue(prompt, answer), "", "", inputUnit(prompt)]);
        continue;
      }
      if (prompt.note) rows.push([label, "Input guidance", prompt.note]);
      if (!answer?.length) rows.push([prompt.label, "None"]);
      const parent = prompt.channelId && answers.channels.find(channel => channel.key === prompt.channelId);
      for (const item of answer || []) {
        if (prompt.keyed || parent) rows.push([label, item.name, "Included in forecast", included(item) && (!parent || included(parent)) ? "Yes" : "No"]);
        const fields = fieldsFor(prompt, item).filter(field => field.id !== "name");
        if (!fields.length) rows.push([label, item.name]);
        for (const field of fields) rows.push([label, item.name, field.label, inputValue(field, item[field.id]), inputUnit(field)]);
      }
    }
    for (const model of outcomes) {
      rows.push([], ["Scenario", model.name], ["Sales growth adjustment (percentage points)", model.growthAdjustment * 100], ["Peak funding gap", model.fundingGap],
        ["First month-end cash shortfall", model.shortfall?.period || ""], ["Lowest cash month", model.lowCash.period]);
      if (model.valuation) rows.push(["Present value of forecast cash flows", model.valuation.pvFlows], ["Present value of exit value", model.valuation.pvExit],
        ["DCF enterprise value", model.valuation.enterprise], ["DCF equity value", model.valuation.equity]);
      for (const [label, periods] of [["Annual", model.annual], ["Monthly", model.months]]) {
        rows.push([], [label]);
        for (const report of forecastReports) {
          if (!report.frequency || report.frequency === label) rows.push(...reportCsv(report, periods, forecastAnswers));
        }
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
    const name = answers.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "company";
    downloadFile(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${name}-${suffix}.csv`);
  }

  function downloadFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const backupFormat = "peebee-financial-assumptions";
  const backupVersion = 1;
  const maxAssumptionBytes = 120_000;
  const downloadBackup = document.querySelector("#backup-download");
  const uploadBackup = document.querySelector("#backup-upload");
  const backupFile = document.querySelector("#backup-file");
  const backupStatus = document.querySelector("#backup-status");
  let restoringBackup = false;
  const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const isAnswer = value => typeof value === "string" && value.length <= 160;

  function readBackup(fileText) {
    const backup = JSON.parse(fileText);
    if (!isRecord(backup) || backup.format !== backupFormat) {
      throw new Error("Choose a JSON backup downloaded from the Peebee Financial Model.");
    }
    if (backup.version !== backupVersion) throw new Error("This backup version is not supported.");
    const input = backup.answers;
    if (!isRecord(input) || !["Peebee", "Peebee (illustrative)"].includes(input.company) ||
        Object.keys(input).length > 300 || new TextEncoder().encode(JSON.stringify(input)).byteLength > maxAssumptionBytes) {
      throw new Error("The backup assumptions are invalid or exceed the file size limit.");
    }
    if (Object.hasOwn(input, "channels")) {
      const rows = input.channels;
      if (!Array.isArray(rows) || !rows.every(row => isRecord(row) && typeof row.key === "string" && /^[a-z0-9-]{1,64}$/.test(row.key)) ||
          new Set(rows.map(row => row.key)).size !== rows.length) throw new Error("The backup contains invalid or duplicate channel IDs.");
    }
    const prompts = new Map(availableQuestions(input).map(prompt => [prompt.id, prompt]));
    for (const [id, value] of Object.entries(input)) {
      if (id === "company") continue;
      const prompt = prompts.get(id);
      if (!prompt) throw new Error("The backup contains an unrecognized assumption.");
      if (prompt.type === "items") {
        if (!Array.isArray(value) || value.length > 250 || !value.every(row => isRecord(row) &&
            Object.entries(row).every(([field, answer]) => field.length <= 64 && isAnswer(answer)))) {
          throw new Error(`The backup contains invalid line items for ${stepLabel(prompt)}.`);
        }
      } else if (!isAnswer(value)) {
        throw new Error(`The backup contains an invalid value for ${stepLabel(prompt)}.`);
      }
    }
    return input;
  }

  downloadBackup.addEventListener("click", async () => {
    downloadBackup.disabled = true;
    backupStatus.textContent = "Preparing saved assumptions…";
    try {
      const data = session ? (await session.request("load")).draft : readLocal();
      const stored = data?.answers ?? createDefaults();
      const backup = JSON.stringify({ format: backupFormat, version: backupVersion, answers: stored });
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Kampala", dateStyle: "short" }).format(new Date());
      downloadFile(new Blob([backup], { type: "application/json" }), `peebee-assumptions-${date}.json`);
      backupStatus.textContent = "Assumptions backup downloaded.";
    } catch (error) {
      backupStatus.textContent = error.message;
    } finally {
      downloadBackup.disabled = false;
    }
  });

  uploadBackup.addEventListener("click", () => backupFile.click());
  backupFile.addEventListener("change", async () => {
    const file = backupFile.files[0];
    backupFile.value = "";
    if (!file) return;
    backupStatus.textContent = "";
    try {
      if (file.size > 128_000) throw new Error("This assumptions backup is too large.");
      const backup = readBackup(await file.text());
      if (!settingsDialog.open) return;
      confirmAction(
        "Replace current assumptions?",
        `${file.name} will replace ${session ? "the shared assumptions for all authorized admins" : "the assumptions on this device"}. Unsaved edits in this tab will be discarded.`,
        "Replace assumptions",
        () => void restoreBackup(backup)
      );
    } catch (error) {
      backupStatus.textContent = error instanceof SyntaxError ? "The file is not valid JSON." : error.message;
    }
  });

  settingsDialog.addEventListener("cancel", event => {
    if (restoringBackup) event.preventDefault();
  });

  async function restoreBackup(backup) {
    if (saving || queuedAnswers) {
      backupStatus.textContent = "Finish saving your pending forecast changes before uploading a backup.";
      return;
    }
    const restored = readDraft({ answers: backup }).answers;
    const target = firstMissing(restored) ? "review" : "report";
    const controls = [...settingsDialog.querySelectorAll("button:enabled, input:enabled, select:enabled")];
    restoringBackup = true;
    controls.forEach(control => control.disabled = true);
    backupStatus.textContent = "Replacing assumptions…";
    try {
      if (session) {
        const { draft } = await session.request("save", { revision, answers: backup });
        revision = draft.revision;
        savedAnswers = JSON.stringify(restored);
        publishLocal.hidden = true;
        showSaveStatus("Assumptions restored to the shared forecast.");
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ answers: backup, screen: target }));
      }
      answers = restored;
      screen = target;
      step = undefined;
      editing = false;
      selectedReport = "overview";
      selectedCase = "Base";
      outcomes = null;
      analysisState = { windows: {} };
      settingsDialog.close();
      render(screen === "report" ? "report-title" : "review-title");
      backupStatus.textContent = "Assumptions restored.";
    } catch (error) {
      backupStatus.textContent = error.message;
      if (error.status === 409) showSaveStatus(error.message, error);
    } finally {
      restoringBackup = false;
      controls.forEach(control => control.disabled = false);
    }
  }

  publishLocal.addEventListener("click", () => confirmAction(
    "Use this browser’s draft?",
    "This will make the forecast saved in this browser available to every authorized Peebee Admin user. It can only initialize an empty shared forecast.",
    "Use draft as shared forecast",
    () => {
      if (revision !== null || queuedAnswers) return;
      ({ answers, step, screen, editing = false } = readDraft(localDraft));
      savedAnswers = undefined;
      outcomes = null;
      settingsDialog.close();
      showReview();
    }
  ));

  document.querySelector("#reset-model").addEventListener("click", () => confirmAction(
    "Permanently reset this forecast?",
    `${session ? "This will replace the shared forecast with Peebee’s defaults for everyone with access." : "This will replace the draft on this device with Peebee’s defaults."} Any unsaved edits here will be lost. Cancel to keep your work.`,
    "Reset and replace forecast",
    () => {
      settingsDialog.close();
      answers = createDefaults();
      step = undefined;
      outcomes = null;
      showReview();
    }
  ));

  globalThis.FinancialLive.mount({ session, escape, format, confirmAction, open(action) {
    confirmAction(
      "Open live Admin data?",
      "This connects to Peebee’s production Admin and can display confidential transaction totals and fees. Continue only if you are authorized and your screen is private. Viewing data does not change the forecast.",
      "Continue to live data",
      action
    );
  }, beforeApply(action, dialog) {
    if (!activeEdit?.dirty()) return action();
    dialog.close();
    navigate(() => {
      action();
      dialog.showModal();
    });
  }, applyRates(rates) {
    if (currencyOf(answers) !== "UGX") return "Set the model currency to UGX before applying live fees.";
    const updated = globalThis.FinancialLive.applyRates(answers, rates);
    if (!updated) return "No compatible fee lines changed.";
    outcomes = null;
    showReview();
    return `Updated ${updated} fee lines. Volumes and other forecast inputs are preserved.`;
  } });

  if (session) void loadShared();
  else render();
})();
