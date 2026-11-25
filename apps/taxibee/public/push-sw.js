// Taxibee app-shell and push worker. It deliberately never caches API, account,
// booking, ticket, payment, or attachment responses.
const SHELL_CACHE = "taxibee-shell-v8";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
  "/styles.css?v=356",
  "/taxibee.css?v=6",
  "/customer-auth.css",
  "/customer-auth-adapter.css",
  "/leaflet.css",
  "/script.js?v=7",
  "/live.js?v=7",
  "/customer-header.js?v=3",
  "/customer-header.css?v=3",
  "/brand/header-roboto.ttf",
  "/assets/peebee-logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("taxibee-push", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("binding");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function binding(value, write = false) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("binding", write ? "readwrite" : "readonly");
    const store = transaction.objectStore("binding");
    const request = write ? store.put(value, "account") : store.get("account");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("taxibee-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Account, booking and payment data always goes to Peebee's live API.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match("/offline.html")) || Response.error();
    }));
    return;
  }

  if (!SHELL_ASSETS.some((asset) => new URL(asset, self.location.origin).pathname === url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener("message", (event) => {
  if (!["account-binding", "account-unbind"].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    if (event.data.type === "account-unbind") {
      if (await binding() !== event.data.accountId) return;
      await binding(null, true);
    } else {
      await binding(event.data.accountId || null, true);
    }
    for (const notification of await self.registration.getNotifications()) notification.close();
  })());
});

self.addEventListener("push", (event) => event.waitUntil((async () => {
  let data;
  try { data = event.data.json(); } catch { return; }
  const account = await binding();
  if (!account || data.accountId !== account) return;
  await self.registration.showNotification(String(data.title || "Taxibee"), {
    body: String(data.body || ""),
    tag: String(data.tag || "taxibee"),
    icon: "/icons/icon-192.png",
    data: { accountId: account },
  });
})()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    if (await binding() !== event.notification.data?.accountId) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: "taxibee-push-open" });
        return;
      }
    }
    await self.clients.openWindow("/?screen=notifications");
  })());
});
