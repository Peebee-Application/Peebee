import assert from "node:assert/strict";
import test from "node:test";
import { applyModuleAvailability, isModuleOn, resolveModuleAvailability, type ModuleFlags } from "@peebee/shared";
import { MODULES } from "@peebee/shared";

const allOn = (): ModuleFlags => Object.fromEntries(MODULES.map((m) => [m.key, { live: true, practice: true }]));

test("a module is available only while every module above it is", () => {
  const flags = allOn();
  flags["ride.car"] = { live: false, practice: true };
  const available = resolveModuleAvailability(flags);
  assert.deepEqual(available["ride.car.carpool"], { live: false, practice: true });
  assert.deepEqual(available["ride.boda"], { live: true, practice: true });
  flags.ride = { live: true, practice: false };
  const next = resolveModuleAvailability(flags);
  assert.equal(next["ride.car.carpool"]!.practice, false);
  assert.equal(next["ride.taxipress"]!.live, true);
});

test("an unknown module or an unloaded cache reads as on", () => {
  assert.equal(isModuleOn("nope", "live", {}), true);
  assert.equal(isModuleOn("ride.car", "practice", null), true);
});

test("Practice decides in Practice: a module off in Live can be on there", () => {
  const settings = { car: { enabled: false, carpool: { enabled: false } }, services: { ride: true, cargo: true } };
  const flags = allOn();
  const available = resolveModuleAvailability(flags);
  const practice = applyModuleAvailability(settings, available, "practice");
  assert.equal(practice.car.enabled, true);
  assert.equal(practice.car.carpool.enabled, true);
  const live = applyModuleAvailability(settings, available, "live");
  assert.equal(live.car.enabled, false, "Live keeps its own stored value");
});

test("Live only ever narrows, and Practice off turns the setting off", () => {
  const flags = allOn();
  flags.ride = { live: false, practice: false };
  const available = resolveModuleAvailability(flags);
  const settings = { services: { ride: true, cargo: true }, car: { enabled: true, carpool: { enabled: true } } };
  assert.equal(applyModuleAvailability(settings, available, "live").services.ride, false);
  assert.equal(applyModuleAvailability(settings, available, "live").car.enabled, false);
  assert.equal(applyModuleAvailability(settings, available, "practice").services.cargo, false);
});

test("a Channels module reads its switch from the Channels config", async () => {
  const { channelModuleOn, getModule, channelModulePatch } = await import("@peebee/shared");
  const video = getModule("channels.posts.video")!;
  const audio = getModule("channels.posts.audio")!;
  const config = JSON.stringify({ enabled: true, publishing: { postTypes: ["video", "image"] } });
  assert.equal(channelModuleOn(video, config), true);
  assert.equal(channelModuleOn(audio, config), false);
  assert.equal(channelModuleOn(getModule("channels")!, config), true);
  assert.equal(channelModuleOn(getModule("channels.live")!, config), false, "going live ships off");
  assert.equal(channelModuleOn(video, "not json"), true, "an unreadable config reads as the defaults");
  assert.deepEqual(channelModulePatch(video, JSON.parse(config), false), { "publishing.postTypes": ["image"] });
  assert.deepEqual(channelModulePatch(audio, JSON.parse(config), true), { "publishing.postTypes": ["video", "image", "audio"] });
  assert.deepEqual(channelModulePatch(getModule("channels.live")!, {}, true), { "live.enabled": true });
});

test("every module's parent exists and sits in the same cluster", () => {
  const keys = new Set(MODULES.map((x) => x.key));
  for (const def of MODULES) {
    if (!def.parent) continue;
    assert.ok(keys.has(def.parent), `${def.key} has an unknown parent ${def.parent}`);
    assert.equal(MODULES.find((x) => x.key === def.parent)!.cluster, def.cluster, `${def.key} sits in another cluster than its parent`);
  }
});

test("a notice is the module's own, else the nearest one above it, else a plain 'not available'", async () => {
  const { noticeFor, cleanModuleNotice, moduleForPath, describeModuleNotice } = await import("@peebee/shared");
  const notices = { ride: { reason: "maintenance" as const, message: "Upgrading" }, "ride.car": { reason: "coming_soon" as const, returnAt: "2026-12-01" } };
  assert.equal(noticeFor("ride.car", notices).reason, "coming_soon");
  assert.equal(noticeFor("ride.car.carpool", notices).reason, "coming_soon", "Carpool inherits Peebee Car's");
  assert.equal(noticeFor("ride.boda", notices).reason, "maintenance", "Boda inherits Rides'");
  assert.equal(noticeFor("buy.food", notices).reason, "unavailable");
  assert.equal(noticeFor("nope", undefined).reason, "unavailable");

  assert.equal(cleanModuleNotice({ reason: "launch" }), null);
  assert.deepEqual(cleanModuleNotice({ reason: "maintenance", message: "  Back soon  ", returnAt: "not a date" }), { reason: "maintenance", message: "Back soon" });
  assert.equal(cleanModuleNotice({ reason: "maintenance", message: "x".repeat(500) })!.message!.length, 200);

  const rules = [{ prefix: "/ride", module: "ride", title: "Rides" }, { prefix: "/ride/car", module: "ride.car", title: "Car" }, { prefix: "/", module: "buy.food", title: "Orders", exact: true }];
  assert.equal(moduleForPath("/ride/car/book", rules)?.module, "ride.car", "the longest rule wins");
  assert.equal(moduleForPath("/ride/boda", rules)?.module, "ride");
  assert.equal(moduleForPath("/ridexyz", rules), null, "a prefix is a whole path segment");
  assert.equal(moduleForPath("/", rules)?.module, "buy.food");
  assert.equal(moduleForPath("/account", rules), null, "the exact home rule does not swallow other pages");

  const d = describeModuleNotice({ reason: "coming_soon", returnAt: "2026-12-01", message: "Hello" });
  assert.equal(d.headline, "Coming soon");
  assert.equal(d.dateLine, "Launching Tue, 1 December 2026");
  assert.equal(d.message, "Hello");
  assert.equal(describeModuleNotice({ reason: "unavailable" }).dateLine, null);
});

test("a switched-off module leaves no trace: links, their cards and tagged content are hidden, an app's home never is", async () => {
  const { hiddenLinksCss, OFFLINE_HEADLINE } = await import("@peebee/shared");
  const rules = [
    { prefix: "/ride/move", module: "ride.move", title: "Move" },
    { prefix: "/carpool", module: "ride.car.carpool", title: "Rideshare" },
    { prefix: "/", module: "buy.food", title: "Orders", exact: true },
    { prefix: "/menu", module: "buy.food", title: "Menu" },
  ];
  const css = hiddenLinksCss(rules, (m: string) => m !== "ride.move" && m !== "buy.food");
  assert.ok(css.includes('a[href="/ride/move"]') && css.includes('a[href^="/ride/move/"]') && css.includes('li:has(>a[href="/ride/move"])'));
  assert.ok(css.includes('a[href^="/menu/"]'));
  assert.ok(css.includes('[data-module="buy.food"]{display:none!important}'), "tagged content of an off module is hidden");
  assert.ok(!css.includes("/carpool"), "a module that is on is not hidden");
  assert.ok(!css.includes('a[href="/"]'), "the exact home rule never hides the home link");
  assert.equal(hiddenLinksCss(rules, () => true), "");
  assert.ok(hiddenLinksCss(rules, (m: string) => m !== "ride.car", ["ride.car"]).includes('[data-module="ride.car"]'), "tags for modules no rule names still hide");
  assert.equal(OFFLINE_HEADLINE, "Currently Offline");

  // Grey it out: nothing is removed, everything is inert.
  const grey = hiddenLinksCss(rules, (m: string) => m !== "ride.move", [], "inactive");
  assert.ok(grey.includes('a[href="/ride/move"]') && grey.includes("pointer-events:none") && !grey.includes("display:none"));
});

