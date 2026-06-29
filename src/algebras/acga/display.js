// Conformal null-basis display — re-express MV coefficients in {e1, e2, eo1, eo2,
// einf1, einf2} for readability (the ACGA analog of CCGA's display). A linear
// change of basis on the 6 generators, extended to all 64 blades once at load by
// symbolic exterior multiplication, so per-render it is a sparse dot.

import { BLADE_NAMES, ARRAY_SIZE, isMV } from './algebra.js';

const DTOKENS = ['e1', 'e2', 'eo1', 'eo2', 'einf1', 'einf2'];
// Each orthogonal generator (ganja index) in display generators (bit into DTOKENS):
//   e₊ᵢ = eo_i/2 − einf_i,   e₋ᵢ = eo_i/2 + einf_i.
const ORTHO_GEN = {
  1: [[0, 1]],
  2: [[1, 1]],
  3: [[2, 0.5], [4, -1]], 5: [[2, 0.5], [4, 1]],   // e3=e₊1, e5=e₋1
  4: [[3, 0.5], [5, -1]], 6: [[3, 0.5], [5, 1]],   // e4=e₊2, e6=e₋2
};
const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

// Canonical ordering of the 64 display blades: grade-first, then mask value.
const DISPLAY_MASKS = [...Array(ARRAY_SIZE).keys()].sort(
  (a, b) => popcount(a) - popcount(b) || a - b);
const DISPLAY_INDEX = new Array(ARRAY_SIZE);
DISPLAY_MASKS.forEach((m, i) => { DISPLAY_INDEX[m] = i; });
export const DISPLAY_BLADE_NAMES = DISPLAY_MASKS.map((m) => {
  if (m === 0) return '1';
  const toks = [];
  for (let b = 0; b < 6; b++) if (m & (1 << b)) toks.push(DTOKENS[b]);
  return toks.join('');
});

// Decompose each orthogonal basis blade into display blades (mask → coeff).
const ORTHO_DECOMP = BLADE_NAMES.map((name) => {
  let terms = new Map([[0, 1]]);                         // start from scalar 1
  if (name !== '1') {
    for (const ch of name.slice(1)) {
      const exp = ORTHO_GEN[+ch];
      const next = new Map();
      for (const [mask, coeff] of terms) {
        for (const [bit, c] of exp) {
          if (mask & (1 << bit)) continue;                // repeated generator ⇒ 0
          const sign = (popcount(mask >> (bit + 1)) & 1) ? -1 : 1;
          const nm = mask | (1 << bit);
          next.set(nm, (next.get(nm) || 0) + sign * coeff * c);
        }
      }
      terms = next;
    }
  }
  return [...terms].map(([mask, coeff]) => [DISPLAY_INDEX[mask], coeff]);
});

export function toDisplayCoeffs(mv) {
  if (!isMV(mv)) return null;
  const d = new Array(ARRAY_SIZE).fill(0);
  for (let j = 0; j < ARRAY_SIZE; j++) {
    const v = mv[j];
    if (!v) continue;
    for (const [di, c] of ORTHO_DECOMP[j]) d[di] += v * c;
  }
  return d;
}
