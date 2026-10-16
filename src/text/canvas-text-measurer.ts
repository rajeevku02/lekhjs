// The one `TextMeasurer` (spec 06 §5.1): canvas `measureText` over a 2-D context — the browser's
// `OffscreenCanvas` / detached `<canvas>`, or a `@napi-rs/canvas` context the backend passes in.
//
// - `ctx.font` is assigned only when the key changes; the stretch part of the key goes to
//   `ctx.fontStretch` where the context has it.
// - A font string the context rejects (the read-back did not change, or the assignment threw) is re-assigned with the
//   bundled default family list, logged once per key (spec 06 §8.4).
// - `ascent`/`descent` are `fontBoundingBoxAscent/Descent`, NaN when the context lacks them;
//   `TextLayout` then uses the hhea metrics (OQ-38).
import type { Canvas2DLike, Logger } from '../base';
import { fontPx, replaceFamilies, splitFontKey } from './font-string';
import type { CanvasFactory, LineMetrics, TextMeasurer } from './ports';

const DEFAULT_FAMILIES: readonly string[] = Object.freeze(['"Noto Sans"', 'sans-serif']);

export class CanvasTextMeasurer implements TextMeasurer {
  private readonly ctx: Canvas2DLike;
  private readonly logger: Logger | undefined;
  private currentKey: string | null = null;
  private currentFont: string | null = null;
  private readonly rejected = new Set<string>();
  private calls_ = 0;

  constructor(ctx: Canvas2DLike, logger?: Logger) {
    this.ctx = ctx;
    this.logger = logger;
  }

  /** A measurer over a 1×1 canvas from `factory`. */
  static fromFactory(factory: CanvasFactory, logger?: Logger): CanvasTextMeasurer {
    const ctx = factory.createCanvas(1, 1).getContext('2d');
    if (ctx === null) throw new Error('CanvasFactory returned no 2d context');
    return new CanvasTextMeasurer(ctx, logger);
  }

  /** How many times `measureText` ran (for tests and stats). */
  get calls(): number {
    return this.calls_;
  }

  measureLine(text: string, fontKey: string): LineMetrics {
    this.apply(fontKey);
    this.calls_++;
    const m = this.ctx.measureText(text);
    return {
      width: m.width,
      ascent: m.fontBoundingBoxAscent ?? NaN,
      descent: m.fontBoundingBoxDescent ?? NaN,
    };
  }

  private apply(fontKey: string): void {
    if (fontKey === this.currentKey) return;
    const { font, stretch } = splitFontKey(fontKey);
    if (font !== this.currentFont) this.assign(font, fontKey);
    if ('fontStretch' in this.ctx) this.ctx.fontStretch = stretch;
    this.currentKey = fontKey;
  }

  private assign(font: string, fontKey: string): void {
    const before = this.ctx.font;
    let accepted: boolean;
    try {
      this.ctx.font = font;
      accepted = this.ctx.font !== before || font === before;
    } catch {
      accepted = false; // @napi-rs/canvas throws where a browser ignores the assignment
    }
    if (!accepted) {
      // Rejected (an invalid font string leaves the previous value in place).
      if (!this.rejected.has(fontKey)) {
        this.rejected.add(fontKey);
        this.logger?.warn('font_rejected', { code: 'font_rejected' });
      }
      this.ctx.font = defaultFont(font);
    }
    this.currentFont = font;
  }
}

/** `font` with the bundled default families; a string that cannot be parsed becomes `<px>px "Noto Sans", sans-serif`. */
export function defaultFont(font: string): string {
  const r = replaceFamilies(font, DEFAULT_FAMILIES);
  if (r !== font) return r;
  const px = fontPx(font);
  return `${String(Number.isFinite(px) ? px : 10)}px ${DEFAULT_FAMILIES.join(', ')}`;
}
