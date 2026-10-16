// Character lookups for wrapping and paragraph direction, over the generated range tables.
import { BIDI_STRONG_RANGES } from './bidi-strong';
import { LB, LINE_BREAK_RANGES, type LineBreakClass } from './line-break-classes';

/** Binary search of a flat [start, end, value, …] table; 0 when `cp` is in no range. */
function lookup(table: readonly number[], cp: number): number {
  let lo = 0;
  let hi = table.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = table[mid * 3] ?? 0;
    const end = table[mid * 3 + 1] ?? 0;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return table[mid * 3 + 2] ?? 0;
  }
  return 0;
}

/** The UAX #14 class of `cp`, reduced to the classes the wrapper uses (`LB.Other` for the rest). */
export function lineBreakClass(cp: number): LineBreakClass {
  return lookup(LINE_BREAK_RANGES, cp) as LineBreakClass;
}

/** 1 = L, 2 = R or AL, 0 = not a strong type. */
export function bidiStrongType(cp: number): 0 | 1 | 2 {
  if (cp < 0x80) {
    return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? 1 : 0;
  }
  return lookup(BIDI_STRONG_RANGES, cp) as 0 | 1 | 2;
}

/**
 * White space a line may break after (spec 06 §3.2 rule 1): the C++ ASCII set (`' '`, `\t`,
 * `\v`, `\f`, `\r`; `\n` never reaches the wrapper) plus the Unicode spaces of UAX #14 class
 * BA/SP. No-break spaces (U+00A0, U+2007, U+202F) are not break points.
 */
export function isWrapSpace(cu: number): boolean {
  if (cu <= 0x20) return cu === 0x20 || cu === 0x09 || cu === 0x0b || cu === 0x0c || cu === 0x0d;
  if (cu < 0x1680) return false;
  return (
    cu === 0x1680 || (cu >= 0x2000 && cu <= 0x2006) || (cu >= 0x2008 && cu <= 0x200a) || cu === 0x205f || cu === 0x3000
  );
}

/** Classes a line may not start with after a rule-1 HY/BA/SY break (UAX #14 LB13, LB21). */
export function noBreakBefore(cls: LineBreakClass): boolean {
  return (
    cls === LB.CL ||
    cls === LB.CP ||
    cls === LB.EX ||
    cls === LB.IS ||
    cls === LB.SY ||
    cls === LB.HY ||
    cls === LB.BA ||
    cls === LB.NS
  );
}

/** Kinsoku (spec 06 §3.2 rule 4): a rule-2 break may not come before one of these. */
export function kinsokuNoStart(cls: LineBreakClass): boolean {
  return cls === LB.CL || cls === LB.CP || cls === LB.EX || cls === LB.IS || cls === LB.NS;
}

/**
 * Scripts written without spaces whose graphemes are break points (rule 2, CJK half), with the
 * CJK punctuation and fullwidth forms that sit among them.
 */
export const CJK_RE =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/** Scripts written without spaces that break at dictionary word boundaries (rule 2, Thai half). */
export const SEA_RE = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Any character of either group (a quick test before segmenting a line). */
export const NO_SPACE_SCRIPT_RE =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\u3000-\u303f\uff00-\uffef\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
