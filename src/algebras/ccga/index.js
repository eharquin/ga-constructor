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
// numeric base type: ganja elements default to Float32Array (~7 digits). The conic
// pipeline raises magnitudes to high powers (det3 cubic; the degenerate-pencil
// Cardano tail squares/cubes those and then cancels), which Float32 cannot hold —
// e.g. det1²∝‖C‖¹⁸ underflows and the discriminant loses ~2 digits to cancellation,
// putting a ~3% error in the recovered root. `baseType:Float64Array` (supported for
// flat generators) gives ~16 digits: the degenerate conic comes out clean and the
// underflow floor drops from ~1e-45 to ~5e-324. Cost is 2× MV memory (≈1→2 KB) and
// no real perf change (V8 numbers are f64 natively).
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

export const CCGA = Algebra({ p: 5, q: 3, graded: false, baseType: Float64Array });
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

// Dilation (scaling) generators — hyperbolic bivectors with (eoᵢ∧einfᵢ)² = +1.
// Their sum Edil is the isotropic scaling generator: exp(½ln(s)·Edil) scales by s.
const B1 = A.Wedge(eo1, einf1);
const B2 = A.Wedge(eo2, einf2);
const B3 = A.Wedge(eo3, einf3);
const Edil = addMV(B1, B2, B3);

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

// CCGA's free `vector(x, y)` — the natural ideal point of CCGA: the Veronese point at
// infinity  0.5·x²·einf1 + 0.5·y²·einf2 + x·y·einf3  (no eo, no linear e1/e2). Same
// embedding as `infinityPoint2D` (the single source of truth); classifies as
// `infinityPoint` and renders as an arrow toward (x, y) — the signed source is stashed on
// `.dir` so the tip follows the cursor (the purely quadratic form can't recover the sign).
export function vector2D(x, y) {
  return infinityPoint2D(x, y);
}

// ─── Versors (transforms) ────────────────────────────────────────────────────
// Isotropic scaling versor (dilator) about the origin, scale factor s > 0.
// Closed form D = ∏ᵢ(cosh u + sinh u·(eoᵢ∧einfᵢ)), u = ½ln s; matches the
// notebook's ccga/transform.py::dilator. Applied by sandwich: D >>> X scales X
// (and any conic) by s. Verified: dilator(s) >>> point(x,y) → (s·x, s·y).
export function dilator(s) {
  if (!(s > 0)) return null;                              // scale must be positive
  const u = 0.5 * Math.log(s), c = Math.cosh(u), sh = Math.sinh(u);
  const factor = (B) => { const f = scaleMV(sh, B); f[0] += c; return f; };
  return A.Mul(A.Mul(factor(B1), factor(B2)), factor(B3));
}

// Exponential for CCGA versor generators. ganja's analytic .Exp() is wrong here —
// it assumes a *simple* bivector, but the dilation generator eo1∧einf1+eo2∧einf2+
// eo3∧einf3 is not simple (gives the wrong scale). We use scaling-and-squaring of
// a truncated Taylor series (all products delegate to ganja's A.Mul), which is
// exact for dilators, translators, rotors, and general motors alike.
export function ccgaExp(mv) {
  let norm = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) norm += Math.abs(mv[i] || 0);
  let k = 0;
  while (norm > 0.5) { norm /= 2; k++; }
  const X = scaleMV(1 / 2 ** k, mv);
  let term = zeroMV(); term[0] = 1;
  let sum  = zeroMV(); sum[0]  = 1;
  // After scaling ‖X‖₁ ≤ 0.5, so term n is bounded by 0.5ⁿ/n! and the partial sums
  // stay O(1) — once a term's L1 norm drops below f64 round-off it contributes
  // nothing, so bail early (a rotor typically needs ~7 terms, not the full 18).
  // Each A.Mul here is a ~3.5 ms 256-dim product, so trimmed iterations matter.
  for (let n = 1; n <= 18; n++) {
    term = scaleMV(1 / n, A.Mul(term, X));
    sum = addMV(sum, term);
    let tn = 0;
    for (let i = 0; i < ARRAY_SIZE; i++) tn += Math.abs(term[i] || 0);
    if (tn < 1e-16) break;
  }
  for (let i = 0; i < k; i++) sum = A.Mul(sum, sum);
  return sum;
}

// Ideal point (Veronese limit) in direction (vx, vy) — the purely-quadratic point
// embedding: vector2D minus the linear e1/e2 part.
//   vinf = ½vx²·einf1 + ½vy²·einf2 + vx·vy·einf3 ± r²·einf   (no eo, no e1/e2).
// The optional radius adds ±r²·einf (sign from r): r>0 → real, r<0 → imaginary, drawn
// as a (dashed-if-imaginary) circle of radius |r| at the arrow tip. rSq = r·|r| is
// stashed for the renderer/panel; like .dir it is dropped by derived products.
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

// Every named conic returns the grade-7 OPNS form — the dual of the grade-1 IPNS
// vector — so it renders via SvgConic. Grade-1 IPNS vectors are the algebraic/dual
// form and are NOT drawn as conics directly; dualize (`!`) to view one. (`CCGA.Dual`,
// not the shadowed local `A`, since ellipse/hyperbola/tilted bind `A` to a coeff.)
const opnsConic = (cA, cB, cC, cD, cE, cF) => CCGA.Dual(conicIPNS(cA, cB, cC, cD, cE, cF));

// Friendly constructors mapping shape params → (A..F) (OBJECTS.md §4), each emitting
// the grade-7 OPNS conic via opnsConic so circle / ellipse / hyperbola / parabola /
// tilted ellipse / line all classify as `conic` and draw via SvgConic.
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

// A line is the degenerate conic A=B=C=0; its grade-1 IPNS has zero einf-weight,
// so the classifier reads it as an ideal-point arrow. The grade-7 OPNS dual
// classifies as a conic 'line' and renders via SvgLine.
export const lineConic = (nx, ny, d = 0) => opnsConic(0, 0, 0, nx, ny, d);

// General conic from raw (A..F) — grade-7 OPNS like the rest (a degenerate A=B=C≈0
// dualizes to a 'line', matching lineConic).
export const conicGeneral = (cA, cB, cC, cD, cE, cF) => opnsConic(cA, cB, cC, cD, cE, cF);

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

// Pair of ideal directions B = vinf(v1)∧vinf(v2) — a grade-2 blade living entirely in
// the 3-D einf space (extractDipole bails because m = −(einf⌋B) collapses for points at
// infinity). Each ideal direction sits on the conic at infinity at einf-coords
// (a,b,c) = (½vx², ½vy², vx·vy); a direction lies in span(v1,v2) iff w∧B = 0, i.e.
// a·B₂₃ − b·B₁₃ + c·B₁₂ = 0. Substituting the Veronese coords gives a homogeneous
// quadratic in (vx,vy):  ½B₂₃·vx² + B₁₂·vx·vy − ½B₁₃·vy² = 0  whose roots are the two
// directions. Bᵢⱼ (the einfᵢ∧einfⱼ coefficient) is read off by contracting with the
// reciprocal eoᵢ∧eoⱼ: ⟨(eoᵢ∧eoⱼ)·B⟩₀ = −Bᵢⱼ (eoᵢ·einfⱼ = −δᵢⱼ).
//   2 real roots → secant pair (hyperbola-type); 1 double root → tangent (parabola-type);
//   0 real roots → imaginary pair (ellipse-type), no real asymptotic direction.
const EOW12 = A.Wedge(eo1, eo2), EOW13 = A.Wedge(eo1, eo3), EOW23 = A.Wedge(eo2, eo3);
const scalarOf = (mv) => (typeof mv === 'number' ? mv : (mv[0] || 0));
function extractIdealPair(B) {
  if (!isMV(B)) return null;
  const B12 = -scalarOf(A.Mul(EOW12, B));
  const B13 = -scalarOf(A.Mul(EOW13, B));
  const B23 = -scalarOf(A.Mul(EOW23, B));
  const scale = Math.abs(B12) + Math.abs(B13) + Math.abs(B23);
  if (scale < 1e-10) return null;                          // not an einf-plane blade
  // P·vx² + Q·vx·vy + R·vy² = 0
  const P = 0.5 * B23, Q = B12, R = -0.5 * B13;
  const norm = (vx, vy) => { const n = Math.hypot(vx, vy); return n < 1e-12 ? null : { vx: vx / n, vy: vy / n }; };
  const disc = Q * Q - 4 * P * R;
  let dirs;
  if (disc < -1e-12 * scale * scale) return { dirs: [], imaginary: true };  // ellipse-type
  const s = Math.sqrt(Math.max(disc, 0));
  if (Math.abs(P) > 1e-12 * scale) {                       // solve vx with vy = 1
    dirs = [norm((-Q + s) / (2 * P), 1), norm((-Q - s) / (2 * P), 1)];
  } else if (Math.abs(R) > 1e-12 * scale) {                // P≈0: solve vy with vx = 1
    dirs = [norm(1, (-Q + s) / (2 * R)), norm(1, (-Q - s) / (2 * R))];
  } else {                                                  // P,R≈0: Q·vx·vy = 0
    dirs = [norm(1, 0), norm(0, 1)];
  }
  dirs = dirs.filter(Boolean);
  // Collapse a double root (parabola-type tangent) to one direction.
  if (dirs.length === 2 && Math.abs(dirs[0].vx * dirs[1].vy - dirs[0].vy * dirs[1].vx) < 1e-6)
    dirs = [dirs[0]];
  return dirs.length ? { dirs, imaginary: false } : null;
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

// Precomputed grade-7 → grade-1 dual map. The OPNS→IPNS dual Mul(C7, Iinv) sends a
// pure grade-7 blade to grade-1, so it is an 8×8 linear map on the grade-7 / grade-1
// component slots. Building it once (8 dense Muls at load) lets a grade-7 conic
// dualize with a tiny 8×8 product instead of a ~2.5 ms 256-dim Mul.
const GRADE7_IDX = GRADES.map((g, i) => (g === 7 ? i : -1)).filter((i) => i >= 0);
const DUAL7 = (() => {
  const m = Array.from({ length: 9 }, () => new Array(GRADE7_IDX.length).fill(0));
  GRADE7_IDX.forEach((idx, c) => {
    const unit = zeroMV(); unit[idx] = 1;
    const d = A.Mul(unit, Iinv);
    for (let r = 1; r <= 8; r++) m[r][c] = d[r] || 0;
  });
  return m;
})();
// grade-1 dual coeffs s[1..8] of a pure grade-7 blade (= Mul(C7, Iinv) at grade 1).
function dualGrade7Coeffs(C7) {
  const s = new Array(9).fill(0);
  for (let c = 0; c < GRADE7_IDX.length; c++) {
    const v = C7[GRADE7_IDX[c]] || 0;
    if (!v) continue;
    for (let r = 1; r <= 8; r++) s[r] += v * DUAL7[r][c];
  }
  return s;
}

// Coefficients from either conic form: a grade-1 vector is already IPNS; a grade-7
// OPNS conic is dualized first (fast 8×8 map for pure grade-7, else full Mul).
function conicCoeffs(val) {
  const g = gradeFlags(val);
  if (onlyGrade(g, 1)) return coeffsFromGrade1(val);
  if (onlyGrade(g, 7)) return coeffsFromGrade1(dualGrade7Coeffs(val));
  return coeffsFromGrade1(A.Mul(val, Iinv));
}

// Split a degenerate conic (det H₃ ≈ 0) into its two lines via the adjugate of the
// Hessian (Richter-Gebert / Chomicki et al. Alg. 2): adj(H) picks the rank-1 skew
// part D so that H + D/β factors as the outer product of the two lines; a column and
// a row of that recover them. Returns each as a homogeneous line nx·x+ny·y+d=0
// (empty when no real line can be recovered). Handles intersecting, parallel, and
// double lines uniformly (β≈0 ⇒ the skew term vanishes, lines live in H's own span).
function factorLinePair(a, b, c, d, e, f) {
  const H = [[a, c / 2, d / 2], [c / 2, b, e / 2], [d / 2, e / 2, f]];
  const adj = [
    [H[1][1] * H[2][2] - H[1][2] * H[2][1], -(H[0][1] * H[2][2] - H[0][2] * H[2][1]), H[0][1] * H[1][2] - H[0][2] * H[1][1]],
    [-(H[1][0] * H[2][2] - H[1][2] * H[2][0]), H[0][0] * H[2][2] - H[0][2] * H[2][0], -(H[0][0] * H[1][2] - H[0][2] * H[1][0])],
    [H[1][0] * H[2][1] - H[1][1] * H[2][0], -(H[0][0] * H[2][1] - H[0][1] * H[2][0]), H[0][0] * H[1][1] - H[0][1] * H[1][0]],
  ];
  let i = 0;
  for (let k = 1; k < 3; k++) if (adj[k][k] < adj[i][i]) i = k;
  const beta = Math.sqrt(Math.max(-adj[i][i], 0));
  let N = H;
  if (beta > 1e-12) {
    const r = adj[i];
    const Dm = [[0, -r[2], r[1]], [r[2], 0, -r[0]], [-r[1], r[0], 0]];
    N = H.map((row, ri) => row.map((x, ci) => x + Dm[ri][ci] / beta));
  }
  let jc = 0, best = -1;
  for (let j = 0; j < 3; j++) { const s = N[0][j] ** 2 + N[1][j] ** 2; if (s > best) { best = s; jc = j; } }
  let jr = 0; best = -1;
  for (let j = 0; j < 3; j++) { const s = N[j][0] ** 2 + N[j][1] ** 2; if (s > best) { best = s; jr = j; } }
  const lines = [];
  for (const [u, v, w] of [[N[0][jc], N[1][jc], N[2][jc]], [N[jr][0], N[jr][1], N[jr][2]]]) {
    if (Math.hypot(u, v) > 1e-9) lines.push({ nx: u, ny: v, d: w });
  }
  return lines;
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

  // Degeneracy: Δ₃ = det(Hessian) ≈ 0 ⇒ point / line pair (Chomicki et al. Table 1).
  // Δ₂ (= −disc/4) then splits the case: Δ₂>0 (disc<0) a point, Δ₂<0 (disc>0) two
  // intersecting lines, Δ₂≈0 (disc≈0) parallel/double lines.
  //
  // Δ₃ = det(H₃) and the quadratic part both transform by unimodular conjugation under
  // translation, so |Δ₃|/qmax³ (qmax = max quadratic coefficient) is a translation-
  // invariant degeneracy measure. Normalising by the full cmax instead — as before —
  // collapses for conics far from the origin, where F grows ∝ R² and swamps Δ₃; that
  // made off-origin and small-magnitude degenerate conics (e.g. the dual of a 5-point
  // conic) miss the test and fall through to hyperbola/parabola. The qmax-relative
  // cutoff sits far below any non-degenerate conic (min observed |Δ₃|/qmax³ ≈ 0.1) and
  // above the noise floor of a truly degenerate conic (≈1e-5) yet below a genuine but
  // near-degenerate hyperbola (≈9e-4 for a thin 5-point conic) — 1e-4 is the geometric
  // mean of the two, the widest log-space margin separating the cases.
  const qmax = Math.max(Math.abs(cA), Math.abs(cB), Math.abs(cC));
  const delta3 = det3(co);
  if (qmax > 0 && Math.abs(delta3) < 1e-4 * qmax * qmax * qmax) {
    const dtol = 1e-3 * qmax * qmax;
    if (disc < -dtol) {
      const det2c = 4 * cA * cB - cC * cC;
      return { subtype: 'point', cx: (-2 * cB * cD + cC * cE) / det2c, cy: (-2 * cA * cE + cC * cD) / det2c };
    }
    return { subtype: Math.abs(disc) <= dtol ? 'parallelLines' : 'linePair', lines: factorLinePair(cA, cB, cC, cD, cE, cF) };
  }
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
    const circle = Math.abs(Ap - Bp) < 1e-4 * Math.max(Math.abs(Ap), Math.abs(Bp));
    if (rx2 <= 0 || ry2 <= 0)  // imaginary: real centre, no real locus — draw |axes| dashed
      return { subtype: circle ? 'circle' : 'ellipse', cx, cy,
               rx: Math.sqrt(Math.abs(rx2)), ry: Math.sqrt(Math.abs(ry2)), theta, imaginary: true };
    return { subtype: circle ? 'circle' : 'ellipse', cx, cy, rx: Math.sqrt(rx2), ry: Math.sqrt(ry2), theta };
  }
  return { subtype: 'hyperbola', cx, cy, Ap, Bp, Fp, theta };  // X'²·Ap + Y'²·Bp = −Fp
}

// ─── n-pole point extraction (for rendering) ─────────────────────────────────
// A bare n-pole p1∧…∧pn keeps all n points; we draw them as dots joined by a
// dashed outline. Rather than port extract.py's radical solvers (SVD + Cardano +
// Ferrari), we use the GA-native carrier conic the n points lie on and scan the
// membership residual ‖point2D(x,y) ∧ Npole‖ along it for the n zeros — exact
// enough for rendering, and reuses the conicCoeffs/conicGeometry pipeline. The
// caller is behind the classify/render WeakMap caches, so this runs only when a
// defining point actually moves; the sample counts below are the tuning knob.
function rawNorm(mv) {
  if (!isMV(mv)) return Math.abs(mv || 0);
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2;
  return Math.sqrt(s);
}

// 3×3 conic-matrix determinant of A x²+B y²+C xy+D x+E y+F (= det of
// [[A,C/2,D/2],[C/2,B,E/2],[D/2,E/2,F]]). Zero ⇔ the conic is degenerate.
function det3(co) {
  const { A: a, B: b, C: c, D: d, E: e, F: f } = co;
  return a * b * f + (c * d * e - c * c * f - b * d * d - a * e * e) / 4;
}

// Real roots of a3·t³ + a2·t² + a1·t + a0 (Cardano; trig form for the
// three-real-root case). Degrades to quadratic/linear when a3≈0.
function solveCubicReal(a3, a2, a1, a0) {
  if (Math.abs(a3) < 1e-12) {                            // a2 t² + a1 t + a0
    if (Math.abs(a2) < 1e-12) return Math.abs(a1) < 1e-12 ? [] : [-a0 / a1];
    const disc = a1 * a1 - 4 * a2 * a0;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-a1 + s) / (2 * a2), (-a1 - s) / (2 * a2)];
  }
  const a = a2 / a3, b = a1 / a3, c = a0 / a3;           // monic t³ + a t² + b t + c
  const p = b - a * a / 3, q = 2 * a * a * a / 27 - a * b / 3 + c;
  const disc = (q * q) / 4 + (p * p * p) / 27, shift = -a / 3;
  if (disc < 0) {                                        // three distinct real roots
    const r = Math.sqrt(-(p * p * p) / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
    const m = 2 * Math.cbrt(r);
    return [0, 1, 2].map((k) => m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift);
  }
  const s = Math.sqrt(disc);
  return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + shift];
}

// Real intersection points of a line (nx·x+ny·y+d=0) with a conic co, by
// substituting the line's parametric form into the conic quadratic — the exact
// al/be/ga of saved_graphs/ccga_line_conic_intersection.json. Returns 0/1/2 pts.
function lineConicPoints(line, co) {
  const { nx, ny, d } = line;
  const len2 = nx * nx + ny * ny;
  if (len2 < 1e-18) return [];
  const x0 = -nx * d / len2, y0 = -ny * d / len2;        // foot of perpendicular
  const ux = -ny, uy = nx;                               // (unnormalized) direction
  const { A: cA, B: cB, C: cC, D: cD, E: cE, F: cF } = co;
  const al = cA * ux * ux + cB * uy * uy + cC * ux * uy;
  const be = 2 * cA * x0 * ux + 2 * cB * y0 * uy + cC * (x0 * uy + y0 * ux) + cD * ux + cE * uy;
  const ga = cA * x0 * x0 + cB * y0 * y0 + cC * x0 * y0 + cD * x0 + cE * y0 + cF;
  const at = (t) => ({ x: x0 + t * ux, y: y0 + t * uy });
  if (Math.abs(al) < 1e-12) return Math.abs(be) < 1e-12 ? [] : [at(-ga / be)];
  const disc = be * be - 4 * al * ga;
  if (disc < -1e-9 * (be * be + Math.abs(4 * al * ga) + 1)) return [];
  const s = Math.sqrt(Math.max(disc, 0));
  return [at((-be + s) / (2 * al)), at((-be - s) / (2 * al))];
}

const distinctPoint = (list, p, tol = 1e-3) =>
  list.every((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > tol);

// n points around a circle/ellipse carrier (tripole circumcircle).
function sampleCircle(geom, n) {
  const ct = Math.cos(geom.theta || 0), st = Math.sin(geom.theta || 0), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, X = geom.rx * Math.cos(a), Y = geom.ry * Math.sin(a);
    pts.push({ x: geom.cx + X * ct - Y * st, y: geom.cy + X * st + Y * ct });
  }
  return pts;
}

// Golden-section minimum of the residual along the chord lo→hi (a local, near-linear
// model of the carrier between two adjacent samples). ~20 cheap evals of resFn.
function refineChord(resFn, lo, hi) {
  const g = (Math.sqrt(5) - 1) / 2;
  const at = (t) => ({ x: lo.x + t * (hi.x - lo.x), y: lo.y + t * (hi.y - lo.y) });
  const f = (t) => { const p = at(t); return resFn(p.x, p.y); };
  let a = 0, b = 1, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let k = 0; k < 20; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return at((a + b) / 2);
}

// Scan `resFn` over the sampled carrier, take the `count` lowest local minima
// (refined along the local chord), deduped. `scale` sets the flat-carrier floor.
// Returns the points, or null if fewer than `count` distinct real zeros are found.
function findMembershipZeros(resFn, pts, count, scale) {
  if (pts.length < count + 1) return null;
  const res = pts.map((p) => resFn(p.x, p.y));
  // Degenerate carrier: the residual stays ~0 along the whole curve (the entire
  // locus is the zero set, e.g. a collinear tripole whose lifted points are
  // dependent) — no isolated points. A genuine carrier dips to ≈0 only at the n
  // points and rises to O(scale) elsewhere, so a flat-zero scan means "undrawable".
  if (Math.max(...res) < 1e-6 * (scale || 1)) return null;
  let totalGap = 0;
  for (let i = 1; i < pts.length; i++) totalGap += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const medGap = totalGap / (pts.length - 1);                 // mean spacing — branch jumps run larger
  const cand = [];
  for (let i = 0; i < pts.length; i++) {
    if (res[i] <= (res[i - 1] ?? Infinity) && res[i] <= (res[i + 1] ?? Infinity)) cand.push(i);
  }
  cand.sort((i, j) => res[i] - res[j]);
  const out = [];
  for (const i of cand) {
    let p = pts[i];
    const lo = pts[i - 1], hi = pts[i + 1];
    if (lo && hi && Math.hypot(hi.x - lo.x, hi.y - lo.y) < 4 * medGap) p = refineChord(resFn, lo, hi);
    if (distinctPoint(out, p, 1e-2)) out.push(p);
    if (out.length === count) break;
  }
  return out.length === count ? out : null;
}

// Tripole p1∧p2∧p3 (grade 3): the 3 points lie on the circum-conic T∧Iod∧Iinfd
// (extract.py:tripole_circumconic) — a circle (or a line for collinear points,
// which is degenerate: T's 3 points then span no isolated locus → undrawn). With
// no clean 1-param pencil (3 points = a 2-param net), read the points off the
// bounded circle with the precomputed quadratic-form residual ‖q∧T‖².
function extractTripole(T) {
  if (!isMV(T)) return null;
  const geom = conicGeometry(conicCoeffs(A.Wedge(A.Wedge(T, Iod), Iinfd)));
  if (geom.subtype !== 'circle' && geom.subtype !== 'ellipse') return null;  // line/point → collinear
  return findMembershipZeros(wedgeResidualForm(T), sampleCircle(geom, 120), 3, rawNorm(T));
}

// Precompute q ↦ ‖q∧B‖² for grade-1 q as an 8×8 symmetric form: W_i = e_i∧B (8
// wedges, once); M[i][j] = W_i·W_j. The returned residual is then pure arithmetic
// over point2D's 8 coords — no ganja, no allocation, per call.
function wedgeResidualForm(B) {
  const W = [];
  for (let i = 1; i <= 8; i++) W.push(A.Wedge(bvec(i), B));
  const M = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let i = 0; i < 8; i++) for (let j = i; j < 8; j++) {
    let s = 0;
    for (let k = 0; k < ARRAY_SIZE; k++) s += (W[i][k] || 0) * (W[j][k] || 0);
    M[i][j] = s; M[j][i] = s;
  }
  return (x, y) => {
    const ax = x * x / 4, ay = y * y / 4, axy = x * y / 2;
    const q = [x, y, 1 - ax, 1 - ay, -axy, 1 + ax, 1 + ay, axy];   // point2D's e1..e8 coords
    let s = 0;
    for (let i = 0; i < 8; i++) {
      s += q[i] * q[i] * M[i][i];
      for (let j = i + 1; j < 8; j++) s += 2 * q[i] * q[j] * M[i][j];
    }
    return Math.sqrt(Math.max(s, 0));
  };
}

// Quadpole p1∧p2∧p3∧p4 (grade 4): the 4 points lie on every member of the pencil
// of conics through them. Closed-form Ferrari (saved_graphs/ccga_extract_lines.json):
// take two independent pencil members, find a degenerate one (det3=0 → a cubic in
// the pencil parameter, Cardano), split it into two real lines, and meet each line
// with a pencil conic (a quadratic). No scanning, no SVD.
// Iod∧Q∧p5 is pure grade-7 → dualize with the fast 8×8 map (no dense Mul).
const pencilMember = (Q, p5) => coeffsFromGrade1(dualGrade7Coeffs(A.Wedge(A.Wedge(Iod, Q), p5)));
const coAdd = (c1, c2, t) => ({
  A: c1.A + t * c2.A, B: c1.B + t * c2.B, C: c1.C + t * c2.C,
  D: c1.D + t * c2.D, E: c1.E + t * c2.E, F: c1.F + t * c2.F,
});
function coIndependent(c1, c2) {                 // not proportional (and both nonzero)
  const v1 = [c1.A, c1.B, c1.C, c1.D, c1.E, c1.F], v2 = [c2.A, c2.B, c2.C, c2.D, c2.E, c2.F];
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < 6; i++) { dot += v1[i] * v2[i]; n1 += v1[i] ** 2; n2 += v2[i] ** 2; }
  return n1 > 1e-12 && n2 > 1e-12 && dot * dot < (1 - 1e-6) * n1 * n2;
}
function extractQuadpole(Q) {
  if (!isMV(Q)) return null;
  const probes = [einf, eo, e1, point2D(0.31, -0.72), point2D(1, 1), e2];
  const members = [];
  for (const p of probes) {
    const co = pencilMember(Q, p);
    if (Math.abs(det3(co)) > 1e-9 && (members.length === 0 || coIndependent(members[0], co))) {
      members.push(co);
      if (members.length === 2) break;
    }
  }
  if (members.length < 2) return null;
  const [co1, co2] = members;
  const g0 = det3(co1), g3 = det3(co2), gp = det3(coAdd(co1, co2, 1)), gm = det3(coAdd(co1, co2, -1));
  // det3(co1 + t·co2) = a0 + a1 t + a2 t² + a3 t³ from 4 evals (g(0), g(±1), t³ lead).
  const roots = solveCubicReal(g3, 0.5 * (gp + gm) - g0, 0.5 * (gp - gm) - g3, g0);
  for (const t of roots) {
    const cd = coAdd(co1, co2, t);                 // degenerate pencil member (a line pair)
    const lines = factorLinePair(cd.A, cd.B, cd.C, cd.D, cd.E, cd.F);
    if (lines.length < 2) continue;
    const pts = [];
    for (const L of lines) for (const p of lineConicPoints(L, co1)) if (distinctPoint(pts, p)) pts.push(p);
    if (pts.length === 4) return pts;
  }
  return null;
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

// A genuine Veronese point/round point has its einf (quadratic) coefficients locked
// to its position: einf3 = x·y and the radius offset is isotropic (einf1−½x² ==
// einf2−½y²). A grade-1 vector that passes isPointVector but violates either is the
// IPNS dual of a circle/conic — NOT a point — so it must not read as a round point.
// (einf coeffs in the orthogonal basis: einf1 = v6−v3, einf2 = v7−v4, einf3 = v8−v5;
// tolerance relative to the squared position scale.)
function isVeronesePoint(p) {
  const w = einfWeight(p);
  if (Math.abs(w) < EPS) return false;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const E1 = ((p[6] || 0) - (p[3] || 0)) / w;
  const E2 = ((p[7] || 0) - (p[4] || 0)) / w;
  const E3 = ((p[8] || 0) - (p[5] || 0)) / w;
  const tol = 1e-6 * (1 + x * x + y * y);
  return Math.abs(E3 - x * y) < tol &&
         Math.abs((E1 - 0.5 * x * x) - (E2 - 0.5 * y * y)) < tol;
}

// A "special point" is the pure-position grade-1 vector w·eo + x·e1 + y·e2 — a point
// carrying position (x,y) = (e1/w, e2/w) but with NO Veronese quadratic lift (all einf
// coefficients zero). It is the flat point's linear core (OBJECTS.md / GENERAL_FORM.md);
// distinct from a finite/round point (lift present) and from a grade-1 IPNS circle
// (einf ≠ 0). Tested only after isVeronesePoint fails, so the origin point (einf = lift =
// 0, but Veronese-consistent) never reaches here.
function isSpecialPoint(p) {
  const w = einfWeight(p);
  if (Math.abs(w) < EPS) return false;
  const einf1 = (p[6] || 0) - (p[3] || 0);
  const einf2 = (p[7] || 0) - (p[4] || 0);
  const einf3 = (p[8] || 0) - (p[5] || 0);
  const thr = Math.max(Math.abs(w), Math.abs(p[1] || 0), Math.abs(p[2] || 0)) * 1e-5;
  return Math.abs(einf1) < thr && Math.abs(einf2) < thr && Math.abs(einf3) < thr;
}

// Disambiguate a pure grade-4 object by which gauge blade divides it (B∧g ≈ 0):
//   flat point      p∧Iinf            — annihilated by every einf_i (Iinf ⊂ B)
//   CGA point pair  (p1∧p2)∧Iinfd     — annihilated by the infinity gauge Iinfd;
//                                        Iod⌋B recovers the bare dipole p1∧p2
//                                        (cga.cga_blade), fed to extractDipole exactly
//                                        like a grade-2 pp = p1∧p2
//   quadpole        p1∧p2∧p3∧p4       — no gauge factor
// (∧Iinf and ∧Iod are NOT discriminators — they read the same for all three.)
// Tests are relative to ‖B‖; near-origin separations are huge (0 vs ~0.5–2.8), so 1e-6
// is comfortable. Caveat: far from the origin the Veronese coords (∝R²) drive these
// wedges toward 0 and the test breaks — no simple normalization recovers it (unlike the
// conic q-normalization), so off-origin grade-4 objects can misclassify.
function classifyGrade4(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;                            // ‖B‖
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;  // ‖B∧g‖ / ‖B‖
  if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'flatPoint' };
  if (w(Iinfd) < 1e-6) {
    const pp = A.LDot(Iod, val);                          // grade-2 dipole p1∧p2
    if (rawNorm(pp) > 1e-6 * n) return { kind: 'pointPair', ccgaPair: pp };
  }
  if (w(Iod) < 1e-6) return { kind: 'conicPencil', n: 2 }; // p1∧p2∧Iod
  return { kind: 'quadpole' };                             // bare p1∧p2∧p3∧p4
}

// Disambiguate a pure grade-3 object: the CGA round-point family O = p∧Iinfd
// (OBJECTS.md §7), one grade below classifyGrade4's point pair. Iod⌋O recovers
// the bare point p (grade-1); extractRoundPoint is scale-invariant, so it reads
// off (x, y, rSq) directly from Iod⌋O without needing the proportionality
// constant — exactly like extractDipole(Iod⌋O) one grade up. A bare tripole
// p1∧p2∧p3 (no Iinfd factor, ‖T∧Iinfd‖/‖T‖ ≈ 0.55 for a representative triple)
// fails the gate and stays 'mixed' — multipole-ladder objects come later.
function classifyGrade3(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;
  if (w(Iinfd) < 1e-6) {
    const p = A.LDot(Iod, val);                           // grade-1 point p
    if (rawNorm(p) > 1e-6 * n) {
      const rp = extractRoundPoint(p);
      if (rp) {
        const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
        if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint', ccgaPoint: p, cga: true };
        return { kind: 'roundPoint', rSq: rp.rSq, ccgaPoint: p, cga: true };
      }
    }
  }
  // Pure-einf grade-3 blade (a multiple of Iinf = einf1∧einf2∧einf3) is the line at infinity.
  if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'lineAtInfinity' };
  if (w(Iod) < 1e-6) return { kind: 'conicPencil', n: 1 }; // p∧Iod
  return { kind: 'tripole' };                              // bare p1∧p2∧p3
}

// Disambiguate a pure grade-5 object. CCGA points live in the 6-D subspace
// V₆ = {e1,e2,eo,einf1,einf2,einf3}, so a grade-5 object built from points sits in
// V₆ and its V₆-dual is a grade-1 IPNS conic vector — i.e. EVERY point-built grade-5
// object is a conic. In particular:
//   CGA circle  p1∧p2∧p3∧Iinfd,  CGA line  p1∧p2∧einf∧Iinfd ≡ −(p1∧p2∧Iinf), and
//   bare pentapole p1∧…∧p5 (the unique conic through 5 points)
// all read off via conicGeometry(conicCoeffs(O∧Iod)); the subtype (circle/ellipse/
// hyperbola/parabola/line) is the actual geometry, so no construction-based label is
// needed. The Iinfd wedge-gate is useless here (grade 5+2 overflows the 6-D point
// span ⇒ always 0); Iod is transverse, so w(Iod)≈0 is the real discriminator for the
// Iod-gauged objects that are NOT single curves: the conic at infinity (Iod∧Iinf) and
// the 3-point conic pencil (p1∧p2∧p3∧Iod).
function classifyGrade5(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;
  if (w(Iod) < 1e-6) {
    // Iod is a factor → an under-determined / ideal object, not a single curve.
    if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'conicAtInfinity' };
    // Both gauges → the CGA round point p∧Iinfd in the conic frame (cf. the gr7 circle);
    // contract out Iod to recover the standard Iinfd-gauged form and reclassify.
    if (w(Iinfd) < 1e-6) return classifyImpl(A.LDot(Iinfd, val));
    return { kind: 'conicPencil', n: 3 };
  }
  // Otherwise it is a conic: CGA circle/line, or the conic through 5 points.
  const c7 = A.Wedge(val, Iod);                           // grade-7 OPNS conic
  if (rawNorm(c7) > 1e-6 * n) {
    const geom = conicGeometry(conicCoeffs(c7));
    return { kind: 'conic', subtype: geom.subtype, geom, cga: true };
  }
  return { kind: 'mixed' };
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
        // Only a genuine Veronese point/round point renders as a point. A
        // Veronese-inconsistent vector is either a "special point" (pure position
        // eo+xe1+ye2, no einf lift) or the IPNS dual of a circle (einf≠0) — the
        // latter is not drawn directly (dualize to the grade-7 OPNS form to render it).
        if (!isVeronesePoint(val)) {
          if (isSpecialPoint(val)) return { kind: 'specialPoint' };
          return { kind: 'mixed' };
        }
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
      if (lin < 1e-5 * mag) return { kind: 'infinityPoint' };
      // A pure-direction ideal point (linear e1/e2, no einf lift) is a "special ideal
      // point" — the ideal analogue of the special point; it carries no radius (the
      // einf parts are what encode one). einf coeffs: v6−v3, v7−v4, v8−v5.
      const ethr = Math.max(Math.abs(val[1] || 0), Math.abs(val[2] || 0)) * 1e-5;
      const einf1 = (val[6] || 0) - (val[3] || 0);
      const einf2 = (val[7] || 0) - (val[4] || 0);
      const einf3 = (val[8] || 0) - (val[5] || 0);
      if (Math.abs(einf1) < ethr && Math.abs(einf2) < ethr && Math.abs(einf3) < ethr)
        return { kind: 'specialIdealPoint' };
      return { kind: 'idealPoint' };
    }
    // Grade-1 IPNS conic vector — the algebraic/dual form, not drawn as a conic
    // directly. Only its grade-7 OPNS dual renders (dualize with `!`).
    return { kind: 'mixed' };
  }

  // Pure grade-3: CGA round point (p∧Iinfd) — finite/round point, else mixed.
  if (onlyGrade(g, 3)) return classifyGrade3(val);

  // Pure grade-2: a bare twopole p1∧p2 (the multipole-ladder object). The CGA dipole /
  // point pair is one grade up — p1∧p2∧Iinfd — so this is label-only, not drawn.
  if (onlyGrade(g, 2)) return { kind: 'twopole' };

  // Pure grade-4: flat point (p∧Iinf) / round point ((p∧q)∧Iod) / quadpole (p∧q∧r∧s).
  if (onlyGrade(g, 4)) return classifyGrade4(val);

  // Pure grade-5: CGA circle/line family (p1∧p2∧p3∧Iinfd, or p1∧p2∧einf∧Iinfd
  // ≡ −(p1∧p2∧Iinf)) — conic via Wedge(O,Iod), else mixed.
  if (onlyGrade(g, 5)) return classifyGrade5(val);

  // Pure grade-6: an Iod-gauged object. With Iinfd too (p1∧p2∧Iinfd∧Iod) it is the CGA
  // point pair in the conic frame (cf. the gr7 circle) → recover the gr4 pair and reclassify;
  // Iod only (p1∧…∧p4∧Iod) is a genuine 4-point conic pencil.
  if (onlyGrade(g, 6)) {
    const nb = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
    const nrm = nb(val) || 1;
    if (nb(A.Wedge(val, Iod)) / nrm < 1e-6) {                 // Iod is a factor
      if (nb(A.Wedge(val, Iinfd)) / nrm < 1e-6)               // …and Iinfd too → CGA point pair
        return classifyImpl(A.LDot(Iinfd, val));
      return { kind: 'conicPencil', n: 4 };
    }
    return { kind: 'mixed' };
  }

  // Pure grade-7: general conic (Iod ∧ p1∧…∧p5). Subtype via the dual coefficients.
  // A both-gauge CGA round object (p1∧p2∧p3∧Iinfd∧Iod) lands here too — conicGeometry
  // reads it off as the same circle/line it represents one grade down.
  if (onlyGrade(g, 7)) {
    const geom = conicGeometry(conicCoeffs(val));
    return { kind: 'conic', subtype: geom.subtype, geom };
  }

  // Pure grade-8: the pseudoscalar I.
  if (onlyGrade(g, 8)) return { kind: 'pseudoscalar' };

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
  // Conformal points are projective — normalize by the origin weight, P ↦ P/−(P·e∞)
  // (the cheat-sheet convention P·e∞ = −1), so the origin weight becomes +1 and the
  // position reads straight off e1/e2. −(P·e∞) = einfWeight(P). For a null finite
  // point this is the *only* usable scale (its GA magnitude is ≈0). Everything else
  // (conics, dipoles, gauge blades, …) uses the GA magnitude.
  const kind = classifyMV(val)?.kind;
  if (kind === 'finitePoint' || kind === 'roundPoint' || kind === 'specialPoint') {
    const w = einfWeight(val);                       // = −(P·e∞)
    if (Math.abs(w) < 1e-10) return val;
    const r = zeroMV();
    for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / w;
    return r;
  }
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
      const eu = toEuclidean(cls.ccgaPoint ?? val);
      return eu ? { kind: 'finitePoint', x: eu.x, y: eu.y, cga: cls.cga } : null;
    }
    case 'specialPoint': {
      const eu = toEuclidean(val);
      return eu ? { kind: 'specialPoint', x: eu.x, y: eu.y } : null;
    }
    case 'roundPoint': {
      const rp = extractRoundPoint(cls.ccgaPoint ?? val);
      return rp ? { kind: 'roundPoint', x: rp.x, y: rp.y, rSq: rp.rSq, cga: cls.cga } : null;
    }
    case 'infinityPoint': {
      // True point at infinity — drawn as an arrow in its asymptotic direction.
      // Prefer the signed source direction (set by the constructor) so a dragged
      // vinf(x, y) renders its tip exactly at (x, y); else recover it from v.
      const d = val.dir ?? infinityDir(val);
      if (d.vx === 0 && d.vy === 0) return null;
      return { kind: 'positionedVector', vx: d.vx, vy: d.vy, rSq: val.rSq };
    }
    case 'idealPoint': {
      // Origin-free grade-1 vector (vector(x,y[,r])) — arrow from origin to (x,y).
      // r² recovered from the einf parts: rSq = (x²+y²) − 2·(einf1+einf2 coeffs),
      // with einf1 = v6−v3, einf2 = v7−v4; drawn as a circle at the tail.
      const x = val[1] || 0, y = val[2] || 0;
      const rSq = (x * x + y * y) - 2 * (((val[6] || 0) - (val[3] || 0)) + ((val[7] || 0) - (val[4] || 0)));
      return { kind: 'positionedVector', vx: x, vy: y, rSq };
    }
    case 'specialIdealPoint': {
      // Pure-direction ideal point (no einf lift) — arrow with a hollow special-point
      // base and NO radius (rSq omitted so the canvas draws no circle).
      return { kind: 'positionedVector', vx: val[1] || 0, vy: val[2] || 0, special: true };
    }
    case 'pointPair': {
      const pp = extractDipole(cls.ccgaPair ?? val);
      return pp ? { kind: 'pointPair', p1: pp.p1, p2: pp.p2, cx: pp.cx, cy: pp.cy, r: pp.r, imaginary: pp.imaginary } : null;
    }
    // n-pole ladder — drawn as its n defining points joined by a dashed outline.
    case 'twopole': {                                   // bare p1∧p2 (now drawn)
      const pp = extractDipole(val);
      if (pp) return { kind: 'multipole', points: [pp.p1, pp.p2], imaginary: pp.imaginary };
      // A pair of points at infinity (einf-plane blade) — extractDipole collapses;
      // draw the two asymptotic directions as arrows from the origin.
      const ip = extractIdealPair(val);
      return ip ? { kind: 'idealPair', dirs: ip.dirs, imaginary: ip.imaginary } : null;
    }
    case 'tripole': {
      const pts = extractTripole(val);
      return pts ? { kind: 'multipole', points: pts } : null;
    }
    case 'quadpole': {
      const pts = extractQuadpole(val);
      return pts ? { kind: 'multipole', points: pts } : null;
    }
    case 'flatPoint': {
      const fp = extractFlatPoint(val);
      return fp ? { kind: 'flatPoint', x: fp.x, y: fp.y } : null;
    }
    case 'conic': {
      const geom = cls.geom ?? conicGeometry(conicCoeffs(val));  // reuse classify's geom
      if (geom.subtype === 'empty') return null;          // imaginary conic — no real locus
      return { kind: 'conic', ...geom, cga: cls.cga };
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
  'scalar', 'freePoint', 'freeVector',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'motorExp', 'motorApply',
  'color', 'funcDef',
]);

// ─── Colors keyed by classifyMV().kind ───────────────────────────────────────
export const KIND_COLOR = {
  scalar:      '#0F9D57',
  finitePoint: '#1482C8',
  roundPoint:  '#1482C8',
  flatPoint:   '#1482C8',
  specialPoint:'#1482C8',
  twopole:     '#7A5AA8',
  tripole:     '#7A5AA8',
  quadpole:    '#7A5AA8',
  pointPair:   '#AA7500',
  conic:       '#C30A3A',
  conicPencil: '#D8567A',
  idealPoint:  '#E8A000',
  specialIdealPoint: '#E8A000',
  infinityPoint: '#E8A000',
  lineAtInfinity:  '#E8A000',
  conicAtInfinity: '#E8A000',
  pseudoscalar: '#8B93A4',
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
  ITEM('expr_2', 'pp = P1 ^ P2 ^ Iinfd'),
  ITEM('expr_3', 'P3 = point(0.5, 1.5)'),
  ITEM('expr_4', 'F = P3 ^ Iinf'),
  ITEM('expr_5', 'T = P1 ^ P2 ^ P3'),
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
  expFn: ccgaExp,
  // Named conic constructors, dispatched as inline expression-language calls.
  namedConstructors: {
    circle: circleConic,
    ellipse: ellipseConic,
    hyperbola: hyperbolaConic,
    parabola: parabolaConic,
    tilted_ellipse: tiltedEllipseConic,
    line: lineConic,
    conic: conicGeneral,
    dilator: dilator,
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
    Edil,
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
