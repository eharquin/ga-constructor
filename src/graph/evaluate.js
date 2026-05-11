import { NODE_TYPES } from './nodeTypes.js';
import { normalizeMVFinit, normalizeMVIdeal } from '../pga.js';

// DFS topological sort. Throws on cycles.
function topoSort(nodes) {
  const visited = new Set();
  const result = [];

  function visit(id, stack = new Set()) {
    if (stack.has(id)) throw new Error(`Cycle detected at node "${id}"`);
    if (visited.has(id)) return;
    stack.add(id);
    const node = nodes[id];
    if (node) {
      for (const dep of node.deps) visit(dep, new Set(stack));
    }
    stack.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of Object.keys(nodes)) visit(id);
  return result;
}

// Evaluate the full graph. Returns { [id]: PGA element }.
// normalizeMap: { [id]: boolean } — when true, the value is normalized before
// being stored so downstream expressions see the normalized version.
export function evaluate(nodes, normalizeMap = {}) {
  const order = topoSort(nodes);
  const values = {};

  for (const id of order) {
    const node = nodes[id];
    const fn = NODE_TYPES[node?.type]?.compute;
    if (!fn) continue;
    const depValues = node.deps.map((d) => values[d]);
    if (depValues.some((v) => v == null)) continue; // broken dependency
    try {
      let val = fn(depValues, node.params ?? {});
      const mode = normalizeMap[id]; // null | 'norm' | 'inorm'
      if (mode && val != null) {
        if (val && typeof val === 'object' && 'vx' in val && typeof val.length === 'undefined') {
          // {vx, vy} ideal vector — only ideal norm applies
          if (mode === 'inorm') {
            const len = Math.sqrt(val.vx ** 2 + val.vy ** 2);
            if (len > 1e-10) val = { vx: val.vx / len, vy: val.vy / len };
          }
        } else if (mode === 'norm') {
          val = normalizeMVFinit(val) ?? val;
        } else if (mode === 'inorm') {
          val = normalizeMVIdeal(val) ?? val;
        }
      }
      values[id] = val;
    } catch {
      // node failed to compute — leave it undefined
    }
  }

  return values;
}
