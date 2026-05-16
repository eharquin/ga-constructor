import { PGA, point2D, line2D, idealPoint, toEuclidean, lineBaseAndDir, dualOp, reverseOp } from '../pga.js';
import { evalExpr } from './evalExpr.js';
import { evalMVArith } from './evalMVArith.js';

// Convert a value to a PGA element (ideal point for vectors, pass-through otherwise).
function toPGA(val) {
  return (val && 'vx' in val) ? idealPoint(val.vx, val.vy) : val;
}

// Resolve an inline geometric argument to its PGA value.
// geom comes from parseInlineGeom (kind, deps, depOffset, …).
// depValues is the full depValues array passed to the node's compute function.
function resolveInlineGeom(geom, depValues) {
  const local = depValues.slice(geom.depOffset, geom.depOffset + geom.deps.length);
  if (geom.kind === 'ref') return local[0];
  if (geom.kind === 'vector') {
    const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
    const vx = evalExpr(geom.xExpr, s), vy = evalExpr(geom.yExpr, s);
    return isNaN(vx) || isNaN(vy) ? null : { vx, vy };
  }
  if (geom.kind === 'point') {
    const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
    const x = evalExpr(geom.xExpr, s), y = evalExpr(geom.yExpr, s);
    return isNaN(x) || isNaN(y) ? null : point2D(x, y);
  }
  if (geom.kind === 'mv') {
    const mv = new PGA(8);
    for (let i = 0; i < 8; i++) mv[i] = geom.components[i] || 0;
    if (geom.deps.length && geom.coeffExprs) {
      const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
      for (const [idx, expr] of Object.entries(geom.coeffExprs)) mv[+idx] = evalExpr(expr, s);
    }
    return mv;
  }
  return null;
}

function join(A, B) {
  return PGA.Vee(toPGA(A), toPGA(B));
}

function meet(A, B) {
  return PGA.Wedge(toPGA(A), toPGA(B));
}

function pointOnLine(L, t) {
  const bd = lineBaseAndDir(L);
  if (!bd) return null;
  return point2D(bd.bx + t * bd.ux, bd.by + t * bd.uy);
}

// Evaluate both coordinate expressions with the dep-scalar environment.
function evalCoords(depValues, { xExpr, yExpr, deps }) {
  const scalars = Object.fromEntries((deps ?? []).map((d, i) => [d, depValues[i]]));
  return { vx: evalExpr(xExpr, scalars), vy: evalExpr(yExpr, scalars) };
}

// Each type defines: label (display name), compute(depValues[], params) → value.
export const NODE_TYPES = {
  scalar: {
    label: 'Scalar',
    compute: (_, { value }) => value,
  },
  freePoint: {
    label: 'Free Point',
    compute: (depValues, params) => {
      const { vx: cx, vy: cy } = evalCoords(depValues, params);
      if (isNaN(cx) || isNaN(cy)) return null;
      return point2D(cx, cy);
    },
  },
  freeLine: {
    label: 'Free Line',
    compute: (depValues, { aExpr, bExpr, cExpr, deps }) => {
      const scalars = Object.fromEntries((deps ?? []).map((d, i) => [d, depValues[i]]));
      const a = evalExpr(aExpr, scalars);
      const b = evalExpr(bExpr, scalars);
      const c = evalExpr(cExpr, scalars);
      if (isNaN(a) || isNaN(b) || isNaN(c)) return null;
      return line2D(a, b, c);
    },
  },
  vector: {
    label: 'Vector',
    // Returns a plain { vx, vy } object — not a PGA element.
    compute: (depValues, params) => {
      const { vx, vy } = evalCoords(depValues, params);
      if (isNaN(vx) || isNaN(vy)) return null;
      return { vx, vy };
    },
  },
  // exp(V): motor exponential of a bivector expression V.
  // V can be any MV expression: a named vector/point, a scaled form like t*V or a*P,
  // a blade combination, etc. The exponent uses V as-is — pass `t*V` to scale.
  //
  // For V with V² = -c² (e.g. point with weight c, or any rotational generator):
  //   exp(V) = cos(c) + (sin(c)/c) · V       — rotor (around the point, by angle 2c)
  // For nilpotent V (V² = 0, e.g. ideal point / vector / pure e0):
  //   exp(V) = 1 + V                          — pure translator
  motorExp: {
    label: 'Motor',
    compute: (depValues, { exprStr, deps: paramDeps }) => {
      const env = Object.fromEntries((paramDeps ?? []).map((d, i) => [d, depValues[i]]));
      const raw = evalMVArith(exprStr, env);
      if (raw == null) return null;

      // Promote { vx, vy } → ideal-point MV.
      const V = (typeof raw === 'object' && 'vx' in raw) ? idealPoint(raw.vx, raw.vy) : raw;
      if (typeof V === 'number') {
        const T = new PGA(8); T[0] = Math.exp(V); return T;
      }
      if (!V.length || V.length < 8) return null;

      const c = V[6] || 0;
      const T = new PGA(8);
      if (Math.abs(c) < 1e-10) {
        T[0] = 1;
        for (let i = 1; i < 8; i++) T[i] = V[i] || 0;
        return T;
      }
      const factor = Math.sin(c) / c;
      T[0] = Math.cos(c);
      for (let i = 1; i < 8; i++) T[i] = factor * (V[i] || 0);
      return T;
    },
  },

  // M >>> G: sandwich product M * G * ~M (rigid body transformation).
  // M must be a named motor node; G can be any inline geom.
  motorApply: {
    label: 'Transform',
    compute: (depValues, { geom }) => {
      const T = depValues[0];
      if (!T) return null;
      const raw = geom ? resolveInlineGeom(geom, depValues) : depValues[1];
      const pgaP = raw && 'vx' in raw ? idealPoint(raw.vx, raw.vy) : raw;
      if (!pgaP) return null;
      const w = pgaP[6];
      // Non-point input (line, etc.) — use the generic sandwich.
      if (Math.abs(w) < 1e-10) {
        return PGA.Mul(PGA.Mul(T, pgaP), reverseOp(T));
      }

      const sin_s = T[6];
      if (Math.abs(sin_s) < 1e-10) {
        const result = new PGA(8);
        result[4] = pgaP[4] - 2 * T[5];
        result[5] = pgaP[5] + 2 * T[4];
        result[6] = w;
        return result;
      }

      const cos_s = T[0];
      const px = T[5] / sin_s, py = -T[4] / sin_s;
      const cos_2s = cos_s * cos_s - sin_s * sin_s;
      const sin_2s = 2 * cos_s * sin_s;
      const x = -pgaP[5] / w, y = pgaP[4] / w;
      const xp = px + cos_2s * (x - px) + sin_2s * (y - py);
      const yp = py - sin_2s * (x - px) + cos_2s * (y - py);
      const result = new PGA(8);
      result[4] = yp * w;
      result[5] = -xp * w;
      result[6] = w;
      return result;
    },
  },

  triangle: {
    label: 'Triangle',
    compute: (depValues, { geom1, geom2, geom3 }) => {
      const P1 = resolveInlineGeom(geom1, depValues);
      const P2 = resolveInlineGeom(geom2, depValues);
      const P3 = resolveInlineGeom(geom3, depValues);
      if (!P1 || !P2 || !P3) return null;
      const eu1 = toEuclidean(toPGA(P1));
      const eu2 = toEuclidean(toPGA(P2));
      const eu3 = toEuclidean(toPGA(P3));
      if (!eu1 || !eu2 || !eu3) return null;
      // 2× signed area (positive = CCW) — propagated as a plain scalar
      return (eu2.x - eu1.x) * (eu3.y - eu1.y) - (eu3.x - eu1.x) * (eu2.y - eu1.y);
    },
  },

  list: {
    label: 'Polygon',
    compute: (depValues, { geoms }) => {
      const points = geoms.map(g => {
        const val = resolveInlineGeom(g, depValues);
        return val ? toEuclidean(toPGA(val)) : null;
      });
      if (points.some(p => !p)) return null;
      return { list: true, points };
    },
  },

  joinLine: {
    label: 'Line A ∧ B',
    compute: (depValues, { geom1, geom2 }) => {
      const P1 = geom1 ? resolveInlineGeom(geom1, depValues) : depValues[0];
      const P2 = geom2 ? resolveInlineGeom(geom2, depValues) : depValues[1];
      return join(P1, P2);
    },
  },
  meetPoint: {
    label: 'Meet L₁ ∧ L₂',
    compute: (depValues, { geom1, geom2 }) => {
      const L1 = geom1 ? resolveInlineGeom(geom1, depValues) : depValues[0];
      const L2 = geom2 ? resolveInlineGeom(geom2, depValues) : depValues[1];
      return meet(L1, L2);
    },
  },
  meetChain: {
    label: 'Meet L₁ ∧ … ∧ Lₙ',
    compute: (depValues, { geoms }) => {
      let result = toPGA(resolveInlineGeom(geoms[0], depValues));
      for (let i = 1; i < geoms.length; i++) {
        const next = resolveInlineGeom(geoms[i], depValues);
        if (!next) return null;
        result = PGA.Wedge(result, toPGA(next));
      }
      return result;
    },
  },
  pointOnLine: {
    label: 'Point on Line',
    compute: ([L], { t }) => pointOnLine(L, t),
  },

  // Multivector: build a PGA element from a base component array plus optional variable coefficients.
  // params.coeffExprs: { [idx]: exprString } — evaluated using deps as scalar environment.
  // If a coefficient is a single var (optionally negated) that resolves to a non-scalar value
  // (vector or MV), the term is interpreted as the algebraic product `dep × blade` instead of
  // a scalar coefficient — so `V * e12` returns the orthogonal vector, not garbage in slot 6.
  multivector: {
    label: 'Multivector',
    compute: (depValues, { components, dual, deps: paramDeps, coeffExprs }) => {
      const mv = new PGA(8);
      for (let i = 0; i < 8; i++) mv[i] = components[i] || 0;
      if (paramDeps?.length && coeffExprs) {
        const scalars = Object.fromEntries(paramDeps.map((d, i) => [d, depValues[i]]));
        for (const [idxStr, expr] of Object.entries(coeffExprs)) {
          const idx = +idxStr;
          const varRef = expr.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
          const depVal = varRef ? scalars[varRef[2]] : null;
          if (depVal != null && typeof depVal !== 'number') {
            const sign = varRef[1] === '-' ? -1 : 1;
            const left = ('vx' in depVal) ? idealPoint(depVal.vx, depVal.vy) : depVal;
            const blade = new PGA(8); blade[idx] = sign;
            const prod = PGA.Mul(left, blade);
            for (let i = 0; i < 8; i++) mv[i] = (mv[i] || 0) + (prod[i] || 0);
          } else {
            mv[idx] = evalExpr(expr, scalars);
          }
        }
      }
      return dual ? dualOp(mv) : mv;
    },
  },

  // General multivector arithmetic expression: A + B, 2*A, A*B, (A+B)/2, etc.
  mvExpr: {
    label: 'MV Expression',
    compute: (depValues, { exprStr, deps: paramDeps }) => {
      if (!paramDeps) return null;
      const env = Object.fromEntries(paramDeps.map((d, i) => [d, depValues[i]]));
      return evalMVArith(exprStr, env);
    },
  },

  // 2D PGA dual of a dependent element (!A).
  dual: {
    label: 'Dual',
    compute: ([val]) => {
      if (!val || !val.length || val.length < 8) return null;
      return dualOp(val);
    },
  },

  // Reverse of a dependent element (~A).
  reverse: {
    label: 'Reverse',
    compute: ([val]) => {
      if (!val || !val.length || val.length < 8) return null;
      return reverseOp(val);
    },
  },
};
