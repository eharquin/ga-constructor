import { useReducer, useMemo, useRef, useState, useEffect } from 'react';
import { makeItem } from './algebras/itemFactory.js';
import { resolveKindColor } from './colors.js';

// Format a number for expression text: strip floating-point noise, preserve useful decimals.
const fmtNum = (val) => parseFloat(val.toFixed(6));

const AUTO_POINT_NAMES = 'EFGHIJKLMNOPQSUVWYZ'.split('');

function pickPointName(usedIds) {
  for (const n of AUTO_POINT_NAMES) {
    if (!usedIds.has(n)) return n;
  }
  let i = 1;
  while (usedIds.has(`P${i}`)) i++;
  return `P${i}`;
}

// Pure transforms on the items array. Outer `reducer` handles history.
function itemsReducer(items, action) {
  switch (action.type) {
    case 'ADD_ITEM':
      return [...items, makeItem(action.id, action.text)];
    case 'SET_TEXT':
      return items.map((it) => it.id === action.id ? { ...it, text: action.text } : it);
    case 'SET_COLOR':
      return items.map((it) => it.id === action.id ? { ...it, color: action.color } : it);
    case 'SET_ANIM':
      return items.map((it) => it.id === action.id ? { ...it, anim: action.anim } : it);
    case 'SET_DRAW_POS':
      return items.map((it) => it.id === action.id ? { ...it, drawPos: action.drawPos } : it);
    case 'SET_LABEL':
      return items.map((it) => it.id === action.id ? { ...it, label: action.label } : it);
    case 'SET_LABEL_OPTS':
      return items.map((it) => it.id === action.id ? { ...it, labelOpts: action.opts } : it);
    case 'SET_VISIBLE':
      return items.map((it) => it.id === action.id ? { ...it, visible: action.visible } : it);
    case 'SET_MOVABLE':
      return items.map((it) => it.id === action.id ? { ...it, movable: action.movable } : it);
    case 'SET_NORMALIZE_MODE':
      return items.map((it) => it.id === action.id ? { ...it, normalizeMode: action.mode } : it);
    case 'INSERT_AFTER': {
      const idx = items.findIndex((it) => it.id === action.afterId);
      const newItem = makeItem(action.newId, '');
      if (idx === -1) return [...items, newItem];
      return [...items.slice(0, idx + 1), newItem, ...items.slice(idx + 1)];
    }
    case 'INSERT_MANY_BEFORE': {
      const idx = items.findIndex((it) => it.id === action.beforeId);
      if (idx === -1) return [...action.newItems, ...items];
      return [...items.slice(0, idx), ...action.newItems, ...items.slice(idx)];
    }
    case 'DELETE':
      return items.filter((it) => it.id !== action.id);
    case 'CLEAR_ALL':
      return [];
    case 'REORDER': {
      const from = items.findIndex((it) => it.id === action.dragId);
      const to   = items.findIndex((it) => it.id === action.targetId);
      if (from === -1 || to === -1 || from === to) return items;
      let insertAt = action.position === 'before' ? to : to + 1;
      if (from < to) insertAt--;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved);
      return next;
    }
    case 'LOAD_ITEMS':
      return action.items.map((it) => makeItem(it.id, it.text ?? '', {
        color: it.color ?? null,
        anim: it.anim ?? null,
        drawPos: it.drawPos ?? null,
        label: it.label ?? null,
        labelOpts: it.labelOpts ?? null,
        visible: it.visible ?? true,
        movable: it.movable ?? true,
        normalizeMode: it.normalizeMode ?? null,
      }));
    default:
      return items;
  }
}

// ─── Undo/redo wrapper ──────────────────────────────────────────────────────
// Past/future stacks of `items` snapshots. Mutating actions push the prior
// items onto `past` and clear `future`. Two exceptions:
//  - High-frequency drag/anim writes (SET_TEXT, SET_DRAW_POS) targeting the
//    same item within COALESCE_MS collapse into a single history entry.
//  - LOAD_ITEMS-after-algebra-switch (action.fromAlgebraSwitch) skips history.

const HISTORY_CAP    = 100;
const COALESCE_MS    = 400;
const COALESCING_ACTIONS = new Set(['SET_TEXT', 'SET_DRAW_POS']);

function pushPast(past, items) {
  const next = past.length >= HISTORY_CAP ? past.slice(past.length - HISTORY_CAP + 1) : past;
  return [...next, items];
}

function reducer(state, action) {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const prev = state.past[state.past.length - 1];
    return { items: prev, past: state.past.slice(0, -1), future: [...state.future, state.items], lastChange: null };
  }
  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;
    const next = state.future[state.future.length - 1];
    return { items: next, past: pushPast(state.past, state.items), future: state.future.slice(0, -1), lastChange: null };
  }

  const newItems = itemsReducer(state.items, action);
  if (newItems === state.items) return state;

  if (action.fromAlgebraSwitch) {
    return { items: newItems, past: [], future: [], lastChange: null };
  }

  const now = Date.now();
  const isCoalescing = COALESCING_ACTIONS.has(action.type)
    && state.lastChange
    && state.lastChange.type === action.type
    && state.lastChange.id === action.id
    && now - state.lastChange.ts < COALESCE_MS;

  return {
    items: newItems,
    past: isCoalescing ? state.past : pushPast(state.past, state.items),
    future: [],
    lastChange: { type: action.type, id: action.id, ts: now },
  };
}

const initialState = (items) => ({ items, past: [], future: [], lastChange: null });

export function useGraph(algebra) {
  // Algebra-bound primitives — change when the active algebra changes.
  const { parseExpression, evaluate, classifyMV, toEuclidean } = algebra;

  const [state, dispatch] = useReducer(reducer, null, () => {
    try {
      const saved = localStorage.getItem(`ga-items-${algebra.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return initialState(parsed);
      }
    } catch {}
    return initialState(algebra.INITIAL_ITEMS);
  });
  const { items, past, future } = state;

  // Start nextId after the highest expr_N already in items.
  const nextId = useRef(
    Math.max(-1, ...state.items.map((it) => {
      const m = String(it?.id ?? '').match(/^expr_(\d+)$/);
      return m ? parseInt(m[1], 10) : -1;
    })) + 1
  );

  // Persist items to localStorage whenever they change.
  useEffect(() => {
    try { localStorage.setItem(`ga-items-${algebra.id}`, JSON.stringify(items)); }
    catch {}
  }, [items, algebra.id]);

  // Animation state
  const [playingIds,   setPlayingIds]   = useState(new Set());
  const [animSettings, setAnimSettings] = useState({});
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const intervalsRef = useRef({});
  const pingDirRef   = useRef({});

  useEffect(() => {
    for (const iid of Object.values(intervalsRef.current)) clearInterval(iid);
    intervalsRef.current = {};

    for (const itemId of playingIds) {
      const conf  = animSettings[itemId] ?? {};
      const mode  = conf.mode  ?? 'repeat';
      const speed = conf.speed ?? 1;
      const ms    = mode === 'infinite' ? 16 : Math.max(16, Math.round(50 / speed));

      if (pingDirRef.current[itemId] == null) pingDirRef.current[itemId] = 1;

      intervalsRef.current[itemId] = setInterval(() => {
        const item = latestItemsRef.current.find((it) => it.id === itemId);
        if (!item) return;
        const node = parseExpression(item.text);
        if (!node || node.type !== 'scalar') return;

        const { min = 0, max = 10, step = 1 } = item.anim ?? {};
        const absStep = Math.abs(step);
        let val = Math.round(node.params.value * 1e10) / 1e10;

        if (mode === 'pingpong') {
          const dir = pingDirRef.current[itemId];
          val = Math.round((val + dir * absStep) * 1e10) / 1e10;
          if (dir > 0 && val >= max) { val = max; pingDirRef.current[itemId] = -1; }
          else if (dir < 0 && val <= min) { val = min; pingDirRef.current[itemId] = 1; }
        } else if (mode === 'once') {
          val = Math.round((val + absStep) * 1e10) / 1e10;
          if (val >= max) {
            val = max;
            dispatch({ type: 'SET_TEXT', id: itemId, text: `${node.id} = ${val}` });
            setPlayingIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
            return;
          }
        } else {
          val = Math.round((val + absStep) * 1e10) / 1e10;
          if (step > 0 && val > max) val = min;
          if (step < 0 && val < min) val = max;
        }

        dispatch({ type: 'SET_TEXT', id: itemId, text: `${node.id} = ${val}` });
      }, ms);
    }

    return () => {
      for (const iid of Object.values(intervalsRef.current)) clearInterval(iid);
      intervalsRef.current = {};
    };
  }, [playingIds, animSettings, parseExpression]);

  const togglePlay = (id) => {
    const conf = animSettings[id] ?? {};
    const mode = conf.mode ?? 'repeat';
    if (mode === 'once') {
      const item = items.find((it) => it.id === id);
      const node = item && parseExpression(item.text);
      if (node?.type === 'scalar') {
        const { min = 0, max = 10 } = item.anim ?? {};
        if (node.params.value >= max) {
          dispatch({ type: 'SET_TEXT', id, text: `${node.id} = ${min}` });
        }
      }
    }
    setPlayingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { pingDirRef.current[id] = 1; next.add(id); }
      return next;
    });
  };

  const setAnimMode  = (id, mode)  => setAnimSettings((p) => ({ ...p, [id]: { ...(p[id] ?? {}), mode  } }));
  const setAnimSpeed = (id, speed) => setAnimSettings((p) => ({ ...p, [id]: { ...(p[id] ?? {}), speed } }));

  const nodes = useMemo(() => {
    const result = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) result[node.id] = node;
    }
    return result;
  }, [items, parseExpression]);

  const orderedNodeIds = useMemo(() =>
    items.map((item) => parseExpression(item.text)?.id).filter(Boolean),
    [items, parseExpression]
  );

  const normalizeMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) map[node.id] = item.normalizeMode ?? null;
    }
    return map;
  }, [items, parseExpression]);

  const movableMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) map[node.id] = item.movable !== false;
    }
    return map;
  }, [items, parseExpression]);

  const values = useMemo(() => {
    try { return evaluate(nodes, normalizeMap); }
    catch { return {}; }
  }, [nodes, normalizeMap, evaluate]);

  const labelMap = useMemo(() => {
    const fmtVal = (val) => {
      if (val == null) return '?';
      if (typeof val === 'number') return parseFloat(val.toFixed(4)).toString();
      const cls = classifyMV(val);
      if (cls?.kind === 'scalar') return parseFloat((val[0] || 0).toFixed(4)).toString();
      return '?';
    };
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      const raw = item.label ?? null;
      if (!raw) { map[node.id] = null; continue; }
      map[node.id] = raw.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) =>
        name in values ? fmtVal(values[name]) : `{${name}}`
      );
    }
    return map;
  }, [items, values, parseExpression, classifyMV]);

  const labelOptsMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) map[node.id] = item.labelOpts ?? null;
    }
    return map;
  }, [items, parseExpression]);

  const colorMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      map[node.id] = item.color ?? resolveKindColor(values[node.id], algebra, node.type);
    }
    return map;
  }, [items, values, parseExpression, algebra]);

  // vectorPositions: nodeId → { x, y, linked, refId?, anchor? } draw position.
  // Any node whose value is anchorable gets an entry:
  //   - explicit `vector` nodes
  //   - PGA idealPoint values (!L, dual-derived ideal points)
  //   - any value classifying as `vector` (VGA grade-1, mvExpr {vx,vy} results)
  //   - bivectors (anchored at the origin corner of the V^W parallelogram,
  //     or the centre of the literal-bivector loop)
  // `drawPos.ref` resolves against another node's tail or tip via `anchor`:
  //   { ref: 'V', anchor: 'tip' }  → pins to the head of V (default)
  //   { ref: 'V', anchor: 'tail' } → pins to the base of V
  //   PGA finite-point refs use the point's position regardless of anchor.
  const vectorPositions = useMemo(() => {
    const eligible = [];
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      const val = values[node.id];
      const cls = classifyMV(val);
      const isVecNode  = node.type === 'vector';
      const isVecVal   = cls?.kind === 'vector' || cls?.kind === 'idealPoint' ||
                         (val && typeof val === 'object' && 'vx' in val);
      const isBivecVal = cls?.kind === 'bivector';
      if (!isVecNode && !isVecVal && !isBivecVal) continue;
      eligible.push({ id: node.id, item });
      const dp = item.drawPos;
      if (dp?.ref) {
        const refVal = values[dp.ref];
        const refCls = classifyMV(refVal);
        if (refCls?.kind === 'finitePoint' && toEuclidean) {
          const eu = toEuclidean(refVal);
          map[node.id] = { ...(eu ?? { x: 0, y: 0 }), linked: true, refId: dp.ref, anchor: dp.anchor ?? 'tip' };
          continue;
        }
        map[node.id] = null; // defer to pass 2
      } else {
        map[node.id] = { ...(dp ?? { x: 0, y: 0 }), linked: false };
      }
    }

    // Pass 2: resolve refs that point to other vector-like nodes (need their
    // tail position from pass 1 to compute tail/tip).
    const tipOf = (id) => {
      const val = values[id];
      const tail = map[id] ?? { x: 0, y: 0 };
      const xy = algebra.vectorXY?.(val);
      return xy ? { x: tail.x + xy.vx, y: tail.y + xy.vy } : tail;
    };
    const tailOf = (id) => {
      const val = values[id];
      const cls = classifyMV(val);
      if (cls?.kind === 'finitePoint' && toEuclidean) {
        const eu = toEuclidean(val);
        return eu ? { x: eu.x, y: eu.y } : { x: 0, y: 0 };
      }
      return map[id] ?? { x: 0, y: 0 };
    };
    for (let pass = 0; pass < eligible.length; pass++) {
      let progressed = false;
      for (const { id, item } of eligible) {
        if (map[id]) continue;
        const dp = item.drawPos;
        if (!dp?.ref) continue;
        const anchor = dp.anchor ?? 'tip';
        const pos = anchor === 'tail' ? tailOf(dp.ref) : tipOf(dp.ref);
        if (pos != null) {
          map[id] = { x: pos.x, y: pos.y, linked: true, refId: dp.ref, anchor };
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    for (const { id } of eligible) {
      if (!map[id]) map[id] = { x: 0, y: 0, linked: false };
    }
    return map;
  }, [items, values, parseExpression, classifyMV, toEuclidean]);

  const insertItemAfter = (afterId) => {
    const newId = `expr_${nextId.current++}`;
    dispatch({ type: 'INSERT_AFTER', afterId, newId });
    return newId;
  };

  const deleteItem = (id) => {
    dispatch({ type: 'DELETE', id });
    setPlayingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearAll = () => {
    dispatch({ type: 'CLEAR_ALL' });
    setPlayingIds(new Set());
  };

  const loadItems = (newItems, opts = {}) => {
    const arr = Array.isArray(newItems) ? newItems : [];
    dispatch({ type: 'LOAD_ITEMS', items: arr, fromAlgebraSwitch: !!opts.fromAlgebraSwitch });
    let maxN = -1;
    for (const it of arr) {
      const m = String(it?.id ?? '').match(/^expr_(\d+)$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    if (maxN + 1 > nextId.current) nextId.current = maxN + 1;
    setPlayingIds(new Set());
  };

  // Reset to the active algebra's INITIAL_ITEMS whenever the algebra changes.
  // Skip the very first render (useReducer already seeded with the initial showcase).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    let toLoad = algebra.INITIAL_ITEMS;
    try {
      const saved = localStorage.getItem(`ga-items-${algebra.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) toLoad = parsed;
      }
    } catch {}
    loadItems(toLoad, { fromAlgebraSwitch: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algebra.id]);

  const tryUpdateScalar = (expr, value) => {
    const trimmed = expr.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      const si = items.find((it) => parseExpression(it.text)?.id === trimmed);
      if (!si) return false;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${trimmed} = ${fmtNum(value)}` });
      return true;
    }
    const neg = trimmed.match(/^-([A-Za-z_][A-Za-z0-9_]*)$/);
    if (neg) {
      const si = items.find((it) => parseExpression(it.text)?.id === neg[1]);
      if (!si) return false;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${neg[1]} = ${fmtNum(-value)}` });
      return true;
    }
    return false;
  };

  const updateFreePoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'freePoint';
    });
    if (!item) return;
    const node = parseExpression(item.text);
    const isLiteral = (s) => /^-?\d+(\.\d+)?$/.test(s.trim());
    const { xExpr, yExpr } = node.params;
    const xHandled = tryUpdateScalar(xExpr, x);
    const yHandled = tryUpdateScalar(yExpr, y);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(x) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(y) : yExpr);
      const text = node.label !== null
        ? `${nodeId} = point(${xPart}, ${yPart})`
        : `point(${xPart}, ${yPart})`;
      dispatch({ type: 'SET_TEXT', id: item.id, text });
    }
  };

  const updateVector = (nodeId, vx, vy) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'vector';
    });
    if (!item) return;
    const node = parseExpression(item.text);
    const { xExpr, yExpr } = node.params;
    const isLiteral = (s) => /^-?\d+(\.\d+)?$/.test(s.trim());
    const isZeroLit = (s) => isLiteral(s) && +s === 0;
    const isVarRef  = (s) => /^-?[A-Za-z_][A-Za-z0-9_]*$/.test(s.trim());
    const cvx = (isZeroLit(xExpr) && isVarRef(yExpr)) ? 0 : vx;
    const cvy = (isZeroLit(yExpr) && isVarRef(xExpr)) ? 0 : vy;
    const xHandled = tryUpdateScalar(xExpr, cvx);
    const yHandled = tryUpdateScalar(yExpr, cvy);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(cvx) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(cvy) : yExpr);
      const needsText =
        (!xHandled && !(isZeroLit(xExpr) && Math.abs(cvx) < 1e-9)) ||
        (!yHandled && !(isZeroLit(yExpr) && Math.abs(cvy) < 1e-9));
      if (!needsText) return;
      const text = node.label !== null
        ? `${nodeId} = vector(${xPart}, ${yPart})`
        : `vector(${xPart}, ${yPart})`;
      dispatch({ type: 'SET_TEXT', id: item.id, text });
    }
  };

  // Drag a "parametric point" (a multivector node whose value is a finite point).
  // The algebra owns the blade conventions and returns edit instructions; this
  // applies them generically. Algebras without parametric points (VGA, …) expose
  // no parametricPointEdits, so this is a no-op there.
  const updateParametricPoint = (nodeId, x, y) => {
    const node = nodes[nodeId];
    if (!node || !algebra.parametricPointEdits) return;
    const edits = algebra.parametricPointEdits(node, values[nodeId], x, y) ?? [];
    for (const e of edits) {
      if (e.kind === 'scalar') {
        const si = items.find((it) => parseExpression(it.text)?.id === e.name);
        if (si) dispatch({ type: 'SET_TEXT', id: si.id, text: `${e.name} = ${fmtNum(e.value)}` });
      } else if (e.kind === 'text') {
        const item = items.find((it) => parseExpression(it.text)?.id === nodeId);
        if (item) {
          const text = node.label !== null ? `${nodeId} = ${e.rhs}` : e.rhs;
          dispatch({ type: 'SET_TEXT', id: item.id, text });
        }
      }
    }
  };

  const createScalarsFor = (itemId, varNames) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    const node = parseExpression(item.text);
    const weightVar = algebra.weightCoeffVar?.(node);
    const newItems = varNames.map((name) =>
      makeItem(`expr_${nextId.current++}`, `${name} = ${name === weightVar ? 1 : 0}`)
    );
    dispatch({ type: 'INSERT_MANY_BEFORE', beforeId: itemId, newItems });
  };

  // Find the item whose node id is anchorable in vectorPositions.
  // Covers explicit vector / meetPoint nodes plus any value classified as a
  // vector, ideal point, or bivector.
  const findVectorItem = (nodeId) =>
    items.find((it) => {
      const n = parseExpression(it.text);
      if (!n || n.id !== nodeId) return false;
      if (n.type === 'vector' || n.type === 'meetPoint') return true;
      const val = values[n.id];
      const cls = classifyMV(val);
      if (cls?.kind === 'idealPoint' || cls?.kind === 'vector' || cls?.kind === 'bivector') return true;
      return val && typeof val === 'object' && 'vx' in val;
    });

  const setDrawPos = (nodeId, x, y) => {
    const item = findVectorItem(nodeId);
    if (!item) return;
    dispatch({ type: 'SET_DRAW_POS', id: item.id, drawPos: { x, y } });
  };

  // anchor: 'tip' (default — pin to ref's head/position) or 'tail' (ref's base)
  const setDrawPosRef = (nodeId, pointNodeId, anchor = 'tip') => {
    const item = findVectorItem(nodeId);
    if (!item) return;
    dispatch({ type: 'SET_DRAW_POS', id: item.id, drawPos: { ref: pointNodeId, anchor } });
  };

  const reorderItem = (dragId, targetId, position) => {
    dispatch({ type: 'REORDER', dragId, targetId, position });
  };

  const addFreePoint = (x, y) => {
    const usedIds = new Set(items.map((it) => parseExpression(it.text)?.id).filter(Boolean));
    const name  = pickPointName(usedIds);
    const newId = `expr_${nextId.current++}`;
    // PGA: emit `point(...)`; VGA (no freePoint support): emit `vector(...)` so double-click adds a vector.
    const supportsPoint = algebra.supportedNodeTypes?.has('freePoint');
    const text = supportsPoint
      ? `${name} = point(${fmtNum(x)}, ${fmtNum(y)})`
      : `${name} = vector(${fmtNum(x)}, ${fmtNum(y)})`;
    dispatch({ type: 'ADD_ITEM', id: newId, text });
  };

  return {
    items,
    nodes,
    orderedNodeIds,
    values,
    colorMap,
    vectorPositions,
    playingIds,
    animSettings,
    setAnimMode,
    setAnimSpeed,
    setItemText:      (id, text)  => dispatch({ type: 'SET_TEXT',  id, text }),
    setItemColor:     (id, color) => dispatch({ type: 'SET_COLOR', id, color }),
    setAnim:          (id, anim)  => dispatch({ type: 'SET_ANIM',  id, anim }),
    setDrawPos,
    setDrawPosRef,
    updateVector,
    togglePlay,
    labelMap,
    setLabel:       (id, label)   => dispatch({ type: 'SET_LABEL',   id, label }),
    setLabelOpts:   (id, opts)    => dispatch({ type: 'SET_LABEL_OPTS', id, opts }),
    labelOptsMap,
    setItemVisible:    (id, visible)    => dispatch({ type: 'SET_VISIBLE',    id, visible }),
    setItemMovable:    (id, movable)    => dispatch({ type: 'SET_MOVABLE',    id, movable }),
    setItemNormalizeMode: (id, mode)    => dispatch({ type: 'SET_NORMALIZE_MODE', id, mode }),
    normalizeMap,
    movableMap,
    reorderItem,
    insertItemAfter,
    deleteItem,
    clearAll,
    loadItems,
    updateFreePoint,
    updateParametricPoint,
    createScalarsFor,
    addFreePoint,
    algebra,
    undo: () => dispatch({ type: 'UNDO' }),
    redo: () => dispatch({ type: 'REDO' }),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
