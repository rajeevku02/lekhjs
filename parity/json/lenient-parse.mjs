// The comparison tool's JSON parser (verification 02 §A.1, §A.5 step 1), for BOTH sides' output and
// independent of lekhjs: it accepts what the C++ writer emits and JSON.parse refuses (raw control
// characters inside strings, `nan` / `inf`), decodes every escape (§A.5 step 10), and keeps the
// token kind of each number (`2` vs `2.0`), which the integer-member check (§A.5 step 8) needs.
//
// Values: objects are null-prototype records (the last duplicate key wins, and duplicates are
// counted), arrays are arrays, numbers are `LNum`, the rest are JS primitives.

/** A number token: its value and whether it was written as an integer (no `.`, `e` or `E`). */
export class LNum {
  /**
   * @param {number} value
   * @param {boolean} isInt
   */
  constructor(value, isInt) {
    this.value = value;
    this.isInt = isInt;
  }

  /** The number, for `JSON.stringify` of a parsed tree. */
  toJSON() {
    return this.value;
  }
}

/**
 * A parsed value: null, boolean, string, `LNum`, an array of values, or a record of values.
 * @typedef {null | boolean | string | LNum | any[] | { [k: string]: any }} LValue
 */

export class LenientParseError extends Error {
  /**
   * @param {string} code  `json_syntax` | `json_unescaped_key` | `json_empty`
   * @param {string} message
   * @param {number} pos
   */
  constructor(code, message, pos) {
    super(message);
    this.code = code;
    this.pos = pos;
  }
}

/**
 * On an object that held a duplicated key: the key → the FIRST value read for it (the object keeps
 * the last, JSON.parse semantics). Not enumerable, so comparisons and JSON.stringify never see it;
 * the `duplicate-key` normaliser (DR-ENG-02) reads it on the input board.
 */
export const FIRST_VALUES = Symbol('firstValues');

/** @param {{ [k: string]: LValue }} o @returns {Map<string, LValue>} */
function firstValues(o) {
  const own = /** @type {any} */ (o)[FIRST_VALUES];
  if (own instanceof Map) return own;
  const m = new Map();
  Object.defineProperty(o, FIRST_VALUES, { value: m, enumerable: false });
  return m;
}

const WS = new Set([' ', '\t', '\n', '\r', '﻿']);

/**
 * @param {string} text
 * @returns {{ value: LValue, duplicateKeys: number }}
 */
export function lenientParse(text) {
  let i = 0;
  let duplicateKeys = 0;
  const n = text.length;

  /** @param {string} code @param {string} msg */
  const fail = (code, msg) => {
    throw new LenientParseError(code, `${msg} at ${i}`, i);
  };
  const skip = () => {
    while (i < n && WS.has(text.charAt(i))) i++;
  };

  /** @returns {string} */
  const str = () => {
    // text[i] === '"'
    i++;
    let out = '';
    let start = i;
    for (;;) {
      if (i >= n) fail('json_syntax', 'unterminated string');
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c === 0x5c) {
        out += text.slice(start, i);
        const e = text.charAt(i + 1);
        i += 2;
        switch (e) {
          case '"':
          case '\\':
          case '/':
            out += e;
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('json_syntax', 'bad \\u escape');
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default:
            // The C++ writer never escapes anything else; keep the character, as its reader does.
            out += e;
        }
        start = i;
        continue;
      }
      // Raw control characters are accepted (the C++ writer emits them unescaped).
      i++;
    }
  };

  /** @returns {LNum} */
  const num = () => {
    const m = /^-?(?:nan|NaN|inf(?:inity)?|Infinity)/.exec(text.slice(i, i + 9));
    if (m !== null) {
      i += m[0].length;
      const neg = m[0].startsWith('-');
      const body = neg ? m[0].slice(1) : m[0];
      const v = /^nan$/i.test(body) ? NaN : neg ? -Infinity : Infinity;
      return new LNum(v, false);
    }
    const r = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (r === null) fail('json_syntax', 'bad number');
    const tok = /** @type {RegExpExecArray} */ (r)[0];
    i += tok.length;
    return new LNum(Number(tok), r?.[1] === undefined && r?.[2] === undefined);
  };

  /** @returns {LValue} */
  const value = () => {
    skip();
    if (i >= n) fail('json_syntax', 'unexpected end');
    const c = text.charAt(i);
    if (c === '{') {
      i++;
      /** @type {{ [k: string]: LValue }} */
      const o = Object.create(null);
      skip();
      if (text.charAt(i) === '}') {
        i++;
        return o;
      }
      for (;;) {
        skip();
        if (text.charAt(i) !== '"') fail('json_syntax', 'expected a key');
        const k = str();
        skip();
        // A key holding an unescaped `"` ends early and leaves no `:` here (OQ-12).
        if (text.charAt(i) !== ':') fail('json_unescaped_key', 'expected ":" after a key');
        i++;
        const v = value();
        if (Object.prototype.hasOwnProperty.call(o, k)) {
          duplicateKeys++;
          const first = firstValues(o);
          if (!first.has(k)) first.set(k, /** @type {LValue} */ (o[k]));
        }
        o[k] = v;
        skip();
        const d = text.charAt(i);
        i++;
        if (d === ',') continue;
        if (d === '}') return o;
        i--;
        fail('json_syntax', 'expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      /** @type {LValue[]} */
      const a = [];
      skip();
      if (text.charAt(i) === ']') {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        skip();
        const d = text.charAt(i);
        i++;
        if (d === ',') continue;
        if (d === ']') return a;
        i--;
        fail('json_syntax', 'expected "," or "]"');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    return num();
  };

  skip();
  if (i >= n) throw new LenientParseError('json_empty', 'empty text', 0);
  const v = value();
  skip();
  if (i < n) fail('json_syntax', 'trailing characters');
  return { value: v, duplicateKeys };
}

/**
 * @param {LValue | undefined} v
 * @returns {v is { [k: string]: LValue }}
 */
export function isObj(v) {
  return v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof LNum);
}

/** A plain-JS view (numbers as numbers), for reading values. @param {LValue} v @returns {unknown} */
export function plain(v) {
  if (v instanceof LNum) return v.value;
  if (Array.isArray(v)) return v.map(plain);
  if (isObj(v)) {
    /** @type {Record<string, unknown>} */
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}
