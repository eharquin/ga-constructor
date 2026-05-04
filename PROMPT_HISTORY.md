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

---
