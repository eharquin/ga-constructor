// Pure expression parser. Returns a node definition or null.
//
// Supported forms:
//   NAME = 10                 → scalar (bare number literal)
//   NAME = point(xExpr, yExpr)→ freePoint
//   NAME = vector(xExpr, yExpr)→ vector
//   NAME = A & B              → joinLine  (& = Vee / regressive product)
//   NAME = A ^ B              → meetPoint (^ = Wedge / outer product)
//
// Coordinate expressions support +, -, *, /, parens, scalar refs, and math
// builtins (sin, cos, PI …) — anything accepted by evalExpr.

import { extractVarNames } from './evalExpr.js';

const ID = /[A-Za-z_][A-Za-z0-9_]*/;
const NUM = /-?\d+(?:\.\d+)?/;
const WS = /\s*/;

// Split "xExpr, yExpr" on the first top-level comma (ignores commas inside parens).
function splitTopLevelComma(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    if (str[i] === ')') depth--;
    if (str[i] === ',' && depth === 0)
      return [str.slice(0, i).trim(), str.slice(i + 1).trim()];
  }
  return null;
}

// Build a unique ordered dep list from any number of expression strings.
function uniqueDeps(...exprs) {
  const seen = new Set();
  const deps = [];
  for (const expr of exprs)
    for (const v of extractVarNames(expr))
      if (!seen.has(v)) { seen.add(v); deps.push(v); }
  return deps;
}

// Parse NAME = fn(xExpr, yExpr) forms. Returns [xExpr, yExpr] or null.
function parse2DCall(expr, fnName) {
  const prefix = fnName + '(';
  if (!expr.startsWith(prefix) || !expr.endsWith(')')) return null;
  const inner = expr.slice(prefix.length, -1).trim();
  const coords = splitTopLevelComma(inner);
  if (!coords || !coords[0] || !coords[1]) return null;
  return coords;
}

export function parseExpression(text) {
  if (!text || !text.trim()) return null;
  const t = text.trim();

  // Require: NAME = <rhs>
  const assign = t.match(new RegExp(`^(${ID.source})${WS.source}=${WS.source}(.+)$`));
  if (!assign) return null;

  const [, label, rhs] = assign;
  const expr = rhs.trim();

  // scalar: bare number literal
  const scalar = expr.match(new RegExp(`^(${NUM.source})$`));
  if (scalar) {
    return { id: label, label, type: 'scalar', deps: [], params: { value: +scalar[1] } };
  }

  // point(xExpr, yExpr) — free point
  const ptCoords = parse2DCall(expr, 'point');
  if (ptCoords) {
    const [xExpr, yExpr] = ptCoords;
    const deps = uniqueDeps(xExpr, yExpr);
    return { id: label, label, type: 'freePoint', deps, params: { xExpr, yExpr, deps } };
  }

  // vector(xExpr, yExpr) — free vector
  const vecCoords = parse2DCall(expr, 'vector');
  if (vecCoords) {
    const [xExpr, yExpr] = vecCoords;
    const deps = uniqueDeps(xExpr, yExpr);
    return { id: label, label, type: 'vector', deps, params: { xExpr, yExpr, deps } };
  }

  // exp(G, s) — motor exponential: translator (from vector) or rotor (from line)
  if (expr.startsWith('exp(') && expr.endsWith(')')) {
    const inner = expr.slice(4, -1).trim();
    const parts = splitTopLevelComma(inner);
    if (parts) {
      const geomId = parts[0].trim();
      const scalarExpr = parts[1].trim();
      if (new RegExp(`^${ID.source}$`).test(geomId) && scalarExpr) {
        const scalarDeps = extractVarNames(scalarExpr);
        return {
          id: label, label, type: 'motorExp',
          deps: [geomId, ...scalarDeps],
          params: { geomId, scalarExpr, scalarDeps },
        };
      }
    }
  }

  // A >>> B — sandwich product (motor application)
  const sw = expr.match(new RegExp(`^(${ID.source})${WS.source}>>>\\s*(${ID.source})$`));
  if (sw) {
    return { id: label, label, type: 'motorApply', deps: [sw[1], sw[2]], params: {} };
  }

  // A & B — join (line through two points)
  const join = expr.match(new RegExp(`^(${ID.source})${WS.source}&${WS.source}(${ID.source})$`));
  if (join) {
    return { id: label, label, type: 'joinLine', deps: [join[1], join[2]], params: {} };
  }

  // A ^ B — meet (intersection of two lines → point)
  const meet = expr.match(new RegExp(`^(${ID.source})${WS.source}\\^${WS.source}(${ID.source})$`));
  if (meet) {
    return { id: label, label, type: 'meetPoint', deps: [meet[1], meet[2]], params: {} };
  }

  return null;
}
