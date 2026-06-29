// CCGA core — the ganja Algebra instance, basis metadata, sparse-product wiring,
// the null working basis / gauge blades, and small grade primitives shared by the
// rest of the adapter. This is the foundation module: every other CCGA file builds
// on the instance and constants defined here.
//
// ganja note: Algebra(5,3) defaults to a *graded* representation that breaks the
// flat-array contract every adapter relies on and crashes Dual. We force the flat
// 256-element representation with `graded:false`.
//
// numeric base type: ganja elements default to Float32Array (~7 digits). The conic
// pipeline raises magnitudes to high powers (det3 cubic; the degenerate-pencil
// Cardano tail squares/cubes those and then cancels), which Float32 cannot hold.
// `baseType:Float64Array` (supported for flat generators) gives ~16 digits and no
// real perf change (V8 numbers are f64 natively).
//
// Orthogonal (diagonal) basis — ganja indices 1..8:
//   e1, e2          → Euclidean directions          (square +1)
//   e3, e4, e5      → e₊₁, e₊₂, e₊₃                  (square +1)
//   e6, e7, e8      → e₋₁, e₋₂, e₋₃                  (square −1)
//
// Null working basis (combinations, exposed as mvConsts):
//   eo_i   = e₊ᵢ + e₋ᵢ        einf_i = (e₋ᵢ − e₊ᵢ)/2     (eo_i·einf_i = −1)
//   eo = eo1+eo2   einf = (einf1+einf2)/2              (eo·einf = −1)

import Algebra from 'ganja.js';
import { createEngine } from './product.js';

export const CCGA = Algebra({ p: 5, q: 3, graded: false, baseType: Float64Array });
export const A = CCGA;

export const ARRAY_SIZE = 256;
export const EPS = 1e-10;

// ─── Basis metadata (generated from ganja's canonical ordering) ──────────────
const BASIS = A.describe().basis;                      // ['1','e1',…,'e12345678']
export { BASIS };
export const BLADE_NAMES = BASIS;
export const BLADE_INDEX = Object.fromEntries(BASIS.map((n, i) => [n, i]));
// Grade of each index — generators are single-digit (1..8), so grade = len − 1.
export const GRADES = BASIS.map((n) => (n === '1' ? 0 : n.length - 1));
// Longest-first alternation so the parser's greedy regex never shortcuts on a prefix.
export const BLADE_PATTERN = BASIS.filter((n) => n !== '1')
  .sort((a, b) => b.length - a.length)
  .join('|');

// ─── Sparse product engine ───────────────────────────────────────────────────
// Override ganja's dense 256-dim products with sparse, support-iterating kernels
// (see product.js). Done *here*, before any constant below is built, so the whole
// adapter — load-time constants, classify gauges, exp/extract, and the shared
// evalMVArith/nodeTypes (which all reach products through these static methods) —
// runs on the fast path. ganja still backs the rare .Exp/.Log/.Inverse getters.
const _engine = createEngine({ A, bladeNames: BASIS, bladeIndex: BLADE_INDEX, grades: GRADES, arraySize: ARRAY_SIZE });
A.Mul     = _engine.mul;
A.Wedge   = _engine.wedge;
A.Dot     = _engine.dot;
A.LDot    = _engine.ldot;
A.Vee     = _engine.vee;
A.sw      = _engine.sw;
A.Dual    = _engine.dual;
A.Reverse = _engine.reverse;
A.Length  = _engine.length;

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
export const isMV = (v) => v && typeof v.length === 'number' && v.length >= ARRAY_SIZE;
export function zeroMV() { const v = new A(); v.fill(0); return v; }
export function bvec(i)  { const v = zeroMV(); v[i] = 1; return v; }
export const scaleMV = (s, v) => { const r = zeroMV(); for (let i = 0; i < ARRAY_SIZE; i++) r[i] = (v[i] || 0) * s; return r; };
export const addMV   = (...xs) => xs.reduce((a, b) => A.Add(a, b));
export const subMV   = (a, b) => A.Sub(a, b);

// ─── Null basis + special blades (built once via MV arithmetic) ──────────────
const e1 = bvec(1), e2 = bvec(2);
const ep1 = bvec(3), ep2 = bvec(4), ep3 = bvec(5);
const em1 = bvec(6), em2 = bvec(7), em3 = bvec(8);
export { e1, e2 };

export const eo1 = addMV(ep1, em1), eo2 = addMV(ep2, em2), eo3 = addMV(ep3, em3);
export const einf1 = scaleMV(0.5, subMV(em1, ep1));
export const einf2 = scaleMV(0.5, subMV(em2, ep2));
export const einf3 = scaleMV(0.5, subMV(em3, ep3));

export const eo      = addMV(eo1, eo2);
export const einf    = scaleMV(0.5, addMV(einf1, einf2));
export const eob   = subMV(eo1, eo2);
export const einfb = scaleMV(0.5, subMV(einf1, einf2));

export const Iod   = A.Wedge(eob, eo3);                       // grade-2 origin gauge
export const Iinfd = A.Wedge(subMV(einf1, einf2), einf3);     // grade-2 infinity gauge
export const Io    = A.Wedge(A.Wedge(eo1, eo2), eo3);         // grade-3
export const Iinf  = A.Wedge(A.Wedge(einf1, einf2), einf3);   // grade-3
export const Ieps  = A.Wedge(e1, e2);                         // Euclidean pseudoscalar
export const I     = A.Wedge(A.Wedge(Ieps, Iinf), Io);        // grade-8 pseudoscalar
export const I2    = A.Mul(I, I)[0] || -1;                    // = −1
export const Iinv  = scaleMV(1 / I2, I);                      // = −I

// Dilation (scaling) generators — hyperbolic bivectors with (eoᵢ∧einfᵢ)² = +1.
// Their sum Edil is the isotropic scaling generator: exp(½ln(s)·Edil) scales by s.
export const B1 = A.Wedge(eo1, einf1);
export const B2 = A.Wedge(eo2, einf2);
export const B3 = A.Wedge(eo3, einf3);
export const Edil = addMV(B1, B2, B3);

// Flat-point reference blades. A flat point p∧Iinf collapses (the einf parts of p
// wedge to 0 against Iinf) to  eo∧Iinf + x·(e1∧Iinf) + y·(e2∧Iinf), so (x,y) read
// off by ratio — Bx/By are the only ones carrying e1/e2, giving unique signature indices.
export const FP_B0 = A.Wedge(eo, Iinf);
export const FP_BX = A.Wedge(e1, Iinf);
export const FP_BY = A.Wedge(e2, Iinf);
const argmaxAbs = (mv) => {
  let bi = 0, bv = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) { const a = Math.abs(mv[i] || 0); if (a > bv) { bv = a; bi = i; } }
  return bi;
};
export const FP_I0 = argmaxAbs(FP_B0), FP_IX = argmaxAbs(FP_BX), FP_IY = argmaxAbs(FP_BY);

// Reciprocal eo-plane bivectors for reading einfᵢ∧einfⱼ coefficients (extractIdealPair).
export const EOW12 = A.Wedge(eo1, eo2), EOW13 = A.Wedge(eo1, eo3), EOW23 = A.Wedge(eo2, eo3);
export const scalarOf = (mv) => (typeof mv === 'number' ? mv : (mv[0] || 0));

// ─── Blade squares / scalar square ───────────────────────────────────────────
// Square of each basis blade as a scalar: e_S² = (−1)^{k(k−1)/2} · Π metric(dᵢ)
// (generators e1..e5 square +1, e6..e8 square −1). Lets us read off the scalar part
// of any MV's geometric square Mul-free: ⟨v²⟩₀ = Σ v[i]²·BLADE_SQUARE[i].
const genMetric = (d) => (d <= 5 ? 1 : -1);
export const BLADE_SQUARE = BLADE_NAMES.map((name) => {
  if (name === '1') return 1;
  const digits = name.slice(1).split('').map(Number);
  const k = digits.length;
  let s = ((k * (k - 1) / 2) % 2) ? -1 : 1;
  for (const d of digits) s *= genMetric(d);
  return s;
});
export function scalarSquare(mv) {
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) { const c = mv[i]; if (c) s += c * c * BLADE_SQUARE[i]; }
  return s;
}

// ─── Grade flags ─────────────────────────────────────────────────────────────
// Per-grade L2 norms; a grade is "present" if its norm clears both an absolute
// floor and a relative cutoff against the dominant grade (noise guard).
export function gradeFlags(val) {
  const sq = new Array(9).fill(0);
  for (let i = 0; i < ARRAY_SIZE; i++) { const c = val[i] || 0; sq[GRADES[i]] += c * c; }
  const n = sq.map(Math.sqrt);
  const maxN = Math.max(...n);
  if (maxN < EPS) return n.map(() => false);
  const thr = Math.max(EPS, maxN * 1e-5);
  return n.map((x) => x > thr);
}
export const onlyGrade = (g, k) => g[k] && g.every((p, i) => i === k || !p);
