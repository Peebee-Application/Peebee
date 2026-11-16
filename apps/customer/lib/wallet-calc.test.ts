import assert from "node:assert/strict";
import test from "node:test";
import { backspace, commitExpr, emptyExpr, evalWhole, pressDigit, pressOp } from "./wallet-calc.js";

test("one operator, whole shillings, chip commits into the amount", () => {
  let expr = emptyExpr();
  for (const d of ["1", "2", "5", "0", "0"]) expr = pressDigit(expr, d);
  expr = pressOp(expr, "×");
  expr = pressDigit(expr, "2");
  assert.equal(evalWhole(expr), 25_000);
  expr = commitExpr(expr);
  assert.deepEqual(expr, { left: "25000", op: null, right: "" });
});

test("a second operator commits the first one first", () => {
  let expr = pressOp(pressDigit(pressDigit(emptyExpr(), "1"), "0"), "+");
  expr = pressDigit(expr, "5");
  expr = pressOp(expr, "×");
  assert.equal(expr.left, "15");
  assert.equal(expr.op, "×");
});

test("backspace removes the operator before the left side", () => {
  let expr = pressOp(pressDigit(emptyExpr(), "8"), "÷");
  expr = backspace(expr);
  assert.equal(expr.op, null);
  assert.equal(expr.left, "8");
});

test("division by zero does not produce an amount", () => {
  const expr = pressDigit(pressOp(pressDigit(emptyExpr(), "4"), "÷"), "0");
  assert.equal(evalWhole(expr), null);
});
