import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../components/wallet/wallet.css", import.meta.url), "utf8");

/** Tailwind utilities this stylesheet must never redefine, scoped or not. */
const TAILWIND_UTILITIES = new Set([
  "w-full", "h-full", "flex", "hidden", "block", "inline", "grid",
  "fixed", "absolute", "relative", "sticky", "static",
]);

function styleSelectors(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  const selectors: string[] = [];
  for (const match of stripped.matchAll(/([^{}@]+)\{/g)) {
    const selector = match[1].trim();
    if (selector) selectors.push(selector);
  }
  return selectors;
}

test("wallet CSS does not redefine Tailwind's w-full", () => {
  assert.doesNotMatch(css, /(^|[^-\w])\.w-full(?![-\w])/);
});

test("every wallet rule is scoped under .wallet-root", () => {
  const selectors = styleSelectors(css);
  assert.ok(selectors.length > 10, "expected the wallet rules to be present");
  for (const selector of selectors) {
    for (const part of selector.split(",")) {
      const piece = part.trim();
      if (!piece.includes(".")) continue;
      assert.match(piece, /^\.wallet-root\b/, `unscoped selector: ${piece}`);
    }
  }
});

test("wallet selectors do not reuse Tailwind utility names", () => {
  for (const selector of styleSelectors(css)) {
    for (const name of selector.matchAll(/\.(-?[\w-]+)/g)) {
      assert.equal(TAILWIND_UTILITIES.has(name[1]), false, `.${name[1]} collides with a Tailwind utility`);
    }
  }
  assert.match(css, /\.wallet-root \.wallet-result\s*\{/);
});
