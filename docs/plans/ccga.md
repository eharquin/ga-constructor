# Plan: Add CCGA (Conic Conformal Geometric Algebra) as a fifth algebra

> Implementation plan — not yet built. Sources: `/home/eharquin/Workspace/notebook/ccga`
> (`algebra.py`, `point.py`, `objects.py`, `classify.py`, `CLAUDE.md`, `OBJECTS.md`) and the
> Obsidian notes under `these/References|Projects/CCGA`.

## Context

The tool already ships four algebra adapters (PGA 2D, VGA 2D, ℂ, CGA 2D). The user's
research project is built around **CCGA — Conic Conformal Geometric Algebra in R^{5,3}**
(8 generators, 256-dimensional multivectors), which embeds 2D points via a Veronese map so
that *any conic* (circle, ellipse, hyperbola, parabola, line) is a single algebraic object.
This PR ports the **points + grade-7 conics** core into a new adapter, following the exact
pattern established by the CGA adapter (`src/algebras/cga310/index.js`).

Scope for this PR: **draggable CCGA points + general conics, where the canonical conic is a
grade-7 OPNS object.** Deferred to follow-ups: point-pair/n-pole point extraction
(Cardano/Ferrari), conic∨conic intersection, and the CGA round-object family.

### De-risking already done (verified by throwaway JS against the repo's ganja)
- **ganja flat mode**: `Algebra(5,3)` defaults to a *graded* representation that breaks the
  flat-array contract every adapter relies on and crashes `Dual`. **`Algebra({p:5, q:3,
  graded:false})` produces a working 256-element `Float32Array`** with correct metric
  (e1–e5 → +1, e6–e8 → −1), `I²=−1`, working `Mul`/`Dual`/`Reverse`. Basis names are the
  standard `1, e1…e8, …, e12345678`, so `bladeIndex`/`bladeNames`/`parseBladeName` port directly.
- **Math port validated end-to-end**: building the grade-7 conic `Iod ∧ p1∧…∧p5`, dualizing
  via `Mul(C, I_inv)`, and reading coefficients off the grade-1 IPNS recovers the exact
  conic for circle/ellipse/hyperbola/parabola and the discriminant `Δ=C²−4AB` classifies all
  four correctly. **Use explicit `I_inv` multiplication for the dual** (matching the notebook's
  fixed convention) — do *not* rely on `Algebra.Dual` for the conic dual.
- **Performance**: one dense `Mul` ≈ 2 ms (fine for a handful of nodes; drag may feel
  slightly heavy but acceptable). A full **256×256 Cayley sweep ≈ 140 s** — the Algebra Info
  modal must be guarded (see below).

## Algebra definitions (port from `notebook/ccga/ccga/algebra.py`)

Orthogonal generators (ganja indices): `e1,e2`=Euclidean; `e3,e4,e5`=e₊₁,₂,₃; `e6,e7,e8`=e₋₁,₂,₃.
Null working basis injected as **`mvConsts`** (resolved as identifiers in expressions, like CGA's
`e0`/`einf`):
```
eo_i = e₊ᵢ + e₋ᵢ          einf_i = (e₋ᵢ − e₊ᵢ)/2          (eo_i·einf_i = −1)
eo   = eo1+eo2            einf   = (einf1+einf2)/2        eob = eo1−eo2   einfb = (einf1−einf2)/2
Iod  = eob ∧ eo3 (grade 2)        Iinfd = (einf1−einf2) ∧ einf3
Io   = eo1∧eo2∧eo3        Iinf = einf1∧einf2∧einf3        Ieps = e1∧e2
I    = Ieps ∧ Iinf ∧ Io  (grade 8, I²=−1)                I_inv = I·(1/I²) = −I
```

Point embedding (`point2D`, with optional radius like CGA's `point(x,y,r)`):
```
p(x,y) = eo + x·e1 + y·e2 + ½x²·einf1 + ½y²·einf2 + xy·einf3   (− ½r²·einf if r≠0)
```

IPNS→coeffs (the only non-obvious extraction, from `classify.py:ipns_to_coeffs`), reading the
grade-1 dual's orthogonal coefficients `c1..c8 = ipns[1..8]`:
```
A=−(c3+c6)/4  B=−(c4+c7)/4  C=−(c5+c8)/2  D=c1  E=c2  F=(c3−c6)+(c4−c7)
```
locus `Ax²+By²+Cxy+Dx+Ey+F=0`; type by `Δ=C²−4AB` (`<0`→ellipse/circle, `=0`→parabola, `>0`→hyperbola).

## Files to change

### New: `src/algebras/ccga/index.js` (mirror `cga310/index.js`)
Export the full spec + the factory-binding tail (`createEvalMVArith` → `createNodeTypes` →
`createParseExpression` → `createEvaluate`, then attach `evalMVArith/extractMVDeps/nodeTypes/
parseExpression/evaluate` onto `spec`). Key fields:
- `id:'ccga'`, `label:'CCGA'`, `Algebra: Algebra({p:5,q:3,graded:false})`, `arraySize:256`.
- `bladeIndex`/`bladeNames`/`bladePattern`/`parseBladeName` — derive from `Algebra.describe().basis`
  exactly as the existing adapters do (standard ganja ordering, single-digit generators).
- `mvConsts` — all null-basis blades above (this is how `Iod ∧ P1 ∧ …` works with zero new syntax).
- `dualOp`→`Algebra.Dual`, `reverseOp`→`Algebra.Reverse` (general use); **conic dual uses `Mul(_, I_inv)`** internally.
- Constructors (all return the **grade-7 OPNS** form so the canonical conic is grade 7):
  `point2D(x,y,r=0)` (grade-1 point, draggable); named conic helpers `circle2D/ellipse2D/
  hyperbola2D/parabola2D/lineConic2D/conicFromCoeffs` build the grade-1 IPNS then dualize to grade-7.
  5-point conic needs **no constructor** — users write `Iod ^ P1 ^ P2 ^ P3 ^ P4 ^ P5`.
- `classifyMV(val)` — grade-based: grade-1 with eo-weight → `finitePoint`/`roundPoint` (reuse CGA's
  `extractRoundPoint` pattern, P·P→rSq); **grade-7 → `conic`** (dual→coeffs→subtype circle/ellipse/
  hyperbola/parabola/line + reality via the 3×3 matrix determinant from `classify.py`); plain number
  → `scalar`; else `mixed`. Carry the subtype + coeffs in the returned object.
- `toEuclidean` (e1/e2 over eo-weight) and `objectWeight` (default 1).
- `getRenderPlan(val)` — `finitePoint`→`{kind:'finitePoint',x,y}`; `roundPoint`→reuse;
  **`conic`→`{kind:'conic', subtype, A,B,C,D,E,F, geom}`** where `geom = conicGeometry(A..F)`
  returns `{cx,cy,rx,ry,theta}` for central conics (eigen-reduction of `[[A,C/2],[C/2,B]]`,
  `theta=½atan2(C,A−B)`, semi-axes from the centered constant `F'=F+(D·cx+E·cy)/2` and eigenvalues);
  parabola/line carry enough to sample. A `circle` subtype may pass through to the existing circle plan.
- `hasDepPointCoeffs` → true for e1/e2 coeffs (indices 1,2), so `point(x,y)` drags like CGA's.
- `KIND_COLOR` (+`conic` color, plus existing point/ideal kinds), `TYPE_COLOR_FALLBACK`,
  `SUPPORTED_NODE_TYPES` (mirror CGA's set: scalar, freePoint, motorExp/Apply, dual, reverse,
  multivector, mvExpr, list, color, funcDef), `info` (signature {p:5,q:3,r:0}, geometry rows, notes),
  and `INITIAL_ITEMS` (showcase below).
- Optional `displayBladeNames`/`toDisplayCoeffs` for a readable null-basis view (defer if costly).

### `src/algebras/index.js`
Register: `import ccga …; export const ALGEBRAS = [pga201, vga200, r010, cga310, ccga];`

### `src/Canvas.jsx`
Add an `SvgConic` component and a `case 'conic':` in the render-plan dispatch (near the existing
`circle`/`line` cases ~L1109–1153). **Per-type parametric drawing**:
`circle`→reuse `SvgCircle`; `ellipse`→ rotated SVG `<ellipse>` via `geom.{cx,cy,rx,ry,theta}`;
`hyperbola`→ two sampled `<polyline>` branches (parametrize `±(cosh t, sinh t)` in eigen-frame,
mapped to world then screen); `parabola`→ a sampled arc; `line`→ reuse `SvgLine`. Clip to canvas
and resample on zoom/pan (read `vp`). Stroke width scales with `weight` like the other primitives.

### `src/graph/evalMVArith.js` + `src/graph/parseExpression.js`
The inline-constructor map (added in prompt 98) is built from the typed constructors the spec
exposes; extend it to also pick up `circle2D/ellipse2D/hyperbola2D/parabola2D/lineConic2D/
conicFromCoeffs`, and add their bare names to `BUILTIN_CONSTRUCTOR_NAMES` so `C = circle(0,0,1)`
parses at top level (and routes inline elsewhere). 5-point conics need nothing here — `^` + the
`Iod` const already cover them. Confirm the existing dep-exclusion lists also skip the new mvConst
names (mirror how CGA's `e0/einf` are excluded).

### `src/algebras/cayley.js` + `src/AlgebraInfoModal.jsx`
Guard the 140 s sweep: add a size cap (e.g. `MAX_CAYLEY_DIM = 64`). Refactor `basisSquares` to
compute the diagonal directly (256 single Muls ≈ sub-second) instead of via the full table.
In `AlgebraInfoModal`, when `arraySize > MAX_CAYLEY_DIM`, skip `cayleyTable` and render a short
"Cayley table omitted (256×256)" note while still showing the basis-squares row.

### `src/ExpressionPanel.jsx`
Add a `conic` descriptor (e.g. "Ellipse / Hyperbola / Parabola (A,B,C,D,E,F)") and include
`conic` in `DRAWABLE_KINDS`.

### `docs/algebras/ccga53.md`
Companion doc mirroring the other `docs/algebras/*.md`: signature, null basis, point embedding,
conic construction + classification, examples.

## Showcase (`INITIAL_ITEMS`)
Five draggable points `P1..P5` (well-spread, e.g. on/near a unit circle) + the morphing conic
`C = Iod ^ P1 ^ P2 ^ P3 ^ P4 ^ P5`. Dragging a point smoothly morphs the conic between
ellipse / parabola / hyperbola — the CCGA analog of CGA's circle↔line unification.

## Verification
1. `npm run dev`, switch the header dropdown to **CCGA**; the 5-point showcase renders a conic;
   dragging points morphs ellipse↔parabola↔hyperbola without errors.
2. Spot-check named constructors: `circle(0,0,1)` (unit circle), `ellipse(2,1)`, `hyperbola(1,1)`,
   `parabola(0.5)`, and a degenerate `line` conic each render and classify correctly.
3. `point(1,2)` is a draggable point; `point(1,2,0.5)` a round point; blade/const expressions like
   `Iod`, `eo`, `einf`, `I` resolve.
4. Open the Algebra Info modal for CCGA — it opens instantly (no 140 s freeze), shows basis squares
   `[+1,+1,+1,+1,+1,−1,−1,−1]` for the generators, and the Cayley-omitted note.
5. `npm run build` and lint are clean; switching CCGA→other algebras still resets cleanly.
6. After completion: append the prompt to `PROMPT_HISTORY.md` under today's date and update
   `CLAUDE.md` (intro + a CCGA section) per project convention.
