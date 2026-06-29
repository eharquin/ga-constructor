// AACCGA — Axis-Aligned Conic Conformal Geometric Algebra in ℝ(4,2).
// 6 generators, 64 blades. The axis-aligned sibling of CCGA: a Veronese (quadratic)
// point embedding carrying x² and y² (but no cross term xy), so every axis-aligned
// conic — circle, axis-aligned ellipse/hyperbola/parabola, line — is a single object.
//
// This adapter is split into focused modules:
//   (product engine reused from ../ccga/product.js with posCount = 4)
//   algebra.js  — ganja instance, basis, engine wiring, null basis / gauge blades
//   embed.js    — Veronese point map, named conic constructors, Euclidean readers
//   conic.js    — implicit-coefficient extraction + drawable conic geometry
//   classify.js — geometric classifier, render-plan dispatch, norms
//   display.js  — conformal null-basis display
//   index.js    — exp, colors, showcase, spec assembly (this file)

import {
  AACCGA, A, ARRAY_SIZE, BLADE_INDEX, BLADE_NAMES, BLADE_PATTERN, parseBladeName,
  isMV, scaleMV, zeroMV, addMV,
  eo1, eo2, einf1, einf2, eo, einf, eob, einfb,
  Io, Iinf, Ie, I, Iinv,
} from './algebra.js';
import {
  point2D, vector2D, infinityPoint2D, toEuclidean, toIdealVector,
  circleConic, ellipseConic, hyperbolaConic, parabolaConic, lineConic, conicGeneral,
} from './embed.js';
import {
  classifyMV, objectWeight, getRenderPlan,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from './classify.js';
import { DISPLAY_BLADE_NAMES, toDisplayCoeffs } from './display.js';

export const ID    = 'aaccga';
export const LABEL = 'AACCGA';

// ─── Exponential for versor generators ───────────────────────────────────────
// ganja's analytic .Exp() assumes a simple bivector, which is wrong here, so we use
// scaling-and-squaring of a truncated Taylor series (all products via the sparse
// engine) — exact for translators, rotors, and general motors alike.
export function aaccgaExp(mv) {
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
// AACCGA points carry their spatial coordinates on e1 (idx 1) and e2 (idx 2).
export function hasDepPointCoeffs(coeffExprs) {
  return coeffExprs?.[1] !== undefined || coeffExprs?.[2] !== undefined;
}
export const tryVectorFromMV = () => null;
export const geomToMV = null;

// ─── Node types accepted under AACCGA (conservative, like CCGA) ───────────────
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'freePoint', 'freeVector',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'motorExp', 'motorApply',
  'color', 'funcDef',
]);

// ─── Colors keyed by classifyMV().kind ───────────────────────────────────────
export const KIND_COLOR = {
  scalar:        '#0F9D57',
  finitePoint:   '#1482C8',
  roundPoint:    '#1482C8',
  flatPoint:     '#1482C8',
  twopole:       '#7A5AA8',
  tripole:       '#7A5AA8',
  conicPencil:       '#D8567A',
  conicIntersection: '#D8567A',
  conic:         '#C30A3A',
  idealPoint:    '#E8A000',
  infinityPoint: '#E8A000',
  pseudoscalar:  '#8B93A4',
  mixed:         '#8B93A4',
};

export const TYPE_COLOR_FALLBACK = {
  scalar:    '#0F9D57',
  freePoint: '#1482C8',
  list:      '#41BF82',
};

// ─── Initial showcase: 4 points + the unit circle (axis-aligned) + an ellipse ─
const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'P1 = point(1, 0)'),
  ITEM('expr_1', 'P2 = point(-1, 0)'),
  ITEM('expr_2', 'P3 = point(0, 1)'),
  ITEM('expr_3', 'P4 = point(0, -1)'),
  ITEM('expr_4', 'C = P1 ^ P2 ^ P3 ^ P4 ^ eob'),
  ITEM('expr_5', 'E = ellipse(2, 1)'),
];

// ─── Spec object ─────────────────────────────────────────────────────────────
import { createEvalMVArith }     from '../../graph/evalMVArith.js';
import { createNodeTypes }       from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }        from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: AACCGA,
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
  expFn: aaccgaExp,
  // Named axis-aligned conic constructors, dispatched as inline expression calls.
  namedConstructors: {
    circle: circleConic,
    ellipse: ellipseConic,
    hyperbola: hyperbolaConic,
    parabola: parabolaConic,
    line: lineConic,
    conic: conicGeneral,
  },
  toEuclidean,
  toIdealVector,
  hasDepPointCoeffs,
  getRenderPlan,
  // Conformal null-basis display (opt-in in the panel, like CCGA).
  displayBladeNames: DISPLAY_BLADE_NAMES,
  toDisplayCoeffs,
  // Null basis + special blades, usable as identifiers in expressions.
  mvConsts: {
    eo1, eo2, einf1, einf2,
    eo, einf, eob, einfb,
    Io, Iinf, Ie, I, Iinv,
  },
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
  info: {
    fullName: 'Axis-Aligned Conic Conformal Geometric Algebra ℝ(4,2)',
    signature: { p: 4, q: 2, r: 0 },
    description: 'Axis-aligned conic model of the 2D plane: a quadratic (Veronese) point embedding carrying x² and y² (no cross term), in which every axis-aligned conic — circle, axis-aligned ellipse/hyperbola/parabola, line — is a single algebraic object. The simpler sibling of CCGA.',
    geometry: [
      { label: 'origin (eo)',     formula: 'eo = eo1 + eo2          (null: eo² = 0)' },
      { label: 'infinity (einf)', formula: 'einf = (einf1+einf2)/2  (null,  eo·einf = −1)' },
      { label: 'point',           formula: 'p = eo + x·e1 + y·e2 + ½x²·einf1 + ½y²·einf2' },
      { label: 'round point',     formula: 'p − ½r²·einf            (p² = +r²)' },
      { label: 'conic',           formula: 'C = p1 ^ p2 ^ p3 ^ p4 ^ eob   (grade 5, OPNS)' },
    ],
    subalgebras: [
      { name: 'Scalars', blades: '1' },
    ],
    notes: [
      'AACCGA lives in ℝ(4,2): generators e1,e2 square to +1 (Euclidean), e3,e4 to +1, e5,e6 to −1. The null basis eo_i = e₊ᵢ+e₋ᵢ, einf_i = (e₋ᵢ−e₊ᵢ)/2 are combinations, not basis blades.',
      'The point embedding is a quadratic (Veronese) map carrying x² and y² but no cross term xy — so a single grade-1 vector encodes an axis-aligned conic Ax²+By²+Dx+Ey+F=0.',
      'A conic through 4 points is C = p1∧p2∧p3∧p4∧eōbar (grade 5, the n−1 OPNS form); its dual is the grade-1 IPNS conic vector.',
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

// ─── Re-exports for parity with the CCGA module surface ───────────────────────
export {
  AACCGA, ARRAY_SIZE, BLADE_NAMES, BLADE_INDEX, BLADE_PATTERN, parseBladeName,
} from './algebra.js';
export {
  point2D, vector2D, infinityPoint2D, toEuclidean, toIdealVector,
  circleConic, ellipseConic, hyperbolaConic, parabolaConic, lineConic, conicGeneral,
} from './embed.js';
export {
  classifyMV, objectWeight, getRenderPlan,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from './classify.js';
export { DISPLAY_BLADE_NAMES, toDisplayCoeffs } from './display.js';
