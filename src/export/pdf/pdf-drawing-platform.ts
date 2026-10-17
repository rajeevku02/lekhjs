// `PdfDrawingPlatform` (spec 08 §7, spec 02): `DrawingPlatform` → PDFKit operators, the same
// interface as `Canvas2DDrawingPlatform` and `SvgDrawingPlatform`, with the canvas platform's
// semantics so the PDF matches the PNG export:
// - a path is buffered from `startDrawing` and painted at `endDrawing`, fill then stroke (`B`),
//   inside `q … Q`; `addCircle`/`addEllipse`/`addArc`/`addRoundedRect` replace the path (the
//   canvas `beginPath`);
// - circles, ellipses (rotated) and arcs are cubic Béziers, ≤ 90° per segment;
// - solid colours carry their alpha as ExtGState opacity; a gradient fill uses **every stop**
//   (DR-EXP-02; the canvas draws the first and last), with stop alpha as PDFKit's soft mask;
//   spread is pad only;
// - join and cap follow the canvas (kashi's cap rule); dashes are written as a raw `d` operator
//   (PDFKit's `dash` rejects zero entries); a cubic clip step is a cubic;
// - images are drawn from bytes encoded in the pre-pass (`imageBytes`), each opened once;
// - no shadows (board objects never draw them).
import type { BezierCurve, PathStep, Point, Rect, Size } from '../../geometry';
import { PathStepType } from '../../geometry';
import type { ComputedGradient, DecodedImage, DrawingPlatform, ExportView, PathPaint } from '../../render';
import type { Color, Style } from '../../style';
import { CapStyle, JoinStyle, PaintType } from '../../style';
import type { LaidOutText } from '../../text';
import type { PdfDocument, PdfGradient, PdfImage } from './ports';
import type { PdfTextWriter } from './pdf-text-writer';

/** Cubic approximation of a quarter circle. */
const KAPPA = 0.5522847498;

type Op =
  | { readonly k: 'M' | 'L'; readonly x: number; readonly y: number }
  | { readonly k: 'Q'; readonly a: number; readonly b: number; readonly x: number; readonly y: number }
  | {
      readonly k: 'C';
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly k: 'Z' };

/** A number as a PDF operand (at most 4 decimals). */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

function rgb(c: Color): [number, number, number] {
  return [c.red, c.green, c.blue];
}

/** The cubic segments of an axis-aligned ellipse arc from `a0` sweeping `sweep` (radians, positive = clockwise in y-down). */
function arcOps(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, sweep: number): Op[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const P = (ux: number, uy: number): [number, number] => [cx + ux * cos - uy * sin, cy + ux * sin + uy * cos];
  const ops: Op[] = [];
  let t = a0;
  const [sx, sy] = P(rx * Math.cos(t), ry * Math.sin(t));
  ops.push({ k: 'M', x: sx, y: sy });
  for (let i = 0; i < n; i++) {
    const t1 = t + d;
    const c0 = Math.cos(t);
    const s0 = Math.sin(t);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    const [ax, ay] = P(rx * (c0 - k * s0), ry * (s0 + k * c0));
    const [bx, by] = P(rx * (c1 + k * s1), ry * (s1 - k * c1));
    const [ex, ey] = P(rx * c1, ry * s1);
    ops.push({ k: 'C', a: ax, b: ay, c: bx, d: by, x: ex, y: ey });
    t = t1;
  }
  return ops;
}

function joinOf(js: JoinStyle): 'miter' | 'round' | 'bevel' {
  if (js === JoinStyle.Bevel) return 'bevel';
  if (js === JoinStyle.Miter) return 'miter';
  return 'round';
}

/** kashi's cap rule, as `Canvas2DDrawingPlatform`. */
function capOf(style: Style, dashed: boolean): 'butt' | 'round' | 'square' {
  let cap: CapStyle | null = null;
  if (style.isCapStyleDefined()) cap = style.effectiveCapStyle();
  else {
    const inherited = style.effectiveCapStyle();
    if (inherited !== CapStyle.Round) cap = inherited;
  }
  if (cap === CapStyle.Butt) return 'butt';
  if (cap === CapStyle.Square) return 'square';
  if (cap === CapStyle.Round) return 'round';
  return dashed ? 'butt' : 'round';
}

/** The canvas `setLineDash` rules: a negative or non-finite entry ignores the dash; an all-zero one is solid. */
export function dashOperand(dash: readonly number[]): string | null {
  if (dash.length === 0) return null;
  if (dash.some((v) => !Number.isFinite(v) || v < 0)) return null;
  if (dash.every((v) => v === 0)) return null;
  return `[${dash.map(num).join(' ')}] 0 d`;
}

export interface PdfDrawingPlatformOptions {
  readonly doc: PdfDocument;
  readonly text: PdfTextWriter;
  /** Encoded bytes (JPEG or PNG) of every board image the pre-pass met. */
  readonly imageBytes: ReadonlyMap<DecodedImage, Uint8Array>;
}

export class PdfDrawingPlatform implements DrawingPlatform {
  private readonly doc: PdfDocument;
  private readonly text_: PdfTextWriter;
  private readonly imageBytes: ReadonlyMap<DecodedImage, Uint8Array>;
  private readonly opened = new Map<DecodedImage, PdfImage>();
  private style_: Style | null = null;
  private gradient_: ComputedGradient | null = null;
  private path_: Op[] = [];

  constructor(opts: PdfDrawingPlatformOptions) {
    this.doc = opts.doc;
    this.text_ = opts.text;
    this.imageBytes = opts.imageBytes;
  }

  applyExportView(view: ExportView): void {
    const s = view.scale;
    this.doc.transform(s, 0, 0, s, s * view.tx, s * view.ty);
  }

  // ---- paths ----

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    this.style_ = style;
    this.gradient_ = paint?.fillGradient ?? null;
    this.path_ = [{ k: 'M', x: pt.x, y: pt.y }];
  }

  endDrawing(): void {
    const style = this.style_;
    const path = this.path_;
    this.style_ = null;
    this.path_ = [];
    const gradient = this.gradient_;
    this.gradient_ = null;
    if (style === null || !path.some((o) => o.k !== 'M')) return;
    const doc = this.doc;
    const disabled = style.effectiveDisabled();
    let fill: PdfGradient | { color: Color } | null = null;
    if (style.fill()) {
      if (gradient !== null && gradient.stops.length > 1) fill = this.makeGradient(gradient);
      else {
        const c = style.effectiveFillPaint().solidColor;
        const color = disabled ? c.disabled() : c;
        if (color.alpha > 0) fill = { color };
      }
    }
    const width = Math.max(0, style.effectiveStrokeWidth());
    const sp = style.effectiveStrokePaint();
    let stroke: Color | null = null;
    if (width > 0 && sp.type !== PaintType.NoPaint) {
      const c = disabled ? sp.solidColor.disabled() : sp.solidColor;
      if (c.alpha > 0) stroke = c;
    }
    if (fill === null && stroke === null) return;
    doc.save();
    this.emit(path);
    if (fill !== null) {
      if ('color' in fill) doc.fillColor(rgb(fill.color), fill.color.alpha / 255);
      else doc.fillColor(fill);
    }
    if (stroke !== null) {
      doc.strokeColor(rgb(stroke), stroke.alpha / 255);
      const dash = style.effectiveDashArray();
      doc.lineJoin(joinOf(style.effectiveJoinStyle()));
      doc.lineCap(capOf(style, dash.length > 0));
      const d = dashOperand(dash);
      if (d !== null) doc.addContent(d);
      doc.lineWidth(width);
    }
    if (fill !== null && stroke !== null) doc.fillAndStroke('non-zero');
    else if (fill !== null) doc.fill('non-zero');
    else doc.stroke();
    doc.restore();
  }

  closePath(): void {
    this.path_.push({ k: 'Z' });
  }

  addLineTo(pt: Point): void {
    this.path_.push({ k: 'L', x: pt.x, y: pt.y });
  }

  moveTo(pt: Point): void {
    this.path_.push({ k: 'M', x: pt.x, y: pt.y });
  }

  addCircle(center: Point, radius: number): void {
    const r = radius < 0 ? 0 : radius;
    this.path_ = [...arcOps(center.x, center.y, r, r, 0, 0, 2 * Math.PI), { k: 'Z' }];
  }

  /** A clockwise arc (canvas `arc(…, false)`): a sweep ≥ 2π is a full circle, else `(a1 − a0) mod 2π`. */
  addArc(center: Point, radius: number, startAngle: number, endAngle: number): void {
    const full = 2 * Math.PI;
    let sweep = endAngle - startAngle;
    if (sweep >= full) sweep = full;
    else sweep = ((sweep % full) + full) % full;
    this.path_ = sweep === 0 ? [] : arcOps(center.x, center.y, radius, radius, 0, startAngle, sweep);
  }

  addEllipse(center: Point, width: number, height: number, rotation: number): void {
    const w = width < 0 ? 0 : width;
    const h = height < 0 ? 0 : height;
    this.path_ = [...arcOps(center.x, center.y, w / 2, h / 2, rotation, 0, 2 * Math.PI), { k: 'Z' }];
  }

  addCurve(curve: BezierCurve): void {
    if (curve.numPoints === 3) {
      this.path_.push({ k: 'Q', a: curve.point2.x, b: curve.point2.y, x: curve.point3.x, y: curve.point3.y });
    } else {
      this.path_.push({
        k: 'C',
        a: curve.point2.x,
        b: curve.point2.y,
        c: curve.point3.x,
        d: curve.point3.y,
        x: curve.point4.x,
        y: curve.point4.y,
      });
    }
  }

  /** The canvas platform's rounded rectangle (corner radius `min(w, h) / 5`); `angle` ignored as there. */
  addRoundedRect(rect: Rect): void {
    const r = Math.min(rect.width, rect.height) / 5;
    const k = r * (1 - KAPPA);
    const { x, y, width: w, height: h } = rect;
    this.path_ = [
      { k: 'M', x: x + r, y },
      { k: 'L', x: x + w - r, y },
      { k: 'C', a: x + w - k, b: y, c: x + w, d: y + k, x: x + w, y: y + r },
      { k: 'L', x: x + w, y: y + h - r },
      { k: 'C', a: x + w, b: y + h - k, c: x + w - k, d: y + h, x: x + w - r, y: y + h },
      { k: 'L', x: x + r, y: y + h },
      { k: 'C', a: x + k, b: y + h, c: x, d: y + h - k, x, y: y + h - r },
      { k: 'L', x, y: y + r },
      { k: 'C', a: x, b: y + k, c: x + k, d: y, x: x + r, y },
      { k: 'Z' },
    ];
  }

  // ---- text and images ----

  drawText(text: LaidOutText, style: Style): void {
    this.text_.write(text, style);
  }

  drawImage(center: Point, size: Size, rotation: number, image: DecodedImage | null | undefined): void {
    if (image === null || image === undefined) return;
    let opened = this.opened.get(image);
    if (opened === undefined) {
      const bytes = this.imageBytes.get(image);
      if (bytes === undefined) return;
      try {
        opened = this.doc.openImage(bytes);
      } catch {
        return; // an image PDFKit cannot read draws nothing, as a broken bitmap on canvas
      }
      this.opened.set(image, opened);
    }
    const doc = this.doc;
    doc.save();
    doc.translate(center.x, center.y);
    if (rotation !== 0) doc.rotate((rotation * 180) / Math.PI);
    doc.image(opened, -size.width / 2, -size.height / 2, { width: size.width, height: size.height });
    doc.restore();
  }

  // ---- state ----

  saveContext(): void {
    this.doc.save();
  }

  restoreContext(): void {
    this.doc.restore();
  }

  translate(x: number, y: number): void {
    this.doc.translate(x, y);
  }

  clip(path: readonly PathStep[]): void {
    if (path.length === 0) return;
    const ops: Op[] = [];
    for (const p of path) {
      switch (p.type) {
        case PathStepType.Move:
          ops.push({ k: 'M', x: p.p1.x, y: p.p1.y });
          break;
        case PathStepType.Line:
          ops.push({ k: 'L', x: p.p1.x, y: p.p1.y });
          break;
        case PathStepType.Quad:
          ops.push({ k: 'Q', a: p.p1.x, b: p.p1.y, x: p.p2.x, y: p.p2.y });
          break;
        case PathStepType.Cubic:
          ops.push({ k: 'C', a: p.p1.x, b: p.p1.y, c: p.p2.x, d: p.p2.y, x: p.p3.x, y: p.p3.y });
          break;
        case PathStepType.Close:
          ops.push({ k: 'Z' });
          break;
        default:
          break; // Arc: no sweep in a PathStep; skipped as the canvas skips it
      }
    }
    if (ops.length === 0) return;
    this.emit(ops);
    this.doc.clip('non-zero');
  }

  // ---- internals ----

  private emit(ops: readonly Op[]): void {
    const doc = this.doc;
    let open = false;
    for (const o of ops) {
      switch (o.k) {
        case 'M':
          doc.moveTo(o.x, o.y);
          open = true;
          break;
        case 'L':
          if (!open) doc.moveTo(o.x, o.y);
          else doc.lineTo(o.x, o.y);
          open = true;
          break;
        case 'Q':
          if (open) doc.quadraticCurveTo(o.a, o.b, o.x, o.y);
          break;
        case 'C':
          if (open) doc.bezierCurveTo(o.a, o.b, o.c, o.d, o.x, o.y);
          break;
        case 'Z':
          if (open) doc.closePath();
          break;
      }
    }
  }

  private makeGradient(g: ComputedGradient): PdfGradient {
    const grad =
      g.type === 'linear'
        ? this.doc.linearGradient(g.x1, g.y1, g.x2, g.y2)
        : this.doc.radialGradient(g.fx, g.fy, g.fr, g.cx, g.cy, g.r);
    let last = -Infinity;
    for (const s of g.stops) {
      const o = Math.min(1, Math.max(0, s.offset, last)); // offsets must not decrease
      last = o;
      grad.stop(o, rgb(s.color), s.color.alpha / 255);
    }
    return grad;
  }
}
