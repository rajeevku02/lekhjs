// `DrawingPlatform` over a CanvasRenderingContext2D-shaped context (spec 02 §6): the browser
// canvases, PNG/JPEG export and kashi's `board_render`. Replaces `JSDrawingPlatform`
// (the web app's `board/common/Platform.js`), kashi's `BackendDrawingPlatform`
// (`kashi/service/mcp/core/drawing.js`) and the iOS/Android drawing platforms.
//
// Zoom and scroll are the context's transform (`setView`, spec 03 §9); this class never scales a
// coordinate. Differences from the hosts it replaces, each deliberate:
// - no shadows (owner decision): `Style.shadow` is read and written but never drawn, so the
//   web's "shadow but no border" 0.001-wide stroke is gone too;
// - join and cap come from the effective style, as kashi draws them since Work 01M3EX3A (the web
//   asked `isJoinStyleDefined()`, which is false for every templated shape, and drew miter and
//   bevel joins as round);
// - the dash is reset when a style has none (kashi's fix; harmless under save/restore);
// - a cubic segment in a clip path is a cubic (the web passed it to `quadraticCurveTo`); an `Arc`
//   step is skipped, as on both hosts (a `PathStep` carries no sweep);
// - `addRoundedRect` draws the rounded rectangle iOS and the SVG exporter draw (the web and
//   kashi left it empty); only legacy objects called it, and they are converted on load;
// - a gradient fill is drawn only when the caller passes its computed coordinates
//   (`PathPaint.fillGradient`), from the first to the last stop as iOS draws it; otherwise the
//   solid colour, as the web and kashi paint every fill.
import type { Canvas2DLike, GradientLike } from '../base';
import type { BezierCurve, PathStep, Point, Rect, Size } from '../geometry';
import { PathStepType } from '../geometry';
import type { Color, Style } from '../style';
import { CapStyle, JoinStyle, PaintType } from '../style';
import type { LaidOutText } from '../text';
import { TextPainter } from '../text';
import type { ComputedGradient, DrawingPlatform, ExportView, PathPaint } from './drawing-platform';
import type { DecodedImage } from './ports';
import type { ViewTransform } from './view-transform';

/** The web's full-turn constant for circles and ellipses (`0 … 6.3`, slightly over 2π). */
const FULL_TURN = 6.3;
/** Cubic approximation of a quarter circle: control points at `KAPPA · r` from the corner's ends. */
const KAPPA = 0.5522847498;

/** CSS colour of `c`, through `disabled()` when the style is disabled (web `util.colorStr`). */
export function cssColor(c: Color, disabled: boolean): string {
  return (disabled ? c.disabled() : c).toCss();
}

export interface Canvas2DDrawingPlatformOptions {
  /** Device pixels per canvas unit, for the 1-device-pixel minimum of text decorations. Default 1. */
  readonly viewScale?: number;
  readonly textPainter?: TextPainter;
}

export class Canvas2DDrawingPlatform implements DrawingPlatform {
  private ctx_: Canvas2DLike;
  private viewScale_: number;
  private readonly painter_: TextPainter;
  private style_: Style | null = null;
  private gradient_: ComputedGradient | null = null;

  constructor(ctx: Canvas2DLike, opts: Canvas2DDrawingPlatformOptions = {}) {
    this.ctx_ = ctx;
    this.viewScale_ = opts.viewScale ?? 1;
    this.painter_ = opts.textPainter ?? new TextPainter();
  }

  get context(): Canvas2DLike {
    return this.ctx_;
  }

  /** Points the platform at another context (kashi reuses one platform per render). */
  setContext(ctx: Canvas2DLike): void {
    this.ctx_ = ctx;
    this.style_ = null;
    this.gradient_ = null;
  }

  get viewScale(): number {
    return this.viewScale_;
  }

  setViewScale(scale: number): void {
    this.viewScale_ = scale;
  }

  /**
   * Export (spec 08 §5): multiplies the context's transform by `scale × (p + (tx, ty))`, so a
   * band or page transform the caller set first still applies; the decoration minimum follows.
   */
  applyExportView(view: ExportView): void {
    const s = view.scale;
    this.ctx_.transform(s, 0, 0, s, s * view.tx, s * view.ty);
    this.viewScale_ *= s;
  }

  /** Applies the view's document transform to the context and adopts its scale. */
  setView(view: ViewTransform): void {
    view.apply(this.ctx_);
    this.viewScale_ = view.viewScale;
  }

  // ---- paths ----

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    this.style_ = style;
    this.gradient_ = paint?.fillGradient ?? null;
    this.ctx_.beginPath();
    this.ctx_.moveTo(pt.x, pt.y);
  }

  endDrawing(): void {
    const style = this.style_;
    if (style === null) return;
    const ctx = this.ctx_;
    const disabled = style.effectiveDisabled();
    ctx.save();
    if (style.fill()) {
      const g = this.gradient_;
      ctx.fillStyle =
        g !== null && g.stops.length > 1
          ? this.makeGradient(g)
          : cssColor(style.effectiveFillPaint().solidColor, disabled);
      ctx.fill();
    }
    const width = Math.max(0, style.effectiveStrokeWidth());
    const stroke = style.effectiveStrokePaint();
    if (width > 0 && stroke.type !== PaintType.NoPaint) {
      ctx.strokeStyle = cssColor(stroke.solidColor, disabled);
      ctx.lineJoin = joinCss(style.effectiveJoinStyle());
      const dash = style.effectiveDashArray();
      ctx.lineCap = capCss(style, dash.length > 0);
      ctx.setLineDash(dash.length > 0 ? [...dash] : []);
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.restore();
    this.style_ = null;
    this.gradient_ = null;
  }

  closePath(): void {
    this.ctx_.closePath();
  }

  addLineTo(pt: Point): void {
    this.ctx_.lineTo(pt.x, pt.y);
  }

  moveTo(pt: Point): void {
    this.ctx_.moveTo(pt.x, pt.y);
  }

  addCircle(center: Point, radius: number): void {
    const r = radius < 0 ? 0 : radius;
    this.ctx_.beginPath();
    this.ctx_.ellipse(center.x, center.y, r, r, 0, 0, FULL_TURN);
  }

  addArc(center: Point, radius: number, startAngle: number, endAngle: number): void {
    this.ctx_.beginPath();
    this.ctx_.arc(center.x, center.y, radius, startAngle, endAngle, false);
  }

  addEllipse(center: Point, width: number, height: number, rotation: number): void {
    const w = width < 0 ? 0 : width;
    const h = height < 0 ? 0 : height;
    this.ctx_.beginPath();
    this.ctx_.ellipse(center.x, center.y, w / 2, h / 2, rotation, 0, FULL_TURN);
  }

  addCurve(curve: BezierCurve): void {
    if (curve.numPoints === 3) {
      this.ctx_.quadraticCurveTo(curve.point2.x, curve.point2.y, curve.point3.x, curve.point3.y);
    } else {
      this.ctx_.bezierCurveTo(
        curve.point2.x,
        curve.point2.y,
        curve.point3.x,
        curve.point3.y,
        curve.point4.x,
        curve.point4.y,
      );
    }
  }

  /** `angle` is ignored, as iOS and the SVG exporter ignore it. */
  addRoundedRect(rect: Rect): void {
    const ctx = this.ctx_;
    const r = Math.min(rect.width, rect.height) / 5; // LekhUtil::getCornerRadius
    const k = r * (1 - KAPPA);
    const { x, y, width: w, height: h } = rect;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.bezierCurveTo(x, y + k, x + k, y, x + r, y);
    ctx.closePath();
  }

  // ---- text and images ----

  drawText(text: LaidOutText, style: Style): void {
    this.painter_.paint(this.ctx_, text, {
      fill: cssColor(style.effectiveTextFill().solidColor, style.effectiveDisabled()),
      viewScale: this.viewScale_,
    });
  }

  drawImage(center: Point, size: Size, rotation: number, image: DecodedImage | null | undefined): void {
    if (image === null || image === undefined) return;
    const ctx = this.ctx_;
    ctx.save();
    ctx.translate(center.x, center.y);
    if (rotation !== 0) ctx.rotate(rotation);
    try {
      ctx.drawImage(image.source, -size.width / 2, -size.height / 2, size.width, size.height);
    } catch {
      // A closed or broken bitmap draws nothing, as the web and kashi platforms do.
    }
    ctx.restore();
  }

  // ---- state ----

  saveContext(): void {
    this.ctx_.save();
  }

  restoreContext(): void {
    this.ctx_.restore();
  }

  translate(x: number, y: number): void {
    this.ctx_.translate(x, y);
  }

  clip(path: readonly PathStep[]): void {
    if (path.length === 0) return;
    const ctx = this.ctx_;
    ctx.beginPath();
    for (const p of path) {
      switch (p.type) {
        case PathStepType.Move:
          ctx.moveTo(p.p1.x, p.p1.y);
          break;
        case PathStepType.Line:
          ctx.lineTo(p.p1.x, p.p1.y);
          break;
        case PathStepType.Quad:
          ctx.quadraticCurveTo(p.p1.x, p.p1.y, p.p2.x, p.p2.y);
          break;
        case PathStepType.Cubic:
          ctx.bezierCurveTo(p.p1.x, p.p1.y, p.p2.x, p.p2.y, p.p3.x, p.p3.y);
          break;
        case PathStepType.Close:
          ctx.closePath();
          break;
        default:
          break; // Arc: no sweep in a PathStep; skipped as on both hosts
      }
    }
    ctx.clip();
  }

  private makeGradient(g: ComputedGradient): GradientLike {
    const grad =
      g.type === 'linear'
        ? this.ctx_.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
        : this.ctx_.createRadialGradient(g.fx, g.fy, g.fr, g.cx, g.cy, g.r);
    const first = g.stops[0];
    const last = g.stops[g.stops.length - 1];
    if (first !== undefined) grad.addColorStop(0, first.color.toCss());
    if (last !== undefined) grad.addColorStop(1, last.color.toCss());
    return grad;
  }
}

function joinCss(js: JoinStyle): string {
  if (js === JoinStyle.Bevel) return 'bevel';
  if (js === JoinStyle.Miter) return 'miter';
  return 'round';
}

/**
 * kashi's cap rule: the style's own cap wins; otherwise an inherited non-round cap (it can only
 * have come from a parent); otherwise butt when dashed and round when not.
 */
function capCss(style: Style, dashed: boolean): string {
  let cap: CapStyle | null = null;
  if (style.isCapStyleDefined()) {
    cap = style.effectiveCapStyle();
  } else {
    const inherited = style.effectiveCapStyle();
    if (inherited !== CapStyle.Round) cap = inherited;
  }
  if (cap === CapStyle.Butt) return 'butt';
  if (cap === CapStyle.Square) return 'square';
  if (cap === CapStyle.Round) return 'round';
  return dashed ? 'butt' : 'round';
}
