// CCGA multipole / dipole extraction — recover the defining Euclidean points (and
// ideal directions) from grade-2..4 wedge blades, for rendering. Uses the GA-native
// carrier conics + closed-form Ferrari/Cardano splits rather than SVD radical solvers.

import {
  A, ARRAY_SIZE, isMV, zeroMV, bvec, scalarSquare, scalarOf,
  einf, eo, e1, e2, Iod, Iinfd, EOW12, EOW13, EOW23,
} from './algebra.js';
import { point2D, euclOfSum } from './embed.js';
import {
  conicCoeffs, conicGeometry, det3, coeffsFromGrade1, dualGrade7Coeffs,
  factorLinePair, lineConicPoints, solveCubicReal,
} from './conic.js';

export function rawNorm(mv) {
  if (!isMV(mv)) return Math.abs(mv || 0);
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2;
  return Math.sqrt(s);
}

// Dipole pp = p1∧p2 — split into its two points (point_pairs.ipynb `recover`):
//   m = −(einf⌋pp),  inv = m/(m·m),  P± = normalize((pp ± √(pp²))·inv).
export function extractDipole(pp) {
  if (!isMV(pp)) return null;
  const ppSq = scalarSquare(pp);                         // Mul-free
  const prod = A.Mul(einf, pp);                          // Mul #1 — grade-1 ⊕ grade-3
  const m = zeroMV();
  for (let i = 1; i <= 8; i++) m[i] = -(prod[i] || 0);   // m = −(einf⌋pp), grade-1
  const mSq = scalarSquare(m);
  if (Math.abs(mSq) < 1e-10) return null;                // ideal / degenerate pair
  const inv = zeroMV();
  for (let i = 1; i <= 8; i++) inv[i] = m[i] / mSq;       // m⁻¹
  const G = A.Mul(pp, inv);                              // Mul #2
  const center = euclOfSum(G, inv, 0);
  if (!center) return null;
  const r = Math.sqrt(Math.abs(ppSq / mSq));
  if (ppSq > 1e-9) {
    const s = Math.sqrt(ppSq);
    const P1 = euclOfSum(G, inv, s);
    const P2 = euclOfSum(G, inv, -s);
    if (!P1 || !P2) return null;
    return { p1: P1, p2: P2, cx: center.x, cy: center.y, r, imaginary: false };
  }
  // imaginary / tangent: centre is real, "points" lie along m's direction.
  const mxy = Math.hypot(m[1] || 0, m[2] || 0);
  if (mxy < 1e-10) return null;
  const nx = (m[1] || 0) / mxy, ny = (m[2] || 0) / mxy;
  return {
    p1: { x: center.x + r * nx, y: center.y + r * ny },
    p2: { x: center.x - r * nx, y: center.y - r * ny },
    cx: center.x, cy: center.y, r, imaginary: true,
  };
}

// Pair of ideal directions B = vinf(v1)∧vinf(v2) — a grade-2 blade in the einf
// space. Roots of ½B₂₃·vx² + B₁₂·vx·vy − ½B₁₃·vy² = 0 give the two directions.
export function extractIdealPair(B) {
  if (!isMV(B)) return null;
  const B12 = -scalarOf(A.Mul(EOW12, B));
  const B13 = -scalarOf(A.Mul(EOW13, B));
  const B23 = -scalarOf(A.Mul(EOW23, B));
  const scale = Math.abs(B12) + Math.abs(B13) + Math.abs(B23);
  if (scale < 1e-10) return null;                          // not an einf-plane blade
  const P = 0.5 * B23, Q = B12, R = -0.5 * B13;
  const norm = (vx, vy) => { const n = Math.hypot(vx, vy); return n < 1e-12 ? null : { vx: vx / n, vy: vy / n }; };
  const disc = Q * Q - 4 * P * R;
  let dirs;
  if (disc < -1e-12 * scale * scale) return { dirs: [], imaginary: true };  // ellipse-type
  const s = Math.sqrt(Math.max(disc, 0));
  if (Math.abs(P) > 1e-12 * scale) {                       // solve vx with vy = 1
    dirs = [norm((-Q + s) / (2 * P), 1), norm((-Q - s) / (2 * P), 1)];
  } else if (Math.abs(R) > 1e-12 * scale) {                // P≈0: solve vy with vx = 1
    dirs = [norm(1, (-Q + s) / (2 * R)), norm(1, (-Q - s) / (2 * R))];
  } else {                                                  // P,R≈0: Q·vx·vy = 0
    dirs = [norm(1, 0), norm(0, 1)];
  }
  dirs = dirs.filter(Boolean);
  if (dirs.length === 2 && Math.abs(dirs[0].vx * dirs[1].vy - dirs[0].vy * dirs[1].vx) < 1e-6)
    dirs = [dirs[0]];
  return dirs.length ? { dirs, imaginary: false } : null;
}

const distinctPoint = (list, p, tol = 1e-3) =>
  list.every((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > tol);

// n points around a circle/ellipse carrier (tripole circumcircle).
function sampleCircle(geom, n) {
  const ct = Math.cos(geom.theta || 0), st = Math.sin(geom.theta || 0), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, X = geom.rx * Math.cos(a), Y = geom.ry * Math.sin(a);
    pts.push({ x: geom.cx + X * ct - Y * st, y: geom.cy + X * st + Y * ct });
  }
  return pts;
}

// Golden-section minimum of the residual along the chord lo→hi.
function refineChord(resFn, lo, hi) {
  const g = (Math.sqrt(5) - 1) / 2;
  const at = (t) => ({ x: lo.x + t * (hi.x - lo.x), y: lo.y + t * (hi.y - lo.y) });
  const f = (t) => { const p = at(t); return resFn(p.x, p.y); };
  let a = 0, b = 1, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let k = 0; k < 20; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return at((a + b) / 2);
}

// Scan `resFn` over the sampled carrier, take the `count` lowest local minima.
function findMembershipZeros(resFn, pts, count, scale) {
  if (pts.length < count + 1) return null;
  const res = pts.map((p) => resFn(p.x, p.y));
  if (Math.max(...res) < 1e-6 * (scale || 1)) return null;   // degenerate flat carrier
  let totalGap = 0;
  for (let i = 1; i < pts.length; i++) totalGap += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const medGap = totalGap / (pts.length - 1);
  const cand = [];
  for (let i = 0; i < pts.length; i++) {
    if (res[i] <= (res[i - 1] ?? Infinity) && res[i] <= (res[i + 1] ?? Infinity)) cand.push(i);
  }
  cand.sort((i, j) => res[i] - res[j]);
  const out = [];
  for (const i of cand) {
    let p = pts[i];
    const lo = pts[i - 1], hi = pts[i + 1];
    if (lo && hi && Math.hypot(hi.x - lo.x, hi.y - lo.y) < 4 * medGap) p = refineChord(resFn, lo, hi);
    if (distinctPoint(out, p, 1e-2)) out.push(p);
    if (out.length === count) break;
  }
  return out.length === count ? out : null;
}

// Precompute q ↦ ‖q∧B‖² for grade-1 q as an 8×8 symmetric form. The returned
// residual is pure arithmetic over point2D's 8 coords — no ganja per call.
function wedgeResidualForm(B) {
  const W = [];
  for (let i = 1; i <= 8; i++) W.push(A.Wedge(bvec(i), B));
  const M = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let i = 0; i < 8; i++) for (let j = i; j < 8; j++) {
    let s = 0;
    for (let k = 0; k < ARRAY_SIZE; k++) s += (W[i][k] || 0) * (W[j][k] || 0);
    M[i][j] = s; M[j][i] = s;
  }
  return (x, y) => {
    const ax = x * x / 4, ay = y * y / 4, axy = x * y / 2;
    const q = [x, y, 1 - ax, 1 - ay, -axy, 1 + ax, 1 + ay, axy];   // point2D's e1..e8 coords
    let s = 0;
    for (let i = 0; i < 8; i++) {
      s += q[i] * q[i] * M[i][i];
      for (let j = i + 1; j < 8; j++) s += 2 * q[i] * q[j] * M[i][j];
    }
    return Math.sqrt(Math.max(s, 0));
  };
}

// Tripole p1∧p2∧p3 (grade 3): the 3 points lie on the circum-conic T∧Iod∧Iinfd.
export function extractTripole(T) {
  if (!isMV(T)) return null;
  const geom = conicGeometry(conicCoeffs(A.Wedge(A.Wedge(T, Iod), Iinfd)));
  if (geom.subtype !== 'circle' && geom.subtype !== 'ellipse') return null;  // line/point → collinear
  return findMembershipZeros(wedgeResidualForm(T), sampleCircle(geom, 120), 3, rawNorm(T));
}

// Quadpole p1∧p2∧p3∧p4 (grade 4): the 4 points lie on every member of the pencil
// of conics through them. Iod∧Q∧p5 is pure grade-7 → dualize with the fast 8×8 map.
const pencilMember = (Q, p5) => coeffsFromGrade1(dualGrade7Coeffs(A.Wedge(A.Wedge(Iod, Q), p5)));
const coAdd = (c1, c2, t) => ({
  A: c1.A + t * c2.A, B: c1.B + t * c2.B, C: c1.C + t * c2.C,
  D: c1.D + t * c2.D, E: c1.E + t * c2.E, F: c1.F + t * c2.F,
});
function coIndependent(c1, c2) {                 // not proportional (and both nonzero)
  const v1 = [c1.A, c1.B, c1.C, c1.D, c1.E, c1.F], v2 = [c2.A, c2.B, c2.C, c2.D, c2.E, c2.F];
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < 6; i++) { dot += v1[i] * v2[i]; n1 += v1[i] ** 2; n2 += v2[i] ** 2; }
  return n1 > 1e-12 && n2 > 1e-12 && dot * dot < (1 - 1e-6) * n1 * n2;
}
export function extractQuadpole(Q) {
  if (!isMV(Q)) return null;
  const probes = [einf, eo, e1, point2D(0.31, -0.72), point2D(1, 1), e2];
  const members = [];
  for (const p of probes) {
    const co = pencilMember(Q, p);
    if (Math.abs(det3(co)) > 1e-9 && (members.length === 0 || coIndependent(members[0], co))) {
      members.push(co);
      if (members.length === 2) break;
    }
  }
  if (members.length < 2) return null;
  const [co1, co2] = members;
  const g0 = det3(co1), g3 = det3(co2), gp = det3(coAdd(co1, co2, 1)), gm = det3(coAdd(co1, co2, -1));
  const roots = solveCubicReal(g3, 0.5 * (gp + gm) - g0, 0.5 * (gp - gm) - g3, g0);
  for (const t of roots) {
    const cd = coAdd(co1, co2, t);                 // degenerate pencil member (a line pair)
    const lines = factorLinePair(cd.A, cd.B, cd.C, cd.D, cd.E, cd.F);
    if (lines.length < 2) continue;
    const pts = [];
    for (const L of lines) for (const p of lineConicPoints(L, co1)) if (distinctPoint(pts, p)) pts.push(p);
    if (pts.length === 4) return pts;
  }
  return null;
}
