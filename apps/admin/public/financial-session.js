(() => {
  const financials = "https://financials.peebee.online";
  const api = "https://api.peebee.online";
  const endpoints = {
    load: ["GET", "/v1/admin/financial-model/draft"],
    save: ["PUT", "/v1/admin/financial-model/draft"],
    activity: ["GET", "/v1/admin/financial-model"],
  };
  if (window.parent === window) return;
  window.addEventListener("message", async event => {
    if (event.origin !== financials || event.source !== window.parent) return;
    const { id, action, body } = event.data || {};
    if (typeof id !== "string" || !Object.hasOwn(endpoints, action)) return;
    const reply = (status, data) => event.source.postMessage({ id, status, data }, financials);
    try {
      const token = localStorage.getItem("peebee_admin_token");
      if (!token) return reply(401);
      const [method, path] = endpoints[action];
      const headers = { Authorization: `Bearer ${token}` };
      if (method === "PUT") headers["Content-Type"] = "application/json";
      const result = await fetch(api + path, {
        method, headers, credentials: "omit", cache: "no-store", redirect: "error",
        body: method === "PUT" ? JSON.stringify(body) : undefined,
      });
      reply(result.status, await result.json().catch(() => null));
    } catch {
      reply(503);
    }
  });
})();
