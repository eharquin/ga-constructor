// General multivector arithmetic expression evaluator — algebra-parameterised.
// Returns a tokenizer + validator + evaluator + dep extractor pre-bound to one
// algebra spec. Each algebra adapter calls createEvalMVArith(spec) to get its
// own evaluator closed over the right basis / Algebra instance / GA primitives.
//
// Supports: +, -, *, /, ^ (wedge), & (Vee), unary -(neg), ! (dual), ~ (reverse),
// parens, named nodes, scalar / trig built-ins, and basis blades.

// ─── Built-in scalar functions ───────────────────────────────────────────────

const BUILTIN_FN_NAMES = new Set([
  'sqrt', 'abs',
  'sin', 'cos', 'tan', 'csc', 'sec', 'cot',
  'asin', 'acos', 'atan', 'acsc', 'asec', 'acot',
]);

const TRIG_FNS = {
  sin:  Math.sin,
  cos:  Math.cos,
  tan:  Math.tan,
  csc:  (x) => 1 / Math.sin(x),
  sec:  (x) => 1 / Math.cos(x),
  cot:  (x) => Math.cos(x) / Math.sin(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  acsc: (x) => Math.asin(1 / x),
  asec: (x) => Math.acos(1 / x),
  acot: (x) => Math.PI / 2 - Math.atan(x),
};

// ─── Factory ────────────────────────────────────────────────────────────────

export function createEvalMVArith(algebra) {
  const { Algebra, arraySize, bladeIndex, parseBladeName, dualOp, reverseOp, geomToMV } = algebra;

  const BLADE_NAMES = new Set(Object.keys(bladeIndex).filter((n) => n !== '1'));

  // Pre-build a small env of basis-blade MVs so they're resolvable as bare ids.
  const BASIS_ENV = (() => {
    const env = {};
    for (const [name, idx] of Object.entries(bladeIndex)) {
      if (name === '1') continue;
      const mv = new Algebra(arraySize);
      mv[idx] = 1;
      env[name] = mv;
    }
    return env;
  })();

  // ── Tokenizer ──────────────────────────────────────────────────────────
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
      return null;
    }

    const MUL = { type: 'op', val: '*' };
    const tokens = [];
    for (let j = 0; j < raw.length; j++) {
      tokens.push(raw[j]);
      const curr = raw[j], next = raw[j + 1];
      if (!next) continue;
      const leftNum   = curr.type === 'num';
      const leftClose = curr.type === 'op' && curr.val === ')';
      const rightOpen = next.type === 'op' && next.val === '(';
      const rightId   = next.type === 'id';
      const rightNum  = next.type === 'num';
      const rightBar  = next.type === 'op' && next.val === '|';
      if ((leftNum || leftClose) && (rightOpen || rightId || rightNum || rightBar)) tokens.push(MUL);
    }
    return tokens;
  }

  // ── Syntax validator ──────────────────────────────────────────────────
  // Precedence (tight → loose):
  //   factor  — unary ! ~ - +, atoms, abs |…|, parens, function calls
  //   grade   — ^ & | §          (grade products)
  //   prod    — * /               (geometric product / scalar div)
  //   sandwich — >>>              (sandwich transform)
  //   expr    — + -               (additive)
  function validate(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const eat  = () => tokens[pos++];

    function expr() {
      if (!sandwich()) return false;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || (t.val !== '+' && t.val !== '-')) break;
        eat();
        if (!sandwich()) return false;
      }
      return true;
    }

    function sandwich() {
      if (!prod()) return false;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || t.val !== '>>>') break;
        eat();
        if (!prod()) return false;
      }
      return true;
    }

    function prod() {
      if (!grade()) return false;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || (t.val !== '*' && t.val !== '/')) break;
        eat();
        if (!grade()) return false;
      }
      return true;
    }

    const GRADE_OPS = new Set(['^', '&', '|', '§']);

    function grade() {
      if (!factor()) return false;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || !GRADE_OPS.has(t.val)) break;
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
          eat();
          const blade = peek();
          if (!blade || blade.type !== 'id' || !parseBladeName(blade.val)) return false;
          eat();
        }
        return true;
      }
      return false;
    }

    return expr() && pos === tokens.length;
  }

  // ── Dep extraction ─────────────────────────────────────────────────────
  function extractMVDeps(str) {
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

  // ── Value helpers ──────────────────────────────────────────────────────
  function toMV(val) {
    if (val == null) return null;
    if (typeof val === 'number') { const mv = new Algebra(arraySize); mv[0] = val; return mv; }
    if (typeof val === 'object' && 'vx' in val) return geomToMV(val);
    return val;
  }
  function negateVal(val) {
    if (typeof val === 'number') return -val;
    if (typeof val === 'object' && 'vx' in val) return { vx: -val.vx, vy: -val.vy };
    const r = new Algebra(arraySize);
    for (let i = 0; i < arraySize; i++) r[i] = -(val[i] || 0);
    return r;
  }
  function scaleMV(mv, s) {
    if (!mv) return null;
    const r = new Algebra(arraySize);
    for (let i = 0; i < arraySize; i++) r[i] = (mv[i] || 0) * s;
    return r;
  }
  function applyAbs(val) {
    if (val === null) return null;
    if (typeof val === 'number') return Math.abs(val);
    const mv = toMV(val);
    if (!mv) return null;
    if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
      const r = new Algebra(arraySize); r[0] = Math.abs(mv[0]); return r;
    }
    return null;
  }
  function applyScalarFn(fn, val) {
    if (val === null) return null;
    if (typeof val === 'number') return fn(val);
    const mv = toMV(val);
    if (!mv) return null;
    if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
      const r = new Algebra(arraySize); r[0] = fn(mv[0]); return r;
    }
    return null;
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
      const r = new Algebra(arraySize);
      for (let i = 0; i < arraySize; i++)
        r[i] = op === '+' ? (a[i] || 0) + (b[i] || 0) : (a[i] || 0) - (b[i] || 0);
      return r;
    }
    if (op === '*') {
      if (lNum) return scaleMV(toMV(right), left);
      if (rNum) return scaleMV(toMV(left), right);
      return Algebra.Mul(toMV(left), toMV(right));
    }
    if (op === '/') {
      if (rNum && right !== 0) return scaleMV(toMV(left), 1 / right);
      return null;
    }
    if (op === '^') return Algebra.Wedge(toMV(left), toMV(right));
    if (op === '&') {
      if (typeof Algebra.Vee !== 'function') return null;
      return Algebra.Vee(toMV(left), toMV(right));
    }
    if (op === '|') return Algebra.LDot(toMV(left), toMV(right));
    if (op === '§') {
      const a = toMV(left), b = toMV(right);
      if (!a || !b) return null;
      const ab = Algebra.Mul(a, b), ba = Algebra.Mul(b, a);
      const r = new Algebra(arraySize);
      for (let i = 0; i < arraySize; i++) r[i] = ((ab[i] || 0) - (ba[i] || 0)) / 2;
      return r;
    }
    if (op === '>>>') {
      const M = toMV(left), A = toMV(right);
      if (!M || !A) return null;
      return Algebra.sw(M, A);
    }
    return null;
  }

  // ── Expression evaluator ───────────────────────────────────────────────
  function evalMVArith(str, env) {
    const tokens = tokenize(str.trim());
    if (!tokens) return null;

    const fullEnv = { ...BASIS_ENV, ...env };
    let pos = 0;
    const peek = () => tokens[pos];
    const eat  = () => tokens[pos++];

    // Precedence ladder (tight → loose): grade > prod > sandwich > expr
    function parseExpr() {
      let left = parseSandwich();
      if (left === null) return null;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || (t.val !== '+' && t.val !== '-')) break;
        const op = eat().val;
        const right = parseSandwich();
        if (right === null) return null;
        left = applyOp(left, op, right);
        if (left === null) return null;
      }
      return left;
    }

    function parseSandwich() {
      let left = parseProd();
      if (left === null) return null;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || t.val !== '>>>') break;
        const op = eat().val;
        const right = parseProd();
        if (right === null) return null;
        left = applyOp(left, op, right);
        if (left === null) return null;
      }
      return left;
    }

    function parseProd() {
      let left = parseGrade();
      if (left === null) return null;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || (t.val !== '*' && t.val !== '/')) break;
        const op = eat().val;
        const right = parseGrade();
        if (right === null) return null;
        left = applyOp(left, op, right);
        if (left === null) return null;
      }
      return left;
    }

    const GRADE_OPS = new Set(['^', '&', '|', '§']);

    function parseGrade() {
      let left = parseFactor();
      if (left === null) return null;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || !GRADE_OPS.has(t.val)) break;
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
          if (TRIG_FNS[t.val]) return applyScalarFn(TRIG_FNS[t.val], arg);
          if (t.val === 'sqrt') {
            if (typeof arg === 'number') return Math.sqrt(arg);
            const mv = toMV(arg);
            if (!mv) return null;
            if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
              const r = new Algebra(arraySize); r[0] = Math.sqrt(mv[0]); return r;
            }
            // Motor sqrt via Log/half/Exp (sign-normalised).
            const normalised = (mv[0] || 0) < -1e-10 ? scaleMV(mv, -1) : mv;
            const log = normalised.Log();
            const half = new Algebra(arraySize);
            for (let i = 0; i < arraySize; i++) half[i] = (log[i] || 0) * 0.5;
            return half.Exp();
          }
          return null;
        }
        if (peek()?.type === 'op' && peek()?.val === '.') {
          eat();
          const blade = peek();
          if (!blade || blade.type !== 'id') return null;
          const b = parseBladeName(blade.val);
          if (!b) return null;
          eat();
          const mv = toMV(fullEnv[t.val]);
          return mv ? b.sign * (mv[b.index] ?? 0) : null;
        }
        const v = fullEnv[t.val];
        if (v !== undefined) return v;
        const b = parseBladeName(t.val);
        if (b) { const mv = new Algebra(arraySize); mv[b.index] = b.sign; return mv; }
        return null;
      }
      return null;
    }

    return parseExpr();
  }

  return { evalMVArith, extractMVDeps, parseBladeName, BLADE_NAMES };
}
