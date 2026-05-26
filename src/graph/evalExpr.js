// Safe arithmetic expression evaluator.
// Accepts: numbers, the listed math functions/constants, and any named scalars.
// Rejects anything that isn't [A-Za-z0-9 +\-*/(). ,] — blocks strings, property
// access, semicolons, etc. so user input cannot reach browser globals.

const MATH = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow,
  exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, sign: Math.sign, hypot: Math.hypot,
  PI: Math.PI, E: Math.E,
};

export const MATH_NAMES = new Set(Object.keys(MATH));

// Extract non-math, non-blade identifier names from an expression string.
// parseBladeName is algebra-specific — pass it in so blade tokens from any
// algebra get filtered out of the dep list.
export function extractVarNames(expr, parseBladeName) {
  const names = new Set();
  for (const [, name] of expr.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    if (MATH_NAMES.has(name)) continue;
    if (parseBladeName && parseBladeName(name)) continue;
    names.add(name);
  }
  return [...names];
}

// Evaluate expr with the given scalar variable bindings.
// Returns NaN on any error (unknown var, syntax error, division by zero, etc.).
export function evalExpr(expr, scalars = {}) {
  if (!/^[\w\s+\-*/(). ,[\]]*$/.test(expr)) return NaN;
  const ctx = { ...MATH, ...scalars };
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(ctx), `"use strict"; return (${expr});`);
    const result = fn(...Object.values(ctx));
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

// Unwrap scalar bindings to plain numbers for the numeric `Function` evaluator.
// Scalar node values are grade-0 MVs (everything algebraic is an MV); the numeric
// evaluator needs their `mv[0]`. Non-scalar MVs keep their object form so they
// surface as NaN (invalid in a coordinate expression), and {vx,vy} stays an object.
function unwrapScalarBindings(scalars) {
  const out = {};
  for (const k in scalars) {
    const v = scalars[k];
    out[k] = (v != null && typeof v === 'object' && typeof v.length === 'number') ? v[0] : v;
  }
  return out;
}

// Scalar-valued evaluator that also accepts `.blade` accessors (e.g. P.e01).
// Routes through evalMVArith when the expression contains a property-access
// pattern (which evalExpr can't resolve since deps may be MVs); otherwise
// falls back to evalExpr to preserve math constants like PI/E.
// evalMVArith is algebra-bound — pass it in.
export function evalScalar(expr, scalars = {}, evalMVArith = null) {
  if (evalMVArith && /\.[A-Za-z_]/.test(expr)) {
    const result = evalMVArith(expr, scalars);
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  }
  return evalExpr(expr, unwrapScalarBindings(scalars));
}
