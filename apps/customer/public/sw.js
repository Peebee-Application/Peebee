// Offline-first: the whole app (pages, code, styles, images) is served from
// the browser's cache, and only changed data comes from the server.
//  - ASSET_CACHE keeps a stable name on purpose: build output is
//    content-hashed, so an older cached page can always still find its chunks.
//  - PAGE_CACHE holds page HTML and Next.js RSC payloads (network first, the stored copy when the server is slow or away).
//  - RUNTIME_CACHE holds API reads (stale-while-revalidate, tells the app when
//    the server copy differs). Cleared on logout.
const ASSET_CACHE = "peebee-assets-v1";
// How long a page waits for the server before showing the stored copy.
const PAGE_WAIT_MS = 4000;
const PAGE_CACHE = "peebee-pages-v12";
const RUNTIME_CACHE = "peebee-runtime-v11";
const KEEP_CACHES = [ASSET_CACHE, PAGE_CACHE, RUNTIME_CACHE];
const OFFLINE_URL = "/offline.html";
// The app moved from customer.peebee.online to app.peebee.online. A phone that visited the old address still has this
// worker and cached pages there, so it would keep showing the old copy and never meet the server's redirect. On the
// old host the worker therefore sends every page navigation to the new address itself and caches nothing.
const OLD_HOST = "customer.peebee.online";
const NEW_ORIGIN = "https://app.peebee.online";
const ON_OLD_HOST = self.location.hostname === OLD_HOST;
const SHELL_URLS = ["/", "/login"];
const STATIC_ASSETS = ["/brand/peebee-logo-light.svg?v=logo-6", "/brand/peebee-logo-dark.svg?v=logo-6", "/sounds/notification.mp3", "/manifest.json", "/icons/icon-192.png?v=logo-6", "/icons/icon-512.png?v=logo-6", OFFLINE_URL];
const HOME_PHOTOS = ["bakeries", "boda", "buy-hero", "car", "clean", "discover", "eat-hero", "fix", "groceries", "hire", "laundry", "learn-hero", "list", "live", "move", "parcel", "pharmacy", "restaurants", "ride-hero", "stores", "street-food", "tv", "work-hero", "workers"].map((name) => `/home-screensaver/${name}.webp`);

// Every build-output URL (/_next/static/...) a page's HTML refers to. Next
// embeds them both plainly and inside escaped JSON ("\/_next\/static\/...").
function buildAssetUrls(html) {
  const found = new Set();
  const unescaped = html.replace(/\\\//g, "/");
  for (const m of unescaped.matchAll(/\/_next\/static\/[^"'()\s\\<>]+/g)) found.add(m[0]);
  return [...found];
}

async function precacheAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  const queue = [...new Set(urls)];
  const seen = new Set(queue);
  // Warm caches without flooding the connection on a customer's first visit.
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        let response = await cache.match(u);
        if (!response) {
          response = await fetch(u);
          if (!response.ok) continue;
          await cache.put(u, response.clone());
        }
        // Home artwork URLs are referenced by CSS, not directly by page HTML.
        if ((response.headers.get("content-type") || "").includes("text/css")) {
          const css = await response.text();
          const images = [...css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map((match) => new URL(match[1], new URL(u, self.location.origin))).filter((url) => url.origin === self.location.origin && /\.(webp|png|jpe?g|avif)(\?|$)/i.test(url.pathname));
          for (const url of images) if (!seen.has(url.href)) { seen.add(url.href); queue.push(url.href); }
        }
      } catch { /* Offline or full storage must never block the app. */ }
    }
  }));
}

// Store a page and pull in the code it needs, so it also opens with no signal.
async function storePage(request, response, event) {
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(request, response.clone());
  if ((response.headers.get("content-type") || "").includes("text/html")) {
    try {
      const warming = precacheAssets(buildAssetUrls(await response.clone().text())).catch(() => {});
      if (event) event.waitUntil(warming);
      else await warming;
    } catch {}
  }
}

self.addEventListener("install", (event) => {
  if (ON_OLD_HOST) { self.skipWaiting(); return; }
  event.waitUntil((async () => {
    const assets = await caches.open(ASSET_CACHE);
    await Promise.all(STATIC_ASSETS.map((u) => assets.add(u).catch(() => {})));
    await Promise.all(SHELL_URLS.map(async (u) => {
      try {
        const r = await fetch(u, { credentials: "same-origin" });
        if (r.ok && !r.redirected) await storePage(new Request(u), r);
      } catch {}
    }));
    await precacheAssets(HOME_PHOTOS);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ON_OLD_HOST || !KEEP_CACHES.includes(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// A logged-out user's cached responses shouldn't leak to whoever logs in
// next on the same device — the app asks for this on every logout (see
// lib/auth-context.tsx).
self.addEventListener("message", (event) => {
  if (event.data === "clear-runtime-cache") {
    event.waitUntil(Promise.all([caches.delete(RUNTIME_CACHE), caches.delete(PAGE_CACHE)]));
  }
});

// Next.js build output under /_next/static/ is content-hashed — the same
// URL never changes, so it's safe to cache forever.
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname) || STATIC_ASSETS.includes(url.pathname + url.search);
}

// Files shipped in /public (images, icons, fonts, sounds): cached, refreshed quietly.
function isPublicFile(url) {
  return /^\/(brand|icons|images|products|stores|demo-food|demo-video-src|sounds)\//.test(url.pathname) || /\.(?:svg|png|jpe?g|webp|avif|gif|ico|woff2?|mp3|mp4)$/i.test(url.pathname);
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

// Serve what is stored right away; refresh it in the background. `onFresh`
// receives (old, new) so the caller can react to a change.
async function staleWhileRevalidate(event, request, cacheName, onFresh) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const copy = response.clone();
        if (onFresh) await onFresh(cached, copy.clone());
        await cache.put(request, copy);
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }
  const network = await networkPromise;
  return network || Response.error();
}

// Tell open pages that the server's copy of this data differs from what they
// were just shown, so they can reload it.
async function announceIfChanged(url, oldResponse, newResponse) {
  if (!oldResponse) return;
  try {
    const [a, b] = await Promise.all([oldResponse.clone().text(), newResponse.text()]);
    if (a === b) return;
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) c.postMessage({ type: "peebee-data-updated", url });
  } catch {}
}

function isRscRequest(request, url) {
  return request.headers.has("RSC") || url.searchParams.has("_rsc");
}

// The platform's settings (Admin → Services switches among them) always come fresh when online, so a change shows the
// next time the app asks. Offline, the last copy is used.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (ON_OLD_HOST && url.origin === self.location.origin) {
    // Same path and query on the new address (the browser keeps the #fragment). Everything else goes to the network.
    if (request.mode === "navigate" && request.method === "GET") event.respondWith(Response.redirect(NEW_ORIGIN + url.pathname + url.search, 307));
    return;
  }

  // A mutation (POST/PUT/DELETE — funding an order, sending a message,
  // claiming a job) always goes straight to the network, exactly as
  // before. Only reads are ever served from a cache.
  if (request.method !== "GET") return;

  const sameOrigin = url.origin === self.location.origin;

  if (/^\/v1\/users\/[^/]+\/photo$/.test(url.pathname)) { event.respondWith(fetch(request)); return; }
  if (/^\/v1\/restaurants\/.*\/(cover|logo|reviews|insights)$/.test(url.pathname)) { event.respondWith(fetch(request)); return; }

  if (sameOrigin && isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isImmutableApiMedia(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Ride services and nearby availability can change while the app is open.
  // Never return a cached car config that can revive retired car-type choices.
  if (/^\/v1\/car\/(config|service-options)$/.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname === "/v1/settings") {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isApiGet(url)) {
    event.respondWith(staleWhileRevalidate(event, request, RUNTIME_CACHE, (o, n) => announceIfChanged(url.pathname + url.search, o, n)));
    return;
  }

  if (!sameOrigin) return;

  if (isPublicFile(url)) {
    event.respondWith(staleWhileRevalidate(event, request, ASSET_CACHE));
    return;
  }

  // A page open or in-app navigation: the current copy from the server whenever it answers promptly, so every page and the code
  // it needs always come from the same build. (Showing the stored copy first meant a page you hadn't opened since an update
  // still ran the old code, and screens of one app could be on different versions.) With a slow or missing connection the
  // stored copy is shown, and with nothing stored the offline screen.
  if (request.mode === "navigate" || isRscRequest(request, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      const refresh = fetch(request)
        .then(async (response) => {
          if (response.ok && !response.redirected) await storePage(request, response, event);
          return response;
        })
        .catch(() => null);
      event.waitUntil(refresh);
      const timeout = new Promise((resolve) => setTimeout(() => resolve("slow"), PAGE_WAIT_MS));
      const first = await Promise.race([refresh, timeout]);
      if (first && first !== "slow") return first;
      const cached = await cache.match(request);
      if (cached) return cached;
      const network = first === "slow" ? await refresh : null;
      if (network) return network;
      if (request.mode === "navigate") return (await caches.match(OFFLINE_URL)) || Response.error();
      return Response.error();
    })());
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
      icon: "/icons/icon-192.png?v=logo-6",
      badge: "/icons/icon-192.png?v=logo-6",
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
