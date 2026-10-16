// AC-TXT-14: every family name in every generated font string is quoted and generic keywords are
// not — a property test over names with digits, spaces, quotes, backslashes and non-ASCII,
// parsed back with a CSS font-family tokenizer. Also: the font key carries the stretch, and a
// quoted `Bodoni 72` is accepted by @napi-rs/canvas (DR-TXT-08).
import { describe, expect, it } from 'vitest';
import { FontStyle, FontWeight } from '../../src/style';
import {
  FontNameResolver,
  FontRegistry,
  GENERIC_FAMILIES,
  buildCanvasFont,
  buildFontKey,
  quoteFamily,
  splitFontKey,
  type ResolvedFont,
} from '../../src/text';
import { napiContext, prng, registerBundledFonts } from './helpers';

/** CSS font-family list tokenizer: quoted strings (with escapes) and bare identifiers. */
function parseFamilies(list: string): { value: string; quoted: boolean }[] {
  const out: { value: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < list.length) {
    while (list[i] === ' ' || list[i] === ',') i++;
    if (i >= list.length) break;
    if (list[i] === '"') {
      let v = '';
      i++;
      while (i < list.length && list[i] !== '"') {
        if (list[i] === '\\') i++;
        v += list[i] ?? '';
        i++;
      }
      i++;
      out.push({ value: v, quoted: true });
    } else {
      let v = '';
      while (i < list.length && list[i] !== ',') v += list[i++] ?? '';
      out.push({ value: v.trim(), quoted: false });
    }
  }
  return out;
}

const ALPHABET = ['a', 'Z', '7', ' ', '"', '\\', "'", ',', '-', 'é', '字', '😀', 'x'];

describe('font strings (AC-TXT-14)', () => {
  it('names round-trip quoted; the six generics appear unquoted', () => {
    const rnd = prng(14);
    const resolver = new FontNameResolver('web', new FontRegistry(), { families: () => [], isAvailable: () => true });
    for (let i = 0; i < 500; i++) {
      let name = '';
      const n = 1 + Math.floor(rnd() * 12);
      for (let k = 0; k < n; k++) name += ALPHABET[Math.floor(rnd() * ALPHABET.length)] ?? '';
      if (name.trim() === '' || ['sans', 'serif', 'monospace', 'system'].includes(name.trim().toLowerCase())) continue;
      const r = resolver.resolve({ family: name, modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal });
      const font = buildCanvasFont(r, 15);
      const list = font.replace(/^\S+ \S+ \S+px /, '');
      const fams = parseFamilies(list);
      expect(fams[0]).toEqual({ value: name.trim(), quoted: true });
      expect(fams.at(-1)).toEqual({ value: 'sans-serif', quoted: false });
    }
    for (const g of GENERIC_FAMILIES) {
      const r: ResolvedFont = {
        families: ['"A"', g],
        weight: 400,
        style: 'normal',
        stretch: 'normal',
        source: 'platform',
        primary: 'A',
      };
      expect(parseFamilies(buildCanvasFont(r, 10).replace(/^\S+ \S+ \S+px /, '')).at(-1)).toEqual({
        value: g,
        quoted: false,
      });
    }
  });

  it('quoteFamily escapes backslashes and quotes', () => {
    expect(quoteFamily('Bodoni 72')).toBe('"Bodoni 72"');
    expect(quoteFamily('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('the string is `${style} ${weight} ${px}px ${families}`', () => {
    const r: ResolvedFont = {
      families: ['"Noto Sans"', 'sans-serif'],
      weight: 700,
      style: 'italic',
      stretch: 'normal',
      source: 'bundled',
      primary: 'Noto Sans',
    };
    expect(buildCanvasFont(r, 15)).toBe('italic 700 15px "Noto Sans", sans-serif');
    expect(buildFontKey(r, 15)).toBe('italic 700 15px "Noto Sans", sans-serif');
    expect(buildFontKey({ ...r, stretch: 'condensed' }, 15)).toBe('italic 700 15px "Noto Sans", sans-serif|condensed');
    expect(splitFontKey('italic 700 15px "Noto Sans", sans-serif|condensed')).toEqual({
      font: 'italic 700 15px "Noto Sans", sans-serif',
      stretch: 'condensed',
    });
    expect(splitFontKey('normal 400 15px "a|b", sans-serif').stretch).toBe('normal');
  });

  it('a quoted "Bodoni 72" is a valid canvas font on @napi-rs/canvas (DR-TXT-08)', () => {
    registerBundledFonts();
    const ctx = napiContext();
    ctx.font = 'normal 400 20px "Bodoni 72", sans-serif';
    expect(ctx.font).toBe('normal 400 20px "Bodoni 72", sans-serif');
  });
});
