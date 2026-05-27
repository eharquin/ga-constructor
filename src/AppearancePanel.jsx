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

function NumInput({ value, onChange, min = 0, max = 1, step = 0.05, width = 52 }) {
  const [local, setLocal] = useState('');
  const editing = useRef(false);
  const display = editing.current ? local : String(parseFloat((value ?? 0).toFixed(3)));
  return (
    <input
      type="number" min={min} max={max} step={step}
      className="ap-num"
      style={{ width }}
      value={display}
      onFocus={() => { editing.current = true; setLocal(display); }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        editing.current = false;
        const v = parseFloat(local);
        if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
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
  showOutline, showFill, listElements, hiddenElements,
  onOutlineChange, onFillChange, onElementToggle,
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
  const lo = labelOpts ?? {};
  const fontSize    = lo.fontSize    ?? 13;
  const labelAngle  = lo.angle       ?? 0;
  const updLabelOpts = (patch) => onLabelOptsChange({ fontSize, angle: labelAngle, ...lo, ...patch });

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

      {/* ── Appearance ── */}
      {showAppearance && (
        <section className="ap-section">
          <div className="ap-section-title">Appearance</div>
          <div className="ap-row">
            <span className="ap-row-label">Opacity</span>
            <NumInput value={opacity ?? 1} onChange={onOpacityChange} min={0} max={1} step={0.05} />
          </div>
          <div className="ap-row">
            <span className="ap-row-label">Size</span>
            <NumInput value={scale ?? 1} onChange={onScaleChange} min={0.1} max={10} step={0.1} width={60} />
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

      {/* ── Color ── */}
      <section className="ap-section">
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
      </section>

      {/* ── Label ── */}
      <section className="ap-section">
        <div className="ap-section-title">Label</div>
        <div className="ap-row">
          <span className="ap-row-label">Angle</span>
          <NumInput value={labelAngle} onChange={(v) => updLabelOpts({ angle: v })} min={-180} max={180} step={5} width={60} />
          <span className="ap-unit">°</span>
        </div>
        <div className="ap-row">
          <span className="ap-row-label">Font size</span>
          <NumInput value={fontSize} onChange={(v) => updLabelOpts({ fontSize: Math.max(6, Math.min(36, Math.round(v))) })} min={6} max={36} step={1} width={52} />
          <span className="ap-unit">px</span>
        </div>
      </section>

      {/* ── List ── */}
      {isList && (
        <section className="ap-section">
          <div className="ap-section-title">List</div>
          <div className="ap-row">
            <span className="ap-row-label">Segments</span>
            <Toggle checked={showOutline ?? true} onChange={onOutlineChange} label="Draw outline segments" />
          </div>
          <div className="ap-row">
            <span className="ap-row-label">Fill area</span>
            <Toggle checked={showFill ?? false} onChange={onFillChange} label="Draw filled polygon" />
          </div>
        </section>
      )}

      {/* ── Elements ── */}
      {isList && listElements.length > 0 && (
        <section className="ap-section">
          <div className="ap-section-title">Elements</div>
          {listElements.map((el) => {
            const hidden = (hiddenElements ?? []).includes(el.index);
            return (
              <div key={el.index} className="ap-row ap-elem-row">
                <span className="ap-elem-index">[{el.index}]</span>
                <span className="ap-elem-kind">{KIND_LABEL[el.kind] ?? el.kind}</span>
                <Toggle
                  checked={!hidden}
                  onChange={() => onElementToggle(el.index)}
                  label={`Toggle element ${el.index}`}
                />
              </div>
            );
          })}
        </section>
      )}
    </div>,
    document.body
  );
}
