// The fallback JSON reader for C++-written files that `JSON.parse` rejects (spec 03 §10.3).
//
// It accepts standard JSON plus exactly one deviation of the C++ writer (`ostream << float` of a
// non-finite value): the number literals `nan`, `-nan`, `inf` and `-inf`, each read as 0 and
// counted (`nonfinite_read`). Nothing else is accepted.
//
// The other C++ deviation, an object key written unescaped (`JsonParser::store`, B18e), is not
// recoverable in general: a parse error inside an object member's key, or between the key and
// its colon, fails with `json_unescaped_key` so the corpus report can count such files (OQ-12).
// Every other error is `json_parse`.
//
// Semantics match `JSON.parse`: the last duplicate key wins (DR-ENG-02), `\u` escapes are read
// (DR-ENG-01), and every key, `__proto__` included, becomes an own data property.
import type { JsonObject, JsonValue } from '../../template';
import { LoadError } from '../errors';

export interface LenientParse {
  readonly value: JsonValue;
  /** How many `nan`/`inf` literals were read as 0. */
  readonly nonFinite: number;
}

const NON_FINITE = Object.freeze(['-nan', '-inf', 'nan', 'inf']);

class Parser {
  private readonly s: string;
  private i = 0;
  nonFinite = 0;

  constructor(s: string) {
    this.s = s;
  }

  fail(inKey: boolean): never {
    throw new LoadError(inKey ? 'json_unescaped_key' : 'json_parse', { offset: this.i });
  }

  ws(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) this.i++;
      else break;
    }
  }

  document(): JsonValue {
    this.ws();
    const v = this.value();
    this.ws();
    if (this.i !== this.s.length) this.fail(false);
    return v;
  }

  value(): JsonValue {
    this.ws();
    const s = this.s;
    const c = s[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string(false);
    for (const lit of NON_FINITE) {
      if (s.startsWith(lit, this.i)) {
        this.i += lit.length;
        this.nonFinite++;
        return 0;
      }
    }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    if (s.startsWith('true', this.i)) {
      this.i += 4;
      return true;
    }
    if (s.startsWith('false', this.i)) {
      this.i += 5;
      return false;
    }
    if (s.startsWith('null', this.i)) {
      this.i += 4;
      return null;
    }
    return this.fail(false);
  }

  object(): JsonObject {
    const out: Record<string, JsonValue> = {};
    this.i++; // {
    this.ws();
    if (this.s[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail(false);
      const key = this.string(true);
      this.ws();
      if (this.s[this.i] !== ':') this.fail(true);
      this.i++;
      const v = this.value();
      Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
      this.ws();
      const c = this.s[this.i];
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === '}') {
        this.i++;
        return out;
      }
      // A key with an unescaped quote and colon (`"a":"b":`) reads as a key and a value, then
      // leaves a colon here, which valid JSON never has.
      this.fail(c === ':');
    }
  }

  array(): JsonValue[] {
    const out: JsonValue[] = [];
    this.i++; // [
    this.ws();
    if (this.s[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s[this.i];
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === ']') {
        this.i++;
        return out;
      }
      this.fail(false);
    }
  }

  string(inKey: boolean): string {
    const s = this.s;
    this.i++; // opening quote
    let out = '';
    let start = this.i;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 0x22) {
        out += s.slice(start, this.i);
        this.i++;
        return out;
      }
      if (c < 0x20) this.fail(inKey);
      if (c !== 0x5c) {
        this.i++;
        continue;
      }
      out += s.slice(start, this.i);
      const e = s[this.i + 1];
      this.i += 2;
      switch (e) {
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
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
          const hex = s.slice(this.i, this.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail(inKey);
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
          break;
        }
        default:
          this.fail(inKey);
      }
      start = this.i;
    }
    return this.fail(inKey);
  }

  number(): number {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i, this.i + 400));
    if (m === null) return this.fail(false);
    this.i += m[0].length;
    return Number(m[0]);
  }
}

/** Parses `text` leniently; throws `LoadError` (`json_parse` or `json_unescaped_key`). */
export function parseLenientJson(text: string): LenientParse {
  const p = new Parser(text);
  const value = p.document();
  return { value, nonFinite: p.nonFinite };
}

/**
 * `JSON.parse` first; on a `SyntaxError`, the lenient reader (spec 03 §10.1). The count says how
 * many non-finite literals the fallback read as 0 (0 when `JSON.parse` succeeded).
 */
export function parseJsonText(text: string): LenientParse {
  try {
    return { value: JSON.parse(text) as JsonValue, nonFinite: 0 };
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return parseLenientJson(text);
  }
}
