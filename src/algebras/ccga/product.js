// Sparse geometric-product engine for CCGA (ℝ(5,3), 256 blades).
//
// ganja's generated products are *dense*: every Mul/Wedge/Dot/sw walks the full
// 256×256 Cayley table (~65 k multiply-adds, ~2–3.5 ms) no matter how sparse the
// operands are — and a CCGA point has only 8 of 256 non-zero coefficients. This
// module precomputes the Cayley table **analytically from bitmasks** at load
// (instant; ganja's own 256² sweep is ~140 s) and exposes kernels that iterate
// only over each operand's support, so a point⊗point product is ~64 madds.
//
// Correctness is anchored to ganja: every kernel matches ganja's own convention
// (verified exhaustively by scripts/ccga_verify.mjs) —
//   reorder sign  : parity of basis-vector transpositions (canonical ascending)
//   metric        : generators e1..e5 square +1, e6..e8 square −1  (p=5, q=3, r=0)
//   wedge/LDot/Dot: grade-selected GP  (gi+gj / gj−gi / |gi−gj|)
//   Reverse       : sign [1,1,-1,-1][g%4]      Conjugate: [1,-1,-1,1][g%4]
//   Dual(a)       : a.Mul(I)  (right-multiply by the unit pseudoscalar)
//   Length        : sqrt(|(a · Conjugate(a)).s|)
//   sw(a,b)       : a·b·~a
//
// `createEngine` is a factory so this stays a dependency-free leaf module: it is
// handed the ganja Algebra class + basis metadata and returns the kernels.

const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };

export function createEngine({ A, bladeNames, grades, arraySize }) {
  const N = arraySize;

  // ── Per-index metadata: bitmask (bit d−1 per generator digit d) + grade ──────
  const MASK = new Array(N);
  for (let i = 0; i < N; i++) {
    const name = bladeNames[i];
    let m = 0;
    if (name !== '1') for (const ch of name.slice(1)) m |= 1 << (+ch - 1);
    MASK[i] = m;
  }
  // mask → ganja canonical index (so results land in ganja's own ordering).
  const MASK_TO_INDEX = new Array(1 << 8).fill(-1);
  for (let i = 0; i < N; i++) MASK_TO_INDEX[MASK[i]] = i;

  // ── Geometric-product Cayley table (target index + sign per ordered pair) ────
  const MUL_K = new Int16Array(N * N);
  const MUL_S = new Int8Array(N * N);
  // grade-selected sign tables share MUL_K's targets (only inclusion differs).
  const WEDGE_S = new Int8Array(N * N);
  const LDOT_S  = new Int8Array(N * N);
  const DOT_S   = new Int8Array(N * N);

  for (let i = 0; i < N; i++) {
    const ai = MASK[i], gi = grades[i];
    for (let j = 0; j < N; j++) {
      const bj = MASK[j], gj = grades[j];
      // reorder sign: parity of inversions between the two ascending blades.
      let acc = 0;
      for (let t = ai >> 1; t; t >>= 1) acc += popcount(t & bj);
      let s = (acc & 1) ? -1 : 1;
      // metric: each shared generator squares (e6,e7,e8 → −1; e1..e5 → +1; r=0).
      let common = ai & bj, bit = 0;
      while (common) { if ((common & 1) && bit >= 5) s = -s; common >>= 1; bit++; }
      const resMask = ai ^ bj;
      const k = MASK_TO_INDEX[resMask];
      const gr = grades[k];
      const idx = i * N + j;
      MUL_K[idx] = k;
      MUL_S[idx] = s;
      if (gr === gi + gj)            WEDGE_S[idx] = s;
      if (gr === gj - gi)            LDOT_S[idx]  = s;
      if (gr === Math.abs(gj - gi))  DOT_S[idx]   = s;
    }
  }

  // ── Unary sign maps ─────────────────────────────────────────────────────────
  const REV_S  = new Int8Array(N);
  const CONJ_S = new Int8Array(N);
  const SELF_SQ = new Int8Array(N);          // sign of blade_i² (a pure scalar)
  for (let i = 0; i < N; i++) {
    const g = grades[i];
    REV_S[i]  = [1, 1, -1, -1][g % 4];
    CONJ_S[i] = [1, -1, -1, 1][g % 4];
    SELF_SQ[i] = MUL_S[i * N + i];           // blade_i*blade_i → scalar at index 0
  }
  const LEN_F = new Float64Array(N);         // (a·Conj(a)).s contribution per i
  for (let i = 0; i < N; i++) LEN_F[i] = CONJ_S[i] * SELF_SQ[i];

  // Dual(a) = a.Mul(I): right-multiply by the unit pseudoscalar (index N−1).
  const I_IDX = N - 1;
  const DUAL_K = new Int16Array(N);
  const DUAL_S = new Int8Array(N);
  for (let i = 0; i < N; i++) { DUAL_K[i] = MUL_K[i * N + I_IDX]; DUAL_S[i] = MUL_S[i * N + I_IDX]; }
  // UnDual(a) = a.Mul(I⁻¹). I² = −1 in Cl(5,3), so I⁻¹ = −I → undual = −dual.

  // ── Kernels ─────────────────────────────────────────────────────────────────
  const zero = () => { const r = new A(); r.fill(0); return r; };
  const support = (a) => { const s = []; for (let i = 0; i < N; i++) if (a[i]) s.push(i); return s; };

  function scale(a, c) { const r = zero(); for (let i = 0; i < N; i++) r[i] = (a[i] || 0) * c; return r; }

  // Generic grade-selected (or full) bilinear product over operand support.
  function gp(a, b, S) {
    const r = zero();
    const sa = support(a), sb = support(b);
    for (let p = 0; p < sa.length; p++) {
      const i = sa[p], ai = a[i], base = i * N;
      for (let q = 0; q < sb.length; q++) {
        const j = sb[q], s = S[base + j];
        if (s) r[MUL_K[base + j]] += s * ai * b[j];
      }
    }
    return r;
  }

  const mul = (a, b) =>
    typeof a === 'number' ? scale(b, a)
      : typeof b === 'number' ? scale(a, b)
        : gp(a, b, MUL_S);
  const wedge = (a, b) => gp(a, b, WEDGE_S);
  const dot   = (a, b) => gp(a, b, DOT_S);
  const ldot  = (a, b) => gp(a, b, LDOT_S);

  const reverse   = (a) => { const r = zero(); for (let i = 0; i < N; i++) r[i] = REV_S[i]  * (a[i] || 0); return r; };
  const conjugate = (a) => { const r = zero(); for (let i = 0; i < N; i++) r[i] = CONJ_S[i] * (a[i] || 0); return r; };

  function dual(a) {
    const r = zero();
    for (let i = 0; i < N; i++) { const v = a[i]; if (v) r[DUAL_K[i]] += DUAL_S[i] * v; }
    return r;
  }
  function undual(a) {
    const r = zero();
    for (let i = 0; i < N; i++) { const v = a[i]; if (v) r[DUAL_K[i]] -= DUAL_S[i] * v; }
    return r;
  }

  // Regressive product: dual of the wedge of the duals (ganja's Vee convention).
  const vee = (a, b) => dual(wedge(dual(a), dual(b)));

  // Sandwich M·A·~M (versor application).
  const sw = (M, B) => mul(mul(M, B), reverse(M));

  // Length = sqrt(|(a · Conjugate(a)).s|) — only the scalar part is needed, and a
  // blade contributes to it solely against itself, so this is a sparse dot.
  function length(a) {
    let s = 0;
    for (let i = 0; i < N; i++) { const v = a[i]; if (v) s += v * v * LEN_F[i]; }
    return Math.sqrt(Math.abs(s));
  }

  return {
    mul, wedge, dot, ldot, vee, reverse, conjugate, dual, undual, sw, length,
    // exposed for tests / debugging
    MUL_K, MUL_S, WEDGE_S, LDOT_S, DOT_S, DUAL_K, DUAL_S, MASK,
  };
}
