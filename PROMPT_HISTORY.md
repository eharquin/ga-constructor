# Prompt History

A chronological log of all prompts given to Claude in this project.

---

## 2026-05-04

1. **Initial setup** — First commit of the project.
2. **Prompt history system** — Add a system to log all prompts and maintain memory of past work. Asked Claude to read this file on every session launch.
3. **Project recap** — Asked for a full recap of the codebase. Saved to `docs/recap_2026-05-04.md`.
4. **Auto commit/push** — Asked to automatically commit and push after every file edit/write. Configured via PostToolUse hook in `.claude/settings.local.json`.
5. **Motor translation bug** — `T = exp(V, t/2)` + `K = T >>> A` not moving K. Root cause: `PGA.Exp` returns NaN for nilpotent (ideal) bivectors (sin(|L|)/|L| = 0/0). Fixed by manually constructing translator T = 1 + Ls in `motorExp`.
6. **Point K not drawn** — After translator fix, K still not drawn. Root cause: `PGA.Mul` unreliable for sandwich product. Fixed by implementing analytical sandwich product directly in `motorApply` (both translator and rotor cases).
7. **Rotation from point** — Asked to support `M = exp(A, s)` where A is a PGA point to create a rotation motor. Implemented: extracts (px, py) from point, builds motor `cos(s) + sin(s)*(e12 - py·e01 + px·e02)`. `K = M >>> B` then rotates B around A by angle 2s.

## 2026-05-05

8. **Dualization + general multivectors** — Added `!A` (dual of named object), `!(mv_expr)` (dual of inline literal), and bare multivector expressions like `5e02 - 1e01` or `e1 + e2 + 5e0`. Implemented: `parseMVExpr` tokenizer in `parseExpression.js`, `multivector` and `dual` node types in `nodeTypes.js`, extended `lineBaseAndDir` in `pga.js` to handle grade-1 elements (so duals of points render as lines), and unified the Canvas else-branch to auto-detect point vs line for all node types.
12. **General multivector arithmetic expressions** — Added `mvExpr` node type for arbitrary PGA arithmetic: `C = A + B`, `M = (A + B) / 2`, `D = 2*A - B`, `P = A * B` (geometric product), etc. New `evalMVArith.js`: tokenizer, syntax validator, recursive-descent evaluator. Built-in basis blades always available without being deps. Result auto-rendered as point or line. Hardened `lineBaseAndDir` against non-array inputs. Suggestion banner restricted to freePoint/vector/multivector types only.
11. **Scalar creation banner + parametric points** — Three forms now trigger a "Create: x, y, w / + scalars" banner when variable names are undefined: `P=x*e01+y*e02+w*e12`, `P=point(x,y)`, `V=vector(x,y)`. Clicking inserts scalar items before the expression (w defaults to 1 as e12 weight, others to 0). Drag now updates scalar items for all three forms: `updateFreePoint`/`updateVector` call `tryUpdateScalar` when coords are pure identifiers; `updateDepPoint` inverts the PGA2D e01/e02 coefficient mapping (e01→y·w, e02→−x·w). Parametric multivectors with e01/e02 coeffExprs are now hit-testable as `depPoint` drag type. Parser extended: `parseMVExpr` now returns `{ components, deps, coeffExprs }` and supports `var*blade` terms; `multivector` node evaluates them via `evalExpr`.
10. **Ideal-direction as vector** — `V = e01 + e02` (and any pure e01/e02 expression with no e12 or grade-1 terms) now parses as a `vector` node instead of a raw `multivector`. Detection in `parseExpression.js`: if only indices 4 (e01) and 5 (e02) are non-zero, emit `vector` type with `vx = -(e02 coeff)`, `vy = e01 coeff` (consistent with PGA 2D ideal-point convention).
9. **Switch to PGA 2D** — Migrated from PGA(3,0,1) to PGA(2,0,1). Basis shrinks from 16 to 8 elements. Points are now grade-2 (e01,e02,e12 at indices 4,5,6) instead of grade-3. Lines are grade-1 (e0,e1,e2 at 1,2,3) instead of grade-2. Updated: pga.js (Algebra(2,0,1), all index mappings, simplified lineBaseAndDir to grade-1 only, removed makePlane/toEuclidean2D), nodeTypes.js (PGA(8) arrays, new indices in motorExp/motorApply/meet), parseExpression.js (7-blade index for 2D), Canvas.jsx and ExpressionPanel.jsx (removed toEuclidean2D fallback).
13. **Showcase initial expressions** — Replaced the 7 default items with 12 that demonstrate all features: 4 draggable `point()` nodes, 2 `&` join lines, 1 `^` meet intersection, 1 `(A+B)/2` multivector arithmetic midpoint, 1 animatable scalar `t`, 1 `exp(X,t)` rotation motor, and 2 `>>>` motor-apply nodes.
14. **Literal MV point drag + dual with deps** — `P = e01 + e12` (and any literal grade-2 multivector with e12≠0 and no variable coeffs) is now draggable: new `litMVPoint` drag type in `hitTest`; `updateLiteralMVPoint` rewrites the expression with updated e01/e02 (normalised to w=1). `!(mv_expr)` now supports variable coefficients: removed the `deps.length === 0` guard so `P = !(y*e2 + e0)` parses as `multivector` with `dual: true` and renders as a point.
15. **Dual MV point dragging** — `P = !(y*e2 + e0)` is now draggable. New `dualDepPoint` drag type: detects dual multivectors whose pre-dual e2 (→e01→y) or e1 (→e02→x) blade has a variable scalar coefficient. `updateDualDepPoint` applies the same index remapping (e2→e01→y·w, e1→e02→-x·w) so dragging the point updates only the reachable scalar(s) — for `!(y*e2+e0)` only y-axis movement has effect, matching the behaviour of `P = y*e01 + e12`.

---
