# Geometric Algebra Constructor

Web-based geometric construction tool using Projective Geometric Algebra (PGA).

## Tech Stack
- React + Vite
- ganja.js for GA computations
- PGA(2,0,1) algebra (2D projective)
- **SVG rendering** (native React JSX — no canvas 2D, no WebGL)

## Key Principles
- Objects are multivectors (points, lines, planes)
- Operations: wedge (^), regressive (&), dual (~)
- Interactive: drag points, auto-update dependent objects
- Rendering: declarative SVG components (`SvgPoint`, `SvgLine`, `SvgVector`, `SvgGrid`) — crisp at any zoom/DPI, no explicit draw loop

## Current Focus
Full-featured expression-based PGA 2D canvas with SVG rendering. All node types implemented. Panel is resizable and drag-to-reorder. Per-object labels (toggle + editable). Multivector values shown inline. Parametric scalar creation banner. Showcase default expressions loaded.

## Prompt History
IMPORTANT: Always read `PROMPT_HISTORY.md` at the start of every session to recall what has been done previously. After completing a task, append the user's prompt to that file under today's date.
