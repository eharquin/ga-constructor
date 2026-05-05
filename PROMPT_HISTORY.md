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
9. **Switch to PGA 2D** — Migrated from PGA(3,0,1) to PGA(2,0,1). Basis shrinks from 16 to 8 elements. Points are now grade-2 (e01,e02,e12 at indices 4,5,6) instead of grade-3. Lines are grade-1 (e0,e1,e2 at 1,2,3) instead of grade-2. Updated: pga.js (Algebra(2,0,1), all index mappings, simplified lineBaseAndDir to grade-1 only, removed makePlane/toEuclidean2D), nodeTypes.js (PGA(8) arrays, new indices in motorExp/motorApply/meet), parseExpression.js (7-blade index for 2D), Canvas.jsx and ExpressionPanel.jsx (removed toEuclidean2D fallback).

---
