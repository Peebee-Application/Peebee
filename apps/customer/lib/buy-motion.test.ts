import assert from "node:assert/strict";
import test from "node:test";
import {
  SWIPE_OPEN,
  clampSwipe,
  heroTargetIndex,
  isBuyPushHref,
  pathOf,
  scrollLink,
  sheetShouldClose,
  swipeSnap,
} from "./buy-motion";

test("scroll link runs 0 to 1 across the first range", () => {
  assert.equal(scrollLink(0, 56), 0);
  assert.equal(scrollLink(28, 56), 0.5);
  assert.equal(scrollLink(80, 56), 1);
  assert.equal(scrollLink(-4, 56), 0);
});

test("hero flick moves one card and a slow drag rounds", () => {
  assert.equal(heroTargetIndex(0, 300, 4, 0), 0);
  assert.equal(heroTargetIndex(160, 300, 4, 0), 1);
  assert.equal(heroTargetIndex(20, 300, 4, -0.5), 1);
  assert.equal(heroTargetIndex(280, 300, 4, 0.5), 0);
  assert.equal(heroTargetIndex(900, 300, 2, -1), 1);
});

test("swipe reveals the trash only past the commit point", () => {
  assert.equal(clampSwipe(12), 0);
  assert.equal(clampSwipe(-40), -40);
  assert.equal(clampSwipe(-200), -96);
  assert.equal(swipeSnap(-63), 0);
  assert.equal(swipeSnap(-64), SWIPE_OPEN);
  assert.equal(swipeSnap(-96), SWIPE_OPEN);
});

test("sheet closes past 120px or when the flick is fast", () => {
  assert.equal(sheetShouldClose(119, 0), false);
  assert.equal(sheetShouldClose(120, 0), true);
  assert.equal(sheetShouldClose(10, 0.5), true);
  assert.equal(sheetShouldClose(10, 0.49), false);
});

test("push navigation stays inside Buy screens", () => {
  assert.equal(isBuyPushHref("/shopping/deals"), true);
  assert.equal(isBuyPushHref("/product/milk"), true);
  assert.equal(isBuyPushHref("/store/fresh"), true);
  assert.equal(isBuyPushHref("/groceries"), false);
  assert.equal(isBuyPushHref("/spotlight"), false);
  assert.equal(pathOf("/shopping/deals?x=1"), "/shopping/deals");
});
