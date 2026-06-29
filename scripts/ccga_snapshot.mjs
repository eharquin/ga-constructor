// Dump a deterministic snapshot of every saved CCGA graph's classification +
// render plan, for diffing one code state against another (e.g. pre/post the
// sparse-engine rework). Imports only the public spec, so it runs unchanged on
// any branch/worktree.
//
//   node scripts/ccga_snapshot.mjs > /path/to/snapshot.json

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import spec from '../src/algebras/ccga/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseExpression, evaluate, getRenderPlan, classifyMV } = spec;

// Round all numbers so accumulation-order noise (~1e-12) doesn't show as a diff,
// while any real classification/geometry change does.
const round = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toFixed(6)) : String(v);
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = round(v[k]); return o; }
  return v;
};

const dir = join(ROOT, 'saved_graphs');
const out = {};
for (const f of readdirSync(dir).filter((f) => /^ccga_.*\.json$/.test(f)).sort()) {
  const items = JSON.parse(readFileSync(join(dir, f), 'utf8')).items ?? [];
  const nodes = {};
  for (const it of items) { const n = parseExpression(it.text); if (n) nodes[n.id] = n; }
  let values = {};
  try { values = evaluate(nodes, {}); } catch (e) { out[f] = `EVAL THREW: ${e.message}`; continue; }
  out[f] = items.map((it) => {
    const n = parseExpression(it.text);
    const val = n ? values[n.id] : null;
    if (val == null) return { text: it.text, kind: null };
    let plan = null, kind = null;
    try { kind = classifyMV(val)?.kind ?? null; } catch (e) { kind = `CLASSIFY THREW: ${e.message}`; }
    try { plan = round(getRenderPlan(val)); } catch (e) { plan = `PLAN THREW: ${e.message}`; }
    return { text: it.text, kind, plan };
  });
}
process.stdout.write(JSON.stringify(out, null, 1));
