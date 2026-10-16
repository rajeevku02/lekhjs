// A `TextMeasurer` that answers from recorded advances instead of a font (spec 06 §3.2,
// AC-TXT-05, AC-TXT-31): a line's width is the sum of its graphemes' advances.
//
// - `fromWidthTable`: per-character advances (e.g. one TTF's advance widths, written to JSON),
//   the AC-TXT-05 golden's table, which the C++ capture uses too;
// - `fromNativeDump`: the H-TXT-2 wrap dump, which records the native (TextKit / StaticLayout)
//   advance of every grapheme of each case, so `WordWrapper` replays the native wrap without SF
//   or Roboto. A mismatch is then a rule difference, not a font difference.
//
// Ascent and descent are 0.8 / 0.2 of the key's pixel size (the OQ-38 fallback).
import { fontPx, type LineMetrics, type TextMeasurer } from '../text';

/** One case of the native wrap dump (`lekhjs/test/text/fixtures/native-wrap/*.json`). */
export interface NativeWrapCase {
  readonly text: string;
  /** The native advance of every grapheme of `text`, in order. */
  readonly advances: readonly number[];
}

export class RecordedWidthMeasurer implements TextMeasurer {
  private readonly table: ReadonlyMap<string, number>;
  private readonly fallback: number | undefined;
  private readonly seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  private calls_ = 0;
  /** Graphemes that were measured without a recorded advance. */
  readonly unknown = new Set<string>();
  /** Graphemes the dump recorded with more than one advance (first one kept). */
  readonly conflicts = new Set<string>();

  /**
   * @param table grapheme → advance
   * @param fallback the advance of a grapheme not in the table; when absent, such a grapheme throws
   */
  constructor(table: ReadonlyMap<string, number>, fallback?: number) {
    this.table = table;
    this.fallback = fallback;
  }

  /** Per-character advances: `{ "a": 8.1, " ": 3.9, … }`. */
  static fromWidthTable(table: Readonly<Record<string, number>>, fallback?: number): RecordedWidthMeasurer {
    return new RecordedWidthMeasurer(new Map(Object.entries(table)), fallback);
  }

  /** The advances of a native wrap dump, merged over its cases. */
  static fromNativeDump(cases: readonly NativeWrapCase[], fallback?: number): RecordedWidthMeasurer {
    const table = new Map<string, number>();
    const conflicts = new Set<string>();
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const c of cases) {
      const graphemes = [...seg.segment(c.text)].map((s) => s.segment);
      if (graphemes.length !== c.advances.length) {
        throw new RangeError(
          `native wrap case has ${String(graphemes.length)} graphemes but ${String(c.advances.length)} advances`,
        );
      }
      graphemes.forEach((g, i) => {
        const a = c.advances[i] ?? 0;
        const had = table.get(g);
        if (had === undefined) table.set(g, a);
        else if (Math.abs(had - a) > 1e-6) conflicts.add(g);
      });
    }
    const m = new RecordedWidthMeasurer(table, fallback);
    for (const g of conflicts) m.conflicts.add(g);
    return m;
  }

  get calls(): number {
    return this.calls_;
  }

  measureLine(text: string, fontKey: string): LineMetrics {
    this.calls_++;
    let width = 0;
    for (const { segment } of this.seg.segment(text)) {
      const a = this.table.get(segment);
      if (a !== undefined) {
        width += a;
        continue;
      }
      this.unknown.add(segment);
      if (this.fallback === undefined) throw new RangeError(`no recorded advance for U+${hex(segment)}`);
      width += this.fallback;
    }
    const px = fontPx(fontKey);
    const size = Number.isFinite(px) ? px : 0;
    return { width, ascent: 0.8 * size, descent: 0.2 * size };
  }
}

function hex(s: string): string {
  return Array.from(s, (c) => (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join(' U+');
}
