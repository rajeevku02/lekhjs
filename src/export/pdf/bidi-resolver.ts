// `BidiResolver` (spec 08 §6.2 step 3, spec 02 `BidiResolver`; spec 08's `BidiReorderer`): the
// Unicode bidi embedding levels of a laid-out line over `bidi-js`, with the base direction of the
// line's paragraph (`LaidOutLine.dir`, the same value the canvas sets as `ctx.direction`), and the
// visual order of a line's runs (UAX #9 rule L2). Runs are handed to PDFKit in logical order;
// fontkit shapes a strong right-to-left run and reverses its glyphs itself. A right-to-left run
// with no strong right-to-left character (neutrals between Arabic words) is reversed here, since
// fontkit lays it out left to right; mirrored characters (brackets) are mirrored in every
// right-to-left run (rule L4).
import type { BidiEngine } from './ports';

export class BidiResolver {
  private readonly bidi: BidiEngine;

  constructor(bidi: BidiEngine) {
    this.bidi = bidi;
  }

  /** The embedding level of every UTF-16 unit of `text` under the paragraph direction `dir`. */
  levels(text: string, dir: 'ltr' | 'rtl'): Uint8Array {
    if (text === '') return new Uint8Array(0);
    return this.bidi.getEmbeddingLevels(text, dir).levels;
  }

  /** Whether `text` has a strong right-to-left character, bidi class R or AL (fontkit then lays it out right to left). */
  hasStrongRtl(text: string): boolean {
    for (const ch of text) {
      const t = this.bidi.getBidiCharTypeName(ch);
      if (t === 'R' || t === 'AL') return true;
    }
    return false;
  }

  /**
   * The visual order (left to right) of runs with the given levels: from the highest level down
   * to the lowest odd level, every maximal sequence at that level or higher is reversed (L2).
   */
  static visualOrder(levels: readonly number[]): number[] {
    const order = levels.map((_, i) => i);
    if (levels.length < 2) return order;
    let max = 0;
    let minOdd = Infinity;
    for (const l of levels) {
      if (l > max) max = l;
      if (l % 2 === 1 && l < minOdd) minOdd = l;
    }
    if (minOdd === Infinity) return order;
    for (let level = max; level >= minOdd; level--) {
      let i = 0;
      while (i < order.length) {
        if ((levels[order[i] ?? 0] ?? 0) >= level) {
          let j = i;
          while (j + 1 < order.length && (levels[order[j + 1] ?? 0] ?? 0) >= level) j++;
          const seg = order.slice(i, j + 1).reverse();
          order.splice(i, seg.length, ...seg);
          i = j + 1;
        } else {
          i++;
        }
      }
    }
    return order;
  }

  /** `text` with every mirrored character replaced by its mirror (for a run at an odd level). */
  mirror(text: string): string {
    let out = '';
    for (const ch of text) out += this.bidi.getMirroredCharacter(ch) ?? ch;
    return out;
  }

  /**
   * The string handed to the font for a run at `level`: unchanged at an even level; at an odd
   * level mirrored, and also reversed by cluster when it holds no strong right-to-left character.
   */
  runText(clusters: readonly string[], level: number): string {
    const logical = clusters.join('');
    if (level % 2 === 0) return logical;
    if (this.hasStrongRtl(logical)) return this.mirror(logical);
    return this.mirror([...clusters].reverse().join(''));
  }
}
