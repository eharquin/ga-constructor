import Algebra from 'ganja.js';

// PGA(2,0,1): metric (e0²=0, e1²=e2²=1)
// Basis order (ganja.js): 1, e0, e1, e2, e01, e02, e12, e012
//                        [0] [1] [2] [3]  [4]  [5]  [6]   [7]
export const PGA = Algebra(2, 0, 1);

// Grade-k presence, delegated to ganja: the (non-metric) length of the grade-k
// part. Lets the classifier ask "is grade k present?" without naming blade
// indices — the pattern that scales to higher-dimensional algebras (CGA).
const gradeMag = (mv, k) => mv.Grade(k).VLength;

// Euclidean 2D point at (x, y) as the grade-2 bivector  y·e01 − x·e02 + e12.
export const point2D = (x, y) => PGA.Bivector(y, -x, 1);

// 2D PGA line a·e1 + b·e2 + c·e0  →  equation a·x + b·y + c = 0.
export const line2D = (a, b, c) => PGA.Vector(c, a, b);

// Ideal point (point at infinity) — direction (vx, vy), weight 0.
export const idealPoint = (vx, vy) => PGA.Bivector(vy, -vx, 0);

// 2D PGA dual — right-complement convention (A ∧ Dual(A) = +I).
// Delegates to ganja's PGA.Dual so we share the same sign conventions as
// any other ganja-based computation.
//   e0 → +e12,  e1 → -e02,  e2 → +e01,
//   e01 → +e2,  e02 → -e1,  e12 → +e0,
//   1 ↔ e012
export const dualOp = (mv) => {
  if (!mv || typeof mv.length !== 'number' || mv.length < 8) return mv;
  return PGA.Dual(mv);
};

// Extract Euclidean (x,y) from a grade-2 PGA(2,0,1) point. Returns null for ideal points.
// Point: y·e01 - x·e02 + w·e12  →  x = -p[5]/p[6],  y = p[4]/p[6]
export const toEuclidean = (p) => {
  if (!p || typeof p.length !== 'number') return null;
  const w = p[6];   // e12 weight
  if (Math.abs(w) < 1e-10) return null;
  return { x: -p[5] / w, y: p[4] / w };
};

// Reverse (reversion) — grade-k blades get sign (-1)^(k(k-1)/2).
// Delegates to ganja's PGA.Reverse so we share the same conventions.
export const reverseOp = (mv) => {
  if (!mv || typeof mv.length !== 'number' || mv.length < 8) return mv;
  return PGA.Reverse(mv);
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

// Finite norm in PGA(2,0,1): √(scalar_part(A · Ã)) — delegates to ganja's PGA.Length.

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
  const g0 = gradeMag(val, 0) > eps;
  const g1 = gradeMag(val, 1) > eps;
  const g2 = gradeMag(val, 2) > eps;
  const g3 = gradeMag(val, 3) > eps;

  if (g0 && !g1 && !g2 && !g3) return { kind: 'scalar' };
  if (!g0 && !g1 && !g2 && !g3) return { kind: 'scalar' }; // zero multivector → zero scalar

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

  // Odd-grade: grade-1 + grade-3 (reflector · motor = glide reflection).
  // Use a relative threshold so floating-point noise in e012 from sandwich
  // products doesn't misclassify a transformed line as a reflector.
  if (!g0 && g1 && !g2 && g3) {
    const mag1 = Math.sqrt((val[1] || 0) ** 2 + (val[2] || 0) ** 2 + (val[3] || 0) ** 2);
    if (Math.abs(val[7]) < 1e-6 * (mag1 || 1)) {
      return { kind: (Math.abs(val[2]) < eps && Math.abs(val[3]) < eps) ? 'idealLine' : 'line' };
    }
    return { kind: 'reflector' };
  }

  return { kind: 'mixed' };
};

// Normalize by the finite norm: ||A|| = sqrt(scalar_part(A · Ã)).
// Works for finite objects (lines, finite points, motors…).
// Returns val unchanged when the finite norm is zero (ideal objects).
//
// Sign canonicalization: for a finite point (pure grade-2 with e12 ≠ 0), flip
// the overall sign so the weight e12 ends up positive. (P and −P represent the
// same Euclidean point; the convention picks the positive-weight representative.)
export const normalizeMVFinit = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  const norm = PGA.Length(val);
  if (norm < 1e-10) return val;
  const eps = 1e-10;
  const g0 = gradeMag(val, 0) > eps;
  const g1 = gradeMag(val, 1) > eps;
  const g3 = gradeMag(val, 3) > eps;
  const isFinitePoint = !g0 && !g1 && !g3 && Math.abs(val[6]) > eps;
  const sign = (isFinitePoint && val[6] < 0) ? -1 : 1;
  return val.Scale(sign / norm);
};

// Normalize by the ideal norm: ||A||∞ = ||dual(A)||.
// Works for ideal objects (ideal points, ideal lines, pseudoscalar…) and finite
// lines (where the ideal norm = |c|, the offset from origin).
// Returns val unchanged when the ideal norm is zero (finite objects with no ideal part).
//
// Sign canonicalization: for a line (grade-1 with non-zero e0), flip the overall
// sign so the offset coefficient e0 ends up positive (i.e. = 1 after normalization).
// L and −L represent the same line; this picks the canonical e0 = +1 form.
export const normalizeMVIdeal = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  const norm = PGA.Length(PGA.Dual(val));
  if (norm < 1e-10) return val;
  const eps = 1e-10;
  const g0 = gradeMag(val, 0) > eps;
  const g2 = gradeMag(val, 2) > eps;
  const g3 = gradeMag(val, 3) > eps;
  const isLineLike = !g0 && !g2 && !g3 && Math.abs(val[1]) > eps;
  const sign = (isLineLike && val[1] < 0) ? -1 : 1;
  return val.Scale(sign / norm);
};

// General norm: finite norm when non-zero, ideal norm otherwise.
export const normalizeMV = (val) => {
  if (!val || typeof val.length !== 'number' || val.length < 8) return val;
  let norm = PGA.Length(val);
  if (norm < 1e-10) norm = PGA.Length(PGA.Dual(val));
  if (norm < 1e-10) return val;
  return val.Scale(1 / norm);
};

// Weight of an object: the scalar factor relative to its "unit" representative.
// Used to drive visual thickness — a point/line with weight w renders w× thicker.
//
//   Finite point  (e12 ≠ 0):  norm  = |e12|             — `5*e12`     → 5
//   Ideal point   (e12 = 0):  inorm = √(e01² + e02²)    — `5*e01`     → 5
//   Line thru origin (e0 = 0): norm  = √(e1² + e2²)      — `5*(e1+e2)` → 5√2
//   Line w/ offset   (e0 ≠ 0): inorm = |c| via Dual      — `5*(e0+e1+e2)` → 5
//   Ideal line   (only e0):   inorm = |c| via Dual      — `5*e0`      → 5
//   Vector `{vx, vy}`:        Euclidean magnitude        — `vector(3,4)` → 5
export const objectWeight = (val) => {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val);
  if (typeof val === 'object' && 'vx' in val)
    return Math.sqrt(val.vx ** 2 + val.vy ** 2);
  if (typeof val.length !== 'number' || val.length < 8) return 1;
  const eps = 1e-10;
  const isGrade1 = gradeMag(val, 1) > eps;
  const isGrade2 = gradeMag(val, 2) > eps;
  const hasE0  = Math.abs(val[1]) > eps;  // ideal grade-1 → measure via dual
  const hasE12 = Math.abs(val[6]) > eps;  // finite grade-2 → measure directly
  if (isGrade1 && !isGrade2)
    return hasE0 ? PGA.Length(PGA.Dual(val)) : PGA.Length(val);
  if (isGrade2 && !isGrade1)
    return hasE12 ? PGA.Length(val) : PGA.Length(PGA.Dual(val));
  return PGA.Length(val) || 1;
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
