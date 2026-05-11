# Geometric Algebra Constructor

Web-based geometric construction tool using Projective Geometric Algebra (PGA).

## Tech Stack
- React + Vite
- ganja.js for GA computations
- PGA(2,0,1) algebra (2D projective)
- **SVG rendering** (native React JSX — no canvas 2D, no WebGL)

## Key Principles
- Any expression is valid — type detected from computed value via `classifyMV()`
- Operations: `^` (wedge/meet), `&` (Vee/join), `|` (inner product), `§` (commutator), `>>>` (sandwich), `!` (dual), `~` (reverse)
- Normalization: `norm` (finite ‖A‖) and `inorm` (ideal ‖A‖∞) buttons, propagated to dependents
- Interactive: drag points, auto-update dependent objects
- Rendering: declarative SVG — `SvgPoint`, `SvgLine`, `SvgVector`, `SvgPolygon`, `SvgGrid`; points always above lines (z-layered)

## Expression Language
- `A.e12`, `A.e21` — blade coefficient extraction (permuted blades supported)
- `[P1, P2, P3, …]` — polygon list (non-MV special type, draws dashed polygon)
- `abs(A)` / `|A|` — absolute value; `A | B` — inner product; `A § B` — commutator
- Label `{varname}` templates — substituted with current scalar value at render time
- `sqrt`, `abs` builtins; implicit multiplication `5(e1+e2+e0)`

## Current Focus
Value-based type system: panel colors and canvas rendering driven by `classifyMV(val).kind`, not parser node type. Full operator set in `evalMVArith`. Polygon list notation `[P1,P2,…]`. Label templates `{a}`. 26-item showcase (triangle centroid construction). Expression Reference in help modal covers all features.

## Prompt History
IMPORTANT: Always read `PROMPT_HISTORY.md` at the start of every session to recall what has been done previously. After completing a task, append the user's prompt to that file under today's date.
