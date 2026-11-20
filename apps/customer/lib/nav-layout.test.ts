import test from "node:test";
import assert from "node:assert/strict";
import { selectedMenuScroll } from "./nav-layout";

test("phone selection aligns left without leaving blank trailing space", () => {
  assert.equal(selectedMenuScroll(140, 70, 280, 490, false), 140);
  assert.equal(selectedMenuScroll(420, 70, 280, 490, false), 210);
});
test("larger screens center the selection and clamp both ends", () => {
  assert.equal(selectedMenuScroll(210, 70, 350, 630, true), 70);
  assert.equal(selectedMenuScroll(0, 70, 350, 630, true), 0);
  assert.equal(selectedMenuScroll(560, 70, 350, 630, true), 280);
  assert.equal(selectedMenuScroll(210, 70, 700, 490, true), 0);
});
