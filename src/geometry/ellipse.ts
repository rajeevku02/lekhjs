// Ellipse primitive (port of C++ `geometry::Ellipse`): centre, full width and height, rotation
// in radians. Mutable like the C++ struct; copy with `clone()`.
import { INT_MAX } from '../base';
import { LineEquation } from './lineEquation';
import { Point, type PointAndSlope } from './point';
import { getDistance, normalizeInHalfPI, rotate, rotatePoint } from './primitives';
import { Rect } from './rect';

export class Ellipse {
  center: Point;
  width: number;
  height: number;
  rotation: number;

  constructor(center = new Point(), width = 0, height = 0, rotation = 0) {
    this.center = center;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
  }

  clone(): Ellipse {
    return new Ellipse(this.center, this.width, this.height, this.rotation);
  }

  isInside(point: Point): boolean {
    let pt = rotatePoint(point, this.center, -this.rotation);
    pt = new Point(pt.x - this.center.x, pt.y - this.center.y);
    const val = (pt.x * pt.x) / ((this.width * this.width) / 4) + (pt.y * pt.y) / ((this.height * this.height) / 4);
    return val <= 1;
  }

  /** Distance from `point` to the outline along the ray from the centre (C++ algorithm). */
  getDistanceFrom(point: Point): number {
    const rad = (this.width + this.height) / 2;
    if (Math.abs(rad) < 0.01) return getDistance(point, this.center);
    if (getDistance(point, this.center) < 0.01) return Math.min(this.width, this.height);
    const pt = rotatePoint(point, this.center, -this.rotation);
    const eq = LineEquation.through(pt, this.center).translateOrigin(this.center);
    const pts = this.intersectsInternal(eq);
    const [a, b] = pts;
    if (a === undefined) return INT_MAX;
    if (b === undefined) return getDistance(a, pt);
    const d1 = getDistance(a, pt);
    const d2 = getDistance(b, pt);
    return d1 < d2 ? d1 : d2;
  }

  /** The points where `eq` meets the outline, with the outline's slope there. */
  getIntersection(eq: LineEquation): PointAndSlope[] {
    let eq2 = eq;
    if (this.rotation !== 0) eq2 = eq2.rotate(this.center, -this.rotation);
    eq2 = eq2.translateOrigin(this.center);
    const pts = this.intersectsInternal(eq2);
    const finalPts = this.rotation !== 0 ? rotate(pts, this.center, this.rotation) : pts.slice();
    const asq = (this.width * this.width) / 4;
    const bsq = (this.height * this.height) / 4;
    const points: PointAndSlope[] = [];
    for (let i = 0; i < finalPts.length; i++) {
      const p = pts[i] ?? new Point();
      const dy = bsq * (p.x - this.center.x);
      const dx = asq * (p.y - this.center.y);
      let angle = normalizeInHalfPI(Math.atan2(-dy, dx));
      angle += this.rotation;
      angle = normalizeInHalfPI(angle);
      points.push({ point: finalPts[i] ?? new Point(), slope: angle });
    }
    return points;
  }

  /** The axis-aligned bounding box (C++ `boundingRectangle`). */
  boundingRectangle(): Rect {
    const a = this.width / 2;
    const b = this.height / 2;
    const r = this.rotation;
    let val1 = Math.sin(r) * a;
    let val2 = Math.cos(r) * b;
    let t = Math.atan2(val2, val1);
    let y1 = a * Math.cos(t) * Math.sin(r) + b * Math.sin(t) * Math.cos(r);
    let y2 = a * Math.cos(t + Math.PI) * Math.sin(r) + b * Math.sin(t + Math.PI) * Math.cos(r);
    if (y1 > y2) [y1, y2] = [y2, y1];
    const h = Math.abs(y2 - y1);
    val1 = a * Math.cos(r);
    val2 = b * Math.sin(r);
    t = Math.atan2(-val2, val1);
    let x1 = a * Math.cos(t) * Math.cos(r) - b * Math.sin(t) * Math.sin(r);
    let x2 = a * Math.cos(t + Math.PI) * Math.cos(r) - b * Math.sin(t + Math.PI) * Math.sin(r);
    if (x1 > x2) [x1, x2] = [x2, x1];
    const w = Math.abs(x2 - x1);
    return new Rect(x1 + this.center.x, y1 + this.center.y, w, h);
  }

  /** Intersections of the unrotated ellipse (centred at the origin) with `eq`, in page space. */
  private intersectsInternal(eq: LineEquation): Point[] {
    const pts: Point[] = [];
    const delta = 0.0001;
    const { width, height, center } = this;
    if (Math.abs(eq.B) < delta) {
      // vertical line
      return this.getPointsForX(-eq.C / eq.A);
    }
    if (Math.abs(eq.A) < delta) {
      // horizontal line
      const tmp = eq.B * eq.B * (height / 2) * (height / 2);
      const d = (tmp - eq.C * eq.C) / tmp;
      if (d < 0) return pts;
      if (d === 0) {
        pts.push(new Point(center.x, eq.getY(0) + center.y));
        return pts;
      }
      const x = (width / 2) * Math.sqrt(d);
      pts.push(new Point(x + center.x, eq.getY(x) + center.y));
      pts.push(new Point(-x + center.x, eq.getY(-x) + center.y));
      return pts;
    }
    if (Math.abs(eq.C) < delta) {
      // line through the centre
      const tmp = eq.B * eq.B * (height / 2) * (height / 2);
      const d = (tmp * (width / 2) * (width / 2)) / (tmp + eq.A * eq.A * (width / 2) * (width / 2));
      const x = Math.sqrt(d);
      pts.push(new Point(x + center.x, eq.getY(x) + center.y));
      pts.push(new Point(-x + center.x, eq.getY(-x) + center.y));
      return pts;
    }
    const a = eq.B * eq.B * (height / 2) * (height / 2) + eq.A * eq.A * (width / 2) * (width / 2);
    const b = 2 * eq.A * eq.C * (width / 2) * (width / 2);
    const c =
      (width / 2) * (width / 2) * eq.C * eq.C - (width / 2) * (width / 2) * (height / 2) * (height / 2) * eq.B * eq.B;
    const D = b * b - 4 * a * c;
    if (D < 0) return pts;
    if (D === 0) return this.getPointsForX(-(b / (2 * a)));
    const d = Math.sqrt(D);
    let x = (-b + d) / (2 * a);
    pts.push(new Point(x + center.x, eq.getY(x) + center.y));
    x = (-b - d) / (2 * a);
    pts.push(new Point(x + center.x, eq.getY(x) + center.y));
    return pts;
  }

  private getYInternal(x: number): number[] {
    let d = 1 - (x * x) / ((this.width / 2) * (this.width / 2));
    d *= (this.height / 2) * (this.height / 2);
    if (d < 0) return [];
    if (d === 0) return [0];
    d = Math.sqrt(d);
    return [d, -d];
  }

  private getPointsForX(x: number): Point[] {
    return this.getYInternal(x).map((y) => new Point(x + this.center.x, y + this.center.y));
  }
}
