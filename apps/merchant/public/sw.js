const STATIC_CACHE = "peebee-merchant-static-v3";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/brand/peebee-logo-light.png",
  "/brand/peebee-logo-dark.png",
  "/icons/icon-192.png?v=official-1",
  "/icons/icon-512.png?v=official-1",
  "/icons/apple-touch-icon.png?v=official-1",
  "/icons/favicon-32.png?v=official-1",
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
  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname))) {
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
