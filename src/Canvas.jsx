import { useRef, useEffect, useState } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { toEuclidean, lineBaseAndDir } from './pga.js';

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

function svgPt(e, svg) {
  const r = svg.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

function findNearbyPoint(mx, my, nodes, values, vp, sqRadius) {
  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'scalar' || node.type === 'vector' || node.type === 'joinLine') continue;
    const eu = toEuclidean(values[id]);
    if (!eu) continue;
    const { cx, cy } = w2c(eu.x, eu.y, vp);
    if ((mx - cx) ** 2 + (my - cy) ** 2 <= sqRadius) return id;
  }
  return null;
}

function hitTest(mx, my, nodes, values, vectorPositions, vp) {
  for (const [id, node] of Object.entries(nodes)) {
    if (node.label === null && node.type !== 'freePoint' && node.type !== 'vector' && node.type !== 'multivector') continue;
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
  const ly = Math.min(Math.max(oy + 13, 13), H - 5);
  const lx = Math.min(Math.max(ox - 5, 5), W - 5);

  return (
    <g>
      {wxs.map((wx, i) => {
        const { cx } = w2c(wx, 0, vp);
        return <line key={i} x1={cx} y1={0} x2={cx} y2={H} stroke="#ebebf2" strokeWidth={1} />;
      })}
      {wys.map((wy, i) => {
        const { cy } = w2c(0, wy, vp);
        return <line key={i} x1={0} y1={cy} x2={W} y2={cy} stroke="#ebebf2" strokeWidth={1} />;
      })}
      <line x1={ox} y1={0} x2={ox} y2={H} stroke="rgba(100,100,160,0.4)" strokeWidth={1.5} />
      <line x1={0}  y1={oy} x2={W} y2={oy} stroke="rgba(100,100,160,0.4)" strokeWidth={1.5} />
      {wxs.map((wx, i) => {
        if (Math.abs(wx) < step * 0.01) return null;
        const { cx } = w2c(wx, 0, vp);
        return (
          <text key={i} x={cx} y={ly} textAnchor="middle"
                fontSize={10} fontFamily="monospace" fill="#9090b0" pointerEvents="none">
            {Math.round(wx)}
          </text>
        );
      })}
      {wys.map((wy, i) => {
        if (Math.abs(wy) < step * 0.01) return null;
        const { cy } = w2c(0, wy, vp);
        return (
          <text key={i} x={lx} y={cy + 4} textAnchor="end"
                fontSize={10} fontFamily="monospace" fill="#9090b0" pointerEvents="none">
            {Math.round(wy)}
          </text>
        );
      })}
    </g>
  );
}

// ─── Object components ────────────────────────────────────────────────────────

function SvgPoint({ x, y, label, color, vp, W, H, hovered }) {
  const { cx, cy } = w2c(x, y, vp);
  if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) return null;
  const r = hovered ? 8 : 6;
  return (
    <g>
      {hovered && <circle cx={cx} cy={cy} r={r + 5} fill={color + '28'} />}
      <circle
        cx={cx} cy={cy} r={r}
        fill={color}
        stroke={hovered ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)'}
        strokeWidth={hovered ? 2 : 1.5}
      />
      {label && (
        <text x={cx + r + 4} y={cy - 8}
              fill="#1c1c2e" fontFamily="monospace" fontSize={13} fontWeight="bold" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  );
}

function SvgLine({ L, label, color, vp, W, H }) {
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
            stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      {label && (
        <text x={lx + 8} y={ly - 8}
              fill={color} fontFamily="monospace" fontSize={13} fontWeight="bold" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  );
}

function SvgVector({ vx, vy, px, py, label, color, vp, hovered, linked }) {
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
      {hovered && len > 8 && (
        <circle cx={tip.cx} cy={tip.cy} r={5}
                fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={1.5} />
      )}
      {!linked ? (
        <>
          {hovered && <circle cx={tail.cx} cy={tail.cy} r={tailR + 4} fill={color + '28'} />}
          <circle cx={tail.cx} cy={tail.cy} r={tailR}
                  fill={color}
                  stroke={hovered ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)'}
                  strokeWidth={hovered ? 2 : 1.5} />
        </>
      ) : hovered && (
        <circle cx={tail.cx} cy={tail.cy} r={11}
                fill="none" stroke={color + 'bb'}
                strokeWidth={1.5} strokeDasharray="3 3" />
      )}
      {label && len > 4 && (
        <text x={(tail.cx + tip.cx) / 2 + 6} y={(tail.cy + tip.cy) / 2 - 6}
              fill="#1c1c2e" fontFamily="monospace" fontSize={13} fontWeight="bold" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  );
}

function SvgTriangle({ p1, p2, p3, label, color, vp }) {
  const c1 = w2c(p1.x, p1.y, vp);
  const c2 = w2c(p2.x, p2.y, vp);
  const c3 = w2c(p3.x, p3.y, vp);
  const pts = `${c1.cx},${c1.cy} ${c2.cx},${c2.cy} ${c3.cx},${c3.cy}`;
  const lx = (c1.cx + c2.cx + c3.cx) / 3;
  const ly = (c1.cy + c2.cy + c3.cy) / 3;
  return (
    <g>
      <polygon points={pts} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontFamily="monospace" fontSize={13} fontWeight="bold" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Canvas() {
  const svgRef     = useRef(null);
  const wrapperRef = useRef(null);
  const {
    nodes, values, colorMap, labelMap, vectorPositions, orderedNodeIds,
    updateFreePoint, setDrawPos, setDrawPosRef, updateVector,
    updateDepPoint, updateDualDepPoint, updateLiteralMVPoint,
    addFreePoint,
  } = useGraphContext();

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
    nodes, values, vp, colorMap, vectorPositions,
    updateFreePoint, setDrawPos, setDrawPosRef, updateVector,
    updateDepPoint, updateDualDepPoint, updateLiteralMVPoint,
    addFreePoint,
  };

  // Block browser zoom on the SVG
  useEffect(() => {
    const el = svgRef.current;
    const block = (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
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

  function handleWheel(e) {
    e.preventDefault();
    const { mx, my } = svgPt(e, svgRef.current);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setVp(v => {
      const newScale = Math.min(50, Math.max(0.02, v.scale * f));
      const ef = newScale / v.scale;
      return {
        scale:   newScale,
        offsetX: mx - (mx - v.offsetX) * ef,
        offsetY: my - (my - v.offsetY) * ef,
      };
    });
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    svgRef.current.setPointerCapture(e.pointerId);
    const { mx, my } = svgPt(e, svgRef.current);
    const { nodes, values, vectorPositions, vp } = snap.current;
    const hit = hitTest(mx, my, nodes, values, vectorPositions, vp);
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
      if (dragType === 'freePoint')    updateFreePoint(id, Math.round(x), Math.round(y));
      if (dragType === 'depPoint')     snap.current.updateDepPoint(id, Math.round(x), Math.round(y));
      if (dragType === 'dualDepPoint') snap.current.updateDualDepPoint(id, Math.round(x), Math.round(y));
      if (dragType === 'litMVPoint')   snap.current.updateLiteralMVPoint(id, Math.round(x), Math.round(y));
      if (dragType === 'vector') {
        const nearby = findNearbyPoint(mx, my, nodes, values, vp, SNAP_RADIUS ** 2);
        if (nearby) snap.current.setDrawPosRef(id, nearby);
        else        setDrawPos(id, Math.round(x), Math.round(y));
      }
      if (dragType === 'vectorTip') {
        const pos = vectorPositions[id] ?? { x: 0, y: 0 };
        snap.current.updateVector(id, Math.round(x - pos.x), Math.round(y - pos.y));
      }

    } else if (dragRef.current) {
      const dx = mx - dragRef.current.startMx;
      const dy = my - dragRef.current.startMy;
      const { ox, oy } = dragRef.current;
      setVp(v => ({ ...v, offsetX: ox + dx, offsetY: oy + dy }));

    } else {
      const hit   = hitTest(mx, my, nodes, values, vectorPositions, vp);
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
    const { nodes, values, vectorPositions, vp, addFreePoint } = snap.current;
    if (hitTest(mx, my, nodes, values, vectorPositions, vp)) return;
    const { x, y } = c2w(mx, my, vp);
    addFreePoint(x, y);
  }

  // Build SVG objects in item draw order
  const objects = orderedNodeIds.map(id => {
    const node = nodes[id];
    if (!node || node.type === 'scalar' || node.type === 'motorExp') return null;
    const val = values[id];
    if (val == null) return null;
    const color   = colorMap[id] ?? '#4444cc';
    const label   = labelMap[id] ?? null;
    const hovered = id === hoveredId;

    if (node.type === 'triangle') {
      return <SvgTriangle key={id} p1={val.p1} p2={val.p2} p3={val.p3} label={label} color={color} vp={vp} />;
    }
    if (node.type === 'joinLine') {
      return <SvgLine key={id} L={val} label={label} color={color} vp={vp} W={size.w} H={size.h} />;
    }
    if (node.type === 'vector') {
      const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
      return (
        <SvgVector key={id}
          vx={val.vx} vy={val.vy} px={pos.x} py={pos.y}
          label={label} color={color} vp={vp} hovered={hovered} linked={pos.linked}
        />
      );
    }
    const eu = toEuclidean(val);
    if (eu) {
      return (
        <SvgPoint key={id}
          x={eu.x} y={eu.y}
          label={label} color={color} vp={vp} W={size.w} H={size.h} hovered={hovered}
        />
      );
    }
    if (lineBaseAndDir(val)) {
      return <SvgLine key={id} L={val} label={label} color={color} vp={vp} W={size.w} H={size.h} />;
    }
    return null;
  });

  return (
    <div ref={wrapperRef} style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        overflow="hidden"
        style={{ display: 'block', cursor }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onDragStart={(e) => e.preventDefault()}
      >
        <rect width={size.w} height={size.h} fill="#fafafa" />
        <SvgGrid vp={vp} W={size.w} H={size.h} />
        {objects}
      </svg>
    </div>
  );
}
