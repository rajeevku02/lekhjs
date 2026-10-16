// A `DrawingPlatform` that paints nothing and records the bounds of what would be painted. An
// object's `layout()` paints its laid-out geometry into one to get its conservative extent (spec
// 03 §3.1): every pixel `paint()` can touch. Curves count by their control hull, ellipses and arcs
// by their circumscribed square, text and images by their rotated boxes; each stroked path is grown
// by its stroke's reach (half the width, five times for a miter join at the canvas's miter limit
// of 10).
import type { BezierCurve, Size } from '../geometry';
import { Point, Rect, rotate } from '../geometry';
import type { DrawingPlatform } from '../render';
import { JoinStyle, PaintType, type Style } from '../style';
import type { LaidOutText } from '../text';

/** Anti-aliasing and glyph overhang, in canvas units. */
const SLACK = 2;

export class BoundsPlatform implements DrawingPlatform {
  private minX_ = Infinity;
  private minY_ = Infinity;
  private maxX_ = -Infinity;
  private maxY_ = -Infinity;
  // The current path.
  private pMinX_ = Infinity;
  private pMinY_ = Infinity;
  private pMaxX_ = -Infinity;
  private pMaxY_ = -Infinity;
  private style_: Style | null = null;
  private dx_ = 0;
  private dy_ = 0;

  /** The bounds so far, or null when nothing was painted. */
  bounds(): Rect | null {
    if (this.minX_ > this.maxX_) return null;
    return new Rect(
      this.minX_ - SLACK,
      this.minY_ - SLACK,
      this.maxX_ - this.minX_ + 2 * SLACK,
      this.maxY_ - this.minY_ + 2 * SLACK,
    );
  }

  /** Adds a rect painted outside the platform (for example a child's extent). */
  addRect(r: Rect): void {
    this.add(r.x, r.y, r.right(), r.bottom());
  }

  private add(x1: number, y1: number, x2: number, y2: number): void {
    if (x1 < this.minX_) this.minX_ = x1;
    if (y1 < this.minY_) this.minY_ = y1;
    if (x2 > this.maxX_) this.maxX_ = x2;
    if (y2 > this.maxY_) this.maxY_ = y2;
  }

  private pathPoint(p: Point): void {
    const x = p.x + this.dx_;
    const y = p.y + this.dy_;
    if (x < this.pMinX_) this.pMinX_ = x;
    if (y < this.pMinY_) this.pMinY_ = y;
    if (x > this.pMaxX_) this.pMaxX_ = x;
    if (y > this.pMaxY_) this.pMaxY_ = y;
  }

  private resetPath(): void {
    this.pMinX_ = Infinity;
    this.pMinY_ = Infinity;
    this.pMaxX_ = -Infinity;
    this.pMaxY_ = -Infinity;
  }

  /**
   * The start point is not geometry: template paths start at (0, 0) and draw from their first
   * command; every other caller moves or draws from the start point anyway.
   */
  startDrawing(_pt: Point, style: Style): void {
    this.resetPath();
    this.style_ = style;
  }

  endDrawing(): void {
    if (this.pMinX_ <= this.pMaxX_) {
      let reach = 0;
      const st = this.style_;
      if (st !== null) {
        const w = Math.max(0, st.effectiveStrokeWidth());
        if (w > 0 && st.effectiveStrokePaint().type !== PaintType.NoPaint) {
          reach = st.effectiveJoinStyle() === JoinStyle.Miter ? w * 5 : w * 0.75;
        }
      }
      this.add(this.pMinX_ - reach, this.pMinY_ - reach, this.pMaxX_ + reach, this.pMaxY_ + reach);
    }
    this.resetPath();
    this.style_ = null;
  }

  closePath(): void {
    /* no new points */
  }
  addLineTo(pt: Point): void {
    this.pathPoint(pt);
  }
  moveTo(pt: Point): void {
    this.pathPoint(pt);
  }
  addCircle(center: Point, radius: number): void {
    this.resetPath();
    this.square(center, radius);
  }
  addArc(center: Point, radius: number): void {
    this.resetPath();
    this.square(center, radius);
  }
  addEllipse(center: Point, width: number, height: number): void {
    this.resetPath();
    this.square(center, Math.max(Math.abs(width), Math.abs(height)) / 2);
  }
  addCurve(curve: BezierCurve): void {
    this.pathPoint(curve.point1);
    this.pathPoint(curve.point2);
    this.pathPoint(curve.point3);
    if (curve.numPoints !== 3) this.pathPoint(curve.point4);
  }
  addRoundedRect(rect: Rect, angle: number): void {
    this.resetPath();
    for (const p of rotate(rect.getPoints(), rect.center(), angle)) this.pathPoint(p);
  }
  drawText(text: LaidOutText): void {
    const b = text.box;
    const pts = rotate(b.getPoints(), b.center(), text.angle);
    for (const p of pts) this.add(p.x + this.dx_, p.y + this.dy_, p.x + this.dx_, p.y + this.dy_);
  }
  /** Counted whether or not the image has arrived: its arrival changes no geometry (§7). */
  drawImage(center: Point, size: Size, rotation: number): void {
    const r = Rect.fromCenter(center, size.width, size.height);
    for (const p of rotate(r.getPoints(), center, rotation)) {
      this.add(p.x + this.dx_, p.y + this.dy_, p.x + this.dx_, p.y + this.dy_);
    }
  }
  saveContext(): void {
    /* translate is tracked without a stack: no shipped object issues it (spec 03 §9) */
  }
  restoreContext(): void {
    this.dx_ = 0;
    this.dy_ = 0;
  }
  translate(x: number, y: number): void {
    this.dx_ += x;
    this.dy_ += y;
  }
  clip(): void {
    /* a clip only shrinks what is painted */
  }

  private square(c: Point, r: number): void {
    this.pathPoint(new Point(c.x - r, c.y - r));
    this.pathPoint(new Point(c.x + r, c.y + r));
  }
}
