import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const deletedCaches: string[] = [];
  let claimed = false;
  const fetched: string[] = [];
  const badUrl = "https://app.peebee.online/_next/static/css/5a1d05881399c121.css";
  const leakedUrl = "https://app.peebee.online/_next/static/css/other-old.css";
  const goodUrl = "https://app.peebee.online/_next/static/chunks/app.js";
  const leakedCss = ".w-full,.w-scrim{position:fixed;inset:0}.w-full{z-index:60;display:flex}";
  const fixedCss = ".wallet-root .wallet-result{position:fixed;inset:0;z-index:60}";
  function bucket(name: string) {
    let map = stores.get(name);
    if (!map) { map = new Map(); stores.set(name, map); }
    return {
      match: async (request: Request | string) => map!.get(typeof request === "string" ? request : request.url)?.clone(),
      put: async (request: Request | string, response: Response) => { map!.set(typeof request === "string" ? request : request.url, response); },
      delete: async (request: Request | string) => map!.delete(typeof request === "string" ? request : request.url),
      keys: async () => [...map!.keys()].map((url) => new Request(url)),
    };
  }
  stores.set("peebee-assets-v1", new Map([
    [badUrl, new Response(leakedCss, { headers: { "content-type": "text/css" } })],
    [leakedUrl, new Response(leakedCss, { headers: { "content-type": "text/css" } })],
    [goodUrl, new Response("ok", { headers: { "content-type": "text/javascript" } })],
    ["https://app.peebee.online/_next/static/css/fresh.css", new Response(fixedCss, { headers: { "content-type": "text/css" } })],
  ]));
  vm.runInNewContext(source, {
    URL, Request, Response, setTimeout, console,
    self: {
      location: new URL("https://app.peebee.online/sw.js"),
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
      skipWaiting: () => undefined,
      clients: { claim: async () => { claimed = true; }, matchAll: async () => [] },
    },
    caches: {
      open: async (name: string) => bucket(name),
      match: async (request: Request | string) => {
        const url = typeof request === "string" ? request : request.url;
        for (const map of stores.values()) if (map.has(url)) return map.get(url)!.clone();
        return undefined;
      },
      keys: async () => ["peebee-assets-v1", "peebee-pages-v13", "peebee-runtime-v12", "peebee-pages-v14", "peebee-runtime-v13", "peebee-pages-v15", "peebee-runtime-v14", "peebee-pages-v16", "peebee-runtime-v15", "peebee-pages-v17", "peebee-runtime-v16", "peebee-pages-v18", "peebee-runtime-v17", "peebee-pages-v19", "peebee-runtime-v18", "peebee-pages-v20", "peebee-runtime-v19"],
      delete: async (name: string) => { deletedCaches.push(name); stores.delete(name); return true; },
    },
    fetch: async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      fetched.push(url);
      return new Response("from-network", { status: 200, headers: { "content-type": "text/css" } });
    },
  });
  return { handlers, stores, deletedCaches, fetched, badUrl, leakedUrl, goodUrl, claimed: () => claimed };
}

test("customer worker drops stale pages and the leaked wallet CSS, and keeps other assets", async () => {
  const w = worker();
  assert.match(source, /peebee-pages-v20/);
  assert.match(source, /peebee-runtime-v19/);
  assert.match(source, /skipWaiting\(\)/);
  let done: Promise<unknown> | undefined;
  w.handlers.get("activate")!({ waitUntil: (promise: Promise<unknown>) => { done = promise; } });
  await done;
  assert.ok(w.claimed());
  assert.deepEqual(w.deletedCaches.sort(), ["peebee-pages-v13", "peebee-pages-v14", "peebee-pages-v15", "peebee-pages-v16", "peebee-pages-v17", "peebee-pages-v18", "peebee-pages-v19", "peebee-runtime-v12", "peebee-runtime-v13", "peebee-runtime-v14", "peebee-runtime-v15", "peebee-runtime-v16", "peebee-runtime-v17", "peebee-runtime-v18"]);
  const assets = w.stores.get("peebee-assets-v1")!;
  assert.equal(assets.has(w.badUrl), false);
  assert.equal(assets.has(w.leakedUrl), false);
  assert.equal(assets.has(w.goodUrl), true);
  assert.equal(assets.has("https://app.peebee.online/_next/static/css/fresh.css"), true);

  let response: Promise<Response> | undefined;
  w.handlers.get("fetch")!({
    request: new Request(w.badUrl),
    respondWith: (result: Promise<Response>) => { response = result; },
    waitUntil: () => undefined,
  });
  const served = await response!;
  assert.equal(await served.text(), "from-network");
  assert.equal(assets.has(w.badUrl), false);
});
