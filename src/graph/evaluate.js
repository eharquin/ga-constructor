// Algebra-aware graph evaluator factory.
//
// createEvaluate(algebra, nodeTypes) returns evaluate(nodes, normalizeMap).
// The evaluator topologically sorts the graph, calls each node's compute()
// from the algebra-bound nodeTypes registry, and optionally normalises the
// result via the algebra's finite/ideal normalisers.

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

export function createEvaluate(algebra, nodeTypes) {
  const { normalizeMVFinit, normalizeMVIdeal } = algebra;

  return function evaluate(nodes, normalizeMap = {}) {
    const order = topoSort(nodes);
    const values = {};

    for (const id of order) {
      const node = nodes[id];
      const fn = nodeTypes[node?.type]?.compute;
      if (!fn) continue;
      const depValues = node.deps.map((d) => values[d]);
      // Bail only if a dep that is a real node is still unresolved. A dep name with
      // no node is a named constant (e.g. an MV const like eo1) that the compute
      // resolves itself via the constant env — it is allowed to be undefined here.
      if (node.deps.some((d, i) => nodes[d] && depValues[i] == null)) continue;
      try {
        let val = fn(depValues, node.params ?? {});
        const mode = normalizeMap[id];
        if (mode && val != null) {
          if (val && typeof val === 'object' && 'vx' in val && typeof val.length === 'undefined') {
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
  };
}
