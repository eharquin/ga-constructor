import { useReducer, useMemo, useRef, useState, useEffect } from 'react';
import { parseExpression } from './graph/parseExpression.js';
import { evaluate } from './graph/evaluate.js';
import { toEuclidean } from './pga.js';

// Default type colors (mirrors ExpressionPanel TYPE_COLOR)
const TYPE_COLOR = {
  scalar:     '#a6e3a1',
  freePoint:  '#89b4fa',
  vector:     '#f9e2af',
  motorExp:   '#74c7ec',
  motorApply: '#94e2d5',
  joinLine:   '#cba6f7',
  meetPoint:  '#fab387',
  mvExpr:     '#b4befe',
};

const INITIAL_ITEMS = [
  { id: 'expr_0', text: 'A = point(-150, 100)', color: null, anim: null, drawPos: null },
  { id: 'expr_1', text: 'B = point(150, -100)', color: null, anim: null, drawPos: null },
  { id: 'expr_2', text: 'L1 = A & B',           color: null, anim: null, drawPos: null },
  { id: 'expr_3', text: 'C = point(-150, -80)', color: null, anim: null, drawPos: null },
  { id: 'expr_4', text: 'D = point(150, 80)',   color: null, anim: null, drawPos: null },
  { id: 'expr_5', text: 'L2 = C & D',           color: null, anim: null, drawPos: null },
  { id: 'expr_6', text: 'M = L1 ^ L2',          color: null, anim: null, drawPos: null },
];

function reducer(items, action) {
  switch (action.type) {
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
    case 'INSERT_AFTER': {
      const idx = items.findIndex((it) => it.id === action.afterId);
      const newItem = { id: action.newId, text: '', color: null, anim: null, drawPos: null };
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
    default:
      return items;
  }
}

export function useGraph() {
  const [items, dispatch] = useReducer(reducer, INITIAL_ITEMS);
  const nextId = useRef(INITIAL_ITEMS.length);

  // Animation state — kept separate from items so value updates don't re-trigger the effect
  const [playingIds, setPlayingIds] = useState(new Set());
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const intervalsRef = useRef({});

  useEffect(() => {
    for (const iid of Object.values(intervalsRef.current)) clearInterval(iid);
    intervalsRef.current = {};

    for (const itemId of playingIds) {
      intervalsRef.current[itemId] = setInterval(() => {
        const item = latestItemsRef.current.find((it) => it.id === itemId);
        if (!item) return;
        const node = parseExpression(item.text);
        if (!node || node.type !== 'scalar') return;

        const { min = 0, max = 10, step = 1 } = item.anim ?? {};
        let val = Math.round((node.params.value + step) * 1e10) / 1e10;
        if (step > 0 && val > max) val = min;
        if (step < 0 && val < min) val = max;

        dispatch({ type: 'SET_TEXT', id: itemId, text: `${node.id} = ${val}` });
      }, 50);
    }

    return () => {
      for (const iid of Object.values(intervalsRef.current)) clearInterval(iid);
      intervalsRef.current = {};
    };
  }, [playingIds]);

  const togglePlay = (id) => {
    setPlayingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const nodes = useMemo(() => {
    const result = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node) result[node.id] = node;
    }
    return result;
  }, [items]);

  const values = useMemo(() => {
    try { return evaluate(nodes); }
    catch { return {}; }
  }, [nodes]);

  // colorMap: nodeId → resolved color (custom or type default)
  const colorMap = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (!node) continue;
      map[node.id] = item.color ?? TYPE_COLOR[node.type] ?? '#ffffff';
    }
    return map;
  }, [items]);

  // vectorPositions: nodeId → { x, y, linked } draw position.
  // drawPos can be { x, y } (static) or { ref: nodeId } (follows a point).
  const vectorPositions = useMemo(() => {
    const map = {};
    for (const item of items) {
      const node = parseExpression(item.text);
      if (node?.type !== 'vector') continue;
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

  // If expr is a pure identifier that resolves to a scalar item, update that scalar.
  // Returns true if handled.
  const tryUpdateScalar = (expr, value) => {
    const trimmed = expr.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return false;
    const si = items.find((it) => parseExpression(it.text)?.id === trimmed);
    if (!si) return false;
    dispatch({ type: 'SET_TEXT', id: si.id, text: `${trimmed} = ${Math.round(value)}` });
    return true;
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
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? Math.round(x) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? Math.round(y) : yExpr);
      dispatch({ type: 'SET_TEXT', id: item.id, text: `${nodeId} = point(${xPart}, ${yPart})` });
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
    const xHandled = tryUpdateScalar(xExpr, vx);
    const yHandled = tryUpdateScalar(yExpr, vy);
    if (!xHandled || !yHandled) {
      const xPart = xHandled ? xExpr : (isLiteral(xExpr) ? Math.round(vx) : xExpr);
      const yPart = yHandled ? yExpr : (isLiteral(yExpr) ? Math.round(vy) : yExpr);
      dispatch({ type: 'SET_TEXT', id: item.id, text: `${nodeId} = vector(${xPart}, ${yPart})` });
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
      dispatch({ type: 'SET_TEXT', id: si.id, text: `${m[2]} = ${Math.round(scalarVal)}` });
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
    }));

    dispatch({ type: 'INSERT_MANY_BEFORE', beforeId: itemId, newItems });
  };

  const findVectorItem = (nodeId) =>
    items.find((it) => {
      const n = parseExpression(it.text);
      return n?.id === nodeId && n?.type === 'vector';
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

  return {
    items,
    nodes,
    values,
    colorMap,
    vectorPositions,
    playingIds,
    setItemText:      (id, text)  => dispatch({ type: 'SET_TEXT',  id, text }),
    setItemColor:     (id, color) => dispatch({ type: 'SET_COLOR', id, color }),
    setAnim:          (id, anim)  => dispatch({ type: 'SET_ANIM',  id, anim }),
    setDrawPos,
    setDrawPosRef,
    updateVector,
    togglePlay,
    insertItemAfter,
    deleteItem,
    updateFreePoint,
    updateDepPoint,
    createScalarsFor,
  };
}
