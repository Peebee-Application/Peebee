(() => {
  if (location.hostname !== "financials.peebee.online") return;
  const admin = "https://admin.peebee.online";
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Peebee Admin session";
  frame.src = admin + "/financial-session";
  const pending = new Map();
  let accountId;
  window.addEventListener("message", event => {
    if (event.origin !== admin || event.source !== frame.contentWindow) return;
    const { id, status, data, accountChanged } = event.data || {};
    if (accountChanged) window.dispatchEvent(new Event("adminaccountchange"));
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
        if (status === 200 && data) {
          if (data.user?.id) accountId = data.user.id;
          if (action === "logout") accountId = undefined;
          return resolve(data);
        }
        const message = data?.message || (status === 401
          ? action === "login" ? "The email, phone number or password is incorrect." : "Sign in with your Peebee Admin account."
          : status === 403 ? "This Admin account does not have access to the financial model."
          : status === 409 ? "Someone else saved a newer version. Reload the shared forecast to see their changes."
          : "Could not connect to Peebee Admin. Try again.");
        reject(Object.assign(new Error(message), { status }));
      };
      const timer = setTimeout(() => finish(503), 8000);
      pending.set(id, finish);
      frame.contentWindow.postMessage({ id, action, body, accountId }, admin);
    });
  }

  globalThis.SharedForecastSession = { request };
})();
