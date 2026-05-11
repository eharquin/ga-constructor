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
  // exp(G, s): build a motor from a geometric element G scaled by s.
  // G can be a named node, an inline vector/point/blade expression.
  motorExp: {
    label: 'Motor',
    compute: (depValues, { geom, scalarExpr, scalarDeps }) => {
      const geomVal = geom ? resolveInlineGeom(geom, depValues) : depValues[0];
      if (!geomVal) return null;
      const geomDepsCount = geom ? geom.deps.length : 1;
      const scalars = Object.fromEntries((scalarDeps ?? []).map((d, i) => [d, depValues[geomDepsCount + i]]));
      const s = evalExpr(scalarExpr, scalars);
      if (isNaN(s)) return null;

      // { vx, vy } → translator
      if ('vx' in geomVal) {
        const T = new PGA(8);
        T[0] = 1;
        T[4] = -geomVal.vx * s;
        T[5] = -geomVal.vy * s;
        return T;
      }

      // Grade-2 point (e12 ≠ 0) → rotation around that point
      if (Math.abs(geomVal[6]) > 1e-10) {
        const w  = geomVal[6];
        const px = -geomVal[5] / w;
        const py =  geomVal[4] / w;
        const M  = new PGA(8);
        M[0] =  Math.cos(s);
        M[4] = -py * Math.sin(s);
        M[5] =  px * Math.sin(s);
        M[6] =  Math.sin(s);
        return M;
      }

      // Ideal point (e12 = 0, pure e01/e02) → translator.
      // PGA.Exp gives NaN here (nilpotent); use 1 + Ls directly.
      // idealPoint(vx,vy) stores: p[4]=vy, p[5]=-vx
      if (Math.abs(geomVal[4] || 0) > 1e-10 || Math.abs(geomVal[5] || 0) > 1e-10) {
        const vx = -(geomVal[5] || 0);
        const vy =  geomVal[4] || 0;
        const T  = new PGA(8);
        T[0] = 1;
        T[4] = -vx * s;
        T[5] = -vy * s;
        return T;
      }

      // General PGA bivector — motor via PGA.Exp
      const Ls = new PGA(8);
      for (let i = 0; i < 8; i++) Ls[i] = (geomVal[i] || 0) * s;
      return PGA.Exp(Ls);
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
      if (Math.abs(w) < 1e-10) return null;

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
      const area = 0.5 * Math.abs(
        (eu2.x - eu1.x) * (eu3.y - eu1.y) - (eu3.x - eu1.x) * (eu2.y - eu1.y)
      );
      return { triangle: true, p1: eu1, p2: eu2, p3: eu3, area };
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
  pointOnLine: {
    label: 'Point on Line',
    compute: ([L], { t }) => pointOnLine(L, t),
  },

  // Multivector: build a PGA element from a base component array plus optional variable coefficients.
  // params.coeffExprs: { [idx]: exprString } — evaluated using deps as scalar environment.
  multivector: {
    label: 'Multivector',
    compute: (depValues, { components, dual, deps: paramDeps, coeffExprs }) => {
      const mv = new PGA(8);
      for (let i = 0; i < 8; i++) mv[i] = components[i] || 0;
      if (paramDeps?.length && coeffExprs) {
        const scalars = Object.fromEntries(paramDeps.map((d, i) => [d, depValues[i]]));
        for (const [idx, expr] of Object.entries(coeffExprs)) {
          mv[+idx] = evalExpr(expr, scalars);
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
