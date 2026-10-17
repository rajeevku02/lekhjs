// AC-EXP-17 (unit half) and AC-EXP-33: a run no font covers is drawn as an image at its position
// with `font_unavailable` (the font toast); an emoji run is always an image, counted as
// `run_as_image` with `detail: 'emoji'` and no font toast; no PDF holds an uncovered glyph. The
// image is 4 px per board unit, and an emoji repeated 20 times on a page is one image XObject.
import { describe, expect, it } from 'vitest';
import { RUN_IMAGE_SCALE, RunImageFallback, scaledFont } from '../../src/export/pdf';
import { boardSession, napiFactory, recordingSink, run } from './helpers';
import { OPS, bundledSource, imageCount, parsePdf, pdfEnv, textBoard, type TextSpec } from './pdf-helpers';

async function exportOf(specs: readonly TextSpec[], name = 'Img') {
  const s = boardSession(textBoard([specs]), undefined, name);
  const { sink, rec } = recordingSink();
  const r = await run(s, { format: 'pdf' }, pdfEnv([bundledSource()], { sink }));
  if (r.status !== 'done') throw new Error(JSON.stringify(r));
  const parsed = await parsePdf(rec.file(`${name}.pdf`));
  const page = parsed.pages[0];
  return {
    raw: parsed.raw,
    warnings: r.warnings,
    texts: (page?.items ?? []).map((i) => i.str),
    paints: (page?.ops ?? []).filter((o) => o.fn === OPS.paintImageXObject).length,
  };
}

describe('the image fallback (AC-EXP-17, AC-EXP-33)', () => {
  it('an uncovered run (no font for it) is an image; the warning toasts', async () => {
    const r = await exportOf([{ text: 'Hello مرحبا', cx: 200, cy: 50 }]);
    expect(r.texts).toEqual(['Hello']);
    expect(imageCount(r.raw)).toBe(1);
    expect(r.paints).toBe(1);
    expect(r.warnings).toEqual([
      { code: 'font_unavailable', count: 1 },
      { code: 'run_as_image', count: 1 },
    ]);
  });

  it('an emoji run is an image without the font warning', async () => {
    const r = await exportOf([{ text: 'Party 🎉 time', cx: 200, cy: 50 }]);
    expect(r.texts.join('').replace(/\s+/g, ' ')).toBe('Party time');
    expect(r.paints).toBe(1);
    expect(r.warnings).toEqual([{ code: 'run_as_image', count: 1, detail: 'emoji' }]);
  });

  it('an emoji repeated 20 times on a page is one image XObject drawn 20 times', async () => {
    const r = await exportOf([{ text: Array.from({ length: 20 }, () => '😀').join(' '), cx: 400, cy: 50, w: 900 }]);
    expect(imageCount(r.raw)).toBe(1);
    expect(r.paints).toBe(20);
  });

  it('ZWJ sequences, flags, keycaps and skin tones are single emoji images', async () => {
    const r = await exportOf([{ text: 'a 👩‍💻 b 🇮🇳 c 1️⃣ d 👍🏽 e', cx: 300, cy: 50, w: 600 }]);
    expect(r.texts.join('').replace(/\s+/g, '')).toBe('abcde');
    expect(r.paints).toBe(4);
    expect(r.warnings).toEqual([{ code: 'run_as_image', count: 4, detail: 'emoji' }]);
  });

  it('a fallback image is 4 pixels per board unit and sits on the baseline', async () => {
    const f = new RunImageFallback(napiFactory());
    const font = 'normal 400 20px "Noto Sans", sans-serif';
    const img = await f.render('😀', font, 20, 'rgb(0, 0, 0)', false);
    expect(img).not.toBeNull();
    if (img === null) return;
    expect(RUN_IMAGE_SCALE).toBe(4);
    expect(img.pixelWidth / img.width).toBeCloseTo(4, 6);
    expect(img.pixelHeight / img.height).toBeCloseTo(4, 6);
    // The em box is at least 4 × 20 px tall; the baseline sits inside the image.
    expect(img.pixelHeight).toBeGreaterThanOrEqual(80);
    expect(img.top).toBeGreaterThan(0);
    expect(img.top).toBeLessThan(img.height);
    expect(img.advance).toBeGreaterThan(0);
    // Rendered once per key.
    expect(f.get('😀', font, 'rgb(0, 0, 0)', false)).toBe(img);
    expect(await f.render('😀', font, 20, 'rgb(0, 0, 0)', false)).toBe(img);
  });

  it('scaledFont multiplies the px size only', () => {
    expect(scaledFont('italic 700 12.5px "Noto Sans", sans-serif', 4)).toBe('italic 700 50px "Noto Sans", sans-serif');
  });
});
