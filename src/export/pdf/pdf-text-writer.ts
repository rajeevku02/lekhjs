// `PdfTextWriter` (spec 08 §7.1, spec 02): writes a laid-out text block into the PDF. The engine's
// lines are kept as they are (the PDF never wraps); each line's runs come from `PdfFontResolver`
// in visual order and are placed left to right with their PDF-measured advances, so centre and
// right alignment are exact in the PDF:
// - one baseline per line, the engine's `baselineY` (the primary font's metrics, as on canvas);
//   fallback-font and image runs sit on it too;
// - embedded runs are PDF text (`doc.text`, alphabetic baseline, default OpenType features, so
//   fontkit shapes Arabic and Indic and orders an RTL run's glyphs); a missing italic face is a
//   12° skew;
// - outlined runs (restricted or variable fonts, spec 08 §6.4) are filled glyph paths with no
//   text object, and no invisible text layer (OQ-54);
// - image runs are the `RunImageFallback` PNG with its baseline on the line's;
// - underline and strike-through are filled rectangles at the canvas painter's offsets
//   (`top + (LP − fs)/2 + 0.92·fs` and `+ 0.5·fs`, thickness `max(1, fs/15)`), across the line;
// - rotation about the box centre.
import type { Color, Style } from '../../style';
import type { LaidOutText } from '../../text';
import type { OpenedFont } from './font-embedding';
import type { LineRun, PdfFontResolver } from './pdf-font-resolver';
import type { PdfDocument, PdfImage } from './ports';
import type { RunImage } from './run-image-fallback';

/** The synthetic italic skew (WebKit and Chrome draw 12° on screen). */
export const SYNTHETIC_ITALIC_DEGREES = 12;
const SKEW = Math.tan((SYNTHETIC_ITALIC_DEGREES * Math.PI) / 180);

export function rgbOf(c: Color): [number, number, number] {
  return [c.red, c.green, c.blue];
}

/** The CSS colour a fallback image is drawn with (its de-duplication key, spec 08 §7.1). */
export function textColorCss(style: Style): string {
  const c = style.effectiveDisabled()
    ? style.effectiveTextFill().solidColor.disabled()
    : style.effectiveTextFill().solidColor;
  return c.toCss();
}

function textColor(style: Style): Color {
  const c = style.effectiveTextFill().solidColor;
  return style.effectiveDisabled() ? c.disabled() : c;
}

export class PdfTextWriter {
  private readonly doc: PdfDocument;
  private readonly resolver: PdfFontResolver;
  private readonly registered = new Set<string>();
  private readonly images = new Map<RunImage, PdfImage>();
  private outlinedRuns = 0;
  private failedRuns = 0;

  constructor(doc: PdfDocument, resolver: PdfFontResolver) {
    this.doc = doc;
    this.resolver = resolver;
  }

  /** Runs drawn as outlines so far (`font_outlined`). */
  get outlined(): number {
    return this.outlinedRuns;
  }

  /** Font runs left out because drawing them threw (logged as `font_run_failed`). */
  get failed(): number {
    return this.failedRuns;
  }

  write(t: LaidOutText, style: Style): void {
    if (t.lines.length === 0) return;
    const doc = this.doc;
    const color = textColor(style);
    if (color.alpha === 0) return;
    const css = textColorCss(style);
    const rgb = rgbOf(color);
    const opacity = color.alpha / 255;
    doc.save();
    if (t.angle !== 0) {
      const cx = t.box.x + t.box.width / 2;
      const cy = t.box.y + t.box.height / 2;
      doc.rotate((t.angle * 180) / Math.PI, { origin: [cx, cy] });
    }
    doc.fillColor(rgb, opacity);
    const fs = t.px;
    for (const line of t.lines) {
      const plan = this.resolver.plan(t, line, css);
      const w = plan.width;
      const x0 = t.align === 'left' ? line.x : t.align === 'right' ? line.x - w : line.x - w / 2;
      const baseline = t.baseline === 'top' ? line.baselineY + t.ascent : line.baselineY;
      let x = x0;
      for (const run of plan.runs) {
        this.run(run, x, baseline, fs, rgb, opacity);
        x += run.width;
      }
      if ((t.underline || t.strikeThrough) && w > 0) {
        const th = Math.max(1, fs / 15);
        const em = line.top + (t.lineHeight - fs) / 2;
        if (t.strikeThrough) doc.rect(x0, em + 0.5 * fs - th / 2, w, th);
        if (t.underline) doc.rect(x0, em + 0.92 * fs - th / 2, w, th);
        doc.fill('non-zero');
      }
    }
    doc.restore();
  }

  private run(
    r: LineRun,
    x: number,
    baseline: number,
    px: number,
    rgb: [number, number, number],
    opacity: number,
  ): void {
    const doc = this.doc;
    if (r.kind === 'image') {
      const img = r.image;
      if (img === null) return;
      let opened = this.images.get(img);
      if (opened === undefined) {
        opened = doc.openImage(img.png);
        this.images.set(img, opened);
      }
      doc.image(opened, x - img.left, baseline - img.top, { width: img.width, height: img.height });
      return;
    }
    if (r.text === '') return;
    try {
      this.drawFontRun(r, x, baseline, px, rgb, opacity);
    } catch {
      // One run fontkit or PDFKit cannot draw is left out; the export goes on.
      this.failedRuns++;
    }
  }

  private drawFontRun(
    r: Extract<LineRun, { kind: 'font' }>,
    x: number,
    baseline: number,
    px: number,
    rgb: [number, number, number],
    opacity: number,
  ): void {
    const doc = this.doc;
    if (r.font.mode === 'outline') {
      if (this.outline(r.font, r.text, x, baseline, px, r.synthItalic)) {
        doc.fillColor(rgb, opacity);
        doc.fill('non-zero');
      }
      this.outlinedRuns++;
      return;
    }
    if (!this.registered.has(r.font.key)) {
      doc.registerFont(r.font.key, r.font.font);
      this.registered.add(r.font.key);
    }
    doc.font(r.font.key).fontSize(px);
    doc.text(r.text, x, baseline, {
      lineBreak: false,
      baseline: 'alphabetic',
      features: [],
      ...(r.synthItalic ? { oblique: SYNTHETIC_ITALIC_DEGREES } : {}),
    });
  }

  /** Appends the glyph outlines of `text` to the current path (font units → board units, y down). */
  private outline(f: OpenedFont, text: string, x: number, baseline: number, px: number, skew: boolean): boolean {
    const doc = this.doc;
    let any = false;
    const run = f.font.layout(text, []);
    const s = px / f.font.unitsPerEm;
    const k = skew ? SKEW : 0;
    let pen = x;
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i];
      const gx = pen + (pos?.xOffset ?? 0) * s;
      const gy = baseline - (pos?.yOffset ?? 0) * s;
      const X = (a: number, b: number): number => gx + a * s + k * b * s;
      const Y = (b: number): number => gy - b * s;
      for (const c of g.path.commands) {
        const a = c.args;
        any = true;
        switch (c.command) {
          case 'moveTo':
            doc.moveTo(X(a[0] ?? 0, a[1] ?? 0), Y(a[1] ?? 0));
            break;
          case 'lineTo':
            doc.lineTo(X(a[0] ?? 0, a[1] ?? 0), Y(a[1] ?? 0));
            break;
          case 'quadraticCurveTo':
            doc.quadraticCurveTo(X(a[0] ?? 0, a[1] ?? 0), Y(a[1] ?? 0), X(a[2] ?? 0, a[3] ?? 0), Y(a[3] ?? 0));
            break;
          case 'bezierCurveTo':
            doc.bezierCurveTo(
              X(a[0] ?? 0, a[1] ?? 0),
              Y(a[1] ?? 0),
              X(a[2] ?? 0, a[3] ?? 0),
              Y(a[3] ?? 0),
              X(a[4] ?? 0, a[5] ?? 0),
              Y(a[5] ?? 0),
            );
            break;
          case 'closePath':
            doc.closePath();
            break;
        }
      }
      pen += (pos?.xAdvance ?? 0) * s;
    });
    return any;
  }
}
