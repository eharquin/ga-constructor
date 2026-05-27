import { useRef, useEffect, useState, useMemo } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { useAlgebra } from './AlgebraContext.jsx';
import { useSettings } from './SettingsContext.jsx';

const INITIAL_VP  = { scale: 30, offsetX: 400, offsetY: 300 };
const HIT_RADIUS  = 12;
const SNAP_RADIUS = 24;

// ─── Coordinate helpers ──────────────────────────────────────────────────────

function w2c(x, y, vp) {
  return { cx: vp.offsetX + x * vp.scale, cy: vp.offsetY - y * vp.scale };
}

function c2w(cx, cy, vp) {
  return { x: (cx - vp.offsetX) / vp.scale, y: -(cy - vp.offsetY) / vp.scale };
}


function roundToScale(val, scale) {
  const decimals = Math.max(0, Math.round(Math.log10(scale)));
  return parseFloat(val.toFixed(decimals));
}

function svgPt(e, svg) {
  const r = svg.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

// Find a draggable snap target near (mx, my). Returns { id, anchor } —
// anchor ∈ {'tip', 'tail'} — for whichever target is closest within sqRadius:
//   - PGA finite point → { id, anchor: 'tip' } (only one position; anchor name is irrelevant)
//   - vector-like (vector / idealPoint / {vx,vy}) → snaps to either the tail
//     or the tip, whichever the cursor is nearest. Tie → tip wins.
// Excludes the node currently being dragged so a vector can't ref itself.
function findNearbySnapTarget(mx, my, nodes, values, vectorPositions, vp, sqRadius, algebra, excludeId) {
  const { classifyMV, toEuclidean } = algebra;
  let best = null;
  let bestDist = sqRadius;
  for (const [id] of Object.entries(nodes)) {
    if (id === excludeId) continue;
    const val = values[id];
    const cls = classifyMV(val);
    if (cls?.kind === 'finitePoint' && toEuclidean) {
      const eu = toEuclidean(val);
      if (!eu) continue;
      const { cx, cy } = w2c(eu.x, eu.y, vp);
      const d = (mx - cx) ** 2 + (my - cy) ** 2;
      if (d <= bestDist) { bestDist = d; best = { id, anchor: 'tip' }; }
    } else if (cls?.kind === 'vector' || cls?.kind === 'idealPoint' ||
               (val && typeof val === 'object' && 'vx' in val)) {
      const tail = vectorPositions[id] ?? { x: 0, y: 0 };
      let vx, vy;
      if (typeof val === 'object' && 'vx' in val) { vx = val.vx; vy = val.vy; }
      else if (cls?.kind === 'vector')             { vx = val[1] || 0; vy = val[2] || 0; }
      else                                          { vx = -(val[5] || 0); vy = (val[4] || 0); }
      const t   = w2c(tail.x, tail.y, vp);
      const tip = w2c(tail.x + vx, tail.y + vy, vp);
      const dT  = (mx - t.cx)   ** 2 + (my - t.cy)   ** 2;
      const dP  = (mx - tip.cx) ** 2 + (my - tip.cy) ** 2;
      // Prefer tip on ties (matches prior behavior).
      if (dT < bestDist && dT < dP) { bestDist = dT; best = { id, anchor: 'tail' }; }
      if (dP <= bestDist)           { bestDist = dP; best = { id, anchor: 'tip'  }; }
    }
  }
  return best;
}

function hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap, algebra) {
  const { classifyMV, toEuclidean } = algebra;
  for (const [id, node] of Object.entries(nodes)) {
    if (hiddenIds?.has(id)) continue;
    if (movableMap?.[id] === false) continue;
    const valKind = classifyMV(values[id])?.kind;
    if (node.label === null && node.type !== 'freePoint' && node.type !== 'scalar' && node.type !== 'vector' && node.type !== 'multivector' && node.type !== 'meetPoint' && valKind !== 'idealPoint') continue;
    if (node.type === 'freePoint') {
      if (!toEuclidean) continue;
      const eu = toEuclidean(values[id]);
      if (!eu) continue;
      const { cx, cy } = w2c(eu.x, eu.y, vp);
      if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'freePoint' };
    }
    if (node.type === 'scalar' && valKind === 'finitePoint') {
      const eu = toEuclidean?.(values[id]);
      if (!eu) continue;
      const { cx, cy } = w2c(eu.x, eu.y, vp);
      if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'scalarPoint' };
    }
    if (node.type === 'vector') {
      const pos = vectorPositions[id] ?? { x: 0, y: 0 };
      const val = values[id];
      const tail = w2c(pos.x, pos.y, vp);
      if ((mx - tail.cx) ** 2 + (my - tail.cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'vector' };
      if (val) {
        const tip = w2c(pos.x + val.vx, pos.y + val.vy, vp);
        if ((mx - tip.cx) ** 2 + (my - tip.cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'vectorTip' };
      }
    }
    if (node.type === 'multivector') {
      const { coeffExprs, components, dual } = node.params ?? {};
      const hasVariablePos = algebra.hasDepPointCoeffs
        ? algebra.hasDepPointCoeffs(coeffExprs)
        : (coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined);
      if (!toEuclidean) {
        // VGA + others without a projective point map: skip multivector point hit-tests.
      } else if (hasVariablePos) {
        const eu = toEuclidean(values[id]);
        if (!eu) continue;
        const { cx, cy } = w2c(eu.x, eu.y, vp);
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'depPoint' };
      } else if (dual && (coeffExprs?.[3] !== undefined || coeffExprs?.[2] !== undefined)) {
        const eu = toEuclidean(values[id]);
        if (!eu) continue;
        const { cx, cy } = w2c(eu.x, eu.y, vp);
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'dualDepPoint' };
      } else if (!dual && (algebra.isLitMVPoint ? algebra.isLitMVPoint(components, values[id]) : Math.abs(components?.[6] ?? 0) > 1e-10)) {
        const eu = toEuclidean(values[id]);
        if (!eu) continue;
        const { cx, cy } = w2c(eu.x, eu.y, vp);
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'litMVPoint' };
      }
    }
    // Value-driven: any node whose value is anchorable (vector-like or
    // bivector) allows anchor dragging via vectorPositions. Covers derived
    // vectors (`U = V + W`), PGA `D = !L`, and bivectors (`B = V ^ W`, `B = 5*e12`).
    const val_ = values[id];
    const isVectorLikeVal = valKind === 'idealPoint' || valKind === 'vector' ||
                            (val_ && typeof val_ === 'object' && 'vx' in val_);
    const isAnchorableBivec = valKind === 'bivector';
    if (node.type !== 'vector' && (isVectorLikeVal || isAnchorableBivec)) {
      const pos = vectorPositions[id] ?? { x: 0, y: 0 };
      const anc = w2c(pos.x, pos.y, vp);
      if ((mx - anc.cx) ** 2 + (my - anc.cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'vector' };
    }
  }
  return null;
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function gridStep(scale) {
  const raw = 60 / scale;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n   = raw / mag;
  return n < 2 ? mag : n < 5 ? 2 * mag : 5 * mag;
}

function fmtGridLabel(val, step) {
  if (step >= 1) return String(Math.round(val));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return val.toFixed(decimals);
}

function SvgGrid({ vp, W, H }) {
  const step = gridStep(vp.scale);
  const minX = -vp.offsetX / vp.scale;
  const maxX = (W - vp.offsetX) / vp.scale;
  const minY = (vp.offsetY - H) / vp.scale;
  const maxY = vp.offsetY / vp.scale;

  const wxs = [], wys = [];
  for (let wx = Math.floor(minX / step) * step; wx <= maxX; wx += step) wxs.push(wx);
  for (let wy = Math.floor(minY / step) * step; wy <= maxY; wy += step) wys.push(wy);

  const { cx: ox, cy: oy } = w2c(0, 0, vp);

  // X-axis label row: clamp to visible band, flip to bottom when axis is off-top
  const ly      = Math.min(Math.max(oy + 13, 13), H - 5);
  const xAnchor = 'middle';

  // Y-axis label column: when the axis is off-screen, pin to the nearest edge
  // and flip text-anchor so the label grows inward instead of clipping out.
  let yLabelX, yAnchor;
  if (ox <= 0)  { yLabelX = 4;     yAnchor = 'start'; }
  else if (ox >= W) { yLabelX = W - 4; yAnchor = 'end'; }
  else          { yLabelX = ox - 5; yAnchor = 'end'; }

  return (
    <g>
      {wxs.map((wx, i) => {
        const { cx } = w2c(wx, 0, vp);
        return <line key={i} x1={cx} y1={0} x2={cx} y2={H} style={{ stroke: 'var(--grid-line)' }} strokeWidth={1} />;
      })}
      {wys.map((wy, i) => {
        const { cy } = w2c(0, wy, vp);
        return <line key={i} x1={0} y1={cy} x2={W} y2={cy} style={{ stroke: 'var(--grid-line)' }} strokeWidth={1} />;
      })}
      <line x1={ox} y1={0} x2={ox} y2={H} style={{ stroke: 'var(--axis-line)' }} strokeWidth={1.5} />
      <line x1={0}  y1={oy} x2={W} y2={oy} style={{ stroke: 'var(--axis-line)' }} strokeWidth={1.5} />
      {wxs.map((wx, i) => {
        if (Math.abs(wx) < step * 0.01) return null;
        const { cx } = w2c(wx, 0, vp);
        const anchor = cx < 10 ? 'start' : cx > W - 10 ? 'end' : 'middle';
        return (
          <text key={i} x={cx} y={ly} textAnchor={anchor}
                fontSize={10} fontFamily="monospace" style={{ fill: 'var(--grid-label)' }} pointerEvents="none">
            {fmtGridLabel(wx, step)}
          </text>
        );
      })}
      {wys.map((wy, i) => {
        if (Math.abs(wy) < step * 0.01) return null;
        const { cy } = w2c(0, wy, vp);
        return (
          <text key={i} x={yLabelX} y={cy + 4} textAnchor={yAnchor}
                fontSize={10} fontFamily="monospace" style={{ fill: 'var(--grid-label)' }} pointerEvents="none">
            {fmtGridLabel(wy, step)}
          </text>
        );
      })}
    </g>
  );
}

// ─── Object components ────────────────────────────────────────────────────────

function SvgPoint({ x, y, label, color, vp, W, H, hovered, opts, weight = 1, shape = 'circle', scale = 1 }) {
  const { cx, cy } = w2c(x, y, vp);
  if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) return null;
  const r_dot  = 4.5 * weight * scale;
  const r_ring = 7   * weight * scale;
  const sw     = Math.max(1.5, 2 * weight * scale);

  if (shape === 'asterisk') {
    const arm = r_ring * 0.9;
    const d   = arm / Math.SQRT2;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r_ring} style={{ fill: 'var(--bg-canvas)' }} />
        <line x1={cx - arm} y1={cy}       x2={cx + arm} y2={cy}       stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <line x1={cx}       y1={cy - arm}  x2={cx}       y2={cy + arm}  stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <line x1={cx - d}   y1={cy - d}    x2={cx + d}   y2={cy + d}    stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <line x1={cx + d}   y1={cy - d}    x2={cx - d}   y2={cy + d}    stroke={color} strokeWidth={sw} strokeLinecap="round" />
        {renderLabel(label, cx, cy, opts)}
      </g>
    );
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={r_ring} style={{ fill: 'var(--bg-canvas)' }} />
      <circle cx={cx} cy={cy} r={r_dot} fill={color} />
      {renderLabel(label, cx, cy, opts)}
    </g>
  );
}

// Line at infinity (pure e0): drawn as a dashed ellipse inscribed in the canvas,
// since the ideal line has no Euclidean position — it's the boundary of the
// projective plane. The visual is screen-space (doesn't move with pan/zoom).
function SvgIdealLine({ label, color, W, H, opts, weight = 1 }) {
  const cx = W / 2, cy = H / 2;
  const rx = Math.max(8, W / 2 - 6);
  const ry = Math.max(8, H / 2 - 6);
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
        fill="none" stroke={color} strokeWidth={2 * weight} strokeDasharray="6 4" strokeOpacity={0.7} />
      {renderLabel(label, cx, cy - ry + 14, opts)}
    </g>
  );
}

// Ideal-point marker on the line-at-infinity ellipse. The point at infinity in
// direction (vx, vy) sits where that direction meets the ellipse boundary.
const idealPointEllipsePos = (vx, vy, W, H) => {
  const cx = W / 2, cy = H / 2;
  const rx = Math.max(8, W / 2 - 6);
  const ry = Math.max(8, H / 2 - 6);
  const angle = Math.atan2(vy, vx);
  return { x: cx + rx * Math.cos(angle), y: cy - ry * Math.sin(angle) };
};
function SvgIdealPointMarker({ vx, vy, color, W, H, hovered, weight = 1 }) {
  const { x, y } = idealPointEllipsePos(vx, vy, W, H);
  const r = (hovered ? 6 : 4) * weight;
  return (
    <g pointerEvents="none">
      {hovered && <circle cx={x} cy={y} r={r + 4} fill={color + '28'} />}
      <circle cx={x} cy={y} r={r}
        fill={color}
        style={{ stroke: hovered ? 'var(--point-stroke-hover)' : 'var(--point-stroke)' }}
        strokeWidth={1.5} />
    </g>
  );
}

function SvgLine({ bd, label, color, vp, W, H, opts, weight = 1 }) {
  if (!bd) return null;
  const { bx, by, ux, uy } = bd;
  // FAR must be large enough to extend the line endpoints past all screen corners,
  // even when the base point is far off-screen (e.g. when zoomed in).
  const { cx: bcx, cy: bcy } = w2c(bx, by, vp);
  const FAR = (
    Math.hypot(
      Math.max(Math.abs(bcx), Math.abs(bcx - W)),
      Math.max(Math.abs(bcy), Math.abs(bcy - H)),
    ) + W + H
  ) / vp.scale;
  const p1  = w2c(bx + FAR * ux, by + FAR * uy, vp);
  const p2  = w2c(bx - FAR * ux, by - FAR * uy, vp);
  const { cx, cy } = w2c(bx, by, vp);
  const lx = Math.min(Math.max(cx, 4), W - 40);
  const ly = Math.min(Math.max(cy, 14), H - 4);
  return (
    <g>
      <line x1={p1.cx} y1={p1.cy} x2={p2.cx} y2={p2.cy}
            stroke={color} strokeWidth={2.5 * weight} strokeLinecap="round" />
      {renderLabel(label, lx, ly, opts)}
    </g>
  );
}

function SvgVector({ vx, vy, px, py, label, color, vp, hovered, linked, tipDraggable = true, opts }) {
  const tail = w2c(px, py, vp);
  const tip  = w2c(px + vx, py + vy, vp);
  const dx   = tip.cx - tail.cx;
  const dy   = tip.cy - tail.cy;
  const len  = Math.sqrt(dx * dx + dy * dy);

  let arrowPts = null;
  if (len > 8) {
    const angle   = Math.atan2(dy, dx);
    const headLen = Math.min(14, len * 0.35);
    const headAng = Math.PI / 6;
    arrowPts = [
      `${tip.cx},${tip.cy}`,
      `${tip.cx - headLen * Math.cos(angle - headAng)},${tip.cy - headLen * Math.sin(angle - headAng)}`,
      `${tip.cx - headLen * Math.cos(angle + headAng)},${tip.cy - headLen * Math.sin(angle + headAng)}`,
    ].join(' ');
  }

  const tailR = hovered ? 7 : 5;

  return (
    <g>
      <line x1={tail.cx} y1={tail.cy} x2={tip.cx} y2={tip.cy}
            stroke={color} strokeWidth={hovered ? 2.5 : 2} strokeLinecap="round" />
      {arrowPts && <polygon points={arrowPts} fill={color} />}
      {hovered && tipDraggable && len > 8 && (
        <circle cx={tip.cx} cy={tip.cy} r={5}
                fill="none" style={{ stroke: 'var(--point-ring-hover)' }} strokeWidth={1.5} />
      )}
      {!linked ? (
        <>
          {hovered && <circle cx={tail.cx} cy={tail.cy} r={tailR + 4} fill={color + '28'} />}
          <circle cx={tail.cx} cy={tail.cy} r={tailR}
                  fill={color}
                  style={{ stroke: hovered ? 'var(--point-stroke-hover)' : 'var(--point-stroke)' }}
                  strokeWidth={hovered ? 2 : 1.5} />
        </>
      ) : hovered && (
        <circle cx={tail.cx} cy={tail.cy} r={11}
                fill="none" stroke={color + 'bb'}
                strokeWidth={1.5} strokeDasharray="3 3" />
      )}
      {len > 4 && renderLabel(label, (tail.cx + tip.cx) / 2, (tail.cy + tip.cy) / 2, opts)}
    </g>
  );
}

// ─── Label rendering ──────────────────────────────────────────────────────────

const ANCHOR_CFG = {
  'top-left':     { dx: -1, dy: -1, anchor: 'end',    baseline: 'auto'    },
  'top':          { dx:  0, dy: -1, anchor: 'middle',  baseline: 'auto'    },
  'top-right':    { dx:  1, dy: -1, anchor: 'start',   baseline: 'auto'    },
  'left':         { dx: -1, dy:  0, anchor: 'end',     baseline: 'middle'  },
  'right':        { dx:  1, dy:  0, anchor: 'start',   baseline: 'middle'  },
  'bottom-left':  { dx: -1, dy:  1, anchor: 'end',     baseline: 'hanging' },
  'bottom':       { dx:  0, dy:  1, anchor: 'middle',  baseline: 'hanging' },
  'bottom-right': { dx:  1, dy:  1, anchor: 'start',   baseline: 'hanging' },
};

function renderLabel(label, cx, cy, opts) {
  if (!label) return null;
  const fontSize    = opts?.fontSize    ?? 13;
  const orientation = opts?.orientation ?? 0;
  const textAngle   = opts?.angle       ?? 0;
  const anchorKey   = opts?.anchor      ?? 'top-right';
  const cfg = ANCHOR_CFG[anchorKey] ?? ANCHOR_CFG['top-right'];
  const off = fontSize * 0.65 + 4;
  const tx  = cx + cfg.dx * off;
  const ty  = cy + cfg.dy * off;
  return (
    <text
      x={tx} y={ty}
      textAnchor={cfg.anchor}
      dominantBaseline={cfg.baseline}
      style={{ fill: 'var(--text)' }}
      fontFamily="monospace"
      fontSize={fontSize}
      fontWeight="bold"
      pointerEvents="none"
      transform={orientation !== 0 || textAngle !== 0 ? `rotate(${orientation + textAngle},${tx},${ty})` : undefined}
    >{label}</text>
  );
}

// VGA bivector B = V ^ W where both operands resolve to vectors: draw the
// oriented parallelogram spanned by V and W. Area = |V ^ W|, orientation
// (sign of value) indicated by a small curved arrow at the centroid showing
// the traversal direction (px,py) → (px+V) → (px+V+W) → (px+W) → (px,py).
// (px, py) is the anchor — the origin corner of the parallelogram.
function SvgWedgeParallelogram({ v1, v2, value, label, color, vp, opts, px = 0, py = 0, hovered = false, linked = false, showAnchor = true }) {
  const o  = w2c(px, py, vp);
  const p1 = w2c(px + v1.vx, py + v1.vy, vp);
  const p2 = w2c(px + v1.vx + v2.vx, py + v1.vy + v2.vy, vp);
  const p3 = w2c(px + v2.vx, py + v2.vy, vp);
  const pts = `${o.cx},${o.cy} ${p1.cx},${p1.cy} ${p2.cx},${p2.cy} ${p3.cx},${p3.cy}`;
  const cx = (o.cx + p1.cx + p2.cx + p3.cx) / 4;
  const cy = (o.cy + p1.cy + p2.cy + p3.cy) / 4;
  const dir = value >= 0 ? 1 : -1;
  // Centroid arc: small curved arrow indicating orientation.
  const ar  = 10;
  const a0  = dir > 0 ? -Math.PI / 2 :  Math.PI / 2;
  const a1  = dir > 0 ?  Math.PI / 2 : -Math.PI / 2;
  const sx  = cx + ar * Math.cos(a0);
  const sy  = cy - ar * Math.sin(a0);
  const ex  = cx + ar * Math.cos(a1);
  const ey  = cy - ar * Math.sin(a1);
  const sweep = dir > 0 ? 0 : 1;
  const arc = `M ${sx} ${sy} A ${ar} ${ar} 0 0 ${sweep} ${ex} ${ey}`;
  // Arrow tip at the end of the arc.
  const tipAng    = a1 + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  const arrowLen  = 6;
  const tail1x = ex - arrowLen * Math.cos(tipAng - 0.4);
  const tail1y = ey + arrowLen * Math.sin(tipAng - 0.4);
  const tail2x = ex - arrowLen * Math.cos(tipAng + 0.4);
  const tail2y = ey + arrowLen * Math.sin(tipAng + 0.4);
  const anchorR = hovered ? 7 : 5;
  return (
    <g>
      <polygon points={pts} fill={color} fillOpacity={0.18}
               stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <path d={arc} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <polygon points={`${ex},${ey} ${tail1x},${tail1y} ${tail2x},${tail2y}`} fill={color} />
      {/* Anchor handle at the origin corner so the user can grab and drag.
          Hidden when `showAnchor` is off unless hovered. */}
      {!linked ? ((showAnchor || hovered) && (
        <circle cx={o.cx} cy={o.cy} r={anchorR}
                fill={color}
                style={{ stroke: hovered ? 'var(--point-stroke-hover)' : 'var(--point-stroke)' }}
                strokeWidth={hovered ? 2 : 1.5} />
      )) : hovered && (
        <circle cx={o.cx} cy={o.cy} r={11}
                fill="none" stroke={color + 'bb'}
                strokeWidth={1.5} strokeDasharray="3 3" />
      )}
      {renderLabel(label, cx, cy - ar - 4, opts)}
    </g>
  );
}

// VGA bivector fallback: literal `b*e12` or a wedge expression that isn't a
// simple `V ^ W` of two vector deps. Fixed-radius loop centred at (px, py) —
// only the sign of the value drives the curve direction.
function SvgBivector({ value, label, color, vp, opts, px = 0, py = 0, hovered = false, linked = false, showAnchor = true }) {
  const { cx, cy } = w2c(px, py, vp);
  const r = 22;
  const dir = value >= 0 ? 1 : -1;
  // CCW path: end at angle 0, sweep around back to angle 0 via -π. Use two arcs.
  const p1x = cx + r, p1y = cy;
  const p2x = cx - r, p2y = cy;
  // Sweep flag controls direction; for CCW (dir = +1) we want sweep = 0 with our SVG y-flip.
  const sweep = dir > 0 ? 0 : 1;
  const d = `M ${p1x} ${p1y} A ${r} ${r} 0 0 ${sweep} ${p2x} ${p2y} A ${r} ${r} 0 0 ${sweep} ${p1x} ${p1y}`;
  // Tiny arrow tip near the rightmost point indicating direction.
  const arrowAng = dir > 0 ? -Math.PI / 6 : Math.PI / 6;
  const tipX = cx + r * Math.cos(arrowAng);
  const tipY = cy - r * Math.sin(arrowAng);
  const arrowLen = 8;
  const baseAng = arrowAng + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  const tail1x = tipX - arrowLen * Math.cos(baseAng - 0.3);
  const tail1y = tipY + arrowLen * Math.sin(baseAng - 0.3);
  const tail2x = tipX - arrowLen * Math.cos(baseAng + 0.3);
  const tail2y = tipY + arrowLen * Math.sin(baseAng + 0.3);
  return (
    <g>
      <path d={d} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <polygon points={`${tipX},${tipY} ${tail1x},${tail1y} ${tail2x},${tail2y}`} fill={color} />
      {/* Anchor handle at the loop centre. Hidden when `showAnchor` is off
          unless hovered. */}
      {!linked ? ((showAnchor || hovered) && (
        <circle cx={cx} cy={cy} r={hovered ? 7 : 5}
                fill={color}
                style={{ stroke: hovered ? 'var(--point-stroke-hover)' : 'var(--point-stroke)' }}
                strokeWidth={hovered ? 2 : 1.5} />
      )) : hovered && (
        <circle cx={cx} cy={cy} r={11}
                fill="none" stroke={color + 'bb'}
                strokeWidth={1.5} strokeDasharray="3 3" />
      )}
      {renderLabel(label, cx, cy - r - 4, opts)}
    </g>
  );
}

// VGA rotor: arc at the origin spanning the rotation angle θ = 2·atan2(b, a).
// Rendered as a sector from +x axis through the angle, plus a label.
function SvgRotor({ angle, label, color, vp, opts, weight = 1 }) {
  const { cx, cy } = w2c(0, 0, vp);
  const r = 36 * weight;
  // Normalise to (-π, π]
  let a = ((angle + Math.PI) % (2 * Math.PI)) - Math.PI;
  const startX = cx + r;
  const startY = cy;
  // SVG y is flipped: rotating by `a` radians in world = -a in screen.
  const endX = cx + r * Math.cos(a);
  const endY = cy - r * Math.sin(a);
  const largeArc = Math.abs(a) > Math.PI ? 1 : 0;
  const sweep = a >= 0 ? 0 : 1; // CCW positive angle → sweep 0 with y-flip
  const arcPath = `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} ${sweep} ${endX} ${endY}`;
  const angleLabel = `${(a * 180 / Math.PI).toFixed(1)}°`;
  const midA = a / 2;
  const labelX = cx + (r + 14) * Math.cos(midA);
  const labelY = cy - (r + 14) * Math.sin(midA);
  return (
    <g>
      <line x1={cx} y1={cy} x2={startX} y2={startY} stroke={color} strokeWidth={1.5 * weight} strokeOpacity={0.4} strokeDasharray="3 3" />
      <line x1={cx} y1={cy} x2={endX} y2={endY}     stroke={color} strokeWidth={1.5 * weight} strokeOpacity={0.6} />
      <path d={arcPath} fill="none" stroke={color} strokeWidth={2.5 * weight} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3 * weight} fill={color} />
      <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontFamily="monospace" fontWeight="600"
            style={{ fill: 'var(--text-muted)' }} pointerEvents="none">
        {angleLabel}
      </text>
      {renderLabel(label, cx + r + 4, cy - r - 4, opts)}
    </g>
  );
}

function SvgPolygon({ points, label, color, vp, opts }) {
  const pts = points.map(p => { const { cx, cy } = w2c(p.x, p.y, vp); return `${cx},${cy}`; }).join(' ');
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const { cx: lx, cy: ly } = w2c(cx, cy, vp);
  return (
    <g>
      <polygon points={pts} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
      {renderLabel(label, lx, ly, opts)}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Canvas() {
  const svgRef     = useRef(null);
  const wrapperRef = useRef(null);
  const { algebra } = useAlgebra();
  const { settings } = useSettings();
  const {
    nodes, values, colorMap, labelMap, labelOptsMap, vectorPositions, orderedNodeIds, items,
    movableMap,
    updateFreePoint, setDrawPos, setDrawPosRef, updateVector,
    updateDepPoint, updateDualDepPoint, updateLiteralMVPoint,
    addFreePoint,
  } = useGraphContext();
  const { parseExpression, classifyMV, objectWeight, getRenderPlan } = algebra;

  const hiddenIds = useMemo(
    () => new Set(items.filter((it) => it.visible === false).map((it) => {
      const n = nodes[parseExpression(it.text)?.id];
      return n?.id ?? null;
    }).filter(Boolean)),
    [items, nodes, parseExpression]
  );

  const appearanceMap = useMemo(() => {
    const map = {};
    for (const it of items) {
      const node = parseExpression(it.text);
      if (!node) continue;
      map[node.id] = {
        opacity:        it.opacity        ?? 1,
        scale:          it.scale          ?? 1,
        pointShape:     it.pointShape     ?? 'circle',
        showOutline:    it.showOutline    ?? true,
        showFill:       it.showFill       ?? false,
        hiddenElements: new Set(it.hiddenElements ?? []),
      };
    }
    return map;
  }, [items, parseExpression]);

  const [vp,        setVp]        = useState(INITIAL_VP);
  const [size,      setSize]      = useState({ w: 800, h: 600 });
  const [cursor,    setCursor]    = useState('grab');
  const [hoveredId, setHoveredId] = useState(null);

  const dragRef     = useRef(null);
  const ptDragRef   = useRef(null);
  const hovIdRef    = useRef(null);
  const prevSizeRef = useRef({ w: 800, h: 600 });

  const snap = useRef(null);
  snap.current = {
    nodes, values, vp, colorMap, vectorPositions, hiddenIds, movableMap,
    updateFreePoint, setDrawPos, setDrawPosRef, updateVector,
    updateDepPoint, updateDualDepPoint, updateLiteralMVPoint,
    addFreePoint,
  };

  // Handle zoom via a native non-passive listener so preventDefault always works.
  // React's synthetic onWheel can be passive in some environments, causing
  // getBoundingClientRect to return a shifted rect (due to page scroll) and
  // breaking the zoom-centre calculation.
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const { mx, my } = svgPt(e, el);
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setVp(v => {
        const newScale = Math.min(1e6, Math.max(0.001, v.scale * f));
        const ef = newScale / v.scale;
        return {
          scale:   newScale,
          offsetX: mx - (mx - v.offsetX) * ef,
          offsetY: my - (my - v.offsetY) * ef,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Resize observer — keep size in sync with the container
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(wrapper.clientWidth)  || 800;
      const h = Math.floor(wrapper.clientHeight) || 600;
      const prev = prevSizeRef.current;
      prevSizeRef.current = { w, h };
      setSize({ w, h });
      setVp(v => ({
        ...v,
        offsetX: v.offsetX + (w - prev.w) / 2,
        offsetY: v.offsetY + (h - prev.h) / 2,
      }));
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    svgRef.current.setPointerCapture(e.pointerId);
    const { mx, my } = svgPt(e, svgRef.current);
    const { nodes, values, vectorPositions, vp, hiddenIds, movableMap } = snap.current;
    const hit = hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap, algebra);
    if (hit) {
      ptDragRef.current = hit;
      setCursor('crosshair');
    } else {
      dragRef.current = { startMx: mx, startMy: my, ox: vp.offsetX, oy: vp.offsetY };
      setCursor('grabbing');
    }
  }

  function handlePointerMove(e) {
    const { mx, my } = svgPt(e, svgRef.current);
    const { nodes, values, vectorPositions, vp, updateFreePoint, setDrawPos } = snap.current;

    if (ptDragRef.current) {
      const { x, y } = c2w(mx, my, vp);
      const { id, dragType } = ptDragRef.current;
      const rx = roundToScale(x, vp.scale);
      const ry = roundToScale(y, vp.scale);
      if (dragType === 'freePoint')    updateFreePoint(id, rx, ry);
      if (dragType === 'scalarPoint')  snap.current.updateScalarAsComplexPoint?.(id, rx, ry);
      if (dragType === 'depPoint')     snap.current.updateDepPoint(id, rx, ry);
      if (dragType === 'dualDepPoint') snap.current.updateDualDepPoint(id, rx, ry);
      if (dragType === 'litMVPoint')   snap.current.updateLiteralMVPoint(id, rx, ry);
      if (dragType === 'vector') {
        const nearby = settings.snapOnDrag
          ? findNearbySnapTarget(mx, my, nodes, values, vectorPositions, vp, SNAP_RADIUS ** 2, algebra, id)
          : null;
        if (nearby) snap.current.setDrawPosRef(id, nearby.id, nearby.anchor);
        else        setDrawPos(id, rx, ry);
      }
      if (dragType === 'vectorTip') {
        const pos = vectorPositions[id] ?? { x: 0, y: 0 };
        snap.current.updateVector(id, roundToScale(x - pos.x, vp.scale), roundToScale(y - pos.y, vp.scale));
      }

    } else if (dragRef.current) {
      const dx = mx - dragRef.current.startMx;
      const dy = my - dragRef.current.startMy;
      const { ox, oy } = dragRef.current;
      setVp(v => ({ ...v, offsetX: ox + dx, offsetY: oy + dy }));

    } else {
      const hit   = hitTest(mx, my, nodes, values, vectorPositions, vp, snap.current.hiddenIds, snap.current.movableMap, algebra);
      const hitId = hit?.id ?? null;
      const newCursor = hitId ? 'pointer' : 'grab';
      if (newCursor !== cursor) setCursor(newCursor);
      if (hitId !== hovIdRef.current) {
        hovIdRef.current = hitId;
        setHoveredId(hitId);
      }
    }
  }

  function handlePointerUp() {
    ptDragRef.current = null;
    dragRef.current   = null;
    setCursor('grab');
  }

  function handleDoubleClick(e) {
    const { mx, my } = svgPt(e, svgRef.current);
    const { nodes, values, vectorPositions, vp, hiddenIds, movableMap, addFreePoint } = snap.current;
    if (hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap, algebra)) return;
    const { x, y } = c2w(mx, my, vp);
    addFreePoint(roundToScale(x, vp.scale), roundToScale(y, vp.scale));
  }

  // Build SVG objects split into two layers: back (lines/triangles) then front (points).
  // This ensures points are always rendered on top of lines regardless of expression order.
  const backLayer = [];
  const frontLayer = [];

  // Ideal-line ellipse + ideal-point markers are PGA-only (kind === 'idealLine'
  // exists for that algebra). VGA never emits idealLine, so this stays false.
  const hasIdealLine = orderedNodeIds.some((id) =>
    !hiddenIds.has(id) && classifyMV(values[id])?.kind === 'idealLine'
  );

  for (const id of orderedNodeIds) {
    const node = nodes[id];
    if (!node) continue;
    if (hiddenIds.has(id)) continue;
    const val = values[id];
    if (val == null) continue;
    const color   = colorMap[id] ?? '#4444cc';
    const label   = labelMap[id] ?? null;
    const opts    = labelOptsMap[id] ?? null;
    const hovered = id === hoveredId;
    const weight  = settings.weightThickness ? objectWeight(val) : 1;
    const appear  = appearanceMap[id] ?? {};
    const opacity = appear.opacity ?? 1;
    const scale   = appear.scale   ?? 1;
    const shape   = appear.pointShape ?? 'circle';

    // Scalar-valued nodes (triangle, meetChain) have no canvas presence.
    if (node.type === 'triangle' || node.type === 'meetChain') continue;

    // Algebra decides what each value renders as. PGA + VGA both implement
    // this; new algebras just have to return one of the supported kinds.
    const plan = getRenderPlan(val);
    if (!plan) continue;

    switch (plan.kind) {
      case 'list': {
        const showOutline    = appear.showOutline    ?? true;
        const showFill       = appear.showFill       ?? false;
        const hiddenElems    = appear.hiddenElements ?? new Set();
        const visibleOutline = plan.outline?.filter((_, i) => !hiddenElems.has(i));

        const listChildren = [];
        if (showOutline && visibleOutline && visibleOutline.length >= 2) {
          listChildren.push(<SvgPolygon key={`${id}-outline`} points={visibleOutline} label={label} color={color} vp={vp} opts={opts} />);
        }
        if (showFill && visibleOutline && visibleOutline.length >= 3) {
          const pts = visibleOutline.map(({ x, y }) => { const c = w2c(x, y, vp); return `${c.cx},${c.cy}`; }).join(' ');
          listChildren.push(<polygon key={`${id}-fill`} points={pts} fill={color} fillOpacity={0.18} stroke="none" />);
        }
        plan.elements.forEach((elem, ei) => {
          if (hiddenElems.has(ei)) return;
          const ekey = `${id}-e${ei}`;
          switch (elem.kind) {
            case 'finitePoint':
              frontLayer.push(<SvgPoint key={ekey} x={elem.x} y={elem.y} label={null} color={color} vp={vp} W={size.w} H={size.h} hovered={false} opts={null} weight={weight} shape={shape} scale={scale} />);
              break;
            case 'line': {
              const bd = algebra.lineBaseAndDir?.(elem.L);
              listChildren.push(<SvgLine key={ekey} bd={bd} label={null} color={color} vp={vp} W={size.w} H={size.h} opts={null} weight={weight} />);
              break;
            }
            case 'positionedVector':
              listChildren.push(<SvgVector key={ekey} vx={elem.vx} vy={elem.vy} px={0} py={0} label={null} color={color} vp={vp} hovered={false} linked={false} tipDraggable={false} opts={null} />);
              break;
            default: break;
          }
        });
        if (listChildren.length > 0) {
          backLayer.push(opacity < 1
            ? <g key={`${id}-list`} opacity={opacity}>{listChildren}</g>
            : <g key={`${id}-list`}>{listChildren}</g>
          );
        }
        break;
      }
      case 'positionedVector': {
        const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
        // Only `vector`-type nodes have an editable tip — derived vectors
        // (mvExpr, motorApply, dual, …) inherit their tip from the algebra.
        const tipDraggable = (plan.tipDraggable ?? true) && node.type === 'vector';
        backLayer.push(
          <SvgVector key={id} vx={plan.vx} vy={plan.vy} px={pos.x} py={pos.y}
            label={label} color={color} vp={vp} hovered={hovered} linked={pos.linked}
            tipDraggable={tipDraggable} opts={opts} />
        );
        if (hasIdealLine && plan.ringMarker !== false) {
          backLayer.push(
            <SvgIdealPointMarker key={`${id}-inf`} vx={plan.vx} vy={plan.vy}
              color={color} W={size.w} H={size.h} hovered={hovered} weight={weight} />
          );
        }
        break;
      }
      case 'finitePoint': {
        const ptEl = <SvgPoint key={id} x={plan.x} y={plan.y} label={label} color={color} vp={vp} W={size.w} H={size.h} hovered={hovered} opts={opts} weight={weight} shape={shape} scale={scale} />;
        frontLayer.push(opacity < 1 ? <g key={`${id}-g`} opacity={opacity}>{ptEl}</g> : ptEl);
        break;
      }
      case 'line': {
        // PGA-only — algebra.getRenderPlan returns the line MV; resolve its base+dir here.
        const bd = algebra.lineBaseAndDir?.(plan.L);
        backLayer.push(<SvgLine key={id} bd={bd} label={label} color={color} vp={vp} W={size.w} H={size.h} opts={opts} weight={weight} />);
        break;
      }
      case 'idealLine':
        backLayer.push(<SvgIdealLine key={id} label={label} color={color} W={size.w} H={size.h} opts={opts} weight={weight} />);
        break;
      case 'bivector': {
        const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
        // If the bivector is exactly `<v1> ^ <v2>` and both deps resolve to
        // vectors, render the oriented parallelogram spanned by v1 and v2.
        // Otherwise fall back to the generic loop. Both anchor at `pos`.
        let drewWedge = false;
        if (node.type === 'mvExpr') {
          const m = node.params?.exprStr?.match(/^\s*([A-Za-z_]\w*)\s*\^\s*([A-Za-z_]\w*)\s*$/);
          if (m) {
            const a = values[m[1]];
            const b = values[m[2]];
            if (a && typeof a === 'object' && 'vx' in a &&
                b && typeof b === 'object' && 'vx' in b) {
              backLayer.push(
                <SvgWedgeParallelogram key={id} v1={a} v2={b} value={plan.value}
                  label={label} color={color} vp={vp} opts={opts}
                  px={pos.x} py={pos.y} hovered={hovered} linked={pos.linked}
                  showAnchor={settings.alwaysShowAnchors} />
              );
              drewWedge = true;
            }
          }
        }
        if (!drewWedge) {
          backLayer.push(
            <SvgBivector key={id} value={plan.value} label={label} color={color} vp={vp} opts={opts}
              px={pos.x} py={pos.y} hovered={hovered} linked={pos.linked}
              showAnchor={settings.alwaysShowAnchors} />
          );
        }
        break;
      }
      case 'rotor':
        backLayer.push(<SvgRotor key={id} angle={plan.angle} label={label} color={color} vp={vp} opts={opts} weight={weight} />);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={wrapperRef} style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        overflow="hidden"
        style={{ display: 'block', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onDragStart={(e) => e.preventDefault()}
      >
        <rect width={size.w} height={size.h} style={{ fill: 'var(--bg-canvas)' }} />
        {settings.showGrid && <SvgGrid vp={vp} W={size.w} H={size.h} />}
        {backLayer}
        {frontLayer}
      </svg>
    </div>
  );
}
