// `TextRunSplitter` (spec 08 §6.2 step 1): cuts a laid-out line into grapheme clusters, each with
// its script and whether it is an emoji, and merges clusters into runs. A run ends where the
// covering font changes, where the script changes (Common and Inherited characters take their
// neighbour's script) and at an emoji boundary. Combining marks, ZWJ sequences, variation
// selectors and skin-tone modifiers stay in their base character's cluster (`Intl.Segmenter`
// graphemes). The PDF never wraps: the lines are the engine's.

/** One grapheme cluster of a line. UTF-16 offsets. */
export interface TextCluster {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The code points the font must have (default-ignorable joiners and selectors left out). */
  readonly needs: readonly number[];
  readonly emoji: boolean;
  /** The resolved Unicode script (`Latin`, `Arabic`, `Han`, …); `Common` only for an all-neutral line. */
  readonly script: string;
}

/** A contiguous span of clusters `[from, to)`. */
export interface ClusterSpan {
  readonly from: number;
  readonly to: number;
}

/** The scripts the splitter names (the Noto set of spec 08 §6.3 plus the common alphabets). */
const SCRIPT_TESTS: readonly (readonly [string, RegExp])[] = Object.freeze([
  ['Latin', /\p{Script=Latin}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Bopomofo', /\p{Script=Bopomofo}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Oriya', /\p{Script=Oriya}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Myanmar', /\p{Script=Myanmar}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Syriac', /\p{Script=Syriac}/u],
  ['Thaana', /\p{Script=Thaana}/u],
  ['Tibetan', /\p{Script=Tibetan}/u],
  ['Mongolian', /\p{Script=Mongolian}/u],
]);

const COMMON_RE = /[\p{Script=Common}\p{Script=Inherited}]/u;
/** Kana and Bopomofo run with Han: one CJK run, so a Japanese line asks for one font with its kana in the text. */
const HAN_GROUP: readonly string[] = Object.freeze(['Hiragana', 'Katakana', 'Bopomofo']);
const OTHER = 'Other';
const COMMON = 'Common';

const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;
const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE_RE = /^[0-9#*]$/u;
const MARK_RE = /\p{M}/u;

/** Code points a font need not map: ZWJ/ZWNJ, bidi controls, variation selectors, tags. */
function isDefaultIgnorable(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}

/** The Unicode script of one code point (`Common` for neutrals, `Other` for an unnamed script). */
export function scriptOf(cp: number): string {
  const ch = String.fromCodePoint(cp);
  if (COMMON_RE.test(ch)) return COMMON;
  for (const [name, re] of SCRIPT_TESTS) if (re.test(ch)) return name;
  return OTHER;
}

function groupScript(s: string): string {
  return HAN_GROUP.includes(s) ? 'Han' : s;
}

/** Whether a grapheme cluster is an emoji (drawn as an image on every host, spec 08 §6.1). */
export function isEmojiCluster(text: string): boolean {
  const cps = Array.from(text); // code points (the cluster is one grapheme already)
  const first = cps[0] ?? '';
  if (cps.includes('⃣')) return KEYCAP_BASE_RE.test(first);
  if (EMOJI_PRESENTATION_RE.test(first)) return true;
  if (cps.length > 1 && PICTOGRAPHIC_RE.test(first) && (cps.includes('️') || cps.includes('‍'))) return true;
  return false;
}

/** Grapheme clusters without `Intl.Segmenter`: a base code point plus its marks and joiners. */
function fallbackGraphemes(text: string): { segment: string; index: number }[] {
  const out: { segment: string; index: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    let cp = text.codePointAt(i) ?? 0;
    i += cp > 0xffff ? 2 : 1;
    for (;;) {
      if (i >= text.length) break;
      cp = text.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(cp);
      const prev = text.codePointAt(i - 1) ?? 0;
      if (MARK_RE.test(ch) || isDefaultIgnorable(cp) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || prev === 0x200d) {
        i += cp > 0xffff ? 2 : 1;
        continue;
      }
      break;
    }
    out.push({ segment: text.slice(start, i), index: start });
  }
  return out;
}

export class TextRunSplitter {
  private readonly segmenter: Intl.Segmenter | null;

  constructor() {
    this.segmenter =
      typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }

  /** The clusters of `text`, with Common/Inherited scripts resolved from their neighbours. */
  clusters(text: string): TextCluster[] {
    const segs = this.segmenter !== null ? [...this.segmenter.segment(text)] : fallbackGraphemes(text);
    const raw = segs.map((s) => {
      const cps = Array.from(s.segment, (c) => c.codePointAt(0) ?? 0); // code points of one grapheme
      const needs = cps.filter((cp) => !isDefaultIgnorable(cp));
      const base = cps[0] ?? 0;
      return {
        start: s.index,
        end: s.index + s.segment.length,
        text: s.segment,
        needs: needs.length > 0 ? needs : cps.slice(0, 1),
        emoji: isEmojiCluster(s.segment),
        script: groupScript(scriptOf(base)),
      };
    });
    // Neutrals take the script before them, else the one after (a line that starts with "(" or a digit).
    let prev: string | null = null;
    for (const c of raw) {
      if (c.script === COMMON) {
        if (prev !== null) c.script = prev;
      } else {
        prev = c.script;
      }
    }
    let next: string | null = null;
    for (let i = raw.length - 1; i >= 0; i--) {
      const c = raw[i];
      if (c === undefined) continue;
      if (c.script === COMMON) {
        if (next !== null) c.script = next;
      } else {
        next = c.script;
      }
    }
    return raw;
  }

  /**
   * Merges clusters into maximal spans whose `key` is equal (the caller's key holds the covering
   * font, the bidi level, the emoji flag and the script).
   */
  runs(clusters: readonly TextCluster[], key: (c: TextCluster, i: number) => string): ClusterSpan[] {
    const out: ClusterSpan[] = [];
    let from = 0;
    let k: string | null = null;
    clusters.forEach((c, i) => {
      const ck = key(c, i);
      if (k !== null && ck !== k) {
        out.push({ from, to: i });
        from = i;
      }
      k = ck;
    });
    if (clusters.length > 0) out.push({ from, to: clusters.length });
    return out;
  }
}
