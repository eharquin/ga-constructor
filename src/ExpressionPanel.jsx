import { useRef, useEffect, useState } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { useAlgebra } from './AlgebraContext.jsx';
import { useSettings } from './SettingsContext.jsx';
import './ExpressionPanel.css';

const FALLBACK_COLOR = '#6c7086';

function resolveColor(item, values, algebra) {
  if (item.color) return item.color;
  const node = algebra.parseExpression(item.text);
  if (!node) return FALLBACK_COLOR;
  const val = values?.[node.id];
  const KIND_COLOR = algebra.KIND_COLOR ?? {};
  const TYPE_COLOR_FALLBACK = algebra.TYPE_COLOR_FALLBACK ?? {};
  if (val?.list) return KIND_COLOR.triangle ?? KIND_COLOR.list ?? FALLBACK_COLOR;
  if (val && typeof val === 'object' && 'vx' in val) return KIND_COLOR.vector ?? KIND_COLOR.idealPoint ?? FALLBACK_COLOR;
  const cls = algebra.classifyMV(val);
  return cls ? (KIND_COLOR[cls.kind] ?? FALLBACK_COLOR) : (TYPE_COLOR_FALLBACK[node.type] ?? FALLBACK_COLOR);
}

function getDisplayValue(text, values, algebra, decimals = 4) {
  const node = algebra.parseExpression(text);
  if (!node) return null;
  const val = values[node.id];
  if (val == null) return null;
  const d = decimals;
  const dc = Math.max(0, Math.min(decimals, 2)); // tighter for coordinates
  const fmtN = (n) => parseFloat(n.toFixed(d)).toString();
  const fmtC = (n) => n.toFixed(dc);

  if (typeof val === 'number') return fmtN(val);
  if (val.list) return `List (${val.items.length} items)`;
  if ('vx' in val) return `Vector (${fmtC(val.vx)}, ${fmtC(val.vy)})`;

  const cls = algebra.classifyMV(val);
  if (!cls) return '—';

  const toE = algebra.toEuclidean;
  const toI = algebra.toIdealVector;
  switch (cls.kind) {
    case 'scalar':      return fmtN(val[0]);
    case 'finitePoint': { const eu = toE?.(val); return eu ? `Point (${fmtC(eu.x)}, ${fmtC(eu.y)})` : '—'; }
    case 'idealPoint':  { const iv = toI?.(val); return iv ? `Ideal point (${fmtC(iv.vx)}, ${fmtC(iv.vy)})` : '—'; }
    case 'vector':      return `Vector (${fmtC(val[1] ?? 0)}, ${fmtC(val[2] ?? 0)})`;
    case 'bivector':    return `Bivector (${fmtN(val[3] ?? val[val.length - 1])} e12)`;
    case 'line':        return 'Line';
    case 'idealLine':   return 'Ideal line';
    case 'pseudoscalar':return `${fmtN(val[7])} e012`;
    case 'rotor':       return 'Rotor';
    case 'translator':  return 'Translator';
    case 'motor':       return 'Motor';
    case 'reflector':   return 'Reflector';
    default:            return '—';
  }
}

// ── Multivector label ─────────────────────────────────────────────────────────

function fmtCoeff(c, decimals = 4) {
  const factor = Math.pow(10, decimals);
  const r = Math.round(c * factor) / factor;
  if (Number.isInteger(r)) return String(r);
  return r.toPrecision(decimals).replace(/\.?0+$/, '');
}

// Format a PGA value as a blade sum: "80e01 + 180e02 + e12", "3e0 - e1", etc.
// Returns null for scalars (numbers) and null values.
// Compute the PGA norm used for unitization.
// Grade-1 (line): sqrt(a²+b²); grade-2 finite point: |e12|;
// grade-2 ideal: sqrt(e01²+e02²); scalar: |s|.
const KIND_LABELS = {
  scalar: 'Scalar', finitePoint: 'Point', idealPoint: 'Ideal point',
  line: 'Line', idealLine: 'Ideal line', pseudoscalar: 'Pseudoscalar',
  rotor: 'Rotor', translator: 'Translator', motor: 'Motor',
  reflector: 'Reflector', mixed: 'Mixed',
  vector: 'Vector', bivector: 'Bivector',
};

function describeListItem(item, algebra, decimals) {
  if (item == null) return { kindLabel: '?', mvStr: null };
  if (typeof item === 'number') {
    return { kindLabel: 'Scalar', mvStr: parseFloat(item.toFixed(decimals)).toString() };
  }
  if ('vx' in item) {
    const d = Math.max(0, Math.min(decimals, 2));
    return { kindLabel: 'Vector', mvStr: `(${item.vx.toFixed(d)}, ${item.vy.toFixed(d)})` };
  }
  const cls = algebra.classifyMV?.(item);
  const kindLabel = cls ? (KIND_LABELS[cls.kind] ?? cls.kind) : '?';
  const mvStr = formatMV(item, algebra, decimals);
  return { kindLabel, mvStr };
}

function formatMV(val, algebra, decimals = 4) {
  if (val == null || typeof val === 'number') return null;
  if (val?.list) {
    const parts = val.items.map((item) => { const { kindLabel } = describeListItem(item, algebra, decimals); return kindLabel; });
    return `[${parts.join(', ')}]`;
  }
  const bladeNames = algebra?.bladeNames;
  const arraySize  = algebra?.arraySize ?? (val.length ?? 0);
  if (!bladeNames) return null;

  let arr;
  if ('vx' in val) {
    // Reconstruct algebra-specific coefficients from {vx,vy}. PGA: ideal-point
    // representation (e01 = vy, e02 = -vx). VGA: grade-1 (e1 = vx, e2 = vy).
    const idx = algebra.bladeIndex ?? {};
    arr = new Array(arraySize).fill(0);
    if ('e01' in idx && 'e02' in idx) {
      arr[idx.e01] = val.vy;
      arr[idx.e02] = -val.vx;
    } else if ('e1' in idx && 'e2' in idx) {
      arr[idx.e1] = val.vx;
      arr[idx.e2] = val.vy;
    }
  } else if (val.length >= arraySize) {
    arr = Array.from(val);
  } else {
    return null;
  }

  const terms = [];
  for (let i = 0; i < arraySize; i++) {
    const c = arr[i] || 0;
    if (Math.abs(c) < 5e-5) continue;
    const blade = bladeNames[i];
    const neg   = c < 0;
    const absC  = Math.abs(c);
    let termStr;
    if (blade === '1') {
      termStr = fmtCoeff(absC, decimals);
    } else if (Math.abs(absC - 1) < 1e-10) {
      termStr = blade;
    } else {
      termStr = fmtCoeff(absC, decimals) + blade;
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
    if ('ref' in drawPos) {
      const anchor = drawPos.anchor && drawPos.anchor !== 'tip' ? `.${drawPos.anchor}` : '';
      return `${drawPos.ref}${anchor}`;
    }
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

// `Name` or `Name.tail` or `Name.tip` — returns { ref, anchor } or null.
function parseRef(str) {
  const m = str.trim().match(/^([A-Za-z_]\w*)(?:\.(tail|tip))?$/);
  if (!m) return null;
  return { ref: m[1], anchor: m[2] || 'tip' };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ExpressionPanel() {
  const { algebra } = useAlgebra();
  const { settings } = useSettings();
  const { parseExpression, classifyMV } = algebra;
  const {
    items, nodes, values, vectorPositions, playingIds,
    animSettings, setAnimMode, setAnimSpeed,
    setItemText, setItemColor, setItemVisible, setItemMovable, setItemNormalizeMode, setAnim, setDrawPos, setDrawPosRef, setLabel, setLabelOpts, togglePlay,
    reorderItem, insertItemAfter, deleteItem, clearAll, createScalarsFor,
    labelOptsMap,
  } = useGraphContext();

  const inputRefs    = useRef({});
  const pendingFocus = useRef(null);

  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: 'before'|'after' }

  // Local state for in-progress edits (keyed by item id)
  const [animTexts,  setAnimTexts]  = useState({});
  const [posTxts,    setPosTxts]    = useState({});
  const [expandedLists, setExpandedLists] = useState(new Set());
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
      const ref = parseRef(str);
      if (ref) {
        setDrawPosRef(nodeId, ref.ref, ref.anchor);
      } else {
        const parsed = parsePos(str);
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
          // Position sub-row applies to vector nodes plus any anchorable value:
          // ideal point (PGA dual etc.), grade-1 vector (VGA), or bivector.
          const positionKind = node ? classifyMV(values[node.id])?.kind : null;
          const hasPosition = node?.type === 'vector' ||
                              positionKind === 'idealPoint' || positionKind === 'vector' ||
                              positionKind === 'bivector' ||
                              (values?.[node?.id] && typeof values[node.id] === 'object' && 'vx' in values[node.id]);
          const isDraggable = (() => {
            if (!node) return false;
            if (node.type === 'freePoint' || node.type === 'vector') return true;
            if (node.type === 'multivector') {
              const { coeffExprs, components, dual } = node.params ?? {};
              if (coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined) return true;
              if (dual && (coeffExprs?.[3] !== undefined || coeffExprs?.[2] !== undefined)) return true;
              if (!dual && Math.abs(components?.[6] ?? 0) > 1e-10) return true;
            }
            return false;
          })();
          const val_        = node ? values[node.id] : null;
          const cls_        = classifyMV(val_);
          const isList      = !!val_?.list;
          const DRAWABLE_KINDS = new Set(['finitePoint', 'idealPoint', 'line', 'vector', 'bivector', 'rotor']);
          const isDrawable  = isList || (val_ && typeof val_ === 'object' && 'vx' in val_) || DRAWABLE_KINDS.has(cls_?.kind);
          const canUnitize  = node && node.type !== 'scalar' && !isList;
          const IDEAL_KINDS = new Set(['idealPoint', 'idealLine', 'pseudoscalar']);
          const isIdealObj  = IDEAL_KINDS.has(cls_?.kind) || (val_ && typeof val_ === 'object' && 'vx' in val_);
          // Auto-switch norm→inorm when object becomes ideal (norm not defined for ideal objects)
          if (isIdealObj && item.normalizeMode === 'norm') setItemNormalizeMode(item.id, 'inorm');
          const isPlaying  = isScalar && playingIds.has(item.id);
          const color      = resolveColor(item, values, algebra);
          const displayVal = item.text.trim() ? getDisplayValue(item.text, values, algebra, settings.decimals) : null;
          const mvStr      = (node && settings.showMvExpression) ? formatMV(values[node.id], algebra, settings.decimals) : null;
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

                {/* Lock toggle — drag-eligible items only */}
                {isDraggable ? (
                  <button
                    type="button"
                    className={`lock-toggle${item.movable === false ? ' locked' : ''}`}
                    onClick={() => setItemMovable(item.id, item.movable === false)}
                    tabIndex={-1}
                    title={item.movable === false ? 'Locked (click to allow drag)' : 'Movable (click to lock)'}
                  >{item.movable === false ? '🔒' : '🔓'}</button>
                ) : (
                  <span className="lock-toggle-gap" />
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
                  {isList ? (
                    <button
                      className="list-toggle"
                      style={{ color }}
                      tabIndex={-1}
                      onClick={() => setExpandedLists((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                        return next;
                      })}
                    >
                      {expandedLists.has(item.id) ? '▾' : '▸'} {displayVal}
                    </button>
                  ) : (
                    displayVal && <div className="expr-result" style={{ color }}>{displayVal}</div>
                  )}
                  {!isList && mvStr && <div className="expr-mv">{mvStr}</div>}
                  {isInvalid  && <div className="expr-error">unknown syntax</div>}
                </div>

                <button
                  className="expr-delete"
                  tabIndex={-1}
                  onClick={() => deleteItem(item.id)}
                  aria-label="Delete"
                >×</button>
              </div>

              {/* List items sub-section — expanded list */}
              {isList && expandedLists.has(item.id) && val_?.items && (
                <div className="list-items-sub">
                  {val_.items.map((listItem, li) => {
                    const { kindLabel, mvStr } = describeListItem(listItem, algebra, settings.decimals);
                    return (
                      <div key={li} className="list-item-row">
                        <span className="list-item-index">{li}</span>
                        <span className="list-item-kind">{kindLabel}</span>
                        {mvStr && <span className="list-item-mv">{mvStr}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

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

              {/* Label toggle + editable text + extended opts */}
              {isDrawable && (() => {
                const lo = labelOptsMap[node?.id] ?? {};
                const fontSize    = lo.fontSize    ?? 13;
                const orientation = lo.orientation ?? 0;
                const anchor      = lo.anchor      ?? 'top-right';
                const updOpts = (patch) => setLabelOpts(item.id, { fontSize, orientation, anchor, ...lo, ...patch });
                const ANCHORS = [
                  'top-left','top','top-right',
                  'left', null, 'right',
                  'bottom-left','bottom','bottom-right',
                ];
                return (
                  <div className="label-section">
                    <div className="label-row">
                      <input type="checkbox" className="label-checkbox"
                        checked={item.label != null}
                        onChange={(e) => {
                          if (e.target.checked) { setLabel(item.id, node.id); }
                          else {
                            setLabelTexts((p) => { const n = { ...p }; delete n[item.id]; return n; });
                            setLabel(item.id, null);
                          }
                        }}
                        tabIndex={-1}
                      />
                      <span className="label-check-text">label</span>
                      {item.label != null && (
                        <input type="text" className="label-text-input"
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
                          tabIndex={-1} spellCheck={false}
                        />
                      )}
                    </div>
                    {item.label != null && (
                      <div className="label-opts">
                        <label className="label-opt-field">
                          <span>size</span>
                          <input type="number" min={6} max={36} step={1} value={fontSize}
                            onChange={(e) => updOpts({ fontSize: Math.max(6, Math.min(36, +e.target.value || 13)) })}
                            tabIndex={-1} />
                        </label>
                        <label className="label-opt-field">
                          <span>°</span>
                          <input type="number" min={-180} max={180} step={5} value={orientation}
                            onChange={(e) => updOpts({ orientation: +e.target.value || 0 })}
                            tabIndex={-1} />
                        </label>
                        <div className="anchor-grid">
                          {ANCHORS.map((pos, i) => pos
                            ? <button key={pos}
                                className={`anchor-btn${anchor === pos ? ' active' : ''}`}
                                onClick={() => updOpts({ anchor: pos })}
                                tabIndex={-1} title={pos} />
                            : <div key={i} className="anchor-center" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
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
                    <tr><td><code>L = line(a, b, c)</code></td><td>Free line <code>a·x + b·y + c = 0</code>. Arguments can be scalar names.</td></tr>
                    <tr><td><code>t = 0.5</code></td><td>Scalar. Click ▶ to animate. Supports blade literals: <code>t = 2e12</code>.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Geometry</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>L = A &amp; B</code></td><td>Join (regressive ∨): line through two points.</td></tr>
                    <tr><td><code>T = A &amp; B &amp; C</code></td><td>Triple join → 2 × signed area as a plain scalar.</td></tr>
                    <tr><td><code>X = L1 ^ L2</code></td><td>Meet (wedge ∧): intersection of two lines. N-ary: <code>L1 ^ L2 ^ L3</code>.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Motors</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>R = exp(a*e12)</code></td><td>Rotor — rotation by 2a around origin.</td></tr>
                    <tr><td><code>T = exp(t*V)</code></td><td>Translator — <code>1 + t·V</code> (nilpotent series terminates).</td></tr>
                    <tr><td><code>M = R * T</code></td><td>Composed motor (rotation + translation).</td></tr>
                    <tr><td><code>Q = M &gt;&gt;&gt; P</code></td><td>Sandwich: apply motor M to object P. Works on any object type, including lists.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Lists</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>[A, B, C]</code></td><td>List of any object types. If all finite points, draws a dashed polygon outline.</td></tr>
                    <tr><td><code>L[i]</code></td><td>Element at 0-based index. Negative indices wrap: <code>L[-1]</code> = last.</td></tr>
                    <tr><td><code>L[i:j]</code></td><td>Slice — sublist from index i (inclusive) to j (exclusive). Either bound optional: <code>L[:2]</code>, <code>L[1:]</code>.</td></tr>
                    <tr><td><code>len(L)</code></td><td>Number of elements as a scalar.</td></tr>
                    <tr><td><code>M &gt;&gt;&gt; L</code></td><td>Transform every element of L with motor M.</td></tr>
                    <tr><td><code>LL &gt;&gt;&gt; L</code></td><td>Pairwise transform: LL and L must have the same length.</td></tr>
                    <tr><td><code>exp(L)</code></td><td>Map <code>exp</code> over each element.</td></tr>
                    <tr><td><code>!L</code>, <code>~L</code></td><td>Map dual / reverse over each element.</td></tr>
                    <tr><td><code>2 * L</code>, <code>L / 2</code></td><td>Scalar broadcast to every element.</td></tr>
                    <tr><td><code>expr * L</code></td><td>Geometric product broadcast: each element multiplied by expr.</td></tr>
                    <tr><td><code>L1 + L2</code></td><td>Elementwise for any operator (same length): <code>L1 ^ L2</code>, <code>L1 &amp; L2</code>, <code>L1 | L2</code>, etc.</td></tr>
                    <tr><td><code>expr ^ L</code>, <code>expr &amp; L</code>, <code>expr | L</code></td><td>Broadcast any binary op: apply to each element with a fixed left or right operand.</td></tr>
                    <tr><td><code>|L|</code>, <code>L.norm</code></td><td>Map norm over each element — returns a list of scalars.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Operators &amp; precedence</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>A + B</code>, <code>A - B</code></td><td>Additive (lowest precedence).</td></tr>
                    <tr><td><code>A &gt;&gt;&gt; B</code></td><td>Sandwich product.</td></tr>
                    <tr><td><code>A * B</code>, <code>A / s</code></td><td>Geometric product / scalar division.</td></tr>
                    <tr><td><code>A ^ B</code>, <code>A &amp; B</code>, <code>A | B</code>, <code>A § B</code></td><td>Grade products (tightest binary). <code>A * B ^ C</code> = <code>A * (B^C)</code>.</td></tr>
                    <tr><td><code>!A</code>, <code>~A</code>, <code>-A</code></td><td>Unary — highest precedence.</td></tr>
                    <tr><td><code>A.e12</code></td><td>Blade coefficient extraction. Permuted names: <code>A.e21 = −A.e12</code>.</td></tr>
                    <tr><td><code>|A|</code></td><td>Smart norm: finite or ideal auto-detected. <code>abs(A)</code> for explicit scalar abs.</td></tr>
                    <tr><td><code>A.norm</code></td><td>Explicit finite norm (<code>‖A‖</code>).</td></tr>
                    <tr><td><code>A.inorm</code></td><td>Explicit ideal norm (<code>‖A‖∞</code>). Works after any primary: <code>(A&amp;B).inorm</code>.</td></tr>
                    <tr><td><code>sqrt(A)</code></td><td>Scalar → <code>Math.sqrt</code>; motor → geometric square root via Log/Exp.</td></tr>
                    <tr><td><code>sin cos tan</code> …</td><td>Trig functions (radians). Also: <code>csc sec cot asin acos atan acsc asec acot</code>.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Normalization</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><b>norm</b> button</td><td>Divide by finite norm ‖A‖ = √(scalar_part(AÃ)). For finite objects.</td></tr>
                    <tr><td><b>inorm</b> button</td><td>Divide by ideal norm ‖A‖∞ = ‖A*‖. For ideal objects (ideal point, ideal line…).</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>PGA(2,0,1) basis — 8 blades</h3>
                <table className="help-table help-table-basis">
                  <tbody>
                    <tr><td><code>1</code></td><td>scalar (grade 0)</td><td><code>e01</code></td><td>ideal y-dir (grade 2)</td></tr>
                    <tr><td><code>e0</code></td><td>ideal line (grade 1)</td><td><code>e02</code></td><td>ideal x-dir (grade 2)</td></tr>
                    <tr><td><code>e1</code></td><td>y-axis line (grade 1)</td><td><code>e12</code></td><td>point weight / origin (grade 2)</td></tr>
                    <tr><td><code>e2</code></td><td>x-axis line (grade 1)</td><td><code>e012</code></td><td>pseudoscalar (grade 3)</td></tr>
                  </tbody>
                </table>
                <p className="help-note">Permuted blade names are supported: <code>e21 = −e12</code>, <code>e10 = −e01</code>, <code>e120 = e012</code>, etc.</p>
              </section>

              <section className="help-section">
                <h3>Object types</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td><b style={{color:'#89b4fa'}}>●</b> Finite point</td><td>Grade-2 with e12 ≠ 0. Drawn as a dot.</td></tr>
                    <tr><td><b style={{color:'#f9e2af'}}>●</b> Ideal point</td><td>Grade-2 with e12 = 0. Drawn as a vector from origin.</td></tr>
                    <tr><td><b style={{color:'#cba6f7'}}>●</b> Line / Reflector</td><td>Grade-1. Drawn as an infinite line.</td></tr>
                    <tr><td><b style={{color:'#74c7ec'}}>●</b> Rotor / Translator</td><td>Even-grade motor. Not drawn on canvas.</td></tr>
                    <tr><td><b style={{color:'#94e2d5'}}>●</b> Motor</td><td>General even-grade element. Not drawn.</td></tr>
                    <tr><td><b style={{color:'#fab387'}}>●</b> Reflector</td><td>Odd-grade (grade-1 + grade-3). Glide reflection.</td></tr>
                    <tr><td><b style={{color:'#f38ba8'}}>●</b> Pseudoscalar</td><td>Grade-3 (e012). Not drawn.</td></tr>
                    <tr><td><b style={{color:'#a6e3a1'}}>●</b> Scalar</td><td>Grade-0 real number. Not drawn.</td></tr>
                    <tr><td><b style={{color:'#89dceb'}}>●</b> List</td><td><code>[A, B, …]</code> — any object types. Polygon outline when all elements are finite points. Expand with ▸ in the panel.</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Canvas interactions</h3>
                <table className="help-table">
                  <tbody>
                    <tr><td>Drag point</td><td>Move a free point or vector tail / tip.</td></tr>
                    <tr><td>Scroll / pinch</td><td>Zoom centred on cursor.</td></tr>
                    <tr><td>Drag background</td><td>Pan the viewport.</td></tr>
                    <tr><td>Double-click</td><td>Add a new free point at that position.</td></tr>
                    <tr><td>Drag panel edge</td><td>Resize the expression panel.</td></tr>
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
