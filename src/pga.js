import Algebra from 'ganja.js';

// PGA(3,0,1): metric (e0²=0, e1²=e2²=e3²=1)
// Basis order (ganja.js): 1, e0,e1,e2,e3, e01,e02,e03,e12,e13,e23, e012,e013,e023,e123, e0123
//                        [0] [1][2][3][4]  [5] [6] [7] [8] [9][10]   [11] [12] [13] [14]  [15]
export const PGA = Algebra(3, 0, 1);

// Euclidean 2D point at (x, y) in the z=0 plane.
// Grade-3 trivector: x*e032 + y*e013 + w*e123 = -x*e023 + y*e013 + w*e123
export const point2D = (x, y) => {
  const p = new PGA(16);
  p[12] = y;   // e013
  p[13] = -x;  // e023
  p[14] = 1;   // e123 (weight)
  return p;
};

// Ideal point (point at infinity) — represents a direction (vx, vy). Weight = 0.
export const idealPoint = (vx, vy) => {
  const p = new PGA(16);
  p[12] = vy;   // e013
  p[13] = -vx;  // e023
  // p[14] = 0  (e123, weight = 0 → ideal)
  return p;
};

// 2D PGA dual (complement w.r.t. e012 pseudoscalar).
// For elements in the {e0,e1,e2} subspace: lexicographic complement with positive signs
//   grade-1 ↔ grade-2 :  e0↔e12,  e1↔e02,  e2↔e01
//   grade-0 ↔ grade-3 :  1↔e012
// For elements involving e3 (grade-3 points e013,e023,e123, etc.): falls back to PGA.Dual.
export const dualOp = (mv) => {
  const result = new PGA(16);
  // 2D subspace complement
  result[8]  = mv[1];   // e0  → e12
  result[6]  = mv[2];   // e1  → e02
  result[5]  = mv[3];   // e2  → e01
  result[1]  = mv[8];   // e12 → e0
  result[2]  = mv[6];   // e02 → e1
  result[3]  = mv[5];   // e01 → e2
  result[0]  = mv[11];  // e012 → scalar
  result[11] = mv[0];   // scalar → e012
  // e3-involving components: use PGA.Dual
  const hasE3 = mv[4]||mv[7]||mv[9]||mv[10]||mv[12]||mv[13]||mv[14]||mv[15];
  if (hasE3) {
    const tmp = new PGA(16);
    for (const i of [4,7,9,10,12,13,14,15]) tmp[i] = mv[i];
    const d = PGA.Dual(tmp);
    for (let i = 0; i < 16; i++) result[i] += d[i];
  }
  return result;
};

// Extract Euclidean (x,y) from a grade-2 2D-PGA point element.
// Convention: W*e12 + y*e01 + x*e02 → (x/W, y/W).
// Used for rendering the result of dualOp on grade-1 lines.
// Returns null for ideal (W=0) or grade-2 line elements (with e13/e23 direction).
export const toEuclidean2D = (mv) => {
  if (!mv) return null;
  const w = mv[8]; // e12 as weight
  if (Math.abs(w) < 1e-10) return null;
  if (Math.abs(mv[9]) > 1e-10 || Math.abs(mv[10]) > 1e-10) return null; // is a line, not a point
  return { x: mv[6] / w, y: mv[5] / w };
};

// Grade-1 plane element
export const makePlane = (e0, e1, e2, e3) => {
  const p = new PGA(16);
  p[1] = e0; p[2] = e1; p[3] = e2; p[4] = e3;
  return p;
};

// Extract Euclidean (x,y) from a grade-3 PGA point. Returns null for ideal points.
export const toEuclidean = (p) => {
  if (!p) return null;
  const w = p[14];
  if (Math.abs(w) < 1e-10) return null;
  return { x: -p[13] / w, y: p[12] / w };
};

// For a grade-2 or grade-1 line L: direction (ux,uy) and a canonical base point (bx,by).
//
// Grade-2 bivector: direction from e23 (L[10]) and e13 (L[9]) components.
// Grade-1 vector:  a·e0 + b·e1 + c·e2  →  line  b·x + c·y + a = 0.
export const lineBaseAndDir = (L) => {
  if (!L) return null;

  // Grade-2 path
  const dx = -L[10], dy = L[9];
  const len2 = Math.sqrt(dx * dx + dy * dy);
  if (len2 >= 1e-10) {
    const planeY0 = makePlane(0, 0, 1, 0); // y=0
    const planeX0 = makePlane(0, 1, 0, 0); // x=0
    const base =
      toEuclidean(PGA.Wedge(planeY0, L)) ||
      toEuclidean(PGA.Wedge(planeX0, L));
    if (!base) return null;
    return { bx: base.x, by: base.y, ux: dx / len2, uy: dy / len2 };
  }

  // Grade-1 path: a·e0 + b·e1 + c·e2  (indices 1, 2, 3)
  const a = L[1], b = L[2], c = L[3];
  const len1 = Math.sqrt(b * b + c * c);
  if (len1 >= 1e-10) {
    const ux = -c / len1, uy = b / len1;
    const bx = Math.abs(b) > 1e-10 ? -a / b : 0;
    const by = Math.abs(b) > 1e-10 ? 0 : -a / c;
    return { bx, by, ux, uy };
  }

  return null;
};
