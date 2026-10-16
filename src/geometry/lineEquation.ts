// Infinite line A·x + B·y + C = 0 (port of C++ `geometry::LineEquation`). Immutable:
// `translateOrigin` and `rotate` return a new equation.
import { Point } from './point';
import { rotatePoint } from './primitives';

export class LineEquation {
  readonly A: number;
  readonly B: number;
  readonly C: number;

  constructor(A: number, B: number, C: number) {
    this.A = A;
    this.B = B;
    this.C = C;
  }

  /** The line through `p1` and `p2`. */
  static through(p1: Point, p2: Point): LineEquation {
    return new LineEquation(p2.y - p1.y, p1.x - p2.x, p1.y * p2.x - p1.x * p2.y);
  }

  /** The line through `pt` at angle `theta` (radians) to the x axis. */
  static fromAngle(theta: number, pt: Point): LineEquation {
    const A = Math.sin(theta);
    const B = -Math.cos(theta);
    const C = -(pt.x * A) + pt.y * -B;
    return new LineEquation(A, B, C);
  }

  /** Perpendicular distance |A·x + B·y + C| / √(A² + B²). */
  getDistanceFrom(point: Point): number {
    return Math.abs(this.A * point.x + this.B * point.y + this.C) / Math.sqrt(this.A * this.A + this.B * this.B);
  }

  getPerpendicularPassingThrough(p: Point): LineEquation {
    const A = -this.B;
    const B = this.A;
    return new LineEquation(A, B, -A * p.x - B * p.y);
  }

  /** The two points of the line at distance `d` from `from` (assumed on the line). */
  getPointsAtDistanceFrom(d: number, from: Point): Point[] {
    const { A, B } = this;
    if (B === 0) return [new Point(from.x, from.y + d), new Point(from.x, from.y - d)];
    if (A === 0) return [new Point(from.x + d, from.y), new Point(from.x - d, from.y)];
    const x1 = Math.sqrt((d * d * B * B) / (A * A + B * B));
    const x2 = -x1;
    const y1 = (-A / B) * x1;
    const y2 = -y1;
    return [new Point(from.x + x1, from.y + y1), new Point(from.x + x2, from.y + y2)];
  }

  /** The intersection with `eq2` (Cramer's rule), or null for parallel lines. */
  solveWith(eq2: LineEquation): Point | null {
    const D = this.A * eq2.B - eq2.A * this.B;
    const Dx = eq2.B * -this.C - this.B * -eq2.C;
    const Dy = this.A * -eq2.C - eq2.A * -this.C;
    if (D === 0) return null;
    return new Point(Dx / D, Dy / D);
  }

  /** The same line expressed with the origin moved to `newOrig`. */
  translateOrigin(newOrig: Point): LineEquation {
    return new LineEquation(this.A, this.B, this.C + (this.A * newOrig.x + this.B * newOrig.y));
  }

  /** The line rotated by `rotation` radians about `pivot`. */
  rotate(pivot: Point, rotation: number): LineEquation {
    if (rotation === 0) return this;
    const val = Math.abs(pivot.x * this.A + pivot.y * this.B + this.C);
    if (val < 0.1) {
      // pivot on this line
      const eq = this.translateOrigin(pivot);
      let angle = Math.atan2(-eq.A, eq.B);
      angle += rotation;
      return LineEquation.fromAngle(angle, pivot);
    }
    let perp = this.getPerpendicularPassingThrough(pivot);
    const sln = this.solveWith(perp) ?? new Point(); // always intersects: perpendicular
    const v0 = rotatePoint(sln, pivot, rotation);
    perp = LineEquation.through(pivot, v0);
    return perp.getPerpendicularPassingThrough(v0);
  }

  /** y at `x` (0 for a vertical line). */
  getY(x: number): number {
    if (this.B === 0) return 0;
    return (-this.C - this.A * x) / this.B;
  }

  angleWithHorizontal(): number {
    return Math.atan2(this.A, -this.B);
  }

  /** True when `p1` and `p2` are not strictly on the same side. */
  touches(p1: Point, p2: Point): boolean {
    const d1 = this.A * p1.x + this.B * p1.y + this.C;
    const d2 = this.A * p2.x + this.B * p2.y + this.C;
    return !(d1 * d2 > 0);
  }
}
