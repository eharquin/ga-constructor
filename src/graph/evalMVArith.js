// General multivector arithmetic expression evaluator.
// Supports: +, -, *, /, unary -, parentheses, named nodes, and built-in basis blades.
// Basis blades (e0, e1, e2, e01, e02, e12, e012) are always available without being deps.

import { PGA, idealPoint } from '../pga.js';

// ─── Built-in basis blade environment ────────────────────────────────────────

const BLADE_NAMES = new Set(['e0', 'e1', 'e2', 'e01', 'e02', 'e12', 'e012']);

// Names reserved as built-in functions — excluded from dep extraction.
const BUILTIN_FN_NAMES = new Set(['sqrt']);

const BASIS_ENV = (() => {
  const pairs = [
    ['e0', 1], ['e1', 2], ['e2', 3],
    ['e01', 4], ['e02', 5], ['e12', 6], ['e012', 7],
  ];
  const env = {};
  for (const [name, idx] of pairs) {
    const mv = new PGA(8);
    mv[idx] = 1;
    env[name] = mv;
  }
  return env;
})();

// ─── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(str) {
  const raw = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(str[i + 1] ?? ''))) {
      let num = '';
      while (i < str.length && /[0-9.]/.test(str[i])) num += str[i++];
      raw.push({ type: 'num', val: parseFloat(num) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let id = '';
      while (i < str.length && /[A-Za-z0-9_]/.test(str[i])) id += str[i++];
      raw.push({ type: 'id', val: id });
      continue;
    }
    if ('+-*/()'.includes(c)) { raw.push({ type: 'op', val: c }); i++; continue; }
    return null; // unrecognized character
  }

  // Insert implicit * for juxtaposition: 5(...), 5e1, )(, )id
  const MUL = { type: 'op', val: '*' };
  const tokens = [];
  for (let j = 0; j < raw.length; j++) {
    tokens.push(raw[j]);
    const curr = raw[j], next = raw[j + 1];
    if (!next) continue;
    const leftNum  = curr.type === 'num';
    const leftClose = curr.type === 'op' && curr.val === ')';
    const rightOpen = next.type === 'op' && next.val === '(';
    const rightId   = next.type === 'id';
    const rightNum  = next.type === 'num';
    if ((leftNum || leftClose) && (rightOpen || rightId || rightNum)) tokens.push(MUL);
  }
  return tokens;
}

// ─── Syntax validator ─────────────────────────────────────────────────────────

function validate(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat  = () => tokens[pos++];

  function expr() {
    if (!term()) return false;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || (t.val !== '+' && t.val !== '-')) break;
      eat();
      if (!term()) return false;
    }
    return true;
  }

  function term() {
    if (!factor()) return false;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || (t.val !== '*' && t.val !== '/')) break;
      eat();
      if (!factor()) return false;
    }
    return true;
  }

  function factor() {
    const t = peek();
    if (!t) return false;
    if (t.type === 'op' && (t.val === '-' || t.val === '+')) { eat(); return factor(); }
    if (t.type === 'op' && t.val === '(') {
      eat();
      if (!expr()) return false;
      if (!peek() || peek().type !== 'op' || peek().val !== ')') return false;
      eat();
      return true;
    }
    if (t.type === 'num') { eat(); return true; }
    if (t.type === 'id') {
      eat();
      if (BUILTIN_FN_NAMES.has(t.val)) {
        if (!peek() || peek().type !== 'op' || peek().val !== '(') return false;
        eat();
        if (!expr()) return false;
        if (!peek() || peek().type !== 'op' || peek().val !== ')') return false;
        eat();
      }
      return true;
    }
    return false;
  }

  return expr() && pos === tokens.length;
}

// ─── Public: extract user-defined deps ───────────────────────────────────────

// Returns ordered unique dep names (excludes built-in blade names), or null if invalid syntax.
export function extractMVDeps(str) {
  const tokens = tokenize(str.trim());
  if (!tokens || !validate(tokens)) return null;
  const seen = new Set();
  const deps = [];
  for (const t of tokens) {
    if (t.type === 'id' && !BLADE_NAMES.has(t.val) && !BUILTIN_FN_NAMES.has(t.val) && !seen.has(t.val)) {
      seen.add(t.val);
      deps.push(t.val);
    }
  }
  return deps;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function toMV(val) {
  if (val == null) return null;
  if (typeof val === 'number') { const mv = new PGA(8); mv[0] = val; return mv; }
  if (typeof val === 'object' && 'vx' in val) return idealPoint(val.vx, val.vy);
  return val;
}

function negateVal(val) {
  if (typeof val === 'number') return -val;
  if (typeof val === 'object' && 'vx' in val) return { vx: -val.vx, vy: -val.vy };
  const r = new PGA(8);
  for (let i = 0; i < 8; i++) r[i] = -(val[i] || 0);
  return r;
}

function scaleMV(mv, s) {
  if (!mv) return null;
  const r = new PGA(8);
  for (let i = 0; i < 8; i++) r[i] = (mv[i] || 0) * s;
  return r;
}

function applyOp(left, op, right) {
  if (left === null || right === null) return null;
  const lNum = typeof left  === 'number';
  const rNum = typeof right === 'number';

  if (lNum && rNum) {
    if (op === '+') return left + right;
    if (op === '-') return left - right;
    if (op === '*') return left * right;
    if (op === '/') return right !== 0 ? left / right : null;
  }

  if (op === '+' || op === '-') {
    const a = toMV(left), b = toMV(right);
    if (!a || !b) return null;
    const r = new PGA(8);
    for (let i = 0; i < 8; i++)
      r[i] = op === '+' ? (a[i] || 0) + (b[i] || 0) : (a[i] || 0) - (b[i] || 0);
    return r;
  }
  if (op === '*') {
    if (lNum) return scaleMV(toMV(right), left);
    if (rNum) return scaleMV(toMV(left), right);
    return PGA.Mul(toMV(left), toMV(right));
  }
  if (op === '/') {
    if (rNum && right !== 0) return scaleMV(toMV(left), 1 / right);
    return null;
  }
  return null;
}

// Evaluate an expression string.
// env: { name → number | PGA element | {vx, vy} }  (user-defined node values)
// Basis blades are available implicitly; env values take priority over blades.
export function evalMVArith(str, env) {
  const tokens = tokenize(str.trim());
  if (!tokens) return null;

  const fullEnv = { ...BASIS_ENV, ...env };

  let pos = 0;
  const peek = () => tokens[pos];
  const eat  = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    if (left === null) return null;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || (t.val !== '+' && t.val !== '-')) break;
      const op = eat().val;
      const right = parseTerm();
      if (right === null) return null;
      left = applyOp(left, op, right);
      if (left === null) return null;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    if (left === null) return null;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || (t.val !== '*' && t.val !== '/')) break;
      const op = eat().val;
      const right = parseFactor();
      if (right === null) return null;
      left = applyOp(left, op, right);
      if (left === null) return null;
    }
    return left;
  }

  function parseFactor() {
    const t = peek();
    if (!t) return null;
    if (t.type === 'op' && (t.val === '-' || t.val === '+')) {
      const op = eat().val;
      const v = parseFactor();
      return v === null ? null : (op === '-' ? negateVal(v) : v);
    }
    if (t.type === 'op' && t.val === '(') {
      eat();
      const v = parseExpr();
      if (!peek() || peek().val !== ')') return null;
      eat();
      return v;
    }
    if (t.type === 'num') { eat(); return t.val; }
    if (t.type === 'id') {
      eat();
      if (BUILTIN_FN_NAMES.has(t.val)) {
        if (!peek() || peek().val !== '(') return null;
        eat();
        const arg = parseExpr();
        if (!peek() || peek().val !== ')') return null;
        eat();
        if (arg === null) return null;
        if (t.val === 'sqrt') {
        if (typeof arg === 'number') return Math.sqrt(arg);
        const mv = toMV(arg);
        if (!mv) return null;
        // PGA.Sqrt uses (1+M)/|1+M|. When scalar(M) < 0 (e.g. P*R where e₁₂²=-1
        // makes the scalar part -1), 1+M is nilpotent and the norm is 0 → NaN.
        // In PGA the double cover means M and -M represent the same motion,
        // so we normalise to a positive scalar before computing the sqrt.
        const normalised = (mv[0] || 0) < -1e-10 ? scaleMV(mv, -1) : mv;
        return PGA.Sqrt(normalised);
      }
        return null;
      }
      const v = fullEnv[t.val];
      return v !== undefined ? v : null;
    }
    return null;
  }

  return parseExpr();
}
