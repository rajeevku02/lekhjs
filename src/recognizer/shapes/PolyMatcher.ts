// Fits a polygon to a closed shape's corner points (port of the live C++ `recognizer::PolyMatcher`;
// the `matching/PolyMatcher` is dead and not ported). Starting from the two farthest points it
// keeps adding the point farthest from the current outline while it is far enough, then guards
// against collapsing a quad into a triangle or a polygon into a line.
import { areaOfConvexPolygon, getDistance, LineEquation, type Point } from '../../geometry';
import { at } from '../lines/RecognizerUtil';

export class PolyMatcher {
  private readonly input: readonly Point[];
  private processed: Point[] = [];
  private shapePoints: number[] = [];
  private distFactor = 0.14;

  constructor(points: readonly Point[]) {
    this.input = points.slice();
  }

  vertices(): readonly Point[] {
    return this.processed;
  }

  process(): void {
    this.processGeneric();
    if (this.processed.length === 5) this.processFor5Lines();
    // A rectangle reduced to a triangle distorts the shape: add points back while the area
    // shrank a lot.
    if (this.processed.length < 4) this.coverUpArea();
    // Never turn a poly into a line.
    if (this.processed.length < 3) this.processed = this.input.slice();
  }

  private v(i: number): Point {
    return at(this.input, i);
  }

  private sp(i: number): number {
    return at(this.shapePoints, i);
  }

  private coverUpArea(): void {
    const area = areaOfConvexPolygon(this.input);
    let newArea = areaOfConvexPolygon(this.processed);
    if (area < 0.1) return;
    while (newArea / area < 0.65) {
      if (!this.addMorePoints(false)) break;
      this.processed = this.shapePoints.map((idx) => this.v(idx));
      newArea = areaOfConvexPolygon(this.processed);
    }
  }

  private processGeneric(): void {
    const n = this.input.length;
    if (n < 3) {
      this.processed = this.input.slice();
      return;
    }
    let dist = 0;
    let idx1 = 0;
    let idx2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = getDistance(this.v(i), this.v(j));
        if (d > dist) {
          dist = d;
          idx1 = i;
          idx2 = j;
        }
      }
    }
    if (idx1 === 0 && idx2 === 0) {
      this.processed = this.input.slice();
      return;
    }
    this.shapePoints.push(idx1, idx2);
    while (this.addMorePoints(true)) {
      // keep adding
    }
    for (const idx of this.shapePoints) this.processed.push(this.v(idx));
  }

  private processFor5Lines(): void {
    this.processed = [];
    this.shapePoints = [];
    const orig = this.distFactor;
    this.distFactor = 0.18;
    this.processGeneric();
    this.distFactor = orig;
  }

  private addMorePoints(check: boolean): boolean {
    let idx = 0;
    let dist = 0;
    let found = false;
    const allowed = (i1: number, i2: number, i3: number): boolean => {
      const a = this.v(this.sp(i1));
      const c = this.v(this.sp(i3));
      const baseDist = getDistance(a, c);
      const d = LineEquation.through(a, c).getDistanceFrom(this.v(i2));
      return d >= baseDist * this.distFactor;
    };
    const count = this.shapePoints.length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const { dist: tmpDist, idx: tmpIdx } = this.distFor(i, j);
      if (!check || allowed(i, tmpIdx, j)) {
        if (dist < tmpDist) {
          dist = tmpDist;
          idx = tmpIdx;
          found = true;
        }
      }
    }
    if (!found || dist === 0) return false;

    if (idx < this.sp(0)) {
      this.shapePoints.unshift(idx);
    } else if (idx > this.sp(count - 1)) {
      this.shapePoints.push(idx);
    } else {
      for (let i = 0; i < count - 1; i++) {
        if (idx > this.sp(i) && idx < this.sp(i + 1)) {
          this.shapePoints.splice(i + 1, 0, idx);
          break;
        }
      }
    }
    return true;
  }

  /** C++ `distFor`: the input point between shape points `i1` and `i2` (cyclically) farthest from their chord. */
  private distFor(i1: number, i2: number): { dist: number; idx: number } {
    const a = this.sp(i1);
    const b = this.sp(i2);
    let dist = 0;
    let idx = a;
    const eq = LineEquation.through(this.v(a), this.v(b));
    const n = this.input.length;
    let i = (a + 1) % n;
    while (i !== b) {
      const tmp = eq.getDistanceFrom(this.v(i));
      if (tmp > dist) {
        dist = tmp;
        idx = i;
      }
      i = (i + 1) % n;
    }
    return { dist, idx };
  }
}
