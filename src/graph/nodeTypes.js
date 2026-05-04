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

      if ('vx' in geomVal) {
        // Vector → translator. exp(L*s) = 1 + L*s exactly (L is nilpotent: L²=0).
        // PGA.Exp would give NaN here because sin(|L|)/|L| = 0/0 for ideal bivectors.
        const T = new PGA(16);
        T[0] = 1;
        T[5] = -geomVal.vx * s;  // e01
        T[6] = -geomVal.vy * s;  // e02
        return T;
      }

      if (Math.abs(geomVal[14]) > 1e-10) {
        // PGA grade-3 point → rotation around that point.
        // Generator bivector: B = e12 - py·e01 + px·e02  (unit: B²=-1)
        // Motor: exp(s·B) = cos(s) + sin(s)·B
        const w  = geomVal[14];
        const px = -geomVal[13] / w;   // x = -p[13]/w
        const py =  geomVal[12] / w;   // y =  p[12]/w
        const M  = new PGA(16);
        M[0] =  Math.cos(s);
        M[5] = -py * Math.sin(s);  // e01
        M[6] =  px * Math.sin(s);  // e02
        M[8] =  Math.sin(s);       // e12
        return M;
      }

      // PGA line/bivector — rotor/screwmotor via PGA.Exp
      const L = new PGA(16);
      for (let i = 0; i < 16; i++) L[i] = geomVal[i] || 0;
      const Ls = new PGA(16);
      for (let i = 0; i < 16; i++) Ls[i] = L[i] * s;
      return PGA.Exp(Ls);
    },
  },

  // A >>> B: sandwich product T * B * ~T (rigid body transformation)
  // Supports: translator (from vector), rotor (from point). Operates on grade-3 points.
  motorApply: {
    label: 'Transform',
    compute: ([T, P]) => {
      if (!T || !P) return null;
      const pgaP = (P && 'vx' in P) ? idealPoint(P.vx, P.vy) : P;
      const w = pgaP[14];
      if (Math.abs(w) < 1e-10) return null;  // ideal point not supported

      const sin_s = T[8];  // e12 component — zero for translators, sin(s) for rotors

      if (Math.abs(sin_s) < 1e-10) {
        // Translator: T = 1 + a·e01 + b·e02
        // T * P * ~T: result[12] = P[12] - 2·T[6], result[13] = P[13] + 2·T[5]
        const result = new PGA(16);
        result[12] = pgaP[12] - 2 * T[6];
        result[13] = pgaP[13] + 2 * T[5];
        result[14] = w;
        return result;
      }

      // Rotor: M = cos(s) + sin(s)·(e12 - py·e01 + px·e02)
      // Rotation center: px = M[6]/sin(s), py = -M[5]/sin(s)
      // Rotation angle: 2s  (with cos(2s) = cos²s - sin²s, sin(2s) = 2·cos·sin)
      const cos_s  = T[0];
      const px = T[6] / sin_s;
      const py = -T[5] / sin_s;
      const cos_2s = cos_s * cos_s - sin_s * sin_s;
      const sin_2s = 2 * cos_s * sin_s;
      const x = -pgaP[13] / w;
      const y =  pgaP[12] / w;
      const xp = px + cos_2s * (x - px) + sin_2s * (y - py);
      const yp = py - sin_2s * (x - px) + cos_2s * (y - py);
      const result = new PGA(16);
      result[12] = yp * w;
      result[13] = -xp * w;
      result[14] = w;
      return result;
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
