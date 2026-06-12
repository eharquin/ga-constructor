import { useReducer, useMemo, useRef, useState, useEffect } from 'react';
import { readHashGraph } from './urlHash.js';

// Format a number for expression text: strip floating-point noise, preserve useful decimals.
const fmtNum = (val) => parseFloat(val.toFixed(6));

// Default fallback color when no kind/type matches.
const FALLBACK_COLOR = '#6c7086';

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, labelOpts: null,
  visible: true, movable: true, normalizeMode: null,
  opacity: null, scale: null, pointShape: null, strokeStyle: null,
  showPoints: null, showOutline: null, showFill: null,
  parentId: null, kind: null, folderName: null, collapsed: false,
  ...extra,
});

function nextFolderName(items) {
  const used = new Set(items.filter((it) => it.kind === 'folder').map((it) => it.folderName));
  let i = 1;
  while (used.has(`Folder ${i}`)) i++;
  return `Folder ${i}`;
}

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
      return [...items, ITEM(action.id, action.text)];
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
    case 'SET_OPACITY':
      return items.map((it) => it.id === action.id ? { ...it, opacity: action.opacity } : it);
    case 'SET_SCALE':
      return items.map((it) => it.id === action.id ? { ...it, scale: action.scale } : it);
    case 'SET_POINT_SHAPE':
      return items.map((it) => it.id === action.id ? { ...it, pointShape: action.shape } : it);
    case 'SET_STROKE_STYLE':
      return items.map((it) => it.id === action.id ? { ...it, strokeStyle: action.style } : it);
    case 'SET_LIST_SHOW_POINTS':
      return items.map((it) => it.id === action.id ? { ...it, showPoints: action.show } : it);
    case 'SET_LIST_SHOW_OUTLINE':
      return items.map((it) => it.id === action.id ? { ...it, showOutline: action.show } : it);
    case 'SET_LIST_SHOW_FILL':
      return items.map((it) => it.id === action.id ? { ...it, showFill: action.show } : it);
    case 'ADD_FOLDER':
      return [ITEM(action.id, '', { kind: 'folder', folderName: action.name, parentId: null }), ...items];
    case 'SET_FOLDER_NAME':
      return items.map((it) => it.id === action.id ? { ...it, folderName: action.name } : it);
    case 'SET_FOLDER_COLLAPSED':
      return items.map((it) => it.id === action.id ? { ...it, collapsed: action.collapsed } : it);
    case 'SET_FOLDER_CHILDREN_VISIBLE': {
      const allHidden = items.filter((it) => it.parentId === action.id).every((it) => it.visible === false);
      return items.map((it) => it.parentId === action.id ? { ...it, visible: allHidden ? true : false } : it);
    }
    case 'INSERT_AFTER': {
      const idx = items.findIndex((it) => it.id === action.afterId);
      const newItem = ITEM(action.newId, '', { parentId: action.parentId ?? null });
      if (idx === -1) return [...items, newItem];
      return [...items.slice(0, idx + 1), newItem, ...items.slice(idx + 1)];
    }
    case 'INSERT_MANY_BEFORE': {
      const idx = items.findIndex((it) => it.id === action.beforeId);
      if (idx === -1) return [...action.newItems, ...items];
      return [...items.slice(0, idx), ...action.newItems, ...items.slice(idx)];
    }
    case 'DELETE': {
      const victim = items.find((it) => it.id === action.id);
      if (victim?.kind === 'folder') {
        // Deleting a folder removes all of its child items too.
        return items.filter((it) => it.id !== action.id && it.parentId !== action.id);
      }
      return items.filter((it) => it.id !== action.id);
    }
    case 'CLEAR_ALL':
      return [];
    case 'REORDER': {
      const from = items.findIndex((it) => it.id === action.dragId);
      const to   = items.findIndex((it) => it.id === action.targetId);
      if (from === -1 || to === -1 || from === to) return items;
      const dragged = items[from];
      const target  = items[to];

      // Drop INTO a folder: only valid for non-folder items and only if target is a folder.
      if (action.position === 'inside') {
        if (target.kind !== 'folder' || dragged.kind === 'folder') return items;
        // Find the index just after the last child of this folder, so the new
        // child joins the end of the folder's children block in source order.
        let endOfChildren = to;
        for (let i = to + 1; i < items.length; i++) {
          if (items[i].parentId === target.id) endOfChildren = i;
          else break;
        }
        let insertAt = endOfChildren + 1;
        const next = [...items];
        const [moved] = next.splice(from, 1);
        if (from < insertAt) insertAt--;
        next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, { ...moved, parentId: target.id });
        return next;
      }

      // Sibling drop: new parent = target's parent (folders themselves stay at root).
      const newParentId = dragged.kind === 'folder' ? null : (target.parentId ?? null);

      // A dragged folder moves together with its contiguous child block so the
      // folder + children stay adjacent in the array (rendering invariant).
      let blockEnd = from;
      if (dragged.kind === 'folder') {
        for (let i = from + 1; i < items.length; i++) {
          if (items[i].parentId === dragged.id) blockEnd = i;
          else break;
        }
      }
      const block = items.slice(from, blockEnd + 1);
      const rest = [...items.slice(0, from), ...items.slice(blockEnd + 1)];

      // Locate target in the remaining array; if it's inside the moved block
      // (e.g. dropping a folder onto its own child), bail out unchanged.
      const targetIdx = rest.findIndex((it) => it.id === action.targetId);
      if (targetIdx === -1) return items;

      const insertAt = action.position === 'before' ? targetIdx : targetIdx + 1;
      rest.splice(insertAt, 0, { ...block[0], parentId: newParentId }, ...block.slice(1));
      return rest;
    }
    case 'LOAD_ITEMS':
      return action.items.map((it) => ({
        id: it.id,
        text: it.text ?? '',
        color: it.color ?? null,
        anim: it.anim ?? null,
        drawPos: it.drawPos ?? null,
        label: it.label ?? null,
        labelOpts: it.labelOpts ?? null,
        visible: it.visible ?? true,
        movable: it.movable ?? true,
        normalizeMode: it.normalizeMode ?? null,
        opacity: it.opacity ?? null,
        scale: it.scale ?? null,
        pointShape: it.pointShape ?? null,
        strokeStyle: it.strokeStyle ?? null,
        showPoints: it.showPoints ?? null,
        showOutline: it.showOutline ?? null,
        showFill: it.showFill ?? null,
        parentId: it.parentId ?? null,
        kind: it.kind ?? null,
        folderName: it.folderName ?? null,
        collapsed: it.collapsed ?? false,
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
const COALESCING_ACTIONS = new Set(['SET_TEXT', 'SET_DRAW_POS', 'SET_FOLDER_NAME']);

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
  const KIND_COLOR           = algebra.KIND_COLOR ?? {};
  const TYPE_COLOR_FALLBACK  = algebra.TYPE_COLOR_FALLBACK ?? {};

  const [state, dispatch] = useReducer(reducer, null, () => {
    const fromHash = readHashGraph();
    if (fromHash?.algebra === algebra.id && fromHash.items?.length > 0) {
      return initialState(fromHash.items);
    }
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
      const mode  = conf.mode  ?? 'pingpong';
      const speed = conf.speed ?? 1;
      const ms    = mode === 'infinite' ? 16 : Math.max(16, Math.round(50 / speed));

      if (pingDirRef.current[itemId] == null) pingDirRef.current[itemId] = 1;

      intervalsRef.current[itemId] = setInterval(() => {
        const item = latestItemsRef.current.find((it) => it.id === itemId);
        if (!item) return;
        const node = parseExpression(item.text);
        if (!node || node.type !== 'scalar') return;

        const { min = -10, max = 10, step = 0.1 } = item.anim ?? {};
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
    const mode = conf.mode ?? 'pingpong';
    if (mode === 'once') {
      const item = items.find((it) => it.id === id);
      const node = item && parseExpression(item.text);
      if (node?.type === 'scalar') {
        const { min = -10, max = 10 } = item.anim ?? {};
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
    // Count occurrences of each label so duplicates can be suppressed.
    const labelCounts = new Map();
    for (const item of items) {
      const n = parseExpression(item.text);
      const lbl = n?.label;
      if (!lbl) continue;
      labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
    }
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      // Drop the canvas label entirely when this name collides with another item.
      if (node.label && labelCounts.get(node.label) > 1) { map[node.id] = null; continue; }
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
    // Resolve '@label' color refs to the current hex from values.
    const resolveRef = (ref) => {
      const label = ref.slice(1);
      for (const it2 of items) {
        const n2 = parseExpression(it2.text);
        if (n2 && (n2.label === label || n2.id === label)) {
          const v = values[n2.id];
          if (v && typeof v === 'object' && typeof v.color === 'string') return v.color;
        }
      }
      return FALLBACK_COLOR;
    };

    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      if (item.color) {
        map[node.id] = item.color.startsWith('@') ? resolveRef(item.color) : item.color;
        continue;
      }
      const val = values[node.id];
      if (val && typeof val === 'object' && typeof val.color === 'string') { map[node.id] = val.color; continue; }
      if (val && typeof val === 'object' && 'vx' in val) { map[node.id] = KIND_COLOR.vector ?? KIND_COLOR.idealPoint ?? FALLBACK_COLOR; continue; }
      const cls = classifyMV(val);
      map[node.id] = cls ? (KIND_COLOR[cls.kind] ?? FALLBACK_COLOR) : (TYPE_COLOR_FALLBACK[node.type] ?? FALLBACK_COLOR);
    }
    return map;
  }, [items, values, parseExpression, classifyMV, KIND_COLOR, TYPE_COLOR_FALLBACK]);

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
      const isVecVal   = cls?.kind === 'vector' || cls?.kind === 'idealPoint' || cls?.kind === 'specialIdealPoint' || cls?.kind === 'idealFlatPoint' ||
                         cls?.kind === 'infinityPoint' ||
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
      const cls = classifyMV(val);
      const tail = map[id] ?? { x: 0, y: 0 };
      if (val && typeof val === 'object' && 'vx' in val) return { x: tail.x + val.vx, y: tail.y + val.vy };
      if (cls?.kind === 'vector')      return { x: tail.x + (val[1] || 0), y: tail.y + (val[2] || 0) };
      if (cls?.kind === 'specialIdealPoint') return { x: tail.x + (val[1] || 0), y: tail.y + (val[2] || 0) };
      if (cls?.kind === 'idealPoint')  return { x: tail.x - (val[5] || 0), y: tail.y + (val[4] || 0) };
      return tail;
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

  const insertItemAfter = (afterId, parentId = null) => {
    const newId = `expr_${nextId.current++}`;
    dispatch({ type: 'INSERT_AFTER', afterId, newId, parentId });
    return newId;
  };

  const insertChildInFolder = (folderId) => {
    const newId = `expr_${nextId.current++}`;
    dispatch({ type: 'INSERT_AFTER', afterId: folderId, newId, parentId: folderId });
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
    const { xExpr, yExpr, zExpr } = node.params;
    const xHandled = tryUpdateScalar(xExpr, x);
    const yHandled = tryUpdateScalar(yExpr, y);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(x) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(y) : yExpr);
      const text = algebra.freePointText
        ? algebra.freePointText(node.label !== null ? nodeId : null, xPart, yPart, zExpr)
        : zExpr !== undefined
          ? (node.label !== null ? `${nodeId} = point(${xPart}, ${yPart}, ${zExpr})` : `point(${xPart}, ${yPart}, ${zExpr})`)
          : (node.label !== null ? `${nodeId} = point(${xPart}, ${yPart})` : `point(${xPart}, ${yPart})`);
      dispatch({ type: 'SET_TEXT', id: item.id, text });
    }
  };

  const updateFreeFlatPoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'freeFlatPoint';
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
        ? `${nodeId} = flatPoint(${xPart}, ${yPart})`
        : `flatPoint(${xPart}, ${yPart})`;
      dispatch({ type: 'SET_TEXT', id: item.id, text });
    }
  };

  // CGA ideal round point — tip drag rewrites vector(x, y[, r]) preserving r.
  const updateFreeVector = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'freeVector';
    });
    if (!item) return;
    const node = parseExpression(item.text);
    const isLiteral = (s) => /^-?\d+(\.\d+)?$/.test(s.trim());
    const { xExpr, yExpr, rExpr } = node.params;
    const xHandled = tryUpdateScalar(xExpr, x);
    const yHandled = tryUpdateScalar(yExpr, y);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(x) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(y) : yExpr);
      const args = rExpr !== undefined ? `${xPart}, ${yPart}, ${rExpr}` : `${xPart}, ${yPart}`;
      const text = node.label !== null ? `${nodeId} = vector(${args})` : `vector(${args})`;
      dispatch({ type: 'SET_TEXT', id: item.id, text });
    }
  };

  // CCGA point at infinity — tip drag rewrites vinf(x, y).
  const updateFreeInfinityPoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'freeInfinityPoint';
    });
    if (!item) return;
    const node = parseExpression(item.text);
    const isLiteral = (s) => /^-?\d+(\.\d+)?$/.test(s.trim());
    const { xExpr, yExpr, rExpr } = node.params;
    const xHandled = tryUpdateScalar(xExpr, x);
    const yHandled = tryUpdateScalar(yExpr, y);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(x) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(y) : yExpr);
      const args = rExpr !== undefined ? `${xPart}, ${yPart}, ${rExpr}` : `${xPart}, ${yPart}`;
      const text = node.label !== null ? `${nodeId} = vinf(${args})` : `vinf(${args})`;
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

  const updateDepPoint = (nodeId, x, y) => {
    const node = nodes[nodeId];
    if (!node || node.type !== 'multivector') return;
    const { coeffExprs } = node.params;
    if (!coeffExprs) return;
    const applyCoeff = (expr, targetCoeff) => {
      if (!expr) return;
      const m = expr.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
      if (!m) return;
      const scalarVal = m[1] === '-' ? -targetCoeff : targetCoeff;
      const si = items.find((it) => parseExpression(it.text)?.id === m[2]);
      if (!si) return;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${m[2]} = ${fmtNum(scalarVal)}` });
    };
    if (algebra.depPointCoords) {
      const coords = algebra.depPointCoords(coeffExprs, values[nodeId], x, y);
      for (const [idxStr, val] of Object.entries(coords)) applyCoeff(coeffExprs[+idxStr], val);
    } else {
      const w = values[nodeId]?.[6] ?? 1;
      if (coeffExprs[4] !== undefined) applyCoeff(coeffExprs[4], y * w);
      if (coeffExprs[5] !== undefined) applyCoeff(coeffExprs[5], -x * w);
    }
  };

  const createScalarsFor = (itemId, varNames) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    const node = parseExpression(item.text);
    const e12Vars = new Set();
    if (node?.params?.coeffExprs?.[6]) {
      const m = node.params.coeffExprs[6].match(/^-?([A-Za-z_][A-Za-z0-9_]*)$/);
      if (m) e12Vars.add(m[1]);
    }
    const newItems = varNames.map((name) => ({
      id: `expr_${nextId.current++}`,
      text: `${name} = ${e12Vars.has(name) ? 1 : 0}`,
      color: null, anim: null, drawPos: null, label: null,
    }));
    dispatch({ type: 'INSERT_MANY_BEFORE', beforeId: itemId, newItems });
  };

  const updateDualDepPoint = (nodeId, x, y) => {
    const node = nodes[nodeId];
    if (!node || node.type !== 'multivector' || !node.params?.dual) return;
    const { coeffExprs } = node.params;
    if (!coeffExprs) return;
    const w = values[nodeId]?.[6] ?? 1;
    const applyCoeff = (expr, targetCoeff) => {
      if (!expr) return;
      const m = expr.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
      if (!m) return;
      const scalarVal = m[1] === '-' ? -targetCoeff : targetCoeff;
      const si = items.find((it) => parseExpression(it.text)?.id === m[2]);
      if (!si) return;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${m[2]} = ${fmtNum(scalarVal)}` });
    };
    if (coeffExprs[3] !== undefined) applyCoeff(coeffExprs[3], y * w);
    if (coeffExprs[2] !== undefined) applyCoeff(coeffExprs[2], -x * w);
  };

  const updateLiteralMVPoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'multivector' && !n.params?.dual;
    });
    if (!item) return;
    let text;
    if (algebra.literalMVPointText) {
      text = algebra.literalMVPointText(nodeId, x, y);
    } else {
      const e01 = fmtNum(y);
      const e02 = fmtNum(-x);
      const term = (c, blade) => {
        if (c === 0) return null;
        if (c === 1) return blade;
        if (c === -1) return `-${blade}`;
        return `${c}*${blade}`;
      };
      const parts = [term(e01, 'e01'), term(e02, 'e02'), 'e12'].filter(Boolean);
      const expr = parts.join(' + ').replace(/ \+ -/g, ' - ');
      text = `${nodeId} = ${expr}`;
    }
    dispatch({ type: 'SET_TEXT', id: item.id, text });
  };

  const updateScalarAsComplexPoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'scalar';
    });
    if (!item) return;
    const text = algebra.freePointText
      ? algebra.freePointText(nodeId, String(fmtNum(x)), String(fmtNum(y)))
      : `${nodeId} = ${fmtNum(x)}`;
    dispatch({ type: 'SET_TEXT', id: item.id, text });
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
      if (cls?.kind === 'idealPoint' || cls?.kind === 'vector' || cls?.kind === 'idealFlatPoint' || cls?.kind === 'bivector') return true;
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

  const addFolder = () => {
    const id = `folder_${nextId.current++}`;
    dispatch({ type: 'ADD_FOLDER', id, name: '' });
    return id;
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
    setItemOpacity:       (id, opacity) => dispatch({ type: 'SET_OPACITY',        id, opacity }),
    setItemScale:         (id, scale)   => dispatch({ type: 'SET_SCALE',          id, scale }),
    setItemPointShape:    (id, shape)   => dispatch({ type: 'SET_POINT_SHAPE',    id, shape }),
    setItemStrokeStyle:   (id, style)   => dispatch({ type: 'SET_STROKE_STYLE',   id, style }),
    setListShowPoints:    (id, show)    => dispatch({ type: 'SET_LIST_SHOW_POINTS',  id, show }),
    setListShowOutline:   (id, show)    => dispatch({ type: 'SET_LIST_SHOW_OUTLINE', id, show }),
    setListShowFill:      (id, show)    => dispatch({ type: 'SET_LIST_SHOW_FILL',    id, show }),
    setFolderName:              (id, name)      => dispatch({ type: 'SET_FOLDER_NAME',             id, name }),
    setFolderCollapsed:         (id, collapsed) => dispatch({ type: 'SET_FOLDER_COLLAPSED',         id, collapsed }),
    toggleFolderChildrenVisible:(id)            => dispatch({ type: 'SET_FOLDER_CHILDREN_VISIBLE',  id }),
    addFolder,
    normalizeMap,
    movableMap,
    reorderItem,
    insertItemAfter,
    insertChildInFolder,
    deleteItem,
    clearAll,
    loadItems,
    updateFreePoint,
    updateFreeFlatPoint,
    updateFreeVector,
    updateFreeInfinityPoint,
    updateDepPoint,
    updateDualDepPoint,
    updateLiteralMVPoint,
    updateScalarAsComplexPoint,
    createScalarsFor,
    addFreePoint,
    algebra,
    undo: () => dispatch({ type: 'UNDO' }),
    redo: () => dispatch({ type: 'REDO' }),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
