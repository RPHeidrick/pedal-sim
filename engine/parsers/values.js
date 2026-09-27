/**
 * SPICE numeric values and {expression} evaluation.
 *
 * SPICE numbers are case-insensitive and take an optional scale suffix:
 *   T=1e12 G=1e9 MEG=1e6 K=1e3 M=1e-3 (milli!) U=1e-6 N=1e-9 P=1e-12 F=1e-15 MIL=25.4e-6
 * Trailing unit letters are ignored ("10kOhm", "1uF", "5V").
 * "R-notation" such as 4k7 (= 4.7k) and 2u2 (= 2.2u) is accepted too, since
 * KiCad libraries and hand-written netlists use it.
 */

const SCALE = [
  ['meg', 1e6], ['mil', 25.4e-6],
  ['t', 1e12], ['g', 1e9], ['k', 1e3], ['m', 1e-3],
  ['u', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15],
];

const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i;
const RNOT_RE = /^([+-]?\d+)(meg|[tgkmunpfr])(\d+)([a-z]*)$/i;

/**
 * Parse a SPICE number. Returns NaN when the text is not a number.
 * @param {string} text
 * @returns {number}
 */
export function parseValue(text) {
  if (typeof text === 'number') return text;
  let s = String(text).trim().replace(/[µμ]/g, 'u');
  const r = RNOT_RE.exec(s);
  if (r) {
    // 4k7 -> 4.7k ; 4r7 -> 4.7
    const mult = r[2].toLowerCase() === 'r' ? 1 : scaleOf(r[2]);
    return parseFloat(`${r[1]}.${r[3]}`) * mult;
  }
  const m = NUM_RE.exec(s);
  if (!m) return NaN;
  const base = parseFloat(m[1]);
  return m[2] ? base * scaleOf(m[2]) : base;
}

function scaleOf(suffix) {
  const low = suffix.toLowerCase();
  for (const [p, v] of SCALE) if (low.startsWith(p)) return v;
  return 1; // pure unit such as "V", "Ohm", "F" (note: a lone "f" is femto, as in SPICE)
}

// ---------------------------------------------------------------------------
// Expressions: {R*wiper}, {1/(2*pi*f)}, param names, + - * / ^ ** and calls.
// ---------------------------------------------------------------------------

const FUNCS = {
  sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10,
  abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan,
  min: Math.min, max: Math.max, pow: Math.pow, pwr: Math.pow, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, int: Math.trunc,
  limit: (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b)),
  if: (c, a, b) => (c ? a : b),
};
const CONSTS = { pi: Math.PI, e: Math.E };

/**
 * Evaluate an arithmetic expression with parameters.
 * @param {string} src expression text (braces/quotes already stripped or not)
 * @param {Record<string, number>} params lower-cased parameter table
 * @returns {number}
 */
export function evalExpr(src, params = {}) {
  const s = String(src).trim().replace(/^[{'"]|[}'"]$/g, '');
  let i = 0;
  const peek = () => s[i];
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  function primary() {
    skip();
    const c = peek();
    if (c === "(") { i++; const v = compare(); skip(); expect(')'); return v; }
    if (c === '-') { i++; return -power(); }
    if (c === '+') { i++; return power(); }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpf])?[a-z]*/i.exec(s.slice(i));
    if (num) { i += num[0].length; return parseValue(num[0]); }
    const id = /^[a-z_][\w.]*/i.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      skip();
      if (peek() === '(') {
        i++;
        const args = [];
        skip();
        if (peek() !== ')') {
          for (;;) { args.push(compare()); skip(); if (peek() === ',') { i++; continue; } break; }
        }
        expect(')');
        const fn = FUNCS[name];
        if (!fn) throw new Error(`unknown function "${name}"`);
        return fn(...args);
      }
      if (name in params) return params[name];
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`unknown parameter "${id[0]}"`);
    }
    throw new Error(`unexpected "${s.slice(i, i + 8)}" in expression "${s}"`);
  }
  function expect(ch) {
    skip();
    if (s[i] !== ch) throw new Error(`expected "${ch}" in expression "${s}"`);
    i++;
  }
  function power() {
    const b = primary();
    skip();
    if (s[i] === '^' || (s[i] === '*' && s[i + 1] === '*')) {
      i += s[i] === '^' ? 1 : 2;
      return Math.pow(b, power()); // right associative
    }
    return b;
  }
  function product() {
    let v = power();
    for (;;) {
      skip();
      if (s[i] === '*' && s[i + 1] !== '*') { i++; v *= power(); }
      else if (s[i] === '/') { i++; v /= power(); }
      else return v;
    }
  }
  function sum() {
    let v = product();
    for (;;) {
      skip();
      if (s[i] === '+') { i++; v += product(); }
      else if (s[i] === '-') { i++; v -= product(); }
      else return v;
    }
  }
  function compare() {
    let v = sum();
    skip();
    const op = /^(==|!=|>=|<=|>|<)/.exec(s.slice(i));
    if (op) { i += op[0].length; const r = sum(); v = { '==': v === r, '!=': v !== r, '>=': v >= r, '<=': v <= r, '>': v > r, '<': v < r }[op[0]] ? 1 : 0; }
    return v;
  }

  const v = compare();
  skip();
  if (i < s.length) throw new Error(`trailing "${s.slice(i)}" in expression "${s}"`);
  return v;
}

/**
 * Resolve a value token that may be a number, a {expression}, or a bare parameter name.
 * @returns {number} NaN if it cannot be resolved
 */
export function resolveValue(token, params = {}) {
  if (token == null) return NaN;
  const t = String(token).trim();
  const n = parseValue(t);
  if (!Number.isNaN(n)) return n;
  try { return evalExpr(t, params); } catch { return NaN; }
}

/** Format a number with an engineering suffix, e.g. 4700 -> "4.7k". */
export function formatEng(v, digits = 3, unit = '') {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return `0${unit}`;
  const tbl = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  const a = Math.abs(v);
  for (const [s, p] of tbl) {
    if (a >= s * 0.9995) return `${+(v / s).toPrecision(digits)}${p}${unit}`;
  }
  return `${v.toExponential(digits - 1)}${unit}`;
}
