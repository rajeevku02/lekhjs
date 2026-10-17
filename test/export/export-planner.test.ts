// `planExport` (spec 08 §2.1, §5.1): C++ `ExportInputBuilder::makeInput` page sizes, translations
// and file names (AC-EXP-02, AC-EXP-03 rules; the C++ golden is svg-golden.test.ts's plans), and
// the skipped zero-size page (AC-EXP-37).
import { describe, expect, it } from 'vitest';
import { planExport, planExportDetail, type ExportOptions } from '../../src/export';
import { boardSession, env, fixtureSession, rectBoard, run } from './helpers';

const opts = (o: Partial<ExportOptions> & Pick<ExportOptions, 'format'>): ExportOptions => ({
  region: 'full',
  padding: 0,
  scale: 1,
  includeBackground: false,
  ...o,
});

describe('page sizes (AC-EXP-02)', () => {
  const s = boardSession(
    rectBoard([
      { name: 'Fixed', type: 'fixed', rects: [[100, 100, 40, 20]] },
      { name: 'Inf', type: 'infinite', rects: [[200, 150, 100, 50]] },
    ]),
  );

  it('a fixed page exports the canvas for region full, and for PDF whatever the region', () => {
    for (const o of [
      opts({ format: 'png', region: 'full' }),
      opts({ format: 'pdf', region: 'drawing', padding: 20 }),
    ]) {
      const [fixed] = planExport(s, { ...o, pageIndexes: [0] });
      expect(fixed).toMatchObject({ width: 400, height: 300, translateX: 0, translateY: 0 });
    }
  });

  it('a fixed page with region drawing is the drawing area plus padding', () => {
    const [p] = planExport(s, opts({ format: 'png', region: 'drawing', padding: 20, pageIndexes: [0] }));
    // The rectangle's bounds are its box inflated by half the stroke width (1 → 0.5).
    expect(p?.width).toBeCloseTo(40 + 1 + 40, 6);
    expect(p?.height).toBeCloseTo(20 + 1 + 40, 6);
    expect(p?.translateX).toBeCloseTo(-(80 - 0.5 - 20), 6);
    expect(p?.translateY).toBeCloseTo(-(90 - 0.5 - 20), 6);
  });

  it('an infinite page is always the drawing area plus padding, for every format and region', () => {
    for (const format of ['pdf', 'png', 'jpg', 'svg'] as const) {
      for (const region of ['full', 'drawing'] as const) {
        const [p] = planExport(s, opts({ format, region, padding: 10, pageIndexes: [1] }));
        expect(p?.width).toBeCloseTo(101 + 20, 6);
        expect(p?.height).toBeCloseTo(51 + 20, 6);
        expect(p?.translateX).toBeCloseTo(-(149.5 - 10), 6);
        expect(p?.translateY).toBeCloseTo(-(124.5 - 10), 6);
      }
    }
  });

  it('padding is truncated to whole points, as the C++ int', () => {
    const [p] = planExport(s, opts({ format: 'png', padding: 10.9, pageIndexes: [1] }));
    expect(p?.width).toBeCloseTo(101 + 20, 6);
  });

  it('the fixture pages: fixed sizes in points, inches and cm (144 board points per inch)', () => {
    const c = fixtureSession('pages/canvases.lekh');
    const plans = planExport(c, opts({ format: 'png', region: 'full' }));
    const byName = new Map(plans.map((p) => [c.document.pages[p.pageIndex]?.name, p]));
    expect(byName.get('Fixed')).toMatchObject({ width: 1224, height: 1584 });
    expect(byName.get('Fixed in inches')).toMatchObject({ width: 8.5 * 144, height: 11 * 144 });
    expect(byName.get('Fixed in cm with margin')?.width).toBeCloseTo((21 / 2.54) * 144, 3);
  });
});

describe('file names (AC-EXP-03 rules)', () => {
  const pages = [
    { name: 'Overview', rects: [[0, 0, 10, 10]] as const },
    { name: '  ', rects: [[0, 0, 10, 10]] as const },
    { name: 'Overview', rects: [[0, 0, 10, 10]] as const },
    { name: 'Detail ', rects: [[0, 0, 10, 10]] as const },
  ];

  it('one page: <doc>.<ext>; blank doc name: drawing', () => {
    expect(
      planExport(boardSession(rectBoard(pages), undefined, ' Plan '), opts({ format: 'png', pageIndexes: [2] }))[0]
        ?.fileName,
    ).toBe('Plan.png');
    expect(
      planExport(boardSession(rectBoard(pages), undefined, ''), opts({ format: 'svg', pageIndexes: [0] }))[0]?.fileName,
    ).toBe('drawing.svg');
  });

  it('several pages: <doc>-<page>, page<N> for a blank name, -page<N> on a duplicate', () => {
    const names = planExport(boardSession(rectBoard(pages), undefined, 'Plan'), opts({ format: 'jpg' })).map(
      (p) => p.fileName,
    );
    expect(names).toEqual(['Plan-Overview.jpg', 'Plan-page2.jpg', 'Plan-Overview-page3.jpg', 'Plan-Detail.jpg']);
  });

  it('a PDF and a .lekh are one file named after the document', () => {
    const d = planExportDetail(boardSession(rectBoard(pages), undefined, 'Plan'), opts({ format: 'pdf' }));
    expect(d.fileName).toBe('Plan.pdf');
    expect(d.pages).toHaveLength(4);
  });

  it('a page subset is planned in the order given', () => {
    const plans = planExport(
      boardSession(rectBoard(pages), undefined, 'Plan'),
      opts({ format: 'png', pageIndexes: [3, 0] }),
    );
    expect(plans.map((p) => [p.pageIndex, p.fileName])).toEqual([
      [3, 'Plan-Detail.png'],
      [0, 'Plan-Overview.png'],
    ]);
  });
});

describe('zero-size pages (AC-EXP-37)', () => {
  const board = rectBoard([
    { name: 'One', rects: [[50, 50, 20, 20]] },
    { name: 'Empty', rects: [] },
    { name: 'Three', rects: [[50, 50, 20, 20]] },
  ]);

  it('an empty infinite page at padding 0 is skipped; the others keep their C++ names', async () => {
    const s = boardSession(board, undefined, 'Doc');
    const d = planExportDetail(s, opts({ format: 'png', region: 'drawing', padding: 0 }));
    expect(d.skipped).toEqual([1]);
    expect(d.pages.map((p) => p.fileName)).toEqual(['Doc-One.png', 'Doc-Three.png']);
    const e = env();
    const r = await run(s, { format: 'png', region: 'drawing' }, e);
    expect(r.status).toBe('done');
    if (r.status === 'done') expect(r.files.map((f) => f.name)).toEqual(['Doc-One.png', 'Doc-Three.png']);
    expect(e.logs).toContain('export_page_skipped {"page":2}');
  });

  it('with padding the empty page exports blank at 2 × padding, as C++', () => {
    const s = boardSession(board, undefined, 'Doc');
    const d = planExportDetail(s, opts({ format: 'png', region: 'drawing', padding: 20 }));
    expect(d.skipped).toEqual([]);
    expect(d.pages[1]).toMatchObject({ width: 40, height: 40 });
  });

  it('every page skipped: export_empty', async () => {
    const s = boardSession(rectBoard([{ rects: [] }, { rects: [] }]), undefined, 'Doc');
    const r = await run(s, { format: 'svg', region: 'drawing' });
    expect(r).toEqual({ status: 'failed', error: { code: 'export_empty', message: 'Nothing to export.' } });
  });
});
