import assert from "node:assert/strict";
import test from "node:test";
import { configurePracticeSession, createApiClient, endServerPractice, isServerPractice, launchPractice } from "@peebee/shared";
import app from "../app.js";
import { runInPractice } from "../db/practice-context.js";
import { topUpDemoOrders } from "./demo-customers.js";
import { seedPracticeWorld } from "./seed.js";
import { practiceHarness } from "./world-test-helpers.js";

function installStorage() {
  const data = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
    location: { origin: "https://app.test", replace() {}, assign() {} },
  };
  return data;
}

test("an app starts practice, is signed in as the persona on the shared world, and gets its own session back on exit", async () => {
  const { tokens } = await practiceHarness();
  await runInPractice(async () => { await seedPracticeWorld(); await topUpDemoOrders(4); });
  const storage = installStorage();
  storage.set("rider_token", tokens.rider);
  storage.set("rider_user", JSON.stringify({ id: "real_rider" }));
  const viaApp = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input).replace("https://api.test", ""), init)) as typeof fetch;
  const api = createApiClient({ baseUrl: "https://api.test", fetchImpl: viaApp, getToken: () => storage.get("rider_token") });
  configurePracticeSession({ api, apply: (r) => ({ rider_token: r.token, rider_user: JSON.stringify(r.user) }) });

  const path = await launchPractice("rider");
  assert.equal(path, "/");
  assert.equal(isServerPractice(), true);
  assert.equal(JSON.parse(storage.get("rider_user")!).id, "prac_rider_1", "signed in as the persona");

  const jobs = await api.availableJobs();
  assert.ok(jobs.jobs.length >= 1, "the persona sees what demo customers ordered");

  assert.equal(endServerPractice(), true);
  assert.equal(storage.get("rider_token"), tokens.rider, "the real session is back");
  assert.equal(JSON.parse(storage.get("rider_user")!).id, "real_rider");
  assert.equal(isServerPractice(), false);
});

test("if the shared world can't be offered, the app falls back to the built-in sample", async () => {
  const { tokens, mainDb: db } = await practiceHarness();
  await db.execute({ sql: "UPDATE settings SET value = '0' WHERE key = 'user_practice_mode_enabled'", args: [] });
  const { invalidateSettingsCache } = await import("../lib/settings.js");
  invalidateSettingsCache();
  const storage = installStorage();
  storage.set("rider_token", tokens.rider);
  const viaApp = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input).replace("https://api.test", ""), init)) as typeof fetch;
  const api = createApiClient({ baseUrl: "https://api.test", fetchImpl: viaApp, getToken: () => storage.get("rider_token") });
  configurePracticeSession({ api, apply: (r) => ({ rider_token: r.token }) });
  await launchPractice("rider");
  assert.equal(isServerPractice(), false, "not on the shared world");
  assert.equal(storage.get("peebee_practice_mode"), "1", "the built-in sample is on instead");
  assert.equal(storage.get("rider_token"), tokens.rider, "the real session was not touched");
});
