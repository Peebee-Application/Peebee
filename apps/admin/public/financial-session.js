(() => {
  const financials = "https://financials.peebee.online";
  const api = "https://api.peebee.online";
  const tokenKey = "peebee_admin_token";
  const userKey = "peebee_admin_user";
  const endpoints = {
    login: ["POST", "/v1/auth/login"],
    account: ["GET", "/v1/auth/me"],
    password: ["POST", "/v1/auth/password/change"],
    logout: ["POST", "/v1/auth/logout"],
    preferences: ["GET", "/v1/admin/financial-model/preferences"],
    savePreferences: ["PUT", "/v1/admin/financial-model/preferences"],
    load: ["GET", "/v1/admin/financial-model/draft"],
    save: ["PUT", "/v1/admin/financial-model/draft"],
    activity: ["GET", "/v1/admin/financial-model"],
    guestInvites: ["GET", "/v1/admin/financial-model/invites"],
    createGuestInvite: ["POST", "/v1/admin/financial-model/invites"],
    revokeGuestInvite: ["DELETE", "/v1/admin/financial-model/invites"],
  };
  if (window.parent === window) return;
  window.addEventListener("storage", event => {
    if (event.key !== userKey && event.key !== null) return;
    const userId = value => {
      try { return JSON.parse(value)?.id; } catch { return undefined; }
    };
    if (event.key === null || userId(event.oldValue) !== userId(event.newValue)) {
      window.parent.postMessage({ accountChanged: true }, financials);
    }
  });

  window.addEventListener("message", async event => {
    if (event.origin !== financials || event.source !== window.parent) return;
    const { id, action, body, accountId } = event.data || {};
    if (typeof id !== "string" || !Object.hasOwn(endpoints, action)) return;
    const reply = (status, data) => event.source.postMessage({ id, status, data }, financials);
    try {
      const token = localStorage.getItem(tokenKey);
      if (!token && action !== "login") return reply(401);
      if (accountId && action !== "login" && action !== "account" &&
          accountId !== JSON.parse(localStorage.getItem(userKey))?.id) {
        return reply(401, { message: "Your Admin account changed. Sign in again to continue." });
      }
      const [method, endpoint] = endpoints[action];
      if (action === "revokeGuestInvite" && (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))) return reply(400);
      const path = action === "revokeGuestInvite" ? `${endpoint}/${encodeURIComponent(body.id)}` : endpoint;
      const headers = {};
      if (token && action !== "login") headers.Authorization = `Bearer ${token}`;
      if (method !== "GET") headers["Content-Type"] = "application/json";
      const result = await fetch(api + path, {
        method, headers, credentials: "omit", cache: "no-store", redirect: "error",
        body: method === "GET" ? undefined : JSON.stringify(action === "logout" ? {} : body),
      });
      const data = await result.json().catch(() => null);
      if (action === "logout" && (result.ok || result.status === 401)) {
        if (localStorage.getItem(tokenKey) === token) {
          navigator.serviceWorker?.controller?.postMessage("clear-runtime-cache");
          localStorage.removeItem(tokenKey);
          localStorage.removeItem(userKey);
        }
        return reply(200, { ok: true });
      }
      if (!result.ok) return reply(result.status, data);
      if (action === "login" || action === "password" || action === "account") {
        const user = data?.user;
        if (user?.role !== "admin") return reply(403, { message: "Sign in with a Peebee Admin account." });
        if (action !== "account") {
          if (!data.token) return reply(503);
          if (localStorage.getItem(tokenKey) !== token) return reply(409, { message: "Your Admin session changed. Refresh the page and try again." });
          navigator.serviceWorker?.controller?.postMessage("clear-runtime-cache");
          localStorage.setItem(tokenKey, data.token);
          localStorage.setItem(userKey, JSON.stringify(user));
        }
        return reply(200, { user: {
          id: user.id, name: user.name, email: user.email, phone: user.phone,
          adminRole: user.adminRole, forcePasswordChange: user.forcePasswordChange,
        } });
      }
      reply(result.status, data);
    } catch {
      reply(503);
    }
  });
})();
