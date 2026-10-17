// `RunImageFallback` (spec 08 §6.1 source 5, §7.1; spec 02: a function of `PdfFontResolver`): a
// run no font covers (offline web, an unknown script) and every emoji run is drawn as a PNG with
// alpha through the injected canvas factory, at 4 pixels per board unit (≥ 288 dpi at the 0.5
// PDF scale), with the box's own CSS font so the host's font fallback draws it as on screen.
// Images are de-duplicated per export by (text, font, size, colour, direction): a repeated emoji
// is one image XObject. The PDF places the image with its alphabetic baseline on the line's
// baseline and the canvas-measured width as the run's advance.
import type { RasterCanvasFactory } from '../types';

/** Pixels per board unit of a fallback image (spec 08 §7.1). */
export const RUN_IMAGE_SCALE = 4;

export interface RunImage {
  readonly png: Uint8Array;
  /** Pixel size of the PNG. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** The run's advance, board units. */
  readonly advance: number;
  /** Image box relative to the pen position on the baseline, board units (`left`/`top` ≥ 0). */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The canvas font of a `buildCanvasFont` string at another pixel size. */
export function scaledFont(font: string, factor: number): string {
  return font.replace(/^(\S+ \S+ )([0-9.eE+-]+)px /, (_m, head: string, px: string) => {
    return `${head}${String(Math.round(Number(px) * factor * 10000) / 10000)}px `;
  });
}

export class RunImageFallback {
  private readonly factory: RasterCanvasFactory;
  private readonly images = new Map<string, Promise<RunImage | null>>();
  private readonly done = new Map<string, RunImage | null>();

  constructor(factory: RasterCanvasFactory) {
    this.factory = factory;
  }

  static key(text: string, font: string, color: string, rtl: boolean): string {
    return `${text}\u0000${font}\u0000${color}\u0000${rtl ? 'r' : 'l'}`;
  }

  /** Renders (once per key) the run image. */
  render(text: string, font: string, px: number, color: string, rtl: boolean): Promise<RunImage | null> {
    const key = RunImageFallback.key(text, font, color, rtl);
    let p = this.images.get(key);
    if (p === undefined) {
      p = this.draw(text, font, px, color, rtl)
        .catch(() => null)
        .then((r) => {
          this.done.set(key, r);
          return r;
        });
      this.images.set(key, p);
    }
    return p;
  }

  /** A rendered image, synchronously (after `render` settled). */
  get(text: string, font: string, color: string, rtl: boolean): RunImage | null {
    return this.done.get(RunImageFallback.key(text, font, color, rtl)) ?? null;
  }

  private async draw(text: string, font: string, px: number, color: string, rtl: boolean): Promise<RunImage | null> {
    const s = RUN_IMAGE_SCALE;
    const f = scaledFont(font, s);
    const fpx = px * s;
    const probe = this.factory.createCanvas(1, 1);
    const pctx = probe.getContext('2d');
    if (pctx === null) return null;
    pctx.font = f;
    const m = pctx.measureText(text);
    const ascent = Math.max(m.fontBoundingBoxAscent ?? 0, m.actualBoundingBoxAscent ?? 0, 0.8 * fpx);
    const descent = Math.max(m.fontBoundingBoxDescent ?? 0, m.actualBoundingBoxDescent ?? 0, 0.2 * fpx);
    const width = Math.max(m.width, (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0));
    probe.width = 0;
    probe.height = 0;
    if (!(width > 0)) return null;
    const pad = Math.ceil(0.1 * fpx);
    const w = Math.ceil(width + 2 * pad);
    const h = Math.ceil(ascent + descent + 2 * pad);
    const c = this.factory.createCanvas(w, h);
    const ctx = c.getContext('2d');
    if (ctx === null) return null;
    ctx.font = f;
    if ('direction' in ctx) ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, pad, pad + ascent);
    const png = await this.factory.encode(c, 'image/png', 1);
    c.width = 0;
    c.height = 0;
    return {
      png,
      pixelWidth: w,
      pixelHeight: h,
      advance: m.width / s,
      left: pad / s,
      top: (pad + ascent) / s,
      width: w / s,
      height: h / s,
    };
  }
}
