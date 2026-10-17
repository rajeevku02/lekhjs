// AC-EXP-08, AC-EXP-09: the PDF is vector — pdf.js finds every label of the board in
// `getTextContent()` and no full-page image — and each page's MediaBox is `width/2 × height/2`
// points of the exported region, every page in one file. Over the C++-written fixture boards
// and targeted boards.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planExport, type ExportOptions } from '../../src/export';
import { TextCollectingPlatform } from '../../src/export/pdf';
import type { BoardSession } from '../../src/session';
import { CORE_FIXTURES } from '../io/helpers';
import { boardSession, fixtureSession, rectBoard, recordingSink, run } from './helpers';
import { OPS, parsePdf, pdfEnv, textBoard, type ParsedPage } from './pdf-helpers';

const OPTS: ExportOptions = { format: 'pdf', region: 'full', padding: 0, scale: 1, includeBackground: false };

async function exportPdf(s: BoardSession, name: string, opts: Partial<ExportOptions> = {}): Promise<Uint8Array> {
  const { sink, rec } = recordingSink();
  const r = await run(s, { ...OPTS, ...opts }, pdfEnv(undefined, { sink }));
  expect(r.status).toBe('done');
  expect(rec.names).toEqual([name]);
  return rec.file(name);
}

/** The engine's laid-out lines of every planned page. */
function labelsOf(s: BoardSession): string[][] {
  return planExport(s, OPTS).map((plan) => {
    const c = new TextCollectingPlatform();
    s.drawForExport(c, plan.pageIndex, false, { scale: 1, tx: plan.translateX, ty: plan.translateY });
    return c.texts.flatMap((t) => t.text.lines.map((l) => l.text));
  });
}

const squash = (s: string): string => s.replace(/\s+/g, '');

/** Image XObjects drawn on the page with the area they cover (from the CTM pdf.js reports). */
function imagePaints(p: ParsedPage): number {
  return p.ops.filter((o) => o.fn === OPS.paintImageXObject || o.fn === OPS.paintInlineImageXObject).length;
}

const BOARDS = readdirSync(path.join(CORE_FIXTURES, 'boards'))
  .filter((f) => f.endsWith('.lekh'))
  .map((f) => `boards/${f}`);

describe('PDF structure (AC-EXP-08, AC-EXP-09)', () => {
  it.each(BOARDS)('%s: every label is extractable text, no image, MediaBox = size / 2', async (file) => {
    const s = fixtureSession(file);
    const name = `${s.document.name.trim() === '' ? 'drawing' : s.document.name.trim()}.pdf`;
    const bytes = await exportPdf(s, name);
    const { pages, raw } = await parsePdf(bytes);
    const plans = planExport(s, OPTS);
    expect(pages.length).toBe(plans.length);
    const labels = labelsOf(s);
    pages.forEach((p, i) => {
      const plan = plans[i];
      if (plan === undefined) throw new Error('plan');
      expect(p.view[2]).toBeCloseTo(plan.width / 2, 3);
      expect(p.view[3]).toBeCloseTo(plan.height / 2, 3);
      const text = squash(p.items.map((it) => it.str).join(''));
      for (const l of labels[i] ?? []) expect(text).toContain(squash(l));
      expect(imagePaints(p)).toBe(0);
    });
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).not.toMatch(/\/Subtype \/Image/);
  });

  it('the fixture boards hold labels to find', () => {
    const counts = BOARDS.map((f) => labelsOf(fixtureSession(f)).flat().length);
    expect(counts.filter((n) => n > 0).length).toBeGreaterThanOrEqual(5);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });

  it('all pages are in one file, each MediaBox its own page size; fixed pages export the full canvas', async () => {
    const board = textBoard(
      [
        [{ text: 'First page', cx: 100, cy: 50 }],
        [{ text: 'Second page', cx: 300, cy: 200 }],
        [{ text: 'Third', cx: 50, cy: 50 }],
      ],
      { fixed: true },
    );
    const s = boardSession(board, undefined, 'Three');
    const bytes = await exportPdf(s, 'Three.pdf', { region: 'drawing', padding: 10 });
    const { pages } = await parsePdf(bytes);
    expect(pages.length).toBe(3);
    for (const p of pages) expect(p.view).toEqual([0, 0, 400, 300]); // 800 × 600 board points, region ignored
    expect(pages.map((p) => p.items.map((i) => i.str).join(''))).toEqual(['First page', 'Second page', 'Third']);
  });

  it('an infinite page is its drawing area plus padding, halved', async () => {
    const s = boardSession(rectBoard([{ rects: [[100, 100, 50, 30]] }]), undefined, 'Rect');
    const plan = planExport(s, { ...OPTS, padding: 20 })[0];
    const bytes = await exportPdf(s, 'Rect.pdf', { padding: 20 });
    const { pages } = await parsePdf(bytes);
    expect(plan).toBeDefined();
    expect(pages[0]?.view[2]).toBeCloseTo((plan?.width ?? 0) / 2, 3);
    expect(pages[0]?.view[3]).toBeCloseTo((plan?.height ?? 0) / 2, 3);
    // Vector: the rectangle is a path, not an image.
    expect(imagePaints(pages[0] as ParsedPage)).toBe(0);
    expect(pages[0]?.ops.some((o) => o.fn === OPS.constructPath)).toBe(true);
  });

  it('a line string equals the engine line, in order, at the engine baseline and alignment', async () => {
    const s = boardSession(
      textBoard([
        [
          { text: 'Left aligned', cx: 200, cy: 60, align: 0 },
          { text: 'Centred text', cx: 200, cy: 140, align: 1 },
          { text: 'Right aligned', cx: 200, cy: 220, align: 2 },
          { text: 'two\nlines', cx: 200, cy: 320 },
        ],
      ]),
      undefined,
      'Lines',
    );
    const plan = planExport(s, OPTS)[0];
    if (plan === undefined) throw new Error('plan');
    const c = new TextCollectingPlatform();
    s.drawForExport(c, 0, false, { scale: 1, tx: plan.translateX, ty: plan.translateY });
    const bytes = await exportPdf(s, 'Lines.pdf');
    const { pages } = await parsePdf(bytes);
    const items = pages[0]?.items ?? [];
    const lines = c.texts.flatMap((t) => t.text.lines.map((l) => ({ l, t: t.text })));
    expect(items.map((i) => i.str)).toEqual(lines.map((x) => x.l.text));
    for (const [k, { l, t }] of lines.entries()) {
      const it = items[k];
      if (it === undefined) throw new Error('item');
      // Baseline: the engine's (board units + translate) at the 0.5 scale.
      expect(it.y).toBeCloseTo((l.baselineY + plan.translateY) / 2, 1);
      // Start x by alignment, with the PDF-measured width.
      const w = it.width * 2;
      const x0 = t.align === 'left' ? l.x : t.align === 'right' ? l.x - w : l.x - w / 2;
      expect(Math.abs(it.x - (x0 + plan.translateX) / 2)).toBeLessThan(0.5);
    }
  });
});
