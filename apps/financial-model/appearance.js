(() => {
  const key = "peebee-financial-model-appearance";
  const modes = new Set(["dark", "light", "system", "auto"]);
  const system = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const dayStart = 7;
  const nightStart = 19;
  let mode = "system";
  let control;
  let timer;
  const accountSettings = location.hostname === "financials.peebee.online";
  try {
    const saved = localStorage.getItem(key);
    if (!accountSettings && modes.has(saved)) mode = saved;
  } catch { /* The selected mode still applies in this tab. */ }

  function update() {
    clearTimeout(timer);
    let theme = mode;
    if (mode === "system") theme = system.matches ? "dark" : "light";
    if (mode === "auto") {
      const now = new Date();
      const hour = now.getHours();
      theme = hour >= dayStart && hour < nightStart ? "light" : "dark";
      const next = new Date(now);
      next.setHours(hour < dayStart || hour >= nightStart ? dayStart : nightStart, 0, 0, 0);
      if (hour >= nightStart) next.setDate(next.getDate() + 1);
      timer = setTimeout(update, next - now);
    }
    if (control) control.value = mode;
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    document.dispatchEvent(new Event("appearancechange"));
  }

  globalThis.ForecastAppearance = {
    set(value) {
      if (!modes.has(value)) return;
      mode = value;
      update();
    },
  };
  update();
  system.addEventListener("change", update);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) update();
  });
  addEventListener("storage", event => {
    if (accountSettings || (event.key !== key && event.key !== null)) return;
    mode = modes.has(event.newValue) ? event.newValue : "system";
    update();
  });
  document.addEventListener("DOMContentLoaded", () => {
    control = document.querySelector("#appearance-mode");
    control.value = mode;
    control.addEventListener("change", () => {
      if (!modes.has(control.value)) return;
      mode = control.value;
      if (accountSettings) {
        document.dispatchEvent(new CustomEvent("appearancepreference", { detail: mode }));
      } else {
        try { localStorage.setItem(key, mode); } catch { /* Keep the mode in this tab. */ }
      }
      update();
    });
  });
})();
