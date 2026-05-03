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

// Extract non-math identifier names from an expression string.
export function extractVarNames(expr) {
  const names = new Set();
  for (const [, name] of expr.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    if (!MATH_NAMES.has(name)) names.add(name);
  }
  return [...names];
}

// Evaluate expr with the given scalar variable bindings.
// Returns NaN on any error (unknown var, syntax error, division by zero, etc.).
export function evalExpr(expr, scalars = {}) {
  // Character-level safety: only allow chars needed for arithmetic
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
