// PGA(2,0,1) algebra adapter.
// Thin layer over ./core.js + spec metadata (basis, blade names,
// classifier kinds, color palette, showcase, render plan) consumed by the
// algebra-aware parser, evaluator, and Canvas.

import {
  PGA, point2D, line2D, idealPoint,
  dualOp, reverseOp,
  toEuclidean, toIdealVector, lineBaseAndDir,
  classifyMV, objectWeight,
  normalizeMV, normalizeMVFinit, normalizeMVIdeal,
} from './core.js';
import { makeItem as ITEM } from '../itemFactory.js';
import { createParseBladeName } from '../bladeName.js';

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
export const parseBladeName = createParseBladeName(BLADE_INDEX, { minDigit: 0, maxDigit: 2 });

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
]);

// ─── Color palette keyed by classifyMV().kind ───────────────────────────────

export const KIND_COLOR = {
  scalar:      '#a6e3a1',
  finitePoint: '#89b4fa',
  idealPoint:  '#f9e2af',
  line:        '#cba6f7',
  idealLine:   '#cba6f7',
  pseudoscalar:'#f38ba8',
  rotor:       '#74c7ec',
  translator:  '#74c7ec',
  motor:       '#94e2d5',
  reflector:   '#fab387',
  triangle:    '#89dceb',
  mixed:       '#b4befe',
};

// Parser-type fallback when value not yet computed
export const TYPE_COLOR_FALLBACK = {
  scalar:    '#a6e3a1',
  freePoint: '#89b4fa',
  vector:    '#f9e2af',
  motorExp:  '#74c7ec',
  triangle:  '#89dceb',
  meetChain: '#89dceb',
  list:      '#89dceb',
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

// ─── Drag model ──────────────────────────────────────────────────────────────
// Blade-index conventions for interaction live here, not in Canvas/useGraph, so
// the renderer and graph layer stay algebra-agnostic.

// Drawn (vx,vy) for a vector-like value: {vx,vy} passthrough, or an ideal point
// (grade-2, e12 = 0) as its direction. Null for anything else.
export const vectorXY = (val) => {
  if (val && typeof val === 'object' && 'vx' in val) return { vx: val.vx, vy: val.vy };
  return toIdealVector(val);
};

// Is this multivector node a draggable "parametric point" — i.e. dragging it on
// the canvas maps screen (x,y) back to its coefficients? Three forms:
//   x*e01 + y*e02 (+ e12)      — variable position coefficients
//   !(y*e2 + x*e1 + e0)        — dual form with variable pre-dual coefficients
//   e01 + e12 (literal)        — literal grade-2 point, dragged by rewriting text
export function isParametricPoint(node) {
  if (!node || node.type !== 'multivector') return false;
  const { coeffExprs, components, dual } = node.params ?? {};
  if (!dual && (coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined)) return true;
  if (dual && (coeffExprs?.[3] !== undefined || coeffExprs?.[2] !== undefined)) return true;
  if (!dual && Math.abs(components?.[6] ?? 0) > 1e-10) return true;
  return false;
}

// Edits to apply when a parametric point is dragged to world (x,y).
// PGA point convention: e01 = y·w, e02 = −x·w, weight w = e12.
// Returns edit instructions consumed generically by useGraph:
//   { kind: 'scalar', name, value } — set scalar item `name`
//   { kind: 'text',   rhs }         — rewrite the node's own expression RHS
export function parametricPointEdits(node, val, x, y) {
  const { coeffExprs, components, dual } = node.params ?? {};
  const w = val?.[6] ?? 1;
  const scalarEdit = (expr, target) => {
    const m = expr?.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
    return m ? { kind: 'scalar', name: m[2], value: m[1] === '-' ? -target : target } : null;
  };
  if (!dual && (coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined))
    return [scalarEdit(coeffExprs[4], y * w), scalarEdit(coeffExprs[5], -x * w)].filter(Boolean);
  if (dual && (coeffExprs?.[3] !== undefined || coeffExprs?.[2] !== undefined))
    return [scalarEdit(coeffExprs[3], y * w), scalarEdit(coeffExprs[2], -x * w)].filter(Boolean);
  if (!dual && Math.abs(components?.[6] ?? 0) > 1e-10) {
    const f = (n) => parseFloat(n.toFixed(6));
    const term = (c, blade) => (c === 0 ? null : c === 1 ? blade : c === -1 ? `-${blade}` : `${c}*${blade}`);
    const parts = [term(f(y), 'e01'), term(f(-x), 'e02'), 'e12'].filter(Boolean);
    return [{ kind: 'text', rhs: parts.join(' + ').replace(/ \+ -/g, ' - ') }];
  }
  return [];
}

// Variable (if any) holding a point's e12 weight — the create-scalars banner
// defaults it to 1 instead of 0.
export function weightCoeffVar(node) {
  const m = node?.params?.coeffExprs?.[6]?.match(/^-?([A-Za-z_][A-Za-z0-9_]*)$/);
  return m ? m[1] : null;
}

// ─── Initial showcase (motor composition) ───────────────────────────────────

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
  // Drag model
  vectorXY, isParametricPoint, parametricPointEdits, weightCoeffVar,
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
