// 2-D vector (port of C++ `geometry::Vector`). Immutable: `normalize` returns a new vector.
import { LineEquation } from './lineEquation';
import { Point } from './point';

export class Vector {
  readonly dx: number;
  readonly dy: number;

  constructor(dx: number, dy: number) {
    this.dx = dx;
    this.dy = dy;
  }

  /** The vector from `a` to `b`. */
  static between(a: Point, b: Point): Vector {
    return new Vector(b.x - a.x, b.y - a.y);
  }

  /** Unit length (NaN components for the zero vector, as in C++). */
  normalize(): Vector {
    const d = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    return new Vector(this.dx / d, this.dy / d);
  }

  sum(other: Vector): Vector {
    return new Vector(other.dx + this.dx, other.dy + this.dy);
  }

  /** The line through `pt` in this direction. */
  lineEquation(pt: Point): LineEquation {
    return LineEquation.through(pt, new Point(pt.x + this.dx, pt.y + this.dy));
  }
}
