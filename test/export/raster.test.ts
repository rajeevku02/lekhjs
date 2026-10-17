// Raster export (spec 08 §5): the pixel size (AC-EXP-04), the background rule (AC-EXP-05), the
// 50 MP / 100 MP cap with one `image_downscaled` warning (AC-EXP-06), and banded output equal to
// the single-canvas render (§12).
import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import {
  MAX_PAGE_PIXELS,
  MAX_TOTAL_PIXELS,
  planRaster,
  type ExportPagePlan,
  type RasterCanvasFactory,
} from '../../src/export';
import { boardSession, env, jpegSize, napiFactory, pixelsOf, pngSize, rectBoard, recordingSink, run } from './helpers';

const RED = 0xffff0000 | 0; // opaque red, signed ARGB
const BG = 0xff3366cc | 0;

function board() {
  return boardSession(
    rectBoard([
      { name: 'Inf', type: 'infinite', rects: [[100, 80, 100, 50]], fill: RED },
      { name: 'Fixed', type: 'fixed', rects: [[60, 60, 40, 40]], fill: RED, background: BG },
    ]),
    undefined,
    'Doc',
  );
}

describe('pixel size = width × scale × rasterHostScale (AC-EXP-04)', () => {
  for (const host of [1, 2.625]) {
    for (const scale of [1, 2, 4]) {
      it(`scale ${String(scale)}, host scale ${String(host)}`, async () => {
        const { sink, rec } = recordingSink();
        const e = env({ sink, rasterHostScale: host });
        const r = await run(board(), { format: 'png', region: 'drawing', padding: 20, scale, pageIndexes: [0] }, e);
        expect(r.status).toBe('done');
        const sz = pngSize(rec.file('Doc.png'));
        expect(sz).toEqual({ width: Math.round(141 * scale * host), height: Math.round(91 * scale * host) });
      });
    }
  }

  it('JPEG too', async () => {
    const { sink, rec } = recordingSink();
    const r = await run(board(), { format: 'jpg', pageIndexes: [1], scale: 3 }, env({ sink }));
    expect(r.status).toBe('done');
    expect(jpegSize(rec.file('Doc.jpg'))).toEqual({ width: 1200, height: 900 });
  });
});

describe('background (AC-EXP-05)', () => {
  const at = (px: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] => {
    const i = (y * px.width + x) * 4;
    return [px.data[i] ?? -1, px.data[i + 1] ?? -1, px.data[i + 2] ?? -1, px.data[i + 3] ?? -1];
  };
  const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 2);

  it('PNG is transparent where there is no content, even with Include background', async () => {
    for (const includeBackground of [false, true]) {
      const { sink, rec } = recordingSink();
      await run(board(), { format: 'png', pageIndexes: [1], includeBackground }, env({ sink }));
      const px = await pixelsOf(rec.file('Doc.png'));
      expect(at(px, 300, 250)[3]).toBe(0);
      expect(near(at(px, 60, 60), [255, 0, 0, 255])).toBe(true);
    }
  });

  it('JPEG is white without the background, the background colour with it', async () => {
    const white = recordingSink();
    await run(board(), { format: 'jpg', pageIndexes: [1] }, env({ sink: white.sink }));
    expect(near(at(await pixelsOf(white.rec.file('Doc.jpg')), 300, 250), [255, 255, 255, 255])).toBe(true);
    const coloured = recordingSink();
    await run(board(), { format: 'jpg', pageIndexes: [1], includeBackground: true }, env({ sink: coloured.sink }));
    const px = await pixelsOf(coloured.rec.file('Doc.jpg'));
    expect(near(at(px, 300, 250), [0x33, 0x66, 0xcc, 255])).toBe(true);
    expect(near(at(px, 60, 60), [255, 0, 0, 255])).toBe(true);
  });
});

describe('the 50 MP / 100 MP cap (AC-EXP-06, OQ-51)', () => {
  const plan = (w: number, h: number, i = 0): ExportPagePlan => ({
    pageIndex: i,
    fileName: `p${String(i)}`,
    width: w,
    height: h,
    translateX: 0,
    translateY: 0,
  });

  it('a 60 MP page is scaled to fit 50 MP, keeping its aspect ratio', () => {
    const [r] = planRaster([plan(10_000, 6_000)], 1, 1);
    expect(r?.downscaled).toBe(true);
    const w = r?.pixelWidth ?? 0;
    const h = r?.pixelHeight ?? 0;
    expect(w * h).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
    expect(w * h).toBeGreaterThan(MAX_PAGE_PIXELS * 0.999);
    expect(Math.abs(w / h - 10 / 6) * h).toBeLessThanOrEqual(1);
  });

  it('three 40 MP pages are scaled proportionally to 100 MP in total', () => {
    const r = planRaster([plan(8000, 5000, 0), plan(8000, 5000, 1), plan(5000, 8000, 2)], 1, 1);
    const total = r.reduce((n, p) => n + p.pixelWidth * p.pixelHeight, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_PIXELS);
    expect(total).toBeGreaterThan(MAX_TOTAL_PIXELS * 0.998);
    for (const p of r) {
      expect(p.downscaled).toBe(true);
      expect(Math.abs(p.pixelWidth / p.pixelHeight - p.plan.width / p.plan.height) * p.pixelHeight).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('a long page keeps its full size within 50 MP (no 8,192 px side cap)', () => {
    const [r] = planRaster([plan(12_000, 4_000)], 1, 1);
    expect(r).toMatchObject({ pixelWidth: 12_000, pixelHeight: 4_000, downscaled: false });
  });

  it('a page under the cap is untouched', () => {
    const [r] = planRaster([plan(1000, 500)], 2, 1);
    expect(r).toMatchObject({ pixelWidth: 2000, pixelHeight: 1000, downscaled: false, pixelScale: 2 });
  });

  it('the export reports exactly one image_downscaled warning with the reduced size', async () => {
    // x4 of a 2,000 × 1,800 drawing area = 57.6 MP.
    const s = boardSession(rectBoard([{ rects: [[1000, 900, 2000, 1800]], fill: RED }]), undefined, 'Big');
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'png', scale: 4 }, env({ sink }));
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    const w = r.warnings.filter((x) => x.code === 'image_downscaled');
    expect(w).toHaveLength(1);
    const sz = pngSize(rec.file('Big.png'));
    expect(w[0]?.detail).toBe(`${String(sz.width)} × ${String(sz.height)}`);
    expect(sz.width * sz.height).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
  }, 120_000);
});

describe('banded output equals the single-canvas render', () => {
  const s = () =>
    boardSession(
      rectBoard([
        {
          rects: [
            [50, 40, 60, 30],
            [120, 90, 50, 70],
            [30, 150, 40, 40],
          ],
          fill: RED,
          background: BG,
        },
      ]),
      undefined,
      'B',
    );

  it('png: the same pixels, from one reused band canvas', async () => {
    const one = recordingSink();
    await run(s(), { format: 'png', scale: 2 }, env({ sink: one.sink }));
    const created: [number, number][] = [];
    const banded = recordingSink();
    const r = await run(
      s(),
      { format: 'png', scale: 2 },
      env({ sink: banded.sink, canvasFactory: napiFactory({ created }), canvasBudget: { pixels: 20_000, side: 100 } }),
    );
    expect(r.status).toBe('done');
    const a = await pixelsOf(one.rec.file('B.png'));
    expect(created).toEqual([[a.width, Math.floor(20_000 / a.width)]]);
    const b = await pixelsOf(banded.rec.file('B.png'));
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    expect(Buffer.from(b.data).equals(Buffer.from(a.data))).toBe(true);
  });

  // Padded, so no shape touches the page edge, where Skia anti-aliases a corner pixel differently
  // on a taller canvas.
  it('jpg: byte-identical to jpeg-js over the single-canvas pixels, bands a multiple of 16 rows', async () => {
    const base = napiFactory();
    const viaJpegJs: RasterCanvasFactory = {
      createCanvas: (w, h) => base.createCanvas(w, h),
      encode: (c) => {
        const ctx = c.getContext('2d');
        const d = ctx?.getImageData(0, 0, c.width, c.height);
        if (d === undefined) throw new Error('no context');
        return Promise.resolve(
          new Uint8Array(jpeg.encode({ data: Buffer.from(d.data), width: c.width, height: c.height }, 100).data),
        );
      },
    };
    const one = recordingSink();
    await run(
      s(),
      { format: 'jpg', scale: 2, includeBackground: true, padding: 10 },
      env({ sink: one.sink, canvasFactory: viaJpegJs }),
    );
    const created: [number, number][] = [];
    const banded = recordingSink();
    await run(
      s(),
      { format: 'jpg', scale: 2, includeBackground: true, padding: 10 },
      env({ sink: banded.sink, canvasFactory: napiFactory({ created }), canvasBudget: { pixels: 20_000, side: 100 } }),
    );
    expect((created[0]?.[1] ?? 1) % 16).toBe(0);
    expect(banded.rec.chunks.length).toBeGreaterThan(3);
    expect(Buffer.from(banded.rec.file('B.jpg')).equals(Buffer.from(one.rec.file('B.jpg')))).toBe(true);
  });
});
