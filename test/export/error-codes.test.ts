// AC-EXP-27 (lekhjs half), AC-EXP-31: every failure path of `runExport` resolves to one
// `ExportErrorCode` with its message (fault injection, one case per code lekhjs produces;
// `export_board_load_failed` and the delivery codes' UI are lekhboard-capacitor's), and the logs
// carry codes and counts only — a marker in the board, page and text names never reaches them.
import { describe, expect, it } from 'vitest';
import {
  exportErrorOf,
  type ExportEnv,
  type ExportErrorCode,
  type ExportOptions,
  type RasterCanvasFactory,
} from '../../src/export';
import { boardSession, ControlledImagePort, env, napiFactory, rectBoard, run } from './helpers';

const MARKER = 'ZQX-SECRET-7731';

function board() {
  return boardSession(
    rectBoard([
      { name: `Page ${MARKER}`, rects: [[40, 40, 30, 30]] },
      { name: `Other ${MARKER}`, rects: [[40, 40, 30, 30]] },
    ]),
    undefined,
    `Board ${MARKER}`,
  );
}

const failingFactory = (err: () => Error, where: 'create' | 'encode'): RasterCanvasFactory => {
  const base = napiFactory();
  return {
    createCanvas: (w, h) => {
      if (where === 'create') throw err();
      return base.createCanvas(w, h);
    },
    encode: (c, m, q) => (where === 'encode' ? Promise.reject(err()) : base.encode(c, m, q)),
  };
};

function named(name: string, message = 'x'): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

type Case = readonly [ExportErrorCode, Partial<ExportOptions> & Pick<ExportOptions, 'format'>, Partial<ExportEnv>];

const CASES: readonly Case[] = [
  ['export_limit_reached', { format: 'png' }, { policy: { capped: true, isLocal: true } }],
  ['export_empty', { format: 'png', region: 'drawing' }, {}], // replaced below by an empty board
  [
    'export_image_unreadable',
    { format: 'png' },
    { canvasFactory: failingFactory(() => named('SecurityError'), 'encode') },
  ],
  [
    'export_out_of_memory',
    { format: 'png' },
    { canvasFactory: failingFactory(() => new RangeError('Invalid array length'), 'create') },
  ],
  ['export_pdf_unavailable', { format: 'pdf' }, { loadPdf: () => Promise.reject(new Error('chunk load failed')) }],
  [
    'export_write_failed',
    { format: 'svg' },
    { sink: () => Promise.reject(Object.assign(new Error('w'), { code: 'export_write_failed' })) },
  ],
  [
    'export_share_failed',
    { format: 'lekh' },
    { sink: () => Promise.reject(Object.assign(new Error('s'), { code: 'export_share_failed' })) },
  ],
  ['export_internal', { format: 'svg' }, { sink: () => Promise.reject(new TypeError(`boom ${MARKER}`)) }],
];

const MESSAGES: Readonly<Record<string, string>> = {
  export_limit_reached: 'Export limit reached',
  export_empty: 'Nothing to export.',
  export_image_unreadable: 'An image on this board could not be read, so it could not be exported.',
  export_pdf_unavailable: 'PDF export needs a connection the first time. Please try again online.',
};

describe('error codes (AC-EXP-27)', () => {
  for (const [code, opts, over] of CASES) {
    it(code, async () => {
      const s = code === 'export_empty' ? boardSession(rectBoard([{ rects: [] }]), undefined, `B ${MARKER}`) : board();
      const e = env(over);
      const r = await run(s, opts, e);
      expect(r.status).toBe('failed');
      if (r.status !== 'failed') return;
      expect(r.error.code).toBe(code);
      if (MESSAGES[code] !== undefined) expect(r.error.message).toBe(MESSAGES[code]);
      expect(r.error.message).not.toContain(MARKER);
      expect(r.error.detail ?? '').not.toContain(MARKER);
      expect(e.logs).toContain(code);
      expect(e.reports).toEqual([]);
    });
  }

  it('exportErrorOf maps by code, by RangeError, by DOMException name, else internal', () => {
    expect(exportErrorOf({ code: 'export_write_failed' }).code).toBe('export_write_failed');
    expect(exportErrorOf({ code: 'not_ours' }).code).toBe('export_internal');
    expect(exportErrorOf(new RangeError('x')).code).toBe('export_out_of_memory');
    expect(exportErrorOf(named('SecurityError')).code).toBe('export_image_unreadable');
    expect(exportErrorOf('string').code).toBe('export_internal');
  });
});

describe('log privacy (AC-EXP-31)', () => {
  it('no path logs board, page or text content', async () => {
    const all: string[] = [];
    for (const [, opts, over] of CASES) {
      const e = env(over);
      await run(board(), opts, e);
      all.push(...e.logs);
    }
    // Warnings and skips too: a missing image, a downscale, a skipped page.
    const img = new ControlledImagePort((u) => Promise.resolve({ loaded: [], missing: [...u] }));
    const e1 = env({ images: img });
    const withImage = boardSession(
      rectBoard([
        { name: `P ${MARKER}`, rects: [[1000, 900, 2000, 1800]] },
        { name: MARKER, rects: [] },
      ]),
      undefined,
      MARKER,
    );
    await run(withImage, { format: 'png', scale: 4, region: 'drawing' }, e1);
    all.push(...e1.logs);
    expect(all.length).toBeGreaterThan(8);
    for (const l of all) expect(l).not.toContain(MARKER);
    expect(all).toContain('image_downscaled {"count":1}');
    expect(all).toContain('export_page_skipped {"page":2}');
  }, 120_000);
});
