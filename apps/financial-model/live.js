(() => {
  function applyRates(answers, rates) {
    const byLine = new Map(rates.map(rate => [JSON.stringify([rate.channel, rate.name]), rate]));
    let updated = 0;
    for (const channel of answers.channels || []) {
      for (const line of answers[`channel-${channel.key}`] || []) {
        const setting = byLine.get(JSON.stringify([channel.key, line.name]));
        if (!setting || !Number.isFinite(setting.value) || setting.value < 0) continue;
        const percentage = line.method === "orders" || line.method === "percentage";
        const field = percentage && setting.kind === "percent" && setting.value <= 100 ? "rate"
          : (line.method === "units" && setting.kind === "flat") || (line.method === "subscription" && setting.kind === "monthly") ? "price" : null;
        if (!field) continue;
        const value = String(Number(setting.value.toFixed(4)));
        if (line[field] === value) continue;
        line[field] = value;
        updated++;
      }
    }
    return updated;
  }

  function mount({ escape, format, confirmAction, open, beforeApply, applyRates: importRates }) {
    if (location.hostname !== "financials.peebee.online") return;
    const launch = document.querySelector("#live-data");
    const dialog = document.querySelector("#live-dialog");
    let token;
    let snapshot;
    let status = "";
    let busy = false;
    const ugx = amount => amount == null ? "—" : `UGX ${format(amount)}`;
    const number = value => value == null ? "—" : format(value);
    const timestamp = value => new Intl.DateTimeFormat("en-UG", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala",
    }).format(new Date(value));

    async function request(path, body) {
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (body) headers.set("Content-Type", "application/json");
      const response = await fetch(path, {
        method: body ? "POST" : "GET", headers, cache: "no-store",
        credentials: "omit", body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) {
        token = undefined;
        snapshot = undefined;
        throw new Error("Sign in with your Peebee Admin credentials.");
      }
      if (response.status === 403) throw new Error("This account needs access to Payments management and Admin statistics.");
      if (response.status === 429) throw new Error("Too many attempts. Wait before trying again.");
      if (!response.ok) throw new Error("Could not retrieve live Admin data. Try again.");
      return response.json();
    }

    function draw() {
      const activity = snapshot?.activity.map(source => `<details>
        <summary>${escape(source.label)}</summary>
        ${!source.available ? '<p class="muted">This data source is unavailable.</p>' : !source.rows.length ? '<p class="muted">No records in this period.</p>' :
          `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">Category</th><th scope="col">Orders</th><th scope="col">Recorded value</th><th scope="col">Average value</th><th scope="col">Recorded fees</th></tr></thead>
            <tbody>${source.rows.map(row => `<tr><th scope="row">${escape(row.name.replaceAll("_", " "))}</th><td>${number(row.orders)}</td><td>${ugx(row.volume)}</td><td>${ugx(row.orders ? row.volume / row.orders : null)}</td><td>${ugx(row.fees)}</td></tr>`).join("")}</tbody></table></div>`}
        </details>`).join("");
      dialog.innerHTML = `<div class="toolbar"><h2 id="live-title">Live Admin data</h2>
        <button class="button secondary small" id="live-close" type="button">Close</button></div>
        <p id="live-status" class="muted" role="status" tabindex="-1">${escape(status)}</p>
        ${!token ? `<form id="live-login">
          <label for="live-identifier">Admin email or phone</label>
          <input id="live-identifier" name="identifier" autocomplete="username" required>
          <label for="live-password">Password</label>
          <input id="live-password" name="password" type="password" autocomplete="current-password" required>
          <button class="button gold" type="submit" ${busy ? "disabled" : ""}>Sign in to sync</button>
        </form>` : `<div class="toolbar">
          <button class="button secondary small" id="live-refresh" type="button" ${busy ? "disabled" : ""}>Refresh</button>
          <button class="button secondary small" id="live-signout" type="button" ${busy ? "disabled" : ""}>Sign out</button>
        </div>`}
        ${snapshot ? `<p class="muted">Live activity from ${escape(timestamp(snapshot.from))} to ${escape(timestamp(snapshot.to))} (Kampala time).</p>
          <p class="muted">Activity reflects recorded transactions from the listed sources. Some flows and adjustments have separate records. Use the figures to inform the forecast and count each fee once.</p>
          ${activity}
          <details><summary>Current fees and prices</summary>
            <div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">Fee</th><th scope="col">Current setting</th></tr></thead>
            <tbody>${snapshot.rates.map(rate => `<tr><th scope="row">${escape(rate.name)}${rate.note ? `<br><small class="muted">${escape(rate.note)}</small>` : ""}</th>
            <td>${rate.kind === "percent" ? `${format(rate.value)}%` : `${ugx(rate.value)}${rate.kind === "monthly" ? " / month" : ""}`}</td></tr>`).join("")}</tbody></table></div>
          </details>
          <p class="muted">Apply rates to matching forecast lines. Change the revenue driver first when a fee switches between flat and percentage.</p>
          <button class="button gold" type="button" id="live-apply" ${busy ? "disabled" : ""}>Apply live fees to forecast</button>` : ""}`;
      dialog.querySelector("#live-close").onclick = () => dialog.close();
      dialog.querySelector("#live-login")?.addEventListener("submit", event => {
        event.preventDefault();
        const { identifier, password } = Object.fromEntries(new FormData(event.target));
        void refresh({ identifier, password });
      });
      dialog.querySelector("#live-refresh")?.addEventListener("click", () => refresh());
      dialog.querySelector("#live-signout")?.addEventListener("click", signOut);
      dialog.querySelector("#live-apply")?.addEventListener("click", () => {
        confirmAction(
          "Overwrite forecast fees with live rates?",
          "This replaces the fees you entered on matching forecast lines with the current production Admin rates. It does not change volumes or write anything to Admin. Cancel to keep your current fee assumptions.",
          "Overwrite matching fees",
          () => beforeApply(() => {
            status = importRates(snapshot.rates);
            dialog.querySelector("#live-status").textContent = status;
          }, dialog)
        );
      });
    }

    async function refresh(credentials) {
      if (busy) return;
      busy = true;
      status = "Loading live Admin data…";
      draw();
      try {
        if (credentials) {
          const session = await request("/v1/auth/login", credentials);
          token = session.token;
          if (session.user?.role !== "admin") {
            await signOut();
            throw new Error("Use a Peebee Admin account.");
          }
        }
        snapshot = await request("/v1/admin/financial-model");
        status = "Live data updated.";
      } catch (error) {
        snapshot = undefined;
        status = error instanceof Error ? error.message : "Could not retrieve live Admin data.";
      } finally {
        busy = false;
        draw();
        dialog.querySelector("#live-status").focus();
      }
    }

    async function signOut() {
      try { if (token) await request("/v1/auth/logout", {}); } catch { /* Return to the signed-out state on a network error. */ }
      token = undefined;
      snapshot = undefined;
      status = "Signed out.";
      draw();
    }

    launch.hidden = false;
    launch.addEventListener("click", () => open(() => {
      draw();
      dialog.showModal();
    }));
  }

  globalThis.FinancialLive = { mount, applyRates };
})();
