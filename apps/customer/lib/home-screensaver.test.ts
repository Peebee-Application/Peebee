import assert from "node:assert/strict";
import test from "node:test";
import { SCREENSAVER_MODULES, circularOffset, entitySubtitle, selectScreensaver, wrapIndex } from "./home-screensaver";

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
