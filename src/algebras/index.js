// Algebra registry — one entry per supported algebra. Each `spec` conforms to
// the AlgebraSpec interface consumed by parseExpression, evalMVArith, evaluate,
// useGraph, Canvas, and ExpressionPanel.

import pga201 from './pga201/index.js';
import vga200 from './vga200/index.js';
import r010   from './r010/index.js';
import cga310 from './cga310/index.js';
import ccga   from './ccga/index.js';
import acga from './acga/index.js';

export const ALGEBRAS = [pga201, vga200, r010, cga310, ccga, acga];

export const DEFAULT_ALGEBRA_ID = pga201.id;

export function getAlgebra(id) {
  return ALGEBRAS.find((a) => a.id === id) ?? pga201;
}
