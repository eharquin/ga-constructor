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
  const { Algebra, arraySize, bladeIndex, parseBladeName, dualOp, reverseOp, geomToMV, classifyMV } = algebra;

  const BLADE_NAMES = new Set(Object.keys(bladeIndex).filter((n) => n !== '1'));

  // Property names accepted after '.' that are not blade names.
  const PROP_NAMES = new Set(['norm', 'inorm']);

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

    // absDepth > 0 while parsing inside |…| — prevents the closing | from
    // being consumed as a binary inner-product by grade().
    let absDepth = 0;

    const GRADE_OPS = new Set(['^', '&', '|', '§']);

    function grade() {
      if (!factor()) return false;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || !GRADE_OPS.has(t.val)) break;
        if (t.val === '|' && absDepth > 0) break; // closing | of |…| — stop here
        eat();
        if (!factor()) return false;
      }
      return true;
    }

    // Parse one primary (no postfix), then consume any trailing .prop chains.
    function factor() {
      const t = peek();
      if (!t) return false;
      // Unary ops delegate entirely to a nested factor (postfix handled inside).
      if (t.type === 'op' && (t.val === '-' || t.val === '+' || t.val === '!' || t.val === '~')) { eat(); return factor(); }
      if (!primary()) return false;
      // Postfix: .norm / .inorm / .bladename (allow chains e.g. (A^B).norm)
      while (peek()?.type === 'op' && peek()?.val === '.') {
        eat();
        const prop = peek();
        if (!prop || prop.type !== 'id') return false;
        if (!PROP_NAMES.has(prop.val) && !parseBladeName(prop.val)) return false;
        eat();
      }
      return true;
    }

    function primary() {
      const t = peek();
      if (!t) return false;
      if (t.type === 'op' && t.val === '(') {
        eat();
        if (!expr()) return false;
        if (!peek() || peek().type !== 'op' || peek().val !== ')') return false;
        eat();
        return true;
      }
      if (t.type === 'op' && t.val === '|') {
        eat();
        absDepth++;
        const ok = expr();
        absDepth--;
        if (!ok) return false;
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
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const afterDot = i > 0 && tokens[i - 1].type === 'op' && tokens[i - 1].val === '.';
      if (t.type === 'id' && !afterDot && !parseBladeName(t.val) && !BUILTIN_FN_NAMES.has(t.val) && !seen.has(t.val)) {
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
  function lenToNumber(len) {
    return Math.abs(typeof len === 'number' ? len : (len?.[0] ?? 0));
  }
  // Smart norm: auto-selects finite or ideal path based on classifyMV.
  function applyNorm(val) {
    if (val === null) return null;
    if (typeof val === 'number') return Math.abs(val);
    const mv = toMV(val);
    if (!mv) return null;
    const cls = classifyMV?.(mv);
    const isIdeal = cls?.kind === 'idealPoint' || cls?.kind === 'idealLine';
    return lenToNumber(isIdeal ? Algebra.Length(dualOp(mv)) : Algebra.Length(mv));
  }
  // Explicit ideal norm.
  function applyINorm(val) {
    if (val === null) return null;
    if (typeof val === 'number') return Math.abs(val);
    const mv = toMV(val);
    if (!mv) return null;
    return lenToNumber(Algebra.Length(dualOp(mv)));
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

  const mapList = (lst, fn) => ({ list: true, items: lst.items.map(fn).filter((v) => v != null) });

  function applyOp(left, op, right) {
    if (left === null || right === null) return null;
    const lNum = typeof left  === 'number';
    const rNum = typeof right === 'number';

    // List operations: elementwise +/-, scalar broadcast *, sandwich >>>.
    if (left?.list || right?.list) {
      if (op === '>>>') {
        if (!right?.list) return null;
        const M = toMV(left);
        if (!M) return null;
        return mapList(right, (item) => {
          const A = item && typeof item === 'object' && 'vx' in item ? geomToMV(item) : item;
          return A ? Algebra.sw(M, A) : null;
        });
      }
      if (op === '*') {
        if (lNum && right?.list) return mapList(right, (item) => scaleMV(toMV(item), left));
        if (rNum && left?.list)  return mapList(left,  (item) => scaleMV(toMV(item), right));
        return null;
      }
      if ((op === '+' || op === '-') && left?.list && right?.list && left.items.length === right.items.length) {
        return {
          list: true,
          items: left.items.map((lv, i) => applyOp(lv, op, right.items[i])).filter((v) => v != null),
        };
      }
      return null;
    }

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
    let evalAbsDepth = 0;

    function parseGrade() {
      let left = parseFactor();
      if (left === null) return null;
      while (pos < tokens.length) {
        const t = peek();
        if (t?.type !== 'op' || !GRADE_OPS.has(t.val)) break;
        if (t.val === '|' && evalAbsDepth > 0) break; // closing | of |…|
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
      // Unary ops: recurse so inner parseFactor handles any postfix.
      if (t.type === 'op' && (t.val === '-' || t.val === '+')) {
        const op = eat().val;
        const v = parseFactor();
        return v === null ? null : (op === '-' ? negateVal(v) : v);
      }
      if (t.type === 'op' && t.val === '!') {
        eat();
        const v = parseFactor();
        if (v === null) return null;
        if (v?.list) return mapList(v, (item) => { const mv = toMV(item); return mv ? dualOp(mv) : null; });
        const mv = toMV(v); return mv ? dualOp(mv) : null;
      }
      if (t.type === 'op' && t.val === '~') {
        eat();
        const v = parseFactor();
        if (v === null) return null;
        if (v?.list) return mapList(v, (item) => { const mv = toMV(item); return mv ? reverseOp(mv) : null; });
        const mv = toMV(v); return mv ? reverseOp(mv) : null;
      }

      // Primary expression.
      let val;
      if (t.type === 'op' && t.val === '(') {
        eat();
        val = parseExpr();
        if (!peek() || peek().val !== ')') return null;
        eat();
      } else if (t.type === 'op' && t.val === '|') {
        // |expr| — smart norm (finite or ideal, auto-detected).
        eat();
        evalAbsDepth++;
        val = parseExpr();
        evalAbsDepth--;
        if (!peek() || peek().val !== '|') return null;
        eat();
        val = applyNorm(val);
      } else if (t.type === 'num') {
        eat(); val = t.val;
      } else if (t.type === 'id') {
        eat();
        if (BUILTIN_FN_NAMES.has(t.val)) {
          if (!peek() || peek().val !== '(') return null;
          eat();
          const arg = parseExpr();
          if (!peek() || peek().val !== ')') return null;
          eat();
          if (arg === null) return null;
          if (t.val === 'abs') { val = applyAbs(arg); }
          else if (TRIG_FNS[t.val]) { val = applyScalarFn(TRIG_FNS[t.val], arg); }
          else if (t.val === 'sqrt') {
            if (typeof arg === 'number') { val = Math.sqrt(arg); }
            else {
              const mv = toMV(arg);
              if (!mv) { val = null; }
              else if (mv.every((v, i) => i === 0 || Math.abs(v) < 1e-10)) {
                const r = new Algebra(arraySize); r[0] = Math.sqrt(mv[0]); val = r;
              } else {
                const normalised = (mv[0] || 0) < -1e-10 ? scaleMV(mv, -1) : mv;
                const log = normalised.Log();
                const half = new Algebra(arraySize);
                for (let i = 0; i < arraySize; i++) half[i] = (log[i] || 0) * 0.5;
                val = half.Exp();
              }
            }
          } else { val = null; }
        } else {
          const v = fullEnv[t.val];
          val = v !== undefined ? v : (() => {
            const b = parseBladeName(t.val);
            if (!b) return null;
            const mv = new Algebra(arraySize); mv[b.index] = b.sign; return mv;
          })();
        }
      } else {
        return null;
      }

      // Postfix property: .norm / .inorm / .bladename — works after any primary.
      while (val !== null && peek()?.type === 'op' && peek()?.val === '.') {
        eat();
        const prop = peek();
        if (!prop || prop.type !== 'id') return null;
        eat();
        if (prop.val === 'norm') {
          val = applyNorm(val);
        } else if (prop.val === 'inorm') {
          val = applyINorm(val);
        } else {
          const b = parseBladeName(prop.val);
          if (!b) return null;
          const mv = toMV(val);
          val = mv ? b.sign * (mv[b.index] ?? 0) : null;
        }
      }

      return val;
    }

    return parseExpr();
  }

  return { evalMVArith, extractMVDeps, parseBladeName, BLADE_NAMES };
}
