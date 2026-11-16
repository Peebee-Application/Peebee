(() => {
  if (location.hostname !== "financials.peebee.online") return;
  const admin = "https://admin.peebee.online";
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Peebee Admin session";
  frame.src = admin + "/financial-session";
  const pending = new Map();
  window.addEventListener("message", event => {
    if (event.origin !== admin || event.source !== frame.contentWindow) return;
    const { id, status, data } = event.data || {};
    pending.get(id)?.(status, data);
  });
  const ready = new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);

  async function request(action, body) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (status, data) => {
        clearTimeout(timer);
        pending.delete(id);
        if (status === 200 && data) return resolve(data);
        const message = status === 401 ? "Sign in to Peebee Admin and try again."
          : status === 403 ? "This Admin account does not have access to the financial model."
          : status === 409 ? "Someone else saved a newer version. Reload the shared forecast to see their changes."
          : data?.message || "Could not connect to the shared forecast. Try again.";
        reject(Object.assign(new Error(message), { status }));
      };
      const timer = setTimeout(() => finish(503), 8000);
      pending.set(id, finish);
      frame.contentWindow.postMessage({ id, action, body }, admin);
    });
  }

  globalThis.SharedForecastSession = { request };
})();
