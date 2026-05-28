import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraphContext } from './GraphContext.jsx';
import { useAlgebra } from './AlgebraContext.jsx';
import { useSettings } from './SettingsContext.jsx';
import AppearancePanel from './AppearancePanel.jsx';
import './ExpressionPanel.css';

const FALLBACK_COLOR = '#6c7086';

function resolveColor(item, values, algebra, items) {
  if (item.color) {
    if (item.color.startsWith('@') && items) {
      const label = item.color.slice(1);
      for (const it2 of items) {
        const n2 = algebra.parseExpression(it2.text);
        if (n2 && (n2.label === label || n2.id === label)) {
          const v = values?.[n2.id];
          if (v && typeof v === 'object' && typeof v.color === 'string') return v.color;
        }
      }
      return FALLBACK_COLOR;
    }
    return item.color;
  }
  const node = algebra.parseExpression(item.text);
  if (!node) return FALLBACK_COLOR;
  const val = values?.[node.id];
  const KIND_COLOR = algebra.KIND_COLOR ?? {};
  const TYPE_COLOR_FALLBACK = algebra.TYPE_COLOR_FALLBACK ?? {};
  if (val && typeof val === 'object' && typeof val.color === 'string') return val.color;
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
  if (typeof val.color === 'string') return `Color ${val.color}`;
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

// Portal popover for the per-scalar animation mode/speed menu.
function AnimMenuPopover({ anchorEl, animMode, animSpeed, onModeChange, onSpeedChange, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const POP_W = 196;

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const POP_H_EST = 130;
    let top  = r.bottom + 6;
    let left = r.left;
    if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
    if (left < 8) left = 8;
    if (top + POP_H_EST > window.innerHeight - 8) top = Math.max(8, r.top - POP_H_EST - 6);
    setPos({ top, left });
  }, [anchorEl]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchorEl?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorEl, onClose]);

  const speedIdx = SPEED_LEVELS.indexOf(animSpeed);

  return createPortal(
    <div
      ref={popRef}
      className="anim-popover"
      style={{ top: pos.top, left: pos.left, width: POP_W }}
      role="dialog"
      aria-label="Animation settings"
    >
      <div className="anim-menu-section-label">Animation Mode</div>
      <div className="anim-mode-grid">
        {ANIM_MODES.map(({ id: modeId, icon, label: modeLabel }) => (
          <button
            key={modeId}
            className={`anim-mode-btn${animMode === modeId ? ' active' : ''}`}
            onClick={() => onModeChange(modeId)}
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
          onClick={() => speedIdx > 0 && onSpeedChange(SPEED_LEVELS[speedIdx - 1])}
        >«</button>
        <span className="anim-speed-val">{fmtSpeed(animSpeed)}</span>
        <button
          className="anim-speed-btn"
          tabIndex={-1}
          disabled={speedIdx >= SPEED_LEVELS.length - 1}
          onClick={() => speedIdx < SPEED_LEVELS.length - 1 && onSpeedChange(SPEED_LEVELS[speedIdx + 1])}
        >»</button>
      </div>
    </div>,
    document.body
  );
}

// ── Interval helpers (scalars) ────────────────────────────────────────────────

const DEFAULT_ANIM = { min: -10, max: 10, step: 0.1 };

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

export default function ExpressionPanel({ onHide }) {
  const { algebra } = useAlgebra();
  const { settings } = useSettings();
  const { parseExpression, classifyMV } = algebra;
  const {
    items, nodes, values, vectorPositions, playingIds,
    animSettings, setAnimMode, setAnimSpeed,
    setItemText, setItemColor, setItemVisible, setItemMovable, setItemNormalizeMode, setAnim, setDrawPos, setDrawPosRef, setLabel, setLabelOpts, togglePlay,
    setItemOpacity, setItemScale, setItemPointShape, setListShowPoints, setListShowOutline, setListShowFill,
    addFolder, setFolderName, setFolderCollapsed, toggleFolderChildrenVisible,
    reorderItem, insertItemAfter, insertChildInFolder, deleteItem, clearAll, createScalarsFor,
    labelOptsMap,
    undo, redo, canUndo, canRedo,
  } = useGraphContext();

  const inputRefs          = useRef({});
  const folderInputRefs    = useRef({});
  const animBtnRefs        = useRef({});
  const pendingFocus       = useRef(null);
  const pendingFolderFocus = useRef(null);
  const blurTimer          = useRef(null);
  const swatchHoverTimer   = useRef(null);
  const pickerLeaveTimer   = useRef(null);
  const treeLineMeasured   = useRef(false);
  const [treeLineX, setTreeLineX] = useState(37);

  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: 'before'|'after' }
  const [editingId,  setEditingId]  = useState(null); // id whose expression input (or interval input) has focus

  // Local state for in-progress edits (keyed by item id)
  const [animTexts,  setAnimTexts]  = useState({});
  const [posTxts,    setPosTxts]    = useState({});
  const [expandedLists, setExpandedLists] = useState(new Set());
  const [labelTexts, setLabelTexts] = useState({});
  const [animMenuOpenId, setAnimMenuOpenId] = useState(null);
  const [helpOpen,     setHelpOpen]     = useState(false);
  const [pickerOpenId, setPickerOpenId] = useState(null);
  const swatchRefs = useRef({});

  // Item ids whose parsed label is shared with at least one other item.
  // All occurrences of a duplicated label are flagged (not just later ones).
  const duplicateLabelIds = (() => {
    const byLabel = new Map(); // label -> [itemId, ...]
    for (const it of items) {
      const n = parseExpression(it.text);
      const lbl = n?.label;
      if (!lbl) continue;
      if (!byLabel.has(lbl)) byLabel.set(lbl, []);
      byLabel.get(lbl).push(it.id);
    }
    const dups = new Set();
    for (const ids of byLabel.values()) {
      if (ids.length > 1) for (const id of ids) dups.add(id);
    }
    return dups;
  })();

  // Items that evaluate to a color value — surface to ColorPicker's "Custom" row.
  const customColors = items.flatMap((it) => {
    const n = parseExpression(it.text);
    const v = n ? values[n.id] : null;
    return (v && typeof v === 'object' && typeof v.color === 'string')
      ? [{ id: it.id, label: n.label ?? it.id, color: v.color, text: it.text }]
      : [];
  });
  const toggleAnimMenu = (id) => setAnimMenuOpenId((cur) => cur === id ? null : id);

  useEffect(() => {
    if (pendingFocus.current) {
      inputRefs.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
    if (pendingFolderFocus.current) {
      const el = folderInputRefs.current[pendingFolderFocus.current];
      if (el) { el.focus(); el.select(); pendingFolderFocus.current = null; }
    }
  });

  const focus = (id) => { pendingFocus.current = id; };

  const startPickerClose = () => {
    if (pickerLeaveTimer.current) clearTimeout(pickerLeaveTimer.current);
    pickerLeaveTimer.current = setTimeout(() => { pickerLeaveTimer.current = null; setPickerOpenId(null); }, 400);
  };
  const cancelPickerClose = () => {
    if (pickerLeaveTimer.current) { clearTimeout(pickerLeaveTimer.current); pickerLeaveTimer.current = null; }
  };

  const measureCollapseBtn = (btn) => {
    if (!btn || treeLineMeasured.current) return;
    const entry = btn.closest('.expr-entry');
    if (!entry) return;
    treeLineMeasured.current = true;
    const x = Math.round(btn.getBoundingClientRect().left - entry.getBoundingClientRect().left + btn.offsetWidth / 2);
    if (x > 0) setTreeLineX(x);
  };

  const handleEditFocus = (id) => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
    setEditingId(id);
    if (playingIds.has(id)) togglePlay(id);
  };
  const handleEditBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => { setEditingId(null); blurTimer.current = null; }, 0);
  };

  const handleKeyDown = (e, item, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focus(insertItemAfter(item.id, item.parentId ?? null));
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
      <div className="expr-panel-header">
        <button
          className="panel-hdr-btn"
          onClick={() => { focus(insertItemAfter(items[items.length - 1]?.id)); }}
          tabIndex={-1}
          title="Add expression"
          aria-label="Add expression"
        >+</button>
        <div className="expr-panel-header-mid">
          <button
            className="panel-hdr-btn"
            onClick={undo}
            disabled={!canUndo}
            tabIndex={-1}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
          >↶</button>
          <button
            className="panel-hdr-btn"
            onClick={redo}
            disabled={!canRedo}
            tabIndex={-1}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
          >↷</button>
          <button
            className="panel-hdr-btn"
            onClick={() => { pendingFolderFocus.current = addFolder(); }}
            tabIndex={-1}
            title="New folder"
            aria-label="New folder"
          >📁</button>
        </div>
        {onHide && (
          <button
            className="panel-hdr-btn"
            onClick={onHide}
            tabIndex={-1}
            title="Hide panel"
            aria-label="Hide panel"
          >«</button>
        )}
      </div>
      <div className="expr-list" style={{ '--tree-x': `${treeLineX}px` }}>
        {(() => {
        // Precompute folder lookup + dragged-kind once per render.
        const folderCollapsed = new Map();
        for (const it of items) {
          if (it.kind === 'folder') folderCollapsed.set(it.id, !!it.collapsed);
        }
        const isDraggingFolder = items.find((it) => it.id === dragId)?.kind === 'folder';
        const computeDropPos = (e, currentTarget, targetItem) => {
          const rect = currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          if (targetItem.kind === 'folder' && !isDraggingFolder) {
            if (y < rect.height * 0.25) return 'before';
            if (y > rect.height * 0.75) return 'after';
            return 'inside';
          }
          return y < rect.height / 2 ? 'before' : 'after';
        };
        return items.map((item, index) => {
          // Children of a collapsed folder don't render in the panel (but still
          // contribute to the graph + canvas).
          if (item.parentId && folderCollapsed.get(item.parentId)) return null;
          const depth = (item.parentId && folderCollapsed.has(item.parentId)) ? 1 : 0;

          const isDragging   = dragId === item.id;
          const isDropBefore = dropTarget?.id === item.id && dropTarget.position === 'before';
          const isDropAfter  = dropTarget?.id === item.id && dropTarget.position === 'after';
          const isDropInside = dropTarget?.id === item.id && dropTarget.position === 'inside';
          const isLastChild = depth > 0 && (index + 1 >= items.length || items[index + 1].parentId !== item.parentId);
          const hasVisibleChildren = item.kind === 'folder' && !item.collapsed && items.some((it) => it.parentId === item.id);
          const entryClass = `expr-entry${depth > 0 ? ' expr-entry--child' : ''}${isLastChild ? ' expr-entry--last-child' : ''}${item.kind === 'folder' ? ' expr-entry--folder' : ''}${hasVisibleChildren ? ' expr-entry--folder-open' : ''}${isDragging ? ' dragging' : ''}${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}${isDropInside ? ' drop-inside' : ''}`;

          const dragHandlers = {
            onDragOver: (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const pos = computeDropPos(e, e.currentTarget, item);
              setDropTarget((prev) =>
                prev?.id === item.id && prev?.position === pos ? prev : { id: item.id, position: pos }
              );
            },
            onDragLeave: (e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null);
            },
            onDrop: (e) => {
              e.preventDefault();
              if (dragId && dragId !== item.id && dropTarget?.id === item.id) {
                reorderItem(dragId, item.id, dropTarget.position);
              }
              setDragId(null);
              setDropTarget(null);
            },
          };

          // Folder rows: simple header (collapse toggle | 📁 | name input | ×).
          if (item.kind === 'folder') {
            const isCollapsed = !!item.collapsed;
            const children = items.filter((it) => it.parentId === item.id);
            const allChildrenHidden = children.length > 0 && children.every((it) => it.visible === false);
            return (
              <div key={item.id} className={entryClass} {...dragHandlers}>
                <div className="expr-row folder-row">
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
                  <button
                    type="button"
                    className="folder-collapse"
                    tabIndex={-1}
                    ref={measureCollapseBtn}
                    onClick={() => setFolderCollapsed(item.id, !isCollapsed)}
                    aria-label={isCollapsed ? 'Expand folder' : 'Collapse folder'}
                  >{isCollapsed ? '▸' : '▾'}</button>
                  <button
                    type="button"
                    className={`folder-icon-btn${allChildrenHidden ? ' folder-icon-btn--hidden' : ''}`}
                    tabIndex={-1}
                    title={allChildrenHidden ? 'Show all' : 'Hide all'}
                    onClick={() => toggleFolderChildrenVisible(item.id)}
                    aria-label={allChildrenHidden ? 'Show all children' : 'Hide all children'}
                  >📁</button>
                  <input
                    type="text"
                    className="folder-name-input"
                    ref={(el) => { if (el) folderInputRefs.current[item.id] = el; else delete folderInputRefs.current[item.id]; }}
                    value={item.folderName ?? ''}
                    placeholder="Folder"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setFolderName(item.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                        focus(insertChildInFolder(item.id));
                      }
                    }}
                  />
                  <button
                    className="expr-delete"
                    tabIndex={-1}
                    onClick={() => deleteItem(item.id)}
                    aria-label="Delete folder"
                  >×</button>
                </div>
              </div>
            );
          }

          const node       = parseExpression(item.text);
          const isInvalid  = item.text.trim() !== '' && !node;
          const isDupLabel = duplicateLabelIds.has(item.id);
          const hasError   = isInvalid || isDupLabel;
          const isScalar    = node?.type === 'scalar';
          const isColorItem = node?.type === 'color';
          const isFuncDef   = node?.type === 'funcDef';
          // Position sub-row applies to vector nodes plus any anchorable value:
          // ideal point (PGA dual etc.), grade-1 vector (VGA), or bivector.
          const positionKind = node ? classifyMV(values[node.id])?.kind : null;
          const hasPosition = node?.type === 'vector' ||
                              positionKind === 'idealPoint' || positionKind === 'vector' ||
                              positionKind === 'bivector' ||
                              !!(values?.[node?.id] && typeof values[node.id] === 'object' && 'vx' in values[node.id]);
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
          const canUnitize  = node && node.type !== 'scalar' && node.type !== 'funcDef' && !isList;
          const IDEAL_KINDS = new Set(['idealPoint', 'idealLine', 'pseudoscalar']);
          const isIdealObj  = IDEAL_KINDS.has(cls_?.kind) || (val_ && typeof val_ === 'object' && 'vx' in val_);
          // Auto-switch norm→inorm when object becomes ideal (norm not defined for ideal objects)
          if (isIdealObj && item.normalizeMode === 'norm') setItemNormalizeMode(item.id, 'inorm');
          const isPlaying  = isScalar && playingIds.has(item.id);
          const color      = resolveColor(item, values, algebra, items);
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
          const animMode  = animConf.mode  ?? 'pingpong';

          return (
            <div
              key={item.id}
              className={entryClass}
              {...dragHandlers}
            >
              <div className={`expr-row${(isInvalid || isDupLabel) ? ' expr-invalid' : ''}`}>

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

                {/* Error pastille (replaces play-area / color swatch when invalid) */}
                {hasError ? (
                  <div className="error-pastille" title={isDupLabel ? `Duplicate label: ${node?.label}` : 'Invalid expression'} aria-label="Error" />
                ) : isFuncDef ? (
                  <div className="func-badge" title={`Function ${node.params.name}(${node.params.paramNames.join(', ')})`} aria-label="Function">ƒ</div>
                ) : isScalar ? (
                  <div className="play-area">
                    <button
                      type="button"
                      className={`play-btn-swatch${isPlaying ? ' playing' : ''}`}
                      tabIndex={-1}
                      onClick={() => togglePlay(item.id)}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >{isPlaying ? '⏸' : '▶'}</button>
                    <button
                      ref={(el) => { if (el) animBtnRefs.current[item.id] = el; }}
                      className={`anim-cfg-btn${animMenuOpenId === item.id ? ' active' : ''}`}
                      tabIndex={-1}
                      onClick={() => toggleAnimMenu(item.id)}
                      title={`Animation mode: ${ANIM_MODES.find((m) => m.id === animMode)?.label ?? animMode}`}
                    >{ANIM_MODES.find((m) => m.id === animMode)?.icon ?? '⚙'}</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    ref={(el) => { if (el) swatchRefs.current[item.id] = el; }}
                    className={`color-swatch${isColorItem ? ' color-swatch--expr' : ''}${!item.visible ? ' color-swatch--hidden' : ''}`}
                    style={{ background: color }}
                    title="Click to toggle visibility"
                    tabIndex={-1}
                    onClick={() => setItemVisible(item.id, !item.visible)}
                    onMouseEnter={() => {
                      cancelPickerClose();
                      if (isColorItem || pickerOpenId === item.id) return;
                      swatchHoverTimer.current = setTimeout(() => {
                        setPickerOpenId(item.id);
                        swatchHoverTimer.current = null;
                      }, 500);
                    }}
                    onMouseLeave={() => {
                      if (swatchHoverTimer.current) { clearTimeout(swatchHoverTimer.current); swatchHoverTimer.current = null; }
                      if (pickerOpenId === item.id) startPickerClose();
                    }}
                  />
                )}

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
                    onFocus={() => handleEditFocus(item.id)}
                    onBlur={handleEditBlur}
                  />
                  {!hasError && !isFuncDef && isList ? (
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
                    !hasError && !isFuncDef && !isScalar && displayVal && <div className="expr-result" style={{ color }}>{displayVal}</div>
                  )}
                  {!hasError && !isFuncDef && !isList && !isScalar && mvStr && <div className="expr-mv">{mvStr}</div>}
                  {isFuncDef && (
                    <div className="expr-mv">Function ({node.params.paramNames.join(', ')})</div>
                  )}
                  {isInvalid  && <div className="expr-error">unknown syntax</div>}
                  {!isInvalid && isDupLabel && (
                    <div className="expr-error">duplicate label: {node.label}</div>
                  )}
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

              {/* Slider row — scalar only */}
              {isScalar && !hasError && node && (
                <div className={`scalar-slider-row${animMode === 'infinite' ? ' scalar-slider-row--dim' : ''}`}>
                  <span className="scalar-slider-bound">{Math.min(anim.min, anim.max)}</span>
                  <input
                    type="range"
                    className="scalar-slider"
                    min={Math.min(anim.min, anim.max)}
                    max={Math.max(anim.min, anim.max)}
                    step={Math.abs(anim.step) || 'any'}
                    value={Math.max(Math.min(anim.min, anim.max), Math.min(Math.max(anim.min, anim.max), node.params.value ?? 0))}
                    disabled={animMode === 'infinite'}
                    onChange={(e) => {
                      const val = parseFloat(parseFloat(e.target.value).toFixed(6));
                      setItemText(item.id, `${node.id} = ${val}`);
                    }}
                    tabIndex={-1}
                  />
                  <span className="scalar-slider-bound">{Math.max(anim.min, anim.max)}</span>
                </div>
              )}

              {/* Interval sub-row — scalar only, shown while editing the expression */}
              {isScalar && !hasError && editingId === item.id && (
                <div className={`sub-row${animMode === 'infinite' ? ' sub-row-dim' : ''}`}>
                  <span className="sub-label">interval</span>
                  <input
                    className={`sub-input${isPlaying ? ' sub-input-active' : ''}`}
                    value={animTexts[item.id] ?? formatInterval(anim)}
                    onChange={(e) => setAnimTexts((p) => ({ ...p, [item.id]: e.target.value }))}
                    onFocus={() => handleEditFocus(item.id)}
                    onBlur={() => { commitAnimText(item.id); handleEditBlur(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    tabIndex={-1}
                    spellCheck={false}
                    disabled={animMode === 'infinite'}
                  />
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

              {/* Label toggle + editable text */}
              {isDrawable && (
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
                </div>
              )}
            </div>
          );
        });
        })()}
      </div>

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
                    <tr><td><code>[A, B, C, …]</code></td><td>List literal — any object types. All-point lists draw a dashed polygon outline.</td></tr>
                    <tr><td><code>L[i]</code></td><td>Element at 0-based index. Negative wraps: <code>L[-1]</code> = last.</td></tr>
                    <tr><td><code>L[i:j]</code></td><td>Slice i..j−1. Either bound optional: <code>L[:2]</code>, <code>L[1:]</code>.</td></tr>
                    <tr><td><code>len(L)</code></td><td>Length as a scalar.</td></tr>
                    <tr><td><code>A op L</code> / <code>L op A</code></td><td>Any binary op broadcasts over every element: <code>M &gt;&gt;&gt; L</code>, <code>2*L</code>, <code>e12^L</code>, <code>A|L</code> …</td></tr>
                    <tr><td><code>L1 op L2</code></td><td>Any binary op applied elementwise (same length required).</td></tr>
                    <tr><td><code>f(L)</code></td><td>Any unary maps over elements: <code>!L</code>, <code>~L</code>, <code>-L</code>, <code>|L|</code>, <code>L.norm</code>, <code>exp(L)</code> …</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="help-section">
                <h3>Operators &amp; precedence</h3>
                <p className="help-note">Tight → loose: unary &gt; grade products &gt; geometric product &gt; sandwich &gt; additive.<br/>Example: <code>A * B ^ C</code> = <code>A * (B^C)</code>.</p>
                <table className="help-table">
                  <tbody>
                    <tr><td><code>A + B</code>, <code>A - B</code></td><td>Additive (loosest).</td></tr>
                    <tr><td><code>A &gt;&gt;&gt; B</code></td><td>Sandwich <code>A·B·Ã</code>.</td></tr>
                    <tr><td><code>A * B</code>, <code>A / B</code></td><td>Geometric product / division.</td></tr>
                    <tr><td><code>A ^ B</code>, <code>A &amp; B</code>, <code>A | B</code>, <code>A § B</code></td><td>Outer, regressive, inner, commutator (tightest binary).</td></tr>
                    <tr><td><code>!A</code>, <code>~A</code>, <code>-A</code></td><td>Dual, reverse, negate (unary — tightest).</td></tr>
                    <tr><td><code>|A|</code></td><td>Smart norm — finite or ideal auto-detected. Use <code>abs(A)</code> for scalar absolute value.</td></tr>
                    <tr><td><code>A.norm</code>, <code>A.inorm</code></td><td>Explicit finite / ideal norm. Works after any primary: <code>(A^B).norm</code>.</td></tr>
                    <tr><td><code>A.e12</code></td><td>Blade coefficient. Permuted names supported: <code>A.e21 = −A.e12</code>.</td></tr>
                    <tr><td><code>sqrt(A)</code></td><td>Scalar → <code>Math.sqrt</code>; motor → geometric square root.</td></tr>
                    <tr><td><code>sin</code> <code>cos</code> <code>tan</code> <code>asin</code> <code>acos</code> <code>atan</code> …</td><td>Trig (radians). Also: <code>csc sec cot acsc asec acot abs</code>.</td></tr>
                    <tr><td><code>color(R, G, B)</code></td><td>Define a custom color. Channels in 0–1 or 0–255 (auto-detected). Appears in the color-picker's <i>Custom</i> section.</td></tr>
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
                    <tr><td><b style={{color:'#1482C8'}}>●</b> Finite point</td><td>Grade-2 with e12 ≠ 0. Drawn as a dot.</td></tr>
                    <tr><td><b style={{color:'#E8A000'}}>●</b> Ideal point</td><td>Grade-2 with e12 = 0. Drawn as a vector from origin.</td></tr>
                    <tr><td><b style={{color:'#C30A3A'}}>●</b> Line / Reflector</td><td>Grade-1. Drawn as an infinite line.</td></tr>
                    <tr><td><b style={{color:'#55ABDF'}}>●</b> Rotor / Translator</td><td>Even-grade motor. Not drawn on canvas.</td></tr>
                    <tr><td><b style={{color:'#AA7500'}}>●</b> Motor</td><td>General even-grade element. Not drawn.</td></tr>
                    <tr><td><b style={{color:'#92072B'}}>●</b> Reflector</td><td>Odd-grade (grade-1 + grade-3). Glide reflection.</td></tr>
                    <tr><td><b style={{color:'#4E5668'}}>●</b> Pseudoscalar</td><td>Grade-3 (e012). Not drawn.</td></tr>
                    <tr><td><b style={{color:'#0F9D57'}}>●</b> Scalar</td><td>Grade-0 real number. Not drawn.</td></tr>
                    <tr><td><b style={{color:'#41BF82'}}>●</b> List</td><td><code>[A, B, …]</code> — any object types. Polygon outline when all elements are finite points. Expand with ▸ in the panel.</td></tr>
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

      {(() => {
        const openItem = pickerOpenId != null ? items.find((x) => x.id === pickerOpenId) : null;
        if (!openItem) return null;
        const resolveScalar = (name) => {
          const v = values[name];
          if (typeof v === 'number') return v;
          if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
          return null;
        };
        const openNode = parseExpression(openItem.text);
        const openVal  = openNode ? values[openNode.id] : null;
        const openPlan = openVal != null ? algebra.getRenderPlan?.(openVal) : null;
        const openKind = openPlan?.kind ?? algebra.classifyMV?.(openVal)?.kind ?? null;
        const isList   = openKind === 'list';
        const openLabelOpts = openNode ? (labelOptsMap[openNode.id] ?? null) : null;
        const openIsDraggable = (() => {
          if (!openNode) return false;
          if (openNode.type === 'freePoint' || openNode.type === 'vector') return true;
          if (openNode.type === 'multivector') {
            const { coeffExprs, components, dual } = openNode.params ?? {};
            if (coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined) return true;
            if (dual && (coeffExprs?.[3] !== undefined || coeffExprs?.[2] !== undefined)) return true;
            if (!dual && Math.abs(components?.[6] ?? 0) > 1e-10) return true;
          }
          return false;
        })();
        return (
          <AppearancePanel
            open
            anchorEl={swatchRefs.current[pickerOpenId]}
            onClose={() => setPickerOpenId(null)}
            onMouseEnter={cancelPickerClose}
            onMouseLeave={startPickerClose}
            itemVisible={openItem.visible !== false}
            onVisibilityChange={(v) => setItemVisible(pickerOpenId, v)}
            itemMovable={openItem.movable !== false}
            itemDraggable={openIsDraggable}
            onMovableChange={(v) => setItemMovable(pickerOpenId, v)}
            itemColor={openItem.color ?? null}
            kind={openKind}
            isList={isList}
            opacity={openItem.opacity ?? 1}
            scale={openItem.scale ?? 1}
            resolveScalar={resolveScalar}
            pointShape={openItem.pointShape ?? 'circle'}
            onOpacityChange={(v) => setItemOpacity(pickerOpenId, v)}
            onScaleChange={(v) => setItemScale(pickerOpenId, v)}
            onPointShapeChange={(s) => setItemPointShape(pickerOpenId, s)}
            customColors={customColors}
            onColorPick={(val) => { setItemColor(pickerOpenId, val); setPickerOpenId(null); }}
            labelOpts={openLabelOpts}
            onLabelOptsChange={(opts) => setLabelOpts(pickerOpenId, opts)}
            showPoints={openItem.showPoints ?? true}
            showOutline={openItem.showOutline ?? true}
            showFill={openItem.showFill ?? false}
            onPointsChange={(v) => setListShowPoints(pickerOpenId, v)}
            onOutlineChange={(v) => setListShowOutline(pickerOpenId, v)}
            onFillChange={(v) => setListShowFill(pickerOpenId, v)}
          />
        );
      })()}

      {animMenuOpenId != null && (
        <AnimMenuPopover
          anchorEl={animBtnRefs.current[animMenuOpenId]}
          animMode={animSettings[animMenuOpenId]?.mode ?? 'pingpong'}
          animSpeed={animSettings[animMenuOpenId]?.speed ?? 1}
          onModeChange={(m) => setAnimMode(animMenuOpenId, m)}
          onSpeedChange={(s) => setAnimSpeed(animMenuOpenId, s)}
          onClose={() => setAnimMenuOpenId(null)}
        />
      )}
    </aside>
  );
}
