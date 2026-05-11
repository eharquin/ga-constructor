import Algebra from 'ganja.js';

// PGA(2,0,1): metric (e0²=0, e1²=e2²=1)
// Basis order (ganja.js): 1, e0, e1, e2, e01, e02, e12, e012
//                        [0] [1] [2] [3]  [4]  [5]  [6]   [7]
export const PGA = Algebra(2, 0, 1);

// Euclidean 2D point at (x, y).
// Grade-2 bivector: y·e01 - x·e02 + w·e12
export const point2D = (x, y) => {
  const p = new PGA(8);
  p[4] = y;   // e01
  p[5] = -x;  // e02
  p[6] = 1;   // e12 (weight)
  return p;
};

// 2D PGA line: a·e1 + b·e2 + c·e0  →  equation a·x + b·y + c = 0
export const line2D = (a, b, c) => {
  const L = new PGA(8);
  L[1] = c;   // e0
  L[2] = a;   // e1
  L[3] = b;   // e2
  return L;
};

// Ideal point (point at infinity) — represents a direction (vx, vy). Weight = 0.
export const idealPoint = (vx, vy) => {
  const p = new PGA(8);
  p[4] = vy;   // e01
  p[5] = -vx;  // e02
  // p[6] = 0  (e12, weight = 0 → ideal)
  return p;
};

// 2D PGA dual (complement w.r.t. e012 pseudoscalar).
// grade-1 ↔ grade-2 :  e0↔e12,  e1↔e02,  e2↔e01
// grade-0 ↔ grade-3 :  1↔e012
export const dualOp = (mv) => {
  const result = new PGA(8);
  result[6] = mv[1];   // e0   → e12
  result[5] = mv[2];   // e1   → e02
  result[4] = mv[3];   // e2   → e01
  result[1] = mv[6];   // e12  → e0
  result[2] = mv[5];   // e02  → e1
  result[3] = mv[4];   // e01  → e2
  result[0] = mv[7];   // e012 → scalar
  result[7] = mv[0];   // scalar → e012
  return result;
};

// Extract Euclidean (x,y) from a grade-2 PGA(2,0,1) point. Returns null for ideal points.
// Point: y·e01 - x·e02 + w·e12  →  x = -p[5]/p[6],  y = p[4]/p[6]
export const toEuclidean = (p) => {
  if (!p || typeof p.length !== 'number') return null;
  const w = p[6];   // e12 weight
  if (Math.abs(w) < 1e-10) return null;
  return { x: -p[5] / w, y: p[4] / w };
};

// Reverse (reversion) of a multivector: grade-k blades get sign (-1)^(k(k-1)/2).
// In PGA(2,0,1): grade 0,1 → unchanged; grade 2,3 → negated.
export const reverseOp = (mv) => {
  const result = new PGA(8);
  result[0] =  mv[0];   // scalar   (grade 0) +
  result[1] =  mv[1];   // e0       (grade 1) +
  result[2] =  mv[2];   // e1       (grade 1) +
  result[3] =  mv[3];   // e2       (grade 1) +
  result[4] = -mv[4];   // e01      (grade 2) −
  result[5] = -mv[5];   // e02      (grade 2) −
  result[6] = -mv[6];   // e12      (grade 2) −
  result[7] = -mv[7];   // e012     (grade 3) −
  return result;
};

// Extract raw (unnormalised) vector (vx,vy) from a grade-2 ideal point (w≈0).
// Returns null when the input is a finite point or has zero magnitude.
export const toIdealVector = (p) => {
  if (!p || typeof p.length !== 'number' || p.length < 8) return null;
  if (Math.abs(p[6]) > 1e-10) return null;   // finite point — not ideal
  const vx = -p[5];  // e02 → -vx
  const vy =  p[4];  // e01 →  vy
  if (Math.sqrt(vx * vx + vy * vy) < 1e-10) return null;
  return { vx, vy };
};

// Finite norm² in PGA(2,0,1): scalar_part(A · Ã).
// Equivalent to testing A·e0 = 0: the product v*e0 is non-zero only when
// indices 0 (scalar), 2 (e1), 3 (e2), or 6 (e12) are non-zero.
const finitNormSq = (v) => v[0] ** 2 + v[2] ** 2 + v[3] ** 2 + v[6] ** 2;

// Classify a raw 8-element PGA multivector by its grade structure.
// Returns { kind } or null for invalid input.
// Kinds:
//   'scalar'      — grade-0 only
//   'line'        — grade-1 with finite part (e1 or e2); also a reflector
//   'idealLine'   — grade-1 with only e0 (ideal reflector)
//   'finitePoint' — grade-2 with e12 ≠ 0
//   'idealPoint'  — grade-2 with e12 = 0
//   'pseudoscalar'— grade-3 only (e012)
//   'rotor'       — even-grade: scalar + e12 (rotation motor)
//   'translator'  — even-grade: scalar + e01/e02 (translation motor)
//   'motor'       — even-grade: general (rotation + translation)
//   'reflector'   — odd-grade: grade-1 + grade-3 (glide reflection: R·Motor)
//   'mixed'       — anything else
export const classifyMV = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return null;

  const eps = 1e-10;
  const g0 = Math.abs(val[0]) > eps;
  const g1 = Math.abs(val[1]) > eps || Math.abs(val[2]) > eps || Math.abs(val[3]) > eps;
  const g2 = Math.abs(val[4]) > eps || Math.abs(val[5]) > eps || Math.abs(val[6]) > eps;
  const g3 = Math.abs(val[7]) > eps;

  if (g0 && !g1 && !g2 && !g3) return { kind: 'scalar' };

  if (!g0 && g1 && !g2 && !g3)
    return { kind: (Math.abs(val[2]) < eps && Math.abs(val[3]) < eps) ? 'idealLine' : 'line' };

  if (!g0 && !g1 && g2 && !g3)
    return { kind: Math.abs(val[6]) > eps ? 'finitePoint' : 'idealPoint' };

  if (!g0 && !g1 && !g2 && g3) return { kind: 'pseudoscalar' };

  // Even-grade: grade-0 + grade-2 (motors)
  if (g0 && !g1 && g2 && !g3) {
    const hasIdeal = Math.abs(val[4]) > eps || Math.abs(val[5]) > eps;
    const hasRotor = Math.abs(val[6]) > eps;
    if (hasRotor && !hasIdeal) return { kind: 'rotor' };
    if (hasIdeal && !hasRotor) return { kind: 'translator' };
    return { kind: 'motor' };
  }

  // Odd-grade: grade-1 + grade-3 (reflector · motor = glide reflection)
  if (!g0 && g1 && !g2 && g3) return { kind: 'reflector' };

  return { kind: 'mixed' };
};

// Normalize by the finite norm: ||A|| = sqrt(scalar_part(A · Ã)).
// Works for finite objects (lines, finite points, motors…).
// Returns val unchanged when the finite norm is zero (ideal objects).
export const normalizeMVFinit = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  const norm = Math.sqrt(finitNormSq(val));
  if (norm < 1e-10) return val;
  const result = new PGA(8);
  for (let i = 0; i < 8; i++) result[i] = val[i] / norm;
  return result;
};

// Normalize by the ideal norm: ||A||∞ = ||dual(A)||.
// Works for ideal objects (ideal points, ideal lines, pseudoscalar…).
// Returns val unchanged when the ideal norm is zero (finite objects that have no ideal part).
export const normalizeMVIdeal = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  const norm = Math.sqrt(finitNormSq(dualOp(val)));
  if (norm < 1e-10) return val;
  const result = new PGA(8);
  for (let i = 0; i < 8; i++) result[i] = val[i] / norm;
  return result;
};

// General norm: finite norm when non-zero, ideal norm otherwise.
export const normalizeMV = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  let normSq = finitNormSq(val);
  if (normSq < 1e-20) normSq = finitNormSq(dualOp(val));
  const norm = Math.sqrt(normSq);
  if (norm < 1e-10) return val;
  const result = new PGA(8);
  for (let i = 0; i < 8; i++) result[i] = val[i] / norm;
  return result;
};

// For a grade-1 line L: direction (ux,uy) and a canonical base point (bx,by).
// Line: c·e0 + a·e1 + b·e2  →  equation  a·x + b·y + c = 0
export const lineBaseAndDir = (L) => {
  if (!L || typeof L !== 'object' || typeof L.length !== 'number' || L.length < 8) return null;
  const a = L[2], b = L[3], c = L[1];   // e1, e2, e0 coefficients
  const len = Math.sqrt(a * a + b * b);
  if (len < 1e-10) return null;
  const ux = -b / len, uy = a / len;
  const bx = Math.abs(a) > 1e-10 ? -c / a : 0;
  const by = Math.abs(a) > 1e-10 ? 0 : -c / b;
  return { bx, by, ux, uy };
};
