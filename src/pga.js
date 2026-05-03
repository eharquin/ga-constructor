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

// For a grade-2 line L: direction (ux,uy) and a canonical base point (bx,by).
// Direction: dx=-L[10], dy=L[9] (from e23 and e13 components).
// Base point: intersection with y=0 plane, fallback to x=0 plane.
export const lineBaseAndDir = (L) => {
  if (!L) return null;
  const dx = -L[10], dy = L[9];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return null;

  const planeY0 = makePlane(0, 0, 1, 0); // y=0
  const planeX0 = makePlane(0, 1, 0, 0); // x=0
  const base =
    toEuclidean(PGA.Wedge(planeY0, L)) ||
    toEuclidean(PGA.Wedge(planeX0, L));
  if (!base) return null;

  return { bx: base.x, by: base.y, ux: dx / len, uy: dy / len };
};
