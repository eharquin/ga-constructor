// R(0,1,0) — Complex numbers algebra adapter.
// Signature -; basis { 1, e1 } where e1² = -1 (the imaginary unit i).
// Multivectors are 2-element arrays [re, im].
// Drawables: complex numbers rendered as points in the complex plane (re, im).

import Algebra from 'ganja.js';

export const ID    = 'r010';
export const LABEL = 'Complex ℂ';

export const R010 = Algebra(0, 1, 0);

// ─── Basis ──────────────────────────────────────────────────────────────────

export const ARRAY_SIZE  = 2;
export const BLADE_INDEX = { '1': 0, e1: 1 };
export const BLADE_NAMES = ['1', 'e1'];
// R(0,1,0) has only one basis vector: e1.
export const BLADE_PATTERN = 'e1';

export function parseBladeName(name) {
  if (name !== 'e1') return null;
  return { index: 1, sign: 1 };
}

// ─── Generic GA ops ─────────────────────────────────────────────────────────

export const dualOp = (mv) => mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? R010.Dual(mv) : mv;
// Complex conjugate = grade involution (negates odd-grade parts: a + b·e1 → a − b·e1).
// GA "reverse" keeps grade-1 unchanged, so we use Conjugate instead.
export const reverseOp = (mv) => mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? R010.Conjugate(mv) : mv;

// Closed-form exponential: exp(a + b·e1) = eᵃ·(cos b + sin b·e1).
// Ganja's Exp() doesn't handle odd-grade inputs for this signature.
export function expFn(mv) {
  const a = mv[0] || 0;
  const b = mv[1] || 0;
  const ea = Math.exp(a);
  const r = new R010(ARRAY_SIZE);
  r[0] = ea * Math.cos(b);
  r[1] = ea * Math.sin(b);
  return r;
}

// ─── Classifier ─────────────────────────────────────────────────────────────
// Kinds:
//   scalar    — real only (no imaginary part)
//   imaginary — imaginary only (0 + b·e1)
//   complex   — both real and imaginary parts (the generic case)

export function classifyMV(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;
  const eps = 1e-10;
  const hasRe = Math.abs(val[0]) > eps;
  const hasIm = Math.abs(val[1]) > eps;

  if (!hasRe && !hasIm) return { kind: 'scalar' };
  if (hasRe  && !hasIm) return { kind: 'scalar' };
  if (!hasRe && hasIm)  return { kind: 'imaginary' };
  return { kind: 'complex' };
}

// ─── Euclidean position ──────────────────────────────────────────────────────
// Complex number a + b·e1 lives at (a, b) in the complex plane.
export function toEuclidean(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;
  return { x: val[0], y: val[1] };
}

// ─── Norms ──────────────────────────────────────────────────────────────────

export function normalizeMVFinit(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return val;
  const norm = R010.Length(val);
  if (norm < 1e-10) return val;
  const r = new R010(ARRAY_SIZE);
  for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / norm;
  return r;
}
export const normalizeMVIdeal = normalizeMVFinit;
export const normalizeMV      = normalizeMVFinit;

export function objectWeight(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val);
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return 1;
  return R010.Length(val) || 1;
}

// ─── Vector-from-MV detection ────────────────────────────────────────────────
// No spatial vectors in R(0,1,0) — nothing to detect.
export const tryVectorFromMV = () => null;
export const geomToMV = null;

// ─── Render plan ─────────────────────────────────────────────────────────────
// Complex numbers (and pure imaginaries) render as points in the complex plane.
// Scalars are panel-only.
export function getRenderPlan(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    return { kind: 'list', elements, outline: null };
  }
  const cls = classifyMV(val);
  if (!cls) return null;
  switch (cls.kind) {
    case 'complex':
    case 'imaginary':
      return { kind: 'finitePoint', x: val[0], y: val[1] };
    default:
      return null;
  }
}

// ─── Supported node types ────────────────────────────────────────────────────
// No projective geometry (no points/lines/motors in the PGA sense).
// motorExp: exp(θ·e1) = cos θ + sin θ·e1  — Euler's formula.
// motorApply (>>>): R >>> z = R·z·~R       — rotation in the complex plane.
// reverse (~): complex conjugate.
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'motorExp', 'motorApply',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
]);

// ─── Colors ──────────────────────────────────────────────────────────────────

export const KIND_COLOR = {
  scalar:    '#a6e3a1',  // green
  imaginary: '#fab387',  // peach
  complex:   '#89dceb',  // sky blue
  mixed:     '#b4befe',  // lavender
};

export const TYPE_COLOR_FALLBACK = {
  scalar:    '#a6e3a1',
  motorExp:  '#89dceb',
  list:      '#cba6f7',
};

// ─── Initial showcase ────────────────────────────────────────────────────────
// Demonstrates: complex arithmetic, conjugate, modulus, Euler's formula.

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'z = 3 + 2*e1'),
  ITEM('expr_1', 'w = -1.5 + e1'),
  ITEM('expr_2', 'z*w'),
  ITEM('expr_3', 'conj = ~z'),
  ITEM('expr_4', 'norm_z = |z|'),
  ITEM('expr_5', 'a = 0', { anim: { min: 0, max: 6.28, step: 0.05 } }),
  ITEM('expr_6', 'R = exp(a * e1)'),
  ITEM('expr_7', 'Rz = R * z'),
];

// ─── Spec object ─────────────────────────────────────────────────────────────

import { createEvalMVArith }    from '../../graph/evalMVArith.js';
import { createNodeTypes }      from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }       from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: R010,
  arraySize: ARRAY_SIZE,
  bladeIndex: BLADE_INDEX,
  bladeNames: BLADE_NAMES,
  bladePattern: BLADE_PATTERN,
  parseBladeName,
  tryVectorFromMV,
  geomToMV,
  dualOp, reverseOp,
  expFn,
  toEuclidean,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
  getRenderPlan,
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
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
