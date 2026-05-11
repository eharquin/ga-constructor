import { useRef, useEffect, useState } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { parseExpression } from './graph/parseExpression.js';
import { toEuclidean, toIdealVector, classifyMV } from './pga.js';
import './ExpressionPanel.css';

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

// Fallback type color for nodes whose value is not yet computed.
const TYPE_COLOR_FALLBACK = {
  scalar:    '#a6e3a1',
  freePoint: '#89b4fa',
  vector:    '#f9e2af',
  motorExp:  '#74c7ec',
  triangle:  '#89dceb',
};

// Returns true when the expression text contains at least 2 top-level & operators
// (i.e. a triple join like A & B & C, possibly wrapped in arithmetic like 0.5*(A & B & C)).
function containsTripleJoin(text) {
  if (!text) return false;
  const m = text.match(/=\s*(.+)$/s);
  const expr = m ? m[1] : text;
  let depth = 0, count = 0;
  for (const c of expr) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '&' && depth === 0) { if (++count >= 2) return true; }
  }
  return false;
}

// Check if the expression already contains a 0.5 factor before the triple join.
function alreadyHalfed(text) {
  const m = text.match(/=\s*(.+)$/s);
  const expr = (m ? m[1] : text).trim();
  return /^0\.5\s*[\*(]/.test(expr);
}

function resolveColor(item, values) {
  if (item.color) return item.color;
  const node = parseExpression(item.text);
  if (!node) return '#6c7086';
  if (node.type === 'triangle' || node.type === 'meetChain' || containsTripleJoin(item.text)) return KIND_COLOR.triangle;
  const val = values?.[node.id];
  if (val && typeof val === 'object' && 'vx' in val) return KIND_COLOR.idealPoint;
  const cls = classifyMV(val);
  return cls ? (KIND_COLOR[cls.kind] ?? '#6c7086') : (TYPE_COLOR_FALLBACK[node.type] ?? '#6c7086');
}

function getDisplayValue(text, values) {
  const node = parseExpression(text);
  if (!node) return null;
  const val = values[node.id];
  if (val == null) return null;

  // Scalar number (includes triangle result which is 2× signed area)
  if (typeof val === 'number') return val.toFixed ? val.toFixed(4).replace(/\.?0+$/, '') : String(val);

  // {vx, vy} ideal vector
  if ('vx' in val) return `(${val.vx.toFixed(2)}, ${val.vy.toFixed(2)})`;

  const cls = classifyMV(val);
  if (!cls) return '—';

  switch (cls.kind) {
    case 'scalar':      return val[0].toFixed(4).replace(/\.?0+$/, '');
    case 'finitePoint': { const eu = toEuclidean(val); return eu ? `(${eu.x.toFixed(2)}, ${eu.y.toFixed(2)})` : '—'; }
    case 'idealPoint':  { const iv = toIdealVector(val); return iv ? `(${iv.vx.toFixed(2)}, ${iv.vy.toFixed(2)})` : '—'; }
    case 'line':        return 'Line';
    case 'idealLine':   return 'Ideal line';
    case 'pseudoscalar':return `${val[7].toFixed(4).replace(/\.?0+$/, '')} e012`;
    case 'rotor':       return 'Rotor';
    case 'translator':  return 'Translator';
    case 'motor':       return 'Motor';
    case 'reflector':   return 'Reflector';
    default:            return '—';
  }
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
// Compute the PGA norm used for unitization.
// Grade-1 (line): sqrt(a²+b²); grade-2 finite point: |e12|;
// grade-2 ideal: sqrt(e01²+e02²); scalar: |s|.
function pgaNorm(arr) {
  const g1 = Math.sqrt(arr[2] ** 2 + arr[3] ** 2);
  if (g1 > 1e-10) return g1;
  const g2w = Math.abs(arr[6]);
  if (g2w > 1e-10) return g2w;
  const g2i = Math.sqrt(arr[4] ** 2 + arr[5] ** 2);
  if (g2i > 1e-10) return g2i;
  const s = Math.abs(arr[0]);
  if (s > 1e-10) return s;
  return null;
}

function normalizeArr(arr) {
  const norm = pgaNorm(arr);
  if (!norm) return arr;
  const result = arr.map(c => c / norm);
  // Canonicalize sign: first non-zero coefficient positive.
  const leading = result.find(c => Math.abs(c) > 1e-10);
  return leading < 0 ? result.map(c => -c) : result;
}

function formatMV(val, normalize = false) {
  if (val == null || typeof val === 'number') return null;

  let arr;
  if ('vx' in val) {
    // Use raw PGA coefficients when available (e.g. meet of parallel lines preserves magnitude).
    // Fallback to reconstructing from vx/vy for plain { vx, vy } vectors.
    let e01 = 'e01' in val ? val.e01 : val.vy;
    let e02 = 'e02' in val ? val.e02 : -val.vx;
    if (normalize) {
      const len = Math.sqrt(e01 * e01 + e02 * e02);
      if (len > 1e-10) {
        e01 /= len; e02 /= len;
        const leading = Math.abs(e01) > 1e-10 ? e01 : e02;
        if (leading < 0) { e01 = -e01; e02 = -e02; }
      }
    }
    arr = [0, 0, 0, 0, e01, e02, 0, 0];
  } else if (val.length >= 8) {
    arr = normalize ? normalizeArr(Array.from(val)) : Array.from(val);
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

function formatDrawPos(drawPos, fallbackPos) {
  if (drawPos) {
    if ('ref' in drawPos) return drawPos.ref;
    return `(${drawPos.x}, ${drawPos.y})`;
  }
  if (fallbackPos) return `(${fallbackPos.x}, ${fallbackPos.y})`;
  return '(0, 0)';
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
    setItemText, setItemColor, setItemVisible, setItemNormalizeMode, setShowArea, setAnim, setDrawPos, setDrawPosRef, setLabel, togglePlay,
    reorderItem, insertItemAfter, deleteItem, clearAll, createScalarsFor,
    showAreaMap,
  } = useGraphContext();

  const inputRefs    = useRef({});
  const pendingFocus = useRef(null);

  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: 'before'|'after' }

  // Local state for in-progress edits (keyed by item id)
  const [animTexts,  setAnimTexts]  = useState({});
  const [posTxts,    setPosTxts]    = useState({});
  const [labelTexts, setLabelTexts] = useState({});
  const [animMenuIds,  setAnimMenuIds]  = useState(new Set());
  const [helpOpen,     setHelpOpen]     = useState(false);
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
          const isScalar    = node?.type === 'scalar';
          const hasPosition = node?.type === 'vector';
          const isTriangle  = node?.type === 'triangle';
          const isAreaNode  = isTriangle || containsTripleJoin(item.text);
          const val_        = node ? values[node.id] : null;
          const cls_        = classifyMV(val_);
          const showingArea = isAreaNode && (showAreaMap[node?.id] ?? false);
          const isDrawable  = (isTriangle && showingArea) || (val_ && typeof val_ === 'object' && 'vx' in val_) ||
                              cls_?.kind === 'finitePoint' || cls_?.kind === 'idealPoint' || cls_?.kind === 'line';
          const canUnitize  = node && node.type !== 'scalar' && !isAreaNode;
          const IDEAL_KINDS = new Set(['idealPoint', 'idealLine', 'pseudoscalar']);
          const isIdealObj  = IDEAL_KINDS.has(cls_?.kind) || (val_ && typeof val_ === 'object' && 'vx' in val_);
          // Auto-switch norm→inorm when object becomes ideal (norm not defined for ideal objects)
          if (isIdealObj && item.normalizeMode === 'norm') setItemNormalizeMode(item.id, 'inorm');
          const isPlaying  = isScalar && playingIds.has(item.id);
          const color      = resolveColor(item, values);
          const displayVal = item.text.trim()
            ? (isAreaNode && typeof val_ === 'number'
                ? (showingArea ? `area: ${val_.toFixed(2)}` : val_.toFixed(3))
                : getDisplayValue(item.text, values))
            : null;
          const mvStr     = node ? formatMV(values[node.id], false) : null;
          const anim    = item.anim ?? DEFAULT_ANIM;
          const rawDrawPos = hasPosition ? (item.drawPos ?? null) : null;
          // Banner only for forms where creating scalars makes sense
          const wantsSuggest = node?.type === 'freePoint' || node?.type === 'vector' || node?.type === 'multivector' || node?.type === 'freeLine';
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

                {/* Visibility toggle */}
                <input
                  type="checkbox"
                  className="visibility-toggle"
                  checked={item.visible !== false}
                  onChange={(e) => setItemVisible(item.id, e.target.checked)}
                  tabIndex={-1}
                  title="Toggle visibility"
                />

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
                  {isAreaNode && (
                    <span className="norm-buttons">
                      <button
                        className={`norm-btn${showingArea ? ' active' : ''}`}
                        title="Show as area and draw triangle polygon"
                        onClick={() => {
                          const next = !showingArea;
                          // For bare triple join (triangle node): prepend 0.5* if not already there
                          if (next && isTriangle && !alreadyHalfed(item.text)) {
                            const m = item.text.match(/^((?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?)(.+)$/s);
                            if (m) setItemText(item.id, `${m[1]}0.5*(${m[2].trim()})`);
                          }
                          setShowArea(item.id, next);
                        }}
                        tabIndex={-1}
                      >area</button>
                    </span>
                  )}
                  {canUnitize && (
                    <span className="norm-buttons">
                      {!isIdealObj && (
                        <button
                          className={`norm-btn${item.normalizeMode === 'norm' ? ' active' : ''}`}
                          title="Normalize by finite norm ‖A‖"
                          onClick={() => setItemNormalizeMode(item.id, item.normalizeMode === 'norm' ? null : 'norm')}
                          tabIndex={-1}
                        >norm</button>
                      )}
                      <button
                        className={`norm-btn${item.normalizeMode === 'inorm' ? ' active' : ''}`}
                        title="Normalize by ideal norm ‖A‖∞"
                        onClick={() => setItemNormalizeMode(item.id, item.normalizeMode === 'inorm' ? null : 'inorm')}
                        tabIndex={-1}
                      >inorm</button>
                    </span>
                  )}
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

              {/* Draw-position sub-row — vector and ideal-point meet */}
              {hasPosition && node && (
                <div className="sub-row">
                  <span className="sub-label">position</span>
                  <input
                    className={`sub-input${rawDrawPos?.ref ? ' sub-input-active' : ''}`}
                    value={posTxts[item.id] ?? formatDrawPos(rawDrawPos, vectorPositions[node.id])}
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

      <button className="expr-clear-btn" onClick={() => { if (window.confirm('Clear all expressions?')) clearAll(); }}>
        ✕ Clear all
      </button>

      <button className="expr-help-btn" onClick={() => setHelpOpen(true)}>
        ? Expression reference
      </button>

      {helpOpen && (
        <div className="help-overlay" onClick={() => setHelpOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-header">
              <span className="help-title">Expression Reference</span>
              <button className="help-close" onClick={() => setHelpOpen(false)}>×</button>
            </div>
            <div className="help-body">

              <section className="help-section">
                <h3>Primitives</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>A = point(x, y)</code></td><td>Free draggable point. <code>x</code>, <code>y</code> can be scalar names.</td></tr>
                    <tr><td><code>V = vector(vx, vy)</code></td><td>Free direction vector (ideal point). Draggable tail &amp; tip.</td></tr>
                    <tr><td><code>L = line(a, b, c)</code></td><td>Free line: <code>a·e1 + b·e2 + c·e0</code>, equation a·x + b·y + c = 0. <code>a</code>, <code>b</code>, <code>c</code> can be scalar names.</td></tr>
                    <tr><td><code>t = 0.5</code></td><td>Scalar. Click ▶ to animate over an interval.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Geometry</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>L = A &amp; B</code></td><td>Line through two points (join / regressive product).</td></tr>
                    <tr><td><code>T = A &amp; B &amp; C</code></td><td>Triangle from three points. Panel shows area.</td></tr>
                    <tr><td><code>X = L1 ^ L2</code></td><td>Intersection of two lines (meet / wedge product). Parallel lines yield a direction vector.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Motors</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>R = exp(A, t)</code></td><td>Motor from a point (rotation around A by 2t) or vector (translation along V by 2t).</td></tr>
                    <tr><td><code>B = R &gt;&gt;&gt; A</code></td><td>Apply motor R to object A (sandwich product).</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Multivectors</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>P = 5e01 - 3e02 + e12</code></td><td>Raw PGA grade-2 element (point if e12 ≠ 0).</td></tr>
                    <tr><td><code>L = 2e1 + e0</code></td><td>Raw PGA grade-1 element (line).</td></tr>
                    <tr><td><code>M = (A + B) / 2</code></td><td>Multivector arithmetic: +, −, *, /. Renders as point or line automatically.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Unary operations</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>D = !A</code></td><td>Hodge dual (grade swap: points ↔ lines).</td></tr>
                    <tr><td><code>R = ~A</code></td><td>Reverse (reversion): negates grade-2 and grade-3 blades.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>PGA 2D basis (8 elements)</h3>
                <table className="help-table help-table-basis">
                  <tbody>
                    <tr><td><code>1</code></td><td>scalar</td><td><code>e01</code></td><td>ideal y-direction (point at ∞)</td></tr>
                    <tr><td><code>e0</code></td><td>ideal line</td><td><code>e02</code></td><td>ideal x-direction (point at ∞)</td></tr>
                    <tr><td><code>e1</code></td><td>y-axis line</td><td><code>e12</code></td><td>point weight (origin)</td></tr>
                    <tr><td><code>e2</code></td><td>x-axis line</td><td><code>e012</code></td><td>pseudoscalar</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Canvas interactions</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td>Drag point</td><td>Move a free point or vector tail/tip.</td></tr>
                    <tr><td>Scroll / pinch</td><td>Zoom centred on cursor.</td></tr>
                    <tr><td>Drag background</td><td>Pan the viewport.</td></tr>
                    <tr><td>Double-click</td><td>Add a new free point at that position.</td></tr>
                  </tbody>
                </table>
              </section>

            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
