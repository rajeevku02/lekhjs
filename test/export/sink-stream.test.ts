// AC-EXP-39: `runExport` never holds a whole output file. Every byte reaches `env.sink` in order;
// the largest chunk is at most one band (raster); the job resolves only after the last sink
// promise; capped + local short-circuits with `export_limit_reached` before any sink or image
// call; and lekhjs never calls `env.report`. The 20-page PDF arrives page by page (task F1).
import { describe, expect, it } from 'vitest';
import { SAFE_CANVAS_PIXELS } from '../../src/export';
import { boardSession, ControlledImagePort, env, pngSize, rectBoard, recordingSink, run } from './helpers';
import { parsePdf, pdfEnv, textBoard } from './pdf-helpers';

const RED = 0xffff0000 | 0;

describe('streaming to env.sink (AC-EXP-39)', () => {
  it('a 60 MP PNG arrives in band-sized chunks, in order, and the job waits for the sink', async () => {
    // 7,746 × 7,746 board points at x1 is a 60 MP request; it is capped to 50 MP and banded.
    const s = boardSession(rectBoard([{ rects: [[3873, 3873, 7745, 7745]], fill: RED }]), undefined, 'Huge');
    const { sink, rec, pending } = recordingSink(5);
    const e = env({ sink });
    const r = await run(s, { format: 'png', region: 'drawing' }, e);
    expect(r.status).toBe('done');
    expect(pending()).toBe(0);
    const bytes = rec.file('Huge.png');
    const { width, height } = pngSize(bytes);
    expect(width * height).toBeLessThanOrEqual(50_000_000);
    expect(width * height).toBeGreaterThan(49_000_000);
    const band = width * 4 * Math.floor(SAFE_CANVAS_PIXELS / width);
    expect(rec.chunks.length).toBeGreaterThan(2);
    for (const c of rec.chunks) expect(c.bytes.length).toBeLessThanOrEqual(band);
    if (r.status === 'done')
      expect(r.files).toEqual([{ name: 'Huge.png', mime: 'image/png', index: 0, bytes: bytes.length }]);
    // In order: the PNG signature first, IEND last.
    expect([...bytes.subarray(1, 4)]).toEqual([80, 78, 71]);
    expect(String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4))).toBe('IEND');
    expect(e.reports).toEqual([]);
  }, 300_000);

  it('a 5-file SVG export: one file per page, in page order, each complete before the next', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      name: `P${String(i + 1)}`,
      rects: [[50, 50, 20 + i, 20] as const],
    }));
    const s = boardSession(rectBoard(pages), undefined, 'Five');
    const { sink, rec, pending } = recordingSink(3);
    const e = env({ sink });
    const r = await run(s, { format: 'svg', region: 'drawing', padding: 5 }, e);
    expect(r.status).toBe('done');
    expect(pending()).toBe(0);
    expect(rec.names).toEqual(['Five-P1.svg', 'Five-P2.svg', 'Five-P3.svg', 'Five-P4.svg', 'Five-P5.svg']);
    const order = rec.chunks.map((c) => c.file.index);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const n of rec.names) {
      const t = Buffer.from(rec.file(n)).toString('utf8');
      expect(t.startsWith('<?xml')).toBe(true);
      expect(t.trimEnd().endsWith('</svg>')).toBe(true);
    }
    expect(e.reports).toEqual([]);
  });

  it('capped + local: export_limit_reached with no sink and no ensure call', async () => {
    const s = boardSession(rectBoard([{ rects: [[50, 50, 20, 20]] }]), undefined, 'Cap');
    const images = new ControlledImagePort(() => Promise.resolve({ loaded: [], missing: [] }));
    let sinks = 0;
    const e = env({
      images,
      policy: { capped: true, isLocal: true },
      sink: () => {
        sinks++;
        return Promise.resolve();
      },
    });
    const progress: unknown[] = [];
    const r = await run(s, { format: 'png' }, e, undefined, progress as never);
    expect(r).toEqual({ status: 'failed', error: { code: 'export_limit_reached', message: 'Export limit reached' } });
    expect(sinks).toBe(0);
    expect(images.ensured).toEqual([]);
    expect(images.pinned()).toBe(0);
    expect(progress).toEqual([]);
    expect(e.reports).toEqual([]);
  });

  it('capped on a cloud board, or local but not capped, exports', async () => {
    for (const policy of [
      { capped: true, isLocal: false },
      { capped: false, isLocal: true },
    ]) {
      const s = boardSession(rectBoard([{ rects: [[50, 50, 20, 20]] }]), undefined, 'Ok');
      const r = await run(s, { format: 'lekh' }, env({ policy }));
      expect(r.status).toBe('done');
    }
  });

  it('a .lekh export is the serializer output stamped 5.0, streamed to the sink', async () => {
    const s = boardSession(rectBoard([{ rects: [[50, 50, 20, 20]] }]), undefined, 'Doc');
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'lekh' }, env({ sink }));
    expect(r.status).toBe('done');
    const text = Buffer.from(rec.file('Doc.lekh')).toString('utf8');
    expect(text).toBe(s.serialize({ stamp: 'offline' }));
    expect((JSON.parse(text) as { info: { version: string } }).info.version).toBe('5.0');
  });

  it('a 20-page PDF arrives page by page, in order, and the job waits for the sink', async () => {
    const pages = Array.from({ length: 20 }, (_, i) => [
      { text: `Page ${String(i + 1)} title`, cx: 200, cy: 40 },
      { text: 'Body text on the page', cx: 200, cy: 120 },
    ]);
    const s = boardSession(textBoard(pages, { fixed: true }), undefined, 'Twenty');
    const { sink, rec, pending } = recordingSink(2);
    const e = pdfEnv(undefined, { sink });
    const progress: { phase: string; page?: number }[] = [];
    const r = await run(s, { format: 'pdf' }, e, undefined, progress as never);
    expect(r.status).toBe('done');
    expect(pending()).toBe(0);
    expect(rec.names).toEqual(['Twenty.pdf']);
    const bytes = rec.file('Twenty.pdf');
    // One chunk per page (the previous page's content goes out when the next page starts) and one
    // with the fonts and the cross-reference table at the end: never the whole file at once.
    expect(rec.chunks.length).toBeGreaterThanOrEqual(20);
    const pageChunks = rec.chunks.slice(1, -1).map((c) => c.bytes.length);
    for (const n of pageChunks) expect(n).toBeLessThan(bytes.length / 5);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(
      Buffer.from(bytes.subarray(bytes.length - 6))
        .toString('latin1')
        .trim(),
    ).toBe('%%EOF');
    const parsed = await parsePdf(bytes);
    expect(parsed.pages.length).toBe(20);
    expect(parsed.pages[19]?.items.map((i) => i.str)).toEqual(['Page 20 title', 'Body text on the page']);
    expect(progress.filter((p) => p.phase === 'rendering').map((p) => p.page)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    if (r.status === 'done')
      expect(r.files).toEqual([{ name: 'Twenty.pdf', mime: 'application/pdf', index: 0, bytes: bytes.length }]);
    expect(e.reports).toEqual([]);
  });

  it('PDF without the PDF module plugged in: export_pdf_unavailable', async () => {
    const s = boardSession(rectBoard([{ rects: [[50, 50, 20, 20]] }]), undefined, 'Doc');
    const r = await run(s, { format: 'pdf' });
    expect(r.status === 'failed' && r.error.code).toBe('export_pdf_unavailable');
  });
});
