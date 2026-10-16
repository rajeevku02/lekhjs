// Line fit and regularisation (port of C++ `fitter::Line`, renamed `FitLine`). Mutable: the C++
// `regualarize` moves the end point in place.
import { getAngle } from '../geo';
import { Point } from '../point';

export class FitLine {
  startPoint: Point;
  endPoint: Point;
  polishLevel: number;

  constructor(p1: Point, p2: Point, polishLevel: number) {
    this.startPoint = p1;
    this.endPoint = p2;
    this.polishLevel = polishLevel;
  }

  /** Snaps by 7° (polish level 1) or 12° (level 2); level 0 does nothing. */
  regularize(): void {
    if (this.polishLevel > 0) {
      const delta = this.polishLevel === 2 ? 12 : 7;
      this.regularizeBy(delta);
    }
  }

  /**
   * C++ `regualarize(delta)`: within `delta` degrees of horizontal the end moves to the start's y;
   * of vertical, to its x; of 45°, onto the diagonal.
   */
  regularizeBy(delta: number): void {
    let p1 = this.startPoint;
    let p2 = this.endPoint;
    if (this.endPoint.x < this.startPoint.x) {
      p1 = this.endPoint;
      p2 = this.startPoint;
    } else if (this.endPoint.x === this.startPoint.x && this.endPoint.y < this.startPoint.y) {
      p1 = this.endPoint;
      p2 = this.startPoint;
    }
    const angle = getAngle(p1, p2, new Point(p2.x + 50, p2.y));
    if (angle <= delta) {
      this.endPoint = this.endPoint.withY(this.startPoint.y);
    } else if (angle <= 90 && angle >= 90 - delta) {
      this.endPoint = this.endPoint.withX(this.startPoint.x);
    } else if (angle <= 45 + delta / 2 && angle >= 45 - delta / 2) {
      const mult = this.endPoint.y - this.startPoint.y < 0 ? -1 : 1;
      this.endPoint = this.endPoint.withY(this.startPoint.y + mult * Math.abs(this.endPoint.x - this.startPoint.x));
    }
  }
}
