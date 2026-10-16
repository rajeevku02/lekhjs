// Quadrilateral tests and regularisation (port of C++ `fitter::Quadrilateral`, `QuadFitter.cpp`):
// the rectangle test of implicit-container detection, "make square" in the selection menu, and
// the recognizer's quad regularisation. It replaces the identical `akaar::Quadrilateral` (spec 07
// §2.3); `PolishingLevel` is 2 at every live caller, which is the fixed `regularizeLevel` here.
//
// As in C++, the corner points (`p1()`…`p4()`) and the vertex list used for areas and the
// parallelogram passes are separate state: `makeSquare` and the 45° branch of `regularize` move
// the corners only.
import { CONFIG_DEFAULTS, type ConfigValues } from '../../base';
import { angleWithHorizontal, getAngle, getDistance, getPointAtDistance, rotate, toDegree } from '../geo';
import { Point } from '../point';
import { areComparableLength } from './comparable';
import { FitLine } from './fitLine';

// C++ `regularizeLevel` is the constant 2, so only its level-2 thresholds are reachable; the
// level-1 values are noted beside them.
const regularizeLevel = 2;

/** What `regularize` reads from the engine config. */
export type QuadrilateralConfig = Pick<ConfigValues, 'parallelogramRegularizeAngle'>;

export class Quadrilateral {
  private p1_: Point;
  private p2_: Point;
  private p3_: Point;
  private p4_: Point;
  private vertices_: Point[];
  private angle_ = 0;

  constructor(p1: Point, p2: Point, p3: Point, p4: Point) {
    this.p1_ = p1;
    this.p2_ = p2;
    this.p3_ = p3;
    this.p4_ = p4;
    this.vertices_ = [p1, p2, p3, p4];
  }

  p1(): Point {
    return this.p1_;
  }
  p2(): Point {
    return this.p2_;
  }
  p3(): Point {
    return this.p3_;
  }
  p4(): Point {
    return this.p4_;
  }
  /** The corners in order. */
  points(): Point[] {
    return [this.p1_, this.p2_, this.p3_, this.p4_];
  }
  /** The parallelogram rotation `regularize` found (radians; 0 otherwise). */
  angle(): number {
    return this.angle_;
  }

  clone(): Quadrilateral {
    const q = new Quadrilateral(this.p1_, this.p2_, this.p3_, this.p4_);
    q.vertices_ = this.vertices_.slice();
    q.angle_ = this.angle_;
    return q;
  }

  /** Snaps a near-parallelogram to a rectangle, a 45° square or a regular parallelogram (C++ `regualarize`). */
  regularize(config: QuadrilateralConfig = CONFIG_DEFAULTS): void {
    this.angle_ = 0;
    if (!this.isParallelogram()) return;
    let processed = false;
    if (this.isRectangle()) {
      if (this.isNonRotatedRectangle()) {
        const q1 = this.makeRectangle(this.p1_, this.p3_);
        const q2 = this.makeRectangle(this.p2_, this.p4_);
        this.assign(this.chooseQuad(q1, q2));
        processed = true;
      } else if (this.areSideEquals() && this.is45DegreeRotated()) {
        const mid = new Point((this.p2_.x + this.p4_.x) / 2, (this.p2_.y + this.p4_.y) / 2);
        const dist = getDistance(this.p2_, this.p4_) / 2;
        this.p1_ = new Point(mid.x, mid.y + dist);
        this.p2_ = new Point(mid.x - dist, mid.y);
        this.p3_ = new Point(mid.x, mid.y - dist);
        this.p4_ = new Point(mid.x + dist, mid.y);
        processed = true;
      }
    }
    if (!processed) {
      const q1 = this.makeParallelogram(this.p1_, this.p2_, this.p3_);
      const q2 = this.makeParallelogram(this.p2_, this.p3_, this.p4_);
      this.assign(this.chooseQuad(q1, q2));
      this.regularizeParallelogram(config.parallelogramRegularizeAngle);
      this.computeParallelogramRotation();
    }
  }

  /** Every corner angle within 22° of 90°. */
  isRectangle(): boolean {
    const delta = 22; // level 1: 12
    const [a1, a2, a3, a4] = this.cornerAngles();
    return (
      this.areComparableAngle(a1, 90, delta) &&
      this.areComparableAngle(a2, 90, delta) &&
      this.areComparableAngle(a3, 90, delta) &&
      this.areComparableAngle(a4, 90, delta)
    );
  }

  /** All sides within 1 unit of the first. */
  isSquare(): boolean {
    if (this.vertices_.length !== 4) return false;
    const d = getDistance(this.p1_, this.p2_);
    if (Math.abs(d - getDistance(this.p2_, this.p3_)) > 1.0) return false;
    if (Math.abs(d - getDistance(this.p3_, this.p4_)) > 1.0) return false;
    if (Math.abs(d - getDistance(this.p4_, this.p1_)) > 1.0) return false;
    return true;
  }

  /** Corners become the axis-aligned square on the centroid with the mean side length. */
  makeSquare(): void {
    const center = new Point(
      (this.p1_.x + this.p2_.x + this.p3_.x + this.p4_.x) / 4,
      (this.p1_.y + this.p2_.y + this.p3_.y + this.p4_.y) / 4,
    );
    const d1 = getDistance(this.p1_, this.p2_);
    const d2 = getDistance(this.p2_, this.p3_);
    const d3 = getDistance(this.p3_, this.p4_);
    const d4 = getDistance(this.p4_, this.p1_);
    const d = (d1 + d2 + d3 + d4) / 4;
    this.p1_ = new Point(center.x - d / 2, center.y - d / 2);
    this.p2_ = new Point(center.x - d / 2, center.y + d / 2);
    this.p3_ = new Point(center.x + d / 2, center.y + d / 2);
    this.p4_ = new Point(center.x + d / 2, center.y - d / 2);
  }

  /** Some side snaps to horizontal or vertical. */
  isNonRotatedRectangle(): boolean {
    return (
      this.isNonRotatedLine(this.p1_, this.p2_) ||
      this.isNonRotatedLine(this.p2_, this.p3_) ||
      this.isNonRotatedLine(this.p3_, this.p4_) ||
      this.isNonRotatedLine(this.p4_, this.p1_)
    );
  }

  private assign(q: Quadrilateral): void {
    this.p1_ = q.p1_;
    this.p2_ = q.p2_;
    this.p3_ = q.p3_;
    this.p4_ = q.p4_;
    this.vertices_ = q.vertices_.slice();
    this.angle_ = q.angle_;
  }

  private setFromVertices(): void {
    const [a, b, c, d] = this.vertices_;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    this.p1_ = a;
    this.p2_ = b;
    this.p3_ = c;
    this.p4_ = d;
  }

  private cornerAngles(): [number, number, number, number] {
    const { p1_: p1, p2_: p2, p3_: p3, p4_: p4 } = this;
    return [
      180 - getAngle(p1, p2, p3),
      180 - getAngle(p2, p3, p4),
      180 - getAngle(p3, p4, p1),
      180 - getAngle(p4, p1, p2),
    ];
  }

  private areComparableAngle(a1: number, a2: number, delta: number): boolean {
    if (a1 === a2) return true;
    let min = a1;
    let max = a2;
    if (a2 < min) {
      min = a2;
      max = a1;
    }
    return max <= min + delta;
  }

  private isParallelogram(): boolean {
    const delta = 42; // level 1: 22
    const [a1, a2, a3, a4] = this.cornerAngles();
    return this.areComparableAngle(a1, a3, delta) && this.areComparableAngle(a2, a4, delta);
  }

  private areSideEquals(): boolean {
    const factor = 7; // level 1: 12
    const { p1_: p1, p2_: p2, p3_: p3, p4_: p4 } = this;
    return (
      areComparableLength(getDistance(p1, p2), getDistance(p2, p3), factor) ||
      areComparableLength(getDistance(p2, p3), getDistance(p3, p4), factor) ||
      areComparableLength(getDistance(p3, p4), getDistance(p4, p1), factor) ||
      areComparableLength(getDistance(p4, p1), getDistance(p1, p2), factor)
    );
  }

  private is45DegreeRotated(): boolean {
    const delta = 22; // level 1: 12
    const l1 = new FitLine(this.p1_, this.p3_, regularizeLevel);
    l1.regularizeBy(delta);
    if (l1.startPoint.x === l1.endPoint.x || l1.startPoint.y === l1.endPoint.y) return true;
    const l2 = new FitLine(this.p2_, this.p4_, regularizeLevel);
    l2.regularizeBy(delta);
    if (l2.startPoint.x === l2.endPoint.x || l2.startPoint.y === l2.endPoint.y) return true;
    return false;
  }

  private isNonRotatedLine(startPoint: Point, endPoint: Point): boolean {
    const line = new FitLine(startPoint, endPoint, regularizeLevel);
    line.regularize();
    return line.startPoint.x === line.endPoint.x || line.startPoint.y === line.endPoint.y;
  }

  private regularizeParallelogram(parallelogramRegularizeAngle: number): void {
    let regularized = false;
    let equalSides = false;
    for (let i = 0; i < this.vertices_.length; i++) {
      const pt1 = this.vertices_[i] ?? new Point();
      const pt2 = this.vertices_[(i + 1) % 4] ?? new Point();
      const angle = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
      if (angle === 0) break;
      if (toDegree(Math.abs(angle)) < parallelogramRegularizeAngle) {
        this.vertices_ = rotate(this.vertices_, this.p1_, -angle);
        this.setFromVertices();
        regularized = true;
        break;
      }
    }

    const side1 = getDistance(this.p1_, this.p2_);
    const side2 = getDistance(this.p2_, this.p3_);
    const factor = regularized ? 5 : 3;
    if (areComparableLength(side1, side2, factor)) {
      const dist = getDistance(this.p1_, this.p2_);
      this.p3_ = getPointAtDistance(this.p2_, this.p3_, dist);
      this.p4_ = getPointAtDistance(this.p1_, this.p4_, dist);
      this.assign(new Quadrilateral(this.p1_, this.p2_, this.p3_, this.p4_));
      equalSides = true;
    }

    if (!regularized) {
      let minx = this.p1_;
      let maxx = this.p3_;
      for (let i = 0; i < 4; i++) {
        const v = this.vertices_[i] ?? new Point();
        if (v.x < minx.x) minx = v;
        if (v.x > maxx.x) maxx = v;
      }
      const angle = Math.atan2(maxx.y - minx.y, maxx.x - minx.x);
      if (angle !== 0 && toDegree(Math.abs(angle)) < parallelogramRegularizeAngle) {
        if (equalSides) {
          const mid = (minx.x + maxx.x) / 2;
          const y = (minx.y + maxx.y) / 2;
          const dist = getDistance(minx, maxx);
          this.p1_ = new Point(mid - dist / 2, y);
          this.p2_ = new Point(mid, y + dist / 4);
          this.p3_ = new Point(mid + dist / 2, y);
          this.p4_ = new Point(mid, y - dist / 4);
        } else {
          this.vertices_ = rotate(this.vertices_, this.p1_, -angle);
          this.setFromVertices();
        }
      }
    }
  }

  private chooseQuad(q1: Quadrilateral, q2: Quadrilateral): Quadrilateral {
    const area = this.getArea();
    const err1 = Math.abs(area - q1.getArea());
    const err2 = Math.abs(area - q2.getArea());
    return err1 < err2 ? q1 : q2;
  }

  /** The parallelogram on v1, v2, v3 (C++ passes a fourth vertex it overwrites). */
  private makeParallelogram(v1: Point, v2: Point, v3: Point): Quadrilateral {
    const mid = new Point((v1.x + v3.x) / 2, (v1.y + v3.y) / 2);
    const v4 = new Point(2 * mid.x - v2.x, 2 * mid.y - v2.y);
    return new Quadrilateral(v1, v2, v3, v4);
  }

  /** The axis-aligned rectangle on the diagonal vt1–vt3 (C++ passes vt2/vt4 and overwrites them). */
  private makeRectangle(vt1: Point, vt3: Point): Quadrilateral {
    let v1 = vt1;
    let v3 = vt3;
    if (v1.x > v3.x) [v1, v3] = [v3, v1];
    if (v3.y > v1.y) return new Quadrilateral(v1, new Point(v3.x, v1.y), v3, new Point(v1.x, v3.y));
    return new Quadrilateral(v1, new Point(v1.x, v3.y), v3, new Point(v3.x, v1.y));
  }

  private getArea(): number {
    let area = 0;
    const n = this.vertices_.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = this.vertices_[i] ?? new Point();
      const b = this.vertices_[j] ?? new Point();
      area += a.x * b.y;
      area -= a.y * b.x;
    }
    area /= 2;
    return area < 0 ? -area : area;
  }

  // C++ `areHorizontalLine(p1, p2)` ignores its arguments and tests p1_–p2_; kept.
  private areHorizontalLine(): boolean {
    return Math.abs(this.p1_.y - this.p2_.y) < 0.01;
  }

  private computeParallelogramRotation(): void {
    let dist1 = getDistance(this.p1_, this.p2_);
    let dist2 = getDistance(this.p2_, this.p3_);
    let big = dist1;
    let small = dist2;
    if (dist2 > dist1) {
      big = dist2;
      small = dist1;
    }
    if (big / small < 1.5) {
      // four calls in C++, each with different (ignored) arguments
      if (this.areHorizontalLine()) {
        this.angle_ = 0;
        return;
      }
    }
    const diff = dist1 - dist2;
    if (Math.abs(diff) < 0.5) {
      dist1 = getDistance(this.p1_, this.p3_);
      dist2 = getDistance(this.p2_, this.p4_);
      this.angle_ = dist1 > dist2 ? angleWithHorizontal(this.p1_, this.p3_) : angleWithHorizontal(this.p2_, this.p4_);
    } else if (dist1 > dist2) {
      this.angle_ = angleWithHorizontal(this.p1_, this.p2_);
    } else {
      this.angle_ = angleWithHorizontal(this.p2_, this.p3_);
    }
  }
}
