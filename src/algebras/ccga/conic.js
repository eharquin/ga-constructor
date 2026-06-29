// CCGA conic pipeline — recover implicit coefficients (A..F) from a grade-1 IPNS
// vector or a grade-7 OPNS conic, reduce them to a drawable geometry (centre, axes,
// subtype), and the algebraic helpers (degenerate split, cubic solver, line∩conic).

import { A, GRADES, zeroMV, Iinv, gradeFlags, onlyGrade } from './algebra.js';

// IPNS grade-1 orthogonal coefficients → implicit conic (classify.py:ipns_to_coeffs).
export function coeffsFromGrade1(s) {
  const c1 = s[1]||0, c2 = s[2]||0, c3 = s[3]||0, c4 = s[4]||0,
        c5 = s[5]||0, c6 = s[6]||0, c7 = s[7]||0, c8 = s[8]||0;
  return {
    A: -(c3 + c6) / 4, B: -(c4 + c7) / 4, C: -(c5 + c8) / 2,
    D: c1, E: c2, F: (c3 - c6) + (c4 - c7),
  };
}

// Precomputed grade-7 → grade-1 dual map. Mul(C7, Iinv) sends a pure grade-7 blade
// to grade-1, so it is an 8×8 linear map on the grade-7 / grade-1 slots — building
// it once lets a grade-7 conic dualize with a tiny 8×8 product.
const GRADE7_IDX = GRADES.map((g, i) => (g === 7 ? i : -1)).filter((i) => i >= 0);
const DUAL7 = (() => {
  const m = Array.from({ length: 9 }, () => new Array(GRADE7_IDX.length).fill(0));
  GRADE7_IDX.forEach((idx, c) => {
    const unit = zeroMV(); unit[idx] = 1;
    const d = A.Mul(unit, Iinv);
    for (let r = 1; r <= 8; r++) m[r][c] = d[r] || 0;
  });
  return m;
})();
// grade-1 dual coeffs s[1..8] of a pure grade-7 blade (= Mul(C7, Iinv) at grade 1).
export function dualGrade7Coeffs(C7) {
  const s = new Array(9).fill(0);
  for (let c = 0; c < GRADE7_IDX.length; c++) {
    const v = C7[GRADE7_IDX[c]] || 0;
    if (!v) continue;
    for (let r = 1; r <= 8; r++) s[r] += v * DUAL7[r][c];
  }
  return s;
}

// Coefficients from either conic form: a grade-1 vector is already IPNS; a grade-7
// OPNS conic is dualized first (fast 8×8 map for pure grade-7, else full Mul).
export function conicCoeffs(val) {
  const g = gradeFlags(val);
  if (onlyGrade(g, 1)) return coeffsFromGrade1(val);
  if (onlyGrade(g, 7)) return coeffsFromGrade1(dualGrade7Coeffs(val));
  return coeffsFromGrade1(A.Mul(val, Iinv));
}

// Split a degenerate conic (det H₃ ≈ 0) into its two lines via the adjugate of the
// Hessian (Richter-Gebert / Chomicki et al. Alg. 2). Returns each as nx·x+ny·y+d=0.
export function factorLinePair(a, b, c, d, e, f) {
  const H = [[a, c / 2, d / 2], [c / 2, b, e / 2], [d / 2, e / 2, f]];
  const adj = [
    [H[1][1] * H[2][2] - H[1][2] * H[2][1], -(H[0][1] * H[2][2] - H[0][2] * H[2][1]), H[0][1] * H[1][2] - H[0][2] * H[1][1]],
    [-(H[1][0] * H[2][2] - H[1][2] * H[2][0]), H[0][0] * H[2][2] - H[0][2] * H[2][0], -(H[0][0] * H[1][2] - H[0][2] * H[1][0])],
    [H[1][0] * H[2][1] - H[1][1] * H[2][0], -(H[0][0] * H[2][1] - H[0][1] * H[2][0]), H[0][0] * H[1][1] - H[0][1] * H[1][0]],
  ];
  let i = 0;
  for (let k = 1; k < 3; k++) if (adj[k][k] < adj[i][i]) i = k;
  const beta = Math.sqrt(Math.max(-adj[i][i], 0));
  let N = H;
  if (beta > 1e-12) {
    const r = adj[i];
    const Dm = [[0, -r[2], r[1]], [r[2], 0, -r[0]], [-r[1], r[0], 0]];
    N = H.map((row, ri) => row.map((x, ci) => x + Dm[ri][ci] / beta));
  }
  let jc = 0, best = -1;
  for (let j = 0; j < 3; j++) { const s = N[0][j] ** 2 + N[1][j] ** 2; if (s > best) { best = s; jc = j; } }
  let jr = 0; best = -1;
  for (let j = 0; j < 3; j++) { const s = N[j][0] ** 2 + N[j][1] ** 2; if (s > best) { best = s; jr = j; } }
  const lines = [];
  for (const [u, v, w] of [[N[0][jc], N[1][jc], N[2][jc]], [N[jr][0], N[jr][1], N[jr][2]]]) {
    if (Math.hypot(u, v) > 1e-9) lines.push({ nx: u, ny: v, d: w });
  }
  return lines;
}

// 3×3 conic-matrix determinant (= det of [[A,C/2,D/2],[C/2,B,E/2],[D/2,E/2,F]]).
export function det3(co) {
  const { A: a, B: b, C: c, D: d, E: e, F: f } = co;
  return a * b * f + (c * d * e - c * c * f - b * d * d - a * e * e) / 4;
}

// Real roots of a3·t³ + a2·t² + a1·t + a0 (Cardano; trig form for 3 real roots).
export function solveCubicReal(a3, a2, a1, a0) {
  if (Math.abs(a3) < 1e-12) {                            // a2 t² + a1 t + a0
    if (Math.abs(a2) < 1e-12) return Math.abs(a1) < 1e-12 ? [] : [-a0 / a1];
    const disc = a1 * a1 - 4 * a2 * a0;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-a1 + s) / (2 * a2), (-a1 - s) / (2 * a2)];
  }
  const a = a2 / a3, b = a1 / a3, c = a0 / a3;           // monic t³ + a t² + b t + c
  const p = b - a * a / 3, q = 2 * a * a * a / 27 - a * b / 3 + c;
  const disc = (q * q) / 4 + (p * p * p) / 27, shift = -a / 3;
  if (disc < 0) {                                        // three distinct real roots
    const r = Math.sqrt(-(p * p * p) / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
    const m = 2 * Math.cbrt(r);
    return [0, 1, 2].map((k) => m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift);
  }
  const s = Math.sqrt(disc);
  return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + shift];
}

// Real intersection points of a line (nx·x+ny·y+d=0) with a conic co. Returns 0/1/2.
export function lineConicPoints(line, co) {
  const { nx, ny, d } = line;
  const len2 = nx * nx + ny * ny;
  if (len2 < 1e-18) return [];
  const x0 = -nx * d / len2, y0 = -ny * d / len2;        // foot of perpendicular
  const ux = -ny, uy = nx;                               // (unnormalized) direction
  const { A: cA, B: cB, C: cC, D: cD, E: cE, F: cF } = co;
  const al = cA * ux * ux + cB * uy * uy + cC * ux * uy;
  const be = 2 * cA * x0 * ux + 2 * cB * y0 * uy + cC * (x0 * uy + y0 * ux) + cD * ux + cE * uy;
  const ga = cA * x0 * x0 + cB * y0 * y0 + cC * x0 * y0 + cD * x0 + cE * y0 + cF;
  const at = (t) => ({ x: x0 + t * ux, y: y0 + t * uy });
  if (Math.abs(al) < 1e-12) return Math.abs(be) < 1e-12 ? [] : [at(-ga / be)];
  const disc = be * be - 4 * al * ga;
  if (disc < -1e-9 * (be * be + Math.abs(4 * al * ga) + 1)) return [];
  const s = Math.sqrt(Math.max(disc, 0));
  return [at((-be + s) / (2 * al)), at((-be - s) / (2 * al))];
}

// Reduce (A..F) to a drawable form. Subtype from the discriminant Δ=C²−4AB.
export function conicGeometry(co) {
  const { A: cA, B: cB, C: cC, D: cD, E: cE, F: cF } = co;
  const scale = Math.abs(cA) + Math.abs(cB) + Math.abs(cC) + Math.abs(cD) + Math.abs(cE) + Math.abs(cF) + 1;
  const tol = 1e-7 * scale;
  if (Math.abs(cA) < tol && Math.abs(cB) < tol && Math.abs(cC) < tol)
    return { subtype: 'line', D: cD, E: cE, F: cF };
  const disc = cC * cC - 4 * cA * cB;

  // Degeneracy: Δ₃ = det(Hessian) ≈ 0 ⇒ point / line pair. |Δ₃|/qmax³ is a
  // translation-invariant degeneracy measure; 1e-4 sits between non-degenerate
  // (~0.1) and degenerate (~1e-5) in log space.
  const qmax = Math.max(Math.abs(cA), Math.abs(cB), Math.abs(cC));
  const delta3 = det3(co);
  if (qmax > 0 && Math.abs(delta3) < 1e-4 * qmax * qmax * qmax) {
    const dtol = 1e-3 * qmax * qmax;
    if (disc < -dtol) {
      const det2c = 4 * cA * cB - cC * cC;
      return { subtype: 'point', cx: (-2 * cB * cD + cC * cE) / det2c, cy: (-2 * cA * cE + cC * cD) / det2c };
    }
    return { subtype: Math.abs(disc) <= dtol ? 'parallelLines' : 'linePair', lines: factorLinePair(cA, cB, cC, cD, cE, cF) };
  }
  const theta = 0.5 * Math.atan2(cC, cA - cB);
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Ap = cA * ct * ct + cC * ct * st + cB * st * st;  // X'² coeff after rotation
  const Bp = cA * st * st - cC * ct * st + cB * ct * ct;  // Y'² coeff (cross term ≈ 0)
  if (Math.abs(disc) < 1e-6 * scale)
    return { subtype: 'parabola', D: cD, E: cE, F: cF, theta, Ap, Bp };
  const det2 = 4 * cA * cB - cC * cC;                     // = −disc
  const cx = (-2 * cB * cD + cC * cE) / det2;
  const cy = (-2 * cA * cE + cC * cD) / det2;
  const Fp = cA * cx * cx + cB * cy * cy + cC * cx * cy + cD * cx + cE * cy + cF;  // Q(centre)
  if (disc < 0) {
    const rx2 = -Fp / Ap, ry2 = -Fp / Bp;
    const circle = Math.abs(Ap - Bp) < 1e-4 * Math.max(Math.abs(Ap), Math.abs(Bp));
    if (rx2 <= 0 || ry2 <= 0)  // imaginary: real centre, no real locus — draw |axes| dashed
      return { subtype: circle ? 'circle' : 'ellipse', cx, cy,
               rx: Math.sqrt(Math.abs(rx2)), ry: Math.sqrt(Math.abs(ry2)), theta, imaginary: true };
    return { subtype: circle ? 'circle' : 'ellipse', cx, cy, rx: Math.sqrt(rx2), ry: Math.sqrt(ry2), theta };
  }
  return { subtype: 'hyperbola', cx, cy, Ap, Bp, Fp, theta };  // X'²·Ap + Y'²·Bp = −Fp
}
