import { useRef, useEffect, useState } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { parseExpression } from './graph/parseExpression.js';
import { toEuclidean, lineBaseAndDir } from './pga.js';
import './ExpressionPanel.css';

const TYPE_COLOR = {
  scalar:      '#a6e3a1',
  freePoint:   '#89b4fa',
  vector:      '#f9e2af',
  motorExp:    '#74c7ec',
  motorApply:  '#94e2d5',
  joinLine:    '#cba6f7',
  meetPoint:   '#fab387',
  multivector: '#f38ba8',
  dual:        '#f38ba8',
  mvExpr:      '#b4befe',
};

function resolveColor(item) {
  const node = parseExpression(item.text);
  return item.color ?? (node ? TYPE_COLOR[node.type] : '#6c7086') ?? '#6c7086';
}

function getDisplayValue(text, values) {
  const node = parseExpression(text);
  if (!node) return null;
  const val = values[node.id];
  if (val == null) return null;
  if (node.type === 'scalar')    return String(val);
  if (node.type === 'joinLine')  return 'Line';
  if (node.type === 'motorExp')  return 'Motor';
  if (node.type === 'vector')    return `(${val.vx.toFixed(1)}, ${val.vy.toFixed(1)})`;
  if (node.type === 'mvExpr') {
    if (typeof val === 'number') return val.toFixed(3);
    const eu = toEuclidean(val);
    if (eu) return `(${eu.x.toFixed(1)}, ${eu.y.toFixed(1)})`;
    if (lineBaseAndDir(val)) return 'Line';
    return '—';
  }
  const eu = toEuclidean(val);
  if (eu) return `(${eu.x.toFixed(1)}, ${eu.y.toFixed(1)})`;
  if (lineBaseAndDir(val)) return 'Line';
  if (node.type === 'motorApply' || node.type === 'multivector' || node.type === 'dual') return '—';
  return 'ideal point';
}

// ── Interval helpers (scalars) ────────────────────────────────────────────────

const DEFAULT_ANIM = { min: 0, max: 10, step: 1 };

function formatInterval({ min, max, step }) { return `(${min}, ${max}, ${step})`; }

function parseInterval(str) {
  const m = str.trim().match(/^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?$/);
  if (!m) return null;
  const min = +m[1], max = +m[2], step = +m[3];
  if (isNaN(min) || isNaN(max) || isNaN(step) || step === 0) return null;
  return { min, max, step };
}

// ── Draw-position helpers (vectors) ──────────────────────────────────────────

function formatDrawPos(drawPos) {
  if (!drawPos) return '(0, 0)';
  if ('ref' in drawPos) return drawPos.ref;
  return `(${drawPos.x}, ${drawPos.y})`;
}

function parsePos(str) {
  const m = str.trim().match(/^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?$/);
  if (!m) return null;
  const x = +m[1], y = +m[2];
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y };
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─────────────────────────────────────────────────────────────────────────────

export default function ExpressionPanel() {
  const {
    items, nodes, values, vectorPositions, playingIds,
    setItemText, setItemColor, setAnim, setDrawPos, setDrawPosRef, togglePlay,
    insertItemAfter, deleteItem, createScalarsFor,
  } = useGraphContext();

  const inputRefs    = useRef({});
  const pendingFocus = useRef(null);

  // Local state for in-progress edits (keyed by item id)
  const [animTexts, setAnimTexts] = useState({});
  const [posTxts,  setPosTxts]   = useState({});

  useEffect(() => {
    if (pendingFocus.current) {
      inputRefs.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  });

  const focus = (id) => { pendingFocus.current = id; };

  const handleKeyDown = (e, item, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focus(insertItemAfter(item.id));
    }
    if (e.key === 'Backspace' && item.text === '') {
      e.preventDefault();
      deleteItem(item.id);
      focus(items[index - 1]?.id ?? items[index + 1]?.id ?? null);
    }
    if (e.key === 'ArrowUp'   && index > 0)                { e.preventDefault(); focus(items[index - 1].id); }
    if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault(); focus(items[index + 1].id); }
  };

  const commitAnimText = (itemId) => {
    const str = animTexts[itemId];
    if (str != null) {
      const parsed = parseInterval(str);
      if (parsed) setAnim(itemId, parsed);
      setAnimTexts((p) => { const n = { ...p }; delete n[itemId]; return n; });
    }
  };

  const commitPosText = (itemId, nodeId) => {
    const str = posTxts[itemId];
    if (str != null) {
      const trimmed = str.trim();
      if (ID_RE.test(trimmed)) {
        setDrawPosRef(nodeId, trimmed);          // link to a point node
      } else {
        const parsed = parsePos(trimmed);
        if (parsed) setDrawPos(nodeId, parsed.x, parsed.y);
      }
      setPosTxts((p) => { const n = { ...p }; delete n[itemId]; return n; });
    }
  };

  return (
    <aside className="expr-panel">
      <div className="expr-list">
        {items.map((item, index) => {
          const node      = parseExpression(item.text);
          const isInvalid = item.text.trim() !== '' && !node;
          const isScalar  = node?.type === 'scalar';
          const isVector  = node?.type === 'vector';
          const isPlaying = isScalar && playingIds.has(item.id);
          const color     = resolveColor(item);
          const displayVal = item.text.trim() ? getDisplayValue(item.text, values) : null;
          const anim    = item.anim ?? DEFAULT_ANIM;
          const rawDrawPos = isVector ? (item.drawPos ?? null) : null;
          // Banner only for forms where creating scalars makes sense
          const wantsSuggest = node?.type === 'freePoint' || node?.type === 'vector' || node?.type === 'multivector';
          const missingDeps = wantsSuggest
            ? [...new Set((node.deps ?? []).filter((d) => !nodes[d]))]
            : [];

          return (
            <div key={item.id} className="expr-entry">
              <div className={`expr-row${isInvalid ? ' expr-invalid' : ''}`}>

                {/* Play button — scalar only */}
                {isScalar ? (
                  <button
                    className={`play-btn${isPlaying ? ' playing' : ''}`}
                    tabIndex={-1}
                    onClick={() => togglePlay(item.id)}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                ) : (
                  <div className="play-btn-gap" />
                )}

                {/* Color swatch */}
                <label className="color-swatch" style={{ background: color }} title="Change color">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setItemColor(item.id, e.target.value)}
                    tabIndex={-1}
                  />
                </label>

                <div className="expr-body">
                  <input
                    ref={(el) => { if (el) inputRefs.current[item.id] = el; }}
                    type="text"
                    className="expr-input"
                    value={item.text}
                    placeholder="e.g. A = point(10, 20)"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setItemText(item.id, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, item, index)}
                  />
                  {displayVal && <div className="expr-result" style={{ color }}>{displayVal}</div>}
                  {isInvalid  && <div className="expr-error">unknown syntax</div>}
                </div>

                <button
                  className="expr-delete"
                  tabIndex={-1}
                  onClick={() => deleteItem(item.id)}
                  aria-label="Delete"
                >×</button>
              </div>

              {/* Interval sub-row — scalar only */}
              {isScalar && (
                <div className="sub-row">
                  <span className="sub-label">interval</span>
                  <input
                    className={`sub-input${isPlaying ? ' sub-input-active' : ''}`}
                    value={animTexts[item.id] ?? formatInterval(anim)}
                    onChange={(e) => setAnimTexts((p) => ({ ...p, [item.id]: e.target.value }))}
                    onBlur={() => commitAnimText(item.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    tabIndex={-1}
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Draw-position sub-row — vector only */}
              {isVector && node && (
                <div className="sub-row">
                  <span className="sub-label">position</span>
                  <input
                    className={`sub-input${rawDrawPos?.ref ? ' sub-input-active' : ''}`}
                    value={posTxts[item.id] ?? formatDrawPos(rawDrawPos)}
                    onChange={(e) => setPosTxts((p) => ({ ...p, [item.id]: e.target.value }))}
                    onBlur={() => commitPosText(item.id, node.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    tabIndex={-1}
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Suggestion banner — shown when expression has undefined variable deps */}
              {missingDeps.length > 0 && (
                <div className="suggest-row">
                  <span className="suggest-label">Create: {missingDeps.join(', ')}</span>
                  <button
                    className="suggest-btn"
                    tabIndex={-1}
                    onClick={() => createScalarsFor(item.id, missingDeps)}
                  >
                    + scalars
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        className="expr-add"
        onClick={() => { focus(insertItemAfter(items[items.length - 1]?.id)); }}
      >
        + Add expression
      </button>
    </aside>
  );
}
