// Axis-aligned box (port of C++ `geometry::Rectangle`). Immutable: the C++ mutators
// (`inflate`, `zoom`, `include`, `checkMinDimension`) return a new rect. The operations that
// need segments (`intersects`, `getDistanceFrom`) are free functions in `geo.ts`
// (`rectIntersects`, `rectIntersectsSegment`, `rectDistanceFrom`), which breaks the C++
// `GeoUtil ↔ Rectangle` cycle (spec 01 §3.1 C1).
import { SQRT2 } from '../base';
import { Point } from './point';
import { Size } from './size';

export class Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  /** C++ `Rectangle(center, w, h)`. */
  static fromCenter(center: Point, w: number, h: number): Rect {
    return new Rect(center.x - w / 2, center.y - h / 2, w, h);
  }

  /** The square inscribed in the circle (C++ `Rectangle::inCircle`). */
  static inCircle(center: Point, radius: number): Rect {
    const d = SQRT2 * radius;
    return new Rect(center.x - d / 2, center.y - d / 2, d, d);
  }

  /** Inclusive of the edges. */
  contains(pt: Point): boolean {
    return pt.x >= this.x && pt.x <= this.x + this.width && pt.y >= this.y && pt.y <= this.y + this.height;
  }

  /** All four corners of `rect` inside this one. */
  containsRect(rect: Rect): boolean {
    for (const pt of rect.getPoints()) {
      if (!this.contains(pt)) return false;
    }
    return true;
  }

  /** C++ `inflate(val)`: grows by `val` in total on each axis (val/2 per side), never below 0. */
  inflate(val: number): Rect {
    let w = this.width + val;
    let h = this.height + val;
    if (w < 0) w = 0;
    if (h < 0) h = 0;
    return new Rect(this.x - val / 2, this.y - val / 2, w, h);
  }

  zoom(val: number): Rect {
    return new Rect(this.x * val, this.y * val, this.width * val, this.height * val);
  }

  /** C++ `include(Point)`: the smallest rect holding this one and `pt`. */
  include(pt: Point): Rect {
    let x1 = this.x;
    let y1 = this.y;
    let x2 = this.x + this.width;
    let y2 = this.y + this.height;
    if (pt.x < x1) x1 = pt.x;
    if (pt.y < y1) y1 = pt.y;
    if (x2 < pt.x) x2 = pt.x;
    if (y2 < pt.y) y2 = pt.y;
    return new Rect(x1, y1, x2 - x1, y2 - y1);
  }

  /** C++ `include(Rectangle)`: each corner of `other` included in turn. */
  includeRect(other: Rect): Rect {
    return other.getPoints().reduce<Rect>((r, pt) => r.include(pt), this);
  }

  center(): Point {
    return new Point(this.x + this.width / 2, this.y + this.height / 2);
  }

  /** Corners in C++ order: top-left, bottom-left, bottom-right, top-right. */
  getPoints(): Point[] {
    return [this.p1(), this.p2(), this.p3(), this.p4()];
  }

  area(): number {
    return this.width * this.height;
  }
  right(): number {
    return this.x + this.width;
  }
  bottom(): number {
    return this.y + this.height;
  }
  topLeft(): Point {
    return new Point(this.x, this.y);
  }
  topRight(): Point {
    return new Point(this.x + this.width, this.y);
  }
  bottomLeft(): Point {
    return new Point(this.x, this.y + this.height);
  }
  bottomRight(): Point {
    return new Point(this.x + this.width, this.y + this.height);
  }
  p1(): Point {
    return new Point(this.x, this.y);
  }
  p2(): Point {
    return new Point(this.x, this.y + this.height);
  }
  p3(): Point {
    return new Point(this.x + this.width, this.y + this.height);
  }
  p4(): Point {
    return new Point(this.x + this.width, this.y);
  }
  size(): Size {
    return new Size(this.width, this.height);
  }

  /**
   * C++ `checkMinDimension`: negative sizes become 0; a side `<= minVal` becomes `valToSet`,
   * centred on the old centre.
   */
  checkMinDimension(minVal: number, valToSet: number): Rect {
    let { x, y, width, height } = this;
    if (width < 0) width = 0;
    if (height < 0) height = 0;
    const ct = new Point(x + width / 2, y + height / 2);
    if (width <= minVal) {
      width = valToSet;
      x = ct.x - valToSet / 2;
    }
    if (height <= minVal) {
      height = valToSet;
      y = ct.y - valToSet / 2;
    }
    return new Rect(x, y, width, height);
  }

  equals(other: Rect): boolean {
    return this.x === other.x && this.y === other.y && this.width === other.width && this.height === other.height;
  }

  str(): string {
    return `(${String(this.x)}, ${String(this.y)}, ${String(this.width)}, ${String(this.height)})`;
  }
}
