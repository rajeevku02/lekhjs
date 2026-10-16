// Equilateral test and "make equilateral" (port of the `Triangle` class of C++
// `fitter/TriangleFitter`, the twin of the akaar triangle the selection menu used; OQ-50). The
// fitting code and `Angle` are not ported.
import { COS30, SIN30 } from '../../base';
import { getDistance } from '../geo';
import { Point } from '../point';

export class Triangle {
  p1: Point;
  p2: Point;
  p3: Point;

  constructor(p1: Point, p2: Point, p3: Point) {
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
  }

  /** All sides within 1 unit of the first. */
  isEquilateral(): boolean {
    const d = getDistance(this.p1, this.p2);
    if (Math.abs(d - getDistance(this.p2, this.p3)) > 1.0) return false;
    if (Math.abs(d - getDistance(this.p3, this.p1)) > 1.0) return false;
    return true;
  }

  /** Replaces the vertices by the upright equilateral triangle on the same centroid and mean radius. */
  makeEquilateral(): void {
    const center = new Point((this.p1.x + this.p2.x + this.p3.x) / 3, (this.p1.y + this.p2.y + this.p3.y) / 3);
    const d1 = getDistance(this.p1, center);
    const d2 = getDistance(this.p2, center);
    const d3 = getDistance(this.p3, center);
    const r = (d1 + d2 + d3) / 3;
    const tr = Triangle.inCircle(center, r);
    this.p1 = tr.p1;
    this.p2 = tr.p2;
    this.p3 = tr.p3;
  }

  /** The upright equilateral triangle inscribed in the circle (C++ `sin30`/`cos30` constants). */
  static inCircle(center: Point, radius: number): Triangle {
    const p1 = new Point(center.x, center.y - radius);
    const d1 = radius * SIN30;
    const d2 = radius * COS30;
    return new Triangle(p1, new Point(center.x - d2, center.y + d1), new Point(center.x + d2, center.y + d1));
  }
}
