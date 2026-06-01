// Algebra-aware node-type registry factory.
//
// createNodeTypes(algebra, evaluator) returns { [type]: { label, compute } }.
// PGA exposes the full registry (point, line, meet, join, triangle, …);
// VGA exposes only the algebra-agnostic subset (scalar, vector, motorExp,
// motorApply, dual, reverse, multivector, mvExpr, list).
//
// `compute` reads from algebra-bound primitives so the same node types work
// across algebras when their semantics carry over (mvExpr, motorExp, etc.).

import { evalScalar } from './evalExpr.js';

export function createNodeTypes(algebra, evaluator) {
  const { Algebra, arraySize, dualOp, reverseOp, geomToMV } = algebra;
  const expFn = algebra.expFn ?? ((mv) => mv.Exp());
  // PGA-only helpers (null on VGA) — used to guard the PGA-specific nodes.
  const point2D        = algebra.point2D        ?? null;
  const flatPoint2D    = algebra.flatPoint2D    ?? null;
  const vectorMV2D     = algebra.vector2D       ?? null;
  const line2D         = algebra.line2D         ?? null;
  const toEuclidean    = algebra.toEuclidean    ?? null;
  const lineBaseAndDir = algebra.lineBaseAndDir ?? null;
  const { evalMVArith } = evaluator;

  // Promote any value to an algebra MV. Returns null for unconvertible inputs.
  //   number   → grade-0 scalar MV with mv[0] = val
  //   {vx,vy}  → algebra-specific vector promotion via geomToMV
  //   MV array → pass through
  //   anything else → null
  function toMV(val) {
    if (val == null) return null;
    if (typeof val === 'number') {
      const mv = new Algebra(arraySize);
      mv[0] = val;
      return mv;
    }
    if (typeof val === 'object' && 'vx' in val) return geomToMV(val);
    if (typeof val === 'object' && typeof val.length === 'number' && val.length >= arraySize) return val;
    return null;
  }

  // Algebra-scoped scalar evaluator — knows about `.blade` accessors.
  function scalar(expr, scalars) { return evalScalar(expr, scalars, evalMVArith); }

  // Resolve an inline geometric argument to its MV value.
  function resolveInlineGeom(geom, depValues) {
    const local = depValues.slice(geom.depOffset, geom.depOffset + geom.deps.length);
    if (geom.kind === 'ref') return local[0];
    if (geom.kind === 'vector') {
      const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
      const vx = scalar(geom.xExpr, s), vy = scalar(geom.yExpr, s);
      return isNaN(vx) || isNaN(vy) ? null : { vx, vy };
    }
    if (geom.kind === 'point') {
      if (!point2D) return null;
      const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
      const x = scalar(geom.xExpr, s), y = scalar(geom.yExpr, s);
      return isNaN(x) || isNaN(y) ? null : point2D(x, y);
    }
    if (geom.kind === 'mv') {
      const mv = new Algebra(arraySize);
      for (let i = 0; i < arraySize; i++) mv[i] = geom.components[i] || 0;
      if (geom.deps.length && geom.coeffExprs) {
        const s = Object.fromEntries(geom.deps.map((d, i) => [d, local[i]]));
        for (const [idx, expr] of Object.entries(geom.coeffExprs)) mv[+idx] = scalar(expr, s);
      }
      return mv;
    }
    return null;
  }

  function evalCoords(depValues, { xExpr, yExpr, deps }) {
    const scalars = Object.fromEntries((deps ?? []).map((d, i) => [d, depValues[i]]));
    return { vx: scalar(xExpr, scalars), vy: scalar(yExpr, scalars) };
  }

  // ── Algebra-agnostic node types ────────────────────────────────────────
  const types = {
    scalar: {
      label: 'Scalar',
      compute: (_, { value }) => value,
    },

    vector: {
      label: 'Vector',
      compute: (depValues, params) => {
        const { vx, vy } = evalCoords(depValues, params);
        if (isNaN(vx) || isNaN(vy)) return null;
        return { vx, vy };
      },
    },

    motorExp: {
      label: 'Motor',
      compute: (depValues, { exprStr, deps: paramDeps }) => {
        const env = Object.fromEntries((paramDeps ?? []).map((d, i) => [d, depValues[i]]));
        const raw = evalMVArith(exprStr, env);
        if (raw == null) return null;
        // Always copy into a fresh Algebra instance so .Exp() is available
        // regardless of whether the source value is a typed constructor result.
        const expOne = (item) => {
          if (typeof item === 'number') {
            const T = new Algebra(arraySize); T[0] = Math.exp(item); return T;
          }
          const src = (typeof item === 'object' && item && 'vx' in item) ? geomToMV(item) : item;
          if (!src || typeof src.length !== 'number' || src.length < arraySize) return null;
          const mv = new Algebra(arraySize);
          for (let i = 0; i < arraySize; i++) mv[i] = src[i] || 0;
          return expFn(mv);
        };
        if (raw?.list) return { list: true, items: raw.items.map(expOne).filter(Boolean) };
        return expOne(raw);
      },
    },

    motorApply: {
      label: 'Transform',
      compute: (depValues, { geom }) => {
        const T = depValues[0];
        if (!T) return null;
        const raw = geom ? resolveInlineGeom(geom, depValues) : depValues[1];
        const toA = (item) => item && typeof item === 'object' && 'vx' in item ? geomToMV(item) : item;
        // Pairwise: list of motors applied to list of objects (same length).
        if (T?.list && raw?.list) {
          if (T.items.length !== raw.items.length) return null;
          return {
            list: true,
            items: T.items.map((t, i) => {
              const A = toA(raw.items[i]);
              return (t && A) ? Algebra.sw(t, A) : null;
            }).filter(Boolean),
          };
        }
        // Single motor broadcast over a list.
        if (raw?.list) {
          return {
            list: true,
            items: raw.items.map((item) => {
              const A = toA(item);
              return A ? Algebra.sw(T, A) : null;
            }).filter(Boolean),
          };
        }
        const A = toA(raw);
        if (!A) return null;
        return Algebra.sw(T, A);
      },
    },

    color: {
      label: 'Color',
      compute: (depValues, { rExpr, gExpr, bExpr, deps: paramDeps }) => {
        const scalars = Object.fromEntries((paramDeps ?? []).map((d, i) => [d, depValues[i]]));
        const r = scalar(rExpr, scalars);
        const g = scalar(gExpr, scalars);
        const b = scalar(bExpr, scalars);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        // Auto-detect 0–1 vs 0–255: if any channel > 1, treat all as 0–255.
        const is255 = r > 1 || g > 1 || b > 1;
        const norm = (v) => (is255 ? v : v * 255);
        const clamp = (v) => Math.max(0, Math.min(255, Math.round(norm(v))));
        const toHex = (v) => clamp(v).toString(16).padStart(2, '0');
        return { color: `#${toHex(r)}${toHex(g)}${toHex(b)}`, r, g, b };
      },
    },

    list: {
      label: 'List',
      compute: (depValues, { geoms }) => {
        const items = geoms.map((g) => resolveInlineGeom(g, depValues));
        if (items.some((v) => v == null)) return null;
        return { list: true, items };
      },
    },

    multivector: {
      label: 'Multivector',
      compute: (depValues, { components, dual, deps: paramDeps, coeffExprs }) => {
        const mv = new Algebra(arraySize);
        for (let i = 0; i < arraySize; i++) mv[i] = components[i] || 0;
        if (paramDeps?.length && coeffExprs) {
          const scalars = Object.fromEntries(paramDeps.map((d, i) => [d, depValues[i]]));
          for (const [idxStr, expr] of Object.entries(coeffExprs)) {
            const idx = +idxStr;
            const varRef = expr.match(/^(-?)([A-Za-z_][A-Za-z0-9_]*)$/);
            const depVal = varRef ? scalars[varRef[2]] : null;
            if (depVal != null && typeof depVal !== 'number') {
              const sign = varRef[1] === '-' ? -1 : 1;
              const left = (typeof depVal === 'object' && 'vx' in depVal) ? geomToMV(depVal) : depVal;
              const blade = new Algebra(arraySize); blade[idx] = sign;
              const prod = Algebra.Mul(left, blade);
              for (let i = 0; i < arraySize; i++) mv[i] = (mv[i] || 0) + (prod[i] || 0);
            } else {
              mv[idx] = scalar(expr, scalars);
            }
          }
        }
        return dual ? dualOp(mv) : mv;
      },
    },

    mvExpr: {
      label: 'MV Expression',
      compute: (depValues, { exprStr, deps: paramDeps }) => {
        if (!paramDeps) return null;
        const env = Object.fromEntries(paramDeps.map((d, i) => [d, depValues[i]]));
        return evalMVArith(exprStr, env);
      },
    },

    funcDef: {
      label: 'Function definition',
      compute: (depValues, { paramNames, body, captureDeps }) => ({
        kind: 'function',
        paramNames,
        body,
        capturedEnv: Object.fromEntries((captureDeps ?? []).map((d, i) => [d, depValues[i]])),
      }),
    },

    dual: {
      label: 'Dual',
      compute: ([val]) => {
        if (val?.list) return { list: true, items: val.items.map((v) => { const mv = toMV(v); return mv ? dualOp(mv) : null; }).filter(Boolean) };
        const mv = toMV(val);
        return mv ? dualOp(mv) : null;
      },
    },

    reverse: {
      label: 'Reverse',
      compute: ([val]) => {
        if (val?.list) return { list: true, items: val.items.map((v) => { const mv = toMV(v); return mv ? reverseOp(mv) : null; }).filter(Boolean) };
        const mv = toMV(val);
        return mv ? reverseOp(mv) : null;
      },
    },
  };

  // ── PGA-only node types (require point2D / line2D / projective Vee) ────
  if (point2D) {
    types.freePoint = {
      label: 'Free Point',
      compute: (depValues, params) => {
        const { vx: cx, vy: cy } = evalCoords(depValues, params);
        if (isNaN(cx) || isNaN(cy)) return null;
        if (params.zExpr !== undefined) {
          const scalars = Object.fromEntries((params.deps ?? []).map((d, i) => [d, depValues[i]]));
          const cz = scalar(params.zExpr, scalars);
          if (isNaN(cz)) return null;
          return point2D(cx, cy, cz);
        }
        return point2D(cx, cy);
      },
    };
  }
  if (flatPoint2D) {
    types.freeFlatPoint = {
      label: 'Flat Point',
      compute: (depValues, params) => {
        const { vx: cx, vy: cy } = evalCoords(depValues, params);
        if (isNaN(cx) || isNaN(cy)) return null;
        return flatPoint2D(cx, cy);
      },
    };
  }
  // CGA ideal round point: vector(x, y[, r]) → MV value, rendered as an arrow.
  if (vectorMV2D) {
    types.freeVector = {
      label: 'Vector',
      compute: (depValues, params) => {
        const { vx: cx, vy: cy } = evalCoords(depValues, params);
        if (isNaN(cx) || isNaN(cy)) return null;
        if (params.rExpr !== undefined) {
          const scalars = Object.fromEntries((params.deps ?? []).map((d, i) => [d, depValues[i]]));
          const cr = scalar(params.rExpr, scalars);
          if (isNaN(cr)) return null;
          return vectorMV2D(cx, cy, cr);
        }
        return vectorMV2D(cx, cy);
      },
    };
  }

  if (line2D) {
    types.freeLine = {
      label: 'Free Line',
      compute: (depValues, { aExpr, bExpr, cExpr, deps }) => {
        const scalars = Object.fromEntries((deps ?? []).map((d, i) => [d, depValues[i]]));
        const a = scalar(aExpr, scalars);
        const b = scalar(bExpr, scalars);
        const c = scalar(cExpr, scalars);
        if (isNaN(a) || isNaN(b) || isNaN(c)) return null;
        return line2D(a, b, c);
      },
    };
  }
  // Helper: apply a two-argument GA operation, broadcasting over any list operand.
  const listBinOp = (a, b, fn) => {
    if (!a || !b) return null;
    if (a?.list && b?.list) {
      if (a.items.length !== b.items.length) return null;
      return { list: true, items: a.items.map((av, i) => fn(av, b.items[i])).filter(Boolean) };
    }
    if (a?.list) return { list: true, items: a.items.map((av) => fn(av, b)).filter(Boolean) };
    if (b?.list) return { list: true, items: b.items.map((bv) => fn(a, bv)).filter(Boolean) };
    return fn(a, b);
  };

  if (typeof Algebra.Vee === 'function') {
    types.joinLine = {
      label: 'Line A ∧ B',
      compute: (depValues, { geom1, geom2 }) => {
        const P1 = geom1 ? resolveInlineGeom(geom1, depValues) : depValues[0];
        const P2 = geom2 ? resolveInlineGeom(geom2, depValues) : depValues[1];
        return listBinOp(P1, P2, (a, b) => { const ma = toMV(a), mb = toMV(b); return ma && mb ? Algebra.Vee(ma, mb) : null; });
      },
    };
    types.meetPoint = {
      label: 'Meet L₁ ∧ L₂',
      compute: (depValues, { geom1, geom2 }) => {
        const L1 = geom1 ? resolveInlineGeom(geom1, depValues) : depValues[0];
        const L2 = geom2 ? resolveInlineGeom(geom2, depValues) : depValues[1];
        return listBinOp(L1, L2, (a, b) => { const ma = toMV(a), mb = toMV(b); return ma && mb ? Algebra.Wedge(ma, mb) : null; });
      },
    };
    types.meetChain = {
      label: 'Meet L₁ ∧ … ∧ Lₙ',
      compute: (depValues, { geoms }) => {
        let result = toMV(resolveInlineGeom(geoms[0], depValues));
        for (let i = 1; i < geoms.length; i++) {
          const next = resolveInlineGeom(geoms[i], depValues);
          if (!next) return null;
          result = Algebra.Wedge(result, toMV(next));
        }
        return result;
      },
    };
  }
  if (toEuclidean) {
    types.triangle = {
      label: 'Triangle',
      compute: (depValues, { geom1, geom2, geom3 }) => {
        const P1 = resolveInlineGeom(geom1, depValues);
        const P2 = resolveInlineGeom(geom2, depValues);
        const P3 = resolveInlineGeom(geom3, depValues);
        if (!P1 || !P2 || !P3) return null;
        const eu1 = toEuclidean(toMV(P1));
        const eu2 = toEuclidean(toMV(P2));
        const eu3 = toEuclidean(toMV(P3));
        if (!eu1 || !eu2 || !eu3) return null;
        return (eu2.x - eu1.x) * (eu3.y - eu1.y) - (eu3.x - eu1.x) * (eu2.y - eu1.y);
      },
    };
    types.pointOnLine = {
      label: 'Point on Line',
      compute: ([L], { t }) => {
        if (!lineBaseAndDir) return null;
        const bd = lineBaseAndDir(L);
        return bd ? point2D(bd.bx + t * bd.ux, bd.by + t * bd.uy) : null;
      },
    };
  }

  return types;
}
