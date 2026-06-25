// AACCGA classifier + render-plan dispatch + norms. Maps any computed multivector to
// a geometric kind (point / round point / ideal / conic / …) and then to a drawable
// plan, reusing the embed / conic readers. WeakMap caches collapse the repeated
// classify calls per value per render to one real computation. This first cut covers
// points (grade 1) and axis-aligned conics (grade 5); grades 2/3/4 are left 'mixed'.

import {
  ARRAY_SIZE, EPS, isMV, zeroMV, A, gradeFlags, onlyGrade,
} from './algebra.js';
import {
  toEuclidean, extractRoundPoint, einfWeight, infinityDir,
} from './embed.js';
import { conicCoeffs, conicGeometry } from './conic.js';

// A grade-1 vector is a point only if it lies in the point subspace — its two origin
// weights match (eōbar ≈ 0). An IPNS conic dual with A≠B has w1≠w2.
function isPointVector(v) {
  let mag = 0;
  for (let i = 1; i <= 6; i++) { const a = Math.abs(v[i] || 0); if (a > mag) mag = a; }
  if (mag < EPS) return true;
  const w1 = ((v[3] || 0) + (v[5] || 0)) / 2;   // eo1 weight = −(v·einf1)
  const w2 = ((v[4] || 0) + (v[6] || 0)) / 2;   // eo2 weight = −(v·einf2)
  return Math.abs(w1 - w2) < mag * 1e-5;
}

// A genuine Veronese point/round point has its einf coefficients locked to its
// position. A round point adds ±½r²·einf, shifting E1 and E2 by the SAME amount, so
// the lock that survives is the difference: (E1−½x²) == (E2−½y²) (E1=½x², E2=½y² for
// a null point). An IPNS conic with A≠B fails this (and is already gated by w1≈w2).
function isVeronesePoint(p) {
  const w = einfWeight(p);
  if (Math.abs(w) < EPS) return false;
  const x = (p[1] || 0) / w, y = (p[2] || 0) / w;
  const E1 = ((p[5] || 0) - (p[3] || 0)) / w;   // = ½x² (+ round-point offset)
  const E2 = ((p[6] || 0) - (p[4] || 0)) / w;   // = ½y² (+ same offset)
  const tol = 1e-6 * (1 + x * x + y * y);
  return Math.abs((E1 - 0.5 * x * x) - (E2 - 0.5 * y * y)) < tol;
}

function classifyImpl(val) {
  if (typeof val === 'number') return { kind: 'scalar' };
  if (!isMV(val)) return null;

  const g = gradeFlags(val);
  if (!g.some(Boolean)) return { kind: 'scalar' };       // zero MV
  if (onlyGrade(g, 0)) return { kind: 'scalar' };

  // Pure grade-1: a point (finite / round / ideal) if it lies in the point subspace;
  // otherwise a grade-1 IPNS conic vector (algebraic/dual form, not drawn directly).
  if (onlyGrade(g, 1)) {
    if (isPointVector(val)) {
      const rp = extractRoundPoint(val);
      if (rp) {
        if (!isVeronesePoint(val)) return { kind: 'mixed' };
        const nullTol = 1e-6 * (1 + rp.x * rp.x + rp.y * rp.y);
        if (Math.abs(rp.rSq) < nullTol) return { kind: 'finitePoint' };
        return { kind: 'roundPoint', rSq: rp.rSq };
      }
      // w ≈ 0 → ideal point at infinity.
      let mag = 0;
      for (let i = 1; i <= 6; i++) { const a = Math.abs(val[i] || 0); if (a > mag) mag = a; }
      const lin = Math.hypot(val[1] || 0, val[2] || 0);
      if (lin < 1e-5 * mag) return { kind: 'infinityPoint' };
      return { kind: 'idealPoint' };
    }
    return { kind: 'mixed' };
  }

  // Pure grade-5: an axis-aligned conic. Dualize to grade-1 → implicit coeffs → geometry.
  if (onlyGrade(g, 5)) {
    const geom = conicGeometry(conicCoeffs(val));
    return { kind: 'conic', subtype: geom.subtype, geom };
  }

  // Pure grade-6: the pseudoscalar I.
  if (onlyGrade(g, 6)) return { kind: 'pseudoscalar' };

  // Grades 2/3/4 (point pairs / n-poles) are out of scope for this cut.
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
  if (kind === 'finitePoint' || kind === 'roundPoint') {
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
      const eu = toEuclidean(val);
      return eu ? { kind: 'finitePoint', x: eu.x, y: eu.y } : null;
    }
    case 'roundPoint': {
      const rp = extractRoundPoint(val);
      return rp ? { kind: 'roundPoint', x: rp.x, y: rp.y, rSq: rp.rSq } : null;
    }
    case 'infinityPoint': {
      const d = val.dir ?? infinityDir(val);
      if (d.vx === 0 && d.vy === 0) return null;
      return { kind: 'positionedVector', vx: d.vx, vy: d.vy, rSq: val.rSq };
    }
    case 'idealPoint': {
      const x = val[1] || 0, y = val[2] || 0;
      const rSq = (x * x + y * y) - 2 * (((val[5] || 0) - (val[3] || 0)) + ((val[6] || 0) - (val[4] || 0)));
      return { kind: 'positionedVector', vx: x, vy: y, rSq };
    }
    case 'conic': {
      const geom = cls.geom ?? conicGeometry(conicCoeffs(val));
      if (geom.subtype === 'empty') return null;          // imaginary conic — no real locus
      return { kind: 'conic', ...geom };
    }
    default: return null;
  }
}
