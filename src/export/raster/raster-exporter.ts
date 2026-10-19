// `RasterExporter` (spec 08 §5): one PNG or JPEG file per planned page, drawn through
// `Canvas2DDrawingPlatform` by the session's `drawForExport`.
//
// - Single canvas when the page fits the safe budget (≤ 16,777,216 px and ≤ 8,192 px a side, the
//   WKWebView per-canvas limit): encoded by the host (`toBlob` / `Canvas.encode`) at quality 1.0.
// - Banded above it: full-width bands of `floor(16 MP / width)` rows (JPEG: rounded down to a
//   multiple of 16, the MCU height), one synchronous draw each with a band transform, their
//   `getImageData` rows streamed through `PngStreamEncoder` / `JpegStreamEncoder` to the sink. Only
//   one band is alive at a time. A band's rows are encoded in slices of about 2 MP with a yield to
//   the UI between slices (`between`), so the encoder never holds the main thread for a whole band
//   (L-02 found 1.3-1.5 s tasks encoding 16 MP PNG bands on the 2-core box).
// - Background: JPEG is filled white, then with the page's background colour when "Include
//   background" is on (an image background paints white, as on screen); PNG stays transparent.
import { Canvas2DDrawingPlatform } from '../../render';
import { BackgroundType, type Page } from '../../model';
import type { RasterPagePlan } from '../planner';
import type { ExportEnv, ExportSource, RasterCanvas, RasterContext2D } from '../types';
import { JpegStreamEncoder } from './jpeg-encoder';
import { PngStreamEncoder } from './png-encoder';

/** The WKWebView per-canvas pixel limit (spec 08 §5.2). */
export const SAFE_CANVAS_PIXELS = 16_777_216;
/** The Android side cap, kept for the single-canvas choice only. */
export const SAFE_CANVAS_SIDE = 8_192;
/** JPEG band heights are a multiple of the MCU height used for banding. */
export const JPEG_BAND_ROWS = 16;

export interface RasterPageInput {
  readonly source: ExportSource;
  readonly page: RasterPagePlan;
  readonly format: 'png' | 'jpg';
  readonly includeBackground: boolean;
  readonly env: ExportEnv;
  /** Every output chunk of this file, in order. */
  readonly out: (chunk: Uint8Array) => Promise<void>;
  /** Between bands: yields to the UI and throws when cancelled. */
  readonly between: (done: number) => Promise<void>;
}

function context(c: RasterCanvas): RasterContext2D {
  const ctx = c.getContext('2d');
  if (ctx === null) throw new RangeError('export: no 2d context');
  return ctx;
}

/** The JPEG ground (white, then the background colour when on); nothing for PNG. */
function fillGround(ctx: RasterContext2D, w: number, h: number, page: Page, input: RasterPageInput): void {
  if (input.format !== 'jpg') return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (input.includeBackground && page.background.type === BackgroundType.Color) {
    ctx.fillStyle = page.background.color.toCss(); // web `util.colorStr(back.getColor())`
    ctx.fillRect(0, 0, w, h);
  }
}

/** Pixels of a band encoded between two yields (spec 08 §5; verification 03 L-02, no task > 1 s). */
export const ENCODE_SLICE_PIXELS = 2_097_152;

/** Band height for a page `width` px wide under the budget. */
export function bandRows(width: number, format: 'png' | 'jpg', budget = SAFE_CANVAS_PIXELS): number {
  let rows = Math.max(1, Math.floor(budget / width));
  if (format === 'jpg') rows = Math.max(JPEG_BAND_ROWS, rows - (rows % JPEG_BAND_ROWS));
  return rows;
}

/** Whether a page is drawn on one canvas (else banded). */
export function fitsOneCanvas(w: number, h: number, budget?: { pixels: number; side: number }): boolean {
  const px = budget?.pixels ?? SAFE_CANVAS_PIXELS;
  const side = budget?.side ?? SAFE_CANVAS_SIDE;
  return w * h <= px && w <= side && h <= side;
}

/** Draws and encodes one page; resolves after its last chunk was awaited by `out`. */
export async function exportRasterPage(input: RasterPageInput): Promise<void> {
  const { source, page: rp, env } = input;
  const page = source.document.pages[rp.plan.pageIndex];
  if (page === undefined) throw new RangeError('export: page vanished');
  const w = rp.pixelWidth;
  const h = rp.pixelHeight;
  const view = { scale: rp.pixelScale, tx: rp.plan.translateX, ty: rp.plan.translateY };
  const painter = source.runtime.textPainter;
  const mime = input.format === 'png' ? 'image/png' : 'image/jpeg';

  if (fitsOneCanvas(w, h, env.canvasBudget)) {
    const canvas = env.canvasFactory.createCanvas(w, h);
    const ctx = context(canvas);
    fillGround(ctx, w, h, page, input);
    const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: painter });
    source.drawForExport(dp, rp.plan.pageIndex, input.includeBackground, view);
    const bytes = await env.canvasFactory.encode(canvas, mime, 1.0);
    canvas.width = 0;
    canvas.height = 0;
    await input.out(bytes);
    return;
  }

  const rows = bandRows(w, input.format, env.canvasBudget?.pixels);
  let slice = Math.max(1, Math.floor((env.encodeSlicePixels ?? ENCODE_SLICE_PIXELS) / w));
  if (input.format === 'jpg') slice = Math.max(JPEG_BAND_ROWS, slice - (slice % JPEG_BAND_ROWS));
  const canvas = env.canvasFactory.createCanvas(w, Math.min(rows, h));
  const ctx = context(canvas);
  const enc = input.format === 'png' ? new PngStreamEncoder(w, h) : new JpegStreamEncoder(w, h, 100);
  const dp = new Canvas2DDrawingPlatform(ctx, { textPainter: painter });
  try {
    for (let y0 = 0; y0 < h; y0 += rows) {
      const bh = Math.min(rows, h - y0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, canvas.height);
      fillGround(ctx, w, bh, page, input);
      ctx.setTransform(1, 0, 0, 1, 0, -y0);
      dp.setViewScale(1);
      source.drawForExport(dp, rp.plan.pageIndex, input.includeBackground, view);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const data = ctx.getImageData(0, 0, w, bh).data;
      // JPEG slices stay a multiple of 16 rows except the band's last (the encoder buffers a
      // partial MCU row across pushes anyway).
      const stride = w * 4;
      for (let r0 = 0; r0 < bh; r0 += slice) {
        const n = Math.min(slice, bh - r0);
        enc.pushRows(data.subarray(r0 * stride, (r0 + n) * stride), n);
        const last = y0 + r0 + n >= h;
        if (last) enc.finish();
        await input.out(enc.take());
        await input.between(y0 + r0 + n);
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
