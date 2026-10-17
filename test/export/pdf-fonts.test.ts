// AC-EXP-14: text in a bundled family is embedded from the bundled TTF as a subset font
// (`/FontFile2`, BaseFont `ABCDEF+<PostScript name>`), each face once; a face the family lacks
// (Noto Sans Mono and Caveat have no italic) is synthesised with a 12° skew. A platform or
// unknown family on the web takes the bundled default, Noto Sans.
import { describe, expect, it } from 'vitest';
import { boardSession, recordingSink, run } from './helpers';
import { parsePdf, pdfEnv, textBoard } from './pdf-helpers';

async function pdfOf(
  specs: Parameters<typeof textBoard>[0][number],
): Promise<{ raw: string; items: { str: string; transform: number[] }[] }> {
  const s = boardSession(textBoard([specs]), undefined, 'Fonts');
  const { sink, rec } = recordingSink();
  const r = await run(s, { format: 'pdf' }, pdfEnv(undefined, { sink }));
  expect(r.status).toBe('done');
  const bytes = rec.file('Fonts.pdf');
  const { pages, raw } = await parsePdf(bytes);
  return { raw, items: pages[0]?.items ?? [] };
}

function baseFonts(raw: string): string[] {
  return [...raw.matchAll(/\/BaseFont \/([A-Z]{6})\+([\w-]+)/g)]
    .map((m) => m[2] ?? '')
    .filter((v, i, a) => a.indexOf(v) === i);
}

describe('bundled fonts in the PDF (AC-EXP-14)', () => {
  it('each bundled face used is embedded once as a TrueType subset', async () => {
    const { raw, items } = await pdfOf([
      { text: 'Sans regular', cx: 200, cy: 40 },
      { text: 'Sans bold', cx: 200, cy: 90, bold: true },
      { text: 'Sans italic', cx: 200, cy: 140, italic: true },
      { text: 'Sans bold italic', cx: 200, cy: 190, bold: true, italic: true },
      { text: 'Serif text', cx: 200, cy: 240, family: 'Noto Serif' },
      { text: 'Mono text', cx: 200, cy: 290, family: 'Noto Sans Mono' },
      { text: 'Caveat text', cx: 200, cy: 340, family: 'Caveat' },
      { text: 'Sans again', cx: 200, cy: 390 },
    ]);
    expect(baseFonts(raw).sort()).toEqual(
      [
        'Caveat-Regular',
        'NotoSans-Bold',
        'NotoSans-BoldItalic',
        'NotoSans-Italic',
        'NotoSans-Regular',
        'NotoSansMono-Regular',
        'NotoSerif-Regular',
      ].sort(),
    );
    // Subset prefixes, embedded as /FontFile2 (TrueType), with a ToUnicode map (extractable text).
    expect(raw.match(/\/FontFile2/g)?.length).toBe(7);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/ToUnicode/);
    expect(items.map((i) => i.str)).toContain('Sans bold italic');
    // Real italic faces are not skewed.
    for (const it of items) expect(it.transform[2]).toBeCloseTo(0, 6);
  });

  it('italic of a family without an italic face is a 12° skew of the regular face', async () => {
    const { raw, items } = await pdfOf([
      { text: 'Mono italic', cx: 200, cy: 40, family: 'Noto Sans Mono', italic: true },
      { text: 'Caveat italic', cx: 200, cy: 90, family: 'Caveat', italic: true },
    ]);
    expect(baseFonts(raw).sort()).toEqual(['Caveat-Regular', 'NotoSansMono-Regular']);
    expect(items.map((i) => i.str)).toEqual(['Mono italic', 'Caveat italic']);
    // The text matrix leans right by tan 12° (c / d of the item's transform).
    const skew = Math.tan((12 * Math.PI) / 180);
    for (const it of items) expect((it.transform[2] ?? 0) / (it.transform[3] ?? 1)).toBeCloseTo(skew, 3);
  });

  it('a platform or unknown family on the web is drawn in Noto Sans', async () => {
    const { raw, items } = await pdfOf([
      { text: 'Helvetica text', cx: 200, cy: 40, family: 'Helvetica' },
      { text: 'Default text', cx: 200, cy: 90, family: '' },
    ]);
    expect(baseFonts(raw)).toEqual(['NotoSans-Regular']);
    expect(items.map((i) => i.str)).toEqual(['Helvetica text', 'Default text']);
  });
});
