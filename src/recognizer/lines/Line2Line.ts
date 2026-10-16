// Pairwise relation of two segments (port of C++ `recognizer/Line2Line`: `ConnectionInfo` and
// `Line2Line`), used by the double-line arrow. The C++ constructor computes everything; so does
// this one, and the result is read from the readonly fields.
import { getDistance, LineEquation, Point } from '../../geometry';

/** C++ `ConnectionInfo`: two end points and whether they are within `connectDist`. */
export class ConnectionInfo {
  readonly p1: Point;
  readonly p2: Point;
  readonly connectDist: number;

  constructor(p1: Point, p2: Point, connectDist: number) {
    this.p1 = p1;
    this.p2 = p2;
    this.connectDist = connectDist;
  }

  getDistance(): number {
    return getDistance(this.p1, this.p2);
  }

  getMidPoint(): Point {
    return new Point((this.p1.x + this.p2.x) / 2, (this.p1.y + this.p2.y) / 2);
  }

  isConnected(): boolean {
    return this.getDistance() < this.connectDist;
  }
}

/** C++ `(int)` of a coordinate: truncation toward zero (`Line2Line::inRange` stores ints). */
function trunc(v: number): number {
  return Math.trunc(v);
}

/**
 * C++ `Line2Line`: segments p1→p2 and p3→p4. `connected` when an end of one is within
 * `closePointDistance` of an end of the other (`connectionPoint` = the midpoint of those ends;
 * `parallel` too when the other two ends also meet); otherwise `parallel` when the lines are
 * parallel, else `intersects` when they cross inside both segments' integer bounding boxes.
 */
export class Line2Line {
  connected = false;
  parallel = false;
  intersects = false;
  connectionPoint: Point = new Point();

  private readonly p1: Point;
  private readonly p2: Point;
  private readonly p3: Point;
  private readonly p4: Point;
  private readonly closePointDistance: number;

  /** `closePointDistance` is `RecognizerConfig.closePointDistance`. */
  constructor(p1: Point, p2: Point, p3: Point, p4: Point, closePointDistance: number) {
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
    this.p4 = p4;
    this.closePointDistance = closePointDistance;
    this.processDistances();
    if (this.connected || this.parallel) return;
    this.checkIntersection();
  }

  private checkIntersection(): void {
    const eq1 = LineEquation.through(this.p1, this.p2);
    const eq2 = LineEquation.through(this.p3, this.p4);
    const thet = eq1.A * eq2.B - eq2.A * eq1.B;
    if (thet === 0) {
      this.parallel = true;
      return;
    }
    const y = (eq2.A * eq1.C - eq1.A * eq2.C) / thet;
    const x = (eq1.B * eq2.C - eq2.B * eq1.C) / thet;
    if (Line2Line.inRange(this.p1, this.p2, x, y) && Line2Line.inRange(this.p3, this.p4, x, y)) {
      this.intersects = true;
    }
  }

  private static inRange(p1: Point, p2: Point, x: number, y: number): boolean {
    const x1 = trunc(p1.x < p2.x ? p1.x : p2.x);
    const x2 = trunc(p1.x < p2.x ? p2.x : p1.x);
    const y1 = trunc(p1.y < p2.y ? p1.y : p2.y);
    const y2 = trunc(p1.y < p2.y ? p2.y : p1.y);
    return !(x < x1 || x > x2 || y < y1 || y > y2);
  }

  private processDistances(): void {
    if (this.checkConnection(this.p1, this.p2, this.p3, this.p4)) return;
    if (this.checkConnection(this.p2, this.p1, this.p3, this.p4)) return;
    if (this.checkConnection(this.p1, this.p2, this.p4, this.p3)) return;
    this.checkConnection(this.p2, this.p1, this.p4, this.p3);
  }

  private checkConnection(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    const ci = new ConnectionInfo(p1, p3, this.closePointDistance);
    if (!ci.isConnected()) return false;
    this.connected = true;
    this.connectionPoint = ci.getMidPoint();
    if (new ConnectionInfo(p2, p4, this.closePointDistance).isConnected()) this.parallel = true;
    return true;
  }
}
