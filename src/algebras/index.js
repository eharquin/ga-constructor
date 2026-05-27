// Algebra registry — one entry per supported algebra. Each `spec` conforms to
// the AlgebraSpec interface consumed by parseExpression, evalMVArith, evaluate,
// useGraph, Canvas, and ExpressionPanel.

import pga201 from './pga201/index.js';
import vga200 from './vga200/index.js';
import r010   from './r010/index.js';

export const ALGEBRAS = [pga201, vga200, r010];

export const DEFAULT_ALGEBRA_ID = pga201.id;

export function getAlgebra(id) {
  return ALGEBRAS.find((a) => a.id === id) ?? pga201;
}
