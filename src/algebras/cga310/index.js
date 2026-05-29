// CGA(3,1) — 2D Conformal Geometric Algebra adapter.
// Signature (3,1,0): e1² = e2² = e3² = +1, e4² = -1; 4 generators, 16 blades.
//
// Null basis (user-facing constants, defined as MV combinations — NOT basis blades):
//   e0   = (e4 - e3) / 2     (origin point, null)
//   einf = e4 + e3           (point at infinity, null)
// Satisfy e0² = einf² = 0 and e0·einf = -1.
//
// Conformal point embedding:
//   P(x,y) = e0 + x·e1 + y·e2 + ½(x²+y²)·einf    (always null: P² = 0)
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
// P(x, y) = e0 + x·e1 + y·e2 + ½(x²+y²)·einf
// Expanded in MV components: P[1] = x, P[2] = y,
//   P[3] = (e0's e3 coeff) + ½r²·(einf's e3 coeff) = -½ + ½r²
//   P[4] = (e0's e4 coeff) + ½r²·(einf's e4 coeff) = +½ + ½r²
export function point2D(x, y) {
  const half_r2 = 0.5 * (x * x + y * y);
  const p = zeroMV();
  p[1] = x;
  p[2] = y;
  p[3] = -0.5 + half_r2;
  p[4] =  0.5 + half_r2;
  return p;
}

// Extract Euclidean (x, y) from a conformal point. Returns null for ideal
// (e0-coefficient ≈ 0 — i.e. the point at infinity itself).
export function toEuclidean(p) {
  if (!p || typeof p.length !== 'number' || p.length < ARRAY_SIZE) return null;
  const w = e0Coeff(p);
  if (Math.abs(w) < 1e-10) return null;
  return { x: (p[1] || 0) / w, y: (p[2] || 0) / w };
}

// ─── Generic GA ops via ganja ──────────────────────────────────────────────

export const dualOp = (mv) =>
  (mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE) ? CGA.Dual(mv) : mv;

export const reverseOp = (mv) =>
  (mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE) ? CGA.Reverse(mv) : mv;

// ─── Classifier ────────────────────────────────────────────────────────────

const EPS = 1e-10;

function gradeFlags(val) {
  const g = [false, false, false, false, false];
  if (Math.abs(val[0]) > EPS) g[0] = true;
  for (let i = 1; i <= 4;  i++) if (Math.abs(val[i]) > EPS) g[1] = true;
  for (let i = 5; i <= 10; i++) if (Math.abs(val[i]) > EPS) g[2] = true;
  for (let i = 11; i <= 14; i++) if (Math.abs(val[i]) > EPS) g[3] = true;
  if (Math.abs(val[15]) > EPS) g[4] = true;
  return g;
}

// A grade-1 vector P represents a point iff it is null (P² ≈ 0).
function isNullVector(v) {
  const sq = CGA.Mul(v, v);
  return Math.abs(sq[0] || 0) < 1e-6;
}

export function classifyMV(val) {
  if (typeof val === 'number') return { kind: 'scalar' };
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;

  const g = gradeFlags(val);
  const anyGrade = g[0] || g[1] || g[2] || g[3] || g[4];
  if (!anyGrade) return { kind: 'scalar' };       // zero MV
  if (g[0] && !g[1] && !g[2] && !g[3] && !g[4]) return { kind: 'scalar' };

  // Pure grade-1: point (null) or free vector / IPNS sphere (not null)
  if (!g[0] && g[1] && !g[2] && !g[3] && !g[4]) {
    if (isNullVector(val)) {
      const w = e0Coeff(val);
      return { kind: Math.abs(w) > EPS ? 'finitePoint' : 'idealPoint' };
    }
    return { kind: 'vector' };
  }

  // Pure grade-2: point pair
  if (!g[0] && !g[1] && g[2] && !g[3] && !g[4]) return { kind: 'pointPair' };

  // Pure grade-3: line (IPNS-dual has zero e0 component) or circle
  if (!g[0] && !g[1] && !g[2] && g[3] && !g[4]) {
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
function extractCircle(X) {
  const S = CGA.Dual(X);
  const w = e0Coeff(S);
  if (Math.abs(w) < 1e-10) return null;
  const cx = (S[1] || 0) / w;
  const cy = (S[2] || 0) / w;
  const cinfNorm = einfCoeff(S) / w;        // = ½(cx² + cy² − r²)
  const r2 = cx * cx + cy * cy - 2 * cinfNorm;
  if (r2 < 1e-12) return null;
  return { cx, cy, r: Math.sqrt(r2) };
}

// Point pair: extract two points from a grade-2 blade via
//   P± = m⁻¹ · (pp ± √(pp²))     where  m = (pp · einf), m⁻¹ = m / (m·m).
// (Standard 2D-CGA formula; works when pp² ≥ 0, i.e. pp is real-decomposable.)
function extractPointPair(pp) {
  const ppSqMV = CGA.Mul(pp, pp);
  const ppSq = ppSqMV[0] || 0;
  if (ppSq < -1e-8) return null;            // imaginary pair
  const sqrtK = Math.sqrt(Math.max(0, ppSq));

  // m = grade-1 part of (pp * einf)
  const prod = CGA.Mul(pp, EINF);
  const m = zeroMV();
  for (let i = 1; i <= 4; i++) m[i] = prod[i] || 0;

  const mSqMV = CGA.Mul(m, m);
  const mSq = mSqMV[0] || 0;
  if (Math.abs(mSq) < 1e-10) return null;

  const mInv = zeroMV();
  for (let i = 0; i < ARRAY_SIZE; i++) mInv[i] = m[i] / mSq;

  // pp ± sqrtK = grade-2 with a scalar offset
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
  return { p1: e1, p2: e2 };
}

export function getRenderPlan(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    const allPoints = elements.length > 0 && elements.every((e) => e.kind === 'finitePoint');
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
    case 'line': return { kind: 'line', L: val };
    case 'circle': {
      const c = extractCircle(val);
      return c ? { kind: 'circle', cx: c.cx, cy: c.cy, r: c.r } : null;
    }
    case 'pointPair': {
      const pp = extractPointPair(val);
      return pp ? { kind: 'pointPair', p1: pp.p1, p2: pp.p2 } : null;
    }
    default: return null;
  }
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
  'scalar', 'freePoint',
  'motorExp', 'motorApply',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color', 'funcDef',
]);

// ─── Colors keyed by classifyMV().kind ─────────────────────────────────────
export const KIND_COLOR = {
  scalar:      '#0F9D57',
  finitePoint: '#1482C8',
  idealPoint:  '#E8A000',
  vector:      '#E8A000',
  line:        '#C30A3A',
  circle:      '#C30A3A',
  pointPair:   '#AA7500',
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
  toEuclidean,
  lineBaseAndDir,
  hasDepPointCoeffs,
  getRenderPlan,
  mvConsts: { e0: E0, einf: EINF },
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
