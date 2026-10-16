// Polygon helper (port of C++ `geometry::SimplePoygon`, typo fixed): closing an almost-closed
// stroke by trimming an overshooting end, and the convex hull.
import { INT_MAX } from '../base';
import { getDistance, getPointsBound } from './geo';
import { LineSegment } from './lineSegment';
import { Point } from './point';
import { Rect } from './rect';
import type { SimplePath } from './simplePath';

/** C++ `SimplePoygon::TrimInfo`. */
export interface TrimInfo {
  canDo: boolean;
  index: number;
  trim: number;
  dist: number;
  at: Point;
}

/** C++ `SimplePoygon::CPoint`: a hull candidate and its vertex index. */
export interface CPoint {
  readonly x: number;
  readonly y: number;
  readonly index: number;
}

function newTrimInfo(): TrimInfo {
  return { canDo: false, index: 0, trim: 0, dist: 0, at: new Point() };
}

export class SimplePolygon {
  private vertices_: Point[];
  private hullPts: CPoint[] = [];
  private bound_ = new Rect();
  private perimeter_ = -1;

  constructor(points: readonly Point[]) {
    this.vertices_ = points.slice();
  }

  /** The polygon of a path's segment approximation. */
  static fromPath(path: SimplePath): SimplePolygon {
    return new SimplePolygon(path.points());
  }

  vertices(): readonly Point[] {
    return this.vertices_;
  }

  /**
   * Can the open polygon be closed by trimming one end (less than 15% of the perimeter, landing
   * within 14% of the bounds)? If so, the vertices are trimmed.
   */
  canClose(): boolean {
    this.bound_ = getPointsBound(this.vertices_);
    this.getPerimeter();
    if (this.vertices_.length < 4) return false;
    const t1 = newTrimInfo();
    const t2 = newTrimInfo();
    this.tryTrimBegining(t1);
    this.tryTrimEnd(t2);
    if (t1.canDo && t2.canDo) {
      if (t1.dist < t2.dist) t2.canDo = false;
      else t1.canDo = false;
    }
    if (t1.canDo) {
      if (t1.index > 0) {
        this.vertices_.splice(0, t1.index);
        this.vertices_.unshift(t1.at);
      }
      return true;
    } else if (t2.canDo) {
      if (t2.index < this.vertices_.length) {
        this.vertices_.splice(t2.index + 1);
        this.vertices_.push(t2.at);
      }
      return true;
    }
    return false;
  }

  /** `canClose`, then the convex hull if every concave run deviates less than 40% of its chord. */
  canMakeConvex(): boolean {
    if (!this.canClose()) return false;
    const front = this.vertices_[0];
    const back = this.vertices_[this.vertices_.length - 1];
    if (front !== undefined && back !== undefined && getDistance(front, back) < 4) this.vertices_.pop();
    this.getHull();
    const n = this.hullPts.length;
    for (let i = 0; i < n; i++) {
      const a = this.hullPts[i];
      const b = this.hullPts[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      if (!this.isDeviationAllowed(a.index, b.index)) return false;
    }
    this.vertices_ = this.hullPts.map((h) => new Point(h.x, h.y));
    return true;
  }

  /** Replaces the vertices by their convex hull (in vertex order). */
  computeHull(): void {
    this.getHull();
    this.vertices_ = this.hullPts.map((h) => new Point(h.x, h.y));
  }

  private v(i: number): Point {
    const p = this.vertices_[i];
    if (p === undefined) throw new RangeError(`vertex ${String(i)} out of range`);
    return p;
  }

  private getPerimeter(): void {
    this.perimeter_ = 0;
    for (let i = 0; i < this.vertices_.length - 1; i++) {
      this.perimeter_ += getDistance(this.v(i), this.v(i + 1));
    }
  }

  private tryTrimEnd(ti: TrimInfo): void {
    let trim = 0;
    let prevDist = INT_MAX;
    for (let j = this.vertices_.length - 1; j >= 3; j--) {
      const seg = new LineSegment(this.v(j), this.v(j - 1));
      const at = seg.getDistanceFrom(this.v(0)).near;
      trim += getDistance(this.v(j), at);
      const dist = getDistance(this.v(0), at);
      if (dist > prevDist) return;
      prevDist = dist;
      if (!this.trimAllowed(trim)) continue;
      if (!this.distAllowed(this.v(0), at)) continue;
      ti.dist = dist;
      ti.index = j - 1;
      ti.trim = trim;
      ti.at = at;
      ti.canDo = true;
      return;
    }
  }

  private tryTrimBegining(ti: TrimInfo): void {
    const len = this.vertices_.length;
    let trim = 0;
    let prevDist = INT_MAX;
    for (let j = 0; j < len - 3; j++) {
      const seg = new LineSegment(this.v(j), this.v(j + 1));
      const at = seg.getDistanceFrom(this.v(len - 1)).near;
      trim += getDistance(this.v(j), at);
      const dist = getDistance(this.v(len - 1), at);
      if (dist > prevDist) return;
      prevDist = dist;
      if (!this.trimAllowed(trim)) continue;
      if (!this.distAllowed(this.v(len - 1), at)) continue;
      ti.dist = dist;
      ti.index = j + 1;
      ti.trim = trim;
      ti.at = at;
      ti.canDo = true;
      return;
    }
  }

  private trimAllowed(trim: number): boolean {
    if (this.perimeter_ === 0) return false;
    return trim / this.perimeter_ < 0.15;
  }

  private distAllowed(p1: Point, p2: Point): boolean {
    const factor = 0.14;
    if (Math.abs(p1.x - p2.x) > this.bound_.width * factor) return false;
    if (Math.abs(p1.y - p2.y) > this.bound_.height * factor) return false;
    return true;
  }

  /** Monotone-chain hull (https://cp-algorithms.com/geometry/grahams-scan-convex-hull.html). */
  private getHull(): void {
    const cmp = (a: CPoint, b: CPoint): number => {
      if (a.x < b.x || (a.x === b.x && a.y < b.y)) return -1;
      if (b.x < a.x || (a.x === b.x && b.y < a.y)) return 1;
      return 0;
    };
    const orient = (a: CPoint, b: CPoint, c: CPoint): number =>
      a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
    const cw = (a: CPoint, b: CPoint, c: CPoint): boolean => orient(a, b, c) < 0;
    const ccw = (a: CPoint, b: CPoint, c: CPoint): boolean => orient(a, b, c) > 0;

    const pts: CPoint[] = this.vertices_.map((p, i) => ({ x: p.x, y: p.y, index: i }));
    pts.sort(cmp);
    const p1 = pts[0];
    const p2 = pts[pts.length - 1];
    if (p1 === undefined || p2 === undefined) {
      this.hullPts = [];
      return;
    }
    const up: CPoint[] = [p1];
    const down: CPoint[] = [p1];
    const at = (a: CPoint[], i: number): CPoint => a[i] as CPoint;
    for (let i = 1; i < pts.length; i++) {
      const pi = at(pts, i);
      if (i === pts.length - 1 || cw(p1, pi, p2)) {
        while (up.length >= 2 && !cw(at(up, up.length - 2), at(up, up.length - 1), pi)) up.pop();
        up.push(pi);
      }
      if (i === pts.length - 1 || ccw(p1, pi, p2)) {
        while (down.length >= 2 && !ccw(at(down, down.length - 2), at(down, down.length - 1), pi)) down.pop();
        down.push(pi);
      }
    }
    const all = [...up, ...down].sort((a, b) => a.index - b.index);
    const tmp: CPoint[] = [at(all, 0)];
    for (let i = 1; i < all.length; i++) {
      if (at(tmp, tmp.length - 1).index !== at(all, i).index) tmp.push(at(all, i));
    }
    this.hullPts = tmp;
  }

  private isDeviationAllowed(id1: number, id2: number): boolean {
    const n = this.vertices_.length;
    if ((id1 + 1) % n === id2) return true; // consecutive vertices: no concave part
    let dev = 0;
    const seg = new LineSegment(this.v(id1), this.v(id2));
    let idx = (id1 + 1) % n;
    while (idx !== id2) {
      const tmp = seg.getDistanceFrom(this.v(idx)).dist;
      if (tmp > dev) dev = tmp;
      idx = (idx + 1) % n;
    }
    return dev < seg.length() * 0.4;
  }
}
