import { PGA, point2D, idealPoint, makePlane, toEuclidean, lineBaseAndDir } from '../pga.js';
import { evalExpr } from './evalExpr.js';

// Convert a value to a PGA grade-3 element.
// Vectors { vx, vy } become ideal points (direction, weight=0).
function toPGA(val) {
  return (val && 'vx' in val) ? idealPoint(val.vx, val.vy) : val;
}

function join(A, B) {
  return PGA.Vee(toPGA(A), toPGA(B));
}

// meet: intersection of two 2D lines (grade-2) via Cramer's rule on ax+by+c=0.
// Coefficients live at: a=L[9] (e13), b=L[10] (e23), c=L[7] (e03).
function meet(L1, L2) {
  const a1 = L1[9], b1 = L1[10], c1 = L1[7];
  const a2 = L2[9], b2 = L2[10], c2 = L2[7];
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-10) return null;
  return point2D(
    (b1 * c2 - b2 * c1) / det,
    (c1 * a2 - c2 * a1) / det
  );
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
  //   - G is a vector { vx, vy }  → translator (ideal line, nilpotent: exp = 1 + Ls)
  //   - G is a PGA line (grade-2) → rotor / screwmotor  (handled by PGA.Exp generically)
  // The sign convention: ideal line L = -vx·e01 - vy·e02
  // so exp(L·s) >>> P  translates P by (2s·vx, 2s·vy).
  motorExp: {
    label: 'Motor',
    compute: (depValues, { scalarExpr, scalarDeps }) => {
      const geomVal = depValues[0];
      if (!geomVal) return null;
      const scalars = Object.fromEntries(scalarDeps.map((d, i) => [d, depValues[i + 1]]));
      const s = evalExpr(scalarExpr, scalars);
      if (isNaN(s)) return null;

      const L = new PGA(16);
      if ('vx' in geomVal) {
        // Vector → ideal line (translation direction)
        L[5] = -geomVal.vx;  // e01
        L[6] = -geomVal.vy;  // e02
      } else {
        // PGA line/bivector — use directly (gives rotor)
        for (let i = 0; i < 16; i++) L[i] = geomVal[i] || 0;
      }

      const Ls = new PGA(16);
      for (let i = 0; i < 16; i++) Ls[i] = L[i] * s;
      return PGA.Exp(Ls);
    },
  },

  // A >>> B: sandwich product T * B * ~T (rigid body transformation)
  motorApply: {
    label: 'Transform',
    compute: ([T, P]) => {
      if (!T || !P) return null;
      const pgaP = (P && 'vx' in P) ? idealPoint(P.vx, P.vy) : P;
      return PGA.Mul(PGA.Mul(T, pgaP), PGA.Rev(T));
    },
  },

  joinLine: {
    label: 'Line A ∧ B',
    compute: ([P1, P2]) => join(P1, P2),
  },
  meetPoint: {
    label: 'Meet L₁ ∧ L₂',
    compute: ([L1, L2]) => meet(L1, L2),
  },
  pointOnLine: {
    label: 'Point on Line',
    compute: ([L], { t }) => pointOnLine(L, t),
  },
};
