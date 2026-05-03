import { useRef, useEffect, useState } from 'react';
import { useGraphContext } from './GraphContext.jsx';
import { toEuclidean, lineBaseAndDir } from './pga.js';

const W = 800, H = 600;
const INITIAL_VP = { scale: 1, offsetX: W / 2, offsetY: H / 2 };
const HIT_RADIUS  = 12;
const SNAP_RADIUS = 24; // px — snap vector tail to nearby point

// ─── Coordinate helpers ─────────────────────────────────────────────────────

function w2c(x, y, vp) {
  return { cx: vp.offsetX + x * vp.scale, cy: vp.offsetY - y * vp.scale };
}

function c2w(cx, cy, vp) {
  return { x: (cx - vp.offsetX) / vp.scale, y: -(cy - vp.offsetY) / vp.scale };
}

function canvasPt(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return {
    mx: (e.clientX - r.left) * (W / r.width),
    my: (e.clientY - r.top)  * (H / r.height),
  };
}

// Return node ID of first point (any type with a Euclidean position) within sqRadius of (mx,my).
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

// Returns { id, dragType } for the first draggable element under (mx,my), or null.
// dragType: 'freePoint' | 'vector' (tail) | 'vectorTip'
function hitTest(mx, my, nodes, values, vectorPositions, vp) {
  for (const [id, node] of Object.entries(nodes)) {
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

      // Tail hit (moves draw position)
      const tail = w2c(pos.x, pos.y, vp);
      if ((mx - tail.cx) ** 2 + (my - tail.cy) ** 2 <= HIT_RADIUS ** 2)
        return { id, dragType: 'vector' };

      // Tip hit (modifies vector components)
      if (val) {
        const tip = w2c(pos.x + val.vx, pos.y + val.vy, vp);
        if ((mx - tip.cx) ** 2 + (my - tip.cy) ** 2 <= HIT_RADIUS ** 2)
          return { id, dragType: 'vectorTip' };
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

function drawGrid(ctx, vp) {
  const step = gridStep(vp.scale);
  const minX = -vp.offsetX / vp.scale;
  const maxX = (W - vp.offsetX) / vp.scale;
  const minY = (vp.offsetY - H) / vp.scale;
  const maxY = vp.offsetY / vp.scale;

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2a2a3a';
  for (let wx = Math.floor(minX / step) * step; wx <= maxX; wx += step) {
    const { cx } = w2c(wx, 0, vp);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  }
  for (let wy = Math.floor(minY / step) * step; wy <= maxY; wy += step) {
    const { cy } = w2c(0, wy, vp);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
  }

  const { cx: ox, cy: oy } = w2c(0, 0, vp);
  ctx.strokeStyle = '#44446688';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();

  ctx.fillStyle = '#3d3d55';
  ctx.font = '10px monospace';
  const ly = Math.min(Math.max(oy + 13, 13), H - 5);
  const lx = Math.min(Math.max(ox - 5, 5), W - 5);
  ctx.textAlign = 'center';
  for (let wx = Math.floor(minX / step) * step; wx <= maxX; wx += step) {
    if (Math.abs(wx) < step * 0.01) continue;
    const { cx } = w2c(wx, 0, vp);
    ctx.fillText(Math.round(wx), cx, ly);
  }
  ctx.textAlign = 'right';
  for (let wy = Math.floor(minY / step) * step; wy <= maxY; wy += step) {
    if (Math.abs(wy) < step * 0.01) continue;
    const { cy } = w2c(0, wy, vp);
    ctx.fillText(Math.round(wy), lx, cy + 4);
  }
  ctx.textAlign = 'left';
}

// ─── Object drawing ───────────────────────────────────────────────────────────

function drawPoint(ctx, x, y, label, color, vp, hovered) {
  const { cx, cy } = w2c(x, y, vp);
  if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) return;

  const r = hovered ? 8 : 6;

  if (hovered) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = color + '30';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(255,255,255,0.7)';
  ctx.lineWidth = hovered ? 2 : 1.5;
  ctx.stroke();

  if (label) {
    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(label, cx + r + 4, cy - 8);
  }
}

function drawLine(ctx, L, label, color, vp) {
  const bd = lineBaseAndDir(L);
  if (!bd) return;
  const { bx, by, ux, uy } = bd;
  const FAR = (W + H) / vp.scale + 10;

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

  const p1 = w2c(bx + FAR * ux, by + FAR * uy, vp);
  const p2 = w2c(bx - FAR * ux, by - FAR * uy, vp);
  ctx.beginPath();
  ctx.moveTo(p1.cx, p1.cy);
  ctx.lineTo(p2.cx, p2.cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (label) {
    const { cx, cy } = w2c(bx, by, vp);
    const lx = Math.min(Math.max(cx, 4), W - 40);
    const ly = Math.min(Math.max(cy, 14), H - 4);
    ctx.fillStyle = color;
    ctx.font = 'bold 13px monospace';
    ctx.fillText(label, lx + 8, ly - 8);
  }
  ctx.restore();
}

function drawVector(ctx, vx, vy, px, py, label, color, vp, hovered, linked) {
  const tail = w2c(px, py, vp);
  const tip  = w2c(px + vx, py + vy, vp);

  const dx = tip.cx - tail.cx;
  const dy = tip.cy - tail.cy;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Shaft
  ctx.beginPath();
  ctx.moveTo(tail.cx, tail.cy);
  ctx.lineTo(tip.cx, tip.cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = hovered ? 2.5 : 2;
  ctx.stroke();

  // Arrowhead (only when long enough)
  if (len > 8) {
    const angle    = Math.atan2(dy, dx);
    const headLen  = Math.min(14, len * 0.35);
    const headAng  = Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(tip.cx, tip.cy);
    ctx.lineTo(tip.cx - headLen * Math.cos(angle - headAng), tip.cy - headLen * Math.sin(angle - headAng));
    ctx.lineTo(tip.cx - headLen * Math.cos(angle + headAng), tip.cy - headLen * Math.sin(angle + headAng));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Draggable tip indicator on hover
    if (hovered) {
      ctx.beginPath();
      ctx.arc(tip.cx, tip.cy, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff90';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Tail — solid dot when free, dashed ring when linked to a point
  if (!linked) {
    const r = hovered ? 7 : 5;
    if (hovered) {
      ctx.beginPath();
      ctx.arc(tail.cx, tail.cy, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = color + '30';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(tail.cx, tail.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = hovered ? 2 : 1.5;
    ctx.stroke();
  } else if (hovered) {
    // Linked: show a subtle dashed ring so the user knows the tail is draggable
    ctx.beginPath();
    ctx.arc(tail.cx, tail.cy, 11, 0, Math.PI * 2);
    ctx.strokeStyle = color + 'bb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Label near midpoint
  if (label && len > 4) {
    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(label, (tail.cx + tip.cx) / 2 + 6, (tail.cy + tip.cy) / 2 - 6);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Canvas() {
  const canvasRef = useRef(null);
  const { nodes, values, colorMap, vectorPositions, updateFreePoint, setDrawPos, setDrawPosRef, updateVector } =
    useGraphContext();

  const [vp, setVp]               = useState(INITIAL_VP);
  const [cursor, setCursor]       = useState('grab');
  const [hoveredId, setHoveredId] = useState(null);

  const dragRef   = useRef(null);
  const ptDragRef = useRef(null); // { id, dragType }
  const hovIdRef  = useRef(null);

  const snap = useRef(null);
  snap.current = { nodes, values, vp, colorMap, vectorPositions, updateFreePoint, setDrawPos, setDrawPosRef, updateVector };

  useEffect(() => {
    const el = canvasRef.current;
    const block = (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  function handleWheel(e) {
    e.preventDefault();
    const { mx, my } = canvasPt(e, canvasRef.current);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setVp((v) => ({
      scale:   Math.min(50, Math.max(0.02, v.scale * f)),
      offsetX: mx - (mx - v.offsetX) * f,
      offsetY: my - (my - v.offsetY) * f,
    }));
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    canvasRef.current.setPointerCapture(e.pointerId);

    const { mx, my } = canvasPt(e, canvasRef.current);
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
    const { mx, my } = canvasPt(e, canvasRef.current);
    const { nodes, values, vectorPositions, vp, updateFreePoint, setDrawPos } = snap.current;

    if (ptDragRef.current) {
      const { x, y } = c2w(mx, my, vp);
      const { id, dragType } = ptDragRef.current;
      if (dragType === 'freePoint') updateFreePoint(id, Math.round(x), Math.round(y));
      if (dragType === 'vector') {
        // Snap to a nearby point; otherwise set a static position
        const snap = findNearbyPoint(mx, my, nodes, values, vp, SNAP_RADIUS ** 2);
        if (snap) setDrawPosRef(id, snap);
        else      setDrawPos(id, Math.round(x), Math.round(y));
      }
      if (dragType === 'vectorTip') {
        const pos = vectorPositions[id] ?? { x: 0, y: 0 };
        updateVector(id, Math.round(x - pos.x), Math.round(y - pos.y));
      }

    } else if (dragRef.current) {
      const dx = mx - dragRef.current.startMx;
      const dy = my - dragRef.current.startMy;
      setVp((v) => ({
        ...v,
        offsetX: dragRef.current.ox + dx,
        offsetY: dragRef.current.oy + dy,
      }));

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

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, vp);

    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'scalar' || node.type === 'motorExp') continue;
      const val = values[id];
      if (val == null) continue;
      const color   = colorMap[id] ?? '#ffffff';
      const hovered = id === hoveredId;

      if (node.type === 'joinLine') {
        drawLine(ctx, val, node.label, color, vp);
      } else if (node.type === 'vector') {
        const pos = vectorPositions[id] ?? { x: 0, y: 0, linked: false };
        drawVector(ctx, val.vx, val.vy, pos.x, pos.y, node.label, color, vp, hovered, pos.linked);
      } else if (node.type === 'motorApply') {
        // Result type depends on what was transformed — detect from value
        const eu = toEuclidean(val);
        if (eu) {
          drawPoint(ctx, eu.x, eu.y, node.label, color, vp, hovered);
        } else if (lineBaseAndDir(val)) {
          drawLine(ctx, val, node.label, color, vp);
        }
      } else {
        const eu = toEuclidean(val);
        if (eu) drawPoint(ctx, eu.x, eu.y, node.label, color, vp, hovered);
      }
    }
  });

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ display: 'block', borderRadius: 8, boxShadow: '0 0 0 1px #313244', cursor }}
    />
  );
}
