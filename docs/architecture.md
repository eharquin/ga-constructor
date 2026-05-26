# Architecture

GA Constructor is a web app for building geometric constructions in a chosen
Geometric Algebra and rendering them as interactive SVG. It currently ships two
algebras — **PGA(2,0,1)** (2D projective) and **VGA(2,0,0)** (2D vectorial) — and
is designed so a new algebra is *one new file* in `src/algebras/`.

This document explains how the pieces fit together. For the step-by-step recipe to
add an algebra, see [adding_an_algebra.md](./adding_an_algebra.md).

## The big idea: factories bound to an algebra spec

The expression language is not hard-coded to any one algebra. The four graph
modules are **factory functions** that take an algebra `spec` and return functions
closed over it:

| Factory | File | Produces |
| --- | --- | --- |
| `createParseExpression(spec, evaluator)` | `src/graph/parseExpression.js` | `parseExpression(text) → node` |
| `createEvalMVArith(spec)` | `src/graph/evalMVArith.js` | `{ evalMVArith, extractMVDeps, parseBladeName }` |
| `createNodeTypes(spec, evaluator)` | `src/graph/nodeTypes.js` | `{ [type]: { label, compute } }` |
| `createEvaluate(spec, nodeTypes)` | `src/graph/evaluate.js` | `evaluate(nodes, normalizeMap) → values` |

Each adapter (`src/algebras/<id>/index.js`) builds these in dependency order and
attaches them to its `spec`. The full `spec` interface is documented in
`src/algebras/spec.js` (`@typedef AlgebraSpec`).

```
spec ──► createEvalMVArith ──► createNodeTypes ──► createParseExpression
                                      │                     │
                                      └──► createEvaluate ◄──┘
```

The active spec is provided by `AlgebraContext`; `useGraph(algebra)` consumes it.

## The value model

A computed value (`values[nodeId]`) is exactly one of:

- a **ganja multivector** (an `Algebra` instance — an array-like with prototype
  methods `Add`, `Sub`, `Mul`, `Scale`, `Grade`, `Dual`, `Reverse`, `Exp`, `Log`,
  `Length`, `VLength`, `Negative`, …);
- a **`{vx, vy}` vector** (a lightweight plain object — a direction with a separate
  draw position; promoted to an MV via `spec.geomToMV` when fed to GA ops);
- a **list** `{ list: true, items: [...] }` whose items are raw MVs;
- (rarely) a plain **number** — only for structural results like `len(L)` and array
  indices. **Scalars are grade-0 MVs**, not numbers: a `t = 0.5` node evaluates to
  an MV with `mv[0] = 0.5`, so it classifies as `scalar`, colors correctly, and
  feeds any GA operation uniformly. The two places that need a JS number unwrap
  `mv[0]` at the boundary: `evalScalar` (coordinate expressions like `point(x,y)`)
  and display formatting.

## Data flow

```
item.text ──parseExpression──► node {id, type, deps, params}
   (per item)                        │
                                     ▼
        nodes map ──evaluate──► values {id: MV | {vx,vy} | list | number}
                                     │
              ┌──────────────────────┼───────────────────────┐
              ▼                       ▼                        ▼
       getRenderPlan(val)     classifyMV(val).kind      labelMap / display
        → Canvas SVG           → colors + render          (ExpressionPanel)
```

1. **Parse.** `useGraph` runs `parseExpression(item.text)` for each item into a
   `node` with `type`, `deps` (other node ids it reads), and `params`.
2. **Evaluate.** `evaluate(nodes, normalizeMap)` topologically sorts by `deps`,
   calls each node type's `compute(depValues, params)`, and optionally normalises.
   `compute` reads only algebra-bound primitives, so node types that carry over
   (`mvExpr`, `motorExp`, `dual`, …) work across algebras unchanged.
3. **Classify & color.** `classifyMV(val).kind` drives both the panel vignette and
   the canvas color, via the shared `resolveKindColor` (`src/colors.js`). One
   function, so panel and canvas never disagree.
4. **Render.** `getRenderPlan(val)` returns `{ kind, … }`; `Canvas.jsx` switches on
   `kind`. Lists recurse: `getRenderPlan` maps over `items` into
   `{ kind:'list', elements, outline }`, and the Canvas `list` case has an inner
   switch over element kinds. **Any new render kind must be handled in both the
   top-level switch and the list-element switch.**

## The expression language (`evalMVArith`)

`evalMVArith` is a recursive-descent evaluator with a precedence ladder
(tight → loose): unary (`! ~ - +`, `|…|`, calls) → grade products (`^ & | §`) →
geometric product / division (`* /`) → sandwich (`>>>`) → additive (`+ -`).
Postfix `.blade` / `.norm` / `.inorm` and `[i]` / `[i:j]` bind to the primary.

GA operations delegate to ganja (one sign convention, no parallel implementations):
`Mul`, `Wedge`, `Vee`, `LDot`, `sw`, `Dual`, `Reverse`, `Add`, `Sub`, `.Scale`,
`.Negative`, `.Exp`, `.Log`. Lists broadcast: a binary op with one list operand
maps over its elements; two equal-length lists go elementwise.

Basis blades (`e1`, `e12`, …) resolve as bare identifiers, as do any named
`spec.constants` (e.g. a conformal algebra's `ni`/`no`). Both are excluded from a
node's `deps`.

## Rendering (`Canvas.jsx`)

Declarative SVG, no canvas2D/WebGL. Objects are split into a **back layer**
(lines, polygons, bivectors) and a **front layer** (points) so points always draw
on top regardless of expression order. Render kinds in use today:
`finitePoint`, `line`, `idealLine`, `positionedVector`, `bivector`, `rotor`,
`polygon`, and `list`.

The renderer and the drag layer are **algebra-agnostic** — they contain no literal
blade indices. Anything index-specific is asked of the spec:

- `spec.vectorXY(val)` → `{vx,vy}` for a vector-like value (snap targets, anchors).
- `spec.isParametricPoint(node)` / `spec.parametricPointEdits(node,val,x,y)` —
  whether a multivector node is a draggable point and, given a drag target, what
  edits to apply (set a scalar item, or rewrite the node's text). Algebras without
  parametric points (VGA) simply omit these; the drag layer guards with `?.`.

## Interaction & state (`useGraph.js`)

`useGraph(algebra)` owns the item list and all derived memos (`nodes`, `values`,
`colorMap`, `labelMap`, `vectorPositions`, …). Its reducer is split into a pure
`itemsReducer` (array transforms) wrapped by a history reducer providing
**undo/redo** (past/future snapshot stacks; high-frequency drag/anim writes within
400 ms coalesce into one entry; cap 100).

Items **autosave** to `localStorage` per algebra (`ga-items-<id>`) plus the active
algebra (`ga-algebra`), restored on load. Graphs can also be saved to
`saved_graphs/<name>.json` via a Vite dev plugin; each save is tagged with its
`algebra` id and loading a cross-algebra save prompts a switch.

## Contexts

- **`AlgebraContext`** — holds the active spec; the header dropdown switches it
  (confirm-then-reset to that algebra's `INITIAL_ITEMS`).
- **`GraphContext`** — wraps `useGraph(algebra)` and provides it to the tree.
- **`SettingsContext`** — display options (weight thickness, grid, snap, anchors,
  decimals), persisted to `localStorage`.

## Shared helpers

- `src/algebras/itemFactory.js` — `makeItem(id, text, extra)`: the single item shape.
- `src/algebras/bladeName.js` — `createParseBladeName(bladeIndex, {minDigit,maxDigit})`.
- `src/colors.js` — `resolveKindColor(val, algebra, nodeType)` + `FALLBACK_COLOR`.
- `src/algebras/spec.js` — the `AlgebraSpec` typedef + `missingSpecFields` (dev check).
