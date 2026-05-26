// Algebra registry — one entry per supported algebra. Each `spec` conforms to
// the AlgebraSpec interface consumed by parseExpression, evalMVArith, evaluate,
// useGraph, Canvas, and ExpressionPanel.

import pga201 from './pga201/index.js';
import vga200 from './vga200/index.js';
import { missingSpecFields } from './spec.js';

export const ALGEBRAS = [pga201, vga200];

// Dev-time guard: warn if a registered algebra is missing required spec fields.
if (import.meta.env?.DEV) {
  for (const a of ALGEBRAS) {
    const missing = missingSpecFields(a);
    if (missing.length) console.warn(`[algebra:${a.id}] missing spec fields: ${missing.join(', ')}`);
  }
}

export const DEFAULT_ALGEBRA_ID = pga201.id;

export function getAlgebra(id) {
  return ALGEBRAS.find((a) => a.id === id) ?? pga201;
}
