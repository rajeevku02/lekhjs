// A `DrawingPlatform` that takes document points and draws them on the Middle (overlay) layer,
// which is in view units: each point through the view (`zoom · (p + scroll)`), lengths, stroke
// widths and dash arrays times the zoom. C++ drew the selection's extras
// (`drawSelectionVertices`, `drawExtraWhenSelected`) in document units on the zoomed and
// scrolled platform of `LekhCore::draw`, whose web `zoomCanvas` scales the context, so the line
// width and the dashes scale with the zoom; this gives the same picture.
//
// Only what those extras draw is mapped (paths of lines, curves, circles, arcs, ellipses and
// rounded rectangles); text, images and clips are not drawn. A style is copied with its
// effective stroke width and dash array scaled (the copy has no parent).
import { BezierCurve, Point, Rect } from '../../geometry';
import type { DrawingPlatform, PathPaint, ViewTransform } from '../../render';
import type { Style } from '../../style';

export class ViewMappedPlatform implements DrawingPlatform {
  private readonly dp_: DrawingPlatform;
  private readonly view_: ViewTransform;

  constructor(dp: DrawingPlatform, view: ViewTransform) {
    this.dp_ = dp;
    this.view_ = view;
  }

  private map(p: Point): Point {
    return this.view_.toScreen(p);
  }

  private len(v: number): number {
    return v * this.view_.zoom;
  }

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    const s = style.clone();
    s.setStrokeWidth(this.len(style.effectiveStrokeWidth()));
    const dash = style.effectiveDashArray();
    if (dash.length > 0) s.setDashArray(dash.map((d) => this.len(d)));
    this.dp_.startDrawing(this.map(pt), s, paint);
  }

  endDrawing(): void {
    this.dp_.endDrawing();
  }

  closePath(): void {
    this.dp_.closePath();
  }

  addLineTo(pt: Point): void {
    this.dp_.addLineTo(this.map(pt));
  }

  moveTo(pt: Point): void {
    this.dp_.moveTo(this.map(pt));
  }

  addCircle(center: Point, radius: number): void {
    this.dp_.addCircle(this.map(center), this.len(radius));
  }

  addArc(center: Point, radius: number, startAngle: number, endAngle: number): void {
    this.dp_.addArc(this.map(center), this.len(radius), startAngle, endAngle);
  }

  addEllipse(center: Point, width: number, height: number, rotation: number): void {
    this.dp_.addEllipse(this.map(center), this.len(width), this.len(height), rotation);
  }

  addCurve(curve: BezierCurve): void {
    this.dp_.addCurve(
      new BezierCurve(this.map(curve.point1), this.map(curve.point2), this.map(curve.point3), this.map(curve.point4)),
    );
  }

  addRoundedRect(rect: Rect, angle: number): void {
    const p = this.map(new Point(rect.x, rect.y));
    this.dp_.addRoundedRect(new Rect(p.x, p.y, this.len(rect.width), this.len(rect.height)), angle);
  }

  drawText(): void {
    /* not drawn (see the header) */
  }

  drawImage(): void {
    /* not drawn (see the header) */
  }

  saveContext(): void {
    this.dp_.saveContext();
  }

  restoreContext(): void {
    this.dp_.restoreContext();
  }

  translate(x: number, y: number): void {
    this.dp_.translate(this.len(x), this.len(y));
  }

  clip(): void {
    /* not drawn (see the header) */
  }
}
