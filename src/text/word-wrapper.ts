// Greedy word wrap (port of C++ `TextUtil::getWidth`, `L/TextUtil.cpp:38-132`) with the break
// rules of spec 06 §3.2.
//
// The C++ algorithm is kept: a hard line that fits stays whole; otherwise the wrapper steps
// BACKWARDS from the end of the line over the break opportunities and takes the longest prefix
// whose width is ≤ wrapWidth + 0.001; the next line starts after the break, with leading white
// space dropped; repeat. With an additive width table this is exactly the C++ split for text
// that breaks only at white space (AC-TXT-05).
//
// Break opportunities (UTF-16 offsets; the C++ works on UTF-8 bytes with `isspace`):
//   1. after a run of white space (`isWrapSpace`), and after a character of UAX #14 class HY,
//      BA or SY when a non-space character follows that may start a line (not CL CP EX IS SY HY
//      BA NS), not HY/SY before a digit when a digit precedes (LB25), and not at a word start;
//   2. between graphemes of scripts written without spaces: CJK at grapheme boundaries, Thai,
//      Lao, Khmer and Myanmar at dictionary word boundaries (`Intl.Segmenter`);
//   3. an unbreakable piece wider than the line breaks at a grapheme boundary;
//   4. kinsoku: a rule-2 break never comes before CL CP EX IS NS (incl. small kana and ー) nor
//      after OP; it moves to the previous allowed boundary.
// Rules 1 (HY/BA/SY part) and 2-4 are DR-TXT-03; the C++ breaks only at white space and never
// breaks a word.
import { LB } from './line-break-classes';
import {
  CJK_RE,
  NO_SPACE_SCRIPT_RE,
  SEA_RE,
  isWrapSpace,
  kinsokuNoStart,
  lineBreakClass,
  noBreakBefore,
} from './unicode';

/** C++ `canFit` tolerance. */
export const WRAP_EPSILON = 0.001;

/** One wrapped line. Offsets are UTF-16 indices into the text given to `wrap`. */
export interface WrappedLine {
  readonly text: string;
  readonly width: number;
  /** Offset of the line's first character. */
  readonly start: number;
  /** Offset just past the line's last character. */
  readonly end: number;
  /** Index of the hard line (paragraph) the line belongs to. */
  readonly paragraph: number;
}

interface Break {
  /** The line before the break ends here (exclusive). */
  readonly segEnd: number;
  /** The next line starts here (before white space is skipped). */
  readonly nextStart: number;
}

/**
 * Hard lines as C++ `TextUtil::lines` (`std::getline`): split on `\n`, a final `\n` adds no
 * empty line, and empty text is one empty line (B5: the C++ read `widths[0]` of none).
 */
export function splitHardLines(text: string): string[] {
  const parts = text.split('\n');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function codePointBefore(s: string, i: number): number {
  const lo = s.charCodeAt(i - 1);
  if (i >= 2 && lo >= 0xdc00 && lo <= 0xdfff) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.codePointAt(i - 2) ?? lo;
  }
  return lo;
}

function cpLen(cp: number): number {
  return cp > 0xffff ? 2 : 1;
}

function isAsciiDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

export class WordWrapper {
  private graphemeSeg: Intl.Segmenter | null = null;
  private wordSeg: Intl.Segmenter | null = null;

  /**
   * Wraps `text` to `wrapWidth` (≤ 0: no wrapping), measuring through `measure`. Every hard
   * line gives at least one line; an empty one measures as the empty string.
   */
  wrap(text: string, wrapWidth: number, measure: (s: string) => number): WrappedLine[] {
    const out: WrappedLine[] = [];
    let offset = 0;
    splitHardLines(text).forEach((line, paragraph) => {
      for (const l of this.wrapLine(line, wrapWidth, measure)) {
        out.push({ text: l.text, width: l.width, start: l.start + offset, end: l.end + offset, paragraph });
      }
      offset += line.length + 1;
    });
    return out;
  }

  /** Wraps one hard line (no `\n`). Offsets are relative to `line`. */
  wrapLine(line: string, wrapWidth: number, measure: (s: string) => number): WrappedLine[] {
    const len = line.length;
    const fits = (w: number) => wrapWidth <= 0 || w <= wrapWidth + WRAP_EPSILON;
    const whole = measure(line);
    if (len === 0 || fits(whole)) return [{ text: line, width: whole, start: 0, end: len, paragraph: 0 }];

    const breaks = this.breakOpportunities(line);
    const out: WrappedLine[] = [];
    let start = 0;
    let remWidth = whole;
    for (;;) {
      if (fits(remWidth)) {
        out.push({ text: line.slice(start), width: remWidth, start, end: len, paragraph: 0 });
        break;
      }
      // Step backwards over the opportunities after `start`, as the C++ does.
      let first = -1;
      let chosen: Break | null = null;
      let chosenWidth = 0;
      for (let i = breaks.length - 1; i >= 0; i--) {
        const b = breaks[i];
        if (b === undefined || b.segEnd <= start) {
          first = i + 1;
          break;
        }
        first = i;
        const w = measure(line.slice(start, b.segEnd));
        if (fits(w)) {
          chosen = b;
          chosenWidth = w;
          break;
        }
      }
      let next: number;
      if (chosen !== null) {
        out.push({
          text: line.slice(start, chosen.segEnd),
          width: chosenWidth,
          start,
          end: chosen.segEnd,
          paragraph: 0,
        });
        next = chosen.nextStart;
      } else {
        // Nothing fits: the first piece is wider than the line (rule 3: break it at a grapheme).
        const firstBreak = first >= 0 ? breaks[first] : undefined;
        const pieceEnd = firstBreak !== undefined && firstBreak.segEnd > start ? firstBreak.segEnd : len;
        // Only trailing white space overflows: the C++ keeps the piece whole (spaces included).
        let trimmed = pieceEnd;
        while (trimmed > start && isWrapSpace(line.charCodeAt(trimmed - 1))) trimmed--;
        const cut =
          trimmed < pieceEnd && fits(measure(line.slice(start, trimmed)))
            ? { end: pieceEnd, width: measure(line.slice(start, pieceEnd)) }
            : this.graphemeCut(line, start, pieceEnd, wrapWidth, measure);
        if (cut.end < pieceEnd) {
          out.push({ text: line.slice(start, cut.end), width: cut.width, start, end: cut.end, paragraph: 0 });
          next = cut.end;
        } else {
          out.push({ text: line.slice(start, pieceEnd), width: cut.width, start, end: pieceEnd, paragraph: 0 });
          if (pieceEnd >= len) break;
          next = firstBreak !== undefined ? firstBreak.nextStart : len;
        }
      }
      start = next;
      while (start < len && isWrapSpace(line.charCodeAt(start))) start++;
      if (start >= len) break;
      remWidth = measure(line.slice(start));
    }
    return out;
  }

  /**
   * The longest grapheme prefix of `line[start, end)` that fits (at least one grapheme), and its
   * width. Graphemes keep emoji sequences and combining marks whole.
   */
  private graphemeCut(
    line: string,
    start: number,
    end: number,
    wrapWidth: number,
    measure: (s: string) => number,
  ): { end: number; width: number } {
    const bounds = this.graphemeBoundaries(line.slice(start, end)).map((b) => b + start);
    let best = -1;
    let bestW = 0;
    for (const b of bounds) {
      if (b <= start) continue;
      const w = measure(line.slice(start, b));
      if (w <= wrapWidth + WRAP_EPSILON) {
        best = b;
        bestW = w;
        continue;
      }
      if (best < 0) {
        // A single grapheme wider than the line: it stands alone.
        best = b;
        bestW = w;
      }
      break;
    }
    return best < 0 ? { end, width: measure(line.slice(start, end)) } : { end: best, width: bestW };
  }

  /** Grapheme boundaries of `s` (exclusive ends, the last = s.length). */
  private graphemeBoundaries(s: string): number[] {
    const out: number[] = [];
    if (/^[\x20-\x7e]*$/.test(s)) {
      for (let i = 1; i <= s.length; i++) out.push(i);
      return out;
    }
    this.graphemeSeg ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const seg of this.graphemeSeg.segment(s)) out.push(seg.index + seg.segment.length);
    return out;
  }

  /** Every break opportunity of a hard line, sorted by `segEnd`. Exposed for tests. */
  breakOpportunities(line: string): Break[] {
    const len = line.length;
    const byEnd = new Map<number, Break>();

    // Rule 1a: after a run of white space, with something before and after it.
    let i = 0;
    while (i < len) {
      if (isWrapSpace(line.charCodeAt(i))) {
        const a = i;
        while (i < len && isWrapSpace(line.charCodeAt(i))) i++;
        if (a > 0 && i < len) byEnd.set(a, { segEnd: a, nextStart: i });
      } else {
        i++;
      }
    }

    // Rule 1b: after HY / BA / SY.
    for (let p = 0; p < len;) {
      const cp = line.codePointAt(p) ?? 0;
      const n = cpLen(cp);
      const after = p + n;
      if (cp > 0x20 && after < len && p > 0) {
        const cls = lineBreakClass(cp);
        if (
          (cls === LB.HY || cls === LB.SY || cls === LB.BA) &&
          !isWrapSpace(cp) &&
          !isWrapSpace(line.charCodeAt(p - 1)) &&
          !isWrapSpace(line.charCodeAt(after))
        ) {
          const next = line.codePointAt(after) ?? 0;
          const prev = codePointBefore(line, p);
          const nextCls = lineBreakClass(next);
          const digitRule =
            (cls === LB.HY || cls === LB.SY) &&
            nextCls === LB.NU &&
            (cls === LB.HY || isAsciiDigit(prev) || lineBreakClass(prev) === LB.NU);
          if (!noBreakBefore(nextCls) && !digitRule && !byEnd.has(after)) {
            byEnd.set(after, { segEnd: after, nextStart: after });
          }
        }
      }
      p = after;
    }

    // Rules 2 and 4: scripts written without spaces.
    if (NO_SPACE_SCRIPT_RE.test(line)) {
      for (const b of this.noSpaceScriptBreaks(line)) {
        if (!byEnd.has(b)) byEnd.set(b, { segEnd: b, nextStart: b });
      }
    }

    return [...byEnd.values()].sort((x, y) => x.segEnd - y.segEnd);
  }

  private noSpaceScriptBreaks(line: string): number[] {
    const out: number[] = [];
    this.graphemeSeg ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes = [...this.graphemeSeg.segment(line)].map((g) => ({ index: g.index, text: g.segment }));
    for (let k = 1; k < graphemes.length; k++) {
      const g1 = graphemes[k - 1];
      const g2 = graphemes[k];
      if (g1 === undefined || g2 === undefined) continue;
      if (!(CJK_RE.test(g1.text) || CJK_RE.test(g2.text))) continue;
      if (isWrapSpace(g1.text.charCodeAt(g1.text.length - 1)) || isWrapSpace(g2.text.charCodeAt(0))) continue;
      // Kinsoku (rule 4).
      if (kinsokuNoStart(lineBreakClass(g2.text.codePointAt(0) ?? 0))) continue;
      if (lineBreakClass(codePointBefore(g1.text, g1.text.length)) === LB.OP) continue;
      out.push(g2.index);
    }
    if (SEA_RE.test(line)) {
      this.wordSeg ??= new Intl.Segmenter(undefined, { granularity: 'word' });
      for (const w of this.wordSeg.segment(line)) {
        const b = w.index;
        if (b <= 0 || b >= line.length) continue;
        const before = line.slice(Math.max(0, b - 2), b);
        const after = line.slice(b, b + 2);
        if (!(SEA_RE.test(before) || SEA_RE.test(after))) continue;
        if (isWrapSpace(line.charCodeAt(b - 1)) || isWrapSpace(line.charCodeAt(b))) continue;
        if (noBreakBefore(lineBreakClass(line.codePointAt(b) ?? 0))) continue;
        out.push(b);
      }
    }
    return out;
  }
}
