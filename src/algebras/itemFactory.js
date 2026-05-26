// Shared graph-item factory. Every item (showcase INITIAL_ITEMS, items created at
// runtime, items loaded from disk) has the same shape; this is the single source
// of those defaults so adapters and useGraph don't each re-declare them.
export const makeItem = (id, text, extra = {}) => ({
  id,
  text,
  color: null,
  anim: null,
  drawPos: null,
  label: null,
  labelOpts: null,
  visible: true,
  movable: true,
  normalizeMode: null,
  ...extra,
});
