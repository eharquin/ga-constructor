import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PGA_PALETTE, PGA_NEUTRALS } from './ColorPicker.jsx';
import './AppearancePanel.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const KIND_LABEL = {
  finitePoint: 'Point', idealPoint: 'Ideal Point',
  line: 'Line', idealLine: 'Ideal Line',
  rotor: 'Rotor', translator: 'Translator', motor: 'Motor',
  reflector: 'Reflector', bivector: 'Bivector', vector: 'Vector',
  pseudoscalar: 'Pseudoscalar', scalar: 'Scalar',
  list: 'List', mixed: 'Mixed', color: 'Color',
};

const RAMP_ORDER = ['red', 'blue', 'green', 'yellow'];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="ap-toggle" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ap-toggle-track"><span className="ap-toggle-thumb" /></span>
    </label>
  );
}

function NumStepper({ value, onChange, min = 0, max = 1, step = 0.05, width = 36, resolveScalar }) {
  const isVar = typeof value === 'string';
  const resolved = isVar ? resolveScalar?.(value) : null;
  const clamp = (v) => Math.max(min, Math.min(max, parseFloat(v.toFixed(6))));
  return (
    <div className="ap-stepper">
      <button type="button" className="ap-step-btn" onClick={() => !isVar && onChange(clamp(value - step))} tabIndex={-1} disabled={isVar}>−</button>
      <NumInput value={value} onChange={onChange} min={min} max={max} step={step} width={width} resolvedHint={resolved} />
      <button type="button" className="ap-step-btn" onClick={() => !isVar && onChange(clamp(value + step))} tabIndex={-1} disabled={isVar}>+</button>
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max = 1, step = 0.05, width = 52, resolvedHint }) {
  const [local, setLocal] = useState('');
  const editing = useRef(false);
  const isVar = typeof value === 'string';
  const display = editing.current ? local : (isVar ? value : String(parseFloat((value ?? 0).toFixed(3))));
  const hint = isVar && resolvedHint != null ? `= ${parseFloat(resolvedHint.toFixed(3))}` : undefined;
  return (
    <input
      type="text"
      className={`ap-num${isVar ? ' ap-num--var' : ''}`}
      style={{ width }}
      value={display}
      title={hint}
      onFocus={() => { editing.current = true; setLocal(display); }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        editing.current = false;
        const trimmed = local.trim();
        if (/^[A-Za-z_]\w*$/.test(trimmed)) {
          onChange(trimmed);
        } else {
          const v = parseFloat(trimmed);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function ColorSwatch({ hex, selected, onPick, label }) {
  return (
    <button
      type="button"
      className={`ap-swatch${selected ? ' ap-selected' : ''}`}
      style={{ background: hex }}
      title={label ?? hex}
      onClick={() => onPick(hex)}
    />
  );
}

// ── AppearancePanel ───────────────────────────────────────────────────────────

export default function AppearancePanel({
  open, anchorEl, onClose,
  // item state
  itemVisible, onVisibilityChange,
  itemMovable, itemDraggable, onMovableChange,
  itemColor,
  kind, isList,
  // appearance
  opacity, scale, pointShape,
  onOpacityChange, onScaleChange, onPointShapeChange,
  // color picker
  customColors,
  onColorPick,
  // label
  labelOpts, onLabelOptsChange,
  // list
  showPoints, showOutline, showFill,
  onPointsChange, onOutlineChange, onFillChange,
  // scalar variable resolver
  resolveScalar,
}) {
  const popoverRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const POP_W = 276;
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const POP_H_EST = 420;
    let top  = r.bottom + 6;
    let left = r.left;
    if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
    if (left < 8) left = 8;
    if (top + POP_H_EST > window.innerHeight - 8) top = Math.max(8, r.top - POP_H_EST - 6);
    setPos({ top, left });
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
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
  }, [open, anchorEl, onClose]);

  if (!open) return null;

  const typeLabel  = KIND_LABEL[kind] ?? 'Object';
  const isRef      = itemColor?.startsWith('@');
  const curRef     = isRef ? itemColor.slice(1) : null;
  const curHex     = isRef ? null : (itemColor ?? '').toLowerCase();
  const hexSel     = (h) => !isRef && h.toLowerCase() === curHex;
  const custSel    = (c) => isRef ? (c.label === curRef || c.id === curRef) : c.color.toLowerCase() === curHex;

  const isPointKind  = kind === 'finitePoint' || kind === 'idealPoint';
  const showAppearance = isPointKind || isList;
  const lo          = labelOpts ?? {};
  const fontSize    = lo.fontSize    ?? 13;
  const orientation = lo.orientation ?? 0;
  const anchor      = lo.anchor      ?? 'top-right';
  const updLabelOpts = (patch) => onLabelOptsChange({ fontSize, orientation, anchor, ...lo, ...patch });
  const ANCHORS = [
    'top-left', 'top', 'top-right',
    'left', null, 'right',
    'bottom-left', 'bottom', 'bottom-right',
  ];

  return createPortal(
    <div
      ref={popoverRef}
      className="ap-popover"
      style={{ top: pos.top, left: pos.left, width: POP_W }}
      role="dialog"
      aria-label="Appearance"
    >
      {/* ── Header ── */}
      <div className="ap-header">
        <span className="ap-type-label">{typeLabel}</span>
        <div className="ap-header-right">
          <span className="ap-vis-label">{itemVisible ? 'Visible' : 'Hidden'}</span>
          <Toggle checked={!!itemVisible} onChange={onVisibilityChange} label="Toggle visibility" />
        </div>
      </div>

      {/* ── Movable ── (draggable items only) */}
      {itemDraggable && (
        <section className="ap-section">
          <div className="ap-section-title">Movable</div>
          <div className="ap-row">
            <span className="ap-row-label">Allow drag</span>
            <Toggle checked={!!itemMovable} onChange={onMovableChange} label="Toggle movable" />
          </div>
        </section>
      )}

      {/* ── Appearance ── */}
      {showAppearance && (
        <section className="ap-section">
          <div className="ap-section-title">Appearance</div>
          <div className="ap-row">
            <span className="ap-row-label">Opacity</span>
            <NumStepper value={opacity ?? 1} onChange={onOpacityChange} min={0} max={1} step={0.05} resolveScalar={resolveScalar} />
            <span className="ap-row-sep" />
            <span className="ap-row-label ap-row-label--short">Size</span>
            <NumStepper value={scale ?? 1} onChange={onScaleChange} min={0.1} max={10} step={0.1} resolveScalar={resolveScalar} />
          </div>
          {isPointKind && (
            <div className="ap-row">
              <span className="ap-row-label">Shape</span>
              <div className="ap-shape-btns">
                <button
                  type="button"
                  className={`ap-shape-btn${(pointShape ?? 'circle') === 'circle' ? ' active' : ''}`}
                  onClick={() => onPointShapeChange('circle')}
                  title="Circle"
                >●</button>
                <button
                  type="button"
                  className={`ap-shape-btn${(pointShape ?? 'circle') === 'asterisk' ? ' active' : ''}`}
                  onClick={() => onPointShapeChange('asterisk')}
                  title="Asterisk ✕"
                >✕</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Color ── (not for scalars) */}
      {kind !== 'scalar' && <section className="ap-section">
        <div className="ap-section-title">Color</div>
        {RAMP_ORDER.map((key) => {
          const ramp = PGA_PALETTE[key];
          return (
            <div key={key} className="ap-swatch-row">
              {ramp.shades.map((hex) => (
                <ColorSwatch key={hex} hex={hex} selected={hexSel(hex)} onPick={onColorPick} label={`${ramp.name} ${hex}`} />
              ))}
            </div>
          );
        })}
        <div className="ap-swatch-row">
          {PGA_NEUTRALS.map((hex) => (
            <ColorSwatch key={hex} hex={hex} selected={hexSel(hex)} onPick={onColorPick} label={hex} />
          ))}
        </div>
        {customColors.length > 0 && (
          <div className="ap-custom-row">
            {customColors.map((c) => (
              <ColorSwatch
                key={c.id}
                hex={c.color}
                selected={custSel(c)}
                onPick={() => onColorPick('@' + (c.label ?? c.id))}
                label={`${c.label ?? c.id} ${c.color}`}
              />
            ))}
          </div>
        )}
      </section>}

      {/* ── Label ── (not for scalars) */}
      {kind !== 'scalar' && <section className="ap-section">
        <div className="ap-section-title">Label</div>
        <div className="ap-row">
          <span className="ap-row-label">Angle</span>
          <NumStepper value={orientation} onChange={(v) => updLabelOpts({ orientation: v })} min={-180} max={180} step={5} resolveScalar={resolveScalar} />
          <span className="ap-unit">°</span>
          <span className="ap-row-sep" />
          <span className="ap-row-label ap-row-label--short">Size</span>
          <NumStepper value={fontSize} onChange={(v) => updLabelOpts({ fontSize: typeof v === 'string' ? v : Math.max(6, Math.min(36, Math.round(v))) })} min={6} max={36} step={1} width={32} resolveScalar={resolveScalar} />
          <span className="ap-unit">px</span>
        </div>
        <div className="ap-row">
          <span className="ap-row-label">Position</span>
          <div className="ap-anchor-grid">
            {ANCHORS.map((pos, i) => pos
              ? <button key={pos} type="button"
                  className={`ap-anchor-btn${anchor === pos ? ' active' : ''}`}
                  onClick={() => updLabelOpts({ anchor: pos })}
                  title={pos} />
              : <div key={i} className="ap-anchor-center" />
            )}
          </div>
        </div>
      </section>}

      {/* ── List ── */}
      {isList && (
        <section className="ap-section">
          <div className="ap-section-title">List</div>
          <div className="ap-row">
            <span className="ap-row-label">Points</span>
            <Toggle checked={showPoints ?? true} onChange={onPointsChange} label="Draw points" />
          </div>
          <div className="ap-row">
            <span className="ap-row-label">Segments</span>
            <Toggle checked={showOutline ?? true} onChange={onOutlineChange} label="Draw outline segments" />
          </div>
          <div className="ap-row">
            <span className="ap-row-label">Area</span>
            <Toggle checked={showFill ?? false} onChange={onFillChange} label="Draw filled polygon" />
          </div>
        </section>
      )}
    </div>,
    document.body
  );
}
