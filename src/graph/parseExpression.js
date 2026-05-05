// Pure expression parser. Returns a node definition or null.
//
// Supported forms:
//   NAME = 10                    → scalar (bare number literal)
//   NAME = point(xExpr, yExpr)   → freePoint
//   NAME = vector(xExpr, yExpr)  → vector
//   NAME = A & B                 → joinLine  (& = Vee / regressive product)
//   NAME = A ^ B                 → meetPoint (^ = Wedge / outer product)
//   NAME = !A                    → dual      (Poincaré dual of named object)
//   NAME = 5e02 - 1e01           → multivector (literal basis-blade linear combo)
//   NAME = x*e01 + y*e02 + w*e12 → multivector with variable coefficients (deps)
//   NAME = !(2*e1 + e0)          → multivector with dual applied (literal only)
//
// Coordinate expressions support +, -, *, /, parens, scalar refs, and math
// builtins (sin, cos, PI …) — anything accepted by evalExpr.

import { extractVarNames } from './evalExpr.js';
import { extractMVDeps } from './evalMVArith.js';

// ─── Multivector expression parser ────────────────────────────────────────────

// Blade name → PGA array index (matches ganja.js PGA(2,0,1) basis order)
const BLADE_INDEX = {
  '1': 0, 'e0': 1, 'e1': 2, 'e2': 3,
  'e01': 4, 'e02': 5, 'e12': 6,
  'e012': 7,
};

// Longest-first so alternation doesn't short-circuit (e.g. e012 before e01)
const BLADE_PAT = 'e012|e01|e02|e12|e0|e1|e2';
const ID_PAT    = '[A-Za-z_][A-Za-z0-9_]*';

// Matches a single signed term: num*blade, var*blade (explicit *), standalone blade, or num.
const TERM_RE = new RegExp(
  `^([+-]?)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*\\*?\\s*(${BLADE_PAT})|(${ID_PAT})\\s*\\*\\s*(${BLADE_PAT})|(${BLADE_PAT})|(\\d+(?:\\.\\d+)?))$`
);

// Parse a linear combination of basis blade terms.
// Returns { components, deps, coeffExprs } or null.
//   components:  8-element base array (0 for variable-coefficient blades)
//   deps:        ordered unique list of referenced variable names
//   coeffExprs:  { [basisIndex]: exprString }  e.g. { 4: 'x', 5: '-y' }
function parseMVExpr(str) {
  let s = str.trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (!s) return null;

  if (!/^[+-]/.test(s)) s = '+' + s;

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
  const components = new Array(8).fill(0);
  const coeffExprs = {};
  const depsOrder  = [];
  const depsSeen   = new Set();

  for (const tok of tokens) {
    if (!tok) return null;
    const m = tok.match(TERM_RE);
    if (!m) return null;

    const sign = m[1] === '-' ? -1 : 1;

    if (m[2] !== undefined) {
      // num[*]blade
      const idx = BLADE_INDEX[m[3]];
      if (idx === undefined) return null;
      components[idx] += sign * parseFloat(m[2]);
    } else if (m[4] !== undefined) {
      // var * blade  (explicit *)
      const varName = m[4];
      const idx = BLADE_INDEX[m[5]];
      if (idx === undefined) return null;
      if (BLADE_INDEX[varName] !== undefined) return null; // blade name used as variable
      coeffExprs[idx] = sign < 0 ? `-${varName}` : varName;
      if (!depsSeen.has(varName)) { depsSeen.add(varName); depsOrder.push(varName); }
    } else if (m[6] !== undefined) {
      // standalone blade (coeff = 1)
      const idx = BLADE_INDEX[m[6]];
      if (idx === undefined) return null;
      components[idx] += sign;
    } else if (m[7] !== undefined) {
      // standalone number → grade-0 scalar
      components[0] += sign * parseFloat(m[7]);
    } else {
      return null;
    }
  }

  return { components, deps: depsOrder, coeffExprs };
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

  // !(mv_expr) — dual of an inline multivector (literal or variable coefficients)
  if (expr.startsWith('!(') && expr.endsWith(')')) {
    const inner = expr.slice(2, -1);
    const mvResult = parseMVExpr(inner);
    if (mvResult) {
      return {
        id: label, label, type: 'multivector',
        deps: mvResult.deps,
        params: { components: mvResult.components, coeffExprs: mvResult.coeffExprs, dual: true, deps: mvResult.deps },
      };
    }
  }

  // mv_expr — literal or variable-coefficient multivector (bare or parenthesised)
  const mvResult = parseMVExpr(expr);
  if (mvResult) {
    // Pure literal ideal direction (only e01/e02, no deps, no e12) → vector type
    const isIdealDir =
      mvResult.deps.length === 0 &&
      mvResult.components.every((v, i) => i === 4 || i === 5 || Math.abs(v) < 1e-10) &&
      (Math.abs(mvResult.components[4]) > 1e-10 || Math.abs(mvResult.components[5]) > 1e-10);
    if (isIdealDir) {
      // Ideal direction (vx,vy) ↔ vy·e01 - vx·e02  →  vx = -(e02 coeff), vy = e01 coeff
      const vx = -mvResult.components[5];
      const vy =  mvResult.components[4];
      return { id: label, label, type: 'vector', deps: [], params: { xExpr: String(vx), yExpr: String(vy), deps: [] } };
    }
    return {
      id: label, label, type: 'multivector',
      deps: mvResult.deps,
      params: { components: mvResult.components, coeffExprs: mvResult.coeffExprs, deps: mvResult.deps },
    };
  }

  // General multivector arithmetic expression: A + B, 2*A, A*B, (A+B)/2, etc.
  // Basis blades (e01, e12, …) are built-in; everything else becomes a dep.
  const mvDeps = extractMVDeps(expr);
  if (mvDeps !== null && mvDeps.length > 0) {
    return {
      id: label, label, type: 'mvExpr',
      deps: mvDeps,
      params: { exprStr: expr, deps: mvDeps },
    };
  }

  return null;
}
