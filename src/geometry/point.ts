// 2-D point value (port of C++ `geometry::Point`). Immutable: C++ copies points by value, so a
// TS point is never mutated in place; the C++ mutators return a new point instead.

/** C++ `Point::Type`: the role of a point in a shape. */
export const PointType = Object.freeze({
  Other: 0,
  Vertex: 1,
  Center: 2,
  Focus: 4,
  Control: 8,
  Attr: 9,
  ControlAttr: 10,
} as const);
export type PointType = (typeof PointType)[keyof typeof PointType];

export class Point {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /** C++ `zoom(val)`: both coordinates scaled. */
  zoomed(val: number): Point {
    return new Point(this.x * val, this.y * val);
  }

  withDelta(dx: number, dy: number): Point {
    return new Point(this.x + dx, this.y + dy);
  }

  withX(x: number): Point {
    return new Point(x, this.y);
  }

  withY(y: number): Point {
    return new Point(this.x, y);
  }

  /** Exact equality of both coordinates. */
  equals(other: Point): boolean {
    return this.x === other.x && this.y === other.y;
  }

  toStr(): string {
    return `(${String(this.x)}, ${String(this.y)})`;
  }
}

/** C++ `PointAndSlope`: an intersection point and the slope of the curve there. */
export interface PointAndSlope {
  readonly point: Point;
  readonly slope: number;
}

/** C++ `Transformation`: a translation plus a rotation (radians). */
export interface Transformation {
  readonly dx: number;
  readonly dy: number;
  readonly angle: number;
}
