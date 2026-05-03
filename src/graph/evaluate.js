import { NODE_TYPES } from './nodeTypes.js';

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
export function evaluate(nodes) {
  const order = topoSort(nodes);
  const values = {};

  for (const id of order) {
    const node = nodes[id];
    const fn = NODE_TYPES[node?.type]?.compute;
    if (!fn) continue;
    const depValues = node.deps.map((d) => values[d]);
    if (depValues.some((v) => v == null)) continue; // broken dependency
    try {
      values[id] = fn(depValues, node.params ?? {});
    } catch {
      // node failed to compute — leave it undefined
    }
  }

  return values;
}
