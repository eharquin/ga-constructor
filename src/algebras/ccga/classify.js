// CCGA classifier + render-plan dispatch + norms. Maps any computed multivector to
// a geometric kind (point / round point / conic / pole / pair / ideal / …) and then
// to a drawable plan, reusing the embed / conic / extract readers. WeakMap caches
// collapse the ~7 classify calls per value per render to one real computation.

import {
  A, ARRAY_SIZE, EPS, isMV, zeroMV,
  einf1, einf2, einf3, Iod, Iinfd, gradeFlags, onlyGrade,
} from './algebra.js';
import {
  toEuclidean, extractRoundPoint, extractFlatPoint, einfWeight, infinityDir,
} from './embed.js';
import { conicCoeffs, conicGeometry } from './conic.js';
import { extractDipole, extractIdealPair, extractTripole, extractQuadpole } from './extract.js';

// A grade-1 vector is a point only if it lies in the point subspace V₆ — no eo3 and
// no eōbar (eo1−eo2) component (an IPNS conic dual DOES occupy them).
function isPointVector(v) {
  let mag = 0;
  for (let i = 1; i <= 8; i++) { const a = Math.abs(v[i] || 0); if (a > mag) mag = a; }
  if (mag < EPS) return true;
  const eo3   = ((v[5] || 0) + (v[8] || 0)) / 2;
  const eob = (((v[3] || 0) + (v[6] || 0)) - ((v[4] || 0) + (v[7] || 0))) / 2;
  const thr = mag * 1e-5;
  return Math.abs(eo3) < thr && Math.abs(eob) < thr;
}

// A genuine Veronese point/round point has its einf coefficients locked to its
// position: einf3 = x·y and einf1−½x² == einf2−½y².
function isVeronesePoint(p) {
  const w = einfWeight(p);
  if (Math.abs(w) < EPS) return false;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const E1 = ((p[6] || 0) - (p[3] || 0)) / w;
  const E2 = ((p[7] || 0) - (p[4] || 0)) / w;
  const E3 = ((p[8] || 0) - (p[5] || 0)) / w;
  const tol = 1e-6 * (1 + x * x + y * y);
  return Math.abs(E3 - x * y) < tol &&
         Math.abs((E1 - 0.5 * x * x) - (E2 - 0.5 * y * y)) < tol;
}

// A "special point" is the pure-position grade-1 vector w·eo + x·e1 + y·e2 — position
// but NO Veronese quadratic lift (all einf coefficients zero).
function isSpecialPoint(p) {
  const w = einfWeight(p);
  if (Math.abs(w) < EPS) return false;
  const einf1c = (p[6] || 0) - (p[3] || 0);
  const einf2c = (p[7] || 0) - (p[4] || 0);
  const einf3c = (p[8] || 0) - (p[5] || 0);
  const thr = Math.max(Math.abs(w), Math.abs(p[1] || 0), Math.abs(p[2] || 0)) * 1e-5;
  return Math.abs(einf1c) < thr && Math.abs(einf2c) < thr && Math.abs(einf3c) < thr;
}

// Disambiguate a pure grade-4 object by which gauge blade divides it (B∧g ≈ 0):
//   flat point p∧Iinf / CGA point pair (p1∧p2)∧Iinfd / quadpole p1∧p2∧p3∧p4.
function classifyGrade4(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;                            // ‖B‖
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;  // ‖B∧g‖ / ‖B‖
  if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'flatPoint' };
  if (w(Iinfd) < 1e-6) {
    const pp = A.LDot(Iod, val);                          // grade-2 dipole p1∧p2
    if (rawNorm(pp) > 1e-6 * n) return { kind: 'pointPair', ccgaPair: pp };
  }
  if (w(Iod) < 1e-6) return { kind: 'conicPencil', n: 2 }; // p1∧p2∧Iod
  return { kind: 'quadpole' };                             // bare p1∧p2∧p3∧p4
}

// Disambiguate a pure grade-3 object: the CGA round-point family O = p∧Iinfd.
function classifyGrade3(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;
  if (w(Iinfd) < 1e-6) {
    const p = A.LDot(Iod, val);                           // grade-1 point p
    if (rawNorm(p) > 1e-6 * n) {
      const rp = extractRoundPoint(p);
      if (rp) {
        const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
        if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint', ccgaPoint: p, cga: true };
        return { kind: 'roundPoint', rSq: rp.rSq, ccgaPoint: p, cga: true };
      }
    }
  }
  // Pure-einf grade-3 blade (a multiple of Iinf) is the line at infinity.
  if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'lineAtInfinity' };
  if (w(Iod) < 1e-6) return { kind: 'conicPencil', n: 1 }; // p∧Iod
  return { kind: 'tripole' };                              // bare p1∧p2∧p3
}

// Disambiguate a pure grade-5 object. Every point-built grade-5 object is a conic.
function classifyGrade5(val) {
  const rawNorm = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
  const n = rawNorm(val) || 1;
  const w = (gauge) => rawNorm(A.Wedge(val, gauge)) / n;
  if (w(Iod) < 1e-6) {
    // Iod is a factor → an under-determined / ideal object, not a single curve.
    if (w(einf1) < 1e-6 && w(einf2) < 1e-6 && w(einf3) < 1e-6) return { kind: 'conicAtInfinity' };
    if (w(Iinfd) < 1e-6) return classifyImpl(A.LDot(Iinfd, val));
    return { kind: 'conicPencil', n: 3 };
  }
  const c7 = A.Wedge(val, Iod);                           // grade-7 OPNS conic
  if (rawNorm(c7) > 1e-6 * n) {
    const geom = conicGeometry(conicCoeffs(c7));
    return { kind: 'conic', subtype: geom.subtype, geom, cga: true };
  }
  return { kind: 'mixed' };
}

function classifyImpl(val) {
  if (typeof val === 'number') return { kind: 'scalar' };
  if (!isMV(val)) return null;

  const g = gradeFlags(val);
  if (!g.some(Boolean)) return { kind: 'scalar' };       // zero MV
  if (onlyGrade(g, 0)) return { kind: 'scalar' };

  // Pure grade-1: a point (null / round / ideal) only if it lies in V₆; otherwise it
  // is a grade-1 IPNS conic (e.g. the dual of a conic).
  if (onlyGrade(g, 1)) {
    if (isPointVector(val)) {
      const rp = extractRoundPoint(val);
      if (rp) {
        if (!isVeronesePoint(val)) {
          if (isSpecialPoint(val)) return { kind: 'specialPoint' };
          return { kind: 'mixed' };
        }
        const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
        if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint' };
        return { kind: 'roundPoint', rSq: rp.rSq };
      }
      // w ≈ 0 → ideal.
      let mag = 0;
      for (let i = 1; i <= 8; i++) { const a = Math.abs(val[i] || 0); if (a > mag) mag = a; }
      const lin = Math.hypot(val[1] || 0, val[2] || 0);
      if (lin < 1e-5 * mag) return { kind: 'infinityPoint' };
      const ethr = Math.max(Math.abs(val[1] || 0), Math.abs(val[2] || 0)) * 1e-5;
      const e1c = (val[6] || 0) - (val[3] || 0);
      const e2c = (val[7] || 0) - (val[4] || 0);
      const e3c = (val[8] || 0) - (val[5] || 0);
      if (Math.abs(e1c) < ethr && Math.abs(e2c) < ethr && Math.abs(e3c) < ethr)
        return { kind: 'specialIdealPoint' };
      return { kind: 'idealPoint' };
    }
    // Grade-1 IPNS conic vector — algebraic/dual form, not drawn directly.
    return { kind: 'mixed' };
  }

  // Pure grade-3: CGA round point (p∧Iinfd) — finite/round point, else mixed.
  if (onlyGrade(g, 3)) return classifyGrade3(val);

  // Pure grade-2: a bare twopole p1∧p2.
  if (onlyGrade(g, 2)) return { kind: 'twopole' };

  // Pure grade-4: flat point / round point / quadpole.
  if (onlyGrade(g, 4)) return classifyGrade4(val);

  // Pure grade-5: CGA circle/line family — conic via Wedge(O,Iod), else mixed.
  if (onlyGrade(g, 5)) return classifyGrade5(val);

  // Pure grade-6: an Iod-gauged object (CGA point pair in conic frame, or 4-point pencil).
  if (onlyGrade(g, 6)) {
    const nb = (mv) => { let s = 0; for (let i = 0; i < ARRAY_SIZE; i++) s += (mv[i] || 0) ** 2; return Math.sqrt(s); };
    const nrm = nb(val) || 1;
    if (nb(A.Wedge(val, Iod)) / nrm < 1e-6) {                 // Iod is a factor
      if (nb(A.Wedge(val, Iinfd)) / nrm < 1e-6)               // …and Iinfd too → CGA point pair
        return classifyImpl(A.LDot(Iinfd, val));
      return { kind: 'conicPencil', n: 4 };
    }
    return { kind: 'mixed' };
  }

  // Pure grade-7: general conic (Iod ∧ p1∧…∧p5). Subtype via the dual coefficients.
  if (onlyGrade(g, 7)) {
    const geom = conicGeometry(conicCoeffs(val));
    return { kind: 'conic', subtype: geom.subtype, geom };
  }

  // Pure grade-8: the pseudoscalar I.
  if (onlyGrade(g, 8)) return { kind: 'pseudoscalar' };

  return { kind: 'mixed' };
}

const _classifyCache = new WeakMap();
const _renderPlanCache = new WeakMap();

export function classifyMV(val) {
  if (val === null || typeof val !== 'object') return classifyImpl(val);
  const hit = _classifyCache.get(val);
  if (hit !== undefined) return hit;
  const res = classifyImpl(val);
  _classifyCache.set(val, res);
  return res;
}

// ─── Norms / weight ──────────────────────────────────────────────────────────
export function normalizeMVFinit(val) {
  if (!isMV(val)) return val;
  // Conformal points are projective — normalize by the origin weight, P ↦ P/−(P·e∞).
  const kind = classifyMV(val)?.kind;
  if (kind === 'finitePoint' || kind === 'roundPoint' || kind === 'specialPoint') {
    const w = einfWeight(val);                       // = −(P·e∞)
    if (Math.abs(w) < 1e-10) return val;
    const r = zeroMV();
    for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / w;
    return r;
  }
  const norm = A.Length(val);
  if (norm < 1e-10) return val;
  const r = zeroMV();
  for (let i = 0; i < ARRAY_SIZE; i++) r[i] = val[i] / norm;
  return r;
}
export const normalizeMVIdeal = normalizeMVFinit;
export const normalizeMV      = normalizeMVFinit;

// Plain L2 magnitude of the components — a Mul-free stand-in for GA Length, used
// only to scale visual thickness.
export function objectWeight(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return Math.abs(val) || 1;
  if (!isMV(val)) return 1;
  let s = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) s += (val[i] || 0) ** 2;
  return Math.sqrt(s) || 1;
}

// ─── Render plan ─────────────────────────────────────────────────────────────
export function getRenderPlan(val) {
  if (val === null || typeof val !== 'object') return renderPlanImpl(val);
  const hit = _renderPlanCache.get(val);
  if (hit !== undefined) return hit;
  const res = renderPlanImpl(val);
  _renderPlanCache.set(val, res);
  return res;
}

function renderPlanImpl(val) {
  if (val == null) return null;
  if (val?.list) {
    const elements = val.items.map(getRenderPlan).filter(Boolean);
    const allPoints = elements.length > 0 &&
      elements.every((e) => e.kind === 'finitePoint' || e.kind === 'roundPoint');
    const outline = allPoints ? elements.map((e) => ({ x: e.x, y: e.y })) : null;
    return { kind: 'list', elements, outline };
  }
  const cls = classifyMV(val);
  if (!cls) return null;
  switch (cls.kind) {
    case 'finitePoint': {
      const eu = toEuclidean(cls.ccgaPoint ?? val);
      return eu ? { kind: 'finitePoint', x: eu.x, y: eu.y, cga: cls.cga } : null;
    }
    case 'specialPoint': {
      const eu = toEuclidean(val);
      return eu ? { kind: 'specialPoint', x: eu.x, y: eu.y } : null;
    }
    case 'roundPoint': {
      const rp = extractRoundPoint(cls.ccgaPoint ?? val);
      return rp ? { kind: 'roundPoint', x: rp.x, y: rp.y, rSq: rp.rSq, cga: cls.cga } : null;
    }
    case 'infinityPoint': {
      const d = val.dir ?? infinityDir(val);
      if (d.vx === 0 && d.vy === 0) return null;
      return { kind: 'positionedVector', vx: d.vx, vy: d.vy, rSq: val.rSq };
    }
    case 'idealPoint': {
      const x = val[1] || 0, y = val[2] || 0;
      const rSq = (x * x + y * y) - 2 * (((val[6] || 0) - (val[3] || 0)) + ((val[7] || 0) - (val[4] || 0)));
      return { kind: 'positionedVector', vx: x, vy: y, rSq };
    }
    case 'specialIdealPoint': {
      return { kind: 'positionedVector', vx: val[1] || 0, vy: val[2] || 0, special: true };
    }
    case 'pointPair': {
      const pp = extractDipole(cls.ccgaPair ?? val);
      return pp ? { kind: 'pointPair', p1: pp.p1, p2: pp.p2, cx: pp.cx, cy: pp.cy, r: pp.r, imaginary: pp.imaginary } : null;
    }
    // n-pole ladder — drawn as its n defining points joined by a dashed outline.
    case 'twopole': {                                   // bare p1∧p2 (now drawn)
      const pp = extractDipole(val);
      if (pp) return { kind: 'multipole', points: [pp.p1, pp.p2], imaginary: pp.imaginary };
      const ip = extractIdealPair(val);
      return ip ? { kind: 'idealPair', dirs: ip.dirs, imaginary: ip.imaginary } : null;
    }
    case 'tripole': {
      const pts = extractTripole(val);
      return pts ? { kind: 'multipole', points: pts } : null;
    }
    case 'quadpole': {
      const pts = extractQuadpole(val);
      return pts ? { kind: 'multipole', points: pts } : null;
    }
    case 'flatPoint': {
      const fp = extractFlatPoint(val);
      return fp ? { kind: 'flatPoint', x: fp.x, y: fp.y } : null;
    }
    case 'conic': {
      const geom = cls.geom ?? conicGeometry(conicCoeffs(val));  // reuse classify's geom
      if (geom.subtype === 'empty') return null;          // imaginary conic — no real locus
      return { kind: 'conic', ...geom, cga: cls.cga };
    }
    default: return null;
  }
}
