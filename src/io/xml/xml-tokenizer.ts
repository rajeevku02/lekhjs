// The legacy XML form's tokenizer (port of C++ `XmlSerializer::getNext`, `matchNext`, `readID`,
// `readText`, `ignoreWhiteSpaces` and the scalar `parse*` helpers, `L/document/XmlSerializer.cpp:
// 1371-1633`; spec 02 `XmlTokenizer`).
//
// The grammar is the C++ writer's own: tags are letters only, with no attributes, no prolog and
// no self-closing form; text runs to the next `<`. Scalars are read as C++ did: `atof` / `atoi`
// on the raw text (0 when it has no leading number), a boolean is false only for exactly "0" or
// "false", and strings are unescaped with five sequential replacements (`&amp;` last).
export const XmlTokenType = Object.freeze({ End: 0, Open: 1, Close: 2, Text: 3 } as const);
export type XmlTokenType = (typeof XmlTokenType)[keyof typeof XmlTokenType];

export interface XmlToken {
  readonly type: XmlTokenType;
  readonly value: string;
  /** Where the token began (C++ `undoIndex`), to put it back. */
  readonly undoIndex: number;
}

function isLetter(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/** C++ `unEscapeString`. */
export function unescapeXml(str: string): string {
  return str
    .split('&quot;')
    .join('"')
    .split('&apos;')
    .join("'")
    .split('&lt;')
    .join('<')
    .split('&gt;')
    .join('>')
    .split('&amp;')
    .join('&');
}

/** C++ `atof`: the longest leading decimal number, else 0. */
function atof(s: string): number {
  const m = /^[ \t\n\r\f\v]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(s);
  return m?.[1] !== undefined ? Number(m[1]) : 0;
}

/** C++ `atoi`: the leading integer, else 0. */
function atoi(s: string): number {
  const m = /^[ \t\n\r\f\v]*([+-]?\d+)/.exec(s);
  return m?.[1] !== undefined ? Number(m[1]) : 0;
}

export class XmlTokenizer {
  private readonly input: string;
  private i = 0;

  constructor(input: string) {
    this.input = input;
  }

  get index(): number {
    return this.i;
  }

  set index(v: number) {
    this.i = v;
  }

  atEnd(): boolean {
    return this.i >= this.input.length;
  }

  /** C++ `ignoreWhiteSpaces`: space, `\n`, `\r`, `\t`. */
  skipWhitespace(): void {
    const s = this.input;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') this.i++;
      else break;
    }
  }

  private readId(): string {
    this.skipWhitespace();
    let out = '';
    while (this.i < this.input.length && isLetter(this.input[this.i])) out += this.input[this.i++] ?? '';
    return out;
  }

  /** C++ `readText`: everything up to the next `<`. */
  readText(): string {
    const start = this.i;
    const end = this.input.indexOf('<', this.i);
    this.i = end < 0 ? this.input.length : end;
    return this.input.slice(start, this.i);
  }

  /** C++ `getNext`. */
  next(): XmlToken {
    const undoIndex = this.i;
    this.skipWhitespace();
    if (this.atEnd()) return { type: XmlTokenType.End, value: '', undoIndex };
    if (this.input[this.i] !== '<') return { type: XmlTokenType.Text, value: this.readText(), undoIndex };
    this.i++;
    if (this.atEnd()) return { type: XmlTokenType.End, value: '', undoIndex };
    let type: XmlTokenType = XmlTokenType.Open;
    if (this.input[this.i] === '/') {
      type = XmlTokenType.Close;
      this.i++;
    }
    const value = this.readId();
    if (value === '') return { type: XmlTokenType.End, value: '', undoIndex };
    if (this.input[this.i] !== '>') return { type: XmlTokenType.End, value, undoIndex };
    this.i++;
    return { type, value, undoIndex };
  }

  /** C++ `matchNext(tag, type)`: consumes the token when it matches, else puts it back. */
  match(tag: string, type: typeof XmlTokenType.Open | typeof XmlTokenType.Close): boolean {
    const t = this.next();
    if (t.type !== type || t.value !== tag) {
      this.i = t.undoIndex;
      return false;
    }
    return true;
  }

  private scalar(tag: string): string | null {
    if (!this.match(tag, XmlTokenType.Open)) return null;
    const text = this.readText();
    if (!this.match(tag, XmlTokenType.Close)) return null;
    return text;
  }

  /** C++ `parseString`: the unescaped text of `<tag>…</tag>`. */
  string(tag: string): string | null {
    const t = this.scalar(tag);
    return t === null ? null : unescapeXml(t);
  }

  /** C++ `parseDouble`. */
  double(tag: string): number | null {
    const t = this.scalar(tag);
    return t === null ? null : atof(t);
  }

  /** C++ `parseInt`. */
  int(tag: string): number | null {
    const t = this.scalar(tag);
    return t === null ? null : atoi(t);
  }

  /** C++ `parseBool`: false only for "0" or "false". */
  bool(tag: string): boolean | null {
    const t = this.scalar(tag);
    if (t === null) return null;
    return !(t === '0' || t === 'false');
  }
}
