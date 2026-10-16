// FontRegistry (spec 06 §7.3): the four bundled families in fixed order, case-insensitive find,
// faces with their files and hhea metrics from fonts.json, `ttfFor` for the PDF platform.
import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, DEFAULT_FONT_FAMILY, FontRegistry } from '../../src/text';
import { MANIFEST } from './helpers';

describe('FontRegistry', () => {
  const reg = FontRegistry.fromManifest(MANIFEST, (p) => `https://cdn.example/fonts/${p}`);

  it('the bundled set and order, also without the manifest', () => {
    const names = ['Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Caveat'];
    expect(reg.families().map((f) => f.family)).toEqual(names);
    expect(BUNDLED_FONTS.map((f) => f.family)).toEqual(names);
    expect(new FontRegistry().families().map((f) => f.generic)).toEqual([
      'sans-serif',
      'serif',
      'monospace',
      'cursive',
    ]);
    expect(DEFAULT_FONT_FAMILY).toBe('Noto Sans');
  });

  it('the static table agrees with fonts.json on generics, faces and metrics', () => {
    for (const fam of reg.families()) {
      const st = BUNDLED_FONTS.find((b) => b.family === fam.family);
      expect(st?.generic).toBe(fam.generic);
      expect(st?.faces.map((f) => [f.weight, f.style, f.ascender, f.descender, f.unitsPerEm])).toEqual(
        fam.faces.map((f) => [f.weight, f.style, f.ascender, f.descender, f.unitsPerEm]),
      );
    }
  });

  it('find is case-insensitive', () => {
    expect(reg.find('noto sans mono')?.family).toBe('Noto Sans Mono');
    expect(reg.find('Helvetica')).toBeUndefined();
  });

  it('ttfFor picks the face; Mono and Caveat have no italic and fall back to upright', () => {
    expect(reg.ttfFor('Noto Sans', 700, true)).toBe('https://cdn.example/fonts/noto-sans/NotoSans-BoldItalic.ttf');
    expect(reg.ttfFor('noto serif', 400, false)).toBe('https://cdn.example/fonts/noto-serif/NotoSerif-Regular.ttf');
    expect(reg.ttfFor('Caveat', 700, true)).toBe('https://cdn.example/fonts/caveat/Caveat-Bold.ttf');
    expect(reg.ttfFor('Noto Sans Mono', 600, false)).toBe(
      'https://cdn.example/fonts/noto-sans-mono/NotoSansMono-Bold.ttf',
    );
    expect(reg.ttfFor('Arial', 400, false)).toBeUndefined();
    expect(new FontRegistry().ttfFor('Noto Sans', 400, false)).toBeUndefined();
  });

  it('woff2 subsets carry their unicode ranges', () => {
    const face = reg.faceFor('Noto Sans', 400, false);
    expect(face?.woff2.map((w) => w.subset)).toEqual(['latin', 'latin-ext', 'greek', 'cyrillic', 'vietnamese']);
    expect(face?.woff2[0]?.unicodeRange.startsWith('U+0000-00FF')).toBe(true);
  });
});
