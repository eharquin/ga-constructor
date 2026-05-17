# Geometric Algebra Constructor

Web-based geometric construction tool supporting multiple GAs. Default algebra is PGA(2,0,1) (2D projective). A second algebra VGA(2,0,0) (2D vectorial) is selectable from the header dropdown.

## Tech Stack
- React + Vite
- ganja.js for GA computations (sandwich, exp, log, dual, reverse, length, typed constructors)
- Algebras: PGA(2,0,1) and VGA(2,0,0) — adapter modules in `src/algebras/<id>/index.js`
- **SVG rendering** (native React JSX — no canvas 2D, no WebGL)

## Algebra adapter system
Each algebra ships a spec object (`src/algebras/<id>/index.js`) that exposes its ganja `Algebra` instance, basis `bladeIndex` + `bladeNames`, `parseBladeName` (permuted-blade aware), `classifyMV`, `objectWeight`, `normalize*`, `getRenderPlan(val) → {kind, data}`, `KIND_COLOR`, `INITIAL_ITEMS`, and `supportedNodeTypes`. The parser, evaluator, evalMVArith, and nodeTypes are *factory* functions (`createParseExpression`, `createEvalMVArith`, `createEvaluate`, `createNodeTypes`) that each adapter binds against its own spec. The active spec is exposed via `AlgebraContext`; `useGraph(algebra)` consumes it. Switching algebras (header dropdown) prompts a confirm-then-reset to the new algebra's `INITIAL_ITEMS`. Adding another algebra = one new file in `src/algebras/`.

## Key Principles
- Any expression is valid — type detected from computed value via `classifyMV()`
- Operations: `^` (wedge/meet), `&` (Vee/join), `|` (inner product), `§` (commutator), `>>>` (sandwich), `!` (dual), `~` (reverse)
- Normalization: `norm` (finite ‖A‖) and `inorm` (ideal ‖A‖∞) buttons, propagated to dependents
- Interactive: drag points, auto-update dependent objects
- Rendering: declarative SVG — `SvgPoint`, `SvgLine`, `SvgVector`, `SvgIdealLine`, `SvgIdealPointMarker`, `SvgPolygon`, `SvgGrid`; points always above lines (z-layered); stroke widths / radii scale with `objectWeight(val)` so `5*e12` renders 5× thicker than `e12`
- Ideal line (pure e0) drawn as a screen-space dashed ellipse — the line at infinity. Ideal points sit on its boundary when that ellipse is visible.

## Expression Language
- `A.e12`, `A.e21` — blade coefficient extraction (permuted blades supported)
- `[P1, P2, P3, …]` — polygon list (non-MV special type, draws dashed polygon)
- `abs(A)` / `|A|` — absolute value; `A | B` — inner product; `A § B` — commutator
- Label `{varname}` templates — substituted with current scalar value at render time
- `sqrt`, `abs` builtins; implicit multiplication `5(e1+e2+e0)`

## Current Focus
Value-based type system: panel colors and canvas rendering driven by `classifyMV(val).kind`, not parser node type. Full operator set in `evalMVArith`. Polygon list notation `[P1,P2,…]`. Label templates `{a}`.

**Ganja delegation** — most GA primitives now go through ganja's built-ins (one sign convention, no parallel implementations to drift):
- `dualOp` → `PGA.Dual`; `reverseOp` → `PGA.Reverse`
- `motorApply` (sandwich) → `PGA.sw(T, A)` (general case — works for composed motors, not just pure rotations)
- `motorExp` → `V.Exp()` instance method (single-argument `exp(<mv_expr>)`; closed-form branches removed)
- `evalMVArith` `>>>` → `PGA.sw`; `sqrt(motor)` → `M.Log()` → halve → `.Exp()`
- `point2D` / `idealPoint` / `line2D` → `PGA.Bivector` / `PGA.Vector` typed constructors
- Norms (`normalizeMVFinit/Ideal/MV`, `objectWeight`) → `PGA.Length` (with `PGA.Dual` for the ideal-norm path)

**Per-item interactivity controls** (top of each row, next to the visibility checkbox):
- 🔓/🔒 lock toggle — disables drag without hiding the object (drag-eligible items only)

**Dark theme** — CSS custom properties at `:root` (light) and `[data-theme="dark"]` in `index.css`. Toggle button in app header writes to `localStorage` and adds a transient `theme-fade` class to `<html>` so the swap cross-fades over 300ms. SVG colors (grid, axis, labels, point strokes, canvas background) use `style={{ fill: 'var(--…)' }}` so they retheme too.

**Base showcases** —
- **PGA:** 8-item motor composition: `P` (point), `V` (vector), animatable scalars `t`/`a`, translator `T = exp(t*V)`, rotor `R = exp(a*e12)`, composed motor `M = R*T`, transformed point `Q = M >>> P`.
- **VGA:** 7-item vector/rotor demo: `V = 3*e1 + 2*e2`, `W = vector(-1, 2.5)`, scalar `S = V|W` (dot), bivector `B = V^W` (signed area, drawn as oriented loop), scalar `a`, rotor `R = exp((a/2)*e12)` (drawn as arc), rotated vector `V_rot = R >>> V`.

`exp` is single-argument — the argument is exponentiated via ganja's `V.Exp()`, working uniformly for translators, rotors, and general motors.

**VGA drawables** — `getRenderPlan` returns three new kinds rendered by Canvas:
- `vector` → `SvgVector` (arrow from origin or `drawPos`)
- `bivector` (b*e12) → `SvgBivector` (oriented loop at origin, radius ∝ √|b|, curved-arrow direction by sign)
- `rotor` (a + b*e12) → `SvgRotor` (arc at origin spanning 2·atan2(b, a) with angle label)

VGA has no points or projective lines — `point()`, `line()`, `&` (join), `^` (meet via PGA convention), `triangle`, and `meetChain` are gated out of the VGA parser via `supportedNodeTypes`.

**Saved graphs** — `💾` Save / `📂` Open buttons in the header persist graphs to `saved_graphs/<name>.json` via a Vite dev plugin (`/api/graphs` CRUD). Each save tags `algebra: 'pga201'|'vga200'`; loading a graph saved under a different active algebra prompts the user to auto-switch first.

**Git workflow** — GitHub Flow with PR-based feature branches. Auto-commit hook does `git push -u origin HEAD` so new branches publish on first commit. See `docs/git_workflow.md` for branch prefixes, hook gotchas, and recovery commands.

Expression Reference in help modal covers all features.

## Prompt History
IMPORTANT: Always read `PROMPT_HISTORY.md` at the start of every session to recall what has been done previously. After completing a task, append the user's prompt to that file under today's date.
