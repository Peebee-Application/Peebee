import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const path = existsSync(resolve("apps/merchant/public/sw.js")) ? resolve("apps/merchant/public/sw.js") : resolve("../merchant/public/sw.js");
const source = readFileSync(path, "utf8");
function worker(options: {offline?: boolean; host?: string; status?: number} = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const calls = {cache: 0, network: 0, deleted: [] as string[]};
  const cache = {match: async () => { calls.cache++; return new Response("another account's cached secret"); }, put: async () => undefined};
  runInNewContext(source, {
    URL, Request, Response, setTimeout,
    self: {location: new URL(`https://${options.host ?? "merchant.peebee.online"}/sw.js`), addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), clients: {claim: () => undefined, matchAll: async () => []}},
    caches: {open: async () => cache, match: cache.match, keys: async () => ["peebee-merchant-runtime-v1", "peebee-merchant-runtime-v2", "peebee-merchant-assets-v1", "peebee-merchant-pages-v2"], delete: async (key: string) => {calls.deleted.push(key); return true;}},
    fetch: async () => {calls.network++; if (options.offline) throw new Error("offline"); return new Response("fresh server response", {status: options.status ?? 200});},
  });
  const request = (url: string, headers: Record<string, string> = {}) => {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({request: new Request(url, {headers}), respondWith: (result: Promise<Response>) => {response = result;}, waitUntil: () => undefined});
    return response;
  };
  return {request, handlers, calls};
}

test("merchant worker never serves cached authenticated account or balance data", async () => {
  const w = worker();
  for (const token of ["alice", "bob"]) {
    const response = await w.request("https://api.peebee.online/v1/merchants/me", {Authorization: `Bearer ${token}`});
    assert.equal(await response!.text(), "fresh server response");
  }
  assert.equal(w.calls.cache, 0); assert.equal(w.calls.network, 2);
});

test("an expired phone proof cannot be bypassed by a previously cached digital purchase", async () => {
  const w = worker({status: 403});
  const response = await w.request("https://api.peebee.online/v1/marketplace/digital-fulfillments/private-token");
  assert.equal(response!.status, 403); assert.equal(w.calls.cache, 0);
});

test("offline account requests fail instead of presenting another user's stale data", async () => {
  const w = worker({offline: true});
  await assert.rejects(w.request("https://api.peebee.online/v1/merchants/me", {Authorization: "Bearer bob"})!, /offline/);
  assert.equal(w.calls.cache, 0);
});

test("development assets bypass the worker and activation deletes the old private-data cache", async () => {
  const dev = worker({host: "localhost"});
  assert.equal(dev.request("https://localhost/_next/static/chunks/app/layout.js"), undefined);
  assert.equal(dev.calls.cache, 0);
  const production = worker(); let complete: Promise<unknown> | undefined;
  production.handlers.get("activate")!({waitUntil: (promise: Promise<unknown>) => {complete = promise;}});
  await complete;
  assert.deepEqual(production.calls.deleted, ["peebee-merchant-runtime-v1"]);
});
