// Finite segment (port of C++ `geometry::LineSegment`). Immutable: `setPoint1`, `setPoint2` and
// `reversePoints` become `withPoint1`, `withPoint2` and `reversed`. C++ out-parameters become
// return values (`{ dist, near }`, `Point | null`).
import { toInt } from '../base';
import { LineEquation } from './lineEquation';
import { Point } from './point';
import { getDistance } from './primitives';
import type { Rect } from './rect';

const rangeDelta = 0.4;

/** C++ `SegmentJoinInfo`: how two segments meet, or how far apart they are. */
export interface SegmentJoinInfo {
  readonly at: Point;
  readonly other: Point;
  readonly dist: number;
  readonly trim1: number;
  readonly trim2: number;
}

/** `trim1 + trim2` (C++ `SegmentJoinInfo::trim()`). */
export function joinTrim(sji: SegmentJoinInfo): number {
  return sji.trim1 + sji.trim2;
}

/** A distance and the nearest point it was measured to. */
export interface DistanceAndPoint {
  readonly dist: number;
  readonly near: Point;
}

function inRangeValue(v1: number, v2: number, val: number, delta: number): boolean {
  let val1 = v1;
  let val2 = v2;
  if (val2 < val1) [val1, val2] = [val2, val1];
  return val1 - delta <= val && val <= val2 + delta;
}

/**
 * `new LineSegment(p1, p2).getDistanceFrom(point).dist` without the allocations: the same
 * arithmetic in the same order (the line through the ends, the perpendicular through `point`,
 * Cramer's rule for the foot, the 0.4 on-segment test), so the result is the same number. For
 * the per-segment loops of hit tests over freehand ink (P3: P-03 'near' on S-dec/d5).
 */
export function distanceToSegment(p1: Point, p2: Point, point: Point): number {
  return segmentDistanceXY(p1.x, p1.y, p2.x, p2.y, point.x, point.y);
}

/** `distanceToSegment` on coordinates: the segment (x1, y1)–(x2, y2), the point (px, py). */
export function segmentDistanceXY(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
  // LineEquation.through(p1, p2)
  const A = y2 - y1;
  const B = x1 - x2;
  const C = y1 * x2 - x1 * y2;
  // getPerpendicularPassingThrough(point)
  const A2 = -B;
  const B2 = A;
  const C2 = -A2 * px - B2 * py;
  // solveWith: the foot, (0, 0) when the lines do not meet
  const D = A * B2 - A2 * B;
  let fx = 0;
  let fy = 0;
  if (D !== 0) {
    fx = (B2 * -C - B * -C2) / D;
    fy = (A * -C2 - A2 * -C) / D;
  }
  // containsEqPoint(foot)
  const d1x = x1 - fx;
  const d1y = y1 - fy;
  const d2x = x2 - fx;
  const d2y = y2 - fy;
  const lx = x2 - x1;
  const ly = y2 - y1;
  const len = Math.sqrt(lx * lx + ly * ly);
  if (Math.abs(len - (Math.sqrt(d1x * d1x + d1y * d1y) + Math.sqrt(d2x * d2x + d2y * d2y))) < rangeDelta) {
    return Math.abs(A * px + B * py + C) / Math.sqrt(A * A + B * B);
  }
  const e1x = px - x1;
  const e1y = py - y1;
  const e2x = px - x2;
  const e2y = py - y2;
  const dist = Math.sqrt(e1x * e1x + e1y * e1y);
  const dist2 = Math.sqrt(e2x * e2x + e2y * e2y);
  return dist2 < dist ? dist2 : dist;
}

export class LineSegment {
  readonly p1: Point;
  readonly p2: Point;

  constructor(p1: Point = new Point(), p2: Point = new Point()) {
    this.p1 = p1;
    this.p2 = p2;
  }

  point1(): Point {
    return this.p1;
  }
  point2(): Point {
    return this.p2;
  }
  withPoint1(p: Point): LineSegment {
    return new LineSegment(p, this.p2);
  }
  withPoint2(p: Point): LineSegment {
    return new LineSegment(this.p1, p);
  }
  reversed(): LineSegment {
    return new LineSegment(this.p2, this.p1);
  }

  length(): number {
    return getDistance(this.p1, this.p2);
  }

  /**
   * True when `pt`, already known to be on this segment's line, lies between the ends: the two
   * end distances add up to the length within 0.4.
   */
  containsEqPoint(pt: Point): boolean {
    const dist1 = getDistance(pt, this.p1);
    const dist2 = getDistance(pt, this.p2);
    const len = getDistance(this.p1, this.p2);
    return Math.abs(len - (dist1 + dist2)) < rangeDelta;
  }

  /**
   * Distance from `point`, and the nearest point: the foot of the perpendicular when it falls on
   * the segment, else the nearer end.
   */
  getDistanceFrom(point: Point): DistanceAndPoint {
    const eq = LineEquation.through(this.p1, this.p2);
    const eq2 = eq.getPerpendicularPassingThrough(point);
    // C++ leaves the out-point untouched (a default (0, 0)) when the lines do not meet.
    const foot = eq.solveWith(eq2) ?? new Point();
    if (this.containsEqPoint(foot)) return { dist: eq.getDistanceFrom(point), near: foot };
    let near = this.p1;
    let dist = getDistance(this.p1, point);
    const dist2 = getDistance(this.p2, point);
    if (dist2 < dist) {
      near = this.p2;
      dist = dist2;
    }
    return { dist, near };
  }

  /** Both coordinates of `pt` within the ends' range ± `delta`. */
  inRange(pt: Point, delta = 0.2): boolean {
    return inRangeValue(this.p1.x, this.p2.x, pt.x, delta) && inRangeValue(this.p1.y, this.p2.y, pt.y, delta);
  }

  /** The intersection with `other`, or null. */
  getIntersection(other: LineSegment): Point | null {
    const eq1 = LineEquation.through(this.p1, this.p2);
    const eq2 = LineEquation.through(other.p1, other.p2);
    const pt = eq1.solveWith(eq2);
    if (pt === null) return null;
    if (!this.containsEqPoint(pt) || !other.containsEqPoint(pt)) return null;
    return pt;
  }

  /** The intersection with the infinite line `eq`, or null. */
  getIntersectionWithLine(eq: LineEquation): Point | null {
    const pt = LineEquation.through(this.p1, this.p2).solveWith(eq);
    if (pt === null) return null;
    if (!this.containsEqPoint(pt)) return null;
    return pt;
  }

  /** The parts of the segment inside `rect` (C++ `clip`): zero or one segment. */
  clip(rect: Rect): LineSegment[] {
    if (rect.contains(this.p1) && rect.contains(this.p2)) return [this];
    const intersections: Point[] = [];
    const points = rect.getPoints();
    for (let i = 0; i < points.length; i++) {
      const j = i + 1 === points.length ? 0 : i + 1;
      const pt = this.getIntersection(new LineSegment(points[i], points[j]));
      if (pt !== null) intersections.push(pt);
    }
    const [in1, in2] = intersections;
    if (intersections.length === 1 && in1 !== undefined) {
      if (rect.contains(this.p1)) return [new LineSegment(this.p1, in1)];
      if (rect.contains(this.p2)) return [new LineSegment(in1, this.p2)];
    } else if (intersections.length === 2 && in1 !== undefined && in2 !== undefined) {
      const dist1 = getDistance(this.p1, in1);
      const dist2 = getDistance(this.p1, in2);
      return [dist2 < dist1 ? new LineSegment(in2, in1) : new LineSegment(in1, in2)];
    }
    return [];
  }

  /**
   * The integer pixels of the segment by Bresenham, without the first one (C++
   * `getRenderedPoints`). Coordinates are truncated toward zero first, as C++ `int` does.
   */
  getRenderedPoints(points: Point[] = []): Point[] {
    let x0 = toInt(this.p1.x);
    let y0 = toInt(this.p1.y);
    const x1 = toInt(this.p2.x);
    const y1 = toInt(this.p2.y);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let firstDone = false;
    for (;;) {
      if (!firstDone) firstDone = true;
      else points.push(new Point(x0, y0));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err = err - dy;
        x0 = x0 + sx;
      }
      if (e2 < dx) {
        err = err + dx;
        y0 = y0 + sy;
      }
    }
    return points;
  }

  /** Appends the rendered pixels from `pt1` to `pt2` to `points`. */
  static addIntermediatePoints(points: Point[], pt1: Point, pt2: Point): void {
    new LineSegment(pt1, pt2).getRenderedPoints(points);
  }

  /** How `seg1` and `seg2` join (C++ `LineSegment::tryJoin`, kept as is). */
  static tryJoin(seg1: LineSegment, seg2: LineSegment): SegmentJoinInfo {
    const point = seg1.getIntersection(seg2);
    if (point !== null) {
      return {
        at: point,
        other: point,
        trim1: getDistance(seg1.p1, point),
        trim2: getDistance(seg2.p1, point),
        dist: 0,
      };
    }
    const r1 = seg2.getDistanceFrom(seg1.p1);
    const r2 = seg1.getDistanceFrom(seg2.p1);
    if (r1.dist < r2.dist) {
      return {
        at: r1.near,
        other: seg1.p1,
        dist: getDistance(seg1.p1, r1.near),
        trim1: 0,
        trim2: getDistance(seg2.p1, r1.near),
      };
    }
    // C++ measures trim1 to the first near point (p1), not p2; kept.
    return {
      at: r2.near,
      other: seg2.p1,
      dist: getDistance(seg2.p1, r2.near),
      trim1: getDistance(seg1.p1, r1.near),
      trim2: 0,
    };
  }
}
