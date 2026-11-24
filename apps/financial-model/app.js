(() => {
  const { questions, sections, errorFor, itemError } = globalThis.FinancialAssumptions;
  const { fieldsFor, upgradeDraft, acquisition } = globalThis.FinancialLineItems;
  const { build, firstMonthSale, expensePreview, staffPreview, assetPreview, reports, revenueDrivers, scheduleReports, statementReports, linesFor, sum, halfCent, ForecastRangeError } = globalThis.FinancialModel;
  const { questionsFor, consolidate, included, scopeMetadata, forecastModules,
    scopedCostGroups, moduleScope, activeModuleKeys, costIsActive } = globalThis.FinancialChannels;
  const { settingsIndex, settingFor, defaultValues, effectiveRow, followField } = globalThis.FinancialLive;
  const { buildAnalysis, renderAnalysis, renderChart, monthlyEarnings, exportRows } = globalThis.FinancialAnalysis;
  const { company, catalog, technologyCosts, infrastructureRows, createDefaults, loadStarterRevenue } = globalThis.PeebeeDefaults;
  const { readState: readTaxibeeState } = globalThis.TaxibeeModel;
  const { views: taxibeeViews, viewSet: taxibeeViewSet, renderView: renderTaxibeeView } = globalThis.TaxibeeUI;
  const dataNote = "Starter estimates model a launch scenario across all channels. Volumes, average values and unverified fees are illustrative. The scenario includes features that may be off in Admin. Apply available Admin fees to matching lines, and enter Peebee’s costs and opening balances.";
  const stepLabels = {
    currency: "Currency", customCurrency: "Currency code", start: "Forecast start", months: "Forecast length",
    channels: "Revenue channels", directCosts: "Direct costs", staff: "Staffing", expenses: "Operating expenses", hireEquipment: "Hiring equipment", hireEquipmentCost: "Equipment cost", hireEquipmentLife: "Equipment useful life", hireEquipmentReplacement: "Hiring equipment replacements", hireEquipmentInflation: "Hiring equipment price change", tax: "Income tax", vatCadence: "VAT payment timing", vatYearEnd: "VAT reporting year end",
    accounts: "Opening cash", receivables: "Receivables", payables: "Payables", inventoryMovements: "Inventory orders and write-offs", actuals: "Historical results", ownedAssets: "Existing assets", investments: "Asset purchases",
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
  const guestInvite = online ? new URLSearchParams(location.search).get("guest") : null;
  const guestMode = guestInvite !== null;
  for (const dialog of document.querySelectorAll("dialog:not(#live-dialog)")) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-x";
    close.setAttribute("aria-label", "Close dialog");
    close.textContent = "×";
    close.addEventListener("click", () => dialog.close("cancel"));
    dialog.prepend(close);
  }
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

  const workbookSheets = [
    ["workbook-intro", "Intro", "Start here to see how to set up and read the Peebee financial forecast."],
    ["assumptions", "Assumptions", "Review and edit the inputs that drive the forecast across all Peebee channels."],
    ["overview", "Dashboard", "Review projected revenue, earnings, cash and funding needs, and choose which modules to include."],
    ["admin-defaults", "Admin defaults", "Review the live Admin values available to the financial model. Edit the source settings in Admin."],
    ["workbook-settings", "Settings", "Manage company details, opening balances, taxes and shared defaults for the forecast."],
    ["workbook-actuals", "Actuals", "Record historical financial results by month and review the figures from your books."],
    ["channel-revenue", "Revenue", "See how orders, subscriptions, transaction values and fees drive revenue across channels."],
    ["cogs", "COGS", "Review direct costs, inventory purchases and the cost of delivering sales."],
    ["staff-schedule", "SG&A > Staff", "Review headcount, hiring, wages and employer costs by role and department."],
    ["sga", "SG&A", "Review operating expenses by category and see how they combine with payroll to produce total SG&A."],
    ["capex", "CAPEX", "Review inventory, planned asset purchases, replacements, depreciation and loan repayments."],
    ["fs-monthly", "FS-Month", "Review the income statement, balance sheet and cash flow month by month."],
    ["fs-annual", "FS-Annual", "Review annual earnings, year-end balances and cash flows for each year of the forecast."],
    ["pitch-deck", "Pitch Deck Output", "Review a compact set of annual revenue, profitability and margin figures for presentations."],
    ["workbook-exports", "Data Exports", "Download the financial forecast, historical entries or a backup of the saved assumptions."],
    ["workbook-map", "Model Map", "Find every workbook sheet and see how forecast inputs flow into reports."],
    ["workbook-changes", "Change Log", "Review changes to the Peebee Financial Model and its calculation schedules."],
    ["monthly-summary", "FS-Month (AI Summary)", "Choose a month to see a summary of its financial statement and cash position."],
    ["taxes", "Taxes", "Review income tax and VAT accruals, payments and closing balances."],
    ["consolidated-models", "Consolidated models", "Compare the enabled channels and see how their revenue streams roll up to Peebee’s total."],
    ["analysis", "Dashboard Charts", "Explore the forecast through charts for revenue, expenses, cash and break-even."],
    ...taxibeeViews,
  ];
  const workbookById = new Map(workbookSheets.map(sheet => [sheet[0], sheet]));
  const workbookUtilities = new Set(["admin-defaults", "workbook-intro", "workbook-actuals", "workbook-exports", "workbook-map", "workbook-changes", ...taxibeeViewSet]);
  const privateSheets = new Set(["assumptions", "workbook-settings", "admin-defaults", "workbook-actuals", "workbook-exports", "taxibee-assumptions"]);
  const reportLinks = reports.map(({ id, name }) => [id, name]);
  const navigation = [
    { id: "home", name: "Home", views: [["overview", "Dashboard"], ["analysis", "Dashboard Charts"]] },
    ...(!guestMode ? [{ id: "model", name: "Model", views: [["assumptions", "Assumptions"], ["workbook-settings", "Forecast settings"], ["admin-defaults", "Admin defaults"]] }] : []),
    { id: "taxibee", name: "Taxibee", views: taxibeeViews.filter(([id]) => !guestMode || !privateSheets.has(id)).map(([id, label]) => [id, label]) },
    { id: "schedules", name: "Schedules", views: [["channel-revenue", "Revenue"], ...scheduleReports.map(({ id, name }) => [id, name]),
      ...reportLinks.filter(([id]) => id === "schedules")] },
    { id: "statements", name: "Statements", views: [...statementReports.map(({ id, name }) => [id, name]),
      ["monthly-summary", "FS-Month (AI Summary)"], ["pitch-deck", "Pitch Deck Output"], ...reportLinks.filter(([id]) => id !== "schedules")] },
    { id: "workbook", name: "Workbook", views: [
      ...["workbook-map", "workbook-intro", "workbook-actuals", "workbook-exports", "workbook-changes", "consolidated-models"]
        .filter(id => !guestMode || !privateSheets.has(id)).map(id => workbookById.get(id).slice(0, 2)),
    ] },
  ];
  const primaryNav = document.querySelector("#primary-nav");
  const secondaryNav = document.querySelector("#secondary-nav");

  function currentView() {
    if (screen === "report" || screen === "workbook-sheet") return selectedReport;
    if (screen === "workbook-settings") return screen;
    return "assumptions";
  }

  function renderNavigation() {
    const view = currentView();
    const group = navigation.find(item => item.views.some(([id]) => id === view)) || navigation[0];
    primaryNav.innerHTML = radio(navigation.map(item => [item.id, item.name]), group.id, "primary");
    secondaryNav.innerHTML = radio(group.views, view, "view");
  }

  function addressView() {
    const hash = location.hash;
    const view = hash.startsWith("#forecast-setting-") ? "workbook-settings"
      : hash.startsWith("#sheet/") ? hash.slice("#sheet/".length) : "";
    return navigation.some(group => group.views.some(([id]) => id === view)) ? view : "";
  }

  function selectView(view) {
    if (view === "assumptions") screen = "review";
    else if (view === "workbook-settings") screen = view;
    else screen = workbookUtilities.has(view) ? "workbook-sheet" : "report";
    selectedReport = view;
    editing = false;
  }

  function openView(view, focusId, push = true) {
    if (!navigation.some(group => group.views.some(([id]) => id === view))) return;
    if (view === currentView() && screen !== "wizard") return;
    navigate(() => {
      selectView(view);
      if (push && addressView() !== view) history.pushState(null, "", "#sheet/" + view);
      save();
      render(focusId || (screen === "report" ? "report-title" : undefined));
    });
  }

  window.addEventListener("popstate", () => {
    if (guestMode ? !guestActive : !sharedReady) return;
    const view = addressView();
    if (view) openView(view, undefined, false);
  });

  primaryNav.addEventListener("click", event => {
    const button = event.target.closest("[data-primary]");
    if (!button || button.getAttribute("aria-pressed") === "true") return;
    const group = navigation.find(item => item.id === button.dataset.primary);
    const destination = group.views[0][0];
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
  let adminDefaults;
  let adminDefaultIndex = settingsIndex();
  let defaultsRefresh;
  let defaultsError = false;
  let refreshCardDefaults;

  function acceptAdminDefaults(snapshot) {
    defaultsError = !snapshot;
    if (!snapshot) return false;
    const changed = JSON.stringify(adminDefaults?.rates) !== JSON.stringify(snapshot.rates);
    adminDefaults = snapshot;
    if (changed) {
      adminDefaultIndex = settingsIndex(snapshot);
      outcomes = null;
    }
    return changed;
  }

  function effectiveRows(prompt, rows, model = answers) {
    if (!prompt.channelId || !Array.isArray(rows)) return rows;
    return rows.map(row => effectiveRow(row, settingFor(adminDefaultIndex, prompt.channelId, row), currencyOf(model)));
  }

  function refreshAdminDefaults() {
    if (!session || !sharedReady || !account || account.forcePasswordChange) return;
    if (defaultsRefresh) return defaultsRefresh;
    defaultsRefresh = session.request("load").then(({ defaults }) => acceptAdminDefaults(defaults), () => {
      defaultsError = true;
      return false;
    }).then(changed => {
      if (screen === "workbook-sheet" && selectedReport === "admin-defaults") drawAdminDefaults();
      else if (changed && (screen === "report" || screen === "review")) render();
      else if (changed) refreshCardDefaults?.();
    }).finally(() => { defaultsRefresh = undefined; });
    return defaultsRefresh;
  }

  const availableQuestions = answers => questionsFor(questions, answers);
  const activeQuestions = answers => availableQuestions(answers).filter(prompt => !prompt.when || prompt.when(answers));
  function firstMissing(answers) {
    const activeModules = activeModuleKeys(answers);
    return activeQuestions(answers).find(prompt => {
      const value = effectiveRows(prompt, answers[prompt.id], answers);
      if (scopedCostGroups.has(prompt.id) && Array.isArray(value)) {
        return errorFor(prompt, value.filter(row => costIsActive(row, activeModules)), answers);
      }
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
      const savedCompanyName = typeof upgraded.companyName === "string" ? upgraded.companyName.trim().slice(0, 160) : "";
      const answers = {
        company: savedCompanyName || (upgraded.company === "Peebee (illustrative)" ? upgraded.company : company),
        ...readTaxibeeState(upgraded),
      };
      for (const prompt of availableQuestions(upgraded)) {
        const value = upgraded[prompt.id];
        if (prompt.type === "items" && Array.isArray(value)) {
          answers[prompt.id] = value.filter(row => row && typeof row === "object").map(row => {
            const fields = Object.fromEntries(prompt.fields.filter(field => typeof row[field.id] === "string")
              .map(field => [field.id, row[field.id].slice(0, 160)]));
            if (prompt.keyed) return { ...fields, key: row.key, ...scopeMetadata(prompt.id, row) };
            if (!included(row)) fields.enabled = "no";
            if (scopedCostGroups.has(prompt.id)) {
              if (typeof row.moduleScope === "string") fields.moduleScope = [...new Set(moduleScope(row))].slice(0, 250).join(",");
            }
            return prompt.channelId ? { ...fields, ...scopeMetadata(prompt.id, row) } : fields;
          });
        } else if (typeof value === "string") {
          answers[prompt.id] = value.slice(0, 160);
        }
      }
      const screen = data.screen === "intro" ? (firstMissing(answers) ? "review" : "report") : data.screen;
      return { answers, step: data.step, screen, editing: screen === "wizard" && data.editing === true };
    } catch {
      return { answers: createDefaults(), screen: "review" };
    }
  };
  const session = globalThis.SharedForecastSession;
  if (!session && online && !guestMode) {
    document.querySelector("#open-settings").hidden = true;
    app.innerHTML = '<p class="notice" role="alert">The Admin session could not load. Refresh the page to try again.</p>';
    return;
  }
  const localDraft = readLocal();
  let { answers, step, screen, editing = false } = readDraft(session || guestMode ? null : localDraft);
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
  document.querySelector("#open-settings").hidden = online;
  if (screen === "report" && firstMissing(answers)) screen = "review";
  if (!["report", "wizard", "workbook-settings"].includes(screen)) screen = "review";
  let selectedCase = "Base";
  let selectedReport = "overview";
  let frequency = "Annual";
  let outcomes;
  let analysisState = { windows: {} };
  let detachCharts;
  let dashboardObserver;
  const save = () => {
    if (guestMode) return false;
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
    app.replaceChildren(document.querySelector("#financial-landing").content.cloneNode(true));
    const form = app.querySelector("#financial-login");
    app.querySelector("#request-guest-access").addEventListener("click", () => accessRequestDialog.showModal());
    if (guestMode) {
      form.hidden = true;
      app.querySelector(".landing-login > .muted").hidden = true;
      app.querySelector("#financial-login-title").textContent = "Guest sign in";
      mountGuestLogin();
      return;
    }
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

  async function guestRequest(path, body) {
    const response = await fetch(`/v1/forecast-guest/${path}`, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw Object.assign(new Error(data?.message || "Guest access is temporarily unavailable. Try again."), { status: response.status });
    }
    return data;
  }

  let guestRevision = null;
  let guestActive = false;
  let checkingGuest = false;
  let guestLeaving = false;
  const guestExit = document.querySelector("#guest-sign-out");

  function showGuestLanding(message) {
    guestActive = false;
    guestRevision = null;
    guestExit.hidden = true;
    primaryNav.replaceChildren();
    secondaryNav.replaceChildren();
    renderLogin();
    if (message) app.querySelector("#guest-status").textContent = message;
  }

  async function loadGuest() {
    if (checkingGuest || guestLeaving) return;
    checkingGuest = true;
    try {
      const { draft } = await guestRequest(`draft?invite=${encodeURIComponent(guestInvite)}`);
      const signature = draft ? draft.revision + JSON.stringify(draft.answers) : null;
      if (guestLeaving || (guestActive && guestRevision === signature)) return;
      const read = readDraft(draft);
      if (!draft || firstMissing(read.answers)) {
        showGuestLanding("There is no completed forecast to preview yet.");
        return;
      }
      const target = guestActive ? currentView() : addressView() || "overview";
      guestActive = true;
      guestRevision = signature;
      guestExit.hidden = false;
      answers = read.answers;
      selectView(target);
      outcomes = null;
      render();
    } catch (error) {
      if (guestLeaving) return;
      if (!guestActive || error.status === 401) showGuestLanding(guestActive || error.status !== 401 ? error.message : "");
    } finally {
      checkingGuest = false;
    }
  }

  guestExit.addEventListener("click", async () => {
    guestLeaving = true;
    showGuestLanding("Closing guest preview…");
    try {
      await guestRequest("logout", {});
      location.replace("/");
    } catch (error) {
      guestLeaving = false;
      showGuestLanding(error.message);
    }
  });

  function mountGuestLogin() {
    app.querySelector("#guest-entry").hidden = false;
    const emailForm = app.querySelector("#guest-email-form");
    const codeForm = app.querySelector("#guest-code-form");
    const status = app.querySelector("#guest-status");
    let email;
    emailForm.addEventListener("submit", async event => {
      event.preventDefault();
      const button = emailForm.querySelector("button");
      button.disabled = true;
      status.textContent = "Requesting a passcode…";
      try {
        email = emailForm.elements.email.value.trim();
        await guestRequest("code", { invite: guestInvite, email });
        emailForm.hidden = true;
        codeForm.hidden = false;
        status.textContent = "If this email matches the invitation, a passcode will arrive by email.";
        codeForm.elements.code.focus();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    codeForm.querySelector("#guest-reset-email").addEventListener("click", () => {
      codeForm.reset();
      codeForm.hidden = true;
      emailForm.hidden = false;
      status.textContent = "";
      emailForm.elements.email.focus();
    });
    codeForm.addEventListener("submit", async event => {
      event.preventDefault();
      const button = codeForm.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = "Checking your passcode…";
      try {
        const { code, password } = Object.fromEntries(new FormData(codeForm));
        await guestRequest("verify", { invite: guestInvite, email, code, password });
        await loadGuest();
      } catch (error) {
        codeForm.elements.password.value = "";
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  const accessRequestDialog = document.querySelector("#guest-access-request");
  const accessRequestForm = accessRequestDialog.querySelector("form");
  accessRequestDialog.addEventListener("close", () => {
    accessRequestForm.reset();
    accessRequestDialog.querySelector("#guest-request-status").textContent = "";
  });
  accessRequestForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = accessRequestForm.querySelector("button");
    const status = accessRequestDialog.querySelector("#guest-request-status");
    button.disabled = true;
    status.textContent = "Sending request…";
    try {
      await guestRequest("request", Object.fromEntries(new FormData(accessRequestForm)));
      accessRequestForm.reset();
      status.textContent = "Request submitted. A Peebee Super Admin will review it.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const invitesDialog = document.querySelector("#guest-invites");
  const invitesForm = document.querySelector("#guest-invite-form");
  const inviteStatus = document.querySelector("#guest-invite-status");
  const inviteResult = document.querySelector("#guest-invite-result");
  const inviteLink = document.querySelector("#guest-invite-link");
  const invitePassword = document.querySelector("#guest-invite-password");
  const expiryFormat = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" });
  [inviteLink, invitePassword].forEach(field => field.addEventListener("focus", () => field.select()));

  async function refreshGuestInvites() {
    const { invites } = await session.request("guestInvites");
    const list = document.querySelector("#guest-invite-list");
    list.innerHTML = invites.length ? `<h3>Saved invitations</h3>${invites.map(invite => `
      <section class="guest-invite-item">
        <strong>${escape(invite.email)}</strong>
        <div class="muted">${invite.revokedAt ? "Revoked" : `Expires ${escape(expiryFormat.format(invite.expiresAt * 1000))}`}
          ${invite.passwordRequired ? " · Password required" : ""}</div>
        ${invite.revokedAt ? "" : `<label>Invitation link<input type="url" readonly value="${escape(invite.link)}"></label>
          <button class="text-button" type="button" data-revoke-invite="${escape(invite.id)}">Revoke access</button>`}
      </section>`).join("")}` : '<p class="muted">No active invitations.</p>';
    list.querySelectorAll("input").forEach(field => field.addEventListener("focus", () => field.select()));
  }

  document.querySelector("#open-guest-invites").addEventListener("click", () => {
    accountDialog.close();
    inviteStatus.textContent = "";
    invitesDialog.showModal();
    void refreshGuestInvites().catch(error => { inviteStatus.textContent = error.message; });
  });
  invitesDialog.addEventListener("close", () => {
    inviteResult.hidden = true;
    inviteLink.value = "";
    invitePassword.value = "";
  });
  invitesForm.addEventListener("submit", async event => {
    event.preventDefault();
    const { email, days, passwordRequired } = Object.fromEntries(new FormData(invitesForm));
    const button = invitesForm.querySelector("button");
    button.disabled = true;
    inviteStatus.textContent = "Creating invitation…";
    try {
      const result = await session.request("createGuestInvite", { email, days: Number(days), passwordRequired: !!passwordRequired });
      if (invitesDialog.open) {
        inviteLink.value = result.link;
        invitePassword.value = result.password || "";
        document.querySelector("#guest-invite-password-label").hidden = !result.password;
        document.querySelector("#guest-invite-password-note").hidden = !result.password;
        inviteResult.hidden = false;
        inviteLink.focus();
      }
      inviteStatus.textContent = "Invitation created. Share the link with the invited guest.";
      invitesForm.reset();
      await refreshGuestInvites();
    } catch (error) {
      inviteStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#guest-invite-list").addEventListener("click", event => {
    const button = event.target.closest("[data-revoke-invite]");
    if (!button) return;
    confirmAction("Revoke guest access?", "This closes the invitation and blocks further access to the saved forecast.", "Revoke access", async () => {
      try {
        await session.request("revokeGuestInvite", { id: button.dataset.revokeInvite });
        await refreshGuestInvites();
        inviteStatus.textContent = "Guest access revoked.";
      } catch (error) {
        inviteStatus.textContent = error.message;
      }
    });
  });

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
      const { draft, defaults } = await session.request("load");
      acceptAdminDefaults(defaults);
      revision = draft?.revision ?? null;
      ({ answers, step, screen, editing = false } = readDraft(draft ? { answers: draft.answers, screen: "report" } : null));
      if (firstMissing(answers)) screen = "review";
      savedAnswers = JSON.stringify(answers);
      queuedAnswers = undefined;
      saveError = undefined;
      outcomes = null;
      sharedReady = true;
      document.querySelector("#open-guest-invites").hidden = false;
      document.querySelector("#open-settings").hidden = false;
      publishLocal.hidden = !!draft || !localDraft?.answers;
      showSaveStatus(draft ? "Shared forecast" : "Shared forecast · Peebee defaults");
      if (addressView()) selectView(addressView());
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
  let returnSheet = "";
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
    activeEdit = undefined;
    refreshCardDefaults = undefined;
    if (!queuedAnswers) window.removeEventListener("beforeunload", beforeUnload);
    detachCharts?.();
    detachCharts = null;
    dashboardObserver?.disconnect();
    dashboardObserver = null;
    if (screen === "report") renderReport();
    else if (screen === "workbook-sheet") renderWorkbookSheet();
    else if (screen === "review") renderReview();
    else if (screen === "workbook-settings") renderWorkbookSettings();
    else renderQuestion();
    renderNavigation();
    if (screen !== "wizard" && addressView() !== currentView()) history.replaceState(null, "", "#sheet/" + currentView());
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
        <div class="actions"><button type="button" id="back" class="button secondary" ${!index && !editing ? "disabled" : ""}>${returnSheet ? "Back to " + (returnSheet === "workbook-settings" ? "settings" : workbookById.get(returnSheet)[1]) : editing ? "Back to review" : "Back"}</button>
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
    const readItems = isItems ? editItems(prompt, value, remember, saveTitle) : null;
    const capturedValue = () => isItems ? readItems() : field.value.trim();
    const original = capturedValue();
    const dirty = () => JSON.stringify(capturedValue()) !== JSON.stringify(original);

    function saveTitle(index, name) {
      if (index === undefined) return;
      original[index].name = name;
      answers[prompt.id] = original.map(row => ({ ...row }));
      outcomes = null;
      const persisted = save();
      if (!session) saveStatus.textContent = persisted ? "Title saved." : "Title saved for this session. Browser storage is unavailable.";
    }
    const issueFor = () => errorFor(prompt, effectiveRows(prompt, capturedValue()), answers);
    activeEdit = { label: stepLabel(prompt), dirty, issue: issueFor, commit };
    field?.addEventListener("input", remember);
    document.querySelector("#suggestion")?.addEventListener("click", () => {
      field.value = prompt.suggestion;
      field.dispatchEvent(new Event("input"));
      field.focus();
    });
    function commit() {
      const inputValue = capturedValue();
      const effectiveValue = effectiveRows(prompt, inputValue);
      const issue = errorFor(prompt, effectiveValue, answers);
      if (issue) {
        error.textContent = issue;
        error.hidden = false;
        const invalid = isItems
          ? document.getElementById(itemError(prompt, effectiveValue, answers)?.id) || document.querySelector("#add-line")
          : field;
        invalid.setAttribute("aria-invalid", "true");
        invalid.focus();
        return false;
      }
      if (dirty()) outcomes = null;
      answers[step] = inputValue;
      if (step === "companyName") answers.company = inputValue || company;
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
      if (next) goTo(next.id, editing, returnSheet);
      else showReview();
    });
    document.querySelector("#back").addEventListener("click", () => {
      if (returnSheet) openView(returnSheet);
      else if (editing) navigate(showReview);
      else if (index) navigate(() => goTo(list[index - 1].id));
    });
    function openQuestion(questionId) {
      if (questionId !== step) navigate(() => {
        if (activeQuestions(answers).some(item => item.id === questionId)) goTo(questionId, editing, returnSheet);
      });
    }
    app.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => openQuestion(button.dataset.step)));
    app.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => {
      openQuestion(list.find(item => item.section === sections[Number(button.dataset.section)]).id);
    }));
  }

  function editItems(prompt, value, remember, saveTitle) {
    const editor = document.querySelector("#line-editor");
    const rows = Array.isArray(value) ? value.map(row => ({ ...row, ...(prompt.channelId ? scopeMetadata(prompt.id, row) : {}) })) : [];
    const originalIndexes = new Map(rows.map((row, index) => [row, index]));
    const snapshot = () => rows.map(row => ({ ...row }));
    const hasRevenuePreview = prompt.fields.some(field => field.id === "method");
    const adminSetting = row => settingFor(adminDefaultIndex, prompt.channelId, row);
    const compatibleDefaults = row => defaultValues(row, adminSetting(row), currencyOf(answers));
    const effective = row => effectiveRow(row, adminSetting(row), currencyOf(answers));
    const expenses = prompt.id === "expenses";
    const staffing = prompt.id === "staff";
    const assets = prompt.id === "ownedAssets" || prompt.id === "investments";
    const scoped = scopedCostGroups.has(prompt.id);
    const activeModules = activeModuleKeys(answers);
    const moduleOptions = new Map((answers.channels || []).map(channel => [channel.key, channel.name]));
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
      const openPresets = new Set([...editor.querySelectorAll("[data-line-presets][open]")].map(group => group.dataset.linePresets));
      const presetButton = preset => `<button type="button" class="button secondary small" data-preset="${prompt.presets.indexOf(preset)}">+ ${escape(preset)}</button>`;
      const presets = prompt.presetGroups
        ? prompt.presetGroups.map(([department, roles]) => `<details class="grouped-presets" data-line-presets="${escape(department)}"${openPresets.has(department) ? " open" : ""}>
            <summary>${escape(department)}</summary><div class="line-actions">${roles.map(presetButton).join("")}</div></details>`).join("")
        : prompt.presets.map(presetButton).join("");
      editor.innerHTML = `<div class="line-actions" aria-label="Add ${escape(prompt.item)}">${presets}
        <button type="button" id="add-line" class="button secondary small">+ Add ${prompt.presets.length ? "custom " : ""}${escape(prompt.item)}</button>
        ${expenses ? `<button type="button" id="add-infrastructure" class="button secondary small"${missingCosts().length ? "" : " disabled"}>+ Add discovered technology costs</button>` : ""}</div>
        ${expenses ? '<p class="muted cost-help">Vendor prices are public benchmarks. Enter billed usage and your exchange rate, or choose Monthly bill for a known invoice. Review any grouped technology budgets before entering the same cost separately. To plan a change, set the last month of this phase and select Add next phase.</p>' : ""}
        ${scoped ? '<p class="muted cost-help">Turn a card off to keep its inputs and exclude it from the forecast. A card assigned to multiple modules applies while any assigned module is on.</p>' : ""}
        ${rows.length ? `<div class="line-list${prompt.id === "channels" ? " channel-list" : ""}">${rows.map((row, index) => `<fieldset class="line-item" aria-labelledby="item-${index}-name">
          <div class="line-card-header">
            <div class="line-card-name">
              <button type="button" class="line-card-title" id="item-${index}-name" data-edit-title="${index}" title="Edit line item name">${escape(cardName(row, index))}</button>
              <div class="field-box" hidden><input data-title-input="${index}" type="text" maxlength="160" autocomplete="off" aria-label="Line item name" value="${escape(row.name)}"></div>
            </div>
            ${forecastSwitch(`line-card-${index}`, cardLabel(row, index), included(row) && row.roleType !== "disabled", row.roleType === "disabled",
              `data-toggle-line-card="${index}"`)}
          </div>
          ${prompt.keyed ? "" : `<div class="line-fields">${fieldsFor(prompt, row).filter(field => field.id !== "name").map(field => lineField(field, effective(row), index)).join("")}</div>`}
          ${prompt.channelId ? `<div class="line-admin-defaults" data-admin-card="${index}">${adminCard(row, index)}</div>` : ""}
          ${scoped ? moduleAssignment(row, index) : ""}
          ${hasRevenuePreview ? `<output class="revenue-estimate" data-estimate="${index}">${revenueEstimateMarkup(prompt, effective(row), rows)}</output>` : ""}
          ${expenses ? expenseCardExtras(row, index) : ""}
          ${staffing || assets ? `<output class="revenue-estimate" data-cost-estimate="${index}">${costEstimateMarkup(row)}</output>` : ""}
          <button type="button" class="text-button remove-line" id="remove-line-${index}" data-remove="${index}" aria-label="${escape("Remove " + (row.name || prompt.item + " " + (index + 1)))}">Remove</button>
          </fieldset>`).join("")}</div>` : `<p class="empty-items muted">${prompt.required ? "Add a line item to continue." : "No line items added. Continue if this category does not apply."}</p>`}`;
      updatePresets();
      if (focusId) document.getElementById(focusId)?.focus();
    };

    function adminCard(row, index) {
      const rate = adminSetting(row);
      const defaults = Object.entries(compatibleDefaults(row));
      if (!rate) return row.adminSource && adminDefaults ? '<small class="muted">No mapped Admin default.</small>' : "";
      const values = defaults.map(([field, value]) => {
        const label = field === "vatRate" ? "VAT" : "Fee";
        const setting = field === "vatRate" || field === "rate" ? value + "%" : money(Number(value));
        const status = row[followField(field)] === "follow" ? "Using Admin" : "Model value";
        return `<li>${label} · ${escape(setting)} · ${status}</li>`;
      });
      return `${values.length ? `<ul>${values.join("")}</ul>` : ""}
        ${defaults.length ? `<button type="button" class="button secondary small" data-reset-admin="${index}">Reset to Admin defaults</button>` : ""}
        ${!defaults.some(([field]) => field !== "vatRate") ? '<small class="muted">The Admin fee uses a different revenue driver or currency.</small>' : ""}`;
    }

    function updateAdminCard(index) {
      const row = rows[index];
      const content = editor.querySelector(`[data-admin-card="${index}"]`);
      const estimate = editor.querySelector(`[data-estimate="${index}"]`);
      if (content) {
        const markup = adminCard(row, index);
        if (content.innerHTML !== markup) content.innerHTML = markup;
      }
      if (estimate) estimate.innerHTML = revenueEstimateMarkup(prompt, effective(row), rows);
    }

    if (prompt.channelId) refreshCardDefaults = () => rows.forEach((row, index) => {
      const current = effective(row);
      for (const field of ["price", "rate", "vatRate"]) {
        const input = document.getElementById(`item-${index}-${field}`);
        if (input && row[followField(field)] === "follow") input.value = current[field] ?? "";
      }
      updateAdminCard(index);
    });

    function moduleAssignment(row, index) {
      const assigned = new Set(moduleScope(row));
      const options = new Map(moduleOptions);
      for (const key of assigned) {
        if (!options.has(key)) options.set(key, `Removed module (${key})`);
      }
      return `<details class="cost-module-assignment">
        <summary>Applies to <strong data-assigned-count="${index}">${assigned.size ? `${assigned.size} ${assigned.size === 1 ? "module" : "modules"}` : "Company-wide"}</strong></summary>
        <p class="muted">With no modules selected, this line is company-wide.${prompt.id === "directCosts" ? " Percentage costs and linked inventory demand use sales from the selected modules." : ""}</p>
        <div class="cost-module-options">${[...options].map(([key, name]) => `<label>
          <input type="checkbox" data-assign-line="${index}" value="${escape(key)}" ${assigned.has(key) ? "checked" : ""}>
          <span>${escape(name)}${moduleOptions.has(key) && !activeModules.has(key) ? " · Off" : ""}</span>
        </label>`).join("")}</div>
      </details><p class="muted cost-module-status" data-assigned-status="${index}" role="status">${costStatus(row)}</p>`;
    }

    function cardName(row, index) {
      return row.name || `Untitled ${prompt.item} ${index + 1}`;
    }

    function cardLabel(row, index) {
      return `Include ${cardName(row, index)} in forecast`;
    }

    function openTitle(button) {
      const box = button.nextElementSibling;
      const input = box.querySelector("input");
      button.hidden = true;
      box.hidden = false;
      input.focus();
      input.select();
    }

    function closeTitle(input, cancel = false) {
      const index = Number(input.dataset.titleInput);
      const row = rows[index];
      const box = input.parentElement;
      if (!row || box.hidden) return;
      const button = box.previousElementSibling;
      const name = input.value.trim();
      const originalIndex = originalIndexes.get(row);
      if (!cancel && name && name !== row.name) {
        const duplicate = prompt.keyed && (rows.some(other => other !== row && (other.name || "").toLowerCase() === name.toLowerCase())
          || (answers[prompt.id] || []).some((other, i) => i !== originalIndex && (other.name || "").toLowerCase() === name.toLowerCase()));
        if (duplicate) {
          const error = document.querySelector("#error");
          error.textContent = "Give each channel a distinct name.";
          error.hidden = false;
        } else {
          row.name = name;
          button.textContent = name;
          document.getElementById(`line-card-${index}`).setAttribute("aria-label", cardLabel(row, index));
          document.getElementById(`remove-line-${index}`).setAttribute("aria-label", "Remove " + name);
          updatePresets();
          remember();
          saveTitle(originalIndex, name);
        }
      }
      input.value = row.name || "";
      box.hidden = true;
      button.hidden = false;
    }

    function costStatus(row) {
      if (row.roleType === "disabled") return "Role is disabled.";
      if (!included(row)) return "Card is off.";
      return costIsActive(row, activeModules) ? "" : "Excluded from the current forecast.";
    }

    function updateCostStatus(index) {
      editor.querySelector(`[data-assigned-status="${index}"]`).textContent = costStatus(rows[index]);
      const estimate = editor.querySelector(`[data-cost-estimate="${index}"]`);
      if (estimate) estimate.innerHTML = costEstimateMarkup(rows[index]);
    }

    function costEstimateMarkup(row) {
      if (staffing) return staffEstimateMarkup(prompt, row, activeModules);
      if (assets) return assetEstimateMarkup(prompt, row, activeModules);
      return expenseEstimateMarkup(prompt, row, activeModules);
    }

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
      if (!name) openTitle(document.getElementById(`item-${rows.length - 1}-name`));
    };
    function expenseCardExtras(row, index) {
      const source = costInfo.get(row.name) ?? costInfo.get(row.name?.split(phaseName)[0]);
      const details = source
        ? `<p class="muted cost-help">${source[1] ? `Billing unit: ${escape(source[1])}. ` : ""}
            ${escape(source[5])} ${source[4] ? `<a href="${escape(source[4])}" target="_blank" rel="noopener noreferrer">Vendor pricing</a>` : ""}</p>` : "";
      return `${details}<output class="revenue-estimate" data-cost-estimate="${index}">${expenseEstimateMarkup(prompt, row, activeModules)}</output>
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
      if (button.hasAttribute("data-reset-admin")) {
        const index = Number(button.dataset.resetAdmin);
        const row = rows[index];
        const defaults = compatibleDefaults(row);
        for (const [field, value] of Object.entries(defaults)) {
          row[field] = value;
          row[followField(field)] = "follow";
          const input = document.getElementById(`item-${index}-${field}`);
          if (input) input.value = value;
        }
        remember();
        updateAdminCard(index);
        return;
      }
      if (button.hasAttribute("data-edit-title")) openTitle(button);
      else if (button.id === "add-line") add();
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
    editor.addEventListener("focusout", event => {
      if (event.target.hasAttribute("data-title-input")) closeTitle(event.target);
    });
    editor.addEventListener("keydown", event => {
      const input = event.target;
      if (!input.hasAttribute("data-title-input") || event.isComposing || !["Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      closeTitle(input, event.key === "Escape");
      document.getElementById(`item-${input.dataset.titleInput}-name`).focus();
    });
    editor.addEventListener("input", event => {
      const field = event.target;
      if (field.hasAttribute("data-toggle-line-card")) {
        const index = Number(field.dataset.toggleLineCard);
        if (field.checked) delete rows[index].enabled;
        else rows[index].enabled = "no";
        field.closest(".forecast-switch").querySelector(".forecast-switch-state").textContent = field.checked ? "On" : "Off";
        if (scoped) updateCostStatus(index);
        if (hasRevenuePreview) rows.forEach((item, i) => { editor.querySelector(`[data-estimate="${i}"]`).innerHTML = revenueEstimateMarkup(prompt, effective(item), rows); });
        remember();
        return;
      }
      if (field.hasAttribute("data-assign-line")) {
        const index = Number(field.dataset.assignLine);
        const keys = [...field.closest(".cost-module-options").querySelectorAll("input:checked")].map(input => input.value);
        if (keys.length > 250) {
          field.checked = false;
          editor.querySelector(`[data-assigned-status="${index}"]`).textContent = "Select up to 250 modules.";
          return;
        }
        if (keys.length) rows[index].moduleScope = keys.join(",");
        else delete rows[index].moduleScope;
        editor.querySelector(`[data-assigned-count="${index}"]`).textContent = keys.length
          ? `${keys.length} ${keys.length === 1 ? "module" : "modules"}` : "Company-wide";
        updateCostStatus(index);
        remember();
        return;
      }
      const row = rows[Number(field.dataset.line)];
      if (!row) return;
      const key = field.dataset.field;
      row[key] = field.value.trim();
      if (prompt.channelId && ["price", "rate", "vatRate"].includes(key)) {
        row[followField(key)] = "override";
        updateAdminCard(Number(field.dataset.line));
      }
      if (staffing && field.dataset.field === "salaryBasis") {
        if (row.salaryBasis === "annual" && row.amount) row.annualSalary = String(Number(row.amount) * 12);
        if (row.salaryBasis === "monthly" && row.annualSalary) row.amount = String(Number(row.annualSalary) / 12);
      }
      if (expenses) editor.querySelector(`[data-phase-status="${field.dataset.line}"]`).textContent = "";
      remember();
      if (field.tagName === "SELECT") {
        for (const visible of fieldsFor(prompt, row)) {
          if (row[visible.id] === undefined && visible.initial != null) row[visible.id] = visible.initial;
        }
        remember();
        draw(field.id);
      }
      else {
        if (hasRevenuePreview) rows.forEach((item, index) => {
          const estimate = editor.querySelector(`[data-estimate="${index}"]`);
          if (estimate) {
            const markup = revenueEstimateMarkup(prompt, effective(item), rows);
            if (estimate.innerHTML !== markup) estimate.innerHTML = markup;
          }
        });
        const costEstimate = editor.querySelector(`[data-cost-estimate="${field.dataset.line}"]`);
        if (costEstimate) {
          const markup = costEstimateMarkup(row);
          if (costEstimate.innerHTML !== markup) costEstimate.innerHTML = markup;
        }
      }
    });
    draw();
    return snapshot;
  }

  function staffEstimateMarkup(prompt, row, activeModules) {
    if (row.roleType === "disabled" || !costIsActive(row, activeModules)) {
      return '<span>Projected payroll</span><strong>Excluded from this forecast</strong>';
    }
    if (itemError(prompt, [{ ...row, name: "Role" }], answers)) return '<span>Complete the staffing inputs to see projected payroll.</span>';
    const start = Number(row.month);
    const horizon = Number(answers.months);
    const end = Math.min(Number(row.endMonth || horizon), horizon);
    const nextHire = row.roleType === "scaling" ? start + Number(row.hiringInterval) : start;
    const sample = [...new Set([start, Math.min(nextHire, end), Math.min(start + 12, end), end])].sort((a, b) => a - b);
    if (end < horizon) sample.push(end + 1);
    return `<span>Projected headcount and payroll with benefits</span><strong>${sample.map(month => {
      const { headcount, amount } = staffPreview(row, month);
      return escape(`Month ${month}: ${numberFormat.format(headcount)} staff · ${money(amount)}`);
    }).join("<br>")}</strong>`;
  }

  function assetEstimateMarkup(prompt, row, activeModules) {
    if (!costIsActive(row, activeModules)) return '<span>Asset forecast</span><strong>Excluded from this forecast</strong>';
    if (!Number(answers.months) || itemError(prompt, [{ ...row, name: "Asset" }], answers)) {
      return '<span>Complete the asset inputs to see the forecast.</span>';
    }
    const results = assetPreview(row, Number(answers.months), prompt.id === "ownedAssets", answers);
    const active = results.find(period => period.capex || period.opening) || results[0];
    const replacements = results.filter(period => period.replacement).slice(0, 2);
    const timing = replacements.map(period => `Month ${period.month} replacement ${money(period.replacement)}`);
    return `<span>${escape(`Month ${active.month} depreciation ${money(active.depreciation)}`)}</span>
      ${timing.length ? `<span>${escape(timing.join(" · "))}</span>` : ""}
      <strong>${escape(`Closing book value ${money(results.at(-1).assets)} at forecast end`)}</strong>`;
  }

  function expenseEstimateMarkup(prompt, row, activeModules) {
    if (!costIsActive(row, activeModules)) return '<span>Projected expense</span><strong>Excluded from this forecast</strong>';
    const errorRow = { ...row, name: "Expense" };
    if (itemError(prompt, [errorRow], answers)) return '<span>Complete the cost inputs to see projected expenses.</span>';
    const start = Number(row.month);
    const horizon = Number(answers.months);
    const end = Math.min(Number(row.endMonth || horizon), horizon);
    const sample = [...new Set([start, Math.min(start + 1, end), Math.min(start + 11, end), end])];
    const amounts = sample.map(month => `Month ${month}: ${money(expensePreview(row, month).amount)}`);
    return `<span>Projected expense</span><strong>${escape(amounts.join(" · "))}</strong>`;
  }

  function revenueEstimateMarkup(prompt, row, previewRows) {
    if (!included(row)) return '<span>Revenue stream is off.</span><strong>Excluded from this forecast</strong>';
    const method = prompt.fields.find(field => field.id === "method");
    if (errorFor(method, row.method, answers)) return '<span>Choose a revenue driver to see the estimate.</span>';

    const drivers = fieldsFor(prompt, row).filter(field => field.type === "number" && !["growth", "days", "vatRate"].includes(field.id));
    if (drivers.some(field => errorFor(field, row[field.id], answers))) {
      return '<span>Complete the revenue inputs to see the month-one estimate.</span>';
    }

    let estimated;
    try {
      const context = prompt.channelId ? consolidate({ ...answers,
        [prompt.id]: effectiveRows(prompt, previewRows || answers[prompt.id]) }).answers : undefined;
      estimated = firstMonthSale({ ...row, moduleKey: prompt.channelId }, context);
    } catch {
      return '<span>Complete the linked revenue and staffing inputs to see the estimate.</span>';
    }
    const { revenue, units, price, volume, feeRate, orderValue, joining, leaving, active, marketingSpend, paidSignups, organicSignups, customers } = estimated;
    const percent = format(feeRate, "rate");
    const count = value => numberFormat.format(value);
    let formula;
    switch (row.method) {
      case "units":
        formula = `${count(units)} units × ${money(price)}`;
        break;
      case "orders":
        formula = `${count(units)} orders × ${money(orderValue)} = ${money(volume)} eligible value · ${percent} fee`;
        if (acquisition(row)) {
          formula = `${count(organicSignups)} organic + ${count(paidSignups)} paid signups · ${count(customers)} active customers · ${formula}. ${money(marketingSpend)} in Marketing & Growth.`;
        }
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
    if (row.orderForecast === "network") {
      formula = `${count(estimated.customerStarts)} new unique paying customers · ${count(estimated.activeRiders)} active riders · ${count(estimated.activeMerchants)} active merchants · ${count(estimated.requestedOrders)} requested / ${count(units)} completed orders · ${money(estimated.networkSpend)} referral and partnership costs. ${formula}`;
    }
    if (row.orderForecast === "linked") formula = `Completed orders from ${row.demandGroup}. ${formula}`;
    return `<span>${escape(formula)}</span><strong>Launch-month Peebee revenue ${escape(money(revenue))}</strong>`;
  }

  function lineField(field, row, index, descriptionId = "error") {
    if (field.id === "orderForecast" && row.method === "units") {
      field = { ...field, choices: field.choices.filter(([key]) => key === "growth" || key === "linked") };
    }
    const id = `item-${index}-${field.id}`;
    const attrs = `id="${id}" data-line="${index}" data-field="${field.id}" aria-describedby="${descriptionId}"`;
    const value = row[field.id] ?? "";
    const unit = field.unit === "currency" ? currencyOf(answers) : field.unit;
    const control = field.type === "select" ? `<select ${attrs}><option value="">Select an option</option>${field.choices.map(([key, label]) =>
      `<option value="${key}" ${key === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`
      : `<div class="field-box"><input ${attrs} type="${field.type}" value="${escape(value)}" autocomplete="off"
        ${field.type === "number" ? `min="${field.min}" max="${field.withinForecast ? Number(answers.months) : field.max}" step="${field.step || "any"}"` : 'maxlength="160"'}>
        ${unit ? `<span aria-hidden="true">${escape(unit)}</span>` : ""}</div>`;
    return `<div class="line-field"><label for="${id}">${escape(field.label)}${unit ? `<span class="sr-only"> (${escape(unit)})</span>` : ""}</label>${control}</div>`;
  }

  function goTo(id, edit = false, fromSheet = "") {
    editing = edit;
    returnSheet = fromSheet;
    step = id;
    screen = "wizard";
    save();
    render(availableQuestions(answers).find(prompt => prompt.id === id)?.type === "items" ? "question-title" : "answer");
  }

  function showReview() {
    editing = false;
    returnSheet = "";
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

  let reviewSection = "Revenue";
  let reviewSearch = "";

  function renderReview(forecastError = "") {
    const list = activeQuestions(answers);
    const missing = firstMissing(answers);
    const lineItems = prompt => Array.isArray(answers[prompt.id]) ? effectiveRows(prompt, answers[prompt.id]) : [];
    const searchText = prompt => escape([prompt.section, prompt.label, ...lineItems(prompt).map(row => row.name)].join(" "));
    const editLabel = prompt => escape(`Edit ${prompt.title || prompt.label}`);
    const preview = prompt => lineItems(prompt).length ? `<details class="review-lines"><summary>View line items</summary>
      ${prompt.note ? `<p class="muted">${escape(prompt.note)}</p>` : ""}
      <ul>${lineItems(prompt).map(row => `<li><strong>${escape(row.name)}</strong><ul>${fieldsFor(prompt, row).filter(field => field.id !== "name").map(field =>
        `<li>${escape(field.label)} · ${escape(displayAnswer(field, row[field.id]))}</li>`).join("")}
        ${scopedCostGroups.has(prompt.id) ? `<li>Applies to · ${escape(costScopeLabel(row))}</li>` : ""}
        ${included(row) ? "" : "<li>Card is off.</li>"}</ul></li>`).join("")}</ul>
    </details>` : "";
    const moduleCard = prompt => {
      const channel = answers.channels.find(row => row.key === prompt.channelId);
      const count = lineItems(prompt).length;
      if (prompt.channelId === "taxipress") {
        const mode = answers.taxibeeMode === "fly-express" ? "fly-express" : "vip-fleet";
        const isVip = mode === "vip-fleet";
        return `<article class="review-module" data-review-item data-search="${searchText(prompt)} Taxibee TaxiPress VIP Fleet Fly Express">
          <h3>${escape(prompt.title)} <span class="muted">(${isVip ? "VIP Fleet" : "Fly Express"})</span></h3>
          <p class="muted">${isVip ? "VIP Fleet owned-vans model (5 → 38 vans)" : `${count} Fly Express commission streams`} · ${included(channel) ? "Included" : "Excluded"}</p>
          <div class="segmented taxibee-inline-toggle" role="group" aria-label="Taxibee mode">
            <button type="button" data-review-tb-mode="vip-fleet" aria-pressed="${isVip}">VIP Fleet</button>
            <button type="button" data-review-tb-mode="fly-express" aria-pressed="${!isVip}">Fly Express</button>
          </div>
          <div class="step-actions">
            <button type="button" class="button ${isVip ? "gold" : "secondary"} small" data-open-taxibee="taxibee-assumptions">Open Taxibee model</button>
            <button type="button" class="button ${isVip ? "secondary" : "gold"} small" data-edit="${escape(prompt.id)}" aria-label="${editLabel(prompt)}">Edit Fly Express</button>
          </div>
          ${!isVip ? preview(prompt) : ""}
        </article>`;
      }
      return `<article class="review-module" data-review-item data-search="${searchText(prompt)}">
        <h3>${escape(prompt.title)}</h3>
        <p class="muted">${count} ${count === 1 ? "revenue stream" : "revenue streams"} · ${included(channel) ? "Included" : "Excluded"}</p>
        <button type="button" class="button secondary small" data-edit="${escape(prompt.id)}" aria-label="${editLabel(prompt)}">Edit revenue</button>
        ${preview(prompt)}
      </article>`;
    };
    const reviewRow = prompt => `<div class="review-answer" data-review-item data-search="${searchText(prompt)}">
      <dt>${escape(prompt.label)}</dt><dd><button class="text-button" type="button" data-edit="${escape(prompt.id)}" aria-label="${editLabel(prompt)}">${escape(displayAnswer(prompt, answers[prompt.id]))} <span aria-hidden="true">↗</span></button></dd>
      ${lineItems(prompt).length ? `<dd class="review-lines">${preview(prompt)}</dd>` : ""}
    </div>`;
    const sectionPanels = sections.map((section, index) => {
      const prompts = list.filter(prompt => prompt.section === section);
      const revenue = section === "Revenue";
      return `<section class="panel review-section" data-review-section="${escape(section)}" aria-labelledby="review-section-${index}">
        <div class="review-section-head"><h2 id="review-section-${index}">${revenue ? "Revenue modules" : escape(section)}</h2>
        ${revenue ? '<button type="button" class="button secondary small" data-edit="channels" data-review-item data-search="Revenue modules channels manage add remove">Manage channels</button>' : ""}</div>
        ${revenue ? `<div class="review-module-grid">${prompts.filter(prompt => prompt.channelId).map(moduleCard).join("")}</div>` : `<dl>${prompts.map(reviewRow).join("")}</dl>`}
      </section>`;
    }).join("");
    app.innerHTML = `<div class="review-head"><div><h1 id="review-title" tabindex="-1">Assumptions</h1><p class="muted">${escape(workbookById.get("assumptions")[2])}</p></div>
      <div class="toolbar">
        ${currencyOf(answers) === "UGX" ? '<button type="button" id="starter-revenue" class="button secondary">Load starter revenue estimates</button>' : ""}
        <button type="button" id="generate" class="button gold">Generate forecast <span aria-hidden="true">→</span></button></div></div>
      <details class="notice review-data-note"><summary>About starter estimates</summary><p>${escape(dataNote)}</p></details>
      ${forecastError ? `<p class="notice" id="forecast-error" role="alert" tabindex="-1">${escape(forecastError)}</p>` : ""}
      ${missing ? `<p class="notice">Required before generating the forecast <button type="button" class="text-button" data-edit="${escape(missing.id)}">${escape(stepLabel(missing))}</button></p>` : ""}
      <div class="review-workspace">
        <nav class="review-sections" aria-label="Assumption sections">
          ${sections.map(section => `<button type="button" data-review-tab="${escape(section)}">${section === "Revenue" ? "Revenue modules" : escape(section)}</button>`).join("")}
        </nav>
        <div class="stack review-content">
          <label class="review-search">Search assumptions<input type="search" id="review-search" placeholder="Search modules, settings or line items" value="${escape(reviewSearch)}"></label>
          <p class="muted" id="review-search-status" role="status" hidden></p>
          ${sectionPanels}
        </div>
      </div>`;
    const search = app.querySelector("#review-search");
    const searchStatus = app.querySelector("#review-search-status");
    const tabs = [...app.querySelectorAll("[data-review-tab]")];
    const panels = [...app.querySelectorAll("[data-review-section]")];
    function updateReview() {
      const words = reviewSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const filtering = words.length > 0;
      let matches = 0;
      for (const panel of panels) {
        let count = 0;
        for (const item of panel.querySelectorAll("[data-review-item]")) {
          item.hidden = filtering && !words.every(word => item.dataset.search.toLowerCase().includes(word));
          if (!item.hidden) count++;
        }
        panel.hidden = filtering ? count === 0 : panel.dataset.reviewSection !== reviewSection;
        if (!panel.hidden) matches += count;
      }
      for (const tab of tabs) tab.setAttribute("aria-pressed", String(!filtering && tab.dataset.reviewTab === reviewSection));
      searchStatus.hidden = !filtering;
      searchStatus.textContent = matches ? `${matches} ${matches === 1 ? "result" : "results"}` : "No matching assumptions.";
    }
    search.addEventListener("input", () => {
      reviewSearch = search.value;
      updateReview();
    });
    tabs.forEach(tab => tab.addEventListener("click", () => {
      reviewSection = tab.dataset.reviewTab;
      reviewSearch = search.value = "";
      updateReview();
    }));
    updateReview();
    app.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => goTo(button.dataset.edit, true)));
    app.querySelectorAll("[data-open-taxibee]").forEach(button => button.addEventListener("click", () => openView(button.dataset.openTaxibee)));
    app.querySelectorAll("[data-review-tb-mode]").forEach(button => button.addEventListener("click", () => {
      const nextMode = button.dataset.reviewTbMode;
      if (answers.taxibeeMode === nextMode) return;
      answers = { ...answers, ...readTaxibeeState(answers), taxibeeMode: nextMode };
      outcomes = null;
      save();
      renderReview();
    }));
    document.querySelector("#starter-revenue")?.addEventListener("click", () => confirmAction(
      "Load starter revenue estimates?",
      "This replaces standard Peebee revenue drivers, volumes, and fees. Custom revenue lines, growth assumptions, and costs are kept.",
      "Load starter estimates",
      () => {
        loadStarterRevenue(answers);
        outcomes = null;
        showReview();
      }
    ));
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
    return {
      company: answers.company,
      ...readTaxibeeState(answers),
      ...Object.fromEntries(activeQuestions(answers).map(prompt => [prompt.id, effectiveRows(prompt, answers[prompt.id])])),
    };
  }

  function costScopeLabel(row) {
    const keys = moduleScope(row);
    return keys.length ? keys.map(key => answers.channels.find(channel => channel.key === key)?.name || `Removed module (${key})`).join(", ") : "Company-wide";
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

  let expandedModules = new Set();
  let moduleSidebarOpen = matchMedia("(min-width: 901px)").matches;
  let scopeMessage = "";

  function forecastSwitch(id, label, checked, disabled, data, mixed = false) {
    return `<label class="forecast-switch"><span class="forecast-switch-state" aria-hidden="true">${mixed ? "Mixed" : checked ? "On" : "Off"}</span>
      <span class="autosave-switch"><input type="checkbox" ${id === "scope-all" ? "" : 'role="switch"'} id="${escape(id)}" aria-label="${escape(label)}"
        ${data} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span class="autosave-track" aria-hidden="true"></span></span></label>`;
  }

  function moduleControls() {
    const modules = forecastModules(answers);
    const enabled = modules.filter(({ channel }) => included(channel)).length;
    return `<aside class="forecast-scope" aria-labelledby="scope-toggle">
      <h2><button id="scope-toggle" type="button" aria-label="Forecast modules" aria-controls="scope-content"
        aria-expanded="${moduleSidebarOpen}" title="${moduleSidebarOpen ? "Hide forecast modules" : "Show forecast modules"}">
        <span class="scope-toggle-icon" aria-hidden="true"></span><span class="scope-toggle-label">Forecast modules</span>
      </button></h2>
      <div id="scope-content" ${moduleSidebarOpen ? "" : "hidden"}>
      <p class="muted">${guestMode ? "Module selections in the saved forecast." : "Choose which modules to include. Linked costs and investments stay active while any assigned module is on. Company-wide costs stay in the forecast."}</p>
      <p class="scope-status" role="status">${escape(scopeMessage)}</p>
      <div class="forecast-modules">
        ${guestMode ? "" : `<div class="forecast-module forecast-module-line">
          <strong>All modules</strong>
          ${forecastSwitch("scope-all", "All modules", enabled > 0 && enabled === modules.length, !modules.length,
            "data-scope-all", enabled > 0 && enabled < modules.length)}
        </div>`}
        ${modules.map(({ channel, parts }) => {
        const on = included(channel);
        const count = parts.filter(part => part.entries.some(({ row }) => included(row))).length;
        const { key, name } = channel;
        if (key === "taxipress") {
          const mode = answers.taxibeeMode === "fly-express" ? "fly-express" : "vip-fleet";
          const isVip = mode === "vip-fleet";
          return `<div class="forecast-module">
            <div class="forecast-module-line"><strong>${escape(name)}</strong>
              ${forecastSwitch(`scope-module-${key}`, name, on, guestMode, `data-scope-channel="${escape(key)}"`)}</div>
            <div class="taxibee-module-mode">
              <div class="segmented" role="group" aria-label="Taxibee model mode">
                <button type="button" data-scope-tb-mode="vip-fleet" aria-pressed="${isVip}" ${guestMode || !on ? "disabled" : ""}>VIP Fleet</button>
                <button type="button" data-scope-tb-mode="fly-express" aria-pressed="${!isVip}" ${guestMode || !on ? "disabled" : ""}>Fly Express</button>
              </div>
              ${isVip
                ? `<p class="muted taxibee-module-note">${on ? "VIP Fleet model rolled into consolidated statements." : "Turn Taxibee on to include VIP Fleet in consolidated statements."} <button type="button" class="text-button" data-open-taxibee="taxibee-dashboard">Open Taxibee model →</button></p>`
                : parts.length ? `<details data-scope-details="${escape(key)}" ${expandedModules.has(key) ? "open" : ""}>
                  <summary>${count} of ${parts.length} ${on ? "included" : "selected"} (Fly Express)<span class="sr-only"> in ${escape(name)}</span></summary>
                  <div class="forecast-module-parts">${parts.map(part => `<div class="forecast-module-line">
                    <span>${escape(part.name)}</span>
                    ${forecastSwitch(`scope-part-${key}-${part.key}`, `${name} · ${part.name}`, part.entries.some(({ row }) => included(row)), guestMode || !on,
                      `data-scope-channel="${escape(key)}" data-scope-part="${escape(part.key)}"`)}
                  </div>`).join("")}</div></details>` : ""}
            </div>
          </div>`;
        }
        return `<div class="forecast-module">
          <div class="forecast-module-line"><strong>${escape(name)}</strong>
            ${forecastSwitch(`scope-module-${key}`, name, on, guestMode, `data-scope-channel="${escape(key)}"`)}</div>
          ${parts.length ? `<details data-scope-details="${escape(key)}" ${expandedModules.has(key) ? "open" : ""}>
            <summary>${count} of ${parts.length} ${on ? "included" : "selected"}<span class="sr-only"> in ${escape(name)}</span></summary>
            <div class="forecast-module-parts">${parts.map(part => `<div class="forecast-module-line">
              <span>${escape(part.name)}</span>
              ${forecastSwitch(`scope-part-${key}-${part.key}`, `${name} · ${part.name}`, part.entries.some(({ row }) => included(row)), guestMode || !on,
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
    const allModules = panel.querySelector("#scope-all");
    if (allModules) allModules.indeterminate = panel.querySelector("input[data-scope-channel]:not([data-scope-part]):checked") !== null && !allModules.checked;
    toggle.addEventListener("click", () => {
      moduleSidebarOpen = !moduleSidebarOpen;
      toggle.setAttribute("aria-expanded", moduleSidebarOpen);
      toggle.title = moduleSidebarOpen ? "Hide forecast modules" : "Show forecast modules";
      content.hidden = !moduleSidebarOpen;
    });
    panel.querySelectorAll("[data-open-taxibee]").forEach(btn => btn.addEventListener("click", () => openView(btn.dataset.openTaxibee)));
    if (guestMode) return;
    panel.querySelectorAll("[data-scope-tb-mode]").forEach(btn => btn.addEventListener("click", () => {
      const nextMode = btn.dataset.scopeTbMode;
      if (answers.taxibeeMode === nextMode) return;
      answers = { ...answers, ...readTaxibeeState(answers), taxibeeMode: nextMode };
      outcomes = null;
      scopeMessage = nextMode === "vip-fleet"
        ? "Switched Taxibee to VIP Fleet (rolled into consolidated statements)."
        : "Switched Taxibee to TaxiPress (Fly Express commission lines).";
      if (!save()) scopeMessage = "The forecast was updated for this session. Browser storage is unavailable.";
      render();
    }));
    panel.addEventListener("change", event => {
      const input = event.target.closest("input[data-scope-channel], input[data-scope-all]");
      if (!input) return;
      const next = { ...answers, channels: answers.channels.map(row => ({ ...row })) };
      const setIncluded = row => {
        if (input.checked) delete row.enabled;
        else row.enabled = "no";
      };
      let addedRideshare = false;
      const { scopeChannel: key, scopePart } = input.dataset;
      if (input === allModules) {
        next.channels.forEach(setIncluded);
      } else if (scopePart === undefined) {
        const channel = next.channels.find(row => row.key === key);
        if (!channel) return;
        setIncluded(channel);
      } else {
        const streamKey = `channel-${key}`;
        next[streamKey] = (answers[streamKey] || []).map(row => ({ ...row }));
        const module = forecastModules(next).find(item => item.channel.key === key);
        if (!module || !included(module.channel)) return;
        const part = module.parts.find(item => item.key === scopePart);
        if (!part) return;
        if (input.checked && !part.entries.length && key === "rides" && part.key === "rideshare") {
          addedRideshare = true;
          next[streamKey].push({ name: "Rideshare commission", method: "direct", amount: "0", growth: "0", days: "0", forecastGroup: "rideshare" });
        }
        for (const { row } of part.entries) setIncluded(row);
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

  function overview(model, chart) {
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
      ${renderChart(chart, { escape, format, table })}
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
        <p class="muted">Fixed assets depreciate straight-line. Loans follow the selected repayment method. VAT and income tax use the timing set in Forecast settings. Historical statements and tax loss carryforwards are outside the forecast.</p>
        <p class="muted">The workbook-style financial statement views floor EBITDA margin at zero and omit monthly net margin in loss periods.</p>
        <p class="muted">Annual flows sum the included months. Balance sheet values use the final month of each calendar year shown. Reports display up to two decimal places. Totals use unrounded values. Cash shortfalls are measured at month end before additional funding. The balance sheet shows the unmet funding need as a separate amount.</p>
      </details></div></section></div>`;
  }

  function renderWorkbookSettings() {
    const prompts = availableQuestions(answers);
    const byId = new Map(prompts.map(prompt => [prompt.id, prompt]));
    const starting = { ...answers, companyName: answers.companyName ?? answers.company };
    const draft = { ...starting };
    const sections = [
      ["general", "General settings", ["companyName", "currency", "customCurrency", "start", "months", "lastActualMonth"]],
      ["history", "Company history and opening balances", ["openingCapital", "accounts", "openingVAT", "openingIncomeTax", "openingIncomeTaxMonth", "receivables", "payables", "ownedAssets", "actuals"]],
      ["taxes", "Income tax, VAT and sales tax", ["tax", "incomeTaxTiming", "fiscalStart", "taxSettlementMonth", "taxInstallments", "vatCadence", "vatYearEnd", "vatSgaDefault", "vatCogsDefault"]],
      ["revenue", "Revenue by channel", ["channels", ...prompts.filter(prompt => prompt.channelId).map(prompt => prompt.id)]],
      ["costs", "Direct costs, staffing and operating expenses", ["directCosts", "staff", "expenses", "hireEquipment", "hireEquipmentCost", "hireEquipmentLife", "hireEquipmentReplacement", "hireEquipmentInflation"]],
      ["investment", "CAPEX, depreciation and inventory", [...prompts.filter(prompt => prompt.id.startsWith("assetLife_")).map(prompt => prompt.id),
        "assetInflationDefault", "investments", "inventoryMinDefault", "inventoryLeadDefault", "inventoryCostDefault", "inventoryMovements"]],
      ["funding", "Loans and equity funding", ["loanRateDefault", "loanTermDefault", "existingLoans", "newLoans", "contributions"]],
      ["valuation", "Scenarios and valuation", ["scenarios", "downside", "upside", "valuation", "exitValue", "discountRate"]],
    ];
    const itemLink = prompt => {
      const rows = answers[prompt.id] || [];
      const channel = answers.channels.find(row => row.key === prompt.channelId);
      const label = channel?.name || stepLabel(prompt);
      const details = rows.map(row => {
        const fields = fieldsFor(prompt, row).filter(field => field.id !== "name");
        return `<li><strong>${escape(row.name)}</strong>${included(row) ? "" : " · Off"}
          ${fields.length ? `<ul>${fields.map(field => `<li>${escape(field.label)} · ${escape(displayAnswer(field, row[field.id]))}</li>`).join("")}</ul>` : ""}
          ${scopedCostGroups.has(prompt.id) ? `<span class="muted">Applies to ${escape(costScopeLabel(row))}</span>` : ""}</li>`;
      }).join("");
      return `<div class="forecast-setting-items"><div><strong>${escape(label)}</strong>
        ${channel && !included(channel) ? '<span class="muted"> · Off</span>' : ""}
        <span class="muted"> · ${rows.length} ${rows.length === 1 ? "entry" : "entries"}</span>
        ${details ? `<details><summary>View entries</summary><ul>${details}</ul></details>` : ""}</div>
        <button class="button secondary small" type="button" data-edit-setting="${escape(prompt.id)}" aria-label="Edit ${escape(label)}">Edit entries</button></div>`;
    };
    const scalar = prompt => `<div class="forecast-setting-field" data-setting-row="${escape(prompt.id)}">${lineField({ ...prompt, label: stepLabel(prompt) }, starting, "setting", "setting-hint-" + prompt.id)}
      <small id="setting-hint-${escape(prompt.id)}" class="muted">${escape(prompt.hint)}</small></div>`;
    const vatRows = [
      ...prompts.filter(prompt => prompt.channelId).map(prompt => [prompt.id, prompt.title || stepLabel(prompt)]),
      ["directCosts", "Direct costs"], ["expenses", "Operating expenses"],
    ];
    const vatOverrides = `<div class="forecast-vat-overrides"><h3>VAT by revenue stream and expense</h3>
      <p class="muted">A blank expense rate inherits its default. Enter 0 for a zero-rated line.</p>
      ${vatRows.map(([id, label]) => {
        if (!answers[id]?.length) return "";
        return `<details><summary>${escape(label)}</summary><div class="forecast-settings-fields">
          ${effectiveRows(byId.get(id), answers[id]).map((row, index) => `<label class="forecast-setting-field">${escape(row.name)}${included(row) ? "" : " · Off"}
            <div class="field-box"><input type="number" min="0" max="100" step="any" data-vat-group="${escape(id)}" data-vat-index="${index}" value="${escape(row.vatRate ?? "")}"><span aria-hidden="true">%</span></div>
          </label>`).join("")}</div></details>`;
      }).join("")}</div>`;

    app.innerHTML = `<div class="forecast-settings-heading"><div><h1 id="forecast-settings-title" tabindex="-1">Settings</h1><p class="muted">${escape(workbookById.get("workbook-settings")[2])}</p></div>
      <button class="button secondary" id="appearance-settings" type="button">Appearance and app settings</button></div>
      <div class="forecast-settings-layout">
        <nav class="forecast-settings-nav" aria-label="Settings sections">${sections.map(([id, title]) => `<a href="#forecast-setting-${id}">${escape(title)}</a>`).join("")}</nav>
        <form id="forecast-settings-form" class="forecast-settings-form" novalidate>
          <div class="forecast-settings-save"><p id="forecast-settings-status" class="muted" role="status"></p>
            <button class="button gold" type="submit">Save settings</button></div>
          ${sections.map(([id, title, ids]) => {
            const entries = ids.map(key => byId.get(key)).filter(Boolean);
            const values = entries.filter(entry => entry.type !== "items");
            return `<section class="panel" id="forecast-setting-${id}"><h2>${escape(title)}</h2>
              ${values.length ? `<div class="forecast-settings-fields">${values.map(scalar).join("")}</div>` : ""}
              ${entries.filter(entry => entry.type === "items").map(itemLink).join("")}
              ${id === "taxes" ? vatOverrides : ""}</section>`;
          }).join("")}
        </form>
      </div>`;

    const form = document.querySelector("#forecast-settings-form");
    const status = document.querySelector("#forecast-settings-status");
    const value = (input) => input.value.trim();
    const editable = [...form.querySelectorAll("[data-field], [data-vat-group]")];
    const previous = new Map(editable.map(input => [input, value(input)]));
    function updateVisibility() {
      for (const input of editable) {
        const prompt = byId.get(input.dataset.field);
        if (!prompt) continue;
        input.disabled = Boolean(prompt.when && !prompt.when(draft));
        input.closest("[data-setting-row]").hidden = input.disabled;
      }
    }
    updateVisibility();
    const dirty = () => editable.some(input => value(input) !== previous.get(input));
    function issue() {
      for (const input of editable) {
        const prompt = byId.get(input.dataset.field);
        const newlyVisible = prompt?.when && !prompt.when(starting);
        if (input.disabled || (!newlyVisible && value(input) === previous.get(input))) continue;
        const message = prompt ? errorFor(prompt, value(input), draft)
          : errorFor({ type: "number", min: 0, max: 100, optional: true }, value(input), draft);
        if (message) return { input, message };
      }
      return null;
    }
    function commit() {
      const error = issue();
      if (error) {
        status.textContent = (byId.get(error.input.dataset.field)?.label || "VAT rate") + " · " + error.message;
        error.input.closest("details")?.setAttribute("open", "");
        error.input.setAttribute("aria-invalid", "true");
        error.input.focus();
        return false;
      }
      for (const input of editable) {
        if (value(input) === previous.get(input)) continue;
        const group = input.dataset.vatGroup;
        if (group) {
          const index = Number(input.dataset.vatIndex);
          answers[group] = answers[group].map((row, i) => i === index
            ? { ...row, vatRate: value(input), ...(group.startsWith("channel-") ? { adminVat: "override" } : {}) } : row);
        } else {
          answers[input.dataset.field] = value(input);
          if (input.dataset.field === "companyName") answers.company = value(input) || company;
        }
      }
      outcomes = null;
      return true;
    }

    activeEdit = { label: "Forecast settings", dirty, issue, commit };
    form.addEventListener("input", event => {
      const input = event.target;
      if (input.dataset.field) {
        draft[input.dataset.field] = value(input);
        updateVisibility();
      }
      input.removeAttribute("aria-invalid");
      status.textContent = "";
      if (dirty()) window.addEventListener("beforeunload", beforeUnload);
      else if (!queuedAnswers) window.removeEventListener("beforeunload", beforeUnload);
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!commit()) return;
      const saved = save();
      render();
      document.querySelector("#forecast-settings-status").textContent = saved ? (session ? "Check shared save status above." : "Settings saved.") : "Settings updated for this session.";
      document.querySelector("#forecast-settings-form button[type=submit]").focus({ preventScroll: true });
    });
    app.querySelector("#appearance-settings").addEventListener("click", () => {
      settingsDialog.showModal();
      settingsDialog.querySelector("#appearance-mode").focus();
    });
    form.querySelectorAll("[data-edit-setting]").forEach(button => button.addEventListener("click", () =>
      navigate(() => goTo(button.dataset.editSetting, true, "workbook-settings"))));
  }

  function workbookForecast() {
    const { answers: forecastAnswers, groups, report: channelReport } = consolidate(modelAnswers());
    const revenueReport = {
      ...channelReport, name: "Revenue",
      sections: [{ ...channelReport, name: "Revenue by channel" }, { name: "Revenue drivers", lines: revenueDrivers }],
    };
    const deck = { id: "pitch-deck", name: "Pitch Deck Output", frequency: "Annual", lines: [
      ["Revenue", "revenue"], ["Cost of goods sold", "cogs"], ["Gross profit", "gross", "total"],
      ["Gross margin", row => row.revenue ? row.gross / row.revenue : null, "rate"],
      ["SG&A", row => row.payroll + row.overhead], ["EBITDA", "ebitda", "total"],
      ["EBITDA margin", row => row.revenue ? row.ebitda / row.revenue : null, "rate"],
      ["Net income", "profit", "footer"], ["Net margin", row => row.revenue ? row.profit / row.revenue : null, "rate"],
    ] };
    const consolidated = { id: "consolidated-models", name: "Consolidated models", lines: [
      ...groups.map(group => [group.name, row => group.streams.reduce((total, stream) => total + row.details.streams[stream.index].revenue, 0)]),
      ["Consolidated revenue", "revenue", "footer"],
    ] };
    return { forecastAnswers, groups, forecastReports: [revenueReport, ...scheduleReports, ...statementReports, deck, consolidated, ...reports] };
  }

  function workbookLink(id, label) {
    return `<a href="#sheet/${id}" data-sheet-link="${id}">${escape(label || workbookById.get(id)[1])}</a>`;
  }

  app.addEventListener("click", event => {
    const link = event.target.closest("[data-sheet-link]");
    if (!link || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    openView(link.dataset.sheetLink);
  });

  const actualColumns = [
    ["Revenue", "revenue"], ["Cost of goods sold", "cogs"], ["Payroll", "payroll"], ["Other operating expenses", "overhead"],
    ["EBITDA", row => Number(row.revenue) - Number(row.cogs) - Number(row.payroll) - Number(row.overhead)],
    ["Net income", "netIncome"], ["Capital expenditure", "capex"], ["Closing cash", "cash"],
  ];
  const historyRows = () => (answers.actuals || []).filter(included).sort((a, b) => a.period.localeCompare(b.period));
  const actualValue = (row, field) => typeof field === "function" ? field(row) : Number(row[field]);

  function renderWorkbookSheet() {
    const [id, title, description] = workbookById.get(selectedReport);
    if (taxibeeViewSet.has(id)) {
      renderTaxibeeView({
        app,
        viewId: id,
        answers,
        guestMode,
        escape,
        onUpdate(nextAnswers) {
          answers = nextAnswers;
          outcomes = null;
          save();
          renderWorkbookSheet();
        },
        onModeChange(nextMode) {
          answers = { ...answers, ...readTaxibeeState(answers), taxibeeMode: nextMode };
          outcomes = null;
          save();
          renderWorkbookSheet();
        },
        onReset(applyReset) {
          confirmAction(
            "Reset Taxibee model defaults?",
            "This restores the fleet financing terms, unit economics, Year 1 monthly ramp, 5-year scaling schedule, and stress scenarios to their baseline values.",
            "Reset Taxibee defaults",
            applyReset
          );
        },
        onExport(rows, suffix) {
          download(rows, suffix);
        },
        onEditFlyExpress() {
          goTo("channel-taxipress", true, id);
        },
      });
      return;
    }
    if (id === "admin-defaults") {
      app.innerHTML = `<header class="workbook-sheet-heading"><h1 id="workbook-sheet-title" tabindex="-1">${escape(title)}</h1>
        <p class="muted">${escape(description)}</p></header>
        <section class="panel"><div class="toolbar">${session ? '<button class="button secondary" type="button" id="refresh-admin-defaults">Refresh from Admin</button>' : ""}
        <p class="muted" id="admin-default-status" role="status"></p></div><div id="admin-default-groups" class="forecast-vat-overrides"></div></section>`;
      app.querySelector("#refresh-admin-defaults")?.addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        app.querySelector("#admin-default-status").textContent = "Refreshing from Admin…";
        await refreshAdminDefaults();
        button.disabled = false;
      });
      drawAdminDefaults();
      return;
    }
    const rows = id === "workbook-actuals" ? historyRows() : [];
    let content;
    if (id === "workbook-intro") {
      content = `<section class="panel"><h2>Using the model</h2><ol>
        ${!guestMode ? `<li>Set the forecast dates, reporting currency and opening balances in ${workbookLink("workbook-settings", "Settings")}.</li>
        <li>Set revenue drivers, costs, hiring and financing in ${workbookLink("assumptions")}.</li>` : ""}
        <li>Review results in the ${workbookLink("overview")} and the monthly or annual statements.</li>
        <li>Use the ${workbookLink("workbook-map")} to trace a figure to its supporting schedule.</li></ol></section>`;
    } else if (id === "workbook-actuals") {
      content = `<section class="panel"><div class="toolbar">
        <button type="button" class="button gold" id="edit-actuals">Edit actuals</button>
        ${document.querySelector("#live-data").hidden ? "" : '<button type="button" class="button secondary" id="actuals-live">Live Admin data</button>'}</div>
        <p class="muted">${answers.lastActualMonth ? "Recorded cutoff · " + escape(answers.lastActualMonth) + ". " : ""}Historical entries are shown separately from forecast periods.</p>
        ${rows.length ? table("Historical results", rows.map(row => row.period), actualColumns.map(([label, field]) =>
          [label, rows.map(row => format(actualValue(row, field))), label === "EBITDA" || label === "Closing cash" ? "total" : undefined]))
          : '<p class="muted">No historical months have been entered.</p>'}</section>`;
    } else if (id === "workbook-exports") {
      content = `<section class="panel"><h2>Downloads</h2><div class="toolbar">
        <button type="button" class="button gold" id="export-workbook">Forecast workbook CSV</button>
        <button type="button" class="button secondary" id="export-actuals"${historyRows().length ? "" : " disabled"}>Historical results CSV</button>
        <button type="button" class="button secondary" id="export-assumptions">Assumptions backup JSON</button>
        </div><p class="muted" id="workbook-export-status" role="status"></p></section>`;
    } else if (id === "workbook-map") {
      content = `<section class="panel"><h2>Sheet directory</h2><ol class="workbook-sheet-directory">
        ${workbookSheets.filter(([key]) => !guestMode || !privateSheets.has(key)).map(([key, label, note]) =>
          `<li>${workbookLink(key, label)}<span class="muted">${escape(note)}</span></li>`).join("")}</ol></section>
        <section class="panel"><h2>How the forecast flows</h2><p>Revenue, COGS and SG&A feed the income statement. CAPEX feeds depreciation, fixed assets and investing cash flow. Loans and taxes feed both cash flow and the balance sheet.</p></section>`;
    } else {
      content = `<section class="panel"><h2>Peebee model releases</h2><ul class="workbook-change-list">
        <li><strong>Workbook pages</strong><span>Dedicated pages, sheet descriptions, historical results and export tools.</span></li>
        <li><strong>Forecast settings</strong><span>Fiscal income tax, VAT overrides, shared defaults and campaign schedules.</span></li>
        <li><strong>CAPEX</strong><span>Asset replacement, inventory orders and fixed loan payments.</span></li>
        <li><strong>SG&A and staffing</strong><span>Staffing modes, departmental payroll, expense categories and acquisition budgets.</span></li>
        </ul><p class="muted">Shared forecast saves are tracked separately from these app releases.</p></section>`;
    }
    app.innerHTML = `<header class="workbook-sheet-heading"><h1 id="workbook-sheet-title" tabindex="-1">${escape(title)}</h1>
      <p class="muted">${escape(description)}</p></header><div class="stack">${content}</div>`;
    app.querySelector("#edit-actuals")?.addEventListener("click", () => goTo("actuals", true, id));
    app.querySelector("#actuals-live")?.addEventListener("click", () => document.querySelector("#live-data").click());
    app.querySelector("#export-workbook")?.addEventListener("click", () => {
      const status = app.querySelector("#workbook-export-status");
      const missing = firstMissing(answers);
      if (missing) {
        status.textContent = "Complete " + stepLabel(missing) + " before exporting the forecast.";
        return;
      }
      try {
        const { forecastReports, forecastAnswers } = workbookForecast();
        outcomes ||= build(forecastAnswers);
        downloadAll(forecastReports, forecastAnswers);
      } catch (error) {
        if (!(error instanceof ForecastRangeError)) throw error;
        status.textContent = error.message;
      }
    });
    app.querySelector("#export-actuals")?.addEventListener("click", () =>
      download([["Month", ...actualColumns.map(([label]) => label)], ...historyRows().map(row =>
        [row.period, ...actualColumns.map(([, field]) => actualValue(row, field))])], "actuals"));
    app.querySelector("#export-assumptions")?.addEventListener("click", () => void exportSavedAssumptions(app.querySelector("#workbook-export-status")));
  }

  function drawAdminDefaults() {
    const groupList = app.querySelector("#admin-default-groups");
    const status = app.querySelector("#admin-default-status");
    if (!groupList || !status) return;
    const refreshed = adminDefaults?.syncedAt && new Intl.DateTimeFormat("en-UG", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala",
    }).format(new Date(adminDefaults.syncedAt));
    status.textContent = !session ? "Sign in to Financials online to sync Admin settings."
      : refreshed ? (defaultsError ? "Refresh unavailable · Last synced " : "Last synced ") + refreshed + " (Kampala time)"
      : defaultsError ? "Admin settings are unavailable. Try refreshing." : "Waiting for Admin settings…";
    const open = new Set([...groupList.querySelectorAll("details[open]")].map(group => group.dataset.channel));
    const channels = new Map(catalog.map(channel => [channel.key, channel.name]));
    for (const channel of answers.channels || []) channels.set(channel.key, channel.name);
    groupList.innerHTML = [...channels].map(([key, name]) => {
      const streamNames = new Set(catalog.find(channel => channel.key === key)?.streams.map(row => row.name) || []);
      if (key === "rides") streamNames.add("Rideshare commission");
      for (const row of answers["channel-" + key] || []) streamNames.add(row.adminSource || row.name);
      const rates = (adminDefaults?.rates || []).filter(rate => rate.channel === key);
      const entries = new Map([...streamNames].map(stream => [stream, { name: stream }]));
      for (const rate of rates) entries.set(rate.name, rate);
      return `<details data-channel="${escape(key)}"${open.has(key) ? " open" : ""}><summary>${escape(name)}</summary>
        <div class="forecast-settings-fields">${[...entries.values()].map(rate => {
          const value = rate.kind === "percent" ? format(rate.value) + "%" : rate.kind ? "UGX " + format(rate.value) + (rate.kind === "monthly" ? " / month" : "")
            : adminDefaults ? "No mapped Admin value" : "Awaiting sync";
          return `<article class="admin-default-tile"><h3>${escape(rate.name)}</h3><p>${escape(value)}</p>
            ${rate.vatRate !== undefined ? `<p>VAT · ${escape(format(rate.vatRate))}%</p>` : ""}
            ${rate.vatReference ? `<small class="muted">${escape(rate.vatReference)}</small>` : ""}
            ${rate.note ? `<small class="muted">${escape(rate.note)}</small>` : ""}</article>`;
        }).join("") || '<p class="muted">No revenue streams configured.</p>'}</div></details>`;
    }).join("");
  }

  let summaryMonth;
  function renderMonthlySummary(model) {
    const selected = model.months.find(row => row.period === summaryMonth) || model.months[0];
    const prior = model.months[model.months.indexOf(selected) - 1];
    const delta = prior ? selected.revenue - prior.revenue : 0;
    const revenueChange = prior ? ` Revenue ${delta < 0 ? "fell" : "rose"} by ${money(Math.abs(delta))} from ${prior.period}.` : "";
    return `<section class="panel"><label for="summary-month">Forecast month</label>
      <select id="summary-month">${model.months.map(row => `<option${row === selected ? " selected" : ""}>${escape(row.period)}</option>`).join("")}</select>
      <p>${escape(model.name)} forecast for ${escape(selected.period)}. Revenue is ${escape(money(selected.revenue))}, EBITDA is ${escape(money(selected.ebitda))},
        and net income is ${escape(money(selected.profit))}.${delta ? escape(revenueChange) : ""}</p>
      <p>${selected.cash < 0 ? "Month-end cash shortfall" : "Month-end cash"} is ${escape(money(Math.abs(selected.cash)))}.</p>
      <p class="muted">Generated directly from the forecast figures.</p>
      <p>${workbookLink("fs-monthly", "Open the full monthly statements")}</p></section>`;
  }

  function renderReport() {
    const page = workbookById.get(selectedReport);
    const pageTitle = page?.[1] ?? navigation.flatMap(group => group.views).find(([id]) => id === selectedReport)?.[1] ?? "Dashboard";
    const description = page?.[2] ?? "Review this supporting view of the Peebee financial forecast.";
    const missing = firstMissing(answers);
    if (missing) {
      app.innerHTML = `<header class="workbook-sheet-heading"><h1 id="report-title" tabindex="-1">${escape(pageTitle)}</h1>
        <p class="muted">${escape(description)}</p></header>
        <section class="panel"><p>Complete ${escape(stepLabel(missing))} to calculate this sheet.</p>
        ${guestMode ? "" : '<button id="complete-sheet" type="button" class="button gold">Open assumption</button>'}</section>`;
      app.querySelector("#complete-sheet")?.addEventListener("click", () => goTo(missing.id, true, page ? selectedReport : ""));
      return;
    }
    const { forecastAnswers, groups, forecastReports } = workbookForecast();
    try {
      outcomes ||= build(forecastAnswers);
    } catch (error) {
      if (!(error instanceof ForecastRangeError)) throw error;
      if (guestMode) {
        showGuestLanding("This forecast is currently unavailable for preview.");
        return;
      }
      screen = "review";
      save();
      renderReview(error.message);
      document.querySelector("#forecast-error").focus();
      return;
    }
    if (!outcomes.some(item => item.name === selectedCase)) selectedCase = "Base";
    const model = outcomes.find(item => item.name === selectedCase);
    const report = forecastReports.find(item => item.id === selectedReport);
    const isSummary = selectedReport === "monthly-summary";
    const reportFrequency = report?.frequency || frequency;
    const rows = reportFrequency === "Annual" ? model.annual : model.months;
    const currency = currencyOf(answers);
    const overviewChart = selectedReport === "overview" ? monthlyEarnings(model.months, currency) : null;
    const analysis = selectedReport === "analysis" ? buildAnalysis({
      model, outcomes, rows, frequency, answers: forecastAnswers, groups,
      state: { ...analysisState, ...analysisState.windows[frequency] },
    }) : null;
    const scenarioControl = outcomes.length > 1 ? `<div class="segmented" role="group" aria-label="Scenario">${radio(outcomes.map(item => [item.name, item.name]), selectedCase, "case")}</div>` : "";
    const periodControl = (report && !report.frequency) || analysis ? `<div class="segmented" role="group" aria-label="Reporting period">${radio([["Annual", "Annual"], ["Monthly", "Monthly"]], frequency, "frequency")}</div>` : "";
    const renderTable = section => table(section.name, rows.map(row => row.period), linesFor(section, forecastAnswers).map(([label, field, style]) =>
      [label, rows.map(row => format(lineValue(row, field), style)), style]));
    const reportBody = report ? `<section class="stack workbook-view">
      ${selectedReport === "consolidated-models" ? `<section class="panel"><h2>Revenue drivers</h2><dl>
        <div><dt>Unit sales</dt><dd>Quantity × unit price.</dd></div>
        <div><dt>Subscriptions</dt><dd>Active subscribers × price, with additions and churn each month.</dd></div>
        <div><dt>Orders</dt><dd>Orders × average eligible value × fee rate. Acquisition assumptions can drive order volume.</dd></div>
        <div><dt>Percentage fees</dt><dd>Transaction or payout value × fee rate.</dd></div>
        <div><dt>Direct revenue</dt><dd>A monthly amount adjusted by the selected growth assumption.</dd></div>
      </dl></section>` : ""}
      ${report.note ? `<p class="muted">${escape(report.note)}</p>` : ""}
      ${(report.sections || [report]).map(renderTable).join("")}
    </section>` : "";
    const editEntry = { "staff-schedule": ["staff", "Edit staffing"], sga: ["expenses", "Edit operating expenses"] }[selectedReport];
    app.innerHTML = `<div class="report-head"><div><h1 id="report-title" tabindex="-1">${escape(pageTitle)}</h1>
        <p class="muted">${escape(description)}</p>
        <p class="muted">${escape(answers.company)} · Consolidated financial forecast · ${escape(currencyOf(answers))} · ${model.months[0].period} to ${model.months.at(-1).period}</p></div>
        <div class="report-actions">${scenarioControl}
          ${guestMode ? '<span class="muted">Read-only guest preview</span>' : `<div class="toolbar"><button type="button" id="review" class="button secondary">${editEntry?.[1] || "Edit assumptions"}</button>
          <button type="button" id="download" class="button gold">Download model CSV <span aria-hidden="true">↓</span></button></div>`}
        </div></div>
      ${report || analysis ? `<div class="toolbar">${periodControl}
        ${report && !guestMode ? '<button type="button" id="download-report" class="button secondary small">Download this view</button>' : ""}</div>` : ""}
      ${analysis ? renderAnalysis(analysis, { escape, format, table, currency }) : report ? reportBody : isSummary ? renderMonthlySummary(model) : overview(model, overviewChart)}`;
    app.querySelector("#review")?.addEventListener("click", () =>
      editEntry ? goTo(editEntry[0], true, selectedReport) : showReview());
    app.querySelector("#summary-month")?.addEventListener("change", event => {
      summaryMonth = event.target.value;
      render("summary-month");
    });
    if (analysis) bindAnalysis(analysis, currency);
    if (overviewChart) {
      detachCharts = globalThis.ForecastCharts.mount(app, { charts: [overviewChart] }, format);
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
    document.querySelector("#download")?.addEventListener("click", () => downloadAll(forecastReports, forecastAnswers));
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
    const analysisDownload = document.getElementById("analysis-download");
    analysisDownload.hidden = guestMode;
    analysisDownload.addEventListener("click", () => {
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
    const activeModules = activeModuleKeys(answers);
    const rows = [["Company", answers.company], ["Currency", currencyOf(answers)],
      ["Model type", "Multi-channel"], ["Revenue basis", "External revenue consolidated across channels"], ["Input basis", dataNote],
      ["Cash shortfall basis", "Month-end cash before additional funding"],
      ["Trade balance basis", "Sales and purchases spread evenly within 30-day model months"],
      [], ["Assumption or category", "Value or line item", "Field", "Line item value", "Unit"]];
    for (const prompt of activeQuestions(answers)) {
      const answer = effectiveRows(prompt, answers[prompt.id]);
      const label = prompt.exportLabel || prompt.label;
      if (prompt.type !== "items") {
        rows.push([prompt.label, inputValue(prompt, answer), "", "", inputUnit(prompt)]);
        continue;
      }
      if (prompt.note) rows.push([label, "Input guidance", prompt.note]);
      if (!answer?.length) rows.push([prompt.label, "None"]);
      const parent = prompt.channelId && answers.channels.find(channel => channel.key === prompt.channelId);
      for (const item of answer || []) {
        const scoped = scopedCostGroups.has(prompt.id);
        if (scoped) rows.push([label, item.name, "Applies to", costScopeLabel(item)]);
        const active = scoped ? costIsActive(item, activeModules) : included(item) && (!parent || included(parent));
        rows.push([label, item.name, "Included in forecast", active ? "Yes" : "No"]);
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
    const taxibeeArrayKeys = new Set(["taxibeeConfig", "taxibeeRamp", "taxibeeSchedule", "taxibeeStress"]);
    const prompts = new Map(availableQuestions(input).map(prompt => [prompt.id, prompt]));
    for (const [id, value] of Object.entries(input)) {
      if (id === "company") continue;
      if (id === "taxibeeMode") {
        if (!["vip-fleet", "fly-express"].includes(value)) throw new Error("The backup contains an invalid Taxibee mode.");
        continue;
      }
      if (taxibeeArrayKeys.has(id)) {
        if (!Array.isArray(value) || value.length > 250 || !value.every(row => isRecord(row) &&
            Object.entries(row).every(([field, answer]) => field.length <= 64 && isAnswer(answer)))) {
          throw new Error("The backup contains invalid Taxibee model inputs.");
        }
        continue;
      }
      const prompt = prompts.get(id);
      if (!prompt) throw new Error("The backup contains an unrecognized assumption.");
      if (prompt.type === "items") {
        if (!Array.isArray(value) || value.length > 250 || !value.every(row => isRecord(row) &&
            Object.entries(row).every(([field, answer]) => field.length <= 64 &&
              (field === "moduleScope" && scopedCostGroups.has(id)
                ? typeof answer === "string" && /^(?:[a-z0-9-]{1,64}(?:,[a-z0-9-]{1,64}){0,249})?$/.test(answer)
                : isAnswer(answer))))) {
          throw new Error(`The backup contains invalid line items for ${stepLabel(prompt)}.`);
        }
      } else if (!isAnswer(value)) {
        throw new Error(`The backup contains an invalid value for ${stepLabel(prompt)}.`);
      }
    }
    return input;
  }

  async function exportSavedAssumptions(status) {
    if (downloadBackup.disabled) return;
    downloadBackup.disabled = true;
    status.textContent = "Preparing saved assumptions…";
    try {
      const data = session ? (await session.request("load")).draft : readLocal();
      const stored = data?.answers ?? createDefaults();
      const backup = JSON.stringify({ format: backupFormat, version: backupVersion, answers: stored });
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Kampala", dateStyle: "short" }).format(new Date());
      downloadFile(new Blob([backup], { type: "application/json" }), `peebee-assumptions-${date}.json`);
      status.textContent = "Assumptions backup downloaded.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      downloadBackup.disabled = false;
    }
  }
  downloadBackup.addEventListener("click", () => void exportSavedAssumptions(backupStatus));

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

  if (guestMode) {
    app.innerHTML = '<p role="status">Checking guest access…</p>';
    void loadGuest();
    window.setInterval(() => { if (guestActive) void loadGuest(); }, 30000);
  } else if (session) {
    void loadShared();
    window.setInterval(() => { if (!document.hidden) void refreshAdminDefaults(); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshAdminDefaults(); });
  } else {
    if (addressView()) selectView(addressView());
    render();
  }
})();
