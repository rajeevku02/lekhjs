// The text helpers of the Lua host API, as TS (spec 04 §5.1; port of `lua_splitLines`,
// `splitByChar`, `lua_split` and `lua_parseSizeSpec`, `L/shapegen/LuaShapeGenerator.cpp:91-497`).
// Ported as is, including:
//   - `splitLines` of '' is no line, and a final `\n` adds none; only the first `\r` of a line goes;
//   - `splitByChar` unescapes `\<ch>` and `\\`, and '' splits into nothing;
//   - `split`'s markers are read in C++'s order (indent, escaped `\-`/`\*`, `*`/`-` in either
//     order, `[start icon]`, `[end icon]` (scanning on leftwards after a match), `,end text`,
//     `\n` escapes), and the end-text join drops the escapes it split on;
//   - `width`/`height` and the ratios are measured only with `checkWidth` or `checkHeight` (C++ left
//     them uninitialised otherwise; 0 here).
// The markup characters are ASCII, so indexing UTF-16 code units splits where C++'s bytes did.
import type { SizeSpec, SizeSpecItem, SplitItem, SplitOptions } from '../template';

/** The text measure `split` uses for `checkWidth` / `checkHeight` (the template's style). */
export type SplitMeasure = (text: string) => { readonly w: number; readonly h: number };

/** C++ `splitLines`. */
export function splitLines(str: string): string[] {
  const arr: string[] = [];
  let i = 0;
  while (i < str.length) {
    const j = str.indexOf('\n', i);
    let line: string;
    if (j < 0) {
      line = str.slice(i);
      i = str.length;
    } else {
      line = str.slice(i, j);
      i = j + 1;
    }
    const r = line.indexOf('\r');
    if (r >= 0) line = line.slice(0, r) + line.slice(r + 1);
    arr.push(line);
  }
  return arr;
}

/** C++ `splitByChar`. */
export function splitByChar(str: string, ch: string): string[] {
  const arr: string[] = [];
  let i = 0;
  let line = '';
  while (i < str.length) {
    const c = str.charAt(i);
    const next = i < str.length - 1 ? str.charAt(i + 1) : '';
    if (c === '\\' && next === ch) {
      line += ch;
      i += 2;
    } else if (c === '\\' && next === '\\') {
      line += '\\';
      i += 2;
    } else if (c === ch) {
      arr.push(line);
      line = '';
      i++;
    } else {
      line += c;
      i++;
    }
  }
  if (str.length > 0) arr.push(line);
  return arr;
}

const C_SPACE = ' \t\n\v\f\r';

/** C++ `LekhUtil::trim` (the C `isspace` set). */
export function trimC(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && C_SPACE.includes(s.charAt(a))) a++;
  while (b > a && C_SPACE.includes(s.charAt(b - 1))) b--;
  return s.slice(a, b);
}

/** C `atoi`: optional space and sign, then digits; 0 when there are none. */
export function atoi(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s);
  if (m === null) return 0;
  const n = Number.parseInt(m[1] ?? '0', 10);
  // C int arithmetic: out of range is undefined in C; clamp so the value stays an int.
  return Math.max(-2147483648, Math.min(2147483647, n));
}

const NOT_PARSED: SizeSpec = Object.freeze({ parsed: false, specs: Object.freeze([]) });

/** C++ `lua_parseSizeSpec`: `"{10c, 20r, 30}"` → sizes and alignments. */
export function parseSizeSpec(spec: string): SizeSpec {
  let str = trimC(spec);
  const hash = str.indexOf('#');
  if (hash >= 0) str = trimC(str.slice(0, hash));
  if (str.length < 2 || !str.startsWith('{') || !str.endsWith('}')) return NOT_PARSED;
  const parts = splitByChar(str.slice(1, -1), ',');
  if (parts.length === 0) return NOT_PARSED;
  const specs: SizeSpecItem[] = [];
  for (const raw of parts) {
    const s = trimC(raw);
    if (s === '') {
      specs.push({ size: 0, align: 'left' });
      continue;
    }
    const last = s.charAt(s.length - 1);
    const lower = last.toLowerCase();
    if (lower === 'c') specs.push({ size: atoi(s.slice(0, -1)), align: 'center' });
    else if (lower === 'r') specs.push({ size: atoi(s.slice(0, -1)), align: 'right' });
    else if (lower === 'l') specs.push({ size: atoi(s.slice(0, -1)), align: 'left' });
    else if (last >= '0' && last <= '9') specs.push({ size: atoi(s), align: 'left' });
    else return NOT_PARSED;
  }
  return Object.freeze({ parsed: true, specs: Object.freeze(specs) });
}

interface Splitted {
  line: string;
  startIcon: string | null;
  endIcon: string | null;
  endText: string | null;
  indent: number;
  disabled: boolean;
  selected: boolean;
  width: number;
  height: number;
  widthRatio: number;
  heightRatio: number;
}

/** C++ `lua_split`: the wireframe markup parser. */
export function split(text: string, opts: SplitOptions, measure: SplitMeasure): SplitItem[] {
  const by = opts.by.charAt(0);
  if (by === '') return [];
  const checkDisabled = opts.checkDisabled === true;
  const checkSelection = opts.checkSelection === true;
  const checkWidth = opts.checkWidth === true;
  const checkHeight = opts.checkHeight === true;
  const heightPad = opts.heightPad ?? 0;
  const widthPad = opts.widthPad ?? 0;
  let heightSum = 0;
  let widthSum = 0;

  const strArr = by === '\n' ? splitLines(text) : splitByChar(text, by);
  const out: Splitted[] = [];
  for (const item of strArr) {
    const ss: Splitted = {
      line: '',
      startIcon: null,
      endIcon: null,
      endText: null,
      indent: 0,
      disabled: false,
      selected: false,
      width: 0,
      height: 0,
      widthRatio: 0,
      heightRatio: 0,
    };
    let word = item;
    let index = 0;
    if (opts.checkIndent === true) {
      while (index < item.length && item.charAt(index) === ' ') index++;
      if (index > 0) {
        word = word.slice(index);
        ss.indent = index;
        index = 0;
      }
    }
    let escaped = '';
    while (
      index < word.length - 1 &&
      word.charAt(index) === '\\' &&
      (word.charAt(index + 1) === '-' || word.charAt(index + 1) === '*')
    ) {
      escaped += word.charAt(index + 1);
      index += 2;
    }
    if (index < word.length && checkSelection && word.charAt(index) === '*') {
      ss.selected = true;
      index++;
      if (checkDisabled && index < word.length && word.charAt(index) === '-') {
        ss.disabled = true;
        index++;
      }
    }
    if (!ss.disabled && index < word.length && checkDisabled && word.charAt(index) === '-') {
      ss.disabled = true;
      index++;
      if (!ss.selected && index < word.length && checkSelection && word.charAt(index) === '*') {
        index++;
        ss.selected = true;
      }
    }
    if (index !== 0) {
      word = word.slice(index);
      index = 0;
    }
    if (opts.checkStartIcon === true && index < word.length && word.charAt(index) === '[') {
      index++;
      const start = index;
      while (index < word.length) {
        if (word.charAt(index) === ']') {
          ss.startIcon = word.slice(start, index);
          word = word.slice(index + 1);
          break;
        }
        index++;
      }
    }

    word = escaped + word;
    let last = word.length - 1;
    if (opts.checkEndIcon === true && word.length > 1 && word.charAt(last) === ']') {
      last--;
      const to = last;
      while (last >= 0) {
        if (word.charAt(last) === '[') {
          ss.endIcon = word.slice(last + 1, last + 1 + (to - last));
          word = word.slice(0, last);
        }
        last--;
      }
    }
    if (opts.checkEndText === true && word.length > 0 && word.includes(',')) {
      const tmp = splitByChar(word, ',');
      let lastIndex = tmp.length - 1;
      const tail = tmp[tmp.length - 1] ?? '';
      if (tmp.length > 1 && tail !== '') {
        ss.endText = tail;
        lastIndex = tmp.length - 2;
      }
      word = tmp[0] ?? '';
      for (let t = 1; t <= lastIndex; t++) word += `,${tmp[t] ?? ''}`;
    }
    if (opts.checkEscapeNewLine === true) {
      let s = '';
      let i = 0;
      while (i < word.length) {
        const c = word.charAt(i);
        const next = i < word.length - 1 ? word.charAt(i + 1) : '';
        if (c === '\\' && next === 'n') {
          s += '\n';
          i++;
        } else if (c === '\\' && next === '\\') {
          s += '\\';
          i++;
        } else {
          s += c;
        }
        i++;
      }
      word = s;
    }
    if (checkWidth || checkHeight) {
      const sz = measure(word);
      ss.height = sz.h + heightPad;
      ss.width = sz.w + widthPad;
      heightSum += ss.height;
      widthSum += ss.width;
    }
    ss.line = word;
    out.push(ss);
  }

  if (checkWidth || checkHeight) {
    for (const ss of out) {
      ss.heightRatio = heightSum > 0 ? ss.height / heightSum : 1;
      ss.widthRatio = widthSum > 0 ? ss.width / widthSum : 1;
    }
  }
  return out.map((ss) => {
    const item: {
      word: string;
      startIcon?: string;
      endIcon?: string;
      endText?: string;
      width: number;
      height: number;
      widthRatio: number;
      heightRatio: number;
      indent: number;
      disabled: boolean;
      selected: boolean;
    } = {
      word: ss.line,
      width: ss.width,
      height: ss.height,
      widthRatio: ss.widthRatio,
      heightRatio: ss.heightRatio,
      indent: ss.indent,
      disabled: ss.disabled,
      selected: ss.selected,
    };
    if (ss.startIcon !== null) item.startIcon = trimC(ss.startIcon);
    if (ss.endIcon !== null) item.endIcon = trimC(ss.endIcon);
    if (ss.endText !== null) item.endText = trimC(ss.endText);
    return item;
  });
}
