// Draws a `LaidOutText` (spec 06 §4). Canvas, the SVG render context and the PDF platform all
// implement the Canvas2D-shaped `TextPaintContext`, so every output places line i at the same
// baseline (AC-TXT-03). There is no per-platform wrapping anywhere.
//
// - `ctx.font` once per block (with `ctx.fontStretch` where the context has it);
// - `ctx.textAlign` is always the absolute `left`/`center`/`right` of the style, never
//   `start`/`end`, so a line's place in the box does not depend on its direction;
// - `ctx.direction` is set to each line's paragraph direction before its `fillText` (§3.5);
// - underline at `top + (LP − fs)/2 + 0.92·fs`, strike-through at `… + 0.5·fs`, thickness
//   `max(1 view px, fs/15)` (today's positions within the em box, `Platform.js:448-525`);
// - rotation about the box centre.
import type { Canvas2DLike } from '../base';
import { defaultFont } from './canvas-text-measurer';
import { splitFontKey } from './font-string';
import type { LaidOutText } from './text-layout';

/** The part of a 2-D context the painter uses. */
export type TextPaintContext = Pick<
  Canvas2DLike,
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'fillText'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'font'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'textAlign'
  | 'textBaseline'
> & { direction?: string; fontStretch?: string };

export interface TextPaintOptions {
  /** The text paint (a CSS colour or a gradient). */
  readonly fill: unknown;
  /** View pixels per canvas unit (zoom × DPR), for the 1-view-px minimum line thickness. Default 1. */
  readonly viewScale?: number;
}

export class TextPainter {
  paint(ctx: TextPaintContext, t: LaidOutText, opts: TextPaintOptions): void {
    if (t.lines.length === 0) return;
    ctx.save();
    if (t.angle !== 0) {
      const cx = t.box.x + t.box.width / 2;
      const cy = t.box.y + t.box.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(t.angle);
      ctx.translate(-cx, -cy);
    }
    const font = splitFontKey(t.fontKey).font;
    try {
      ctx.font = font;
    } catch {
      ctx.font = defaultFont(font); // a context that throws on an invalid font
    }
    if ('fontStretch' in ctx) ctx.fontStretch = t.stretch;
    ctx.textAlign = t.align;
    ctx.textBaseline = t.baseline;
    ctx.fillStyle = opts.fill;
    ctx.strokeStyle = opts.fill;
    const fs = t.px;
    const decorate = t.underline || t.strikeThrough;
    if (decorate) ctx.lineWidth = Math.max(1 / (opts.viewScale ?? 1), fs / 15);
    const hasDirection = 'direction' in ctx;
    for (const line of t.lines) {
      if (hasDirection) ctx.direction = line.dir;
      ctx.fillText(line.text, line.x, line.baselineY);
      if (decorate) {
        let x1 = line.x;
        let x2 = line.x + line.width;
        if (t.align === 'right') {
          x1 = line.x - line.width;
          x2 = line.x;
        } else if (t.align === 'center') {
          x1 = line.x - line.width / 2;
          x2 = line.x + line.width / 2;
        }
        const em = line.top + (t.lineHeight - fs) / 2;
        ctx.beginPath();
        if (t.strikeThrough) {
          ctx.moveTo(x1, em + 0.5 * fs);
          ctx.lineTo(x2, em + 0.5 * fs);
        }
        if (t.underline) {
          ctx.moveTo(x1, em + 0.92 * fs);
          ctx.lineTo(x2, em + 0.92 * fs);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
