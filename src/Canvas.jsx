import { useRef, useEffect, useState, useMemo } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { toEuclidean, lineBaseAndDir, toIdealVector, classifyMV, objectWeight } from './pga.js';
import { parseExpression } from './graph/parseExpression.js';

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

function findNearbyPoint(mx, my, nodes, values, vp, sqRadius) {
  for (const [id] of Object.entries(nodes)) {
    const cls = classifyMV(values[id]);
    if (cls?.kind !== 'finitePoint') continue;
    const eu = toEuclidean(values[id]);
    if (!eu) continue;
    const { cx, cy } = w2c(eu.x, eu.y, vp);
    if ((mx - cx) ** 2 + (my - cy) ** 2 <= sqRadius) return id;
  }
  return null;
}

function hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap) {
  for (const [id, node] of Object.entries(nodes)) {
    if (hiddenIds?.has(id)) continue;
    if (movableMap?.[id] === false) continue;
    const valKind = classifyMV(values[id])?.kind;
    if (node.label === null && node.type !== 'freePoint' && node.type !== 'vector' && node.type !== 'multivector' && node.type !== 'meetPoint' && valKind !== 'idealPoint') continue;
    if (node.type === 'freePoint') {
      const eu = toEuclidean(values[id]);
      if (!eu) continue;
      const { cx, cy } = w2c(eu.x, eu.y, vp);
      if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'freePoint' };
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
      const hasVariablePos = coeffExprs?.[4] !== undefined || coeffExprs?.[5] !== undefined;
      if (hasVariablePos) {
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
      } else if (!dual && Math.abs(components?.[6] ?? 0) > 1e-10) {
        const eu = toEuclidean(values[id]);
        if (!eu) continue;
        const { cx, cy } = w2c(eu.x, eu.y, vp);
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'litMVPoint' };
      }
    }
    // Value-driven: any node whose value is an idealPoint allows tail dragging
    // (purely visual position via vectorPositions). Covers `D = !L`, derived
    // ideal points from motors, anonymous `!L`, etc.
    if (node.type !== 'vector' && valKind === 'idealPoint') {
      const pos = vectorPositions[id] ?? { x: 0, y: 0 };
      const tail = w2c(pos.x, pos.y, vp);
      if ((mx - tail.cx) ** 2 + (my - tail.cy) ** 2 <= HIT_RADIUS ** 2)
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

function SvgPoint({ x, y, label, color, vp, W, H, hovered, opts, weight = 1 }) {
  const { cx, cy } = w2c(x, y, vp);
  if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) return null;
  const r = (hovered ? 8 : 6) * weight;
  return (
    <g>
      {hovered && <circle cx={cx} cy={cy} r={r + 5} fill={color + '28'} />}
      <circle
        cx={cx} cy={cy} r={r}
        fill={color}
        style={{ stroke: hovered ? 'var(--point-stroke-hover)' : 'var(--point-stroke)' }}
        strokeWidth={hovered ? 2 : 1.5}
      />
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

function SvgLine({ L, label, color, vp, W, H, opts, weight = 1 }) {
  const bd = lineBaseAndDir(L);
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
      transform={orientation !== 0 ? `rotate(${orientation},${tx},${ty})` : undefined}
    >{label}</text>
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
  const {
    nodes, values, colorMap, labelMap, labelOptsMap, vectorPositions, orderedNodeIds, items,
    movableMap,
    updateFreePoint, setDrawPos, setDrawPosRef, updateVector,
    updateDepPoint, updateDualDepPoint, updateLiteralMVPoint,
    addFreePoint,
  } = useGraphContext();

  const hiddenIds = useMemo(
    () => new Set(items.filter((it) => it.visible === false).map((it) => {
      const n = nodes[parseExpression(it.text)?.id];
      return n?.id ?? null;
    }).filter(Boolean)),
    [items, nodes]
  );

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
    const hit = hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap);
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
      if (dragType === 'depPoint')     snap.current.updateDepPoint(id, rx, ry);
      if (dragType === 'dualDepPoint') snap.current.updateDualDepPoint(id, rx, ry);
      if (dragType === 'litMVPoint')   snap.current.updateLiteralMVPoint(id, rx, ry);
      if (dragType === 'vector') {
        const nearby = findNearbyPoint(mx, my, nodes, values, vp, SNAP_RADIUS ** 2);
        if (nearby) snap.current.setDrawPosRef(id, nearby);
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
      const hit   = hitTest(mx, my, nodes, values, vectorPositions, vp, snap.current.hiddenIds, snap.current.movableMap);
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
    if (hitTest(mx, my, nodes, values, vectorPositions, vp, hiddenIds, movableMap)) return;
    const { x, y } = c2w(mx, my, vp);
    addFreePoint(roundToScale(x, vp.scale), roundToScale(y, vp.scale));
  }

  // Build SVG objects split into two layers: back (lines/triangles) then front (points).
  // This ensures points are always rendered on top of lines regardless of expression order.
  const backLayer = [];
  const frontLayer = [];

  // Ideal-point markers on the line-at-infinity ellipse are only drawn when
  // some visible node *is* the ideal line — otherwise the ellipse isn't on
  // screen, so a marker on it would have no anchor.
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
    const weight  = objectWeight(val);

    // Scalar-valued nodes (triangle, meetChain): no canvas render
    if (node.type === 'triangle' || node.type === 'meetChain') continue;

    // list node: polygon drawn from the pre-computed point list
    if (val?.list) {
      backLayer.push(<SvgPolygon key={id} points={val.points} label={label} color={color} vp={vp} opts={opts} />);
      continue;
    }

    // {vx, vy} ideal vector → back layer (arrow + optional marker on the ideal-line ellipse)
    if (typeof val === 'object' && 'vx' in val) {
      const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
      backLayer.push(
        <SvgVector key={id} vx={val.vx} vy={val.vy} px={pos.x} py={pos.y}
          label={label} color={color} vp={vp} hovered={hovered} linked={pos.linked} opts={opts} />
      );
      if (hasIdealLine) {
        backLayer.push(
          <SvgIdealPointMarker key={`${id}-inf`} vx={val.vx} vy={val.vy}
            color={color} W={size.w} H={size.h} hovered={hovered} weight={weight} />
        );
      }
      continue;
    }

    const cls = classifyMV(val);
    if (!cls) continue;

    switch (cls.kind) {
      case 'finitePoint': {
        const eu = toEuclidean(val);
        if (!eu) break;
        frontLayer.push(<SvgPoint key={id} x={eu.x} y={eu.y} label={label} color={color} vp={vp} W={size.w} H={size.h} hovered={hovered} opts={opts} weight={weight} />);
        break;
      }
      case 'idealPoint': {
        const iv = toIdealVector(val);
        if (!iv) break;
        const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
        backLayer.push(<SvgVector key={id} vx={iv.vx} vy={iv.vy} px={pos.x} py={pos.y} label={label} color={color} vp={vp} hovered={hovered} linked={pos.linked} tipDraggable={false} opts={opts} />);
        if (hasIdealLine) {
          backLayer.push(<SvgIdealPointMarker key={`${id}-inf`} vx={iv.vx} vy={iv.vy} color={color} W={size.w} H={size.h} hovered={hovered} weight={weight} />);
        }
        break;
      }
      case 'line':
        backLayer.push(<SvgLine key={id} L={val} label={label} color={color} vp={vp} W={size.w} H={size.h} opts={opts} weight={weight} />);
        break;
      case 'idealLine':
        backLayer.push(<SvgIdealLine key={id} label={label} color={color} W={size.w} H={size.h} opts={opts} weight={weight} />);
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
        <SvgGrid vp={vp} W={size.w} H={size.h} />
        {backLayer}
        {frontLayer}
      </svg>
    </div>
  );
}
