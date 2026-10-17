// Shared pieces of the export suites: an `@napi-rs/canvas` canvas factory, a recording sink, a
// fake image port with controllable waits, sessions on fixture boards, and a pixel reader.
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import path from 'node:path';
import type { DecodedImage } from '../../src/render';
import type {
  ExportEnv,
  ExportFileMeta,
  ExportImagePort,
  ExportProgress,
  ExportResult,
  ExportUsageEvent,
  RasterCanvasFactory,
} from '../../src/export';
import { runExport, type ExportOptions } from '../../src/export';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES, readText } from '../io/helpers';
import { testRuntime } from '../session/helpers';

export const runtime = testRuntime();

/** The Node canvas factory (kashi's would be the same). */
export function napiFactory(log?: { created: [number, number][] }): RasterCanvasFactory {
  return {
    createCanvas(w, h) {
      log?.created.push([w, h]);
      return createCanvas(w, h);
    },
    encode(c, mime) {
      const canvas = c as unknown as Canvas;
      return Promise.resolve(
        new Uint8Array(mime === 'image/png' ? canvas.encodeSync('png') : canvas.encodeSync('jpeg', 100)),
      );
    },
  };
}

export interface Recorded {
  readonly chunks: { file: ExportFileMeta; bytes: Uint8Array }[];
  /** Concatenated bytes per file name. */
  file(name: string): Uint8Array;
  readonly names: string[];
}

/** A sink that records every chunk (optionally slow, to prove back-pressure). */
export function recordingSink(delayMs = 0): { sink: ExportEnv['sink']; rec: Recorded; pending: () => number } {
  const chunks: Recorded['chunks'] = [];
  let pending = 0;
  const sink: ExportEnv['sink'] = async (file, chunk) => {
    pending++;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    chunks.push({ file, bytes: chunk.slice() });
    pending--;
  };
  const rec: Recorded = {
    chunks,
    file(name) {
      const parts = chunks.filter((c) => c.file.name === name).map((c) => c.bytes);
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    },
    get names() {
      return [...new Set(chunks.map((c) => c.file.name))];
    },
  };
  return { sink, rec, pending: () => pending };
}

/** An image port whose `ensure` the test controls; records pins and ensure calls. */
export class ControlledImagePort implements ExportImagePort {
  readonly ensured: string[][] = [];
  readonly pins = new Map<string, number>();
  private readonly answer: (
    urls: readonly string[],
    timeoutMs: number,
  ) => Promise<{ loaded: string[]; missing: string[] }>;
  constructor(
    answer: (urls: readonly string[], timeoutMs: number) => Promise<{ loaded: string[]; missing: string[] }>,
  ) {
    this.answer = answer;
  }
  ensure(urls: readonly string[], opts: { timeoutMs: number }): Promise<{ loaded: string[]; missing: string[] }> {
    this.ensured.push([...urls]);
    return this.answer(urls, opts.timeoutMs);
  }
  pin(urls: readonly string[]): () => void {
    for (const u of urls) this.pins.set(u, (this.pins.get(u) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const u of urls) this.pins.set(u, (this.pins.get(u) ?? 1) - 1);
    };
  }
  pinned(): number {
    return [...this.pins.values()].reduce((n, v) => n + v, 0);
  }
}

export function env(over: Partial<ExportEnv> = {}): ExportEnv & { reports: ExportUsageEvent[]; logs: string[] } {
  const reports: ExportUsageEvent[] = [];
  const logs: string[] = [];
  const { sink } = recordingSink();
  return {
    canvasFactory: napiFactory(),
    rasterHostScale: 1,
    images: new ControlledImagePort(() => Promise.resolve({ loaded: [], missing: [] })),
    sink,
    policy: { capped: false, isLocal: true },
    report: (e) => reports.push(e),
    log: (code, fields) => logs.push(fields === undefined ? code : `${code} ${JSON.stringify(fields)}`),
    ...over,
    reports,
    logs,
  };
}

export function session(images: FakeImagePort = new FakeImagePort()): BoardSession {
  return new BoardSession(runtime, { images, scheduler: new FakeScheduler() });
}

/** A session on a core fixture (`boards/…`, `format/…`). */
export function fixtureSession(file: string, images?: FakeImagePort): BoardSession {
  const s = session(images);
  const r = s.load(readText(path.join(CORE_FIXTURES, file)));
  if (!r.ok) throw new Error(`load ${file}: ${r.message}`);
  return s;
}

/** A session on a board built from JSON. */
export function boardSession(board: object, images?: FakeImagePort, name = 'Board'): BoardSession {
  const s = session(images);
  const r = s.load(board);
  if (!r.ok) throw new Error(`load: ${r.message}`);
  (s.document as { name: string }).name = name;
  return s;
}

export function never(): AbortSignal {
  return new AbortController().signal;
}

export async function run(
  s: BoardSession,
  opts: Partial<ExportOptions> & Pick<ExportOptions, 'format'>,
  e: ExportEnv = env(),
  signal: AbortSignal = never(),
  progress: ExportProgress[] = [],
): Promise<ExportResult> {
  return runExport(
    s,
    { region: 'full', padding: 0, scale: 1, includeBackground: false, ...opts },
    e,
    (p) => progress.push(p),
    signal,
  );
}

/** Decoded RGBA pixels of PNG or JPEG bytes. */
export async function pixelsOf(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = await loadImage(Buffer.from(bytes));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data: d.data };
}

/** PNG IHDR width and height. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** JPEG SOF0 width and height. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('jpeg: bad marker');
    const m = bytes[i + 1] ?? 0;
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (m === 0xc0 || m === 0xc2) {
      return {
        height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
    }
    i += 2 + len;
  }
  throw new Error('jpeg: no SOF');
}

/** A decoded image backed by a napi canvas filled with `color`. */
export function solidImage(w: number, h: number, color = '#3366cc'): DecodedImage {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return { width: w, height: h, source: c };
}

export interface PageSpec {
  readonly name?: string;
  readonly type?: 'infinite' | 'fixed' | 'auto';
  /** Rectangles as [cx, cy, w, h]. */
  readonly rects?: readonly (readonly [number, number, number, number])[];
  /** `-1` white, else a signed ARGB integer. */
  readonly background?: number;
  readonly fill?: number;
}

/** A board of plain rectangles (the `avabodh.basic.rectangle` template), one page per spec. */
export function rectBoard(pages: readonly PageSpec[]): object {
  const out: Record<string, object> = {};
  let id = 0;
  pages.forEach((p, i) => {
    const objects: Record<string, object> = {};
    for (const [cx, cy, width, height] of p.rects ?? []) {
      id++;
      objects[`obj${String(id).padStart(4, '0')}`] = {
        name: '',
        order: id,
        params: { angle: 0, cx, cy, width, height },
        style: p.fill !== undefined ? { fillpaint: { color: p.fill, type: 2 } } : undefined,
        template: {
          data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
          default: { angle: 0, height: 10, width: 10 },
          draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
          flags: 31,
          id: 'avabodh.basic.rectangle',
          polygon: true,
        },
        type: 'templated',
      };
    }
    const fixed = p.type === 'fixed';
    out[`page${String(i + 1).padStart(4, '0')}`] = {
      name: p.name ?? `Page ${String(i + 1)}`,
      order: i + 1,
      canvassizetype: p.type ?? 'infinite',
      canvasname: fixed ? 'Letter' : 'Infinite',
      size: fixed ? { width: 400, height: 300, unit: 'point' } : { width: 0, height: 0, unit: 'point' },
      background: { color: p.background ?? -1 },
      objects,
    };
  });
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: out,
  };
}
