// Algebra-aware expression parser factory.
//
// createParseExpression(algebra, evaluator) returns a `parseExpression(text)`
// function bound to one algebra's basis blades and supported node types.
// Each algebra adapter constructs its own parser via this factory.
//
// Supported forms (algebra-gated via spec.supportedNodeTypes):
//   NAME = 10                      → scalar
//   NAME = point(xExpr, yExpr)     → freePoint   (PGA only)
//   NAME = vector(xExpr, yExpr)    → vector
//   NAME = line(a, b, c)           → freeLine    (PGA only)
//   NAME = G1 & G2                 → joinLine    (PGA only)
//   NAME = G1 & G2 & G3            → triangle    (PGA only)
//   NAME = G1 ^ G2 [^ Gn]          → meetPoint / meetChain  (PGA only)
//   NAME = !A / ~A                 → dual / reverse
//   NAME = exp(<mv_expr>)          → motorExp
//   NAME = M >>> G                 → motorApply
//   NAME = !( <mv_expr> )          → multivector (with dual)
//   NAME = <mv linear combo>       → multivector / vector (algebra-specific)
//   NAME = <mv arithmetic>         → mvExpr
//   [G1, G2, ...]                  → list (polygon)
//
// Coordinate expressions support +, -, *, /, parens, scalar refs, and math
// builtins (sin, cos, PI …) — anything accepted by evalExpr.

import { extractVarNames } from './evalExpr.js';
import { COLOR_CONSTS, BUILTIN_FN_NAMES } from './evalMVArith.js';

// Top-level constructor names (parser handles these specially — defining a
// user function with one of these names would shadow the builtin form).
const BUILTIN_CONSTRUCTOR_NAMES = new Set([
  'point', 'flatPoint', 'line', 'vector', 'vinf', 'color', 'triangle', 'exp',
  // CCGA named conics (resolve to constructors only where the spec defines them).
  'circle', 'ellipse', 'hyperbola', 'parabola', 'tilted_ellipse', 'conic',
]);

const ID  = /[A-Za-z_][A-Za-z0-9_]*/;
const NUM = /-?\d+(?:\.\d+)?/;
const WS  = /\s*/;

// ─── Top-level split helpers ────────────────────────────────────────────────

function splitAllTopLevelCommas(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if ('(['.includes(str[i])) depth++;
    else if (')]'.includes(str[i])) depth--;
    else if (str[i] === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = str.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

// True when parens in `str` are balanced and never dip below zero — i.e. the
// string is a self-contained interior. Used by the call-parsers to reject
// `point(1,0) ^ point(-1,0.5)`, whose first ')' is not the call's closer, so
// such expressions fall through to the general mvExpr / evalMVArith path.
function balancedParens(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') { if (--depth < 0) return false; }
  }
  return depth === 0;
}

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

// ─── Factory ────────────────────────────────────────────────────────────────

export function createParseExpression(algebra, evaluator) {
  const { bladeIndex, arraySize, tryVectorFromMV, supportedNodeTypes } = algebra;
  const { extractMVDeps, parseBladeName } = evaluator;

  const accepts = (type) => supportedNodeTypes.has(type);

  // Build the per-algebra blade regex pattern: longest names first to avoid
  // prefix short-circuit (e012 before e01, e12 before e1, etc.).
  const sortedBladeNames = Object.keys(bladeIndex)
    .filter((n) => n !== '1')
    .sort((a, b) => b.length - a.length);
  const BLADE_PAT = sortedBladeNames.join('|');

  // Single signed term: num*blade, var*blade, standalone blade, or num.
  const TERM_RE = new RegExp(
    `^([+-]?)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*\\*?\\s*(${BLADE_PAT})|(${ID.source})\\s*\\*\\s*(${BLADE_PAT})|(${BLADE_PAT})|(\\d+(?:\\.\\d+)?))$`
  );

  // Parse a linear combination of basis blade terms.
  // Returns { components, deps, coeffExprs } or null.
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
    const components = new Array(arraySize).fill(0);
    const coeffExprs = {};
    const depsOrder  = [];
    const depsSeen   = new Set();

    for (const tok of tokens) {
      if (!tok) return null;
      const m = tok.match(TERM_RE);
      if (!m) return null;

      const sign = m[1] === '-' ? -1 : 1;

      if (m[2] !== undefined) {
        const idx = bladeIndex[m[3]];
        if (idx === undefined) return null;
        components[idx] += sign * parseFloat(m[2]);
      } else if (m[4] !== undefined) {
        const varName = m[4];
        const idx = bladeIndex[m[5]];
        if (idx === undefined) return null;
        if (bladeIndex[varName] !== undefined) return null;
        coeffExprs[idx] = sign < 0 ? `-${varName}` : varName;
        if (!depsSeen.has(varName)) { depsSeen.add(varName); depsOrder.push(varName); }
      } else if (m[6] !== undefined) {
        const idx = bladeIndex[m[6]];
        if (idx === undefined) return null;
        components[idx] += sign;
      } else if (m[7] !== undefined) {
        components[0] += sign * parseFloat(m[7]);
      } else {
        return null;
      }
    }

    return { components, deps: depsOrder, coeffExprs };
  }

  function uniqueDeps(...exprs) {
    const seen = new Set();
    const deps = [];
    for (const expr of exprs)
      for (const v of extractVarNames(expr, parseBladeName))
        if (!(v in COLOR_CONSTS) && !seen.has(v)) { seen.add(v); deps.push(v); }
    return deps;
  }

  function parse2DCall(expr, fnName) {
    const prefix = fnName + '(';
    if (!expr.startsWith(prefix) || !expr.endsWith(')')) return null;
    const inner = expr.slice(prefix.length, -1).trim();
    if (!balancedParens(inner)) return null;   // the trailing ')' isn't this call's closer
    const coords = splitTopLevelComma(inner);
    if (!coords || !coords[0] || !coords[1]) return null;
    return coords;
  }

  function parse3Call(expr, fnName) {
    const prefix = fnName + '(';
    if (!expr.startsWith(prefix) || !expr.endsWith(')')) return null;
    const inner = expr.slice(prefix.length, -1).trim();
    if (!balancedParens(inner)) return null;   // the trailing ')' isn't this call's closer
    const first = splitTopLevelComma(inner);
    if (!first) return null;
    const second = splitTopLevelComma(first[1]);
    if (!second) return null;
    return [first[0], second[0], second[1]];
  }

  // Inline geometric arg: blade expression, vector(…), point(…), or named ID.
  // point() refs only emitted when supported by the algebra.
  function parseInlineGeom(str) {
    const s = str.trim();

    const mvResult = parseMVExpr(s);
    if (mvResult) {
      return { kind: 'mv', components: mvResult.components, coeffExprs: mvResult.coeffExprs, deps: mvResult.deps, depOffset: 0 };
    }

    const vecCoords = parse2DCall(s, 'vector');
    if (vecCoords) {
      const [xExpr, yExpr] = vecCoords;
      return { kind: 'vector', xExpr, yExpr, deps: uniqueDeps(xExpr, yExpr), depOffset: 0 };
    }

    if (accepts('freePoint')) {
      const ptCoords = parse2DCall(s, 'point');
      if (ptCoords) {
        const [xExpr, yExpr] = ptCoords;
        return { kind: 'point', xExpr, yExpr, deps: uniqueDeps(xExpr, yExpr), depOffset: 0 };
      }
    }

    if (new RegExp(`^${ID.source}$`).test(s)) {
      return { kind: 'ref', id: s, deps: [s], depOffset: 0 };
    }

    return null;
  }

  // ── Main entry ────────────────────────────────────────────────────────
  return function parseExpression(text) {
    if (!text || !text.trim()) return null;
    const t = text.trim();

    // Function definition: name(p1, p2, ...) = body  (must come before the
    // value-assignment branch because both start with an identifier).
    if (accepts('funcDef')) {
      const fnDef = t.match(new RegExp(`^(${ID.source})${WS.source}\\(([^)]*)\\)${WS.source}=${WS.source}(.+)$`));
      if (fnDef) {
        const name = fnDef[1];
        const paramStr = fnDef[2];
        const body = fnDef[3].trim();
        if (BUILTIN_FN_NAMES.has(name) || BUILTIN_CONSTRUCTOR_NAMES.has(name)) {
          return null; // name collides with a builtin — row shows invalid
        }
        const paramNames = paramStr.trim() ? paramStr.split(',').map((s) => s.trim()) : [];
        if (!paramNames.every((p) => new RegExp(`^${ID.source}$`).test(p))) return null;
        if (new Set(paramNames).size !== paramNames.length) return null;
        const bodyDeps = extractMVDeps(body);
        if (bodyDeps === null) return null; // body must parse as a valid mv expression
        // Capture globals referenced in the body (excluding parameters and the
        // function's own name — self-name passes through env at call time so
        // recursion still works, without creating a cycle in topo-sort).
        const captureDeps = bodyDeps.filter((d) => !paramNames.includes(d) && d !== name);
        return {
          id: name,
          label: name,
          type: 'funcDef',
          deps: captureDeps,
          params: { name, paramNames, body, captureDeps },
        };
      }
    }

    const assign = t.match(new RegExp(`^(${ID.source})${WS.source}=${WS.source}(.+)$`));
    let label, expr;
    if (assign) { label = assign[1]; expr = assign[2].trim(); }
    else        { label = null;       expr = t; }
    const id = label ?? ('_' + expr.replace(/\s+/g, ''));

    const scalar = expr.match(new RegExp(`^(${NUM.source})$`));
    if (scalar) {
      return { id, label, type: 'scalar', deps: [], params: { value: +scalar[1] } };
    }

    // point(xExpr, yExpr[, rExpr]) — PGA/CGA-only
    if (accepts('freePoint')) {
      const pt3Coords = parse3Call(expr, 'point');
      if (pt3Coords?.[0] && pt3Coords?.[1] && pt3Coords?.[2]) {
        const [xExpr, yExpr, zExpr] = pt3Coords;
        const deps = uniqueDeps(xExpr, yExpr, zExpr);
        return { id, label, type: 'freePoint', deps, params: { xExpr, yExpr, zExpr, deps } };
      }
      const ptCoords = parse2DCall(expr, 'point') ?? (() => {
        if (!expr.startsWith('(') || !expr.endsWith(')')) return null;
        return splitTopLevelComma(expr.slice(1, -1).trim());
      })();
      if (ptCoords && ptCoords[0] && ptCoords[1]) {
        const [xExpr, yExpr] = ptCoords;
        const deps = uniqueDeps(xExpr, yExpr);
        return { id, label, type: 'freePoint', deps, params: { xExpr, yExpr, deps } };
      }
    }

    // flatPoint(xExpr, yExpr) — CGA-only draggable flat point
    if (accepts('freeFlatPoint')) {
      const fpCoords = parse2DCall(expr, 'flatPoint');
      if (fpCoords && fpCoords[0] && fpCoords[1]) {
        const [xExpr, yExpr] = fpCoords;
        const deps = uniqueDeps(xExpr, yExpr);
        return { id, label, type: 'freeFlatPoint', deps, params: { xExpr, yExpr, deps } };
      }
    }

    // color(R, G, B) — RGB color value (non-MV). Auto-detects 0–1 vs 0–255 range.
    if (accepts('color')) {
      const rgb = parse3Call(expr, 'color');
      if (rgb) {
        const [rExpr, gExpr, bExpr] = rgb;
        const deps = uniqueDeps(rExpr, gExpr, bExpr);
        return { id, label, type: 'color', deps, params: { rExpr, gExpr, bExpr, deps } };
      }
    }

    // vector(xExpr, yExpr[, rExpr]) — CGA-only draggable ideal round point.
    // Produces an MV value (so it composes with ^, &, …); renders as an arrow.
    if (accepts('freeVector')) {
      const v3 = parse3Call(expr, 'vector');
      if (v3?.[0] && v3?.[1] && v3?.[2]) {
        const [xExpr, yExpr, rExpr] = v3;
        const deps = uniqueDeps(xExpr, yExpr, rExpr);
        return { id, label, type: 'freeVector', deps, params: { xExpr, yExpr, rExpr, deps } };
      }
      const v2 = parse2DCall(expr, 'vector');
      if (v2 && v2[0] && v2[1]) {
        const [xExpr, yExpr] = v2;
        const deps = uniqueDeps(xExpr, yExpr);
        return { id, label, type: 'freeVector', deps, params: { xExpr, yExpr, deps } };
      }
    }

    // vinf(xExpr, yExpr) — CCGA-only draggable point at infinity (Veronese limit).
    // Produces an MV value; renders as an arrow in its asymptotic direction.
    if (accepts('freeInfinityPoint')) {
      const vinfCoords = parse2DCall(expr, 'vinf');
      if (vinfCoords && vinfCoords[0] && vinfCoords[1]) {
        const [xExpr, yExpr] = vinfCoords;
        const deps = uniqueDeps(xExpr, yExpr);
        return { id, label, type: 'freeInfinityPoint', deps, params: { xExpr, yExpr, deps } };
      }
    }

    // vector(xExpr, yExpr) — always supported
    const vecCoords = parse2DCall(expr, 'vector');
    if (vecCoords) {
      const [xExpr, yExpr] = vecCoords;
      const deps = uniqueDeps(xExpr, yExpr);
      return { id, label, type: 'vector', deps, params: { xExpr, yExpr, deps } };
    }

    // line(a, b, c) — PGA-only
    if (accepts('freeLine')) {
      const lineCoords = parse3Call(expr, 'line');
      if (lineCoords) {
        const [aExpr, bExpr, cExpr] = lineCoords;
        const deps = uniqueDeps(aExpr, bExpr, cExpr);
        return { id, label, type: 'freeLine', deps, params: { aExpr, bExpr, cExpr, deps } };
      }
    }

    // exp(V)
    if (accepts('motorExp') && expr.startsWith('exp(') && expr.endsWith(')')) {
      const inner = expr.slice(4, -1).trim();
      if (inner && splitTopLevelComma(inner) === null) {
        const mvDeps = extractMVDeps(inner);
        if (mvDeps !== null) {
          return { id, label, type: 'motorExp', deps: mvDeps, params: { exprStr: inner, deps: mvDeps } };
        }
      }
    }

    // M >>> G
    if (accepts('motorApply')) {
      const swParts = splitTopLevelOp(expr, '>>>');
      if (swParts) {
        const motorStr = swParts[0];
        const geomStr  = swParts[1];
        if (new RegExp(`^${ID.source}$`).test(motorStr)) {
          const geom = parseInlineGeom(geomStr);
          if (geom) {
            geom.depOffset = 1;
            return { id, label, type: 'motorApply', deps: [motorStr, ...geom.deps], params: { geom } };
          }
        }
      }
    }

    // G1 & G2 [& G3] — join (PGA only)
    if (accepts('joinLine') || accepts('triangle')) {
      const joinParts = splitTopLevelOp(expr, '&');
      if (joinParts) {
        if (accepts('triangle')) {
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
        }
        if (accepts('joinLine')) {
          const geom1 = parseInlineGeom(joinParts[0]);
          const geom2 = parseInlineGeom(joinParts[1]);
          if (geom1 && geom2) {
            geom1.depOffset = 0;
            geom2.depOffset = geom1.deps.length;
            return { id, label, type: 'joinLine', deps: [...geom1.deps, ...geom2.deps], params: { geom1, geom2 } };
          }
        }
      }
    }

    // G1 ^ G2 [^ G3 …] — meet (PGA only)
    if (accepts('meetPoint') || accepts('meetChain')) {
      const meetParts = splitTopLevelOp(expr, '^');
      if (meetParts) {
        const operandStrs = [meetParts[0]];
        let rest = meetParts[1];
        let next;
        while ((next = splitTopLevelOp(rest, '^'))) {
          operandStrs.push(next[0]);
          rest = next[1];
        }
        operandStrs.push(rest);

        const geoms = operandStrs.map((s) => parseInlineGeom(s));
        if (geoms.every(Boolean)) {
          let offset = 0;
          for (const g of geoms) { g.depOffset = offset; offset += g.deps.length; }
          const deps = geoms.flatMap((g) => g.deps);

          if (geoms.length === 2 && accepts('meetPoint')) {
            return { id, label, type: 'meetPoint', deps, params: { geom1: geoms[0], geom2: geoms[1] } };
          }
          if (accepts('meetChain')) {
            return { id, label, type: 'meetChain', deps, params: { geoms } };
          }
        }
      }
    }

    // ~ID — reverse of named (skip blade names)
    if (accepts('reverse')) {
      const revId = expr.match(new RegExp(`^~${WS.source}(${ID.source})$`));
      if (revId && !parseBladeName(revId[1])) {
        return { id, label, type: 'reverse', deps: [revId[1]], params: {} };
      }
    }

    // !ID — dual of named (skip blade names)
    if (accepts('dual')) {
      const dualId = expr.match(new RegExp(`^!${WS.source}(${ID.source})$`));
      if (dualId && !parseBladeName(dualId[1])) {
        return { id, label, type: 'dual', deps: [dualId[1]], params: {} };
      }
    }

    // !(mv_expr) — dual of inline multivector
    if (accepts('multivector') && expr.startsWith('!(') && expr.endsWith(')')) {
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

    // mv_expr — literal or variable-coefficient multivector
    const mvResult = parseMVExpr(expr);
    if (mvResult) {
      // Algebra-specific "looks like a vector" detection (PGA ideal direction,
      // VGA grade-1 e1/e2 combo, …) — emit `vector` instead of generic multivector.
      if (tryVectorFromMV) {
        const asVec = tryVectorFromMV(mvResult);
        if (asVec) {
          return { id, label, type: 'vector', deps: asVec.deps, params: { xExpr: asVec.xExpr, yExpr: asVec.yExpr, deps: asVec.deps } };
        }
      }
      if (accepts('multivector')) {
        return {
          id, label, type: 'multivector',
          deps: mvResult.deps,
          params: { components: mvResult.components, coeffExprs: mvResult.coeffExprs, deps: mvResult.deps },
        };
      }
    }

    // [P1, P2, P3, ...] — polygon list
    if (accepts('list') && expr.startsWith('[') && expr.endsWith(']')) {
      const inner = expr.slice(1, -1).trim();
      if (inner) {
        const parts = splitAllTopLevelCommas(inner);
        if (parts.length >= 1) {
          const geoms = parts.map((s) => parseInlineGeom(s));
          if (geoms.every(Boolean)) {
            let offset = 0;
            for (const g of geoms) { g.depOffset = offset; offset += g.deps.length; }
            return { id, label, type: 'list', deps: geoms.flatMap((g) => g.deps), params: { geoms } };
          }
        }
      }
    }

    // General MV arithmetic
    if (accepts('mvExpr')) {
      const mvDeps = extractMVDeps(expr);
      if (mvDeps !== null) {
        return { id, label, type: 'mvExpr', deps: mvDeps, params: { exprStr: expr, deps: mvDeps } };
      }
    }

    return null;
  };
}
