import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SCREENSAVER_MODULES, circularOffset, entityImagePose, entitySubtitle, navigateLevel, selectScreensaver, sheetReleaseOffset, thumbLabelOf, wrapIndex } from "./home-screensaver";

const on = (...off: string[]) => (key: string) => !off.includes(key);
const shortcuts = (off: string[] = []) =>
  ["clean", "laundry", "fix", "workers", "hire"].map((id) => ({ id, enabled: !off.includes(id) }));

test("every enabled module keeps the screensaver order and its sub-entities", () => {
  const slides = selectScreensaver(SCREENSAVER_MODULES, on(), shortcuts());
  assert.deepEqual(slides.map((slide) => slide.id), ["ride", "eat", "buy", "work", "learn"]);
  assert.equal(entitySubtitle(slides[0]!.entities), "Boda · Car · Parcel · Move");
  assert.equal(entitySubtitle(slides[1]!.entities), "Restaurants · Street food · Bakeries");
});

test("a module switched off in admin is left out, and so are its sub-entities", () => {
  const slides = selectScreensaver(SCREENSAVER_MODULES, on("buy.food", "ride.car"), shortcuts());
  assert.deepEqual(slides.map((slide) => slide.id), ["ride", "buy", "work", "learn"]);
  assert.equal(entitySubtitle(slides[0]!.entities), "Boda · Parcel · Move");
});

test("a slide disappears when every sub-entity is off", () => {
  const slides = selectScreensaver(
    SCREENSAVER_MODULES,
    on("ride.boda", "ride.car", "ride.move", "deliver.parcel"),
    shortcuts(),
  );
  assert.equal(slides.some((slide) => slide.id === "ride"), false);
});

test("a hive shortcut switched off drops that service only", () => {
  const slides = selectScreensaver(SCREENSAVER_MODULES, on(), shortcuts(["laundry", "hire"]));
  const work = slides.find((slide) => slide.id === "work");
  assert.deepEqual(work?.entities.map((entity) => entity.id), ["clean", "fix", "workers"]);
});

test("one remaining sub-entity still keeps its slide", () => {
  const slides = selectScreensaver(SCREENSAVER_MODULES, on("learn.live", "learn.tv"), shortcuts());
  const learn = slides.find((slide) => slide.id === "learn");
  assert.deepEqual(learn?.entities.map((entity) => entity.id), ["discover"]);
});

test("thumbnail pills use a short word and fall back to the full title", () => {
  assert.equal(thumbLabelOf({ title: "Boda" }), "Boda");
  assert.equal(thumbLabelOf({ title: "Street food", thumbLabel: "  " }), "Street food");
  const labels = SCREENSAVER_MODULES.flatMap((mod) => mod.entities.map((entity) => ({ title: entity.title, label: thumbLabelOf(entity) })));
  assert.equal(labels.find((item) => item.title === "Street food")?.label, "Street");
  assert.equal(labels.find((item) => item.title === "Restaurants")?.label, "Dine");
  assert.equal(labels.find((item) => item.title === "Bakeries")?.label, "Baked");
  assert.equal(labels.find((item) => item.title === "Workers")?.label, "Work");
  assert.equal(labels.find((item) => item.title === "Discover")?.label, "Courses");
  for (const item of labels) {
    assert.equal(item.label.includes(" "), false, item.label);
    assert.ok(item.label.length <= 7, item.label);
  }
});

test("level 1 moves sideways between modules and level 2 stays inside its module", () => {
  assert.deepEqual(navigateLevel("cover", 0, 2, 5, 4, "x", 1), { level: "cover", moduleIndex: 1, entityIndex: 0 });
  assert.deepEqual(navigateLevel("cover", 0, 0, 5, 4, "x", -1), { level: "cover", moduleIndex: 4, entityIndex: 0 });
  assert.equal(navigateLevel("cover", 0, 0, 5, 4, "y", 1), "open");
  assert.equal(navigateLevel("cover", 0, 0, 5, 4, "y", -1), "ignore");
  assert.equal(navigateLevel("module", 1, 3, 5, 4, "x", 1), "ignore");
  assert.deepEqual(navigateLevel("module", 1, 3, 5, 4, "y", 1), { level: "module", moduleIndex: 1, entityIndex: 0 });
  assert.deepEqual(navigateLevel("module", 1, 0, 5, 4, "y", -1), { level: "module", moduleIndex: 1, entityIndex: 3 });
  assert.equal(navigateLevel("module", 2, 0, 5, 1, "y", 1), "ignore");
});

test("sub-module photos recede and the next one rises from behind the sheet", () => {
  const resting = entityImagePose("out", 0);
  assert.equal(resting.scale, 1);
  assert.equal(resting.yPercent, 0);
  assert.equal(resting.opacity, 1);
  const away = entityImagePose("out", 1);
  assert.ok(away.scale < 0.85);
  assert.equal(away.yPercent, 0);
  assert.equal(away.opacity, 0);
  const behind = entityImagePose("in", 0);
  assert.ok(behind.yPercent > 80);
  assert.ok(behind.scale < 1);
  assert.equal(behind.opacity, 1);
  const arrived = entityImagePose("in", 1);
  assert.equal(arrived.yPercent, 0);
  assert.equal(arrived.scale, 1);
  const reduced = entityImagePose("out", 1, true);
  assert.equal(reduced.scale, 1);
  assert.equal(reduced.yPercent, 0);
});

test("the white sheet pulls up and releases back to rest", () => {
  assert.equal(sheetReleaseOffset(0), 0);
  assert.equal(sheetReleaseOffset(0.22), -32);
  assert.equal(sheetReleaseOffset(1), 0);
  assert.ok(sheetReleaseOffset(0.61) < 0 && sheetReleaseOffset(0.61) > -32);
  assert.equal(sheetReleaseOffset(0.5, true), 0);
  const css = readFileSync(new URL("../components/home/home-screensaver.css", import.meta.url), "utf8");
  assert.match(css, /@keyframes hs-pull[\s\S]*22% \{ transform: translateY\(-32px\)/);
  assert.match(css, /100% \{ transform: translateY\(0\)/);
  assert.match(css, /\.hs-dot\.is-on[\s\S]*var\(--color-gold\)/);
  assert.match(css, /\.hs-top:has\(\.hs-wordmark\) \{ flex-direction: row-reverse; \}/);
});

test("circular offsets wrap without duplicating the far side of an even list", () => {
  assert.equal(circularOffset(0, 0, 1), 0);
  assert.equal(circularOffset(1, 0, 4), 1);
  assert.equal(circularOffset(2, 0, 4), 2);
  assert.equal(circularOffset(3, 0, 4), -1);
  assert.equal(circularOffset(2, 0, 3), -1);
  assert.equal(circularOffset(0, 1, 5), -1);
  assert.equal(wrapIndex(-1, 4), 3);
  assert.equal(wrapIndex(4, 4), 0);
});
