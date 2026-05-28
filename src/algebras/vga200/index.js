// VGA(2,0,0) — 2D vectorial Geometric Algebra adapter.
// Signature ++; basis { 1, e1, e2, e12 }; 4-element multivector arrays.
// Drawables: vectors (v = vx*e1 + vy*e2), bivectors (b*e12), rotors (a + b*e12).
// No points, no projective lines, no translators — VGA has no projective embedding.

import Algebra from 'ganja.js';

export const ID    = 'vga200';
export const LABEL = 'VGA 2D';

export const VGA = Algebra(2, 0, 0);

// ─── Basis ──────────────────────────────────────────────────────────────────

export const ARRAY_SIZE  = 4;
export const BLADE_INDEX = { '1': 0, e1: 1, e2: 2, e12: 3 };
export const BLADE_NAMES = ['1', 'e1', 'e2', 'e12'];
export const BLADE_PATTERN = 'e12|e1|e2';

// Permuted-blade aware (e21 = -e12).
export function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some((d) => isNaN(d) || d < 1 || d > 2)) return null;
  if (new Set(digits).size !== digits.length) return null;
  let inv = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j < digits.length; j++)
      if (digits[i] > digits[j]) inv++;
  const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
  const index = BLADE_INDEX[canonical];
  return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
}

// ─── VGA constructors ───────────────────────────────────────────────────────

// Euclidean vector v = vx*e1 + vy*e2.
export const vector2D   = (vx, vy) => VGA.Vector(vx, vy);
// Bivector  b*e12 (oriented area scalar).
export const bivector2D = (b)      => VGA.Bivector(b);

// ─── Generic GA ops (delegated to ganja) ────────────────────────────────────

export const dualOp    = (mv) => mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? VGA.Dual(mv) : mv;
export const reverseOp = (mv) => mv && typeof mv.length === 'number' && mv.length >= ARRAY_SIZE ? VGA.Reverse(mv) : mv;

// ─── Classifier ─────────────────────────────────────────────────────────────
// VGA kinds:
//   scalar     — grade 0 only
//   vector     — grade 1 (e1, e2)
//   bivector   — grade 2 (e12 only)
//   rotor      — even grade: scalar + e12
//   mixed      — anything else (grade 0 + grade 1, etc.)
export function classifyMV(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return null;
  const eps = 1e-10;
  const g0 = Math.abs(val[0]) > eps;
  const g1 = Math.abs(val[1]) > eps || Math.abs(val[2]) > eps;
  const g2 = Math.abs(val[3]) > eps;

  if (!g0 && !g1 && !g2) return { kind: 'scalar' };
  if (g0 && !g1 && !g2) return { kind: 'scalar' };
  if (!g0 && g1 && !g2) return { kind: 'vector' };
  if (!g0 && !g1 && g2) return { kind: 'bivector' };
  if (g0 && !g1 && g2)  return { kind: 'rotor' };
  return { kind: 'mixed' };
}

// ─── Norms ──────────────────────────────────────────────────────────────────
// VGA(2,0,0) is non-degenerate, so finite norm = full norm = ganja's PGA.Length.
// There's no "ideal" subspace — inorm degenerates to the same finite norm.

export function normalizeMVFinit(val) {
  if (!val || typeof val.length !== 'number' || val.length < ARRAY_SIZE) return val;
  const norm = VGA.Length(val);
  if (norm < 1e-10) return val;
  const r = new VGA(ARRAY_SIZE);
  for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / norm;
  return r;
}
export const normalizeMVIdeal = normalizeMVFinit;
export const normalizeMV      = normalizeMVFinit;

// Magnitude weight for visual thickness.
export function objectWeight(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val);
  if (typeof val === 'object' && 'vx' in val) return Math.sqrt(val.vx ** 2 + val.vy ** 2);
  if (typeof val.length !== 'number' || val.length < ARRAY_SIZE) return 1;
  return VGA.Length(val) || 1;
}

// ─── Vector-from-MV detection ───────────────────────────────────────────────
// Pure grade-1 (e1, e2 only). VGA convention: vx = e1 coeff, vy = e2 coeff.
export function tryVectorFromMV({ components, coeffExprs, deps }) {
  const isPureE1E2 =
    components.every((v, i) => i === 1 || i === 2 || Math.abs(v) < 1e-10) &&
    Object.keys(coeffExprs).every((k) => +k === 1 || +k === 2);
  if (!isPureE1E2) return null;
  const e1lit = components[1] || 0;
  const e2lit = components[2] || 0;
  const e1var = coeffExprs[1];
  const e2var = coeffExprs[2];
  if (Math.abs(e1lit) < 1e-10 && Math.abs(e2lit) < 1e-10 && !e1var && !e2var) return null;
  const xExpr = e1var ? (e1lit !== 0 ? `${e1lit} + ${e1var}` : e1var) : String(e1lit);
  const yExpr = e2var ? (e2lit !== 0 ? `${e2lit} + ${e2var}` : e2var) : String(e2lit);
  return { xExpr, yExpr, deps };
}

// Promote {vx,vy} to a grade-1 VGA vector.
export const geomToMV = (val) => vector2D(val.vx, val.vy);

// ─── Render plan ────────────────────────────────────────────────────────────
// Canvas switches on { kind, data }. VGA emits:
//   { kind: 'positionedVector', vx, vy }
//   { kind: 'bivector', value }            — drawn as oriented loop at origin
//   { kind: 'rotor', angle, scalar, bivector } — arc at origin spanning 2·atan2
export function getRenderPlan(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    return { kind: 'list', elements, outline: null };
  }
  if (typeof val === 'object' && 'vx' in val) return { kind: 'positionedVector', vx: val.vx, vy: val.vy };
  const cls = classifyMV(val);
  if (!cls) return null;
  switch (cls.kind) {
    case 'vector':
      // Pure e1/e2 → arrow from origin (positioned via vectorPositions like PGA vectors).
      return { kind: 'positionedVector', vx: val[1], vy: val[2] };
    case 'bivector':
      return { kind: 'bivector', value: val[3] };
    case 'rotor':
      // Rotor R = a + b·e12 corresponds to rotation by angle θ where R = cos(θ/2) + sin(θ/2)·e12.
      // Sandwich rotation rotates a vector by 2·atan2(b, a).
      return { kind: 'rotor', angle: 2 * Math.atan2(val[3], val[0]), scalar: val[0], bivector: val[3] };
    default:
      return null;
  }
}

// ─── Node types allowed under VGA ───────────────────────────────────────────
// Notably *excludes* freePoint, freeLine, joinLine, meetPoint, meetChain,
// triangle — those depend on the projective embedding PGA gives us.
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'vector',
  'motorExp', 'motorApply',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color', 'funcDef',
]);

// ─── Colors ─────────────────────────────────────────────────────────────────

export const KIND_COLOR = {
  scalar:   '#0F9D57',  // green-500
  vector:   '#E8A000',  // yellow-500
  bivector: '#C30A3A',  // red-500
  rotor:    '#55ABDF',  // blue-300
  mixed:    '#8B93A4',  // gray-500
};

export const TYPE_COLOR_FALLBACK = {
  scalar:   '#0F9D57',
  vector:   '#E8A000',
  motorExp: '#55ABDF',
  list:     '#41BF82',
};

// ─── Initial showcase ───────────────────────────────────────────────────────

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'V = 3*e1 + 2*e2'),
  ITEM('expr_1', 'W = vector(-1, 2.5)'),
  ITEM('expr_2', 'S = V | W'),                                              // dot product (scalar — label only)
  ITEM('expr_3', 'B = V ^ W'),                                              // wedge → bivector
  ITEM('expr_4', 'a = 0', { anim: { min: 0, max: 6.28, step: 0.05 } }),    // rotation angle
  ITEM('expr_5', 'R = exp((a/2) * e12)'),                                   // rotor
  ITEM('expr_6', 'V_rot = R >>> V'),                                        // rotated vector
];

// ─── Spec object ────────────────────────────────────────────────────────────

import { createEvalMVArith } from '../../graph/evalMVArith.js';
import { createNodeTypes }  from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }   from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: VGA,
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
  getRenderPlan,
  supportedNodeTypes: SUPPORTED_NODE_TYPES,
  KIND_COLOR, TYPE_COLOR_FALLBACK,
  INITIAL_ITEMS,
};

// Bind parser + evaluator + node types in dependency order.
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
