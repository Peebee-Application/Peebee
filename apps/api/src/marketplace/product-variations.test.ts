import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRODUCT_VARIATIONS,
  buildVariantMatrix,
  cardOptions,
  defaultSelection,
  deriveProductOptions,
  findVariant,
  isValueAvailable,
  normaliseOptionKey,
  resolveProductVariations,
  selectValue,
  validateVariations,
  type VariantLike,
} from "@peebee/shared";

const settings = resolveProductVariations(null);
const shirt: VariantLike[] = [
  { id: "a", option1_name: "Colour", option1_value: "Black", option2_name: "Size", option2_value: "M", price: 100, inventory_quantity: 3 },
  { id: "b", option1_name: "Colour", option1_value: "Black", option2_name: "Size", option2_value: "L", price: 100, inventory_quantity: 0 },
  { id: "c", option1_name: "Colour", option1_value: "Red", option2_name: "Size", option2_value: "L", price: 110, inventory_quantity: 5 },
];

test("option names that mean the same thing share a key", () => {
  assert.equal(normaliseOptionKey(" Colour "), "color");
  assert.equal(normaliseOptionKey("COLORS"), "color");
  assert.equal(normaliseOptionKey("Pack size"), "pack");
});

test("settings fill gaps and drop malformed types", () => {
  const next = resolveProductVariations({ maxCardOptions: 9, types: [{ key: "", name: "", display: "chips", showOnBuyCard: true, suggestedValues: [] }, { key: "Colour", name: "Colour", display: "swatch", showOnBuyCard: true, suggestedValues: ["Red", "red", " "] }] } as never);
  assert.equal(next.maxCardOptions, 2);
  assert.equal(next.types.length, 1);
  assert.equal(next.types[0].key, "color");
  assert.deepEqual(next.types[0].suggestedValues, ["Red"]);
  assert.equal(resolveProductVariations(null).quickAddEnabled, true);
});

test("options are derived from variants, with swatch colours for named colours", () => {
  const options = deriveProductOptions(shirt, settings);
  assert.deepEqual(options.map((o) => o.key), ["color", "size"]);
  assert.equal(options[0].display, "swatch");
  assert.equal(options[0].values[0].hex, "#111111");
  assert.deepEqual(options[1].values.map((v) => v.value), ["M", "L"]);
});

test("a card expands only the options admin switched on, up to the cap", () => {
  const options = deriveProductOptions(shirt, settings);
  assert.deepEqual(cardOptions(options, settings).map((o) => o.key), ["color", "size"]);
  assert.deepEqual(cardOptions(options, { ...settings, maxCardOptions: 1 }).map((o) => o.key), ["color"]);
  assert.deepEqual(cardOptions(options, { ...settings, quickAddEnabled: false }), []);
  const sizeOff = { ...settings, types: settings.types.map((t) => (t.key === "size" ? { ...t, showOnBuyCard: false } : t)) };
  assert.deepEqual(cardOptions(deriveProductOptions(shirt, sizeOff), sizeOff).map((o) => o.key), ["color"]);
  const custom = deriveProductOptions([{ option1_name: "Engraving", option1_value: "Yes", price: 1 }], settings);
  assert.deepEqual(cardOptions(custom, settings), []);
});

test("selection finds the variant, marks sold-out values and avoids dead combinations", () => {
  const options = deriveProductOptions(shirt, settings);
  assert.equal(findVariant(shirt, options, { color: "Black", size: "M" })?.id, "a");
  assert.equal(findVariant(shirt, options, { color: "Red", size: "M" }), null);
  assert.equal(findVariant(shirt, options, { color: "Red" }), null);
  assert.equal(isValueAvailable(shirt, "size", "L", { color: "Black" }), false);
  assert.equal(isValueAvailable(shirt, "size", "L", { color: "Red" }), true);
  assert.deepEqual(defaultSelection(shirt, options), { color: "Black", size: "M" });
  assert.deepEqual(selectValue(shirt, options, { color: "Black", size: "M" }, "color", "Red"), { color: "Red", size: "L" });
});

test("matrix keeps existing rows and caps the count", () => {
  const options = [{ name: "Colour", values: [{ value: "Black" }, { value: "Red" }] }, { name: "Size", values: [{ value: "M" }, { value: "L" }] }];
  const first = buildVariantMatrix(options, [], { price: 50, inventory_quantity: 10 }, 100);
  assert.equal(first.variants.length, 4);
  assert.equal(first.variants[0].title, "Black / M");
  const edited = first.variants.map((v) => (v.title === "Red / L" ? { ...v, price: 75, sku: "RL" } : v));
  const grown = buildVariantMatrix([...options, { name: "Material", values: [{ value: "Cotton" }] }].slice(0, 2).map((o, i) => (i === 1 ? { ...o, values: [...o.values, { value: "XL" }] } : o)), edited, { price: 50, inventory_quantity: 10 }, 100);
  assert.equal(grown.variants.length, 6);
  assert.equal(grown.variants.find((v) => v.title === "Red / L")?.price, 75);
  assert.equal(grown.variants.find((v) => v.title === "Red / XL")?.price, 50);
  const capped = buildVariantMatrix(options, [], { price: 1, inventory_quantity: 1 }, 3);
  assert.equal(capped.variants.length, 3);
  assert.equal(capped.truncated, true);
});

test("validation enforces admin limits and the agreed list", () => {
  const color = { name: "Colour", values: [{ value: "Black" }] };
  assert.equal(validateVariations([color], [{ values: ["Black"] }], settings), null);
  assert.equal(validateVariations([color, { name: "Size", values: [{ value: "M" }] }, { name: "Material", values: [{ value: "X" }] }, { name: "Flavour", values: [{ value: "Y" }] }], [], settings)?.issue, "too_many_options");
  assert.equal(validateVariations([color, { name: "colors", values: [{ value: "Red" }] }], [], settings)?.issue, "duplicate_option");
  assert.equal(validateVariations([{ name: "Colour", values: [{ value: "Black" }, { value: "black" }] }], [], settings)?.issue, "duplicate_value");
  assert.equal(validateVariations([{ name: "Engraving", values: [{ value: "Yes" }] }], [], { ...settings, allowCustomOptions: false })?.issue, "option_not_allowed");
  assert.equal(validateVariations([color], [{ values: ["Black"] }, { values: ["black"] }], settings)?.issue, "duplicate_variant");
  assert.equal(validateVariations([color], [{ values: ["Black", "M"] }], settings)?.issue, "variant_values_mismatch");
  assert.equal(validateVariations([color], [{ values: ["A"] }, { values: ["B"] }], { ...settings, maxVariantsPerProduct: 1 })?.issue, "too_many_variants");
  assert.ok(DEFAULT_PRODUCT_VARIATIONS.types.length >= 2);
});
