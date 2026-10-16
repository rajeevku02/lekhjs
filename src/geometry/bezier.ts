// Cubic and quadratic Bézier curves (port of C++ `geometry::BezierCurve` and
// `geometry::QuadBezierCurve`). These are mutable, like the C++ structs (the recognizer edits
// control points in place); copy with `clone()` where C++ copies by value.
import { solveCubic, solveQuadEquation } from '../base';
import { LineEquation } from './lineEquation';
import { LineSegment } from './lineSegment';
import { Point, type PointAndSlope, type Transformation } from './point';
import { getDistance, normalizeInHalfPI, rotate } from './primitives';
import type { Rect } from './rect';
import type { Range } from './size';

function coeffs(P0: number, P1: number, P2: number, P3: number): [number, number, number, number] {
  return [-P0 + 3 * P1 + -3 * P2 + P3, 3 * P0 - 6 * P1 + 3 * P2, -3 * P0 + 3 * P1, P0];
}

export class BezierCurve {
  point1: Point;
  point2: Point;
  point3: Point;
  point4: Point;
  /** 4 for a cubic; 2 renders as the line point1 → point2 (C++ field, kept). */
  numPoints: number;
  /** The cached render step (C++ `step`); 0 until guessed. */
  private step = 0;

  constructor(p1 = new Point(), p2 = new Point(), p3 = new Point(), p4 = new Point(), numPoints = 4) {
    this.point1 = p1;
    this.point2 = p2;
    this.point3 = p3;
    this.point4 = p4;
    this.numPoints = numPoints;
  }

  clone(): BezierCurve {
    const c = new BezierCurve(this.point1, this.point2, this.point3, this.point4, this.numPoints);
    c.step = this.step;
    return c;
  }

  getPoints(): Point[] {
    return [this.point1, this.point2, this.point3, this.point4];
  }

  setPoints(points: readonly Point[]): void {
    const [a, b, c, d] = points;
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new RangeError('BezierCurve.setPoints needs four points');
    }
    this.point1 = a;
    this.point2 = b;
    this.point3 = c;
    this.point4 = d;
  }

  /** Sample points from u = 0 by the guessed step (each about 2 px apart); appends to `pts`. */
  render(pts: Point[] = []): { points: Point[]; step: number } {
    if (this.numPoints === 2) {
      new LineSegment(this.point1, this.point2).getRenderedPoints(pts);
      return { points: pts, step: this.step };
    }
    if (this.step === 0) this.step = this.guessStep();
    let u = 0;
    while (u <= 1.0) {
      pts.push(this.getPoint(u));
      u += this.step;
    }
    return { points: pts, step: this.step };
  }

  /** The parameters of the left-most and top-most sampled points. */
  getTForLeftAndTopPoint(): { left: number; top: number } {
    if (this.step === 0) this.step = this.guessStep();
    if (this.step < 0.0001) this.step = 0.0001;
    let t1 = 0;
    let t2 = 0;
    let pt = this.getPoint(0);
    let x = pt.x;
    let y = pt.y;
    let u = 0;
    while (u <= 1.0) {
      pt = this.getPoint(u);
      if (pt.x < x) {
        t1 = u;
        x = pt.x;
      }
      if (pt.y < y) {
        t2 = u;
        y = pt.y;
      }
      u += this.step;
    }
    return { left: t1, top: t2 };
  }

  getPoint(u: number): Point {
    const t = 1 - u;
    const a = t * t * t;
    const b = 3 * u * t * t;
    const c = 3 * u * u * t;
    const d = u * u * u;
    return new Point(
      a * this.point1.x + b * this.point2.x + c * this.point3.x + d * this.point4.x,
      a * this.point1.y + b * this.point2.y + c * this.point3.y + d * this.point4.y,
    );
  }

  /** The tangent's slope at `u`, in [-π/2, π/2]. */
  slopeAt(u: number): number {
    const t = 1 - u;
    const a = 3 * t * t;
    const b = 6 * t * u;
    const c = 3 * u * u;
    const { point1: p1, point2: p2, point3: p3, point4: p4 } = this;
    const dx = a * (p2.x - p1.x) + b * (p3.x - p2.x) + c * (p4.x - p3.x);
    const dy = a * (p2.y - p1.y) + b * (p3.y - p2.y) + c * (p4.y - p3.y);
    return normalizeInHalfPI(Math.atan2(dy, dx));
  }

  /** Parameters in [0, 1] where the curve meets `seg` (within 0.4 of its range). */
  intersectSegment(seg: LineSegment): number[] {
    const sln: number[] = [];
    for (const r of this.intersectLine(LineEquation.through(seg.p1, seg.p2))) {
      if (seg.inRange(this.getPoint(r), 0.4)) sln.push(r);
    }
    return sln;
  }

  /** Parameters in [0, 1] where the curve meets the infinite line `eq`. */
  intersectLine(eq: LineEquation): number[] {
    const bx = coeffs(this.point1.x, this.point2.x, this.point3.x, this.point4.x);
    const by = coeffs(this.point1.y, this.point2.y, this.point3.y, this.point4.y);
    const A = eq.A * bx[0] + eq.B * by[0];
    const B = eq.A * bx[1] + eq.B * by[1];
    const C = eq.A * bx[2] + eq.B * by[2];
    const D = eq.A * bx[3] + eq.B * by[3] + eq.C;
    return solveCubic(A, B, C, D).filter((r) => !(r < 0 || r > 1));
  }

  /** The parameter ranges of the curve inside `rect`. */
  clip(rect: Rect): Range[] {
    const ranges: Range[] = [];
    if (
      rect.contains(this.point1) &&
      rect.contains(this.point2) &&
      rect.contains(this.point3) &&
      rect.contains(this.point4)
    ) {
      ranges.push({ start: 0, end: 1 });
      return ranges;
    }
    const intersections: number[] = [];
    const points = rect.getPoints();
    for (let i = 0; i < points.length; i++) {
      const j = i + 1 === points.length ? 0 : i + 1;
      intersections.push(...this.intersectSegment(new LineSegment(points[i], points[j])));
    }
    if (intersections.length === 0) return ranges;
    intersections.sort((a, b) => a - b);
    const at = (i: number): number => intersections[i] ?? 0;
    if (at(0) > 0) {
      if (rect.contains(this.getPoint(at(0) / 2))) ranges.push({ start: 0, end: at(0) });
    }
    let index = 0;
    while (index < intersections.length - 1) {
      if (rect.contains(this.getPoint((at(index) + at(index + 1)) / 2))) {
        ranges.push({ start: at(index), end: at(index + 1) });
      }
      index++;
    }
    if (at(index) < 1) {
      if (rect.contains(this.getPoint((at(index) + 1.0) / 2))) ranges.push({ start: at(index), end: 1.0 });
    }
    return ranges;
  }

  /** De Casteljau split at `t` into two cubics. */
  split(t: number): [BezierCurve, BezierCurve] {
    const { point1: p1, point2: p2, point3: p3, point4: p4 } = this;
    const x12 = (p2.x - p1.x) * t + p1.x;
    const y12 = (p2.y - p1.y) * t + p1.y;
    const x23 = (p3.x - p2.x) * t + p2.x;
    const y23 = (p3.y - p2.y) * t + p2.y;
    const x34 = (p4.x - p3.x) * t + p3.x;
    const y34 = (p4.y - p3.y) * t + p3.y;
    const x123 = (x23 - x12) * t + x12;
    const y123 = (y23 - y12) * t + y12;
    const x234 = (x34 - x23) * t + x23;
    const y234 = (y34 - y23) * t + y23;
    const x1234 = (x234 - x123) * t + x123;
    const y1234 = (y234 - y123) * t + y123;
    return [
      new BezierCurve(p1, new Point(x12, y12), new Point(x123, y123), new Point(x1234, y1234)),
      new BezierCurve(new Point(x1234, y1234), new Point(x234, y234), new Point(x34, y34), p4),
    ];
  }

  /** The part of the curve between `t1` and `t2`. */
  subCurve(t1: number, t2: number): BezierCurve {
    const [left] = this.split(t2);
    return left.split(t1 / t2)[1];
  }

  /** Line segments approximating the curve, recursively split at the peak (C++ `approxLines`). */
  approxLines(result: LineSegment[] = [], minErr = -1): LineSegment[] {
    const seg = new LineSegment(this.point1, this.point4);
    const t = this.getTOfPeak();
    const peak = this.getPoint(t);
    const dist = seg.getDistanceFrom(peak).dist;
    const len = seg.length();
    let done: boolean;
    const factor = 0.14;
    const defaultMinErr = 8;
    if (minErr > 0) {
      done = dist <= minErr;
    } else if (dist < len * 0.9 && dist < defaultMinErr) {
      done = true;
    } else {
      done = dist < len * factor;
    }
    if (done) {
      result.push(seg);
    } else {
      for (const item of this.split(t)) item.approxLines(result, minErr);
    }
    return result;
  }

  reversePoints(): void {
    [this.point1, this.point4] = [this.point4, this.point1];
    [this.point2, this.point3] = [this.point3, this.point2];
  }

  /** Moves point1 to the origin and point4 onto the +x axis; returns the inverse transform. */
  transformToOrigin(): Transformation {
    const tr: Transformation = {
      dx: this.point1.x,
      dy: this.point1.y,
      angle: Math.atan2(this.point4.y - this.point1.y, this.point4.x - this.point1.x),
    };
    this.transform({ dx: -tr.dx, dy: -tr.dy, angle: -tr.angle });
    return tr;
  }

  /** Rotates about point1 by `tr.angle`, then translates by (`tr.dx`, `tr.dy`). */
  transform(tr: Transformation): void {
    const vtx = this.getPoints();
    const rotated = rotate(vtx, vtx[0] ?? this.point1, tr.angle).map((p) => p.withDelta(tr.dx, tr.dy));
    this.setPoints(rotated);
  }

  /** The point at the curve's peak (C++ `getSingleControl`). */
  getSingleControl(): Point {
    return this.getPoint(this.getTOfPeak());
  }

  /** Moves both controls so that the peak passes through `pt` (C++ `moveSingleControlPoint`). */
  moveSingleControlPoint(pt: Point): void {
    const bz = this.clone();
    const tr = bz.transformToOrigin();
    let ctrl = rotate([pt], this.point1, -tr.angle)[0] ?? pt;
    ctrl = new Point(ctrl.x - tr.dx, ctrl.y - tr.dy);
    const t = this.getTOfPeak();
    const u = 1 - t;
    const factor = 3 * u * u * t + 3 * u * t * t;
    if (factor < 0.008) return;
    const peak = bz.getPoint(t);
    const ydelta = (ctrl.y - peak.y) / factor;
    const xdelta = (ctrl.x - peak.x) / factor;
    bz.point2 = new Point(bz.point2.x + xdelta, bz.point2.y + ydelta);
    bz.point3 = new Point(bz.point3.x + xdelta, bz.point3.y + ydelta);
    bz.transform(tr);
    this.point2 = bz.point2;
    this.point3 = bz.point3;
  }

  private getTOfPeak(): number {
    const bz = this.clone();
    bz.transformToOrigin();
    const A = bz.point1.y + 3 * bz.point2.y - 3 * bz.point3.y + bz.point4.y;
    const B = 2 * bz.point1.y - 4 * bz.point2.y + 2 * bz.point3.y;
    const C = bz.point2.y - bz.point1.y;
    const sln = solveQuadEquation(A, B, C);
    const [s0, s1] = sln;
    if (s0 === undefined) return 0.5;
    if (s1 === undefined) return s0;
    return Math.abs(s0 - 0.5) < Math.abs(s1 - 0.5) ? s0 : s1;
  }

  private guessStep(): number {
    return (this.guessStepAt(0) + this.guessStepAt(0.4) + this.guessStepAt(0.8)) / 3;
  }

  private guessStepAt(u: number): number {
    const p1 = this.getPoint(u);
    let step = 0.001;
    let p2 = this.getPoint(u + step);
    let tryCount = 0;
    while (getDistance(p1, p2) <= 2) {
      step += 0.001;
      p2 = this.getPoint(u + step);
      tryCount++;
      if (tryCount > 20) return 0.01;
    }
    return step;
  }
}

/** Quadratic Bézier curve (C++ `QuadBezierCurve`). */
export class QuadBezier {
  point1: Point;
  point2: Point;
  point3: Point;

  constructor(p1 = new Point(), p2 = new Point(), p3 = new Point()) {
    this.point1 = p1;
    this.point2 = p2;
    this.point3 = p3;
  }

  clone(): QuadBezier {
    return new QuadBezier(this.point1, this.point2, this.point3);
  }

  getPoints(): Point[] {
    return [this.point1, this.point2, this.point3];
  }

  /** Ignored unless exactly three points (as in C++). */
  setPoints(points: readonly Point[]): void {
    const [a, b, c] = points;
    if (points.length !== 3 || a === undefined || b === undefined || c === undefined) return;
    this.point1 = a;
    this.point2 = b;
    this.point3 = c;
  }

  rotate(angle: number, pivot: Point): void {
    this.setPoints(rotate(this.getPoints(), pivot, angle));
  }

  getPoint(t: number): Point {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return new Point(
      a * this.point1.x + b * this.point2.x + c * this.point3.x,
      a * this.point1.y + b * this.point2.y + c * this.point3.y,
    );
  }

  slopeAt(t: number): number {
    const a = 2 * (1 - t);
    const b = 2 * t;
    const dy = a * (this.point2.y - this.point1.y) + b * (this.point3.y - this.point2.y);
    const dx = a * (this.point2.x - this.point1.x) + b * (this.point3.x - this.point2.x);
    return normalizeInHalfPI(Math.atan2(dy, dx));
  }

  /** The points where the curve meets `eq`, with the curve's slope there; empty if none. */
  intersect(eq: LineEquation): PointAndSlope[] {
    const angle = eq.angleWithHorizontal();
    const qb = this.clone();
    qb.rotate(-angle, new Point(0, 0));
    const eq2 = eq.rotate(new Point(0, 0), -angle);
    let lc = 0;
    if (eq2.B !== 0) lc = -eq2.C / eq2.B;
    const a = qb.point1.y - 2 * qb.point2.y + qb.point3.y;
    const b = -2 * qb.point1.y + 2 * qb.point2.y;
    const c = qb.point1.y - lc;
    const finalPts: Point[] = [];
    const slopes: number[] = [];
    for (const v of solveQuadEquation(a, b, c)) {
      if (v >= 0 && v <= 1.0) {
        finalPts.push(qb.getPoint(v));
        slopes.push(this.slopeAt(v));
      }
    }
    const rotated = finalPts.length > 0 ? rotate(finalPts, new Point(0, 0), angle) : finalPts;
    return rotated.map((point, i) => ({ point, slope: slopes[i] ?? 0 }));
  }
}
