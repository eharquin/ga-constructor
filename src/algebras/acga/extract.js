// ACGA multipole / dipole extraction — recover the defining Euclidean points from the
// grade-2 twopole and grade-3 tripole wedge blades, for rendering. The (axis-aligned)
// sibling of CCGA's extract.js: same closed-form dipole split and circum-conic membership
// scan, but on ℝ(4,2)'s 6 grade-1 slots (no xy cross term).

import {
  A, ARRAY_SIZE, isMV, zeroMV, bvec, scalarSquare, einf, einfb, eob,
} from './algebra.js';
import { euclOfSum } from './embed.js';
import { conicCoeffs, conicGeometry } from './conic.js';

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
  const prod = A.Mul(einf, pp);                          // grade-1 ⊕ grade-3
  const m = zeroMV();
  for (let i = 1; i <= 6; i++) m[i] = -(prod[i] || 0);   // m = −(einf⌋pp), grade-1
  const mSq = scalarSquare(m);
  if (Math.abs(mSq) < 1e-10) return null;                // ideal / degenerate pair
  const inv = zeroMV();
  for (let i = 1; i <= 6; i++) inv[i] = m[i] / mSq;       // m⁻¹
  const G = A.Mul(pp, inv);
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

// Precompute q ↦ ‖q∧B‖² for grade-1 q as a 6×6 symmetric form. The returned residual is
// pure arithmetic over point2D's 6 coords — no ganja per call.
function wedgeResidualForm(B) {
  const W = [];
  for (let i = 1; i <= 6; i++) W.push(A.Wedge(bvec(i), B));
  const M = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++) for (let j = i; j < 6; j++) {
    let s = 0;
    for (let k = 0; k < ARRAY_SIZE; k++) s += (W[i][k] || 0) * (W[j][k] || 0);
    M[i][j] = s; M[j][i] = s;
  }
  return (x, y) => {
    const ax = x * x / 4, ay = y * y / 4;
    const q = [x, y, 1 - ax, 1 - ay, 1 + ax, 1 + ay];   // point2D's e1..e6 coords
    let s = 0;
    for (let i = 0; i < 6; i++) {
      s += q[i] * q[i] * M[i][i];
      for (let j = i + 1; j < 6; j++) s += 2 * q[i] * q[j] * M[i][j];
    }
    return Math.sqrt(Math.max(s, 0));
  };
}

// Tripole p1∧p2∧p3 (grade 3): the 3 points lie on their circumcircle T∧einfb∧eob.
export function extractTripole(T) {
  if (!isMV(T)) return null;
  const geom = conicGeometry(conicCoeffs(A.Wedge(A.Wedge(T, einfb), eob)));
  if (geom.subtype !== 'circle' && geom.subtype !== 'ellipse') return null;  // line/point → collinear
  return findMembershipZeros(wedgeResidualForm(T), sampleCircle(geom, 120), 3, rawNorm(T));
}
