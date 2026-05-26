// Factory for a permuted-blade-aware name parser, shared by every algebra adapter.
//
// createParseBladeName(bladeIndex, { minDigit, maxDigit }) returns a
// parseBladeName(name) → { index, sign } | null that:
//   - accepts any permutation of a basis blade's indices (e21 = -e12, e102 = -e012),
//   - rejects out-of-range or repeated indices,
//   - computes the sign from the parity of the permutation needed to sort the
//     indices into the canonical (ascending) blade key in `bladeIndex`.
//
// The only per-algebra difference is the legal digit range:
//   PGA(2,0,1): 0..2   VGA(2,0,0): 1..2   CGA(3,1): 1..4
export function createParseBladeName(bladeIndex, { minDigit, maxDigit }) {
  return function parseBladeName(name) {
    if (!name || !name.startsWith('e')) return null;
    const digits = name.slice(1).split('').map(Number);
    if (digits.some((d) => isNaN(d) || d < minDigit || d > maxDigit)) return null;
    if (new Set(digits).size !== digits.length) return null;
    let inv = 0;
    for (let i = 0; i < digits.length; i++)
      for (let j = i + 1; j < digits.length; j++)
        if (digits[i] > digits[j]) inv++;
    const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
    const index = bladeIndex[canonical];
    return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
  };
}
