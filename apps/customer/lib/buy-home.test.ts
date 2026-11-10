import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SHOPPING_UNIT_SETTINGS as S } from "@peebee/shared";
import { BUY_DEALS_HREF, BUY_NEARBY_HREF, buyCategoryNames, buyFeaturedSpots, buyHeroSlidesFromCatalog, matchPrice, parseListPhrase, parseListText, spotlightPullDecision, unitLabel } from "./buy-home";

test("parses leading quantity with unit", () => {
  const it = parseListPhrase("2kg tomatoes", S)!;
  assert.equal(it.name, "Tomatoes"); assert.equal(it.quantity, "2"); assert.equal(it.unit, "kg");
});
test("parses unit-first phrase", () => {
  const it = parseListPhrase("tray of eggs", S)!;
  assert.equal(it.name, "Eggs"); assert.equal(it.unit, "other"); assert.equal(it.customUnit, "tray"); assert.equal(unitLabel(it), "1 tray");
});
test("parses trailing number", () => {
  const it = parseListPhrase("basmati 5", S)!;
  assert.equal(it.name, "Basmati"); assert.equal(it.quantity, "5");
});
test("parses plain names and counts", () => {
  assert.equal(parseListPhrase("sourdough", S)!.quantity, "1");
  const a = parseListPhrase("3 avocados", S)!; assert.equal(a.name, "Avocados"); assert.equal(a.quantity, "3");
  const m = parseListPhrase("1L fresh milk", S)!; assert.equal(m.name, "Fresh milk"); assert.equal(m.unit, "l"); assert.equal(unitLabel(m), "1 L");
});
test("splits lists on commas, newlines and 'and'", () => {
  const items = parseListText("2kg tomatoes, tray of eggs and 1L milk\nsugar", S);
  assert.deepEqual(items.map((i) => i.name), ["Tomatoes", "Eggs", "Milk", "Sugar"]);
  assert.deepEqual(parseListText(" , ,", S), []);
});
test("matches prices by name", () => {
  const p = [{ title: "Farm Fresh Eggs", price: 3200 }, { title: "Fresh Milk 1L", price: 3500 }];
  assert.equal(matchPrice("Eggs", p), 3200);
  assert.equal(matchPrice("Fresh milk", p), 3500);
  assert.equal(matchPrice("Tomatoes", p), null);
});

test("spotlight pull commits only past the threshold", () => {
  assert.equal(spotlightPullDecision(0), "idle");
  assert.equal(spotlightPullDecision(-20), "idle");
  assert.equal(spotlightPullDecision(95), "pulling");
  assert.equal(spotlightPullDecision(96), "commit");
});

test("collection headers stay inside Buy", () => {
  assert.equal(BUY_DEALS_HREF, "/shopping/deals");
  assert.equal(BUY_NEARBY_HREF, "/shopping/nearby");
  for (const href of [BUY_DEALS_HREF, BUY_NEARBY_HREF]) {
    assert.equal(href.startsWith("/groceries") || href.startsWith("/stores") || href.startsWith("/pharmacy"), false);
  }
});

test("category pills come from product data, live spots lead the hero", () => {
  assert.deepEqual(buyCategoryNames([
    { category_name: "Dairy & Eggs" },
    { category_name: " Dairy & Eggs " },
    { category_name: "  " },
    { category_name: null },
    { category_name: "Fresh Produce" },
  ]), ["Dairy & Eggs", "Fresh Produce"]);
  assert.deepEqual(buyFeaturedSpots([
    { type: "video", id: "a" },
    { type: "live", id: "b" },
    { type: "image", id: "c" },
  ]).map((s) => s.id), ["b", "a", "c"]);
  assert.equal(buyFeaturedSpots([{ type: "image" }, { type: "video" }, { type: "carousel" }, { type: "live" }, { type: "image" }, { type: "video" }], 5).length, 5);
});

test("an empty spotlight still builds hero slides from loaded shops", () => {
  assert.deepEqual(buyHeroSlidesFromCatalog([], []), []);
  const slides = buyHeroSlidesFromCatalog(
    [
      { id: "quiet", name: "Quiet Boutique", banner_url: "/banner-quiet.jpg", is_live: 0 },
      { id: "live", name: "Morning Market", banner_url: "/banner-live.jpg", is_live: 1, live_channel_title: "Unpacking the harvest", live_viewer_count: 12 },
      { id: "bare", name: "Bare Shelves", is_live: false },
    ],
    [
      { id: "plain", store_id: "quiet", title: "Plain shirt", price: 20000 },
      { id: "badge", store_id: "quiet", title: "Market tee", price: 25000, badge: "New" },
      { id: "milk", store_id: "live", title: "Milk", price: 3500 },
      { id: "eggs", store_id: "live", title: "Eggs", price: 12000, compare_at_price: 15000 },
    ],
  );
  assert.deepEqual(slides.map((s) => s.store_id), ["live", "quiet", "bare"]);
  assert.equal(slides[0]?.type, "live");
  assert.equal(slides[0]?.title, "Unpacking the harvest");
  assert.equal(slides[0]?.poster_url, "/banner-live.jpg");
  assert.equal(slides[0]?.viewer_count, 12);
  assert.equal(slides[0]?.product?.id, "eggs");
  assert.equal(slides[1]?.product?.id, "badge");
  assert.equal(slides[2]?.product, undefined);
  assert.equal(slides[2]?.title, "Bare Shelves");
  assert.equal(buyHeroSlidesFromCatalog(
    Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Shop ${i}` })),
    [],
    5,
  ).length, 5);
});
