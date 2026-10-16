// Orthogonal routing steps (port of C++ `connection::ConnectionPoint` and `connection::Line`,
// `L/connection/{ConnectionPoint,Line}.{h,cpp}`). Directions are unit axis vectors held as
// integers, so every leg is horizontal or vertical in world space (KB known issue "Orthogonal
// connectors on rotated shapes follow world axes", kept).
import { Point } from '../../geometry';

/** C++ `LineAling`. */
export const LineAlign = Object.freeze({ AlongX: 0, AlongY: 1 } as const);
export type LineAlign = (typeof LineAlign)[keyof typeof LineAlign];

/** C++ `int` of a direction component. */
function dirInt(v: number): number {
  return Math.trunc(v);
}

/** A point with an axis direction (C++ `ConnectionPoint`). Immutable. */
export class ConnectionPoint {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;

  constructor(x = 0, y = 0, dx = 0, dy = 0) {
    this.x = x;
    this.y = y;
    this.dx = dirInt(dx);
    this.dy = dirInt(dy);
  }

  point(): Point {
    return new Point(this.x, this.y);
  }
  dir(): Point {
    return new Point(this.dx, this.dy);
  }

  /** C++ `move(dist)`: `dist` along the direction. */
  moveBy(dist: number): ConnectionPoint {
    return new ConnectionPoint(this.x + this.dx * dist, this.y + this.dy * dist, this.dx, this.dy);
  }

  /** C++ `move(to, ratio)`: towards `to` along the direction (only forwards), by `ratio` of the gap. */
  moveTo(to: Point | ConnectionPoint, ratio = 1.0): ConnectionPoint {
    const t = to instanceof ConnectionPoint ? to.point() : to;
    let { x, y } = this;
    if (this.dx === 1) {
      if (t.x > x) x += (t.x - x) * ratio;
    } else if (this.dx === -1) {
      if (t.x < x) x += (t.x - x) * ratio;
    } else if (this.dy === 1) {
      if (t.y > y) y += (t.y - y) * ratio;
    } else if (this.dy === -1) {
      if (t.y < y) y += (t.y - y) * ratio;
    }
    return new ConnectionPoint(x, y, this.dx, this.dy);
  }

  /** C++ `turn(to)`: the perpendicular direction that points towards `to`. */
  turn(to: Point | ConnectionPoint): ConnectionPoint {
    const t = to instanceof ConnectionPoint ? to.point() : to;
    if (this.dx !== 0) return new ConnectionPoint(this.x, this.y, 0, t.y < this.y ? -1 : 1);
    return new ConnectionPoint(this.x, this.y, t.x < this.x ? -1 : 1, 0);
  }

  mid(second: ConnectionPoint): Point {
    return new Point((this.x + second.x) / 2, (this.y + second.y) / 2);
  }

  /** C++ `isAhead(from)`: this point is past `to` along its direction. */
  isAhead(to: ConnectionPoint): boolean {
    if (this.dx === 1) return this.x > to.x;
    if (this.dx === -1) return this.x < to.x;
    if (this.dy === 1) return this.y > to.y;
    if (this.dy === -1) return this.y < to.y;
    return false;
  }

  isApproaching(to: ConnectionPoint): boolean {
    if (this.dx === 1) return this.x < to.x;
    if (this.dx === -1) return this.x > to.x;
    if (this.dy === 1) return this.y < to.y;
    if (this.dy === -1) return this.y > to.y;
    return false;
  }
}

/** One leg of an orthogonal route (C++ `connection::Line`, spec 02 `RouteLine`). Mutable, as C++. */
export class RouteLine {
  dx = 0;
  dy = 0;
  step = 0;
  start = new Point();
  end = new Point();

  clone(): RouteLine {
    const l = new RouteLine();
    l.dx = this.dx;
    l.dy = this.dy;
    l.step = this.step;
    l.start = this.start;
    l.end = this.end;
    return l;
  }

  mid(): Point {
    return new Point((this.start.x + this.end.x) / 2, (this.start.y + this.end.y) / 2);
  }

  /** C++ `computeParam(align)`: step and direction from start and end along `align`. */
  computeParam(align: LineAlign): void {
    const ddx = Math.abs(this.end.x - this.start.x);
    const ddy = Math.abs(this.end.y - this.start.y);
    this.dx = 0;
    this.dy = 0;
    if (align === LineAlign.AlongX) {
      this.step = ddx;
      this.dx = this.end.x > this.start.x ? 1 : -1;
    } else {
      this.step = ddy;
      this.dy = this.end.y > this.start.y ? 1 : -1;
    }
  }

  /** C++ `computePoint(p1)`: start at `p1`, end `step` along the direction. */
  computePoint(p1: Point): void {
    this.start = p1;
    this.end = this.dx !== 0 ? p1.withDelta(this.step * this.dx, 0) : p1.withDelta(0, this.step * this.dy);
  }

  computePointFromEnd(p1: Point): void {
    this.end = p1;
    this.start = this.dx !== 0 ? p1.withDelta(-this.step * this.dx, 0) : p1.withDelta(0, -this.step * this.dy);
  }

  align(): LineAlign {
    return this.dx === 0 ? LineAlign.AlongY : LineAlign.AlongX;
  }
  perpAlign(): LineAlign {
    return this.dx === 0 ? LineAlign.AlongX : LineAlign.AlongY;
  }
  dir(): Point {
    return new Point(this.dx, this.dy);
  }
  reverseDir(): Point {
    return new Point(-this.dx, -this.dy);
  }
  /** C++ `setDir`: the `int` of each component. */
  setDir(p: Point): void {
    this.dx = Math.trunc(p.x);
    this.dy = Math.trunc(p.y);
  }
}
