// CGA(3,1) — 2D Conformal Geometric Algebra adapter.
// Signature (3,1,0): e1² = e2² = e3² = +1, e4² = -1; 4 generators, 16 blades.
//
// Null basis (user-facing constants, defined as MV combinations — NOT basis blades):
//   e0   = (e4 - e3) / 2     (origin point, null)
//   einf = e4 + e3           (point at infinity, null)
// Satisfy e0² = einf² = 0 and e0·einf = -1.
//
// Conformal point embedding:
//   P(x,y,r) = e0 + x·e1 + y·e2 + ½(x²+y²+r²)·einf
//   r=0 → null point (P²=0); r≠0 → round point (P²=−r²).
//
// OPNS object representation (wedge of points):
//   point pair  B = P1 ∧ P2                       (grade 2)
//   line        L = P1 ∧ P2 ∧ einf                (grade 3 containing einf)
//   circle      C = P1 ∧ P2 ∧ P3                  (grade 3 NOT containing einf)
// A line is the limit of a circle when one point goes to infinity. The classifier
// distinguishes them by the e0-coefficient of the IPNS dual.

import Algebra from 'ganja.js';

export const ID    = 'cga310';
export const LABEL = 'CGA 2D';

export const CGA = Algebra(3, 1, 0);

// ─── Basis (ganja-canonical order) ─────────────────────────────────────────
//   0: 1, 1: e1, 2: e2, 3: e3, 4: e4,
//   5: e12, 6: e13, 7: e14, 8: e23, 9: e24, 10: e34,
//   11: e123, 12: e124, 13: e134, 14: e234,
//   15: e1234

export const ARRAY_SIZE  = 16;
export const BLADE_INDEX = {
  '1': 0, e1: 1, e2: 2, e3: 3, e4: 4,
  e12: 5, e13: 6, e14: 7, e23: 8, e24: 9, e34: 10,
  e123: 11, e124: 12, e134: 13, e234: 14,
  e1234: 15,
};
export const BLADE_NAMES = [
  '1','e1','e2','e3','e4',
  'e12','e13','e14','e23','e24','e34',
  'e123','e124','e134','e234',
  'e1234',
];
// Longest-first so the parser's greedy alternation doesn't shortcut on prefixes.
export const BLADE_PATTERN =
  'e1234|e123|e124|e134|e234|e12|e13|e14|e23|e24|e34|e1|e2|e3|e4';

// Parse any permutation of CGA basis indices (e21 = -e12, e4321 = sign·e1234, …).
export function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some((d) => isNaN(d) || d < 1 || d > 4)) return null;
  if (new Set(digits).size !== digits.length) return null;
  let inv = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j < digits.length; j++)
      if (digits[i] > digits[j]) inv++;
  const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
  const index = BLADE_INDEX[canonical];
  return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
}

// ─── Null basis constants ──────────────────────────────────────────────────
// e0 and einf are not blades — they're fixed combinations of e3 and e4.
// Built once and injected into the evaluator env via spec.mvConsts so
// expressions like `P = e0 + x·e1 + y·e2 + 0.5*r²*einf` resolve them.

function zeroMV() {
  const v = new CGA(ARRAY_SIZE);
  for (let i = 0; i < ARRAY_SIZE; i++) v[i] = 0;
  return v;
}

const E0 = zeroMV();   E0[3] = -0.5; E0[4] = 0.5;   // (e4 - e3)/2
const EINF = zeroMV(); EINF[3] = 1;   EINF[4] = 1;   // e3 + e4

// Helpers — decompose the (γ·e3 + δ·e4) part of any MV into (c_inf, c_0)
// using the inverse of the null basis transformation:
//   γ·e3 + δ·e4 = c_inf·(e3+e4) + c_0·(e4-e3)/2
// ⇒ c_inf = (γ+δ)/2,   c_0 = δ - γ
function einfCoeff(v) { return ((v[3] || 0) + (v[4] || 0)) / 2; }
function e0Coeff(v)   { return  (v[4] || 0) - (v[3] || 0); }

// ─── Conformal point embedding ─────────────────────────────────────────────
// P(x, y, r) = e0 + x·e1 + y·e2 + ½(x²+y²+r²)·einf
// r=0 (default) → null point (P²=0). r≠0 → round point (P²=−r²).
// Expanded in MV components: P[1]=x, P[2]=y,
//   P[3] = -½ + ½(x²+y²+r²),  P[4] = +½ + ½(x²+y²+r²).
export function point2D(x, y, r = 0) {
  // r>0 → real round point; r<0 → imaginary (r*|r| keeps the sign of r²).
  const half_r2 = 0.5 * (x * x + y * y + r * Math.abs(r));
  const p = zeroMV();
  p[1] = x;
  p[2] = y;
  p[3] = -0.5 + half_r2;
  p[4] =  0.5 + half_r2;
  return p;
}

// Ideal round point ("conformal vector"): the round-point embedding with the
// e0 (origin) component dropped —
//   V(x, y, r) = x·e1 + y·e2 + ½(x²+y²+r²)·einf.
// Grade-1 with zero e0 weight, so it classifies as an ideal point and renders
// as an arrow from the origin to (x, y); r lives in the einf coefficient.
export function vector2D(x, y, r = 0) {
  const half = 0.5 * (x * x + y * y + r * r);
  const v = zeroMV();
  v[1] = x;
  v[2] = y;
  v[3] = half;   // einf = e3 + e4  ⇒  half·einf splits half into e3 and e4
  v[4] = half;
  return v;
}

// Euclidean direction of an ideal (e0-free) grade-1 vector — its e1/e2 part.
export function toIdealVector(v) {
  if (!v || typeof v.length !== 'number' || v.length < ARRAY_SIZE) return null;
  return { vx: v[1] || 0, vy: v[2] || 0 };
}

// Flat point constructor: F(x, y) = x·e1inf + y·e2inf + e0inf
//   = x*(e13+e14) + y*(e23+e24) - e34  (w=1, normalized weight)
export function flatPoint2D(x, y) {
  const f = zeroMV();
  f[6] = x; f[7] = x;   // e1inf = e13+e14
  f[8] = y; f[9] = y;   // e2inf = e23+e24
  f[10] = -1;            // e0inf = −e34
  return f;
}

// Extract Euclidean (x, y) from a conformal point. Returns null for ideal
// (e0-coefficient ≈ 0 — i.e. the point at infinity itself).
export function toEuclidean(p) {
  if (!p || typeof p.length !== 'number' || p.length < ARRAY_SIZE) return null;
  const w = e0Coeff(p);
  if (Math.abs(w) < 1e-10) return null;
  return { x: (p[1] || 0) / w, y: (p[2] || 0) / w };
}

// Extract (x, y, rSq) from any grade-1 conformal embedding.
// rSq = -(P·P)/w²  where  P·P = P[1]²+P[2]²+P[3]²-P[4]²  (metric +,+,+,-).
// rSq≈0 → null point; rSq>0 → real round point (radius √rSq);
// rSq<0 → imaginary round point (radius √|rSq|, drawn dashed).
// Returns null for ideal vectors (w≈0).
function extractRoundPoint(p) {
  if (!p || typeof p.length !== 'number' || p.length < ARRAY_SIZE) return null;
  const w = e0Coeff(p);
  if (Math.abs(w) < EPS) return null;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const dotPP = (p[1]||0)**2 + (p[2]||0)**2 + (p[3]||0)**2 - (p[4]||0)**2;
  const rSq = -dotPP / (w * w);
  return { x, y, rSq };
}

// ─── Flat point null-basis constants ──────────────────────────────────────
// e1inf = e1∧einf = e13+e14  (P[6]=P[7]=1)
// e2inf = e2∧einf = e23+e24  (P[8]=P[9]=1)
// e0inf = e0∧einf = −e34     (P[10]=−1)
const E1INF = zeroMV(); E1INF[6] = 1; E1INF[7] = 1;
const E2INF = zeroMV(); E2INF[8] = 1; E2INF[9] = 1;
const E0INF = zeroMV(); E0INF[10] = -1;

// ─── Generic GA ops via ganja ──────────────────────────────────────────────

export const dualOp = (mv) =>
  (mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE) ? CGA.Dual(mv) : mv;

export const reverseOp = (mv) =>
  (mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE) ? CGA.Reverse(mv) : mv;

// ─── Flat point helpers ────────────────────────────────────────────────────
// A flat point is a grade-2 blade of the form x·e1inf + y·e2inf + w·e0inf.
// In raw Cl(3,1) this expands to: P[6]=P[7]=x, P[8]=P[9]=y, P[10]=−w, P[5]=0.
// Detection: |e12|≈0 AND |e13−e14|≈0 AND |e23−e24|≈0 (relative threshold).
function isFlatPoint(p) {
  let norm2 = 0;
  for (let i = 5; i <= 10; i++) norm2 += (p[i] || 0) ** 2;
  if (norm2 < 1e-12) return false;
  const thr = Math.max(1e-6, Math.sqrt(norm2) * 1e-5);
  return Math.abs(p[5] || 0) < thr &&
         Math.abs((p[6] || 0) - (p[7] || 0)) < thr &&
         Math.abs((p[8] || 0) - (p[9] || 0)) < thr;
}

// Extract Euclidean (x, y) from a flat point (normalize by w = −e34 = −P[10]).
function extractFlatPoint(p) {
  const w = -(p[10] || 0);
  if (Math.abs(w) < EPS) return null;
  return { x: (p[7] || 0) / w, y: (p[9] || 0) / w };
}

// ─── Classifier ────────────────────────────────────────────────────────────

const EPS = 1e-10;

// Per-grade L2 norms. Used to detect grade purity even when ganja's products
// leak tiny numerical noise into "wrong" grades (e.g. Wedge introducing 1e-12
// scalar on a pure bivector).
function gradeNorms(val) {
  let n0 = Math.abs(val[0] || 0);
  let n1sq = 0, n2sq = 0, n3sq = 0;
  for (let i = 1;  i <= 4;  i++) n1sq += (val[i] || 0) ** 2;
  for (let i = 5;  i <= 10; i++) n2sq += (val[i] || 0) ** 2;
  for (let i = 11; i <= 14; i++) n3sq += (val[i] || 0) ** 2;
  const n4 = Math.abs(val[15] || 0);
  return [n0, Math.sqrt(n1sq), Math.sqrt(n2sq), Math.sqrt(n3sq), n4];
}

// A grade is "present" iff its norm is non-trivial both in absolute terms
// (> EPS) AND relative to the dominant grade (> GRADE_REL × maxNorm). This lets
// the classifier ignore floating-point noise from ganja's binary products.
// GRADE_REL is 1e-5, not tighter: ganja stores MVs as Float32 (~1e-7 relative
// precision), and a sandwich product (E G ~E) accumulates several multiplies,
// so a "pure" grade-1 point can carry grade-3 noise at ~1e-8…1e-6 of the
// dominant grade. A 1e-8 cutoff let that noise flag grade-3, misclassifying
// E >>> G (point reflected in point) as a reflector instead of a point.
const GRADE_REL = 1e-5;
function gradeFlags(val) {
  const n = gradeNorms(val);
  const maxN = Math.max(...n);
  if (maxN < EPS) return [false, false, false, false, false];
  const threshold = Math.max(EPS, maxN * GRADE_REL);
  return n.map((x) => x > threshold);
}

// A grade-1 vector P represents a point iff it is null (P² ≈ 0). Uses a
// relative threshold against ‖v‖² because ganja stores MVs as Float32Array —
// the scalar part of P·P for a point with components ~5 can drift to ~1e-5,
// well above a fixed 1e-6 cutoff. 1e-5 × ‖v‖² gives plenty of headroom for
// the float-32 noise floor while still rejecting genuine non-null vectors.
function isNullVector(v) {
  const sq = CGA.Mul(v, v);
  const scalar = Math.abs(sq[0] || 0);
  let norm2 = 0;
  for (let i = 1; i <= 4; i++) norm2 += (v[i] || 0) ** 2;
  return scalar < Math.max(1e-6, norm2 * 1e-5);
}

// An object is "ideal" (lives at infinity) when its inner product with einf
// vanishes — true for wedges of ideal points (e0-free vectors). This separates
// an ideal point pair / ideal line from their finite carriers. Relative
// threshold against ‖X‖ keeps it robust to Float32 product noise.
function dotEinfVanishes(val) {
  const d = CGA.Dot(val, EINF);
  let maxD = 0, maxX = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) {
    maxD = Math.max(maxD, Math.abs(d[i] || 0));
    maxX = Math.max(maxX, Math.abs(val[i] || 0));
  }
  return maxD < Math.max(EPS, maxX * 1e-5);
}

export function classifyMV(val) {
  if (typeof val === 'number') return { kind: 'scalar' };
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;

  const g = gradeFlags(val);
  const anyGrade = g[0] || g[1] || g[2] || g[3] || g[4];
  if (!anyGrade) return { kind: 'scalar' };       // zero MV
  if (g[0] && !g[1] && !g[2] && !g[3] && !g[4]) return { kind: 'scalar' };

  // Pure grade-1: null point, round point (non-null with finite e0), or ideal.
  if (!g[0] && g[1] && !g[2] && !g[3] && !g[4]) {
    const rp = extractRoundPoint(val);
    if (!rp) return { kind: 'idealPoint' };
    // rSq has units of length², so the null-point cutoff scales with the
    // point's distance from the origin: a sandwich (E >>> G) on a far point
    // carries Float32 rSq noise that grows with x²+y², which a fixed 1e-6
    // would mistake for a tiny imaginary round point.
    const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
    if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint' };
    return { kind: 'roundPoint', rSq: rp.rSq };
  }

  // Pure grade-2: flat point, ideal flat point, or general point pair
  if (!g[0] && !g[1] && g[2] && !g[3] && !g[4]) {
    if (isFlatPoint(val)) {
      const w = -(val[10] || 0);
      return Math.abs(w) > EPS ? { kind: 'flatPoint' } : { kind: 'idealFlatPoint' };
    }
    // Wedge of two ideal points (e0-free) ⇒ ideal point pair: no finite carrier,
    // so pp·einf vanishes and the standard pair extraction degenerates.
    if (dotEinfVanishes(val)) return { kind: 'idealPointPair' };
    return { kind: 'pointPair' };
  }

  // Pure grade-3: line (IPNS-dual has zero e0 component), circle, or — when it
  // is a wedge of three ideal points — the line at infinity (e12∧einf).
  if (!g[0] && !g[1] && !g[2] && g[3] && !g[4]) {
    if (dotEinfVanishes(val)) return { kind: 'idealLine' };
    const D = CGA.Dual(val);
    return { kind: Math.abs(e0Coeff(D)) > EPS ? 'circle' : 'line' };
  }

  // Pure grade-4: pseudoscalar
  if (!g[0] && !g[1] && !g[2] && !g[3] && g[4]) return { kind: 'pseudoscalar' };

  // Even-grade (motors). Heuristic refinement: pure scalar+e12 ⇒ rotor.
  if ((g[0] || g[2] || g[4]) && !g[1] && !g[3]) {
    const onlyRot = g[2] && Math.abs(val[5]) > EPS &&
      val.every((c, i) => i === 0 || i === 5 || Math.abs(c) < EPS);
    if (onlyRot) return { kind: 'rotor' };
    return { kind: 'motor' };
  }

  // Odd-grade (reflectors / glide reflections)
  if ((g[1] || g[3]) && !g[0] && !g[2] && !g[4]) return { kind: 'reflector' };

  return { kind: 'mixed' };
}

// ─── Norms ─────────────────────────────────────────────────────────────────

export function normalizeMVFinit(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return val;
  const norm = CGA.Length(val);
  if (norm < 1e-10) return val;
  const r = zeroMV();
  for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / norm;
  return r;
}
export const normalizeMVIdeal = normalizeMVFinit;
export const normalizeMV      = normalizeMVFinit;

export function objectWeight(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val) || 1;
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return 1;
  return CGA.Length(val) || 1;
}

// ─── Render-plan extractors ────────────────────────────────────────────────

// Line: IPNS dual is grade-1 with zero e0 component.
//   D = a·e1 + b·e2 + d·einf (other components ≈ 0).
//   Equation: a·x + b·y = d   (from P·π = -d + ax + by = 0)
export function lineBaseAndDir(X) {
  if (!X || typeof X.length !== 'number' || X.length < ARRAY_SIZE) return null;
  const D = CGA.Dual(X);
  const a = D[1] || 0, b = D[2] || 0;
  const d = einfCoeff(D);
  const len = Math.sqrt(a * a + b * b);
  if (len < 1e-10) return null;
  const ux = -b / len, uy = a / len;
  // Pick any base point on a·x + b·y = d.
  const bx = Math.abs(a) > 1e-10 ? d / a : 0;
  const by = Math.abs(a) > 1e-10 ? 0     : d / b;
  return { bx, by, ux, uy };
}

// Circle: IPNS dual is a sphere vector S = w·e0 + cx·e1 + cy·e2 + ½(p²−r²)·einf.
//   Normalize by w (the e0 coefficient); read centre + radius.
// When r² < 0 the result is an "imaginary" (a.k.a. ideal) circle — it has no
// real points but is geometrically meaningful (e.g. carrier of an inversion).
// We render it with the real radius √|r²| and flag it for the renderer.
function extractCircle(X) {
  const S = CGA.Dual(X);
  const w = e0Coeff(S);
  if (Math.abs(w) < 1e-10) return null;
  const cx = (S[1] || 0) / w;
  const cy = (S[2] || 0) / w;
  const cinfNorm = einfCoeff(S) / w;        // = ½(cx² + cy² − r²)
  const r2 = cx * cx + cy * cy - 2 * cinfNorm;
  // Zero-radius circle = the dual of a null point (a "point circle"). r² is 0
  // analytically; the cutoff scales with the centre distance to absorb Float32
  // noise (which grows with cx²+cy²). Reported with r=0 for a dot glyph.
  if (Math.abs(r2) < 1e-6 * (1 + cx * cx + cy * cy)) return { cx, cy, r: 0, imaginary: false };
  return { cx, cy, r: Math.sqrt(Math.abs(r2)), imaginary: r2 < 0 };
}

// Point pair: extract geometric properties from a grade-2 blade.
//   Real pair (ppSq ≥ 0): P± = m⁻¹ · (pp ± √(pp²))  where m = (pp · einf), m⁻¹ = m / (m·m).
//   Imaginary pair (ppSq < 0): no real points — return center + imaginary radius only.
//   rSq = ppSq / mSq is the signed radius² (half-chord² for real, negative for imaginary).
//   Center = toEuclidean(m⁻¹ · pp) is real in both cases.
function extractPointPair(pp) {
  const ppSqMV = CGA.Mul(pp, pp);
  const ppSq = ppSqMV[0] || 0;

  // m = grade-1 part of (pp * einf)
  const prod = CGA.Mul(pp, EINF);
  const m = zeroMV();
  for (let i = 1; i <= 4; i++) m[i] = prod[i] || 0;

  const mSqMV = CGA.Mul(m, m);
  const mSq = mSqMV[0] || 0;
  if (Math.abs(mSq) < 1e-10) return null;

  const mInv = zeroMV();
  for (let i = 0; i < ARRAY_SIZE; i++) mInv[i] = m[i] / mSq;

  const rSq = ppSq / mSq;
  const r = Math.sqrt(Math.abs(rSq));
  const imaginary = rSq < -1e-10;

  if (!imaginary) {
    // Real pair: extract the two Euclidean points
    const sqrtK = Math.sqrt(Math.max(0, ppSq));
    const ppPlus  = zeroMV();
    const ppMinus = zeroMV();
    for (let i = 0; i < ARRAY_SIZE; i++) { ppPlus[i] = pp[i] || 0; ppMinus[i] = pp[i] || 0; }
    ppPlus[0]  =  sqrtK;
    ppMinus[0] = -sqrtK;
    const P1 = CGA.Mul(mInv, ppPlus);
    const P2 = CGA.Mul(mInv, ppMinus);
    const e1 = toEuclidean(P1);
    const e2 = toEuclidean(P2);
    if (!e1 || !e2) return null;
    return { p1: e1, p2: e2, cx: (e1.x + e2.x) / 2, cy: (e1.y + e2.y) / 2, r, imaginary: false };
  } else {
    // Imaginary pair: center is real, direction comes from the e1/e2 part of m.
    // The two "imaginary" points are center ± r·direction (displayed as real dots).
    const centerMV = CGA.Mul(mInv, pp);
    const center = toEuclidean(centerMV);
    if (!center) return null;
    const mxy = Math.sqrt((m[1] || 0) ** 2 + (m[2] || 0) ** 2);
    if (mxy < 1e-10) return null;
    const nx = (m[1] || 0) / mxy;
    const ny = (m[2] || 0) / mxy;
    return {
      p1: { x: center.x + r * nx, y: center.y + r * ny },
      p2: { x: center.x - r * nx, y: center.y - r * ny },
      cx: center.x, cy: center.y, r, imaginary: true,
    };
  }
}

export function getRenderPlan(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    const allPoints = elements.length > 0 && elements.every((e) => e.kind === 'finitePoint' || e.kind === 'roundPoint');
    const outline = allPoints ? elements.map((e) => ({ x: e.x, y: e.y })) : null;
    return { kind: 'list', elements, outline };
  }
  if (typeof val === 'object' && 'vx' in val) return { kind: 'positionedVector', vx: val.vx, vy: val.vy };
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
    case 'line': return { kind: 'line', L: val };
    case 'idealLine': return { kind: 'idealLine' };   // line at infinity — drawn as the boundary ellipse
    case 'circle': {
      const c = extractCircle(val);
      return c ? { kind: 'circle', cx: c.cx, cy: c.cy, r: c.r, imaginary: c.imaginary } : null;
    }
    case 'flatPoint': {
      const fp = extractFlatPoint(val);
      return fp ? { kind: 'flatPoint', x: fp.x, y: fp.y } : null;
    }
    case 'idealFlatPoint': {
      // Direction from e14/e24 (e1inf/e2inf) components — rendered as a positioned vector.
      const vx = (val[7] || 0), vy = (val[9] || 0);
      const len = Math.sqrt(vx * vx + vy * vy);
      if (len < EPS) return null;
      return { kind: 'positionedVector', vx: vx / len, vy: vy / len };
    }
    case 'pointPair': {
      const pp = extractPointPair(val);
      if (!pp) return null;
      return { kind: 'pointPair', p1: pp.p1, p2: pp.p2, cx: pp.cx, cy: pp.cy, r: pp.r, imaginary: pp.imaginary };
    }
    case 'idealPoint': {
      // e0-free grade-1 vector (e.g. vector(x, y, r)) — drawn as an arrow from
      // the tail to tail+(x, y). The einf coefficient ½(x²+y²+r²) recovers the
      // round-point radius²:  rSq = 2·einf − (x²+y²), drawn as a circle at the tail.
      const x = val[1] || 0, y = val[2] || 0;
      const rSq = 2 * einfCoeff(val) - (x * x + y * y);
      return { kind: 'positionedVector', vx: x, vy: y, rSq };
    }
    default: return null;
  }
}

// ─── Alternative display basis using the null vectors e0, einf ─────────────
// CGA values become much easier to read when expressed in the conformal basis
// instead of raw e3/e4. The 16 standard blades transform into 16 display
// blades through the change-of-variable e3 = (einf − 2·e0)/2, e4 = (einf + 2·e0)/2.
// For each pair (b∧e3, b∧e4): display coeffs are (e4 − e3) and (e3 + e4)/2;
// blades containing both e3 AND e4 collapse to a single display blade with
// sign flip (e3∧e4 = −e0∧einf).

export const DISPLAY_BLADE_NAMES = [
  '1',
  'e1', 'e2', 'e0', 'einf',
  'e12', 'e1e0', 'e1einf', 'e2e0', 'e2einf', 'e0einf',
  'e12e0', 'e12einf', 'e1e0einf', 'e2e0einf',
  'e12e0einf',
];

export function toDisplayCoeffs(mv) {
  if (!mv || typeof mv.length !== 'number' || mv.length < ARRAY_SIZE) return null;
  const s = (i) => mv[i] || 0;
  const d = new Array(ARRAY_SIZE).fill(0);
  d[0]  = s(0);                       // 1
  d[1]  = s(1);                       // e1
  d[2]  = s(2);                       // e2
  d[3]  = s(4) - s(3);                // e0   = std[e4] − std[e3]
  d[4]  = (s(3) + s(4)) / 2;          // einf = (std[e3] + std[e4]) / 2
  d[5]  = s(5);                       // e12
  d[6]  = s(7) - s(6);                // e1e0  from (e13, e14)
  d[7]  = (s(6) + s(7)) / 2;          // e1einf
  d[8]  = s(9) - s(8);                // e2e0  from (e23, e24)
  d[9]  = (s(8) + s(9)) / 2;          // e2einf
  d[10] = -s(10);                     // e0einf = −e34
  d[11] = s(12) - s(11);              // e12e0   from (e123, e124)
  d[12] = (s(11) + s(12)) / 2;        // e12einf
  d[13] = -s(13);                     // e1e0einf = −e134
  d[14] = -s(14);                     // e2e0einf = −e234
  d[15] = -s(15);                     // e12e0einf = −e1234
  return d;
}

// ─── Drag-hooks for the freePoint / multivector node types ─────────────────
// CGA points have variable spatial coefficients on e1 (idx 1) and e2 (idx 2)
// — different indices from PGA's e01/e02 = [4]/[5], so we override the default.
export function hasDepPointCoeffs(coeffExprs) {
  return coeffExprs?.[1] !== undefined || coeffExprs?.[2] !== undefined;
}

// ─── Misc adapter hooks ────────────────────────────────────────────────────

export const tryVectorFromMV = () => null;   // no free-vector promotion in CGA
export const geomToMV = null;

// ─── Node types accepted under CGA ─────────────────────────────────────────
// Start conservative: support points, motors, wedge/meet, list, color, funcDef.
// Skip PGA-specific types (joinLine/meetPoint use PGA conventions for lines).
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'freePoint', 'freeFlatPoint', 'freeVector',
  'motorExp', 'motorApply',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color', 'funcDef',
]);

// ─── Colors keyed by classifyMV().kind ─────────────────────────────────────
export const KIND_COLOR = {
  scalar:      '#0F9D57',
  finitePoint: '#1482C8',
  roundPoint:  '#1482C8',
  flatPoint:      '#1482C8',
  idealFlatPoint: '#E8A000',
  idealPoint:  '#E8A000',
  vector:      '#E8A000',
  line:        '#C30A3A',
  circle:      '#C30A3A',
  idealLine:   '#E8A000',
  pointPair:   '#AA7500',
  idealPointPair: '#E8A000',
  pseudoscalar:'#4E5668',
  rotor:       '#55ABDF',
  translator:  '#55ABDF',
  motor:       '#AA7500',
  reflector:   '#92072B',
  mixed:       '#8B93A4',
};

export const TYPE_COLOR_FALLBACK = {
  scalar:    '#0F9D57',
  freePoint: '#1482C8',
  motorExp:  '#55ABDF',
  list:      '#41BF82',
};

// ─── Initial showcase: three points + their circle ─────────────────────────
// Drag any of P1/P2/P3 — C re-renders smoothly. When all three are collinear,
// C automatically reclassifies as a line.

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'P1 = (1, 0)'),
  ITEM('expr_1', 'P2 = (-1, 0.5)'),
  ITEM('expr_2', 'P3 = (0, 1)'),
  ITEM('expr_3', 'C = P1 ^ P2 ^ P3'),
];

// ─── Spec object ───────────────────────────────────────────────────────────

import { createEvalMVArith }    from '../../graph/evalMVArith.js';
import { createNodeTypes }      from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }       from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: CGA,
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
  flatPoint2D,
  vector2D,
  toEuclidean,
  toIdealVector,
  lineBaseAndDir,
  hasDepPointCoeffs,
  getRenderPlan,
  mvConsts: { e0: E0, einf: EINF, e1inf: E1INF, e2inf: E2INF, e0inf: E0INF },
  // Conformal-basis display: ExpressionPanel re-expresses MV components
  // using these names + coefficient transform when the user opts in.
  displayBladeNames: DISPLAY_BLADE_NAMES,
  toDisplayCoeffs,
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
  info: {
    fullName: '2D Conformal Geometric Algebra ℝ(3,1)',
    signature: { p: 3, q: 1, r: 0 },
    description: 'Conformal model of the 2D plane: points, lines, circles, and all angle-preserving transformations (translations, rotations, dilations, inversions). A line is a degenerate circle that passes through ∞.',
    geometry: [
      { label: 'origin (e0)',     formula: 'e0 = (e4 − e3) / 2     (null: e0² = 0)' },
      { label: 'infinity (einf)', formula: 'einf = e4 + e3         (null: einf² = 0,  e0·einf = −1)' },
      { label: 'point',           formula: 'P = e0 + x·e1 + y·e2 + ½(x²+y²)·einf' },
      { label: 'flat point',       formula: 'F = P ∧ einf  =  x·e1inf + y·e2inf + e0inf' },
      { label: 'point pair',      formula: 'B = P1 ∧ P2' },
      { label: 'line',            formula: 'L = P1 ∧ P2 ∧ einf' },
      { label: 'circle',          formula: 'C = P1 ∧ P2 ∧ P3' },
      { label: 'translator',      formula: 'T = exp(−½ (a·e1 + b·e2) · einf)' },
      { label: 'rotor',           formula: 'R = exp(−½ θ · e12)' },
      { label: 'dilator',         formula: 'D = exp(½ α · (e0 ∧ einf))' },
    ],
    subalgebras: [
      { name: 'Scalars',                    blades: '1' },
      { name: 'Even sub-algebra ℝ(3,1)⁺',   blades: '1, e12, e13, e14, e23, e24, e34, e1234' },
      { name: 'Spin(3,1) (Möbius group)',   blades: 'unit even versors — full 2D conformal transformations' },
    ],
    notes: [
      'CGA unifies lines and circles: a line is a circle through ∞. The classifier distinguishes them by the e0-coefficient of the IPNS dual of the grade-3 blade.',
      'The null basis (e0, einf) is not made of basis blades — they are linear combinations e0 = (e4−e3)/2 and einf = e4+e3. They satisfy e0² = einf² = 0 and e0·einf = −1.',
      'Conformal points satisfy the null condition P² = 0. A grade-1 vector that is not null represents an IPNS line or sphere (a "free direction" in this implementation).',
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
