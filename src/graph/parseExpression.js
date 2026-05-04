// Pure expression parser. Returns a node definition or null.
//
// Supported forms:
//   NAME = 10                 → scalar (bare number literal)
//   NAME = point(xExpr, yExpr)→ freePoint
//   NAME = vector(xExpr, yExpr)→ vector
//   NAME = A & B              → joinLine  (& = Vee / regressive product)
//   NAME = A ^ B              → meetPoint (^ = Wedge / outer product)
//   NAME = !A                 → dual      (Poincaré dual of named object)
//   NAME = 5e02 - 1e01        → multivector (linear combination of basis blades)
//   NAME = !(2*e1 + e0)       → multivector with dual applied
//
// Coordinate expressions support +, -, *, /, parens, scalar refs, and math
// builtins (sin, cos, PI …) — anything accepted by evalExpr.

import { extractVarNames } from './evalExpr.js';

// ─── Multivector expression parser ────────────────────────────────────────────

// Blade name → PGA array index (matches ganja.js PGA(3,0,1) basis order)
const BLADE_INDEX = {
  '1': 0, 'e0': 1, 'e1': 2, 'e2': 3, 'e3': 4,
  'e01': 5, 'e02': 6, 'e03': 7, 'e12': 8, 'e13': 9, 'e23': 10,
  'e012': 11, 'e013': 12, 'e023': 13, 'e123': 14, 'e0123': 15,
};

// Longest-first so alternation doesn't short-circuit (e.g. e012 before e01)
const BLADE_PAT = 'e0123|e012|e013|e023|e123|e01|e02|e03|e12|e13|e23|e0|e1|e2|e3';

// Matches a single signed term:  [+-]? (num * blade | blade | num)
const TERM_RE = new RegExp(
  `^([+-]?)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*\\*?\\s*(${BLADE_PAT})|(${BLADE_PAT})|(\\d+(?:\\.\\d+)?))$`
);

// Parse a linear combination of basis blade terms into a 16-element array.
// Handles optional outer parens and both "5e02" and "5*e02" syntax.
// Returns the component array or null if the string is not a valid MV expression.
function parseMVExpr(str) {
  let s = str.trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (!s) return null;

  // Prepend '+' so every term starts with an explicit sign
  if (!/^[+-]/.test(s)) s = '+' + s;

  // Split into signed tokens by scanning for + / - separators
  const tokens = [];
  let start = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '+' || s[i] === '-') {
      tokens.push(s.slice(start, i).trim());
      start = i;
    }
  }
  tokens.push(s.slice(start).trim());

  if (!tokens.length) return null;
  const components = new Array(16).fill(0);

  for (const tok of tokens) {
    if (!tok) return null;
    const m = tok.match(TERM_RE);
    if (!m) return null;

    const sign = m[1] === '-' ? -1 : 1;
    let coeff, blade;
    if      (m[2] !== undefined) { coeff = parseFloat(m[2]); blade = m[3]; }   // num[*]blade
    else if (m[4] !== undefined) { coeff = 1;                blade = m[4]; }   // blade only
    else if (m[5] !== undefined) { coeff = parseFloat(m[5]); blade = null; }   // scalar
    else return null;

    const idx = blade !== null ? BLADE_INDEX[blade] : 0;
    if (idx === undefined) return null;
    components[idx] += sign * coeff;
  }

  return components;
}

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

  // !ID — dual of a named object
  const dualId = expr.match(new RegExp(`^!${WS.source}(${ID.source})$`));
  if (dualId) {
    return { id: label, label, type: 'dual', deps: [dualId[1]], params: {} };
  }

  // !(mv_expr) — dual of an inline multivector literal
  if (expr.startsWith('!(') && expr.endsWith(')')) {
    const inner = expr.slice(2, -1);
    const components = parseMVExpr(inner);
    if (components) {
      return { id: label, label, type: 'multivector', deps: [], params: { components, dual: true } };
    }
  }

  // mv_expr — literal multivector (bare or parenthesised)
  const mvComponents = parseMVExpr(expr);
  if (mvComponents) {
    return { id: label, label, type: 'multivector', deps: [], params: { components: mvComponents } };
  }

  return null;
}
