import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ColorPicker.css';

// PGA palette — brand ramps + neutrals.
export const PGA_PALETTE = {
  red:    { name: 'PGAred',    base: '#C30A3A', shades: ['#FADADF', '#F5A9B8', '#E8637F', '#C30A3A', '#92072B', '#60041C'] },
  blue:   { name: 'PGAblue',   base: '#1482C8', shades: ['#D4EBFA', '#A0D0F4', '#55ABDF', '#1482C8', '#0D5F94', '#073D60'] },
  green:  { name: 'PGAgreen',  base: '#0F9D57', shades: ['#C8F0DC', '#8DDCB4', '#41BF82', '#0F9D57', '#0A7540', '#064D2A'] },
  yellow: { name: 'PGAyellow', base: '#E8A000', shades: ['#FDF0CB', '#FAD880', '#F0B833', '#E8A000', '#AA7500', '#6E4C00'] },
};

export const PGA_NEUTRALS = ['#F7F8FA', '#E1E4EA', '#C0C6D2', '#8B93A4', '#4E5668', '#1E2433'];

const RAMP_ORDER = ['red', 'blue', 'green', 'yellow'];

function Swatch({ hex, selected, onPick, label }) {
  return (
    <button
      type="button"
      className={`cp-swatch${selected ? ' cp-selected' : ''}`}
      style={{ background: hex }}
      title={label ?? hex}
      onClick={() => onPick(hex)}
    />
  );
}

export default function ColorPicker({ open, anchorEl, currentColor, customColors = [], onPick, onClose }) {
  const popoverRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    // Default: open below + right of swatch; nudged inward when near viewport edges.
    const POP_W = 264;
    const POP_H_EST = customColors.length ? 280 : 220;
    let top  = r.bottom + 6;
    let left = r.left;
    if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
    if (top  + POP_H_EST > window.innerHeight - 8) top = Math.max(8, r.top - POP_H_EST - 6);
    setPos({ top, left });
  }, [open, anchorEl, customColors.length]);

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
  const normHex = (c) => (c ?? '').toLowerCase();
  // currentColor is either '#rrggbb', '@label', or null.
  const isRef   = currentColor?.startsWith('@');
  const curRef  = isRef ? currentColor.slice(1) : null;
  const curHex  = isRef ? null : normHex(currentColor);

  const hexSelected  = (hex) => !isRef && normHex(hex) === curHex;
  const customSelected = (c) => isRef
    ? (c.label === curRef || c.id === curRef)
    : normHex(c.color) === curHex;

  return createPortal(
    <div
      ref={popoverRef}
      className="cp-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="Color picker"
    >
      <div className="cp-section-label">Brand</div>
      {RAMP_ORDER.map((key) => {
        const ramp = PGA_PALETTE[key];
        return (
          <div key={key} className="cp-row">
            {ramp.shades.map((hex) => (
              <Swatch
                key={hex}
                hex={hex}
                selected={hexSelected(hex)}
                onPick={onPick}
                label={`${ramp.name} ${hex}`}
              />
            ))}
          </div>
        );
      })}

      <div className="cp-section-label">Neutrals</div>
      <div className="cp-row">
        {PGA_NEUTRALS.map((hex) => (
          <Swatch key={hex} hex={hex} selected={hexSelected(hex)} onPick={onPick} label={hex} />
        ))}
      </div>

      <div className="cp-section-label">
        Custom
        <span className="cp-hint">define with <code>C = color(R, G, B)</code></span>
      </div>
      <div className="cp-custom-row">
        {customColors.length === 0 ? (
          <span className="cp-empty">no custom colors yet</span>
        ) : (
          customColors.map((c) => (
            <Swatch
              key={c.id}
              hex={c.color}
              selected={customSelected(c)}
              onPick={() => onPick('@' + (c.label ?? c.id))}
              label={`${c.label ?? c.id} ${c.color}`}
            />
          ))
        )}
      </div>
    </div>,
    document.body
  );
}
