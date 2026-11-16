export type Op = "+" | "-" | "×" | "÷";
export type Expr = { left: string; op: Op | null; right: string };

export const emptyExpr = (): Expr => ({ left: "", op: null, right: "" });

/** Whole UGX. One operator at a time. Division by zero and a non-positive result do not commit. */
export function evalWhole(expr: Expr): number | null {
  if (!expr.left) return null;
  const left = Number(expr.left);
  if (!Number.isFinite(left)) return null;
  if (!expr.op || expr.right === "") return left > 0 ? Math.round(left) : null;
  const right = Number(expr.right);
  if (!Number.isFinite(right)) return null;
  const value =
    expr.op === "+" ? left + right :
    expr.op === "-" ? left - right :
    expr.op === "×" ? left * right :
    right === 0 ? Number.NaN : left / right;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export function pressDigit(expr: Expr, digit: string): Expr {
  const side = expr.op ? "right" : "left";
  const current = expr[side];
  if (current.length >= 9) return expr;
  if (digit === "00" && current === "") return expr;
  if (!expr.op && digit === "0" && current === "") return expr;
  return { ...expr, [side]: `${current}${digit}` };
}

export function backspace(expr: Expr): Expr {
  if (expr.op && expr.right) return { ...expr, right: expr.right.slice(0, -1) };
  if (expr.op) return { ...expr, op: null };
  return { ...expr, left: expr.left.slice(0, -1) };
}

export function pressOp(expr: Expr, op: Op): Expr {
  if (!expr.left) return expr;
  if (expr.op && expr.right) {
    const next = evalWhole(expr);
    if (next == null) return expr;
    return { left: String(next), op, right: "" };
  }
  return { ...expr, op };
}

export function commitExpr(expr: Expr): Expr {
  const next = evalWhole(expr);
  if (next == null) return expr;
  return { left: String(next), op: null, right: "" };
}

export function exprAmount(expr: Expr): number | null {
  if (expr.op && expr.right === "") return null;
  return evalWhole(expr);
}
