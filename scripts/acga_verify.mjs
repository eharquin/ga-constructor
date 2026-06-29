// ACGA sparse-engine verification + classify smoke test.
//
//   node scripts/acga_verify.mjs
//
// Part A — engine parity: every sparse kernel is compared to a *pristine* ganja
//   Algebra(4,2) instance across all 64×64 basis-blade pairs (mul/wedge/dot/ldot/
//   vee), all 64 unary blades (dual/reverse/conjugate), and random dense MVs
//   (mul/wedge/vee/sw/length). Zero mismatches required.
//
// Part B — classify/geometry smoke test through the real adapter (point embedding,
//   named conics, the grade-5 OPNS conic C = p1^p2^p3^p4^eob).

import Algebra from 'ganja.js';
import { createEngine } from '../src/algebras/ccga/product.js';
import spec from '../src/algebras/acga/index.js';
import { point2D, circleConic, ellipseConic, hyperbolaConic, parabolaConic, lineConic } from '../src/algebras/acga/embed.js';
import { eob, einfb, Iinf } from '../src/algebras/acga/algebra.js';

const N = 64;
const TOL = 1e-9;

// ─── Part A: engine parity vs pristine ganja ─────────────────────────────────
const G = Algebra({ p: 4, q: 2, graded: false, baseType: Float64Array });
const basis = G.describe().basis;
const bladeIndex = Object.fromEntries(basis.map((n, i) => [n, i]));
const grades = basis.map((n) => (n === '1' ? 0 : n.length - 1));
const eng = createEngine({ A: G, bladeNames: basis, bladeIndex, grades, arraySize: N, posCount: 4 });

const blade = (i) => { const v = new G(); v.fill(0); v[i] = 1; return v; };
const rnd = () => { const v = new G(); for (let k = 0; k < N; k++) v[k] = Math.random() * 2 - 1; return v; };

let fails = 0;
const samples = [];
function cmp(name, a, b) {
  for (let k = 0; k < N; k++) {
    const x = a[k] || 0, y = b[k] || 0;
    if (Math.abs(x - y) > TOL + 1e-9 * Math.abs(y)) {
      fails++;
      if (samples.length < 20) samples.push(`${name} idx ${k}: sparse ${x} vs ganja ${y}`);
      return;
    }
  }
}

console.log('Part A: engine parity (64×64 basis pairs + unary + random dense)…');
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const ei = blade(i), ej = blade(j);
    cmp(`mul ${i},${j}`,   eng.mul(ei, ej),   G.Mul(ei, ej));
    cmp(`wedge ${i},${j}`, eng.wedge(ei, ej), G.Wedge(ei, ej));
    cmp(`dot ${i},${j}`,   eng.dot(ei, ej),   G.Dot(ei, ej));
    cmp(`ldot ${i},${j}`,  eng.ldot(ei, ej),  G.LDot(ei, ej));
    cmp(`vee ${i},${j}`,   eng.vee(ei, ej),   G.Vee(ei, ej));
  }
}
for (let i = 0; i < N; i++) {
  const ei = blade(i);
  cmp(`dual ${i}`,    eng.dual(ei),      G.Dual(ei));
  cmp(`reverse ${i}`, eng.reverse(ei),   G.Reverse(ei));
  cmp(`conj ${i}`,    eng.conjugate(ei), ei.Conjugate);
}
for (let t = 0; t < 300; t++) {
  const a = rnd(), b = rnd();
  cmp('mul rnd',   eng.mul(a, b),   G.Mul(a, b));
  cmp('wedge rnd', eng.wedge(a, b), G.Wedge(a, b));
  cmp('vee rnd',   eng.vee(a, b),   G.Vee(a, b));
  cmp('sw rnd',    eng.sw(a, b),    G.sw(a, b));
  const l1 = eng.length(a), l2 = G.Length(a);
  if (Math.abs(l1 - l2) > 1e-9 * (1 + Math.abs(l2))) {
    fails++; if (samples.length < 20) samples.push(`length: sparse ${l1} vs ganja ${l2}`);
  }
}
if (fails) console.error(`  FAIL — ${fails} mismatches:\n   ` + samples.join('\n   '));
else console.log('  PASS — sparse engine is numerically identical to ganja.');

// ─── Part B: classify / geometry smoke test ──────────────────────────────────
console.log('\nPart B: classify + geometry smoke test…');
const { classifyMV, getRenderPlan, Algebra: AAC } = spec;
let bFails = 0;
const approx = (a, b, t = 1e-4) => Math.abs(a - b) < t;
function check(label, val, pred) {
  const cls = classifyMV(val);
  const plan = getRenderPlan(val);
  const ok = pred(cls, plan);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} → kind=${cls?.kind} ${cls?.subtype ?? ''}`);
  if (!ok) { bFails++; console.log('        plan:', JSON.stringify(plan)); }
}

check('point(2,1)', point2D(2, 1), (c, p) => c.kind === 'finitePoint' && approx(p.x, 2) && approx(p.y, 1));
check('point(0,0,1) round', point2D(0, 0, 1), (c) => c.kind === 'roundPoint' && approx(c.rSq, 1));
// unit circle through (±1,0),(0,±1)
const unit = AAC.Wedge(AAC.Wedge(AAC.Wedge(AAC.Wedge(point2D(1, 0), point2D(-1, 0)), point2D(0, 1)), point2D(0, -1)), eob);
check('P1^P2^P3^P4^eob (unit circle)', unit, (c, p) => c.kind === 'conic' && c.subtype === 'circle' && approx(p.cx, 0) && approx(p.cy, 0) && approx(p.rx, 1, 1e-3));
check('circle(0,0,1)', circleConic(0, 0, 1), (c, p) => c.kind === 'conic' && c.subtype === 'circle' && approx(p.rx, 1, 1e-3));
check('ellipse(2,1)', ellipseConic(2, 1), (c, p) => c.kind === 'conic' && c.subtype === 'ellipse' && approx(Math.max(p.rx, p.ry), 2, 1e-3) && approx(Math.min(p.rx, p.ry), 1, 1e-3));
check('hyperbola(1,1)', hyperbolaConic(1, 1), (c) => c.kind === 'conic' && c.subtype === 'hyperbola');
check('parabola(1)', parabolaConic(1), (c) => c.kind === 'conic' && c.subtype === 'parabola');
check('line(1,0,0)', lineConic(1, 0, 0), (c) => c.kind === 'conic' && c.subtype === 'line');

// ─── taxonomy ladder (grades 2–4) ─────────────────────────────────────────────
const wedge = (...xs) => xs.reduce((a, b) => AAC.Wedge(a, b));
const P1 = point2D(1, 0), P2 = point2D(-1, 0), P3 = point2D(0, 1), P4 = point2D(0, -1);
const nearPt = (pts, x, y, t = 5e-2) => pts.some((p) => Math.hypot(p.x - x, p.y - y) < t);

check('P1^P2 (twopole)', wedge(P1, P2),
  (c, p) => c.kind === 'twopole' && p.kind === 'multipole' && p.points.length === 2);
check('P1^P3^P2 (tripole)', wedge(P1, P3, P2),
  (c, p) => c.kind === 'tripole' && p.kind === 'multipole' && p.points.length === 3
            && nearPt(p.points, 1, 0) && nearPt(p.points, 0, 1) && nearPt(p.points, -1, 0));
check('P1^Iinf (flat point)', AAC.Wedge(point2D(2, 1), Iinf),
  (c, p) => c.kind === 'flatPoint' && approx(p.x, 2) && approx(p.y, 1));
check('P1^P2^eob (conic pencil)', wedge(P1, P2, eob),
  (c, p) => c.kind === 'conicPencil' && p.kind === 'multipole' && p.points.length === 2);
check('P1^P3^P2^eob (conic intersection)', wedge(P1, P3, P2, eob),
  (c, p) => c.kind === 'conicIntersection' && p.kind === 'multipole' && p.points.length === 3);
check('P1^P2^P3^P4 (incomplete conic, dashed)', wedge(P1, P2, P3, P4),
  (c, p) => c.kind === 'conic' && c.subtype === 'circle' && c.incomplete === true
            && p.incomplete === true && approx(p.rx, 1, 1e-3));
// the eob-completed form is the same circle but solid (not incomplete)
check('P1^P2^P3^P4^eob (complete conic, solid)', wedge(P1, P2, P3, P4, eob),
  (c, p) => c.kind === 'conic' && c.subtype === 'circle' && !c.incomplete && !p.incomplete);
// conic intersection from two real conics (the acga_conic_inter workflow)
const E = point2D(-1.09, 0.74), F = point2D(0.19, 0.46), Gp = point2D(-0.62, 0), H = point2D(-0.25, 0.34), J = point2D(0.12, 0.75);
const C1 = wedge(E, F, Gp, H, eob), C2 = wedge(E, F, Gp, J, eob);
check('C1 & C2 (conic intersection)', AAC.Vee(C1, C2),
  (c, p) => c.kind === 'conicIntersection' && p.kind === 'multipole' && p.points.length === 3);

const ok = fails === 0 && bFails === 0;
console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ FAILURES PRESENT');
process.exit(ok ? 0 : 1);
