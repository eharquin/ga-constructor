import { useReducer, useMemo, useRef, useState, useEffect } from 'react';
import { parseExpression } from './graph/parseExpression.js';
import { evaluate } from './graph/evaluate.js';
import { toEuclidean, classifyMV } from './pga.js';

// Format a number for expression text: strip floating-point noise, preserve useful decimals.
const fmtNum = (val) => parseFloat(val.toFixed(6));

// Colors keyed by geometric kind (matches ExpressionPanel KIND_COLOR)
const KIND_COLOR = {
  scalar:      '#a6e3a1',
  finitePoint: '#89b4fa',
  idealPoint:  '#f9e2af',
  line:        '#cba6f7',
  idealLine:   '#cba6f7',
  pseudoscalar:'#f38ba8',
  rotor:       '#74c7ec',
  translator:  '#74c7ec',
  motor:       '#94e2d5',
  reflector:   '#fab387',
  triangle:    '#89dceb',
  mixed:       '#b4befe',
};

// Fallback when value is not yet computed — keyed by parser node type
const TYPE_COLOR_FALLBACK = {
  scalar:    '#a6e3a1',
  freePoint: '#89b4fa',
  vector:    '#f9e2af',
  motorExp:  '#74c7ec',
  triangle:  '#89dceb',
};

const ITEM = (id, text, extra = {}) => ({
  id, text, color: null, anim: null, drawPos: null, label: null, visible: true, normalizeMode: null, ...extra,
});

const INITIAL_ITEMS = [
  // ── Draggable vertices of a triangle ─────────────────────────────────────────
  ITEM('expr_0',  'A = point(-5, 3)'),
  ITEM('expr_1',  'B = point(5, 2)'),
  ITEM('expr_2',  'C = point(0, -5)'),

  // ── Animatable scalar (press ▶) ───────────────────────────────────────────────
  ITEM('expr_3',  't = 0', { anim: { min: 0, max: 6.28, step: 0.05 } }),

  // ── Triangle + sides via join ─────────────────────────────────────────────────
  ITEM('expr_4',  'T = A & B & C'),          // triangle — shows area
  ITEM('expr_5',  'L1 = A & B'),             // side AB
  ITEM('expr_6',  'L2 = B & C'),             // side BC
  ITEM('expr_7',  'L3 = C & A'),             // side CA

  // ── Midpoints and medians ─────────────────────────────────────────────────────
  ITEM('expr_8',  'Mbc = (B + C) / 2'),      // MV arithmetic midpoint
  ITEM('expr_9',  'Mca = (C + A) / 2'),
  ITEM('expr_10', 'mA = A & Mbc'),            // median from A
  ITEM('expr_11', 'mB = B & Mca'),            // median from B

  // ── Centroid = meet of medians ────────────────────────────────────────────────
  ITEM('expr_12', 'G = mA ^ mB'),

  // ── Rotor around centroid G, angle t ─────────────────────────────────────────
  ITEM('expr_13', 'R = exp(G, t)'),
  ITEM('expr_14', 'A2 = R >>> A'),
  ITEM('expr_15', 'B2 = R >>> B'),
  ITEM('expr_16', 'C2 = R >>> C'),
  ITEM('expr_17', 'T2 = A2 & B2 & C2'),      // rotated triangle

  // ── Ideal direction + translator ─────────────────────────────────────────────
  ITEM('expr_18', 'V = vector(1, 0.5)'),      // ideal point / direction
  ITEM('expr_19', 'Tr = exp(V, t)'),          // translator along V
  ITEM('expr_20', 'D = Tr >>> G'),            // translated centroid

  // ── Dual of centroid (polar line) ─────────────────────────────────────────────
  ITEM('expr_21', 'Polar = !G'),

  // ── Meet of original and rotated sides ───────────────────────────────────────
  ITEM('expr_22', 'L1r = A2 & B2'),           // rotated AB
  ITEM('expr_23', 'Xi = L2 ^ L1r'),           // traces a curve as t varies

  // ── Normalized line (try pressing norm) ──────────────────────────────────────
  ITEM('expr_24', 'Ln = A & C'),

  // ── General blade expression ──────────────────────────────────────────────────
  ITEM('expr_25', 'N = 3(e1 + e2 + e0)'),    // explicit line via blade sum
];

const AUTO_POINT_NAMES = 'EFGHIJKLMNOPQSUVWYZ'.split('');

function pickPointName(usedIds) {
  for (const n of AUTO_POINT_NAMES) {
    if (!usedIds.has(n)) return n;
  }
  let i = 1;
  while (usedIds.has(`P${i}`)) i++;
  return `P${i}`;
}

function reducer(items, action) {
  switch (action.type) {
    case 'ADD_ITEM':
      return [...items, { id: action.id, text: action.text, color: null, anim: null, drawPos: null, label: null, visible: true, normalizeMode: null}];
    case 'SET_TEXT':
      return items.map((it) =>
        it.id === action.id ? { ...it, text: action.text } : it
      );
    case 'SET_COLOR':
      return items.map((it) =>
        it.id === action.id ? { ...it, color: action.color } : it
      );
    case 'SET_ANIM':
      return items.map((it) =>
        it.id === action.id ? { ...it, anim: action.anim } : it
      );
    case 'SET_DRAW_POS':
      return items.map((it) =>
        it.id === action.id ? { ...it, drawPos: action.drawPos } : it
      );
    case 'SET_LABEL':
      return items.map((it) =>
        it.id === action.id ? { ...it, label: action.label } : it
      );
    case 'SET_VISIBLE':
      return items.map((it) =>
        it.id === action.id ? { ...it, visible: action.visible } : it
      );
    case 'SET_NORMALIZE_MODE':
      return items.map((it) =>
        it.id === action.id ? { ...it, normalizeMode: action.mode } : it
      );
    case 'INSERT_AFTER': {
      const idx = items.findIndex((it) => it.id === action.afterId);
      const newItem = { id: action.newId, text: '', color: null, anim: null, drawPos: null, label: null, visible: true, normalizeMode: null};
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
    default:
      return items;
  }
}

export function useGraph() {
  const [items, dispatch] = useReducer(reducer, INITIAL_ITEMS);
  const nextId = useRef(26);

  // Animation state — kept separate from items so value updates don't re-trigger the effect
  const [playingIds,   setPlayingIds]   = useState(new Set());
  // animSettings: { [itemId]: { mode, speed } } — also separate to allow mode/speed changes
  // to restart intervals without looping on every scalar tick.
  const [animSettings, setAnimSettings] = useState({});
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const intervalsRef = useRef({});
  const pingDirRef   = useRef({}); // per-item direction for pingpong mode: +1 | -1

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
            setPlayingIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
            return;
          }
        } else {
          // 'repeat' or 'infinite'
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
  }, [playingIds, animSettings]);

  const togglePlay = (id) => {
    const conf = animSettings[id] ?? {};
    const mode = conf.mode ?? 'repeat';
    // 'once' mode: if already at max, reset to min so the next play restarts from the beginning
    if (mode === 'once') {
      const item = items.find(it => it.id === id);
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

  const setAnimMode  = (id, mode)  => setAnimSettings(p => ({ ...p, [id]: { ...(p[id] ?? {}), mode  } }));
  const setAnimSpeed = (id, speed) => setAnimSettings(p => ({ ...p, [id]: { ...(p[id] ?? {}), speed } }));

  const nodes = useMemo(() => {
    const result = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) result[node.id] = node;
    }
    return result;
  }, [items]);

  // Ordered list of node IDs matching the item order — drives canvas draw order.
  const orderedNodeIds = useMemo(() =>
    items.map((item) => parseExpression(item.text)?.id).filter(Boolean),
    [items]
  );

  // labelMap: nodeId → label string (or null when disabled).
  const labelMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      map[node.id] = item.label ?? null;
    }
    return map;
  }, [items]);

  const normalizeMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) map[node.id] = item.normalizeMode ?? null;
    }
    return map;
  }, [items]);

  const values = useMemo(() => {
    try { return evaluate(nodes, normalizeMap); }
    catch { return {}; }
  }, [nodes, normalizeMap]);

  // colorMap: nodeId → resolved color based on computed geometric kind
  const colorMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      if (item.color) { map[node.id] = item.color; continue; }
      const val = values[node.id];
      if (val?.triangle) { map[node.id] = KIND_COLOR.triangle; continue; }
      if (val && typeof val === 'object' && 'vx' in val) { map[node.id] = KIND_COLOR.idealPoint; continue; }
      const cls = classifyMV(val);
      map[node.id] = cls ? (KIND_COLOR[cls.kind] ?? '#6c7086') : (TYPE_COLOR_FALLBACK[node.type] ?? '#6c7086');
    }
    return map;
  }, [items, values]);

  // vectorPositions: nodeId → { x, y, linked } draw position for vector nodes.
  // drawPos can be { x, y } (static) or { ref: nodeId } (follows a point).
  const vectorPositions = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node || node.type !== 'vector') continue;
      const dp = item.drawPos;
      if (dp?.ref) {
        const eu = toEuclidean(values[dp.ref]);
        map[node.id] = { ...(eu ?? { x: 0, y: 0 }), linked: true };
      } else {
        map[node.id] = { ...(dp ?? { x: 0, y: 0 }), linked: false };
      }
    }
    return map;
  }, [items, values]);

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

  // If expr is a pure identifier that resolves to a scalar item, update that scalar.
  // Returns true if handled.
  const tryUpdateScalar = (expr, value) => {
    const trimmed = expr.trim();
    // Plain identifier → update directly
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      const si = items.find((it) => parseExpression(it.text)?.id === trimmed);
      if (!si) return false;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${trimmed} = ${fmtNum(value)}` });
      return true;
    }
    // Negated identifier (-varName) → update with negated value
    const neg = trimmed.match(/^-([A-Za-z_][A-Za-z0-9_]*)$/);
    if (neg) {
      const si = items.find((it) => parseExpression(it.text)?.id === neg[1]);
      if (!si) return false;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${neg[1]} = ${fmtNum(-value)}` });
      return true;
    }
    return false;
  };

  // Move a freePoint node. If coordinate expressions are scalar identifiers,
  // update those scalars; otherwise overwrite literals in the expression text.
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

  // Update vector components by dragging the tip.
  // If coordinate expressions are scalar identifiers, update those scalars.
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
    // Constrain drag to zero for directions whose expression is a zero literal —
    // this prevents diagonal drag on e.g. x*e01 from introducing a vx component.
    const cvx = isZeroLit(xExpr) ? 0 : vx;
    const cvy = isZeroLit(yExpr) ? 0 : vy;
    const xHandled = tryUpdateScalar(xExpr, cvx);
    const yHandled = tryUpdateScalar(yExpr, cvy);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? fmtNum(cvx) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? fmtNum(cvy) : yExpr);
      // Skip text dispatch when the only unhandled parts are zero literals staying at 0
      // (preserves original expression format, e.g. x*e01 remains x*e01).
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

  // Drag a parametric grade-2 multivector point: update its e01/e02 coefficient scalars.
  // coeffExprs[4] (e01) encodes the y-coordinate; coeffExprs[5] (e02) encodes -x.
  const updateDepPoint = (nodeId, x, y) => {
    const node = nodes[nodeId];
    if (!node || node.type !== 'multivector') return;
    const { coeffExprs } = node.params;
    if (!coeffExprs) return;

    const w = values[nodeId]?.[6] ?? 1;

    // expr is 'varName' or '-varName'; update the named scalar to targetCoeff.
    const applyCoeff = (expr, targetCoeff) => {
      if (!expr) return;
      const m = expr.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
      if (!m) return;
      const scalarVal = m[1] === '-' ? -targetCoeff : targetCoeff;
      const si = items.find((it) => parseExpression(it.text)?.id === m[2]);
      if (!si) return;
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${m[2]} = ${fmtNum(scalarVal)}` });
    };

    if (coeffExprs[4] !== undefined) applyCoeff(coeffExprs[4], y * w);   // e01 → y·w
    if (coeffExprs[5] !== undefined) applyCoeff(coeffExprs[5], -x * w);  // e02 → -x·w
  };

  // Insert scalar items (name = 0, or name = 1 for the e12 weight) before itemId.
  const createScalarsFor = (itemId, varNames) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;

    // Detect which var names are the e12 (weight) coefficient → default 1
    const node = parseExpression(item.text);
    const e12Vars = new Set();
    if (node?.params?.coeffExprs?.[6]) {
      const m = node.params.coeffExprs[6].match(/^-?([A-Za-z_][A-Za-z0-9_]*)$/);
      if (m) e12Vars.add(m[1]);
    }

    const newItems = varNames.map((name) => ({
      id: `expr_${nextId.current++}`,
      text: `${name} = ${e12Vars.has(name) ? 1 : 0}`,
      color: null,
      anim: null,
      drawPos: null,
      label: null,
    }));

    dispatch({ type: 'INSERT_MANY_BEFORE', beforeId: itemId, newItems });
  };

  // Drag a dual multivector point !(…): update the pre-dual scalar coefficients.
  // Dual index mapping: e2 (idx 3) → e01 → y·w;  e1 (idx 2) → e02 → -x·w
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

    if (coeffExprs[3] !== undefined) applyCoeff(coeffExprs[3], y * w);   // e2 → e01 → y·w
    if (coeffExprs[2] !== undefined) applyCoeff(coeffExprs[2], -x * w);  // e1 → e02 → -x·w
  };

  // Rebuild a literal grade-2 multivector expression so the point is at (x, y).
  // Normalises to w=1: e01 = round(y), e02 = round(-x), e12 = 1.
  const updateLiteralMVPoint = (nodeId, x, y) => {
    const item = items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'multivector' && !n.params?.dual;
    });
    if (!item) return;

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
    dispatch({ type: 'SET_TEXT', id: item.id, text: `${nodeId} = ${expr}` });
  };

  const findVectorItem = (nodeId) =>
    items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && (n?.type === 'vector' || n?.type === 'meetPoint');
    });

  // Set static draw position for a vector.
  const setDrawPos = (nodeId, x, y) => {
    const item = findVectorItem(nodeId);
    if (!item) return;
    dispatch({ type: 'SET_DRAW_POS', id: item.id, drawPos: { x, y } });
  };

  // Link a vector's draw position to a point node (follows it dynamically).
  const setDrawPosRef = (nodeId, pointNodeId) => {
    const item = findVectorItem(nodeId);
    if (!item) return;
    dispatch({ type: 'SET_DRAW_POS', id: item.id, drawPos: { ref: pointNodeId } });
  };

  const reorderItem = (dragId, targetId, position) => {
    dispatch({ type: 'REORDER', dragId, targetId, position });
  };

  const addFreePoint = (x, y) => {
    const usedIds = new Set(items.map((it) => parseExpression(it.text)?.id).filter(Boolean));
    const name  = pickPointName(usedIds);
    const newId = `expr_${nextId.current++}`;
    dispatch({ type: 'ADD_ITEM', id: newId, text: `${name} = point(${fmtNum(x)}, ${fmtNum(y)})` });
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
    setItemVisible:    (id, visible)    => dispatch({ type: 'SET_VISIBLE',    id, visible }),
    setItemNormalizeMode: (id, mode) => dispatch({ type: 'SET_NORMALIZE_MODE', id, mode }),
    normalizeMap,
    reorderItem,
    insertItemAfter,
    deleteItem,
    clearAll,
    updateFreePoint,
    updateDepPoint,
    updateDualDepPoint,
    updateLiteralMVPoint,
    createScalarsFor,
    addFreePoint,
  };
}
