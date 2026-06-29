// CCGA — Conic Conformal Geometric Algebra in ℝ(5,3).
// 8 generators, 256 blades. Embeds the 2D plane via a Veronese (quadratic) map so
// that every conic — circle, ellipse, hyperbola, parabola, line — is a single
// algebraic object.
//
// This adapter is split into focused modules:
//   product.js  — sparse Cayley-table product engine (replaces ganja's dense ops)
//   algebra.js  — ganja instance, basis, engine wiring, null basis / gauge blades
//   embed.js    — Veronese point map, named conic constructors, Euclidean readers
//   conic.js    — implicit-coefficient extraction + drawable conic geometry
//   extract.js  — dipole / n-pole / ideal-pair point recovery
//   classify.js — geometric classifier, render-plan dispatch, norms
//   display.js  — conformal null-basis display
//   index.js    — versors (exp/dilator), colors, showcase, spec assembly (this file)

import {
  CCGA, A, ARRAY_SIZE, BLADE_INDEX, BLADE_NAMES, BLADE_PATTERN, parseBladeName,
  isMV, scaleMV, zeroMV, addMV, B1, B2, B3,
  eo1, eo2, eo3, einf1, einf2, einf3, eo, einf, eob, einfb,
  Iod, Iinfd, Io, Iinf, Ieps, I, Iinv, Edil,
} from './algebra.js';
import {
  point2D, vector2D, infinityPoint2D, toEuclidean, toIdealVector,
  circleConic, ellipseConic, hyperbolaConic, parabolaConic, tiltedEllipseConic,
  lineConic, conicGeneral,
} from './embed.js';
import {
  classifyMV, objectWeight, getRenderPlan,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from './classify.js';
import { DISPLAY_BLADE_NAMES, toDisplayCoeffs } from './display.js';

export const ID    = 'ccga';
export const LABEL = 'CCGA';

// ─── Versors (transforms) ────────────────────────────────────────────────────
// Isotropic scaling versor (dilator) about the origin, scale factor s > 0.
// Closed form D = ∏ᵢ(cosh u + sinh u·(eoᵢ∧einfᵢ)), u = ½ln s.
export function dilator(s) {
  if (!(s > 0)) return null;                              // scale must be positive
  const u = 0.5 * Math.log(s), c = Math.cosh(u), sh = Math.sinh(u);
  const factor = (B) => { const f = scaleMV(sh, B); f[0] += c; return f; };
  return A.Mul(A.Mul(factor(B1), factor(B2)), factor(B3));
}

// Exponential for CCGA versor generators. ganja's analytic .Exp() is wrong here (it
// assumes a *simple* bivector), so we use scaling-and-squaring of a truncated Taylor
// series (all products delegate to the sparse engine) — exact for dilators,
// translators, rotors, and general motors alike.
export function ccgaExp(mv) {
  let norm = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) norm += Math.abs(mv[i] || 0);
  let k = 0;
  while (norm > 0.5) { norm /= 2; k++; }
  const X = scaleMV(1 / 2 ** k, mv);
  let term = zeroMV(); term[0] = 1;
  let sum  = zeroMV(); sum[0]  = 1;
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

// ─── Generic GA ops via the engine ────────────────────────────────────────────
export const dualOp    = (mv) => (isMV(mv) ? A.Dual(mv) : mv);
export const reverseOp = (mv) => (isMV(mv) ? A.Reverse(mv) : mv);

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

// ─── Re-exports for parity with the pre-split module surface ──────────────────
export {
  CCGA, ARRAY_SIZE, BLADE_NAMES, BLADE_INDEX, BLADE_PATTERN, parseBladeName,
} from './algebra.js';
export {
  point2D, vector2D, infinityPoint2D, toEuclidean, toIdealVector,
  circleConic, ellipseConic, hyperbolaConic, parabolaConic, tiltedEllipseConic,
  lineConic, conicGeneral,
} from './embed.js';
export {
  classifyMV, objectWeight, getRenderPlan,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from './classify.js';
export { DISPLAY_BLADE_NAMES, toDisplayCoeffs } from './display.js';
