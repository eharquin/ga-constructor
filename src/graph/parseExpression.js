// Pure expression parser. Returns a node definition or null.
//
// Supported forms:
//   NAME = 10                      → scalar (bare number literal)
//   NAME = point(xExpr, yExpr)     → freePoint
//   NAME = vector(xExpr, yExpr)    → vector
//   NAME = G1 & G2                 → joinLine  (& = regressive product)
//   NAME = G1 ^ G2                 → meetPoint (^ = wedge product)
//   NAME = !A                      → dual      (Poincaré dual of named object)
//   NAME = 5e02 - 1e01             → multivector (literal basis-blade linear combo)
//   NAME = x*e01 + y*e02 + w*e12  → multivector with variable coefficients (deps)
//   NAME = !(mv_expr)              → multivector with dual applied
//   NAME = exp(G, s)               → motorExp (motor from G scaled by s)
//   NAME = M >>> G                 → motorApply (sandwich product, M must be a named ID)
//
// G, G1, G2 (geometric args) accept: named ID, point(…), vector(…), or a
// basis-blade expression (e01, e01+e12, x*e01+e12, …).
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

// Parse NAME = fn(aExpr, bExpr, cExpr) forms. Returns [aExpr, bExpr, cExpr] or null.
function parse3Call(expr, fnName) {
  const prefix = fnName + '(';
  if (!expr.startsWith(prefix) || !expr.endsWith(')')) return null;
  const inner = expr.slice(prefix.length, -1).trim();
  const first = splitTopLevelComma(inner);
  if (!first) return null;
  const second = splitTopLevelComma(first[1]);
  if (!second) return null;
  return [first[0], second[0], second[1]];
}

// Split str at the first occurrence of op that is not inside parentheses.
function splitTopLevelOp(str, op) {
  let depth = 0;
  const opLen = op.length;
  for (let i = 0; i <= str.length - opLen; i++) {
    if (str[i] === '(') { depth++; continue; }
    if (str[i] === ')') { depth--; continue; }
    if (depth === 0 && str.slice(i, i + opLen) === op) {
      return [str.slice(0, i).trim(), str.slice(i + opLen).trim()];
    }
  }
  return null;
}

// Parse an inline geometric argument: blade expression, vector(…), point(…), or named ID.
// Returns { kind, deps, depOffset: 0, … } or null.
// (depOffset is set to 0 here; caller adjusts before storing in params.)
function parseInlineGeom(str) {
  const s = str.trim();

  // Blade expression first (catches e01, e01+e12, x*e01+e12 …).
  // Must come before the plain-ID check so blade names aren't treated as refs.
  const mvResult = parseMVExpr(s);
  if (mvResult) {
    return { kind: 'mv', components: mvResult.components, coeffExprs: mvResult.coeffExprs, deps: mvResult.deps, depOffset: 0 };
  }

  // vector(xExpr, yExpr)
  const vecCoords = parse2DCall(s, 'vector');
  if (vecCoords) {
    const [xExpr, yExpr] = vecCoords;
    return { kind: 'vector', xExpr, yExpr, deps: uniqueDeps(xExpr, yExpr), depOffset: 0 };
  }

  // point(xExpr, yExpr)
  const ptCoords = parse2DCall(s, 'point');
  if (ptCoords) {
    const [xExpr, yExpr] = ptCoords;
    return { kind: 'point', xExpr, yExpr, deps: uniqueDeps(xExpr, yExpr), depOffset: 0 };
  }

  // Plain identifier → named node reference
  if (new RegExp(`^${ID.source}$`).test(s)) {
    return { kind: 'ref', id: s, deps: [s], depOffset: 0 };
  }

  return null;
}

export function parseExpression(text) {
  if (!text || !text.trim()) return null;
  const t = text.trim();

  // Try NAME = <rhs>; if absent, treat the whole text as an anonymous expression.
  const assign = t.match(new RegExp(`^(${ID.source})${WS.source}=${WS.source}(.+)$`));
  let label, expr;
  if (assign) {
    label = assign[1];
    expr  = assign[2].trim();
  } else {
    label = null;
    expr  = t;
  }
  // Stable synthetic ID for anonymous nodes (not referenceable as a dep name).
  const id = label ?? ('_' + expr.replace(/\s+/g, ''));

  // scalar: bare number literal
  const scalar = expr.match(new RegExp(`^(${NUM.source})$`));
  if (scalar) {
    return { id, label, type: 'scalar', deps: [], params: { value: +scalar[1] } };
  }

  // point(xExpr, yExpr)  or  (xExpr, yExpr) — free point
  const ptCoords = parse2DCall(expr, 'point') ?? (() => {
    if (!expr.startsWith('(') || !expr.endsWith(')')) return null;
    return splitTopLevelComma(expr.slice(1, -1).trim());
  })();
  if (ptCoords && ptCoords[0] && ptCoords[1]) {
    const [xExpr, yExpr] = ptCoords;
    const deps = uniqueDeps(xExpr, yExpr);
    return { id, label, type: 'freePoint', deps, params: { xExpr, yExpr, deps } };
  }

  // vector(xExpr, yExpr) — free vector
  const vecCoords = parse2DCall(expr, 'vector');
  if (vecCoords) {
    const [xExpr, yExpr] = vecCoords;
    const deps = uniqueDeps(xExpr, yExpr);
    return { id, label, type: 'vector', deps, params: { xExpr, yExpr, deps } };
  }

  // line(aExpr, bExpr, cExpr) — free line: a·e1 + b·e2 + c·e0
  const lineCoords = parse3Call(expr, 'line');
  if (lineCoords) {
    const [aExpr, bExpr, cExpr] = lineCoords;
    const deps = uniqueDeps(aExpr, bExpr, cExpr);
    return { id, label, type: 'freeLine', deps, params: { aExpr, bExpr, cExpr, deps } };
  }

  // exp(G, s) — motor exponential; G can be a named ID, vector(…), point(…), or blade expr
  if (expr.startsWith('exp(') && expr.endsWith(')')) {
    const inner = expr.slice(4, -1).trim();
    const parts = splitTopLevelComma(inner);
    if (parts) {
      const geomStr = parts[0].trim();
      const scalarExpr = parts[1].trim();
      if (scalarExpr) {
        const geom = parseInlineGeom(geomStr);
        if (geom) {
          geom.depOffset = 0;
          const scalarDeps = extractVarNames(scalarExpr);
          return {
            id, label, type: 'motorExp',
            deps: [...geom.deps, ...scalarDeps],
            params: { geom, scalarExpr, scalarDeps },
          };
        }
      }
    }
  }

  // M >>> G — sandwich product; M must be a named ID, G can be any inline geom
  const swParts = splitTopLevelOp(expr, '>>>');
  if (swParts) {
    const motorStr = swParts[0];
    const geomStr  = swParts[1];
    if (new RegExp(`^${ID.source}$`).test(motorStr)) {
      const geom = parseInlineGeom(geomStr);
      if (geom) {
        geom.depOffset = 1;
        return {
          id, label, type: 'motorApply',
          deps: [motorStr, ...geom.deps],
          params: { geom },
        };
      }
    }
  }

  // G1 & G2 [& G3] — join; 2 operands → line, 3 operands → triangle
  const joinParts = splitTopLevelOp(expr, '&');
  if (joinParts) {
    const join3 = splitTopLevelOp(joinParts[1], '&');
    if (join3) {
      const geom1 = parseInlineGeom(joinParts[0]);
      const geom2 = parseInlineGeom(join3[0]);
      const geom3 = parseInlineGeom(join3[1]);
      if (geom1 && geom2 && geom3) {
        geom1.depOffset = 0;
        geom2.depOffset = geom1.deps.length;
        geom3.depOffset = geom1.deps.length + geom2.deps.length;
        return {
          id, label, type: 'triangle',
          deps: [...geom1.deps, ...geom2.deps, ...geom3.deps],
          params: { geom1, geom2, geom3 },
        };
      }
    }
    const geom1 = parseInlineGeom(joinParts[0]);
    const geom2 = parseInlineGeom(joinParts[1]);
    if (geom1 && geom2) {
      geom1.depOffset = 0;
      geom2.depOffset = geom1.deps.length;
      return {
        id, label, type: 'joinLine',
        deps: [...geom1.deps, ...geom2.deps],
        params: { geom1, geom2 },
      };
    }
  }

  // G1 ^ G2 [^ G3 …] — meet (wedge product chain); n ≥ 2 operands
  const meetParts = splitTopLevelOp(expr, '^');
  if (meetParts) {
    // Collect all operands by repeatedly splitting the right-hand side
    const operandStrs = [meetParts[0]];
    let rest = meetParts[1];
    let next;
    while ((next = splitTopLevelOp(rest, '^'))) {
      operandStrs.push(next[0]);
      rest = next[1];
    }
    operandStrs.push(rest);

    const geoms = operandStrs.map(s => parseInlineGeom(s));
    if (geoms.every(Boolean)) {
      let offset = 0;
      for (const g of geoms) { g.depOffset = offset; offset += g.deps.length; }
      const deps = geoms.flatMap(g => g.deps);

      if (geoms.length === 2) {
        return { id, label, type: 'meetPoint', deps, params: { geom1: geoms[0], geom2: geoms[1] } };
      }
      return { id, label, type: 'meetChain', deps, params: { geoms } };
    }
  }

  // ~ID — reverse of a named object
  const revId = expr.match(new RegExp(`^~${WS.source}(${ID.source})$`));
  if (revId) {
    return { id, label, type: 'reverse', deps: [revId[1]], params: {} };
  }

  // !ID — dual of a named object
  const dualId = expr.match(new RegExp(`^!${WS.source}(${ID.source})$`));
  if (dualId) {
    return { id, label, type: 'dual', deps: [dualId[1]], params: {} };
  }

  // !(mv_expr) — dual of an inline multivector (literal or variable coefficients)
  if (expr.startsWith('!(') && expr.endsWith(')')) {
    const inner = expr.slice(2, -1);
    const mvResult = parseMVExpr(inner);
    if (mvResult) {
      return {
        id, label, type: 'multivector',
        deps: mvResult.deps,
        params: { components: mvResult.components, coeffExprs: mvResult.coeffExprs, dual: true, deps: mvResult.deps },
      };
    }
  }

  // mv_expr — literal or variable-coefficient multivector (bare or parenthesised)
  const mvResult = parseMVExpr(expr);
  if (mvResult) {
    // Pure ideal direction (only e01/e02 blades, literal or variable coefficients) → vector type
    // vx = -(e02 coeff),  vy = e01 coeff  (PGA 2D ideal-point convention)
    const isIdealDir =
      mvResult.components.every((v, i) => i === 4 || i === 5 || Math.abs(v) < 1e-10) &&
      Object.keys(mvResult.coeffExprs).every(k => +k === 4 || +k === 5);
    if (isIdealDir) {
      const e01lit = mvResult.components[4] || 0;
      const e02lit = mvResult.components[5] || 0;
      const e01var = mvResult.coeffExprs[4]; // expression string or undefined
      const e02var = mvResult.coeffExprs[5];
      if (Math.abs(e01lit) > 1e-10 || Math.abs(e02lit) > 1e-10 || e01var || e02var) {
        // vy = e01 coeff
        const yExpr = e01var
          ? (e01lit !== 0 ? `${e01lit} + ${e01var}` : e01var)
          : String(e01lit);
        // vx = -(e02 coeff)
        let xExpr;
        if (e02var) {
          const neg = e02var.startsWith('-') ? e02var.slice(1) : `-${e02var}`;
          xExpr = e02lit !== 0 ? `${-e02lit} + ${neg}` : neg;
        } else {
          xExpr = String(-e02lit);
        }
        return { id, label, type: 'vector', deps: mvResult.deps, params: { xExpr, yExpr, deps: mvResult.deps } };
      }
    }
    return {
      id, label, type: 'multivector',
      deps: mvResult.deps,
      params: { components: mvResult.components, coeffExprs: mvResult.coeffExprs, deps: mvResult.deps },
    };
  }

  // General multivector arithmetic expression: A + B, 2*A, A*B, (A+B)/2, etc.
  // Basis blades (e01, e12, …) are built-in; everything else becomes a dep.
  const mvDeps = extractMVDeps(expr);
  if (mvDeps !== null) {
    return {
      id, label, type: 'mvExpr',
      deps: mvDeps,
      params: { exprStr: expr, deps: mvDeps },
    };
  }

  return null;
}
