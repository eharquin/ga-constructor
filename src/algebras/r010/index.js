// R(0,1,0) — Complex numbers algebra adapter.
// Signature -; basis { 1, e1, i } where e1² = i² = -1.
// Every value (scalar, imaginary, complex) renders as a point in the
// complex plane: scalar a → (a,0), imaginary b*e1 → (0,b), complex → (a,b).

import Algebra from 'ganja.js';

export const ID    = 'r010';
export const LABEL = 'Complex ℂ';

export const R010 = Algebra(0, 1, 0);

// ─── Basis ──────────────────────────────────────────────────────────────────
// `i` is registered as an alias for e1 so `2i`, `exp(a*i)`, etc. all work.

export const ARRAY_SIZE  = 2;
export const BLADE_INDEX = { '1': 0, e1: 1, i: 1 };
export const BLADE_NAMES = ['1', 'e1'];
export const BLADE_PATTERN = 'e1|i';

export function parseBladeName(name) {
  if (name === 'e1' || name === 'i') return { index: 1, sign: 1 };
  return null;
}

// ─── Generic GA ops ─────────────────────────────────────────────────────────

export const dualOp = (mv) =>
  mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? R010.Dual(mv) : mv;

// Complex conjugate = grade involution (a + b·e1 → a − b·e1).
// GA "reverse" leaves grade-1 unchanged, so we use Conjugate instead.
export const reverseOp = (mv) =>
  mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? R010.Conjugate(mv) : mv;

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

// ─── Constructor ─────────────────────────────────────────────────────────────
// Used by the `freePoint` node type (and `(a, b)` syntax) to build a + b·e1.
export function point2D(a, b) {
  const r = new R010(ARRAY_SIZE);
  r[0] = a; r[1] = b;
  return r;
}

// ─── Classifier ─────────────────────────────────────────────────────────────
// Every value — plain scalar number OR MV array — is a point in the complex
// plane, so we always return finitePoint.
export function classifyMV(val) {
  if (val == null) return null;
  if (typeof val === 'number') return { kind: 'finitePoint' };
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;
  return { kind: 'finitePoint' };
}

// ─── Euclidean position ──────────────────────────────────────────────────────
export function toEuclidean(val) {
  if (val == null) return null;
  if (typeof val === 'number') return { x: val, y: 0 };
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;
  return { x: val[0] || 0, y: val[1] || 0 };
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
  if (typeof val === 'number') return Math.abs(val) || 1;
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return 1;
  return R010.Length(val) || 1;
}

// ─── Vector-from-MV detection ────────────────────────────────────────────────
// No spatial vectors in R(0,1,0).
export const tryVectorFromMV = () => null;
export const geomToMV = null;

// ─── Render plan ─────────────────────────────────────────────────────────────
// Every value renders as a point in the complex plane.
export function getRenderPlan(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    return { kind: 'list', elements, outline: null };
  }
  if (typeof val === 'number') return { kind: 'finitePoint', x: val, y: 0 };
  const cls = classifyMV(val);
  if (cls?.kind === 'finitePoint') return { kind: 'finitePoint', x: val[0] || 0, y: val[1] || 0 };
  return null;
}

// ─── Drag hooks ──────────────────────────────────────────────────────────────

// For Canvas: whether a non-dual multivector with literal components is draggable.
// R010: any value that classifies as finitePoint is draggable.
export function isLitMVPoint(_components, val) {
  return classifyMV(val)?.kind === 'finitePoint';
}

// For Canvas: whether a multivector has variable position coefficients.
// R010: real part (index 0) or imaginary part (index 1) can be variable.
export function hasDepPointCoeffs(coeffExprs) {
  return coeffExprs?.[0] !== undefined || coeffExprs?.[1] !== undefined;
}

// For useGraph.updateDepPoint: maps (x, y) to blade-index → coefficient value.
export function depPointCoords(coeffExprs, _val, x, y) {
  const result = {};
  if (coeffExprs[0] !== undefined) result[0] = x;
  if (coeffExprs[1] !== undefined) result[1] = y;
  return result;
}

// Format a complex number as an expression string for freePoint / literal drag.
// xExpr and yExpr are numeric strings or scalar variable names.
function fmtN(n) { return String(parseFloat(n.toFixed ? n.toFixed(6) : parseFloat(n))); }
export function freePointText(id, xExpr, yExpr) {
  const xNum = parseFloat(xExpr);
  const yNum = parseFloat(yExpr);
  const xIsLit = !isNaN(xNum);
  const yIsLit = !isNaN(yNum);
  const xZero  = xIsLit && Math.abs(xNum) < 1e-10;
  const yZero  = yIsLit && Math.abs(yNum) < 1e-10;

  let rhs;
  if (xZero && yZero) {
    rhs = '0';
  } else if (yZero) {
    rhs = xExpr;
  } else if (xZero) {
    if (yIsLit && Math.abs(yNum - 1) < 1e-10) rhs = 'e1';
    else if (yIsLit && Math.abs(yNum + 1) < 1e-10) rhs = '-e1';
    else rhs = `${yExpr}*e1`;
  } else {
    const yNeg = yIsLit && yNum < 0;
    if (yNeg) {
      const absY = Math.abs(yNum);
      rhs = Math.abs(absY - 1) < 1e-10 ? `${xExpr} - e1` : `${xExpr} - ${fmtN(absY)}*e1`;
    } else {
      rhs = yIsLit && Math.abs(yNum - 1) < 1e-10 ? `${xExpr} + e1` : `${xExpr} + ${yExpr}*e1`;
    }
  }
  return id ? `${id} = ${rhs}` : rhs;
}

// For useGraph.updateLiteralMVPoint — rewrite text when dragging a literal complex.
export function literalMVPointText(id, x, y) {
  return freePointText(id, fmtN(x), fmtN(y));
}

// ─── Supported node types ────────────────────────────────────────────────────
// freePoint: enabled by spec.point2D so `(a,b)` and `point(a,b)` work.
// motorExp: exp(θ·e1) = cos θ + sin θ·e1 — Euler's formula.
// motorApply (>>>): R >>> z — rotation.
// reverse (~): complex conjugate via reverseOp = R010.Conjugate.
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'freePoint', 'motorExp', 'motorApply',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color',
]);

// ─── Colors ──────────────────────────────────────────────────────────────────

export const KIND_COLOR = {
  finitePoint: '#1482C8',  // blue-500 — all complex values
  scalar:      '#0F9D57',  // green-500 — kept for TYPE_COLOR_FALLBACK
  mixed:       '#8B93A4',  // gray-500
};

export const TYPE_COLOR_FALLBACK = {
  scalar:    '#0F9D57',
  freePoint: '#1482C8',
  motorExp:  '#55ABDF',  // blue-300
  list:      '#41BF82',  // green-300
};

// ─── Initial showcase ────────────────────────────────────────────────────────

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'z = (3, 2)'),
  ITEM('expr_1', 'w = (-1.5, 1)'),
  ITEM('expr_2', 'z*w'),
  ITEM('expr_3', 'conj = ~z'),
  ITEM('expr_4', 'norm_z = |z|'),
  ITEM('expr_5', 'a = 0', { anim: { min: 0, max: 6.28, step: 0.05 } }),
  ITEM('expr_6', 'R = exp(a*e1)'),
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
  point2D,
  freePointText,
  literalMVPointText,
  isLitMVPoint,
  hasDepPointCoeffs,
  depPointCoords,
  toEuclidean,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
  getRenderPlan,
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
  info: {
    fullName: 'Complex Numbers ℝ(0,1,0) ≅ ℂ',
    signature: { p: 0, q: 1, r: 0 },
    description: 'One-generator Clifford algebra with e1² = −1. Isomorphic to the complex numbers: scalar = real part, e1 = imaginary unit i.',
    geometry: [
      { label: 'real',          formula: 'a · 1' },
      { label: 'imaginary',     formula: 'b · e1   (b · i)' },
      { label: 'complex',       formula: 'a + b · e1   (rendered as point (a, b))' },
      { label: 'modulus',       formula: '|z| = √(a² + b²)' },
      { label: 'conjugate',     formula: '~z = a − b · e1' },
      { label: 'Euler rotor',   formula: 'exp(θ·e1) = cos θ + sin θ · e1' },
      { label: 'rotation',      formula: 'z′ = R · z   (left-multiplication)' },
    ],
    subalgebras: [
      { name: 'Scalars (real line ℝ)', blades: '1' },
      { name: 'Full algebra ≅ ℂ',      blades: '1, e1' },
    ],
    notes: [
      'Every value classifies as a finite point in the complex plane — scalars sit on the real axis, e1 multiples on the imaginary axis.',
      'Reverse maps to complex conjugate (the GA reverse leaves grade-1 alone for this signature, so the adapter uses Conjugate instead).',
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
