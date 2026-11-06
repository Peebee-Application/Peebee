import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HOME_MENU, DEFAULT_HOME_TEMPLATES, HOME_SHORTCUTS, HOME_TEMPLATE_IDS, availableHomeShortcuts, nextHomeTemplate, pickHomeShortcuts, randomHomeInterval, resolveHomeTemplates, type HomeAvailability } from "@peebee/shared";
import { canRotateHome, chooseHomeSelection, initialHomeSelection, restoreHomeSelection, type HomeRotationSafety } from "./home-rotation";

const config = () => structuredClone(DEFAULT_HOME_TEMPLATES);
const availability = (): HomeAvailability => ({ on: () => true, special: { luxury: true, ambulance: true }, taxipress: true, hire: { hire: true, workers: true }, hive: DEFAULT_HOME_MENU.hive.shortcuts });

test("returning home restores the saved design unless Admin enables return rotation", () => {
  const c = config(), options = availableHomeShortcuts(c, availability());
  const previous = chooseHomeSelection(c, options, undefined, () => 0);
  assert.deepEqual(initialHomeSelection(JSON.stringify(previous), c, options, () => .9), previous);
  c.rotateOnReturn = true;
  const next = initialHomeSelection(JSON.stringify(previous), c, options, () => 0);
  assert.notEqual(next.template, previous.template);
  c.templates = [previous.template];
  assert.equal(initialHomeSelection(JSON.stringify(previous), c, options).template, previous.template);
});

test("all ten approved templates can be drawn and a change does not repeat the current one", () => {
  assert.deepEqual(HOME_TEMPLATE_IDS, ["04", "07", "08", "09", "11", "12", "16", "17", "18", "20"]);
  for (const current of HOME_TEMPLATE_IDS) {
    for (const random of [() => 0, () => .5, () => 1]) assert.notEqual(nextHomeTemplate(HOME_TEMPLATE_IDS, current, random), current);
  }
  assert.equal(nextHomeTemplate(["11"], "11"), "11", "a single design can still refresh its shortcuts");
});

test("random intervals respect admin bounds, including a fixed interval", () => {
  const c = config(); c.minIntervalSeconds = 30; c.maxIntervalSeconds = 120;
  assert.equal(randomHomeInterval(c, () => 0), 30000);
  assert.equal(randomHomeInterval(c, () => 1), 120000);
  c.maxIntervalSeconds = 30;
  assert.equal(randomHomeInterval(c), 30000);
});

test("weighted sampling promotes the admin selection without duplicates or starving ordinary shortcuts", () => {
  const c = config(); c.shortcutCount = 1; c.preferredShortcuts = ["boda"]; c.preferredWeight = 6;
  const pool = HOME_SHORTCUTS.filter((s) => ["boda", "parcel", "shopping"].includes(s.id));
  let seed = 42;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const seen = new Map<string, number>();
  for (let i = 0; i < 10000; i++) { const id = pickHomeShortcuts(pool, c, random)[0]!.id; seen.set(id, (seen.get(id) ?? 0) + 1); }
  assert.ok(seen.get("boda")! > 7000 && seen.get("boda")! < 8000);
  assert.ok(seen.get("parcel")! > 1000 && seen.get("shopping")! > 1000);
  c.shortcutCount = 6;
  const all = pickHomeShortcuts(pool, c, random);
  assert.equal(all.length, pool.length);
  assert.equal(new Set(all.map((s) => s.id)).size, pool.length);
  assert.deepEqual(pickHomeShortcuts([], c), []);
});

test("eligible pool obeys service, special vehicle, taxi, Hire and home-menu availability", () => {
  const a = availability();
  a.on = (key) => key !== "buy.food" && key !== "learn";
  a.special = { luxury: false, ambulance: false }; a.taxipress = false; a.hire = { hire: false, workers: false };
  a.hive = a.hive.map((s) => ({ ...s, enabled: s.id !== "laundry", label: s.id === "clean" ? "Cleaning" : s.label }));
  const c = config();
  const available = availableHomeShortcuts(c, a);
  for (const id of ["luxury", "ambulance", "taxipress", "hire", "workers", "laundry", "restaurants", "kitchens", "learn", "connect"]) assert.equal(available.some((s) => s.id === id), false, id);
  assert.equal(available.find((s) => s.id === "clean")?.label, "Cleaning");
  c.eligibleShortcuts = ["boda"];
  assert.deepEqual(availableHomeShortcuts(c, a).map((s) => s.id), ["boda"]);
});

test("saved selection survives navigation but never resurrects disabled options or a different slot count", () => {
  const c = config(); const options = availableHomeShortcuts(c, availability());
  const chosen = chooseHomeSelection(c, options, undefined, () => 0);
  const raw = JSON.stringify(chosen);
  assert.deepEqual(restoreHomeSelection(raw, c, options), chosen);
  assert.equal(restoreHomeSelection(raw, c, options.filter((s) => s.id !== chosen.shortcuts[0])), null);
  assert.equal(restoreHomeSelection(raw, { ...c, templates: ["11"] }, options), null);
  assert.equal(restoreHomeSelection(raw, { ...c, shortcutCount: 2 }, options), null);
  assert.equal(restoreHomeSelection('not json', c, options), null);
});

test("rotation cannot interrupt focus, a gesture, overlay, hover, backgrounding or recent interaction", () => {
  const safe: HomeRotationSafety = { visible: true, paused: false, overlay: false, focused: false, pointerDown: false, hovered: false, lastInteraction: 0, now: 16000, quietSeconds: 15 };
  assert.equal(canRotateHome(safe), true);
  for (const key of ["paused", "overlay", "focused", "pointerDown", "hovered"] as const) assert.equal(canRotateHome({ ...safe, [key]: true }), false, key);
  assert.equal(canRotateHome({ ...safe, visible: false }), false);
  assert.equal(canRotateHome({ ...safe, lastInteraction: 2000 }), false);
});

test("missing or damaged settings have complete, independent defaults", () => {
  for (const invalid of [null, {}, { ...config(), templates: [] }, { ...config(), minIntervalSeconds: 0 }, { ...config(), maxIntervalSeconds: 10 }, { ...config(), preferredShortcuts: ["not-a-service"] }]) assert.deepEqual(resolveHomeTemplates(invalid), DEFAULT_HOME_TEMPLATES);
  const restored = resolveHomeTemplates(config()); restored.templates.pop();
  assert.equal(DEFAULT_HOME_TEMPLATES.templates.length, 10);
});
