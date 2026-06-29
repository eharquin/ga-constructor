// AACCGA core — the ganja Algebra instance, basis metadata, sparse-product wiring,
// the null working basis / gauge blades, and small grade primitives shared by the
// rest of the adapter. The axis-aligned sibling of CCGA: ℝ(4,2), 64 blades, two null
// pairs (no cross-term einf3), so it models axis-aligned conics Ax²+By²+Dx+Ey+F=0.
//
// ganja note: as with CCGA, force the flat 64-element representation with
// `graded:false`; `baseType:Float64Array` keeps the conic pipeline's high powers exact.
//
// Orthogonal (diagonal) basis — ganja indices 1..6:
//   e1, e2     → Euclidean directions   (square +1)
//   e3, e4     → e₊₁, e₊₂               (square +1)
//   e5, e6     → e₋₁, e₋₂               (square −1)
//
// Null working basis (combinations, exposed as mvConsts):
//   eo_i = e₊ᵢ + e₋ᵢ        einf_i = (e₋ᵢ − e₊ᵢ)/2     (eo_i·einf_i = −1)
//   eo = eo1+eo2   einf = (einf1+einf2)/2              (eo·einf = −1)

import Algebra from 'ganja.js';
import { createEngine } from '../ccga/product.js';

export const AACCGA = Algebra({ p: 4, q: 2, graded: false, baseType: Float64Array });
export const A = AACCGA;

export const ARRAY_SIZE = 64;
export const EPS = 1e-10;

// ─── Basis metadata (generated from ganja's canonical ordering) ──────────────
const BASIS = A.describe().basis;                      // ['1','e1',…,'e123456']
export { BASIS };
export const BLADE_NAMES = BASIS;
export const BLADE_INDEX = Object.fromEntries(BASIS.map((n, i) => [n, i]));
// Grade of each index — generators are single-digit (1..6), so grade = len − 1.
export const GRADES = BASIS.map((n) => (n === '1' ? 0 : n.length - 1));
// Longest-first alternation so the parser's greedy regex never shortcuts on a prefix.
export const BLADE_PATTERN = BASIS.filter((n) => n !== '1')
  .sort((a, b) => b.length - a.length)
  .join('|');

// ─── Sparse product engine ───────────────────────────────────────────────────
// Reuse CCGA's sparse engine (one shared implementation) with this algebra's metric
// (posCount = 4 → generators e5,e6 square −1) and size. Done before any constant
// below is built, so the whole adapter runs on the fast path.
const _engine = createEngine({ A, bladeNames: BASIS, bladeIndex: BLADE_INDEX, grades: GRADES, arraySize: ARRAY_SIZE, posCount: 4 });
A.Mul     = _engine.mul;
A.Wedge   = _engine.wedge;
A.Dot     = _engine.dot;
A.LDot    = _engine.ldot;
A.Vee     = _engine.vee;
A.sw      = _engine.sw;
A.Dual    = _engine.dual;
A.Reverse = _engine.reverse;
A.Length  = _engine.length;

// Parse any permutation of AACCGA basis indices (e21 = −e12, …). Digits 1..6.
export function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some((d) => isNaN(d) || d < 1 || d > 6)) return null;
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
const ep1 = bvec(3), ep2 = bvec(4);
const em1 = bvec(5), em2 = bvec(6);
export { e1, e2 };

export const eo1 = addMV(ep1, em1), eo2 = addMV(ep2, em2);
export const einf1 = scaleMV(0.5, subMV(em1, ep1));
export const einf2 = scaleMV(0.5, subMV(em2, ep2));

export const eo    = addMV(eo1, eo2);
export const einf  = scaleMV(0.5, addMV(einf1, einf2));
export const eob   = subMV(eo1, eo2);
export const einfb = scaleMV(0.5, subMV(einf1, einf2));

export const Io    = A.Wedge(eo1, eo2);        // grade-2 origin blade
export const Iinf  = A.Wedge(einf1, einf2);    // grade-2 infinity blade
export const Ie    = A.Wedge(e1, e2);          // Euclidean pseudoscalar
export const I     = A.Wedge(A.Wedge(Io, Iinf), Ie);  // grade-6 pseudoscalar
export const I2    = A.Mul(I, I)[0] || -1;     // = −1 in Cl(4,2)
export const Iinv  = scaleMV(1 / I2, I);       // = −I

export const scalarOf = (mv) => (typeof mv === 'number' ? mv : (mv[0] || 0));

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

// ─── Blade squares / scalar square ───────────────────────────────────────────
// Square of each basis blade as a scalar: e_S² = (−1)^{k(k−1)/2} · Π metric(dᵢ)
// (generators e1..e4 square +1, e5..e6 square −1). Lets us read off the scalar part
// of any MV's geometric square Mul-free: ⟨v²⟩₀ = Σ v[i]²·BLADE_SQUARE[i].
const genMetric = (d) => (d <= 4 ? 1 : -1);
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
  const sq = new Array(7).fill(0);
  for (let i = 0; i < ARRAY_SIZE; i++) { const c = val[i] || 0; sq[GRADES[i]] += c * c; }
  const n = sq.map(Math.sqrt);
  const maxN = Math.max(...n);
  if (maxN < EPS) return n.map(() => false);
  const thr = Math.max(EPS, maxN * 1e-5);
  return n.map((x) => x > thr);
}
export const onlyGrade = (g, k) => g[k] && g.every((p, i) => i === k || !p);
