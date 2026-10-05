const STATIC_CACHE = "peebee-static-v8";
const RUNTIME_CACHE = "peebee-runtime-v7";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = ["/brand/peebee-logo-light.svg?v=svg-5", "/brand/peebee-logo-dark.svg?v=svg-5", "/sounds/notification.mp3", "/manifest.json", "/icons/icon-192.png?v=svg-5", "/icons/icon-512.png?v=svg-5", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// A logged-out user's cached responses shouldn't leak to whoever logs in
// next on the same device — the app asks for this on every logout (see
// lib/auth-context.tsx).
self.addEventListener("message", (event) => {
  if (event.data === "clear-runtime-cache") {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});

// Next.js build output under /_next/static/ is content-hashed — the same
// URL never changes, so it's safe to cache forever. This is the single
// biggest saving on a repeat visit: zero JS/CSS re-downloaded.
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || (STATIC_ASSETS.includes(url.pathname) || STATIC_ASSETS.includes(url.pathname + url.search));
}

// Media that never changes once it exists — a sent chat photo/voice note,
// a profile photo. Cache-first: view it once, never pay for it again.
function isImmutableApiMedia(url) {
  return /^\/v1\/chat\/media\//.test(url.pathname) || /^\/v1\/(users|riders)\/[^/]+\/photo$/.test(url.pathname);
}

function isApiGet(url) {
  return url.pathname.startsWith("/v1/");
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

// Serves the last-known response instantly (so a page renders real data
// the moment it opens, even on a slow or dead connection), while a fresh
// copy is fetched in the background to update the cache for next time —
// the standard "stale while revalidate" tradeoff: a screen may be a few
// seconds out of date, never blank.
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        caches.open(cacheName).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const network = await networkPromise;
  return network || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // A mutation (POST/PUT/DELETE — funding an order, sending a message,
  // claiming a job) always goes straight to the network, exactly as
  // before. Only reads are ever served from a cache.
  if (request.method !== "GET") return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isImmutableApiMedia(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isApiGet(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // A page navigation — try the network first (so a signed-in user always
  // sees the real, current page when there's connectivity), and only fall
  // back to a cached copy or the offline page when there truly isn't one,
  // so a dead connection shows Peebee's own offline screen instead of the
  // browser's generic error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        return cached || (await caches.match(OFFLINE_URL));
      }),
    );
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
