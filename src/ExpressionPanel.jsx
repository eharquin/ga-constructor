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
  triangle:    '#89dceb',
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
  if (node.type === 'triangle')  return val?.area != null ? `area: ${val.area.toFixed(2)}` : '—';
  if (node.type === 'joinLine')  return 'Line';
  if (node.type === 'motorExp')  return 'Motor';
  if (node.type === 'vector')    return `(${val.vx.toFixed(1)}, ${val.vy.toFixed(1)})`;
  if (node.type === 'mvExpr') {
    if (typeof val === 'number') return val.toFixed(3);
    const eu = toEuclidean(val);
    if (eu) return `(${eu.x.toFixed(1)}, ${eu.y.toFixed(1)})`;
    if (lineBaseAndDir(val)) return 'Line';
    if (val?.length >= 8 && Math.abs(val[0] ?? 0) > 1e-10) return 'Motor';
    return '—';
  }
  const eu = toEuclidean(val);
  if (eu) return `(${eu.x.toFixed(1)}, ${eu.y.toFixed(1)})`;
  if (lineBaseAndDir(val)) return 'Line';
  if (node.type === 'motorApply' || node.type === 'multivector' || node.type === 'dual') return '—';
  return 'ideal point';
}

// ── Multivector label ─────────────────────────────────────────────────────────

const BLADE_NAMES = ['1', 'e0', 'e1', 'e2', 'e01', 'e02', 'e12', 'e012'];

function fmtCoeff(c) {
  const r = Math.round(c * 1e4) / 1e4;
  if (Number.isInteger(r)) return String(r);
  return r.toPrecision(4).replace(/\.?0+$/, '');
}

// Format a PGA value as a blade sum: "80e01 + 180e02 + e12", "3e0 - e1", etc.
// Returns null for scalars (numbers) and null values.
function formatMV(val) {
  if (val == null || typeof val === 'number') return null;

  let arr;
  if ('vx' in val) {
    // { vx, vy } vector → ideal point representation
    arr = [0, 0, 0, 0, val.vy, -val.vx, 0, 0];
  } else if (val.length >= 8) {
    arr = Array.from(val);
  } else {
    return null;
  }

  const terms = [];
  for (let i = 0; i < 8; i++) {
    const c = arr[i] || 0;
    if (Math.abs(c) < 5e-5) continue;
    const blade = BLADE_NAMES[i];
    const neg   = c < 0;
    const absC  = Math.abs(c);
    let termStr;
    if (blade === '1') {
      termStr = fmtCoeff(absC);
    } else if (Math.abs(absC - 1) < 1e-10) {
      termStr = blade;
    } else {
      termStr = fmtCoeff(absC) + blade;
    }
    terms.push({ neg, termStr });
  }

  if (!terms.length) return '0';
  return terms.map(({ neg, termStr }, i) =>
    (neg ? (i === 0 ? '-' : ' - ') : (i === 0 ? '' : ' + ')) + termStr
  ).join('');
}

// ── Animation mode / speed constants ─────────────────────────────────────────

const ANIM_MODES = [
  { id: 'pingpong', icon: '⇄', label: 'Loop F & B'  },
  { id: 'repeat',   icon: '↻', label: 'Repeat'       },
  { id: 'once',     icon: '⇥', label: 'Play once'    },
  { id: 'infinite', icon: '∞', label: 'Forever'      },
];

const SPEED_LEVELS = [0.25, 0.5, 1, 2, 4, 8];
const fmtSpeed = (s) => `${s}x`;

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
    animSettings, setAnimMode, setAnimSpeed,
    setItemText, setItemColor, setAnim, setDrawPos, setDrawPosRef, setLabel, togglePlay,
    reorderItem, insertItemAfter, deleteItem, createScalarsFor,
  } = useGraphContext();

  const inputRefs    = useRef({});
  const pendingFocus = useRef(null);

  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: 'before'|'after' }

  // Local state for in-progress edits (keyed by item id)
  const [animTexts,  setAnimTexts]  = useState({});
  const [posTxts,    setPosTxts]    = useState({});
  const [labelTexts, setLabelTexts] = useState({});
  const [animMenuIds, setAnimMenuIds] = useState(new Set());
  const toggleAnimMenu = (id) => setAnimMenuIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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
          const isDrawable = node && node.type !== 'scalar' && node.type !== 'motorExp';
          const isPlaying = isScalar && playingIds.has(item.id);
          const color     = resolveColor(item);
          const displayVal = item.text.trim() ? getDisplayValue(item.text, values) : null;
          const mvStr     = node ? formatMV(values[node.id]) : null;
          const anim    = item.anim ?? DEFAULT_ANIM;
          const rawDrawPos = isVector ? (item.drawPos ?? null) : null;
          // Banner only for forms where creating scalars makes sense
          const wantsSuggest = node?.type === 'freePoint' || node?.type === 'vector' || node?.type === 'multivector';
          const missingDeps = wantsSuggest
            ? [...new Set((node.deps ?? []).filter((d) => !nodes[d]))]
            : [];

          const animConf  = animSettings[item.id] ?? {};
          const animMode  = animConf.mode  ?? 'repeat';
          const animSpeed = animConf.speed ?? 1;
          const speedIdx  = SPEED_LEVELS.indexOf(animSpeed);

          const isDragging  = dragId === item.id;
          const isDropBefore = dropTarget?.id === item.id && dropTarget.position === 'before';
          const isDropAfter  = dropTarget?.id === item.id && dropTarget.position === 'after';

          return (
            <div
              key={item.id}
              className={`expr-entry${isDragging ? ' dragging' : ''}${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const pos  = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                setDropTarget((prev) =>
                  prev?.id === item.id && prev?.position === pos ? prev : { id: item.id, position: pos }
                );
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== item.id && dropTarget?.id === item.id) {
                  reorderItem(dragId, item.id, dropTarget.position);
                }
                setDragId(null);
                setDropTarget(null);
              }}
            >
              <div className={`expr-row${isInvalid ? ' expr-invalid' : ''}`}>

                {/* Drag handle */}
                <div
                  className="drag-handle"
                  draggable
                  onDragStart={(e) => {
                    setDragId(item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.id);
                  }}
                  onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                  aria-hidden="true"
                >⠿</div>

                {/* Play + settings buttons — scalar only */}
                {isScalar ? (
                  <div className="play-area">
                    <button
                      className={`play-btn${isPlaying ? ' playing' : ''}`}
                      tabIndex={-1}
                      onClick={() => togglePlay(item.id)}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? '⏸' : '▶'}
                    </button>
                    <button
                      className={`anim-cfg-btn${animMenuIds.has(item.id) ? ' active' : ''}`}
                      tabIndex={-1}
                      onClick={() => toggleAnimMenu(item.id)}
                      title="Animation settings"
                    >⚙</button>
                  </div>
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
                  {mvStr      && <div className="expr-mv">{mvStr}</div>}
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
                <div className={`sub-row${animMode === 'infinite' ? ' sub-row-dim' : ''}`}>
                  <span className="sub-label">interval</span>
                  <input
                    className={`sub-input${isPlaying ? ' sub-input-active' : ''}`}
                    value={animTexts[item.id] ?? formatInterval(anim)}
                    onChange={(e) => setAnimTexts((p) => ({ ...p, [item.id]: e.target.value }))}
                    onBlur={() => commitAnimText(item.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    tabIndex={-1}
                    spellCheck={false}
                    disabled={animMode === 'infinite'}
                  />
                </div>
              )}

              {/* Animation mode + speed menu */}
              {isScalar && animMenuIds.has(item.id) && (
                <div className="anim-menu">
                  <div className="anim-menu-section-label">Animation Mode</div>
                  <div className="anim-mode-grid">
                    {ANIM_MODES.map(({ id: modeId, icon, label: modeLabel }) => (
                      <button
                        key={modeId}
                        className={`anim-mode-btn${animMode === modeId ? ' active' : ''}`}
                        onClick={() => setAnimMode(item.id, modeId)}
                        tabIndex={-1}
                        title={modeLabel}
                      >
                        <span className="anim-mode-icon">{icon}</span>
                      </button>
                    ))}
                  </div>
                  <div className="anim-menu-section-label">Speed</div>
                  <div className="anim-speed-row">
                    <button
                      className="anim-speed-btn"
                      tabIndex={-1}
                      disabled={speedIdx <= 0}
                      onClick={() => speedIdx > 0 && setAnimSpeed(item.id, SPEED_LEVELS[speedIdx - 1])}
                    >«</button>
                    <span className="anim-speed-val">{fmtSpeed(animSpeed)}</span>
                    <button
                      className="anim-speed-btn"
                      tabIndex={-1}
                      disabled={speedIdx >= SPEED_LEVELS.length - 1}
                      onClick={() => speedIdx < SPEED_LEVELS.length - 1 && setAnimSpeed(item.id, SPEED_LEVELS[speedIdx + 1])}
                    >»</button>
                  </div>
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

              {/* Label toggle + editable text — drawable objects only */}
              {isDrawable && (
                <div className="label-row">
                  <input
                    type="checkbox"
                    className="label-checkbox"
                    checked={item.label != null}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setLabel(item.id, node.id);
                      } else {
                        setLabelTexts((p) => { const n = { ...p }; delete n[item.id]; return n; });
                        setLabel(item.id, null);
                      }
                    }}
                    tabIndex={-1}
                  />
                  <span className="label-check-text">label</span>
                  {item.label != null && (
                    <input
                      type="text"
                      className="label-text-input"
                      value={labelTexts[item.id] ?? item.label}
                      onChange={(e) => setLabelTexts((p) => ({ ...p, [item.id]: e.target.value }))}
                      onBlur={() => {
                        const str = labelTexts[item.id];
                        if (str != null) {
                          setLabel(item.id, str.trim() || node.id);
                          setLabelTexts((p) => { const n = { ...p }; delete n[item.id]; return n; });
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      tabIndex={-1}
                      spellCheck={false}
                    />
                  )}
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
