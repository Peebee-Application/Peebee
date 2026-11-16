import assert from "node:assert/strict";
import test from "node:test";
import { maskPhone } from "./mask.js";

test("masks a Ugandan mobile the way the wallet mockups do", () => {
  assert.equal(maskPhone("0772000412"), "07•• ••• 412");
  assert.equal(maskPhone("+256772000412"), "07•• ••• 412");
  assert.equal(maskPhone("256772000088"), "07•• ••• 088");
});

test("a short or empty number stays fully hidden", () => {
  assert.equal(maskPhone(""), "••• •••");
  assert.equal(maskPhone(null), "••• •••");
  assert.equal(maskPhone("123"), "••• •••");
});
