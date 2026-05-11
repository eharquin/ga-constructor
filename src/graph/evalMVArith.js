// General multivector arithmetic expression evaluator.
// Supports: +, -, *, /, ^(wedge), &(Vee), unary -(neg), !(dual), ~(reverse),
//           parentheses, named nodes, and built-in basis blades.
// Basis blades (e0, e1, e2, e01, e02, e12, e012) are always available without being deps.

import { PGA, idealPoint, dualOp, reverseOp } from '../pga.js';

// ─── Built-in basis blade environment ────────────────────────────────────────

const BLADE_NAMES = new Set(['e0', 'e1', 'e2', 'e01', 'e02', 'e12', 'e012']);
// Canonical blade → PGA array index
const BLADE_INDEX = { e0: 1, e1: 2, e2: 3, e01: 4, e02: 5, e12: 6, e012: 7 };

// Parse any permutation of PGA(2,0,1) basis indices.
// Returns { index, sign } where sign = ±1 (parity of the permutation),
// or null for invalid / unrecognised names.
// Examples: e12→{6,+1}, e21→{6,-1}, e102→{7,-1}, e120→{7,+1}
function parseBladeName(name) {
  if (!name || !name.startsWith('e')) return null;
  const digits = name.slice(1).split('').map(Number);
  if (digits.some(d => isNaN(d) || d < 0 || d > 2)) return null;
  if (new Set(digits).size !== digits.length) return null; // repeated index
  let inv = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j < digits.length; j++)
      if (digits[i] > digits[j]) inv++;
  const canonical = 'e' + [...digits].sort((a, b) => a - b).join('');
  const index = BLADE_INDEX[canonical];
  return index !== undefined ? { index, sign: inv % 2 === 0 ? 1 : -1 } : null;
}

// Names reserved as built-in functions — excluded from dep extraction.
const BUILTIN_FN_NAMES = new Set(['sqrt', 'abs']);

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
    if (c === '>' && str[i+1] === '>' && str[i+2] === '>') { raw.push({ type: 'op', val: '>>>' }); i += 3; continue; }
    if ('+-*/()!~^&|.§'.includes(c)) { raw.push({ type: 'op', val: c }); i++; continue; }
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
    const rightBar  = next.type === 'op' && next.val === '|';
    if ((leftNum || leftClose) && (rightOpen || rightId || rightNum || rightBar)) tokens.push(MUL);
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

  const BINARY_OPS = new Set(['*', '/', '^', '&', '|', '§', '>>>']);

  function term() {
    if (!factor()) return false;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || !BINARY_OPS.has(t.val)) break;
      eat();
      if (!factor()) return false;
    }
    return true;
  }

  function factor() {
    const t = peek();
    if (!t) return false;
    if (t.type === 'op' && (t.val === '-' || t.val === '+' || t.val === '!' || t.val === '~')) { eat(); return factor(); }
    if (t.type === 'op' && t.val === '(') {
      eat();
      if (!expr()) return false;
      if (!peek() || peek().type !== 'op' || peek().val !== ')') return false;
      eat();
      return true;
    }
    if (t.type === 'op' && t.val === '|') {
      eat();
      if (!expr()) return false;
      if (!peek() || peek().type !== 'op' || peek().val !== '|') return false;
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
      } else if (peek()?.type === 'op' && peek()?.val === '.') {
        eat(); // consume '.'
        const blade = peek();
        if (!blade || blade.type !== 'id' || !parseBladeName(blade.val)) return false;
        eat(); // consume blade name
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
    if (t.type === 'id' && !parseBladeName(t.val) && !BUILTIN_FN_NAMES.has(t.val) && !seen.has(t.val)) {
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

// Absolute value: plain number → Math.abs; grade-0 PGA scalar → Math.abs(val[0]).
function applyAbs(val) {
  if (val === null) return null;
  if (typeof val === 'number') return Math.abs(val);
  const mv = toMV(val);
  if (!mv) return null;
  if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
    const r = new PGA(8); r[0] = Math.abs(mv[0]); return r;
  }
  return null; // not a scalar — abs not defined
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
  if (op === '^') return PGA.Wedge(toMV(left), toMV(right));
  if (op === '&') return PGA.Vee(toMV(left), toMV(right));
  if (op === '|') return PGA.LDot(toMV(left), toMV(right));
  if (op === '§') {
    const a = toMV(left), b = toMV(right);
    if (!a || !b) return null;
    const ab = PGA.Mul(a, b), ba = PGA.Mul(b, a);
    const r = new PGA(8);
    for (let i = 0; i < 8; i++) r[i] = ((ab[i] || 0) - (ba[i] || 0)) / 2;
    return r;
  }
  if (op === '>>>') {
    const M = toMV(left), A = toMV(right);
    if (!M || !A) return null;
    return PGA.Mul(PGA.Mul(M, A), reverseOp(M));
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

  const EVAL_BINARY_OPS = new Set(['*', '/', '^', '&', '|', '§', '>>>']);

  function parseTerm() {
    let left = parseFactor();
    if (left === null) return null;
    while (pos < tokens.length) {
      const t = peek();
      if (t?.type !== 'op' || !EVAL_BINARY_OPS.has(t.val)) break;
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
    if (t.type === 'op' && t.val === '!') {
      eat();
      const v = parseFactor();
      if (v === null) return null;
      const mv = toMV(v); return mv ? dualOp(mv) : null;
    }
    if (t.type === 'op' && t.val === '~') {
      eat();
      const v = parseFactor();
      if (v === null) return null;
      const mv = toMV(v); return mv ? reverseOp(mv) : null;
    }
    if (t.type === 'op' && t.val === '(') {
      eat();
      const v = parseExpr();
      if (!peek() || peek().val !== ')') return null;
      eat();
      return v;
    }
    if (t.type === 'op' && t.val === '|') {
      eat();
      const v = parseExpr();
      if (!peek() || peek().val !== '|') return null;
      eat();
      return applyAbs(v);
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
        if (t.val === 'abs') return applyAbs(arg);
        if (t.val === 'sqrt') {
          if (typeof arg === 'number') return Math.sqrt(arg);
          const mv = toMV(arg);
          if (!mv) return null;
          // Pure grade-0 scalar: Math.sqrt of the scalar component
          if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
            const r = new PGA(8); r[0] = Math.sqrt(mv[0]); return r;
          }
          // Motor (even-grade): PGA.Sqrt for the geometric square root.
          // Normalise sign first: M and -M represent the same motor (double cover).
          const normalised = (mv[0] || 0) < -1e-10 ? scaleMV(mv, -1) : mv;
          return PGA.Sqrt(normalised);
        }
        return null;
      }
      // id.blade — extract a single coefficient as a plain number (supports permuted blades)
      if (peek()?.type === 'op' && peek()?.val === '.') {
        eat(); // consume '.'
        const blade = peek();
        if (!blade || blade.type !== 'id') return null;
        const b = parseBladeName(blade.val);
        if (!b) return null;
        eat(); // consume blade name
        const mv = toMV(fullEnv[t.val]);
        return mv ? b.sign * (mv[b.index] ?? 0) : null;
      }
      const v = fullEnv[t.val];
      if (v !== undefined) return v;
      // Reversed blade as standalone value (e.g. e21 = -e12)
      const b = parseBladeName(t.val);
      if (b) { const mv = new PGA(8); mv[b.index] = b.sign; return mv; }
      return null;
    }
    return null;
  }

  return parseExpr();
}
