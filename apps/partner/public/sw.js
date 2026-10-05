const STATIC_CACHE = "peebee-partner-static-v8";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = ["/sounds/notification.mp3",
  "/manifest.webmanifest",
  "/brand/peebee-logo-light.svg?v=svg-5",
  "/brand/peebee-logo-dark.svg?v=svg-5",
  "/icons/icon-192.png?v=svg-5",
  "/icons/icon-512.png?v=svg-5",
  "/icons/apple-touch-icon.png?v=svg-5",
  "/icons/favicon-32.png?v=svg-5",
  OFFLINE_URL,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || (STATIC_ASSETS.includes(url.pathname) || STATIC_ASSETS.includes(url.pathname + url.search)))) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || (await caches.match(OFFLINE_URL))));
  }
});

// Web push retains the device's notification sound. A visible app plays
// its own MP3; service workers cannot play audio while the app is closed.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || "Peebee", {
      body: data.body || "You have a new notification",
      icon: "/icons/icon-192.png?v=svg-5",
      badge: "/icons/icon-192.png?v=svg-5",
      tag: data.tag || "peebee-alert",
      data: { url: data.url || "/" },
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const visible = clients.filter((client) => client.visibilityState === "visible");
      const target = visible.find((client) => client.focused) || visible[0];
      target?.postMessage({ type: "peebee-notification" });
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);
  if (targetUrl.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(targetUrl.href).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});
