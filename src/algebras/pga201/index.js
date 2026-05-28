// PGA(2,0,1) algebra adapter.
// Thin re-export layer over src/pga.js + spec metadata (basis, blade names,
// classifier kinds, color palette, showcase, render plan) consumed by the
// algebra-aware parser, evaluator, and Canvas.

import {
  PGA, point2D, line2D, idealPoint,
  dualOp, reverseOp,
  toEuclidean, toIdealVector, lineBaseAndDir,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from '../../pga.js';

export const ID    = 'pga201';
export const LABEL = 'PGA 2D';

// ─── Basis ──────────────────────────────────────────────────────────────────

export const ARRAY_SIZE = 8;
export const BLADE_INDEX = {
  '1': 0, e0: 1, e1: 2, e2: 3,
  e01: 4, e02: 5, e12: 6, e012: 7,
};
export const BLADE_NAMES = ['1', 'e0', 'e1', 'e2', 'e01', 'e02', 'e12', 'e012'];
// Longest-first so alternation doesn't short-circuit on prefix overlap.
export const BLADE_PATTERN = 'e012|e01|e02|e12|e0|e1|e2';

// Parse any permutation of PGA basis indices (e21 = -e12, e102 = -e012, …).
export function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some((d) => isNaN(d) || d < 0 || d > 2)) return null;
  if (new Set(digits).size !== digits.length) return null;
  let inv = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j < digits.length; j++)
      if (digits[i] > digits[j]) inv++;
  const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
  const index = BLADE_INDEX[canonical];
  return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
}

// ─── Vector-from-MV detection ───────────────────────────────────────────────
// Pure ideal direction (only e01/e02, literal or variable coefficients).
// Returns {xExpr, yExpr, deps} or null.
//   PGA 2D ideal-point convention: vy = e01 coeff,  vx = -(e02 coeff)
export function tryVectorFromMV({ components, coeffExprs, deps }) {
  const isIdealDir =
    components.every((v, i) => i === 4 || i === 5 || Math.abs(v) < 1e-10) &&
    Object.keys(coeffExprs).every((k) => +k === 4 || +k === 5);
  if (!isIdealDir) return null;
  const e01lit = components[4] || 0;
  const e02lit = components[5] || 0;
  const e01var = coeffExprs[4];
  const e02var = coeffExprs[5];
  if (Math.abs(e01lit) < 1e-10 && Math.abs(e02lit) < 1e-10 && !e01var && !e02var) return null;
  const yExpr = e01var
    ? (e01lit !== 0 ? `${e01lit} + ${e01var}` : e01var)
    : String(e01lit);
  let xExpr;
  if (e02var) {
    const neg = e02var.startsWith('-') ? e02var.slice(1) : `-${e02var}`;
    xExpr = e02lit !== 0 ? `${-e02lit} + ${neg}` : neg;
  } else {
    xExpr = String(-e02lit);
  }
  return { xExpr, yExpr, deps };
}

// Promote {vx,vy} to a grade-2 ideal point. evalMVArith's toMV() hook.
export const geomToMV = (val) => idealPoint(val.vx, val.vy);

// ─── Node types accepted under PGA ──────────────────────────────────────────
// Used by the parser to gate which constructor forms it will emit.
export const SUPPORTED_NODE_TYPES = new Set([
  'scalar', 'freePoint', 'vector', 'freeLine',
  'motorExp', 'motorApply',
  'joinLine', 'meetPoint', 'meetChain', 'triangle',
  'dual', 'reverse', 'multivector', 'mvExpr', 'list',
  'color', 'funcDef',
]);

// ─── Color palette keyed by classifyMV().kind ───────────────────────────────

// Palette: brand red/blue/green/yellow + neutrals.
export const KIND_COLOR = {
  scalar:      '#0F9D57',  // green-500
  finitePoint: '#1482C8',  // blue-500
  idealPoint:  '#E8A000',  // yellow-500
  line:        '#C30A3A',  // red-500
  idealLine:   '#E8637F',  // red-300
  pseudoscalar:'#4E5668',  // gray-700
  rotor:       '#55ABDF',  // blue-300
  translator:  '#55ABDF',  // blue-300
  motor:       '#AA7500',  // yellow-700
  reflector:   '#92072B',  // red-700
  triangle:    '#41BF82',  // green-300
  mixed:       '#8B93A4',  // gray-500
};

// Parser-type fallback when value not yet computed
export const TYPE_COLOR_FALLBACK = {
  scalar:    '#0F9D57',
  freePoint: '#1482C8',
  vector:    '#E8A000',
  motorExp:  '#55ABDF',
  triangle:  '#41BF82',
  meetChain: '#41BF82',
  list:      '#41BF82',
};

// ─── Render plan — Canvas switches on { kind, data } ────────────────────────

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
    case 'idealPoint': {
      const iv = toIdealVector(val);
      return iv ? { kind: 'positionedVector', vx: iv.vx, vy: iv.vy, ringMarker: true, tipDraggable: false } : null;
    }
    case 'line':      return { kind: 'line', L: val };
    case 'idealLine': return { kind: 'idealLine' };
    default:          return null;
  }
}

// ─── Initial showcase (motor composition) ───────────────────────────────────

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null, ...extra,
});

export const INITIAL_ITEMS = [
  ITEM('expr_0', 'P = 5.2*e01 + 5.2*e02 + e12'),
  ITEM('expr_1', 'V = vector(-6.48, 0.92)'),
  ITEM('expr_2', 't = 0', { anim: { min: 0, max: 1,    step: 0.02 } }),
  ITEM('expr_3', 'a = 0', { anim: { min: 0, max: 3.14, step: 0.05 } }),
  ITEM('expr_4', 'T = exp(t*V)'),
  ITEM('expr_5', 'R = exp(a*e12)'),
  ITEM('expr_6', 'M = R * T'),
  ITEM('expr_7', 'Q = M >>> P'),
];

// ─── Re-exports for back-compat with code that still imports from pga.js ────

export {
  PGA, point2D, line2D, idealPoint,
  dualOp, reverseOp,
  toEuclidean, toIdealVector, lineBaseAndDir,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
};

// ─── Spec object — bundled for the algebra registry ─────────────────────────

import { createEvalMVArith } from '../../graph/evalMVArith.js';
import { createNodeTypes }  from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }   from '../../graph/evaluate.js';

export const spec = {
  id: ID, label: LABEL,
  Algebra: PGA,
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
  // PGA-only constructors needed by some nodeTypes
  point2D, line2D, idealPoint,
  toEuclidean, toIdealVector, lineBaseAndDir,
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
