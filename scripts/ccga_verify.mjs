// CCGA sparse-engine verification.
//
//   node scripts/ccga_verify.mjs
//
// Part A — engine parity (the rigorous gate): every sparse kernel is compared to
//   a *pristine* ganja Algebra(5,3) instance across all 256×256 basis-blade pairs
//   (mul/wedge/dot/ldot/vee), all 256 unary blades (dual/reverse/conjugate), and a
//   batch of random dense multivectors (mul/wedge/vee/sw/length). Products are
//   bilinear, so basis-pair equality ⇒ equality for all inputs; the random dense
//   pass is belt-and-suspenders. Zero mismatches required.
//
// Part B — integration: load every saved_graphs/ccga_*.json, run it through the
//   real adapter pipeline (parseExpression → evaluate → getRenderPlan/classifyMV),
//   assert no crashes and only finite numbers in render plans, and write a snapshot
//   (kind + plan per item) to the scratchpad for optional diffing against main.

import Algebra from 'ganja.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEngine } from '../src/algebras/ccga/product.js';
import spec from '../src/algebras/ccga/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const N = 256;
const TOL = 1e-9;

// ─── Part A: engine parity vs pristine ganja ─────────────────────────────────
const G = Algebra({ p: 5, q: 3, graded: false, baseType: Float64Array });
const basis = G.describe().basis;
const bladeIndex = Object.fromEntries(basis.map((n, i) => [n, i]));
const grades = basis.map((n) => (n === '1' ? 0 : n.length - 1));
const eng = createEngine({ A: G, bladeNames: basis, bladeIndex, grades, arraySize: N, posCount: 5 });

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

console.log('Part A: engine parity (256×256 basis pairs + unary + random dense)…');
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
if (fails) { console.error(`  FAIL — ${fails} mismatches:\n   ` + samples.join('\n   ')); }
else console.log('  PASS — sparse engine is numerically identical to ganja.');

// ─── Part B: saved-graph integration + finiteness ────────────────────────────
console.log('\nPart B: replay saved_graphs/ccga_*.json through the adapter…');
const { parseExpression, evaluate, getRenderPlan, classifyMV } = spec;
const dir = join(ROOT, 'saved_graphs');
const files = readdirSync(dir).filter((f) => /^ccga_.*\.json$/.test(f));

function nonFinite(v, path = '') {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = nonFinite(v[i], `${path}[${i}]`); if (r) return r; } return null; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { const r = nonFinite(v[k], `${path}.${k}`); if (r) return r; } return null; }
  return null;
}

let bFails = 0;
const snapshot = {};
const kindCounts = {};
for (const f of files) {
  const graph = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const items = graph.items ?? [];
  const nodes = {};
  for (const it of items) { const n = parseExpression(it.text); if (n) nodes[n.id] = n; }
  let values;
  try { values = evaluate(nodes, {}); }
  catch (e) { bFails++; console.error(`  ${f}: evaluate threw — ${e.message}`); continue; }
  const entry = [];
  for (const it of items) {
    const n = parseExpression(it.text);
    if (!n) continue;
    const val = values[n.id];
    if (val == null) { entry.push({ text: it.text, kind: null }); continue; }
    const kind = classifyMV(val)?.kind ?? null;
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    let plan = null;
    try { plan = getRenderPlan(val); }
    catch (e) { bFails++; console.error(`  ${f}: getRenderPlan threw on "${it.text}" — ${e.message}`); }
    const bad = plan && nonFinite(plan);
    if (bad) { bFails++; console.error(`  ${f}: non-finite render value at ${bad} for "${it.text}"`); }
    entry.push({ text: it.text, kind, plan });
  }
  snapshot[f] = entry;
}
const snapPath = join(process.env.SNAP_DIR || tmpdir(), 'ccga_snapshot.json');
writeFileSync(snapPath, JSON.stringify(snapshot, null, 1));
console.log(`  ${files.length} graphs, ${bFails} integration failures.`);
console.log('  kinds:', Object.entries(kindCounts).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}=${c}`).join(' '));
console.log(`  snapshot written to ${snapPath}`);

const ok = fails === 0 && bFails === 0;
console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ FAILURES PRESENT');
process.exit(ok ? 0 : 1);
