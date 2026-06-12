// General multivector arithmetic expression evaluator — algebra-parameterised.
// Returns a tokenizer + validator + evaluator + dep extractor pre-bound to one
// algebra spec. Each algebra adapter calls createEvalMVArith(spec) to get its
// own evaluator closed over the right basis / Algebra instance / GA primitives.
//
// Supports: +, -, *, /, ^ (wedge), & (Vee), unary -(neg), ! (dual), ~ (reverse),
// parens, named nodes, scalar / trig built-ins, and basis blades.

// ─── Named palette color constants ───────────────────────────────────────────
// Available as bare identifiers in expressions: red, blue, green, yellow, gray.

function _hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function _makeColor(hex) {
  const { r, g, b } = _hexToRGB(hex);
  return { color: hex, r, g, b };
}

export const COLOR_CONSTS = {
  red:    _makeColor('#C30A3A'),  // red-500
  blue:   _makeColor('#1482C8'),  // blue-500
  green:  _makeColor('#0F9D57'),  // green-500
  yellow: _makeColor('#E8A000'),  // yellow-500
  gray:   _makeColor('#8B93A4'),  // gray-500
};

export const SCALAR_CONSTS = {
  pi: Math.PI,
};

// ─── Built-in scalar functions ───────────────────────────────────────────────

export const BUILTIN_FN_NAMES = new Set([
  'sqrt', 'sqrt3', 'abs', 'len',
  'sin', 'cos', 'tan', 'csc', 'sec', 'cot',
  'asin', 'acos', 'atan', 'acsc', 'asec', 'acot',
]);

const MAX_USER_CALL_DEPTH = 64;

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
  const { Algebra, arraySize, bladeIndex, parseBladeName, bladeNameToMV, dualOp, reverseOp, geomToMV, classifyMV } = algebra;
  // Algebra-specific named MV constants (e.g. CGA's e0 and einf). Resolved as
  // ordinary identifiers in expressions; never collected as graph dependencies.
  const MV_CONSTS = algebra.mvConsts || {};

  // Object constructors usable inline in expressions (e.g. `point(-4, 2) ^ einf`).
  // Each maps a reserved name → the algebra's typed constructor; only those the
  // algebra actually provides are registered. Args are coerced to scalars.
  const CONSTRUCTORS = {};
  if (algebra.point2D)     CONSTRUCTORS.point     = algebra.point2D;
  if (algebra.flatPoint2D) CONSTRUCTORS.flatPoint = algebra.flatPoint2D;
  if (algebra.vector2D)    CONSTRUCTORS.vector    = algebra.vector2D;
  if (algebra.line2D)      CONSTRUCTORS.line      = algebra.line2D;
  if (algebra.infinityPoint2D) CONSTRUCTORS.vinf  = algebra.infinityPoint2D;
  // Generic extension point: algebras can register extra named constructors
  // (e.g. CCGA's circle/ellipse/hyperbola/…) without hardcoding them here.
  if (algebra.namedConstructors) Object.assign(CONSTRUCTORS, algebra.namedConstructors);
  const CONSTRUCTOR_NAMES = new Set(Object.keys(CONSTRUCTORS));
  const toScalarArg = (a) =>
    typeof a === 'number' ? a
      : (a && typeof a.length === 'number' && a.length >= arraySize) ? (a[0] || 0)
      : NaN;

  const BLADE_NAMES = new Set(Object.keys(bladeIndex).filter((n) => n !== '1'));

  // The ideal norm (.inorm / inorm button) only exists for a degenerate metric
  // (r > 0, e.g. PGA); non-degenerate algebras have a single finite norm, so `.inorm`
  // is not a recognised postfix there.
  const idealNormSupported = (algebra.info?.signature?.r ?? 0) > 0;

  // Property names accepted after '.' that are not blade names.
  const PROP_NAMES = new Set(['norm', 'r', 'g', 'b', 'inverse', ...(idealNormSupported ? ['inorm'] : [])]);

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

  // Constant env shared by every evalMVArith call (basis blades + named consts).
  // Built once: in Cl(5,3) BASIS_ENV alone is 255 keys, so spreading it fresh on
  // each (deeply recursive, user-function-heavy) call dominated the eval cost.
  // Per call we now layer the call-site env on top via the prototype chain.
  const CONST_ENV = { ...BASIS_ENV, ...COLOR_CONSTS, ...SCALAR_CONSTS, ...MV_CONSTS };

  // Token cache: function bodies and node expressions are constant strings
  // re-evaluated every drag tick, so memoising their token arrays avoids
  // re-tokenising the same source repeatedly.
  const _tokenCache = new Map();

  // ── Tokenizer ──────────────────────────────────────────────────────────
  function tokenizeRaw(str) {
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
      if (c === '<' && str[i+1] === '<') { raw.push({ type: 'op', val: '<<' }); i += 2; continue; }
      if (c === '*' && str[i+1] === '*') { raw.push({ type: 'op', val: '**' }); i += 2; continue; }
      if ('+-*/()!~^&|.§[],'.includes(c)) { raw.push({ type: 'op', val: c }); i++; continue; }
      if (c === ':') { raw.push({ type: 'op', val: ':' }); i++; continue; }
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
      // rightBar (|) only triggers implicit mul after a number (2|A| → 2*|A|),
      // not after ) — that would break (A|B)|C by inserting a spurious *.
      if ((leftNum || leftClose) && (rightOpen || rightId || rightNum)) tokens.push(MUL);
      else if (leftNum && rightBar) tokens.push(MUL);
    }
    return tokens;
  }

  // Memoised tokenize: token arrays are read-only during parsing, so the same
  // array can be safely shared across repeated evaluations of the same string.
  function tokenize(str) {
    if (_tokenCache.has(str)) return _tokenCache.get(str);
    const t = tokenizeRaw(str);
    _tokenCache.set(str, t);
    return t;
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

    const GRADE_OPS = new Set(['^', '&', '|', '§', '<<']);

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
      // Postfix: .prop chains and [i] / [i:j] index/slice
      while (true) {
        if (peek()?.val === '.') {
          eat();
          const prop = peek();
          if (!prop || prop.type !== 'id') return false;
          if (!PROP_NAMES.has(prop.val) && !parseBladeName(prop.val)) return false;
          eat();
        } else if (peek()?.val === '[') {
          eat();
          if (peek()?.val === ':') {
            eat();
            if (peek()?.val !== ']') { if (!expr()) return false; }
          } else {
            if (!expr()) return false;
            if (peek()?.val === ':') {
              eat();
              if (peek()?.val !== ']') { if (!expr()) return false; }
            }
          }
          if (!peek() || peek().val !== ']') return false;
          eat();
        } else if (peek()?.val === '^' && tokens[pos + 1]?.val === '-' && tokens[pos + 2]?.type === 'num' && tokens[pos + 2]?.val === 1) {
          eat(); eat(); eat(); // ^, -, 1
        } else if (peek()?.val === '**') {
          eat();
          if (peek()?.val === '-') eat(); // optional negative exponent
          if (peek()?.type !== 'num') return false;
          eat();
        } else { break; }
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
        // Any id followed by '(' is treated syntactically as a function call
        // (builtin or user-defined); the call dispatcher in parseFactor handles
        // name resolution and arity checking.
        if (peek()?.type === 'op' && peek().val === '(') {
          eat();
          if (peek()?.type === 'op' && peek().val === ')') {
            eat();
            return true;
          }
          if (!expr()) return false;
          while (peek()?.type === 'op' && peek().val === ',') {
            eat();
            if (!expr()) return false;
          }
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
      if (t.type === 'id' && !afterDot && !parseBladeName(t.val) && !(bladeNameToMV && bladeNameToMV(t.val)) && !BUILTIN_FN_NAMES.has(t.val) && !CONSTRUCTOR_NAMES.has(t.val) && !(t.val in COLOR_CONSTS) && !(t.val in SCALAR_CONSTS) && !(t.val in MV_CONSTS) && !seen.has(t.val)) {
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
    if (val?.list) return mapList(val, negateVal);
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
  // True when only the grade-0 component is non-negligible — such an MV multiplies
  // as a plain scalar, so products with it reduce to a cheap scaleMV.
  function isPureScalarMV(mv) {
    for (let i = 1; i < arraySize; i++) if (Math.abs(mv[i] || 0) > 1e-12) return false;
    return true;
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
    if (val?.list) return mapList(val, applyNorm);
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
    if (val?.list) return mapList(val, applyINorm);
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

  // Integer power A**n — repeated geometric product (n>0), scalar 1 (n=0), or
  // repeated product of the inverse (n<0). Pure numbers use Math.pow (any real
  // exponent); multivectors require an integer exponent. Maps over lists.
  function applyPow(val, n) {
    if (val === null || typeof n !== 'number') return null;
    if (val?.list) return mapList(val, (item) => applyPow(item, n));
    if (typeof val === 'number') return Math.pow(val, n);
    if (!Number.isInteger(n)) return null;
    const mv = toMV(val);
    if (!mv) return null;
    if (n === 0) { const r = new Algebra(arraySize); r[0] = 1; return r; }
    let base = mv, e = n;
    if (n < 0) {
      const inv = 'Inverse' in mv ? mv.Inverse : null;
      if (!inv) return null;
      base = inv; e = -n;
    }
    let result = base;
    for (let k = 1; k < e; k++) result = Algebra.Mul(result, base);
    return result;
  }

  function applyOp(left, op, right) {
    if (left === null || right === null) return null;
    const lNum = typeof left  === 'number';
    const rNum = typeof right === 'number';

    // List operations — general rule:
    //   both lists, same length → elementwise
    //   one list, one non-list  → broadcast (apply op to each element)
    if (left?.list || right?.list) {
      if (left?.list && right?.list) {
        if (left.items.length !== right.items.length) return null;
        return { list: true, items: left.items.map((lv, i) => applyOp(lv, op, right.items[i])).filter((v) => v != null) };
      }
      if (left?.list)  return mapList(left,  (item) => applyOp(item, op, right));
      if (right?.list) return mapList(right, (item) => applyOp(left,  op, item));
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
      const lMV = toMV(left), rMV = toMV(right);
      if (!lMV || !rMV) return null;
      // Pure-scalar fast path: a grade-0 MV (e.g. a `C|eo1` coefficient) just
      // scales the other operand — skip ganja's full 256-dim Mul (~77µs).
      if (isPureScalarMV(lMV)) return scaleMV(rMV, lMV[0] || 0);
      if (isPureScalarMV(rMV)) return scaleMV(lMV, rMV[0] || 0);
      return Algebra.Mul(lMV, rMV);
    }
    if (op === '/') {
      if (rNum && right !== 0) return scaleMV(toMV(left), 1 / right);
      const rMV = toMV(right);
      if (!rMV) return null;
      // Fast path: pure scalar MV (only component [0] non-zero)
      let isPureScalar = true;
      for (let i = 1; i < arraySize; i++) { if (Math.abs(rMV[i] || 0) > 1e-10) { isPureScalar = false; break; } }
      if (isPureScalar) {
        const s = rMV[0] || 0;
        return Math.abs(s) > 1e-15 ? scaleMV(toMV(left), 1 / s) : null;
      }
      // Versor fast path: for a blade/versor B (vectors, blades, rotors, …),
      // B⁻¹ = ~B / (B·~B) where B·~B is a scalar — one product instead of ganja's
      // general .Inverse, whose recursive product chain costs ~15× a Mul in high
      // dimensions (≈30 ms in CCGA's 256-dim algebra, the dominant drag cost).
      if (typeof Algebra.Reverse === 'function') {
        const rev = Algebra.Reverse(rMV);
        const n = Algebra.Mul(rMV, rev);
        let maxNon = 0;
        for (let i = 1; i < arraySize; i++) { const a = Math.abs(n[i] || 0); if (a > maxNon) maxNon = a; }
        const s = n[0] || 0;
        if (Math.abs(s) > 1e-12 && maxNon < Math.abs(s) * 1e-6) {  // B·~B effectively scalar
          const inv = scaleMV(rev, 1 / s);
          return Algebra.Mul(toMV(left), inv);
        }
      }
      // General MV inverse: A / B = A * B^{-1} via ganja (Inverse is a getter)
      if ('Inverse' in rMV) {
        const inv = rMV.Inverse;
        return inv ? Algebra.Mul(toMV(left), inv) : null;
      }
      return null;
    }
    if (op === '^') return Algebra.Wedge(toMV(left), toMV(right));
    if (op === '&') {
      if (typeof Algebra.Vee !== 'function') return null;
      return Algebra.Vee(toMV(left), toMV(right));
    }
    if (op === '|')  return Algebra.Dot(toMV(left), toMV(right));   // symmetric inner product
    if (op === '<<') return Algebra.LDot(toMV(left), toMV(right));  // left contraction A⌋B
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

    // Merge order: user env takes priority over constants, but only when defined.
    // Layer the call-site env over the shared constant env via the prototype
    // chain — lookups fall through to CONST_ENV without copying its 255 keys.
    const fullEnv = Object.create(CONST_ENV);
    for (const k of Object.keys(env)) { if (env[k] !== undefined) fullEnv[k] = env[k]; }
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

    const GRADE_OPS = new Set(['^', '&', '|', '§', '<<']);
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
        if (peek()?.type === 'op' && peek().val === '(') {
          // id(arg1, arg2, ...) — builtin or user-function call.
          eat();
          const args = [];
          if (peek()?.type === 'op' && peek().val === ')') {
            eat();
          } else {
            const a0 = parseExpr();
            if (a0 === null) return null;
            args.push(a0);
            while (peek()?.type === 'op' && peek().val === ',') {
              eat();
              const a = parseExpr();
              if (a === null) return null;
              args.push(a);
            }
            if (!peek() || peek().val !== ')') return null;
            eat();
          }

          if (CONSTRUCTOR_NAMES.has(t.val)) {
            // Object constructor: point/flatPoint/vector/line with scalar args.
            const nums = args.map(toScalarArg);
            val = (args.length >= 2 && !nums.some(Number.isNaN))
              ? CONSTRUCTORS[t.val](...nums)
              : null;
          } else if (BUILTIN_FN_NAMES.has(t.val)) {
            if (args.length !== 1) { val = null; }
            else {
              const arg = args[0];
              if (t.val === 'len') { val = arg?.list ? arg.items.length : null; }
              else if (t.val === 'abs') { val = applyAbs(arg); }
              else if (TRIG_FNS[t.val]) { val = applyScalarFn(TRIG_FNS[t.val], arg); }
              else if (t.val === 'sqrt') {
                if (typeof arg === 'number') { val = Math.sqrt(arg); }
                else {
                  const mv = toMV(arg);
                  if (!mv) { val = null; }
                  else {
                    // Treat the argument as a scalar when its non-scalar parts are
                    // negligible *relative* to the scalar (a 2-blade's square is a
                    // pure scalar mathematically, but ganja's Float32 product leaves
                    // grade noise at ~1e-6 of it — an absolute cutoff would wrongly
                    // push it into the motor branch and not return a scalar).
                    let maxNon = 0;
                    for (let i = 1; i < arraySize; i++) { const a = Math.abs(mv[i] || 0); if (a > maxNon) maxNon = a; }
                    if (maxNon < Math.max(1e-9, Math.abs(mv[0] || 0) * 1e-4)) {
                      const r = new Algebra(arraySize); r[0] = Math.sqrt(mv[0]); val = r;
                    } else {
                      const normalised = (mv[0] || 0) < -1e-10 ? scaleMV(mv, -1) : mv;
                      const log = normalised.Log();
                      const half = new Algebra(arraySize);
                      for (let i = 0; i < arraySize; i++) half[i] = (log[i] || 0) * 0.5;
                      val = half.Exp();
                    }
                  }
                }
              } else if (t.val === 'sqrt3') {
                // Real cube root. Single-valued over the reals (Math.cbrt handles
                // negatives), so unlike sqrt it needs no sign-flip — which is exactly
                // why it can take the (possibly negative) Cardano radicand directly.
                if (typeof arg === 'number') { val = Math.cbrt(arg); }
                else {
                  const mv = toMV(arg);
                  if (!mv) { val = null; }
                  else {
                    let maxNon = 0;
                    for (let i = 1; i < arraySize; i++) { const a = Math.abs(mv[i] || 0); if (a > maxNon) maxNon = a; }
                    if (maxNon < Math.max(1e-9, Math.abs(mv[0] || 0) * 1e-4)) {
                      const r = new Algebra(arraySize); r[0] = Math.cbrt(mv[0]); val = r;
                    } else {
                      const log = mv.Log();
                      const third = new Algebra(arraySize);
                      for (let i = 0; i < arraySize; i++) third[i] = (log[i] || 0) / 3;
                      val = third.Exp();
                    }
                  }
                }
              } else { val = null; }
            }
          } else {
            // User-function dispatch: look up `{ kind: 'function', paramNames, body, capturedEnv }` in env.
            const fn = fullEnv[t.val];
            if (!fn || typeof fn !== 'object' || fn.kind !== 'function') { val = null; }
            else if (args.length !== fn.paramNames.length) { val = null; }
            else {
              const depth = (env?.__callDepth ?? 0) + 1;
              if (depth > MAX_USER_CALL_DEPTH) { val = null; }
              else {
                // Merge: outer call-site env (so the function name itself stays
                // resolvable for recursion), then the captured globals snapshot
                // (from def-time deps), then parameter bindings.
                const childEnv = { ...(env ?? {}), ...(fn.capturedEnv ?? {}), __callDepth: depth };
                for (let i = 0; i < fn.paramNames.length; i++) {
                  childEnv[fn.paramNames[i]] = args[i];
                }
                val = evalMVArith(fn.body, childEnv);
              }
            }
          }
        } else {
          const v = fullEnv[t.val];
          val = v !== undefined ? v : (() => {
            const b = parseBladeName(t.val);
            if (b) { const mv = new Algebra(arraySize); mv[b.index] = b.sign; return mv; }
            // Conformal/null-basis blade names (e01, e10inf, einf120, …).
            return bladeNameToMV ? bladeNameToMV(t.val) : null;
          })();
        }
      } else {
        return null;
      }

      // Postfix: .prop and [i] / [i:j]
      while (val !== null) {
        if (peek()?.val === '.') {
          eat();
          const prop = peek();
          if (!prop || prop.type !== 'id') return null;
          eat();
          if (prop.val === 'norm') {
            val = applyNorm(val);
          } else if (prop.val === 'inorm' && idealNormSupported) {
            val = applyINorm(val);
          } else if (prop.val === 'inverse') {
            const applyInv = (v) => {
              if (typeof v === 'number') return Math.abs(v) > 1e-15 ? 1 / v : null;
              const mv = toMV(v);
              return mv && 'Inverse' in mv ? mv.Inverse : null;
            };
            val = val?.list ? mapList(val, applyInv) : applyInv(val);
          } else if (prop.val === 'r' || prop.val === 'g' || prop.val === 'b') {
            val = (val && typeof val === 'object' && typeof val.color === 'string')
              ? (val[prop.val] ?? null)
              : null;
          } else {
            const b = parseBladeName(prop.val);
            if (!b) return null;
            const mv = toMV(val);
            val = mv ? b.sign * (mv[b.index] ?? 0) : null;
          }
        } else if (peek()?.val === '[') {
          eat();
          // Parse optional start index, optional colon, optional end index.
          let iExpr = null, jExpr = null, isSlice = false;
          if (peek()?.val === ':') {
            isSlice = true; eat();
            if (peek()?.val !== ']') jExpr = parseExpr();
          } else {
            iExpr = parseExpr();
            if (peek()?.val === ':') {
              isSlice = true; eat();
              if (peek()?.val !== ']') jExpr = parseExpr();
            }
          }
          if (!peek() || peek().val !== ']') return null;
          eat();

          const toIdx = (v) => {
            if (typeof v === 'number') return Math.round(v);
            if (v && typeof v === 'object' && typeof v.length === 'number') return Math.round(v[0] || 0);
            return null;
          };

          if (val?.list) {
            const n = val.items.length;
            const norm = (i, dflt) => {
              if (i === null) return dflt;
              return i < 0 ? Math.max(0, n + i) : Math.min(n, i);
            };
            if (!isSlice) {
              const i = norm(toIdx(iExpr), 0);
              val = (i >= 0 && i < n) ? val.items[i] : null;
            } else {
              const i = norm(toIdx(iExpr), 0);
              const j = norm(toIdx(jExpr), n);
              val = { list: true, items: val.items.slice(i, j) };
            }
          } else {
            val = null;
          }
        } else if (peek()?.val === '**') {
          eat();
          let sign = 1;
          if (peek()?.val === '-') { eat(); sign = -1; }
          const numTok = peek();
          if (!numTok || numTok.type !== 'num') return null;
          eat();
          val = applyPow(val, sign * numTok.val);
        } else if (peek()?.val === '^' && tokens[pos + 1]?.val === '-' && tokens[pos + 2]?.type === 'num' && tokens[pos + 2]?.val === 1) {
          eat(); eat(); eat(); // ^, -, 1
          const applyInverse = (v) => {
            if (typeof v === 'number') return Math.abs(v) > 1e-15 ? 1 / v : null;
            const mv = toMV(v);
            return mv && 'Inverse' in mv ? mv.Inverse : null;
          };
          val = val?.list ? mapList(val, applyInverse) : applyInverse(val);
        } else { break; }
      }

      return val;
    }

    return parseExpr();
  }

  return { evalMVArith, extractMVDeps, parseBladeName, BLADE_NAMES };
}
