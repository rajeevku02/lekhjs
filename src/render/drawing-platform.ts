// The drawing calls the engine paints through (port of C++ `DrawingPlatform`, `L/Platform.h:406-437`).
//
// A retained-path surface: `startDrawing` begins a path with a style, the `add*`/`moveTo` calls
// build it, `endDrawing` fills and strokes it with that style. Text arrives already laid out
// (`text/TextLayout`), images already decoded (`ImageCache`). Canvas, SVG, PDF and the capture
// platforms implement it.
//
// Not carried over from C++:
// - `setBackground`: a no-op on every host; the page background is `GridPainter`'s job;
// - `drawText(const char*, floating, …)`: only legacy objects called it, and legacy types are
//   converted on load (OQ-14); `drawText` here is the C++ `drawTextWithParam`;
// - `rootPlatform`: it existed for `TranslatedDrawingPlatform` / `ScaledDrawingPlatform`, which
//   the canvas transform replaces (spec 03 §9).
// - the `DrawingProfile` argument of `drawImage`: no host read it.
import type { BezierCurve, PathStep, Point, Rect, Size } from '../geometry';
import type { GradientStop, Style } from '../style';
import type { LaidOutText } from '../text';
import type { DecodedImage } from './ports';

/** A linear gradient in canvas units (C++ `Gradient::Linear::computed*`). */
export interface ComputedLinearGradient {
  readonly type: 'linear';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly GradientStop[];
}

/** A radial gradient in canvas units (C++ `Gradient::Radial::computed*`). */
export interface ComputedRadialGradient {
  readonly type: 'radial';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx: number;
  readonly fy: number;
  readonly fr: number;
  readonly stops: readonly GradientStop[];
}

export type ComputedGradient = ComputedLinearGradient | ComputedRadialGradient;

/**
 * What a path's paint needs beyond its `Style`. The gradient coordinates are layout output (B10:
 * they are computed into the layout, never written into the style); a caller that passes none
 * gets the solid fill colour, as the web and backend platforms paint today.
 */
export interface PathPaint {
  readonly fillGradient?: ComputedGradient | null;
}

export interface DrawingPlatform {
  /** Begins a path at `pt`, painted with `style` at `endDrawing`. */
  startDrawing(pt: Point, style: Style, paint?: PathPaint): void;
  /** Fills (if the style fills) and strokes (if it has a stroke width and paint) the path. */
  endDrawing(): void;
  closePath(): void;
  addLineTo(pt: Point): void;
  moveTo(pt: Point): void;
  /** Replaces the path with a circle (C++ semantics: the path so far is discarded). */
  addCircle(center: Point, radius: number): void;
  /** Replaces the path with a clockwise arc. */
  addArc(center: Point, radius: number, startAngle: number, endAngle: number): void;
  /** Replaces the path with an ellipse of the given full width and height, rotated about its centre. */
  addEllipse(center: Point, width: number, height: number, rotation: number): void;
  /** Appends a curve from the current point: quadratic when `numPoints === 3`, else cubic. */
  addCurve(curve: BezierCurve): void;
  /** Replaces the path with a rounded rectangle (corner radius `min(w, h) / 5`). */
  addRoundedRect(rect: Rect, angle: number): void;
  /** Paints a laid-out text block with the style's text fill. */
  drawText(text: LaidOutText, style: Style): void;
  /** Draws `image` centred at `center`, `size` large, rotated by `rotation`. Nothing when absent. */
  drawImage(center: Point, size: Size, rotation: number, image: DecodedImage | null | undefined): void;
  saveContext(): void;
  restoreContext(): void;
  translate(x: number, y: number): void;
  clip(path: readonly PathStep[]): void;
}
