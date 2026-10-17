// Shared pieces of the PDF parity suites (Work 01M4X7TCHFB862XGT68GPY071C, F2): sessions measured
// with the bundled fonts on a real canvas (so the engine's layout is the one the PDF writes), the
// PNG and PDF exports of one board, pdf.js rasterisation at the PNG's pixel size, the text boxes of
// a page in pixels (the engine's layout rectangles), and the image bar of verification 02 §B.3
// (parity/image/diff.mjs) with those boxes masked.
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { planExport, type ExportOptions, type ExportPagePlan } from '../../src/export';
import { TextCollectingPlatform, type FontDataProvider } from '../../src/export/pdf';
import type { ExportView } from '../../src/export';
import type { Style } from '../../src/style';
import type { LaidOutText } from '../../src/text';
import { BoardSession, createRuntime } from '../../src/session';
import { bundledCatalog } from '../io/helpers';
import { FakeFontLoader, FakeImagePort, FakeScheduler, sequentialIds } from '../../src/testing';
import { testRuntime } from '../session/helpers';
import { napiMeasurer } from '../text/helpers';
import { env, recordingSink, run } from './helpers';
import { bundledSource, pdfEnv } from './pdf-helpers';
// The parity package's plain-JS image bar (its own node_modules: pixelmatch, pngjs).
import * as imageDiff from '../../parity/image/diff.mjs';

export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

interface DiffResult {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  readonly count: number;
  readonly total: number;
  readonly fraction: number;
}
interface BlobInfo {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pixels: number;
}
interface BarResult {
  readonly pass: boolean;
  readonly fraction: number;
  readonly largestBlob: number;
  readonly oversized: number;
}

const diff = imageDiff as unknown as {
  diffImages(a: Rgba, b: Rgba, opts?: { ignore?: Uint8Array | null }): DiffResult;
  blobs(mask: Uint8Array, width: number, height: number): BlobInfo[];
  bar(d: DiffResult, bl: BlobInfo[], scale?: number): BarResult;
  encodePng(img: Rgba): Buffer;
};

export interface MeasuredSessionOptions {
  readonly host?: 'web' | 'ios' | 'android' | 'backend';
  readonly images?: FakeImagePort;
  readonly scheduler?: FakeScheduler;
  /** Rule 5 of the resolver: families "this host has" (fonts installed on the device). */
  readonly platformFamilies?: readonly string[];
  /** Families after the primary one in every font string (the backend's Noto script families). */
  readonly fallbackFamilies?: readonly string[];
}

/** A session whose text is measured with the bundled fonts on a napi canvas (the backend's setup). */
export function measuredSession(board: object, name: string, o: MeasuredSessionOptions = {}): BoardSession {
  const host = o.host ?? 'web';
  const platformFamilies = o.platformFamilies ?? [];
  const runtime =
    platformFamilies.length === 0 && o.fallbackFamilies === undefined
      ? testRuntime({ host, measurer: napiMeasurer() })
      : createRuntime({
          measurer: napiMeasurer(),
          fonts: new FakeFontLoader(),
          catalog: bundledCatalog(),
          clock: { now: () => 1234 },
          ids: sequentialIds(),
          logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
          config: { debug: { verifyIndex: true } },
          host,
          platformFonts: { families: () => platformFamilies, isAvailable: (f) => platformFamilies.includes(f) },
          ...(o.fallbackFamilies !== undefined ? { fallbackFamilies: o.fallbackFamilies } : {}),
        });
  const s = new BoardSession(runtime, {
    images: o.images ?? new FakeImagePort(),
    scheduler: o.scheduler ?? new FakeScheduler(),
  });
  const r = s.load(board);
  if (!r.ok) throw new Error(`load: ${r.message}`);
  (s.document as { name: string }).name = name;
  return s;
}

export const BASE_OPTS: ExportOptions = {
  format: 'png',
  region: 'full',
  padding: 10,
  scale: 1,
  includeBackground: false,
};

/** The PNG export of every page (bytes in plan order). */
export async function exportPngs(s: BoardSession, opts: Partial<ExportOptions> = {}): Promise<Uint8Array[]> {
  const o = { ...BASE_OPTS, ...opts, format: 'png' as const };
  const { sink, rec } = recordingSink();
  const r = await run(s, o, env({ sink }));
  if (r.status !== 'done') throw new Error(`png export: ${JSON.stringify(r)}`);
  return rec.names.map((n) => rec.file(n));
}

/** The PDF export (one file) with `fonts` as the chain; also returns the warnings. */
export async function exportPdfFile(
  s: BoardSession,
  fonts: readonly FontDataProvider[] = [bundledSource()],
  opts: Partial<ExportOptions> = {},
): Promise<{ bytes: Uint8Array; warnings: readonly { code: string; count: number }[] }> {
  const o = { ...BASE_OPTS, ...opts, format: 'pdf' as const };
  const { sink, rec } = recordingSink();
  const r = await run(s, o, pdfEnv(fonts, { sink }));
  if (r.status !== 'done') throw new Error(`pdf export: ${JSON.stringify(r)}`);
  const name = rec.names[0];
  if (name === undefined || rec.names.length !== 1) throw new Error(`pdf export: ${String(rec.names.length)} files`);
  return { bytes: rec.file(name), warnings: r.warnings };
}

/** RGBA of `png` bytes composited over opaque white (the PNG export is transparent where empty). */
export function pngOverWhite(png: Uint8Array): Rgba {
  const img = (imageDiff as unknown as { decodePng(b: Uint8Array): Rgba }).decodePng(png);
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = (img.data[i + 3] ?? 0) / 255;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round((img.data[i + k] ?? 0) * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Every page of `bytes` rasterised by pdf.js on a napi canvas over white, at `pxPerPt` pixels per
 * PDF point and sized `sizes[i]` (the PNG export's pixel size: a page is `width/2` points, so a PNG
 * at scale s is matched at 2·s px per point).
 */
export async function rasterPdf(
  bytes: Uint8Array,
  pxPerPt: number,
  sizes: readonly { width: number; height: number }[],
): Promise<Rgba[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: Rgba[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: pxPerPt });
    const size = sizes[i - 1] ?? { width: Math.round(viewport.width), height: Math.round(viewport.height) };
    const canvas = createCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
    const d = ctx.getImageData(0, 0, size.width, size.height).data;
    out.push({ width: size.width, height: size.height, data: new Uint8Array(d.buffer, d.byteOffset, d.length) });
  }
  await task.destroy();
  return out;
}

export interface TextBox {
  /** The axis-aligned bounds of the (possibly rotated) layout box, in page pixels at the export scale. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly text: LaidOutText;
  readonly style: Style;
  /** The page transform at the draw: board point → page pixel is `(p + t) · s` after `ox, oy`. */
  readonly ox: number;
  readonly oy: number;
}

/** `TextCollectingPlatform` that also follows translate / save / restore and the export view. */
class BoxCollector extends TextCollectingPlatform {
  readonly boxes: TextBox[] = [];
  private s_ = 1;
  private x_ = 0;
  private y_ = 0;
  private readonly stack_: [number, number, number][] = [];
  applyExportView(view: ExportView): void {
    this.x_ += view.tx * this.s_;
    this.y_ += view.ty * this.s_;
    this.s_ *= view.scale;
  }
  override translate(x = 0, y = 0): void {
    this.x_ += x * this.s_;
    this.y_ += y * this.s_;
  }
  override saveContext(): void {
    this.stack_.push([this.s_, this.x_, this.y_]);
  }
  override restoreContext(): void {
    const t = this.stack_.pop();
    if (t !== undefined) [this.s_, this.x_, this.y_] = t;
  }
  override drawText(text: LaidOutText, style: Style): void {
    super.drawText(text, style);
    if (text.lines.length === 0) return;
    const b = text.box;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const c = Math.abs(Math.cos(text.angle));
    const sn = Math.abs(Math.sin(text.angle));
    const w = b.width * c + b.height * sn;
    const h = b.width * sn + b.height * c;
    // The laid-out lines may overflow the box (a long word, more lines than fit): take the union.
    let top = b.y;
    let bottom = b.y + b.height;
    let left = b.x;
    let right = b.x + b.width;
    for (const l of text.lines) {
      top = Math.min(top, l.top);
      bottom = Math.max(bottom, l.top + text.lineHeight);
      const x0 = text.align === 'left' ? l.x : text.align === 'right' ? l.x - l.width : l.x - l.width / 2;
      left = Math.min(left, x0);
      right = Math.max(right, x0 + l.width);
    }
    const ww = Math.max(w, (right - left) * c + (bottom - top) * sn);
    const hh = Math.max(h, (right - left) * sn + (bottom - top) * c);
    const s = this.s_;
    this.boxes.push({
      x: (cx - ww / 2) * s + this.x_,
      y: (cy - hh / 2) * s + this.y_,
      w: ww * s,
      h: hh * s,
      text,
      style,
      ox: this.x_,
      oy: this.y_,
    });
  }
}

/** The text boxes of each planned page at `scale` (export options as given). */
export function textBoxes(
  s: BoardSession,
  opts: Partial<ExportOptions> = {},
): { plan: ExportPagePlan; boxes: TextBox[] }[] {
  const o = { ...BASE_OPTS, ...opts };
  return planExport(s, o).map((plan) => {
    const c = new BoxCollector();
    s.drawForExport(c, plan.pageIndex, false, { scale: o.scale, tx: plan.translateX, ty: plan.translateY });
    return { plan, boxes: c.boxes };
  });
}

/** A mask (1 = ignored) of `boxes` grown by `pad` pixels on every side. */
export function boxMask(boxes: readonly TextBox[], width: number, height: number, pad = 2): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x - pad));
    const y0 = Math.max(0, Math.floor(b.y - pad));
    const x1 = Math.min(width, Math.ceil(b.x + b.w + pad));
    const y1 = Math.min(height, Math.ceil(b.y + b.h + pad));
    for (let y = y0; y < y1; y++) m.fill(1, y * width + x0, y * width + x1);
  }
  return m;
}

/** The inverse: everything outside `rect` (grown by `pad`) is ignored. */
export function outsideMask(
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  pad = 2,
): Uint8Array {
  const inside = boxMask([{ ...rect, text: null as never, style: null as never, ox: 0, oy: 0 }], width, height, pad);
  return inside.map((v) => (v === 1 ? 0 : 1));
}

/**
 * Pixels within `radius` of an ink edge of either image (a pixel whose darkness class differs from
 * a neighbour's): the "1 px edge tolerance per glyph" of AC-EXP-19.
 */
export function edgeMask(a: Rgba, b: Rgba, radius = 1): Uint8Array {
  const { width, height } = a;
  const ink = (img: Rgba, i: number): boolean =>
    ((img.data[i * 4] ?? 255) + (img.data[i * 4 + 1] ?? 255) + (img.data[i * 4 + 2] ?? 255)) / 3 < 128;
  const edge = new Uint8Array(width * height);
  for (const img of [a, b]) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const v = ink(img, i);
        if ((x + 1 < width && ink(img, i + 1) !== v) || (y + 1 < height && ink(img, i + width) !== v)) {
          edge[i] = 1;
          if (x + 1 < width) edge[i + 1] = 1;
          if (y + 1 < height) edge[i + width] = 1;
        }
      }
    }
  }
  if (radius <= 1) return edge;
  const out = new Uint8Array(edge);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edge[y * width + x] !== 1) continue;
      for (let dy = -(radius - 1); dy <= radius - 1; dy++) {
        for (let dx = -(radius - 1); dx <= radius - 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

export function union(...masks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(masks[0]?.length ?? 0);
  for (const m of masks) for (let i = 0; i < m.length; i++) if (m[i] === 1) out[i] = 1;
  return out;
}

export interface PageVerdict extends BarResult {
  readonly differing: number;
  /** Pixels compared (not masked). */
  readonly compared: number;
  readonly masked: number;
}

/**
 * The §B.3 bar between `a` and `b` with `ignore` masked, at `scale` (blob limit 16·s²). The
 * fraction is over the compared (unmasked) pixels.
 */
export function pageBar(a: Rgba, b: Rgba, ignore: Uint8Array | null, scale = 1): PageVerdict & { diff: DiffResult } {
  const d = diff.diffImages(a, b, { ignore });
  const masked = ignore === null ? 0 : ignore.reduce((n, v) => n + v, 0);
  const compared = d.total - masked;
  const bl = diff.blobs(d.mask, d.width, d.height);
  const v = diff.bar({ ...d, total: Math.max(1, compared) }, bl, scale);
  return { ...v, differing: d.count, compared, masked, diff: d };
}

/** Pixels of `img` in `rect` that are not white (there is something to compare). */
export function inkIn(img: Rgba, rect: { x: number; y: number; w: number; h: number }): number {
  let n = 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * 4;
      if ((img.data[p] ?? 255) < 250 || (img.data[p + 1] ?? 255) < 250 || (img.data[p + 2] ?? 255) < 250) n++;
    }
  }
  return n;
}

export const encodePng = (img: Rgba): Buffer => diff.encodePng(img);
