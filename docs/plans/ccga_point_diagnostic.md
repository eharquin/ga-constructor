# CCGA: explain why a grade-1 vector isn't a point + eo-weight normalize

> Status: planned, not yet built.

## Context

When a CCGA grade-1 vector isn't recognized as a point, the tool gives no feedback —
it just shows kind `mixed` (gray, undrawn, value `—`), and the norm button doesn't
produce the expected conformal form. The user hit this with two vectors they expected
to be points:

- `-17.98e1 + 4.803e2 + eo1+eo2 + 94.53einf1 + 78.73einf2 − 1251einf3`
- `e1+e2 + 2eo1+2eo2 + 0.5einf1 + 0.5einf2 + einf3`

Both are **correctly not points** (verified against the notebook's Veronese test
`-(p·eo₁)=x²/2`): a point's quadratic `einf` coefficients are locked to its position
(`einf3 = w·x·y`, isotropic radius `einf1−w·½x² == einf2−w·½y²`, and `eo3 = eo1−eo2 = 0`).
Ex.1 violates the cross term (`einf3/w=−1251` vs `x·y=−86.4`) and is anisotropic; Ex.2
has a doubled cross term (`einf3/w=0.5` vs `x·y=0.25`). They're general grade-1 vectors
off every variety — the signature of adding/combining points or inconsistent scaling.

`normalizeMVFinit` only does the conformal normalize `P/−(P·e∞)` (→ `eo1=eo2=1`) for
`finitePoint`/`roundPoint`/`specialPoint`; for `mixed` it divides by GA `Length`, so the
eo weight isn't 1. And the eo weight itself isn't surfaced anywhere (`A | einf` returns
the GA-correct `−w`, matching the cheat sheet's `eo·einf = −1`).

**Decisions (with the user):** (1) add a panel "why not a point" diagnostic; (2)
generalize eo-weight normalization to *any* grade-1 vector with a nonzero eo weight;
(3) leave the `|` operator GA-correct and just document that the eo weight is `−(A|einf)`
(no operator change). All three confirmed working in a read-only prototype.

## Changes

### `src/algebras/ccga/classify.js`

- **Generalize `normalizeMVFinit`** so any grade-1 vector with a nonzero eo weight
  normalizes conformally (this subsumes the existing point/round/special cases and adds
  `mixed`/IPNS-conic grade-1 vectors), leaving higher-grade objects on the GA-`Length`
  path:
  ```js
  const g = gradeFlags(val);
  const w = einfWeight(val);                 // = −(P·e∞), from embed.js
  if (onlyGrade(g, 1) && Math.abs(w) > 1e-10) {
    const r = zeroMV();
    for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / w;
    return r;
  }
  // …unchanged: grade-3 CGA point family (w≈0 → returned as-is) then A.Length path
  ```
  Reuses `gradeFlags`/`onlyGrade`/`einfWeight`/`zeroMV` already imported here.

- **Add `pointDefect(val)`** (exported): for a grade-1 vector, return a short string
  explaining why it is *not* a point, else `null`. Returns `null` for non-grade-1, for
  genuine points/round points (on-variety, e.g. `!circle(...)`→`roundPoint`), and for
  ideal vectors (`w≈0`). Logic mirrors `isVeronesePoint`/`isPointVector`:
  - outside V₆ (`eo3` or `eo1−eo2` ≠ 0) → `"IPNS conic, not a point (eo3=…, eo1−eo2=…); dualize (!) to view"`;
  - else report `"not on point variety at (x, y); eo weight w=…: "` + the failing
    relation(s): `einf3/w=… ≠ x·y=…` and/or `anisotropic radius (… ≠ …)`.
  Prototype output (the two examples):
  `"…at (-17.98, 4.803); eo weight w=1: einf3/w=-1251 ≠ x·y=-86.358; anisotropic radius (-67.11 ≠ 67.196)"`,
  `"…at (0.5, 0.5); eo weight w=2: einf3/w=0.5 ≠ x·y=0.25"`.

### `src/algebras/ccga/index.js`
Import `pointDefect` from `./classify.js`, add `pointDefect` to the `spec` object, and
add it to the parity re-export block. Add one `info.notes` line documenting the eo weight:
*"The eo (origin) weight of a grade-1 object is w = −(A·einf) = −(A | einf); the norm
button divides by it so eo1=eo2=1 and the position reads off e1/e2."*

### `src/ExpressionPanel.jsx`
In the row render (~L879, after the `expr-result` div), add an optional diagnostic line:
```jsx
{(() => { const d = algebra.pointDefect?.(node ? values[node.id] : null);
          return d ? <div className="expr-note">{d}</div> : null; })()}
```
`pointDefect` self-gates (returns `null` unless it's an off-variety grade-1 vector), so
this stays dormant for all other algebras and all valid objects. Add a small `.expr-note`
rule (dim, smaller, wrapping — unlike the ellipsis-clipped `.expr-mv`) to
`src/ExpressionPanel.css`.

## Why no `|` change
`A | einf` is the GA symmetric inner product and correctly returns `−w` (= `−1` for a
unit point), matching the notebook's `eo·einf = −1`. Overriding it to return `+w` would
break GA consistency, so the eo weight is exposed as `−(A | einf)` (documented in the
`info.notes` line and shown numerically in the new diagnostic).

## Verification
- **Prototype already confirms** the defect strings and that eo-normalize yields
  `0.5e1+0.5e2+eo1+eo2+…` / `…+eo1+eo2+…` (eo1=eo2=1) for the two examples, and `null`
  defect for `!circle(0,0,2)` (a real round point).
- **No classification/render regression**: `node scripts/ccga_snapshot.mjs` and diff vs
  the saved baseline must stay identical (classifyMV/getRenderPlan are untouched;
  `normalizeMVFinit` isn't exercised by the empty-normalizeMap snapshot).
- **App**: `npm run dev` → CCGA; enter the two example vectors → panel shows the "why not
  a point" note; click the norm button → `eo1=eo2=1`, position readable on `e1/e2`.
- `npm run build` + `npm run lint` clean on touched files.
- Append the prompt to `PROMPT_HISTORY.md`.
