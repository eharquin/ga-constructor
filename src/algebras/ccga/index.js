// CCGA — Conic Conformal Geometric Algebra in ℝ(5,3).
// 8 generators, 256 blades. Embeds the 2D plane via a Veronese (quadratic) map
// so that every conic — circle, ellipse, hyperbola, parabola, line — is a single
// algebraic object. This adapter is being built incrementally; this first slice
// covers the point embedding and round points (a point carrying a radius).
//
// ganja note: Algebra(5,3) defaults to a *graded* representation that breaks the
// flat-array contract every adapter relies on and crashes Dual. We force the flat
// 256-element representation with `graded:false`.
//
// Orthogonal (diagonal) basis — ganja indices 1..8:
//   e1, e2          → Euclidean directions          (square +1)
//   e3, e4, e5      → e₊₁, e₊₂, e₊₃                  (square +1)
//   e6, e7, e8      → e₋₁, e₋₂, e₋₃                  (square −1)
//
// Null working basis (combinations, exposed as mvConsts):
//   eo_i   = e₊ᵢ + e₋ᵢ        einf_i = (e₋ᵢ − e₊ᵢ)/2     (eo_i·einf_i = −1)
//   eo = eo1+eo2   einf = (einf1+einf2)/2              (eo·einf = −1)
//
// Point embedding (Veronese map):
//   p(x,y) = eo + x·e1 + y·e2 + ½x²·einf1 + ½y²·einf2 + xy·einf3
//   r=0 → null point (p²=0); r≠0 → round point (p²=+r²), drop ½r²·einf.

import Algebra from 'ganja.js';

export const ID    = 'ccga';
export const LABEL = 'CCGA';

export const CCGA = Algebra({ p: 5, q: 3, graded: false });
const A = CCGA;

export const ARRAY_SIZE = 256;
const EPS = 1e-10;

// ─── Basis metadata (generated from ganja's canonical ordering) ──────────────
const BASIS = A.describe().basis;                      // ['1','e1',…,'e12345678']
export const BLADE_NAMES = BASIS;
export const BLADE_INDEX = Object.fromEntries(BASIS.map((n, i) => [n, i]));
// Grade of each index — generators are single-digit (1..8), so grade = len − 1.
const GRADES = BASIS.map((n) => (n === '1' ? 0 : n.length - 1));
// Longest-first alternation so the parser's greedy regex never shortcuts on a prefix.
export const BLADE_PATTERN = BASIS.filter((n) => n !== '1')
  .sort((a, b) => b.length - a.length)
  .join('|');

// Parse any permutation of CCGA basis indices (e21 = −e12, …). Digits 1..8.
export function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some((d) => isNaN(d) || d < 1 || d > 8)) return null;
  if (new Set(digits).size !== digits.length) return null;
  let inv = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j < digits.length; j++)
      if (digits[i] > digits[j]) inv++;
  const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
  const index = BLADE_INDEX[canonical];
  return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
}

// ─── MV helpers ──────────────────────────────────────────────────────────────
const isMV = (v) => v && typeof v.length === 'number' && v.length >= ARRAY_SIZE;
function zeroMV() { const v = new A(); v.fill(0); return v; }
function bvec(i)  { const v = zeroMV(); v[i] = 1; return v; }
const scaleMV = (s, v) => A.Mul(s, v);
const addMV   = (...xs) => xs.reduce((a, b) => A.Add(a, b));
const subMV   = (a, b) => A.Sub(a, b);

// ─── Null basis + special blades (built once via MV arithmetic) ──────────────
const e1 = bvec(1), e2 = bvec(2);
const ep1 = bvec(3), ep2 = bvec(4), ep3 = bvec(5);
const em1 = bvec(6), em2 = bvec(7), em3 = bvec(8);

const eo1 = addMV(ep1, em1), eo2 = addMV(ep2, em2), eo3 = addMV(ep3, em3);
const einf1 = scaleMV(0.5, subMV(em1, ep1));
const einf2 = scaleMV(0.5, subMV(em2, ep2));
const einf3 = scaleMV(0.5, subMV(em3, ep3));

const eo      = addMV(eo1, eo2);
const einf    = scaleMV(0.5, addMV(einf1, einf2));
const eob   = subMV(eo1, eo2);
const einfb = scaleMV(0.5, subMV(einf1, einf2));

const Iod   = A.Wedge(eob, eo3);                       // grade-2 origin gauge
const Iinfd = A.Wedge(subMV(einf1, einf2), einf3);       // grade-2 infinity gauge
const Io    = A.Wedge(A.Wedge(eo1, eo2), eo3);           // grade-3
const Iinf  = A.Wedge(A.Wedge(einf1, einf2), einf3);     // grade-3
const Ieps  = A.Wedge(e1, e2);                           // Euclidean pseudoscalar
const I     = A.Wedge(A.Wedge(Ieps, Iinf), Io);          // grade-8 pseudoscalar
const I2    = A.Mul(I, I)[0] || -1;                      // = −1
const Iinv  = scaleMV(1 / I2, I);                        // = −I

// Flat-point reference blades. A flat point p∧Iinf collapses (the einf parts of p
// wedge to 0 against Iinf) to  eo∧Iinf + x·(e1∧Iinf) + y·(e2∧Iinf), so (x,y) read
// off by ratio — Bx/By are the only ones carrying e1/e2, giving unique signature indices.
const FP_B0 = A.Wedge(eo, Iinf);
const FP_BX = A.Wedge(e1, Iinf);
const FP_BY = A.Wedge(e2, Iinf);
const argmaxAbs = (mv) => {
  let bi = 0, bv = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) { const a = Math.abs(mv[i] || 0); if (a > bv) { bv = a; bi = i; } }
  return bi;
};
const FP_I0 = argmaxAbs(FP_B0), FP_IX = argmaxAbs(FP_BX), FP_IY = argmaxAbs(FP_BY);

// ─── Point embedding ─────────────────────────────────────────────────────────
// Built by direct component writes — NOT ganja products. The 256-dim geometric
// product is O(256²) ≈ 2 ms each regardless of sparsity, far too slow for the
// drag hot path; the embedding has a closed form, so we write the 8 grade-1
// coefficients directly. Expanding
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

// Ideal round point ("vector"): the point embedding with the origin part (eo = eo1+eo2)
// dropped — grade-1 with zero origin weight, so it classifies as an ideal point and
// renders as an arrow from the origin to (x, y). r (optional) lives in the einf part.
// Same expansion as point2D minus the eo "+1"s on [3],[4],[6],[7].
export function vector2D(x, y, r = 0) {
  const v = zeroMV();
  const ax = (x * x) / 4, ay = (y * y) / 4, axy = (x * y) / 2;
  v[1] = x;    v[2] = y;
  v[3] = -ax;  v[4] = -ay;  v[5] = -axy;
  v[6] =  ax;  v[7] =  ay;  v[8] =  axy;
  if (r) { const rr = (r * Math.abs(r)) / 8; v[3] += rr; v[4] += rr; v[6] -= rr; v[7] -= rr; }
  return v;
}

// True point at infinity (Veronese limit) in direction (vx, vy) — the constructor
// for the purely-quadratic ideal point: vector2D minus the linear e1/e2 part.
//   vinf = ½vx²·einf1 + ½vy²·einf2 + vx·vy·einf3   (no eo, no e1/e2).
export function infinityPoint2D(vx, vy) {
  const v = zeroMV();
  const ax = (vx * vx) / 4, ay = (vy * vy) / 4, axy = (vx * vy) / 2;
  v[3] = -ax;  v[4] = -ay;  v[5] = -axy;
  v[6] =  ax;  v[7] =  ay;  v[8] =  axy;
  // Carry the signed source direction so the canvas arrow follows the cursor
  // freely on drag. The embedding is purely quadratic (vx², vy², vx·vy), so the
  // overall sign of (vx, vy) can't be recovered from v alone (infinityDir picks
  // the vx≥0 representative); keeping the original (vx, vy) here renders the tip
  // exactly where the user placed it. Derived MVs (products, sandwiches) drop
  // this and fall back to infinityDir.
  v.dir = { vx, vy };
  return v;
}

// ─── Named conic constructors ──────────────────────────────────────────────
// A general conic Ax²+By²+Cxy+Dx+Ey+F=0 is the grade-1 IPNS vector (cheat sheet §3)
//   s = -2A·eo1 - 2B·eo2 - C·eo3 + D·e1 + E·e2 - (F/2)(einf1+einf2).
// Written Mul-free by expanding the null basis into orthogonal ganja slots
// (eo_i = e₊+e₋, einf_i = (e₋−e₊)/2 — same expansion as point2D):
//   [1]=D [2]=E  [3]=-2A+F/4 [4]=-2B+F/4 [5]=-C  [6]=-2A-F/4 [7]=-2B-F/4 [8]=-C.
// (Inverse `coeffsFromGrade1` recovers (A..F) from these; the two round-trip.)
export function conicIPNS(A, B, C, D, E, F) {
  const s = zeroMV();
  const q = F / 4;
  s[1] = D;           s[2] = E;
  s[3] = -2 * A + q;  s[4] = -2 * B + q;  s[5] = -C;
  s[6] = -2 * A - q;  s[7] = -2 * B - q;  s[8] = -C;
  return s;
}

// Friendly constructors mapping shape params → (A..F) (OBJECTS.md §4). A circle's
// IPNS vector is a round point and renders via the roundPoint path; ellipse /
// hyperbola / parabola / tilted ellipse classify as `conic` and draw via SvgConic.
export const circleConic = (cx, cy, r) =>
  conicIPNS(1, 1, 0, -2 * cx, -2 * cy, cx * cx + cy * cy - r * r);

export function ellipseConic(a, b, cx = 0, cy = 0) {
  const A = 1 / (a * a), B = 1 / (b * b);
  return conicIPNS(A, B, 0, -2 * cx * A, -2 * cy * B, cx * cx * A + cy * cy * B - 1);
}

export function hyperbolaConic(a, b, cx = 0, cy = 0) {
  const A = 1 / (a * a), B = -1 / (b * b);
  return conicIPNS(A, B, 0, -2 * cx * A, -2 * cy * B, (cx * cx) / (a * a) - (cy * cy) / (b * b) - 1);
}

// Parabola (y − cy)² = 4p (x − cx) — base y²=4px translated to the vertex (cx,cy).
export const parabolaConic = (p, cx = 0, cy = 0) =>
  conicIPNS(0, 1, 0, -4 * p, -2 * cy, cy * cy + 4 * p * cx);

export function tiltedEllipseConic(a, b, theta, cx = 0, cy = 0) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const A = (c * c) / (a * a) + (s * s) / (b * b);
  const B = (s * s) / (a * a) + (c * c) / (b * b);
  const C = 2 * s * c * (1 / (a * a) - 1 / (b * b));
  const D = -2 * (A * cx + (C / 2) * cy);
  const E = -2 * (B * cy + (C / 2) * cx);
  const F = A * cx * cx + B * cy * cy + C * cx * cy - 1;
  return conicIPNS(A, B, C, D, E, F);
}

// A line is the degenerate conic A=B=C=0; its grade-1 IPNS has zero einf-weight,
// so the classifier reads it as an ideal-point arrow. Return the grade-7 OPNS
// dual, which classifies as a conic 'line' and renders via SvgLine.
export const lineConic = (nx, ny, d = 0) => A.Dual(conicIPNS(0, 0, 0, nx, ny, d));

// General conic from raw (A..F). A degenerate A=B=C≈0 (a line) is dualized to
// grade-7 so it still renders, matching lineConic.
export function conicGeneral(cA, cB, cC, cD, cE, cF) {
  const s = conicIPNS(cA, cB, cC, cD, cE, cF);
  const scale = Math.abs(cA) + Math.abs(cB) + Math.abs(cC) + Math.abs(cD) + Math.abs(cE) + Math.abs(cF) + 1;
  if (Math.abs(cA) < 1e-9 * scale && Math.abs(cB) < 1e-9 * scale && Math.abs(cC) < 1e-9 * scale)
    return A.Dual(s);
  return s;
}

// Euclidean direction of an ideal (origin-free) grade-1 vector — its e1/e2 part.
export function toIdealVector(v) {
  if (!isMV(v)) return null;
  return { vx: v[1] || 0, vy: v[2] || 0 };
}

// Direction (vx, vy) of a true point at infinity (Veronese limit)
//   vinf = ½vx²·einf1 + ½vy²·einf2 + vx·vy·einf3   (no eo, no e1/e2).
// Null-basis einf coeffs: einf1 = v6−v3 = ½vx², einf2 = v7−v4 = ½vy², einf3 = v8−v5 = vx·vy.
// Direction is defined up to overall sign; we return vx ≥ 0.
function infinityDir(v) {
  const c1 = (v[6] || 0) - (v[3] || 0), c2 = (v[7] || 0) - (v[4] || 0), c3 = (v[8] || 0) - (v[5] || 0);
  const vx = Math.sqrt(Math.max(0, 2 * c1));
  let vy = Math.sqrt(Math.max(0, 2 * c2));
  if (c3 < 0) vy = -vy;                                   // sign so vx·vy ≈ einf3 coeff
  return { vx, vy };
}

// Origin weight of a grade-1 point: w = −(p·einf) = (p3+p4+p6+p7)/4  (closed form,
// no product — einf = (e6−e3+e7−e4)/4 and the metric is +1 on e3,e4 / −1 on e6,e7).
function einfWeight(p) { return ((p[3] || 0) + (p[4] || 0) + (p[6] || 0) + (p[7] || 0)) / 4; }

// Square of each basis blade as a scalar: e_S² = (−1)^{k(k−1)/2} · Π metric(dᵢ)
// (generators e1..e5 square +1, e6..e8 square −1). Lets us read off the scalar part
// of any MV's geometric square Mul-free: ⟨v²⟩₀ = Σ v[i]²·BLADE_SQUARE[i] (cross terms
// of distinct same-grade blades have no scalar part).
const genMetric = (d) => (d <= 5 ? 1 : -1);
const BLADE_SQUARE = BLADE_NAMES.map((name) => {
  if (name === '1') return 1;
  const digits = name.slice(1).split('').map(Number);
  const k = digits.length;
  let s = ((k * (k - 1) / 2) % 2) ? -1 : 1;
  for (const d of digits) s *= genMetric(d);
  return s;
});
function scalarSquare(mv) {
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) { const c = mv[i]; if (c) s += c * c * BLADE_SQUARE[i]; }
  return s;
}

// Euclidean (x, y) of the grade-1 multivector G + s·v, reading only grade-1 slots
// (origin weight w = (·3+·4+·6+·7)/4). Used to split a dipole without extra products.
function euclOfSum(G, v, s) {
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

// (x, y, rSq) from a grade-1 point. rSq is the signed radius²: ≈0 → null point,
// >0 → real round point, <0 → imaginary. Reality = sign(p²) is scale-invariant
// (p→λp gives λ²p²), so the invariant radius is r² = p²/(p·einf)² — denominator
// SQUARED (w², not w·|w|), so it never flips sign under negation/scaling.
function extractRoundPoint(p) {
  if (!isMV(p)) return null;
  const w = einfWeight(p);                                // = −(p·einf)
  if (Math.abs(w) < EPS) return null;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const rSq = scalarSquare(p) / (w * w);                 // = p²/(p·einf)²  → sign(r²)=sign(p²)
  return { x, y, rSq };
}

// Flat point P = p∧Iinf — recover (x,y). Mul-free: P = λ·(B0 + x·Bx + y·By), and
// only Bx/By carry e1/e2, so each ratio is a direct component read.
function extractFlatPoint(P) {
  if (!isMV(P)) return null;
  const lam = (P[FP_I0] || 0) / FP_B0[FP_I0];
  if (Math.abs(lam) < EPS) return null;                  // ideal flat point (no origin weight)
  const x = ((P[FP_IX] || 0) / FP_BX[FP_IX]) / lam;
  const y = ((P[FP_IY] || 0) / FP_BY[FP_IY]) / lam;
  return { x, y };
}

// Dipole pp = p1∧p2 — split into its two points (point_pairs.ipynb `recover`):
//   m = −(einf⌋pp),  inv = m/(m·m),  P± = normalize((pp ± √(pp²))·inv).
// pp² > 0 → two real points; < 0 → imaginary (real centre, no real points);
// = 0 → tangent (coincident). Returns Euclidean coords + midpoint + half-chord r.
function extractDipole(pp) {
  if (!isMV(pp)) return null;
  const ppSq = scalarSquare(pp);                         // Mul-free
  const prod = A.Mul(einf, pp);                          // Mul #1 — grade-1 ⊕ grade-3
  const m = zeroMV();
  for (let i = 1; i <= 8; i++) m[i] = -(prod[i] || 0);   // m = −(einf⌋pp), grade-1
  const mSq = scalarSquare(m);
  if (Math.abs(mSq) < 1e-10) return null;                // ideal / degenerate pair
  const inv = zeroMV();
  for (let i = 1; i <= 8; i++) inv[i] = m[i] / mSq;       // m⁻¹
  // (pp ± √(pp²))·inv = (pp·inv) ± √(pp²)·inv, so one product covers all three reads.
  const G = A.Mul(pp, inv);                              // Mul #2
  const center = euclOfSum(G, inv, 0);
  if (!center) return null;
  const r = Math.sqrt(Math.abs(ppSq / mSq));
  if (ppSq > 1e-9) {
    const s = Math.sqrt(ppSq);
    const P1 = euclOfSum(G, inv, s);
    const P2 = euclOfSum(G, inv, -s);
    if (!P1 || !P2) return null;
    return { p1: P1, p2: P2, cx: center.x, cy: center.y, r, imaginary: false };
  }
  // imaginary / tangent: centre is real, "points" lie along m's direction.
  const mxy = Math.hypot(m[1] || 0, m[2] || 0);
  if (mxy < 1e-10) return null;
  const nx = (m[1] || 0) / mxy, ny = (m[2] || 0) / mxy;
  return {
    p1: { x: center.x + r * nx, y: center.y + r * ny },
    p2: { x: center.x - r * nx, y: center.y - r * ny },
    cx: center.x, cy: center.y, r, imaginary: true,
  };
}

// ─── Conics ──────────────────────────────────────────────────────────────────
// A grade-7 OPNS conic C = Iod ∧ p1 ∧ … ∧ p5 dualizes to a grade-1 IPNS vector
// whose orthogonal coefficients map directly to the implicit conic
// Ax²+By²+Cxy+Dx+Ey+F=0  (classify.py:ipns_to_coeffs). Dual via explicit Mul(C, Iinv)
// — the notebook's fixed convention — not Algebra.Dual.
function coeffsFromGrade1(s) {
  const c1 = s[1]||0, c2 = s[2]||0, c3 = s[3]||0, c4 = s[4]||0,
        c5 = s[5]||0, c6 = s[6]||0, c7 = s[7]||0, c8 = s[8]||0;
  return {
    A: -(c3 + c6) / 4, B: -(c4 + c7) / 4, C: -(c5 + c8) / 2,
    D: c1, E: c2, F: (c3 - c6) + (c4 - c7),
  };
}

// Coefficients from either conic form: a grade-1 vector is already IPNS; a grade-7
// OPNS conic is dualized first via Mul(·, Iinv).
function conicCoeffs(val) {
  const s = onlyGrade(gradeFlags(val), 1) ? val : A.Mul(val, Iinv);
  return coeffsFromGrade1(s);
}

// Reduce (A..F) to a drawable form. Subtype from the discriminant Δ=C²−4AB; for a
// central conic, centre + rotated principal semi-axes (rx along the θ axis); for a
// parabola/line the raw coefficients are passed through for sampling.
function conicGeometry(co) {
  const { A: cA, B: cB, C: cC, D: cD, E: cE, F: cF } = co;
  const scale = Math.abs(cA) + Math.abs(cB) + Math.abs(cC) + Math.abs(cD) + Math.abs(cE) + Math.abs(cF) + 1;
  const tol = 1e-7 * scale;
  if (Math.abs(cA) < tol && Math.abs(cB) < tol && Math.abs(cC) < tol)
    return { subtype: 'line', D: cD, E: cE, F: cF };
  const disc = cC * cC - 4 * cA * cB;
  const theta = 0.5 * Math.atan2(cC, cA - cB);
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Ap = cA * ct * ct + cC * ct * st + cB * st * st;  // X'² coeff after rotation
  const Bp = cA * st * st - cC * ct * st + cB * ct * ct;  // Y'² coeff (cross term ≈ 0)
  if (Math.abs(disc) < 1e-6 * scale)
    return { subtype: 'parabola', D: cD, E: cE, F: cF, theta, Ap, Bp };
  const det2 = 4 * cA * cB - cC * cC;                     // = −disc
  const cx = (-2 * cB * cD + cC * cE) / det2;
  const cy = (-2 * cA * cE + cC * cD) / det2;
  const Fp = cA * cx * cx + cB * cy * cy + cC * cx * cy + cD * cx + cE * cy + cF;  // Q(centre)
  if (disc < 0) {
    const rx2 = -Fp / Ap, ry2 = -Fp / Bp;
    if (rx2 <= 0 || ry2 <= 0) return { subtype: 'empty', cx, cy };  // imaginary (no real locus)
    const circle = Math.abs(Ap - Bp) < 1e-4 * Math.max(Math.abs(Ap), Math.abs(Bp));
    return { subtype: circle ? 'circle' : 'ellipse', cx, cy, rx: Math.sqrt(rx2), ry: Math.sqrt(ry2), theta };
  }
  return { subtype: 'hyperbola', cx, cy, Ap, Bp, Fp, theta };  // X'²·Ap + Y'²·Bp = −Fp
}

// ─── Generic GA ops via ganja ────────────────────────────────────────────────
export const dualOp    = (mv) => (isMV(mv) ? A.Dual(mv) : mv);
export const reverseOp = (mv) => (isMV(mv) ? A.Reverse(mv) : mv);

// ─── Classifier ──────────────────────────────────────────────────────────────
// Per-grade L2 norms; a grade is "present" if its norm clears both an absolute
// floor and a relative cutoff against the dominant grade (Float32 noise guard).
function gradeFlags(val) {
  const sq = new Array(9).fill(0);
  for (let i = 0; i < ARRAY_SIZE; i++) { const c = val[i] || 0; sq[GRADES[i]] += c * c; }
  const n = sq.map(Math.sqrt);
  const maxN = Math.max(...n);
  if (maxN < EPS) return n.map(() => false);
  const thr = Math.max(EPS, maxN * 1e-5);
  return n.map((x) => x > thr);
}
const onlyGrade = (g, k) => g[k] && g.every((p, i) => i === k || !p);

// A grade-1 vector is a point only if it lies in the point subspace V₆ — no eo3 and
// no eōbar (eo1−eo2) component (notebook §3.5: points cannot reach the W₂ gauge
// directions). An IPNS conic dual DOES occupy them: eo3 = −C, eo1−eo2 = 2(B−A).
//   eo3 = (v5+v8)/2,  eo1 = (v3+v6)/2,  eo2 = (v4+v7)/2.
function isPointVector(v) {
  let mag = 0;
  for (let i = 1; i <= 8; i++) { const a = Math.abs(v[i] || 0); if (a > mag) mag = a; }
  if (mag < EPS) return true;
  const eo3   = ((v[5] || 0) + (v[8] || 0)) / 2;
  const eob = (((v[3] || 0) + (v[6] || 0)) - ((v[4] || 0) + (v[7] || 0))) / 2;
  const thr = mag * 1e-5;
  return Math.abs(eo3) < thr && Math.abs(eob) < thr;
}

function classifyImpl(val) {
  if (typeof val === 'number') return { kind: 'scalar' };
  if (!isMV(val)) return null;

  const g = gradeFlags(val);
  if (!g.some(Boolean)) return { kind: 'scalar' };       // zero MV
  if (onlyGrade(g, 0)) return { kind: 'scalar' };

  // Pure grade-1: a point (null / round / ideal) only if it lies in V₆; otherwise it
  // is a grade-1 IPNS conic (e.g. the dual of a conic — it carries eo3 / eōbar).
  if (onlyGrade(g, 1)) {
    if (isPointVector(val)) {
      const rp = extractRoundPoint(val);
      if (rp) {
        // rSq has units of length², so the null cutoff scales with distance² to
        // absorb the Float32 noise a far-from-origin point carries.
        const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
        if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint' };
        return { kind: 'roundPoint', rSq: rp.rSq };
      }
      // w ≈ 0 → ideal. A linear e1/e2 part ⇒ "vector" (ideal round point, vector(x,y));
      // a purely quadratic einf form ⇒ the true point at infinity (Veronese limit).
      let mag = 0;
      for (let i = 1; i <= 8; i++) { const a = Math.abs(val[i] || 0); if (a > mag) mag = a; }
      const lin = Math.hypot(val[1] || 0, val[2] || 0);
      return lin < 1e-5 * mag ? { kind: 'infinityPoint' } : { kind: 'idealPoint' };
    }
    // Stash the full geometry so getRenderPlan reuses it (the costly part is the
    // conicCoeffs Mul) instead of recomputing the dual a second time.
    const geom = conicGeometry(conicCoeffs(val));
    return { kind: 'conic', subtype: geom.subtype, geom };
  }

  // Pure grade-2: dipole / point pair (pp = p1∧p2).
  if (onlyGrade(g, 2)) return { kind: 'pointPair' };

  // Pure grade-4: flat point (p∧Iinf). (Quadpoles, also grade-4, come later.)
  if (onlyGrade(g, 4)) return { kind: 'flatPoint' };

  // Pure grade-7: general conic (Iod ∧ p1∧…∧p5). Subtype via the dual coefficients.
  if (onlyGrade(g, 7)) {
    const geom = conicGeometry(conicCoeffs(val));
    return { kind: 'conic', subtype: geom.subtype, geom };
  }

  // Other higher-grade objects come in later slices.
  return { kind: 'mixed' };
}

// classifyMV runs ~7× per value per render (positions, colors, labels, hit-test,
// canvas, panel) and getRenderPlan once more — and for conics each call hides a
// 2.5 ms `A.Mul` (conicCoeffs). MV values are immutable Float32Arrays created
// fresh each evaluation and shared by reference across all consumers in a render,
// so a WeakMap keyed on the value object collapses those calls to one real
// computation; the next evaluation makes new objects and the old entries are GC'd.
const _classifyCache = new WeakMap();
const _renderPlanCache = new WeakMap();

export function classifyMV(val) {
  if (val === null || typeof val !== 'object') return classifyImpl(val);
  const hit = _classifyCache.get(val);
  if (hit !== undefined) return hit;
  const res = classifyImpl(val);
  _classifyCache.set(val, res);
  return res;
}

// ─── Norms / weight ──────────────────────────────────────────────────────────
export function normalizeMVFinit(val) {
  if (!isMV(val)) return val;
  const norm = A.Length(val);
  if (norm < 1e-10) return val;
  const r = zeroMV();
  for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / norm;
  return r;
}
export const normalizeMVIdeal = normalizeMVFinit;
export const normalizeMV      = normalizeMVFinit;

// Plain L2 magnitude of the components — a Mul-free stand-in for GA Length, used
// only to scale visual thickness (sign-metric subtleties don't matter there) and
// kept off ganja's 256-dim product so it stays cheap in the render path.
export function objectWeight(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val) || 1;
  if (!isMV(val)) return 1;
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) s += (val[i] || 0) ** 2;
  return Math.sqrt(s) || 1;
}

// ─── Render plan ─────────────────────────────────────────────────────────────
export function getRenderPlan(val) {
  if (val === null || typeof val !== 'object') return renderPlanImpl(val);
  const hit = _renderPlanCache.get(val);
  if (hit !== undefined) return hit;
  const res = renderPlanImpl(val);
  _renderPlanCache.set(val, res);
  return res;
}

function renderPlanImpl(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    const allPoints = elements.length > 0 &&
      elements.every((e) => e.kind === 'finitePoint' || e.kind === 'roundPoint');
    const outline = allPoints ? elements.map((e) => ({ x: e.x, y: e.y })) : null;
    return { kind: 'list', elements, outline };
  }
  const cls = classifyMV(val);
  if (!cls) return null;
  switch (cls.kind) {
    case 'finitePoint': {
      const eu = toEuclidean(val);
      return eu ? { kind: 'finitePoint', x: eu.x, y: eu.y } : null;
    }
    case 'roundPoint': {
      const rp = extractRoundPoint(val);
      return rp ? { kind: 'roundPoint', x: rp.x, y: rp.y, rSq: rp.rSq } : null;
    }
    case 'infinityPoint': {
      // True point at infinity — drawn as an arrow in its asymptotic direction.
      // Prefer the signed source direction (set by the constructor) so a dragged
      // vinf(x, y) renders its tip exactly at (x, y); else recover it from v.
      const d = val.dir ?? infinityDir(val);
      if (d.vx === 0 && d.vy === 0) return null;
      return { kind: 'positionedVector', vx: d.vx, vy: d.vy };
    }
    case 'idealPoint': {
      // Origin-free grade-1 vector (vector(x,y[,r])) — arrow from origin to (x,y).
      // r² recovered from the einf parts: rSq = (x²+y²) − 2·(einf1+einf2 coeffs),
      // with einf1 = v6−v3, einf2 = v7−v4; drawn as a circle at the tail.
      const x = val[1] || 0, y = val[2] || 0;
      const rSq = (x * x + y * y) - 2 * (((val[6] || 0) - (val[3] || 0)) + ((val[7] || 0) - (val[4] || 0)));
      return { kind: 'positionedVector', vx: x, vy: y, rSq };
    }
    case 'pointPair': {
      const pp = extractDipole(val);
      return pp ? { kind: 'pointPair', p1: pp.p1, p2: pp.p2, cx: pp.cx, cy: pp.cy, r: pp.r, imaginary: pp.imaginary } : null;
    }
    case 'flatPoint': {
      const fp = extractFlatPoint(val);
      return fp ? { kind: 'flatPoint', x: fp.x, y: fp.y } : null;
    }
    case 'conic': {
      const geom = cls.geom ?? conicGeometry(conicCoeffs(val));  // reuse classify's geom
      if (geom.subtype === 'empty') return null;          // imaginary conic — no real locus
      return { kind: 'conic', ...geom };
    }
    default: return null;
  }
}

// ─── Drag hooks ──────────────────────────────────────────────────────────────
// CCGA points carry their spatial coordinates on e1 (idx 1) and e2 (idx 2).
export function hasDepPointCoeffs(coeffExprs) {
  return coeffExprs?.[1] !== undefined || coeffExprs?.[2] !== undefined;
}
export const tryVectorFromMV = () => null;
export const geomToMV = null;

// ─── Node types accepted under CCGA (conservative for now) ───────────────────
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'freePoint', 'freeVector', 'freeInfinityPoint',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color', 'funcDef',
]);

// ─── Colors keyed by classifyMV().kind ───────────────────────────────────────
export const KIND_COLOR = {
  scalar:      '#0F9D57',
  finitePoint: '#1482C8',
  roundPoint:  '#1482C8',
  flatPoint:   '#1482C8',
  pointPair:   '#AA7500',
  conic:       '#C30A3A',
  idealPoint:  '#E8A000',
  infinityPoint: '#E8A000',
  mixed:       '#8B93A4',
};

export const TYPE_COLOR_FALLBACK = {
  scalar:    '#0F9D57',
  freePoint: '#1482C8',
  list:      '#41BF82',
};

// ─── Initial showcase: a null point + a round point ──────────────────────────
const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'P1 = point(1.5, 0.5)'),
  ITEM('expr_1', 'P2 = point(-1, -1)'),
  ITEM('expr_2', 'pp = P1 ^ P2'),
  ITEM('expr_3', 'P3 = point(0.5, 1.5)'),
  ITEM('expr_4', 'F = P3 ^ Iinf'),
];

// ─── Null-basis display ──────────────────────────────────────────────────────
// Re-express MV coefficients in the conformal null basis {e1, e2, eo1..3,
// einf1..3} for readability — the CCGA analog of CGA's e0/einf display. This is a
// linear change of basis on the 8 generators, extended to all 256 blades once at
// module load by symbolic exterior multiplication, so per-render it is a sparse dot.
const DTOKENS = ['e1', 'e2', 'eo1', 'eo2', 'eo3', 'einf1', 'einf2', 'einf3'];
// Each orthogonal generator (ganja index) in display generators (bit into DTOKENS):
//   e₊ᵢ = eo_i/2 − einf_i,   e₋ᵢ = eo_i/2 + einf_i.
const ORTHO_GEN = {
  1: [[0, 1]],
  2: [[1, 1]],
  3: [[2, 0.5], [5, -1]], 6: [[2, 0.5], [5, 1]],   // e3=e₊1, e6=e₋1
  4: [[3, 0.5], [6, -1]], 7: [[3, 0.5], [6, 1]],   // e4=e₊2, e7=e₋2
  5: [[4, 0.5], [7, -1]], 8: [[4, 0.5], [7, 1]],   // e5=e₊3, e8=e₋3
};
const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

// Canonical ordering of the 256 display blades: grade-first, then mask value.
const DISPLAY_MASKS = [...Array(256).keys()].sort(
  (a, b) => popcount(a) - popcount(b) || a - b);
const DISPLAY_INDEX = new Array(256);
DISPLAY_MASKS.forEach((m, i) => { DISPLAY_INDEX[m] = i; });
export const DISPLAY_BLADE_NAMES = DISPLAY_MASKS.map((m) => {
  if (m === 0) return '1';
  const toks = [];
  for (let b = 0; b < 8; b++) if (m & (1 << b)) toks.push(DTOKENS[b]);
  return toks.join('');
});

// Decompose each orthogonal basis blade into display blades (mask → coeff) by
// wedging its generators' display-expansions in order (sign = parity of already-
// placed generators of higher display index).
const ORTHO_DECOMP = BLADE_NAMES.map((name) => {
  let terms = new Map([[0, 1]]);                         // start from scalar 1
  if (name !== '1') {
    for (const ch of name.slice(1)) {
      const exp = ORTHO_GEN[+ch];
      const next = new Map();
      for (const [mask, coeff] of terms) {
        for (const [bit, c] of exp) {
          if (mask & (1 << bit)) continue;                // repeated generator ⇒ 0
          const sign = (popcount(mask >> (bit + 1)) & 1) ? -1 : 1;
          const nm = mask | (1 << bit);
          next.set(nm, (next.get(nm) || 0) + sign * coeff * c);
        }
      }
      terms = next;
    }
  }
  return [...terms].map(([mask, coeff]) => [DISPLAY_INDEX[mask], coeff]);
});

export function toDisplayCoeffs(mv) {
  if (!isMV(mv)) return null;
  const d = new Array(ARRAY_SIZE).fill(0);
  for (let j = 0; j < ARRAY_SIZE; j++) {
    const v = mv[j];
    if (!v) continue;
    for (const [di, c] of ORTHO_DECOMP[j]) d[di] += v * c;
  }
  return d;
}

// ─── Spec object ─────────────────────────────────────────────────────────────
import { createEvalMVArith }     from '../../graph/evalMVArith.js';
import { createNodeTypes }       from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }        from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: CCGA,
  arraySize: ARRAY_SIZE,
  bladeIndex: BLADE_INDEX,
  bladeNames: BLADE_NAMES,
  bladePattern: BLADE_PATTERN,
  parseBladeName,
  tryVectorFromMV,
  geomToMV,
  dualOp, reverseOp,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
  point2D,
  vector2D,
  infinityPoint2D,
  // Named conic constructors, dispatched as inline expression-language calls.
  namedConstructors: {
    circle: circleConic,
    ellipse: ellipseConic,
    hyperbola: hyperbolaConic,
    parabola: parabolaConic,
    tilted_ellipse: tiltedEllipseConic,
    line: lineConic,
    conic: conicGeneral,
  },
  toEuclidean,
  toIdealVector,
  hasDepPointCoeffs,
  getRenderPlan,
  // Conformal null-basis display (opt-in in the panel, like CGA).
  displayBladeNames: DISPLAY_BLADE_NAMES,
  toDisplayCoeffs,
  // Null basis + special blades, usable as identifiers in expressions.
  mvConsts: {
    eo1, eo2, eo3, einf1, einf2, einf3,
    eo, einf, eob, einfb,
    Iod, Iinfd, Io, Iinf, Ieps, I, Iinv,
  },
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
  info: {
    fullName: 'Conic Conformal Geometric Algebra ℝ(5,3)',
    signature: { p: 5, q: 3, r: 0 },
    description: 'Conic model of the 2D plane: a quadratic (Veronese) point embedding in which every conic — circle, ellipse, hyperbola, parabola, line — is a single algebraic object. This build is in progress; points and round points are available so far.',
    geometry: [
      { label: 'origin (eo)',     formula: 'eo = eo1 + eo2          (null: eo² = 0)' },
      { label: 'infinity (einf)', formula: 'einf = (einf1+einf2)/2  (null,  eo·einf = −1)' },
      { label: 'point',           formula: 'p = eo + x·e1 + y·e2 + ½x²·einf1 + ½y²·einf2 + xy·einf3' },
      { label: 'round point',     formula: 'p − ½r²·einf            (p² = +r²)' },
    ],
    subalgebras: [
      { name: 'Scalars', blades: '1' },
    ],
    notes: [
      'CCGA lives in ℝ(5,3): generators e1,e2 square to +1 (Euclidean), e3,e4,e5 to +1, e6,e7,e8 to −1. The null basis eo_i = e₊ᵢ+e₋ᵢ, einf_i = (e₋ᵢ−e₊ᵢ)/2 are combinations, not basis blades.',
      'The point embedding is quadratic (a Veronese map): the einf1/einf2/einf3 coefficients carry x², y², xy, which is what lets a single grade-1 vector encode a general conic.',
      'A round point is an ordinary point carrying a radius: p − ½r²·einf, satisfying p² = +r² (real) or p² = −r² (imaginary, written with a negative r here).',
    ],
  },
};

const _evaluator = createEvalMVArith(spec);
const _nodeTypes = createNodeTypes(spec, _evaluator);
const _parse     = createParseExpression(spec, _evaluator);
const _evaluate  = createEvaluate(spec, _nodeTypes);

spec.evalMVArith     = _evaluator.evalMVArith;
spec.extractMVDeps   = _evaluator.extractMVDeps;
spec.nodeTypes       = _nodeTypes;
spec.parseExpression = _parse;
spec.evaluate        = _evaluate;

export default spec;
