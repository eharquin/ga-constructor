# Adding a new algebra

An algebra is one file: `src/algebras/<id>/index.js`, exporting a `spec` object
(optionally a `core.js` beside it for the heavy math, as PGA does). Read
[architecture.md](./architecture.md) first for how the spec is consumed. The
authoritative field list is the `@typedef AlgebraSpec` in `src/algebras/spec.js`;
a dev-time check (`missingSpecFields`) warns in the console if a registered spec is
missing a required field.

This guide walks the interface, then works a full example: **CGA (2D conformal,
Cl(3,1))** drawing points, lines, circles, and point pairs.

## The spec, field by field

### Identity & basis (required)
- `id`, `label` — unique id and the dropdown label.
- `Algebra` — a ganja `Algebra(p,q,r)` class. ganja gives you the static ops
  (`Add`, `Sub`, `Mul`, `Wedge`, `Vee`, `LDot`, `sw`, `Dual`, `Reverse`, `Length`)
  and instance methods (`.Scale`, `.Grade`, `.VLength`, `.Negative`, `.Exp`,
  `.Log`, `.Normalized`).
- `arraySize` = 2^dim. `bladeIndex` (name→index incl. `'1'`→0), `bladeNames`
  (index→name), `bladePattern` (regex alternation, longest names first).
- `parseBladeName` — build with `createParseBladeName(bladeIndex, {minDigit,maxDigit})`
  from `src/algebras/bladeName.js`. Handles permuted blades (`e21 = -e12`).

### Classification & measure (required)
- `classifyMV(val) → { kind } | null` — the **geometric** kind, used for color and
  rendering. Guard non-MV input (`if (!val || typeof val.length !== 'number' …)`).
  Prefer `mv.Grade(k).VLength > eps` to test "is grade k present" rather than
  naming blade indices — it scales to 16-blade algebras.
- `objectWeight(val) → number` — visual thickness weight.
- `normalizeMV` / `normalizeMVFinit` / `normalizeMVIdeal` — the general / `norm`
  button / `inorm` button normalisers. Divide by `Length` then `.Scale`, or use
  `.Normalized`. **See the metric caveat below.**

### Conversions & GA ops (required)
- `dualOp`, `reverseOp` — delegate to `Algebra.Dual` / `Algebra.Reverse`.
- `geomToMV({vx,vy}) → MV` — promote a vector to your MV.
- `tryVectorFromMV(parsed) → {xExpr,yExpr,deps} | null` — decide if a parsed linear
  combination should render as a vector (e.g. PGA pure-ideal, VGA grade-1).
- `vectorXY(val) → {vx,vy} | null` — the drawn direction of a vector-like value
  (used by snapping/anchors). No blade indices leak past this.

### Rendering (required)
- `getRenderPlan(val) → { kind, … } | null`. Reuse existing kinds where they fit
  (`finitePoint`, `line`, `positionedVector`, `polygon`); add new kinds for new
  shapes. Recurse over lists into `{ kind:'list', elements, outline }`.
- `supportedNodeTypes` — a `Set` of node types your parser may emit (gate out what
  doesn't apply, e.g. VGA omits `freePoint`, `joinLine`, `meetChain`).
- `KIND_COLOR` (kind→hex), `TYPE_COLOR_FALLBACK` (node.type→hex), `INITIAL_ITEMS`
  (showcase — build with `makeItem` from `src/algebras/itemFactory.js`).

### Optional: point-embedding algebras (PGA, CGA — not VGA)
- `point2D`, `line2D`, `idealPoint` constructors; `toEuclidean`, `toIdealVector`,
  `lineBaseAndDir`. Their presence is what unlocks the point/line node types.
- Parametric-point drag: `isParametricPoint(node)`, `parametricPointEdits(node,val,
  x,y)`, `weightCoeffVar(node)`. Omit them and points simply aren't drag-rewritable.

### Optional: named constants
- `constants` — a map `name → MV` (e.g. `{ ni, no }`) merged into the evaluator's
  environment and excluded from graph deps.

### Wiring (every adapter ends the same way)
```js
import { createEvalMVArith } from '../../graph/evalMVArith.js';
import { createNodeTypes }   from '../../graph/nodeTypes.js';
import { createParseExpression } from '../../graph/parseExpression.js';
import { createEvaluate }    from '../../graph/evaluate.js';

const _evaluator = createEvalMVArith(spec);
const _nodeTypes = createNodeTypes(spec, _evaluator);
const _parse     = createParseExpression(spec, _evaluator);
const _evaluate  = createEvaluate(spec, _nodeTypes);
spec.evalMVArith = _evaluator.evalMVArith;
spec.extractMVDeps = _evaluator.extractMVDeps;
spec.nodeTypes = _nodeTypes;
spec.parseExpression = _parse;
spec.evaluate = _evaluate;
export default spec;
```
Then register it in `src/algebras/index.js` (`ALGEBRAS` array). The dropdown,
autosave namespace, and saved-graph tagging pick it up automatically.

## ganja conventions to know

- **`~` is ours, not ganja's.** In ganja's own operator overloading `~a` is the
  *Conjugate*; in this app the `~` token means **Reverse** (we call `Algebra.Reverse`).
  Likewise `!a` is the dual.
- **`|` is left contraction here.** ganja exposes `Dot` (symmetric) and `LDot`
  (left contraction). The app's `|` maps to `Algebra.LDot`.
- **`Length`/`Normalized` are *metric*.** They use the algebra's signature, so a
  degenerate or null direction has length 0:
  - PGA: `e0² = 0`, so the ideal part has metric length 0 — the ideal norm is
    computed via the dual (`Length(Dual(x))`).
  - CGA: null vectors (points) have metric length 0 — you normalise a conformal
    point by `−(X·ni)`, not by `Length`.
  So delegate the *finite/Euclidean* path to `.Normalized`/`Length`, but keep a
  custom path for the degenerate/null directions.

## Worked example: CGA (2D conformal, Cl(3,1))

Goal: render points, lines, circles, and point pairs in the same 2D canvas.

1. **Algebra & basis.** `Algebra = Algebra(3,1)`, `arraySize = 16`. Fill
   `bladeIndex`/`bladeNames` from ganja's Cl(3,1) basis order;
   `parseBladeName = createParseBladeName(bladeIndex, {minDigit:1, maxDigit:4})`.

2. **Null basis as constants.** Define `no` (origin) and `ni` (infinity) and expose
   them via `spec.constants = { no, ni }` so `A ^ B ^ ni` can name `ni`.
   *Known follow-up:* constants resolve inside `evalMVArith` (so `mvExpr` works);
   for `^`/`&` operand parsing, `parseInlineGeom` in `parseExpression.js` must also
   recognise constant names (today a bare id there becomes a node ref). Add that
   when wiring the CGA showcase.

3. **Point up-projection.** `point2D(x,y)` = `no + x·e1 + y·e2 + ½(x²+y²)·ni`
   (a grade-1 null vector). `toEuclidean(C)` = normalise by `−(C·ni)`, then read
   `e1`/`e2`. The generic `freePoint` drag path then works with no new drag code.

4. **Classifier.** Distinguish the renderable kinds — `finitePoint`, `line`,
   `circle`, `pointPair` — plus non-drawn versors (`rotor`, `translator`, `dilator`,
   `motor`), `scalar`, `pseudoscalar`, `mixed`. Use grade structure
   (`Grade(k).VLength`) plus the `ni`/`no` split (a round with no `ni` component is a
   line; otherwise a circle).

5. **Extraction (documented formulas).**
   - circle → `{cx, cy, r}` from the round decomposition (center from the
     normalised round's `e1/e2` part, `r²` from `X·X̃`; convert OPNS↔IPNS via `Dual`
     so one routine covers both representations);
   - point pair → two points `p± = (PP ∓ √(PP·PP)) / (−ni⌋PP)`;
   - line → base point + direction (a CGA `lineBaseAndDir` so the existing `SvgLine`
     path is reused).

6. **Render kinds.** `getRenderPlan` returns existing `finitePoint`/`line` plus new
   `{ kind:'circle', cx, cy, r }` and `{ kind:'pointPair', p1, p2 }`. Add `SvgCircle`
   and `SvgPointPair` components and `case` arms in **both** the top-level switch and
   the inner list-element switch in `Canvas.jsx`.

7. **Node types & showcase.** Enable `freePoint`, `vector`,
   `joinLine`/`meetPoint`/`meetChain`, `motorExp`, `motorApply`, `dual`, `reverse`,
   `multivector`, `mvExpr`, `list`. Showcase: three draggable points `A`,`B`,`C`;
   circle `A ^ B ^ C`; line `A ^ B ^ ni`; point pair `A ^ B`; an animated
   translator/rotor + `>>>` sandwich moving the circle.

8. **Register** in `src/algebras/index.js` and verify in the browser per the
   checklist in the project plan.
