import assert from "node:assert/strict";
import test from "node:test";
import { isPracticeMode, startPracticeMode } from "@peebee/shared";
import { createCustomerFetch } from "./live-session";

function installStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, location: { origin: "https://customer.test" } } });
}

test("a signed-out customer never uses practice data, including on the login screen", async () => {
  installStorage();
  startPracticeMode("customer");
  assert.equal(isPracticeMode(), true);
  const calls: string[] = [];
  const real = (async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input), "https://customer.test").pathname);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const fetchImpl = createCustomerFetch(() => null, real);
  await fetchImpl("https://customer.test/v1/auth/login", { method: "POST", body: "{}" });
  await fetchImpl("https://customer.test/v1/auth/google", { method: "POST", body: "{}" });
  await fetchImpl("https://customer.test/v1/marketplace/stores");
  assert.deepEqual(calls, ["/v1/auth/login", "/v1/auth/google", "/v1/marketplace/stores"]);
});

test("signing in and out reach the live API while practice is on, and everything else stays practice", async () => {
  installStorage();
  startPracticeMode("customer");
  const calls: string[] = [];
  const real = (async (input: RequestInfo | URL) => {
    calls.push(`${(new URL(String(input), "https://customer.test")).pathname}`);
    return new Response(JSON.stringify({ real: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const fetchImpl = createCustomerFetch(() => "live-token", real);
  assert.equal(((await (await fetchImpl("https://customer.test/v1/auth/login", { method: "POST", body: "{}" })).json()) as { real: boolean }).real, true);
  assert.equal(((await (await fetchImpl("https://customer.test/v1/auth/logout", { method: "POST" })).json()) as { real: boolean }).real, true);
  const blocked = await (await fetchImpl("https://customer.test/v1/auth/password/change", { method: "POST", body: "{}" })).json() as { error: string; message: string };
  assert.equal(blocked.error, "practice_action_unavailable");
  assert.match(blocked.message, /live account was not changed/);
  assert.deepEqual(calls, ["/v1/auth/login", "/v1/auth/logout"]);
});
