// CCGA embeddings & extraction — the Veronese point map, the named conic
// constructors (all returning the grade-7 OPNS form), and the closed-form readers
// that recover Euclidean coordinates / radii from grade-1 points and flat points.

import {
  CCGA, ARRAY_SIZE, EPS, isMV, zeroMV, einf, scalarSquare,
  FP_B0, FP_BX, FP_BY, FP_I0, FP_IX, FP_IY,
} from './algebra.js';

// ─── Point embedding ─────────────────────────────────────────────────────────
// Built by direct component writes — NOT ganja products. Expanding
//   p = eo + x·e1 + y·e2 + ½x²·einf1 + ½y²·einf2 + xy·einf3
// in the orthogonal basis (eo_i = e₊+e₋,  einf_i = (e₋−e₊)/2):
//   [1]=x [2]=y [3]=1−x²/4 [4]=1−y²/4 [5]=−xy/2 [6]=1+x²/4 [7]=1+y²/4 [8]=xy/2.
// A round point subtracts ½r²·einf: [3],[4] += r²/8 ; [6],[7] −= r²/8.
// r>0 → real round point (p²=+r²); r<0 → imaginary (r·|r| keeps the sign of r²).
export function point2D(x, y, r = 0) {
  const p = zeroMV();
  const ax = (x * x) / 4, ay = (y * y) / 4, axy = (x * y) / 2;
  p[1] = x;      p[2] = y;
  p[3] = 1 - ax; p[4] = 1 - ay; p[5] = -axy;
  p[6] = 1 + ax; p[7] = 1 + ay; p[8] = axy;
  if (r) {
    const rr = (r * Math.abs(r)) / 8;
    p[3] += rr; p[4] += rr; p[6] -= rr; p[7] -= rr;
  }
  return p;
}

// CCGA's free `vector(x, y)` — the natural ideal point of CCGA: the Veronese point at
// infinity. Same embedding as `infinityPoint2D` (the single source of truth).
export function vector2D(x, y) {
  return infinityPoint2D(x, y);
}

// Ideal point (Veronese limit) in direction (vx, vy) — the purely-quadratic point
// embedding: vector2D minus the linear e1/e2 part.
//   vinf = ½vx²·einf1 + ½vy²·einf2 + vx·vy·einf3 ± r²·einf   (no eo, no e1/e2).
export function infinityPoint2D(vx, vy, r = 0) {
  const v = zeroMV();
  const ax = (vx * vx) / 4, ay = (vy * vy) / 4, axy = (vx * vy) / 2;
  v[3] = -ax;  v[4] = -ay;  v[5] = -axy;
  v[6] =  ax;  v[7] =  ay;  v[8] =  axy;
  if (r) {
    const s = r * Math.abs(r);                       // ±r²
    for (let i = 0; i < ARRAY_SIZE; i++) v[i] += s * einf[i];
    v.rSq = s;
  }
  // Carry the signed source direction so the canvas arrow follows the cursor freely
  // on drag (the purely quadratic form can't recover the overall sign of (vx, vy)).
  v.dir = { vx, vy };
  return v;
}

// ─── Named conic constructors ──────────────────────────────────────────────
// A general conic Ax²+By²+Cxy+Dx+Ey+F=0 is the grade-1 IPNS vector (cheat sheet §3)
//   s = -2A·eo1 - 2B·eo2 - C·eo3 + D·e1 + E·e2 - (F/2)(einf1+einf2).
// Written Mul-free by expanding the null basis into orthogonal ganja slots:
//   [1]=D [2]=E  [3]=-2A+F/4 [4]=-2B+F/4 [5]=-C  [6]=-2A-F/4 [7]=-2B-F/4 [8]=-C.
export function conicIPNS(A, B, C, D, E, F) {
  const s = zeroMV();
  const q = F / 4;
  s[1] = D;           s[2] = E;
  s[3] = -2 * A + q;  s[4] = -2 * B + q;  s[5] = -C;
  s[6] = -2 * A - q;  s[7] = -2 * B - q;  s[8] = -C;
  return s;
}

// Every named conic returns the grade-7 OPNS form — the dual of the grade-1 IPNS
// vector — so it renders via SvgConic. (`CCGA.Dual`, not the shadowed local `A`,
// since ellipse/hyperbola/tilted bind `A` to a coeff.)
const opnsConic = (cA, cB, cC, cD, cE, cF) => CCGA.Dual(conicIPNS(cA, cB, cC, cD, cE, cF));

export const circleConic = (cx, cy, r) =>
  opnsConic(1, 1, 0, -2 * cx, -2 * cy, cx * cx + cy * cy - r * r);

export function ellipseConic(a, b, cx = 0, cy = 0) {
  const A = 1 / (a * a), B = 1 / (b * b);
  return opnsConic(A, B, 0, -2 * cx * A, -2 * cy * B, cx * cx * A + cy * cy * B - 1);
}

export function hyperbolaConic(a, b, cx = 0, cy = 0) {
  const A = 1 / (a * a), B = -1 / (b * b);
  return opnsConic(A, B, 0, -2 * cx * A, -2 * cy * B, (cx * cx) / (a * a) - (cy * cy) / (b * b) - 1);
}

// Parabola (y − cy)² = 4p (x − cx) — base y²=4px translated to the vertex (cx,cy).
export const parabolaConic = (p, cx = 0, cy = 0) =>
  opnsConic(0, 1, 0, -4 * p, -2 * cy, cy * cy + 4 * p * cx);

export function tiltedEllipseConic(a, b, theta, cx = 0, cy = 0) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const A = (c * c) / (a * a) + (s * s) / (b * b);
  const B = (s * s) / (a * a) + (c * c) / (b * b);
  const C = 2 * s * c * (1 / (a * a) - 1 / (b * b));
  const D = -2 * (A * cx + (C / 2) * cy);
  const E = -2 * (B * cy + (C / 2) * cx);
  const F = A * cx * cx + B * cy * cy + C * cx * cy - 1;
  return opnsConic(A, B, C, D, E, F);
}

// A line is the degenerate conic A=B=C=0; its grade-7 OPNS dual classifies as a
// conic 'line' and renders via SvgLine.
export const lineConic = (nx, ny, d = 0) => opnsConic(0, 0, 0, nx, ny, d);

// General conic from raw (A..F) — grade-7 OPNS like the rest.
export const conicGeneral = (cA, cB, cC, cD, cE, cF) => opnsConic(cA, cB, cC, cD, cE, cF);

// ─── Euclidean / direction readers ───────────────────────────────────────────
// Euclidean direction of an ideal (origin-free) grade-1 vector — its e1/e2 part.
export function toIdealVector(v) {
  if (!isMV(v)) return null;
  return { vx: v[1] || 0, vy: v[2] || 0 };
}

// Direction (vx, vy) of a true point at infinity (Veronese limit). Defined up to
// overall sign; we return vx ≥ 0.
export function infinityDir(v) {
  const c1 = (v[6] || 0) - (v[3] || 0), c2 = (v[7] || 0) - (v[4] || 0), c3 = (v[8] || 0) - (v[5] || 0);
  const vx = Math.sqrt(Math.max(0, 2 * c1));
  let vy = Math.sqrt(Math.max(0, 2 * c2));
  if (c3 < 0) vy = -vy;                                   // sign so vx·vy ≈ einf3 coeff
  return { vx, vy };
}

// Origin weight of a grade-1 point: w = −(p·einf) = (p3+p4+p6+p7)/4 (closed form).
export function einfWeight(p) { return ((p[3] || 0) + (p[4] || 0) + (p[6] || 0) + (p[7] || 0)) / 4; }

// Euclidean (x, y) of the grade-1 multivector G + s·v, reading only grade-1 slots.
export function euclOfSum(G, v, s) {
  const w = ((G[3] || 0) + s * (v[3] || 0) + (G[4] || 0) + s * (v[4] || 0)
           + (G[6] || 0) + s * (v[6] || 0) + (G[7] || 0) + s * (v[7] || 0)) / 4;
  if (Math.abs(w) < 1e-10) return null;
  return { x: ((G[1] || 0) + s * (v[1] || 0)) / w, y: ((G[2] || 0) + s * (v[2] || 0)) / w };
}

// Euclidean (x, y) of a grade-1 point (normalize by the origin weight).
export function toEuclidean(p) {
  if (!isMV(p)) return null;
  const w = einfWeight(p);
  if (Math.abs(w) < 1e-10) return null;
  return { x: (p[1] || 0) / w, y: (p[2] || 0) / w };
}

// (x, y, rSq) from a grade-1 point. rSq is the signed radius² = p²/(p·einf)² —
// denominator SQUARED so it never flips sign under negation/scaling.
export function extractRoundPoint(p) {
  if (!isMV(p)) return null;
  const w = einfWeight(p);                                // = −(p·einf)
  if (Math.abs(w) < EPS) return null;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const rSq = scalarSquare(p) / (w * w);                 // = p²/(p·einf)²  → sign(r²)=sign(p²)
  return { x, y, rSq };
}

// Flat point P = p∧Iinf — recover (x,y). Mul-free: P = λ·(B0 + x·Bx + y·By).
export function extractFlatPoint(P) {
  if (!isMV(P)) return null;
  const lam = (P[FP_I0] || 0) / FP_B0[FP_I0];
  if (Math.abs(lam) < EPS) return null;                  // ideal flat point (no origin weight)
  const x = ((P[FP_IX] || 0) / FP_BX[FP_IX]) / lam;
  const y = ((P[FP_IY] || 0) / FP_BY[FP_IY]) / lam;
  return { x, y };
}
