// Runtime Cayley-table + basis-square computation, driven entirely by a
// ganja Algebra instance. Works for any spec exposing { Algebra, arraySize,
// bladeNames } — no per-algebra branching.

const EPS = 1e-10;

// Build basis blade #i as a length-arraySize MV with a single 1 at index i.
function basisBlade(spec, i) {
  const arr = new spec.Algebra(spec.arraySize);
  for (let k = 0; k < spec.arraySize; k++) arr[k] = 0;
  arr[i] = 1;
  return arr;
}

// Format the result of a basis-pair product as a short string ('e12', '-e02',
// '0'). For two pure basis blades in a Clifford algebra the product is always
// a single basis term (up to sign) or zero.
function formatProduct(mv, bladeNames) {
  const terms = [];
  for (let i = 0; i < bladeNames.length; i++) {
    const c = mv[i] || 0;
    if (Math.abs(c) < EPS) continue;
    const sign = c < 0 ? '-' : '';
    terms.push(`${sign}${bladeNames[i]}`);
  }
  return terms.length ? terms.join(' + ') : '0';
}

// Returns a 2-D array `t[i][j]` of formatted strings — t[i][j] = basis[i]·basis[j].
export function cayleyTable(spec) {
  const { Algebra, arraySize, bladeNames } = spec;
  const blades = Array.from({ length: arraySize }, (_, i) => basisBlade(spec, i));
  const table = [];
  for (let i = 0; i < arraySize; i++) {
    const row = [];
    for (let j = 0; j < arraySize; j++) {
      const prod = Algebra.Mul(blades[i], blades[j]);
      row.push(formatProduct(prod, bladeNames));
    }
    table.push(row);
  }
  return table;
}

// Diagonal of the Cayley table normalised to '0' / '+1' / '-1'. For a Clifford
// basis blade the square is always a (possibly zero) scalar, so the diagonal
// cell is '0', '1', or '-1' in the unformatted basis. The scalar blade label
// (typically '1') is just a name — we collapse it to the sign here.
export function basisSquares(spec) {
  const t = cayleyTable(spec);
  const scalarName = spec.bladeNames[0] ?? '1';
  return t.map((row, i) => {
    const s = row[i];
    if (s === '0') return '0';
    if (s === scalarName)        return '+1';
    if (s === `-${scalarName}`)  return '-1';
    return s; // unexpected for Clifford, but stay informative
  });
}
