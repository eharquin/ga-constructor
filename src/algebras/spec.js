// The AlgebraSpec contract.
//
// Every algebra adapter (src/algebras/<id>/index.js) exports a `spec` object
// conforming to this shape. The graph factories (createParseExpression,
// createEvalMVArith, createNodeTypes, createEvaluate), useGraph, Canvas, and
// ExpressionPanel consume it. This file is the single written description of
// that interface plus a dev-time presence check; it has no runtime behaviour
// beyond `missingSpecFields`.
//
// See docs/adding_an_algebra.md for the step-by-step guide.

/**
 * @typedef {Object} AlgebraSpec
 *
 * ── Identity ──────────────────────────────────────────────────────────────
 * @property {string} id            Unique id, e.g. 'pga201'. Also the autosave key namespace.
 * @property {string} label         Human label for the header dropdown, e.g. 'PGA 2D'.
 *
 * ── Algebra + basis ───────────────────────────────────────────────────────
 * @property {Function} Algebra     ganja `Algebra(p,q,r)` class (has static Add/Sub/Mul/Wedge/Vee/LDot/sw/Dual/Reverse/Length).
 * @property {number} arraySize     Number of blades (2^dim): PGA 8, VGA 4, CGA 16.
 * @property {Object<string,number>} bladeIndex   Blade name → array index, incl. '1' → 0.
 * @property {string[]} bladeNames  Index → blade name (length === arraySize).
 * @property {string} bladePattern  Regex alternation of blade names, longest-first (parser convenience).
 * @property {(name:string)=>({index:number,sign:number}|null)} parseBladeName  Permuted-blade aware; build via createParseBladeName().
 *
 * ── Classification + measure ──────────────────────────────────────────────
 * @property {(val:any)=>({kind:string}|null)} classifyMV   Geometric kind of a value; null for non-MV.
 * @property {(val:any)=>number} objectWeight                Visual-thickness weight.
 * @property {(val:any)=>any} normalizeMV                    General normalisation.
 * @property {(val:any)=>any} normalizeMVFinit               Finite-norm normalisation ('norm' button).
 * @property {(val:any)=>any} normalizeMVIdeal               Ideal-norm normalisation ('inorm' button).
 *
 * ── Conversions / GA ops ──────────────────────────────────────────────────
 * @property {(mv:any)=>any} dualOp                          Dual (delegates to Algebra.Dual).
 * @property {(mv:any)=>any} reverseOp                       Reverse (delegates to Algebra.Reverse).
 * @property {(v:{vx:number,vy:number})=>any} geomToMV       Promote a {vx,vy} vector to this algebra's MV.
 * @property {(parsed:{components:number[],coeffExprs:Object,deps:string[]})=>({xExpr,yExpr,deps}|null)} tryVectorFromMV
 *           Decide whether a parsed linear combination should render as a vector.
 * @property {(val:any)=>({vx:number,vy:number}|null)} vectorXY  Drawn (vx,vy) for a vector-like value (drag/anchor).
 *
 * ── Rendering ─────────────────────────────────────────────────────────────
 * @property {(val:any)=>({kind:string,[k:string]:any}|null)} getRenderPlan
 *           Map a value to a render plan; recurses over lists → {kind:'list',elements,outline}.
 * @property {Set<string>} supportedNodeTypes  Node types this algebra's parser will emit.
 * @property {Object<string,string>} KIND_COLOR           classifyMV().kind → hex color.
 * @property {Object<string,string>} TYPE_COLOR_FALLBACK  parser node.type → hex color (pre-compute fallback).
 * @property {Array} INITIAL_ITEMS  Showcase items (build with makeItem from itemFactory.js).
 *
 * ── Optional: point-embedding algebras (PGA, CGA — absent on VGA) ──────────
 * @property {(x:number,y:number)=>any} [point2D]          Euclidean point constructor.
 * @property {(a:number,b:number,c:number)=>any} [line2D]  Line constructor.
 * @property {(vx:number,vy:number)=>any} [idealPoint]     Ideal-point constructor.
 * @property {(mv:any)=>({x:number,y:number}|null)} [toEuclidean]    Extract Euclidean (x,y) from a finite point.
 * @property {(mv:any)=>({vx:number,vy:number}|null)} [toIdealVector] Extract direction from an ideal point.
 * @property {(L:any)=>({bx,by,ux,uy}|null)} [lineBaseAndDir]        Base point + direction of a line.
 *
 * ── Optional: parametric-point drag model (PGA, CGA — absent on VGA) ───────
 * @property {(node:any)=>boolean} [isParametricPoint]     Is this multivector node a draggable point?
 * @property {(node:any,val:any,x:number,y:number)=>Array} [parametricPointEdits]
 *           Edit instructions for dragging the point to (x,y): {kind:'scalar',name,value} | {kind:'text',rhs}.
 * @property {(node:any)=>(string|null)} [weightCoeffVar]  Variable holding a point's weight (create-scalars default).
 *
 * ── Optional: named MV constants (CGA's ni/no) ────────────────────────────
 * @property {Object<string,any>} [constants]  Name → MV, merged into the evaluator env, excluded from deps.
 *
 * ── Bound by the adapter after factory wiring (not hand-authored) ──────────
 * @property {Function} evalMVArith
 * @property {Function} extractMVDeps
 * @property {Object} nodeTypes
 * @property {Function} parseExpression
 * @property {Function} evaluate
 */

// Fields every spec must define (the factories assume these exist).
export const REQUIRED_SPEC_FIELDS = [
  'id', 'label', 'Algebra', 'arraySize', 'bladeIndex', 'bladeNames', 'bladePattern',
  'parseBladeName', 'classifyMV', 'objectWeight',
  'normalizeMV', 'normalizeMVFinit', 'normalizeMVIdeal',
  'dualOp', 'reverseOp', 'geomToMV', 'tryVectorFromMV', 'vectorXY',
  'getRenderPlan', 'supportedNodeTypes', 'KIND_COLOR', 'TYPE_COLOR_FALLBACK', 'INITIAL_ITEMS',
];

// Returns the list of required fields missing from a spec (empty when valid).
export function missingSpecFields(spec) {
  return REQUIRED_SPEC_FIELDS.filter((f) => spec?.[f] === undefined);
}
