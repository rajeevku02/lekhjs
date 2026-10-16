// Ellipse fitting (port of C++ `fitter::EllipseFitter`; only `fit` is live, `fit2`/`fit3` are not
// ported). The centre is the bounds' centre, the major radius the farthest point, the minor radius
// the farthest distance from the major axis; then near-circles and near-axis rotations snap.
import { Ellipse } from '../ellipse';
import { getDistance } from '../geo';
import { LineEquation } from '../lineEquation';
import { Point } from '../point';

export class EllipseFitter {
  private readonly points: readonly Point[];

  constructor(points: readonly Point[]) {
    this.points = points;
  }

  fit(): Ellipse {
    const center = this.findCenter();
    let maxPt = this.points[0] ?? new Point();
    let maxDist = 0;
    let otherDist = 0;
    for (const p of this.points) {
      const tmp = getDistance(center, p);
      if (tmp > maxDist) {
        maxDist = tmp;
        maxPt = p;
      }
    }
    const eq = LineEquation.through(center, maxPt);
    for (const p of this.points) {
      const dist = eq.getDistanceFrom(p);
      if (dist > otherDist) otherDist = dist;
    }
    const ellipse = new Ellipse(center, maxDist * 2, otherDist * 2, Math.atan2(maxPt.y - center.y, maxPt.x - center.x));
    EllipseFitter.regularize(ellipse);
    return ellipse;
  }

  private findCenter(): Point {
    const first = this.points[0];
    if (first === undefined) return new Point();
    let minx = first.x;
    let maxx = first.x;
    let miny = first.y;
    let maxy = first.y;
    for (const p of this.points) {
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.y > maxy) maxy = p.y;
    }
    return new Point((minx + maxx) / 2, (miny + maxy) / 2);
  }

  /** C++ `regualarize`: aspect < 1.4 → circle; rotation within π/8 of 0, ±π/2, ±π snaps. */
  private static regularize(ellipse: Ellipse): void {
    if (ellipse.width / ellipse.height < 1.4) {
      ellipse.height = ellipse.width;
      ellipse.rotation = 0;
      return;
    }
    const PI = Math.PI;
    const delta = PI / 8;
    if (ellipse.rotation < delta && ellipse.rotation > -delta) ellipse.rotation = 0;
    if (ellipse.rotation < PI / 2 + delta && ellipse.rotation > PI / 2 - delta) ellipse.rotation = PI / 2;
    if (ellipse.rotation < PI + delta && ellipse.rotation > PI - delta) ellipse.rotation = PI;
    // C++ snaps near -π to +π (not -π); kept.
    if (ellipse.rotation > -(PI + delta) && ellipse.rotation < -(PI - delta)) ellipse.rotation = PI;
    if (ellipse.rotation > -(PI / 2 + delta) && ellipse.rotation < -(PI / 2 - delta)) ellipse.rotation = -PI / 2;
  }
}
