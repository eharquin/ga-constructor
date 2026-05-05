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
  if (!p) return null;
  const w = p[6];   // e12 weight
  if (Math.abs(w) < 1e-10) return null;
  return { x: -p[5] / w, y: p[4] / w };
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
