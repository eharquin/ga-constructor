// Shared color resolution. The panel vignette and the canvas object color must
// always agree, so both go through this one function.

export const FALLBACK_COLOR = '#6c7086';

// Resolve the display color for a computed value under an algebra.
// Precedence: list → vector-like → classifyMV kind → parser-type fallback.
// (An explicit per-item color override is handled by the caller, before this.)
export function resolveKindColor(val, algebra, nodeType) {
  const KIND_COLOR = algebra.KIND_COLOR ?? {};
  const TYPE_COLOR_FALLBACK = algebra.TYPE_COLOR_FALLBACK ?? {};
  if (val?.list) return KIND_COLOR.list ?? KIND_COLOR.triangle ?? FALLBACK_COLOR;
  if (val && typeof val === 'object' && 'vx' in val)
    return KIND_COLOR.vector ?? KIND_COLOR.idealPoint ?? FALLBACK_COLOR;
  const cls = algebra.classifyMV(val);
  return cls ? (KIND_COLOR[cls.kind] ?? FALLBACK_COLOR) : (TYPE_COLOR_FALLBACK[nodeType] ?? FALLBACK_COLOR);
}
