// Free geometry functions (port of C++ `geometry::GeoUtil`, plus the `Rectangle` operations that
// need segments). Every cross-type operation lives here, importing the classes; the classes
// import nothing of this file, so the C++ `GeoUtil ↔ LineEquation ↔ LineSegment ↔ Rectangle`
// cycle does not exist in TS (spec 01 §3.1 C1). `GeoUtil` bundles them for C++-style calls.
import { formatG6, Span } from '../base';
import { LineEquation } from './lineEquation';
import { LineSegment, type DistanceAndPoint } from './lineSegment';
import { Point, type PointAndSlope } from './point';
import {
  getDistance,
  normalizeAngleIn2PI,
  normalizeAngleInPI,
  normalizeInHalfPI,
  rotate,
  rotateAboutMid,
  rotatePoint,
  toDegree,
  toRadian,
} from './primitives';
import { Rect } from './rect';

export {
  getDistance,
  normalizeAngleIn2PI,
  normalizeAngleInPI,
  normalizeInHalfPI,
  rotate,
  rotateAboutMid,
  rotatePoint,
  toDegree,
  toRadian,
};

/** C++ `TurnDir`. */
export const TurnDir = Object.freeze({ NoTurn: 0, UTurn: 1, Left: 2, Right: 3 } as const);
export type TurnDir = (typeof TurnDir)[keyof typeof TurnDir];

/** A point list or a span of one (C++ `std::vector<Point>` / `geometry::Points`). */
export type PointList = readonly Point[] | Span<Point>;

function asArray(points: PointList): readonly Point[] {
  return points instanceof Span ? points.toArray() : points;
}

function pt(points: readonly Point[], i: number): Point {
  const p = points[i];
  if (p === undefined) throw new RangeError(`point index ${String(i)} out of range`);
  return p;
}

/** Every point moved by (dx, dy). */
export function translate(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => new Point(p.x + dx, p.y + dy));
}

/** Every point scaled by `factor` about the origin. */
export function zoomPoints(points: readonly Point[], factor: number): Point[] {
  return points.map((p) => p.zoomed(factor));
}

/**
 * C++ `GeoUtil::scale(points, factor)`: scaled about the origin, then moved back by the shift of
 * the mean, truncated to whole units as C++ `int` does.
 */
export function scale(points: readonly Point[], factor: number): Point[] {
  let mx = 0;
  let my = 0;
  let scaled = points.map((p) => {
    mx += p.x;
    my += p.y;
    return new Point(p.x * factor, p.y * factor);
  });
  mx /= scaled.length;
  my /= scaled.length;
  let m2x = 0;
  let m2y = 0;
  for (const p of scaled) {
    m2x += p.x;
    m2y += p.y;
  }
  m2x /= scaled.length;
  m2y /= scaled.length;
  const dx = Math.trunc(mx - m2x);
  const dy = Math.trunc(my - m2y);
  scaled = scaled.map((p) => new Point(p.x + dx, p.y + dy));
  return scaled;
}

/**
 * C++ `GeoUtil::scale(points, fx, fy, anchorCorner)`: scaled about the origin; with
 * `anchorCorner` < 0 left there, otherwise moved back so the anchor corner (0 top-left,
 * 1 bottom-left, 3 bottom-right, 4 top-right, else the mean) stays put. The shift is truncated to
 * whole units, as C++ `int` does.
 */
export function scaleAnchored(
  points: readonly Point[],
  factorx: number,
  factory: number,
  anchorCorner: number,
): Point[] {
  const first = pt(points, 0);
  let mx = 0;
  let my = 0;
  let minx = first.x;
  let maxx = first.x;
  let miny = first.y;
  let maxy = first.y;
  const scaled = points.map((p) => {
    mx += p.x;
    my += p.y;
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.y > maxy) maxy = p.y;
    return new Point(p.x * factorx, p.y * factory);
  });
  if (anchorCorner < 0) return scaled;
  mx /= scaled.length;
  my /= scaled.length;
  const f2 = pt(scaled, 0);
  let m2x = 0;
  let m2y = 0;
  let minx2 = f2.x;
  let maxx2 = f2.x;
  let miny2 = f2.y;
  let maxy2 = f2.y;
  for (const p of scaled) {
    m2x += p.x;
    m2y += p.y;
    if (p.x < minx2) minx2 = p.x;
    if (p.x > maxx2) maxx2 = p.x;
    if (p.y < miny2) miny2 = p.y;
    if (p.y > maxy2) maxy2 = p.y;
  }
  m2x /= scaled.length;
  m2y /= scaled.length;
  let dx = Math.trunc(mx - m2x);
  let dy = Math.trunc(my - m2y);
  switch (anchorCorner) {
    case 0:
      dx = Math.trunc(minx - minx2);
      dy = Math.trunc(miny - miny2);
      break;
    case 1:
      dx = Math.trunc(minx - minx2);
      dy = Math.trunc(maxy - maxy2);
      break;
    case 3:
      dx = Math.trunc(maxx - maxx2);
      dy = Math.trunc(maxy - maxy2);
      break;
    case 4:
      dx = Math.trunc(maxx - maxx2);
      dy = Math.trunc(miny - miny2);
      break;
    default:
      break;
  }
  return scaled.map((p) => new Point(p.x + dx, p.y + dy));
}

/** The angle in degrees between first→connectionPoint and connectionPoint→last (0 = straight on). */
export function getAngle(first: Point, connectionPoint: Point, last: Point): number {
  const dp =
    (connectionPoint.x - first.x) * (last.x - connectionPoint.x) +
    (connectionPoint.y - first.y) * (last.y - connectionPoint.y);
  const d1 = getDistance(first, connectionPoint);
  const d2 = getDistance(last, connectionPoint);
  let cosVal = dp / (d1 * d2);
  if (cosVal > 1.0) cosVal = 1.0;
  if (cosVal < -1.0) cosVal = -1.0;
  let theta = Math.acos(cosVal);
  if (Number.isNaN(theta)) theta = Math.PI / 2;
  return toDegree(theta);
}

/** C++ `getAngle(p1, p2, p3, p4)`: the angle between p1→p2 and p3→p4, in degrees. */
export function getAngle4(p1: Point, p2: Point, p3: Point, p4: Point): number {
  return getAngle(p1, p2, new Point(p4.x + (p2.x - p3.x), p4.y + (p2.y - p3.y)));
}

/** C++ `getSlope`: degrees of |dy| over |dx| (the C++ FIXME about abs() is kept). */
export function getSlope(p1: Point, p2: Point): number {
  const xd = Math.abs(p2.x - p1.x);
  const yd = Math.abs(p2.y - p1.y);
  if (xd === 0 && yd === 0) return 0;
  return toDegree(Math.atan2(yd, xd));
}

/** Distance from `p` to the infinite line through `p1` and `p2`. */
export function getPointLineDistance(p1: Point, p2: Point, p: Point): number {
  return LineEquation.through(p1, p2).getDistanceFrom(p);
}

/** Index of the point farthest from `lineEq` (0 when all are on it). */
export function getAmplitudePointIndex(points: PointList, lineEq: LineEquation): number {
  let dist = 0;
  let index = 0;
  const n = points instanceof Span ? points.size : points.length;
  for (let i = 0; i < n; i++) {
    const p = points instanceof Span ? points.at(i) : pt(points, i);
    const tmp = lineEq.getDistanceFrom(p);
    if (tmp > dist) {
      index = i;
      dist = tmp;
    }
  }
  return index;
}

/** The three points of an arrowhead at p2 pointing from p1: [wing, tip, wing]. */
export function getPointsForArrow(p1: Point, p2: Point, d1: number, d2: number): Point[] {
  const p = getPointAtDistance(p2, p1, d1);
  const eq2 = LineEquation.through(p1, p2).getPerpendicularPassingThrough(p);
  const tmp = eq2.getPointsAtDistanceFrom(d2, p);
  return [pt(tmp, 0), p2, pt(tmp, 1)];
}

/** Even-odd point-in-polygon (http://alienryderflex.com/polygon/). */
export function isPointInsidePolygon(vertices: readonly Point[], p: Point): boolean {
  let j = vertices.length - 1;
  let oddNodes = false;
  for (let i = 0; i < vertices.length; i++) {
    const vi = pt(vertices, i);
    const vj = pt(vertices, j);
    if (((vi.y < p.y && vj.y >= p.y) || (vj.y < p.y && vi.y >= p.y)) && (vi.x <= p.x || vj.x <= p.x)) {
      if (vi.x + ((p.y - vi.y) / (vj.y - vi.y)) * (vj.x - vi.x) < p.x) oddNodes = !oddNodes;
    }
    j = i;
  }
  return oddNodes;
}

/** Where `eq` crosses the polygon's edges, with each edge's slope (floating-point sensitive). */
export function intersectionWithPolygon(vertices: readonly Point[], eq: LineEquation, closed = true): PointAndSlope[] {
  const ret: PointAndSlope[] = [];
  let lastIndex = vertices.length;
  if (!closed) lastIndex--;
  for (let i = 0; i < lastIndex; i++) {
    const j = (i + 1) % vertices.length;
    const vi = pt(vertices, i);
    const vj = pt(vertices, j);
    const sln = eq.solveWith(LineEquation.through(vi, vj));
    if (sln === null) continue;
    if (getDistance(vi, sln) < 0.1 || getDistance(vj, sln) < 0.1 || isPointBetween(vi, vj, sln)) {
      const angle = Math.atan2(vj.y - vi.y, vj.x - vi.x);
      ret.push({ point: sln, slope: normalizeInHalfPI(angle) });
    }
  }
  return ret;
}

/** The angle of the line p1–p2 with the x axis, taking the left point first. */
export function angleWithHorizontal(first: Point, second: Point): number {
  let p1 = first;
  let p2 = second;
  if (p1.x > p2.x) [p1, p2] = [p2, p1];
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/** The mean of the points (NaN for none, as C++). */
export function getMidPoint(pts: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return new Point(x / pts.length, y / pts.length);
}

/** Do segments p1–p2 and p3–p4 cross (with C++'s 1-unit tolerance on near-axis segments)? */
export function intersects(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const eq1 = LineEquation.through(p1, p2);
  const eq2 = LineEquation.through(p3, p4);
  if (eq1.A === eq2.A && eq1.B === eq2.B) return false;
  const intct = eq1.solveWith(eq2);
  if (intct === null) return false;
  return isPointBetween(p1, p2, intct) && isPointBetween(p3, p4, intct);
}

/** Is `p` within the box of first–second (with a 1-unit tolerance on a thin axis)? */
export function isPointBetween(first: Point, second: Point, p: Point): boolean {
  let xm = false;
  let ym = false;
  let p1 = first;
  let p2 = second;
  if (p2.x < p1.x) [p1, p2] = [p2, p1];
  if (Math.abs(p1.x - p2.x) <= 1) {
    if (Math.abs(p1.x - p.x) < 1 || Math.abs(p2.x - p.x) < 1) xm = true;
  }
  if (p.x >= p1.x && p.x <= p2.x) xm = true;
  if (p2.y < p1.y) [p1, p2] = [p2, p1];
  if (Math.abs(p1.y - p2.y) <= 1) {
    if (Math.abs(p1.y - p.y) < 1 || Math.abs(p2.y - p.y) < 1) ym = true;
  }
  if (p.y >= p1.y && p.y <= p2.y) ym = true;
  return xm && ym;
}

/** Distance from `p` to the segment p1–p2 and the nearest point on it. */
export function pointLineSegmentDistance(p1: Point, p2: Point, p: Point): DistanceAndPoint {
  return new LineSegment(p1, p2).getDistanceFrom(p);
}

/** The point at `dist` from p1 towards p2 (p1 when they coincide). */
export function getPointAtDistance(p1: Point, p2: Point, dist: number): Point {
  const fullDist = getDistance(p1, p2);
  if (fullDist === 0) return p1;
  const t = dist / fullDist;
  return new Point(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
}

/** The perpendicular bisector of p1–p2. */
export function getPerpendicularEquation(p1: Point, p2: Point): LineEquation {
  return new LineEquation(
    2 * (p2.x - p1.x),
    2 * (p2.y - p1.y),
    p1.y * p1.y - p2.y * p2.y + (p1.x * p1.x - p2.x * p2.x),
  );
}

/** Degrees in (-180, 180]. */
export function toDegreeReadable(rad: number): number {
  let angle = toDegree(rad);
  if (angle > 360) angle = angle % 360.0;
  if (angle < -360) angle = -(-angle % 360.0);
  if (angle > 180 && angle <= 360) angle -= 360;
  if (angle < -180 && angle >= -360) angle += 360;
  return angle;
}

/** Densifies a stroke: drops points closer than 4 and fills the gaps with Bresenham pixels. */
export function preProcess(points: readonly Point[]): Point[] {
  const output: Point[] = [];
  const distConst = 4.0;
  const len = points.length;
  if (len === 0) return output;
  let lastPt = pt(points, 0);
  output.push(lastPt);
  if (len === 1) return output;
  let lastIndex = 0;
  let index = 1;
  while (index < points.length) {
    const pt2 = pt(points, index);
    if (getDistance(lastPt, pt2) < distConst) {
      index++;
      continue;
    }
    LineSegment.addIntermediatePoints(output, lastPt, pt2);
    lastPt = pt2;
    lastIndex = index;
    index++;
  }
  if (index >= len) index = len - 1;
  if (lastIndex !== index) LineSegment.addIntermediatePoints(output, lastPt, pt(points, len - 1));
  return output;
}

/** Resamples a stroke so that consecutive points are 3 to 7 apart. */
export function preProcess2(origPoints: readonly Point[]): Point[] {
  const outPoints: Point[] = [];
  const maxDist = 7;
  const minDist = 3;
  if (origPoints.length === 0) return outPoints;
  const orig = origPoints.slice().reverse();
  const back = (a: Point[]): Point => pt(a, a.length - 1);
  outPoints.push(back(orig));
  orig.pop();
  while (orig.length > 1) {
    const dist = getDistance(back(orig), back(outPoints));
    if (dist <= maxDist && dist >= minDist) {
      outPoints.push(back(orig));
      orig.pop();
    } else if (dist < minDist) {
      orig.pop();
    } else {
      const p1 = back(orig);
      const p2 = back(outPoints);
      orig.push(new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2));
    }
  }
  if (orig.length > 0) {
    outPoints.push(back(orig));
    orig.pop();
  }
  return outPoints;
}

/** True for a NaN or infinite coordinate. */
export function isInvalidPoint(p: Point): boolean {
  return !Number.isFinite(p.x) || !Number.isFinite(p.y);
}

/** The bounds of the points (a zero rect for none). */
export function getPointsBound(points: PointList): Rect {
  const pts = asArray(points);
  const first = pts[0];
  if (first === undefined) return new Rect();
  let rect = new Rect(first.x, first.y, 0, 0);
  for (let i = 1; i < pts.length; i++) rect = rect.include(pt(pts, i));
  return rect;
}

export function crossProduct(p1: Point, p2: Point): number {
  return p1.x * p2.y - p2.x * p1.y;
}

/** Which way the path p1→p2→p3 turns (angles in degrees within `angleDelta` count as none / U). */
export function getTurnDir(p1: Point, p2: Point, p3: Point, angleDelta = 0.01): TurnDir {
  const angle = getAngle(p1, p2, p3);
  if (angle < angleDelta) return TurnDir.NoTurn;
  if (angle > 180 - angleDelta) return TurnDir.UTurn;
  const cp = crossProduct(new Point(p2.x - p1.x, p2.y - p1.y), new Point(p3.x - p2.x, p3.y - p2.y));
  return cp < 0 ? TurnDir.Left : TurnDir.Right;
}

/** Shoelace area (absolute). */
export function areaOfConvexPolygon(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += pt(polygon, i).x * pt(polygon, j).y;
    area -= pt(polygon, i).y * pt(polygon, j).x;
  }
  area /= 2;
  return area < 0 ? -area : area;
}

/** Every turn the same way (no U-turn). */
export function isConvex(points: readonly Point[]): boolean {
  const angleDelta = 0.01;
  let td: TurnDir = TurnDir.NoTurn;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const k = (i + 2) % points.length;
    const tmpTd = getTurnDir(pt(points, i), pt(points, j), pt(points, k), angleDelta);
    if (tmpTd === TurnDir.NoTurn) continue;
    if (tmpTd === TurnDir.UTurn) return false;
    if (td === TurnDir.NoTurn) td = tmpTd;
    else if (td !== tmpTd) return false;
  }
  return true;
}

/** Does the open polyline cross itself (non-adjacent segments)? */
export function hasLoop(points: readonly Point[]): boolean {
  for (let i = 0; i < points.length - 2; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      const seg1 = new LineSegment(pt(points, i), pt(points, i + 1));
      const seg2 = new LineSegment(pt(points, j), pt(points, j + 1));
      if (seg1.getIntersection(seg2) !== null) return true;
    }
  }
  return false;
}

/** `p` as template expressions relative to `bounds` (`"<fx>*w"`, `"<fy>*h"`, C++ number format). */
export function getShapePoint(p: Point, bounds: Rect): { x: string; y: string } {
  let fx = 0;
  let fy = 0;
  if (bounds.width > 0) fx = (p.x - bounds.center().x) / bounds.width;
  if (bounds.height > 0) fy = (p.y - bounds.center().y) / bounds.height;
  return { x: `${formatG6(fx)}*w`, y: `${formatG6(fy)}*h` };
}

// ---- Rectangle operations that need segments (C++ `Rectangle::intersects`, `getDistanceFrom`)

/** Does the segment pt1–pt2 touch `rect` (an end inside, or an edge crossed)? */
export function rectIntersectsSegment(rect: Rect, pt1: Point, pt2: Point): boolean {
  if (rect.contains(pt1) || rect.contains(pt2)) return true;
  const pts = rect.getPoints();
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pt(pts, i);
    const b = pt(pts, j);
    if (a.x === b.x && a.y === b.y) continue;
    if (intersects(a, b, pt1, pt2)) return true;
  }
  return false;
}

/**
 * C++ `Rectangle::intersects(rect)`, kept as is: a corner of either inside the other, or an edge
 * crossing. The C++ edge loop pairs edge i of `a` with the segment from corner j (= i + 1) to
 * corner l (= k + 1) of `b` rather than with edge k (a typo); it is reproduced. Those segments
 * still include every edge of `b` (each against one edge of `a`) and its diagonals.
 */
export function rectIntersects(a: Rect, b: Rect): boolean {
  if (b.width < 0 || b.height < 0) return false;
  if (b.width === 0 && b.height === 0) return false;
  if (b.width === 0) return rectIntersectsSegment(a, new Point(b.x, b.y), new Point(b.x, b.y + b.height));
  if (b.height === 0) return rectIntersectsSegment(a, new Point(b.x, b.y), new Point(b.x + b.width, b.y));
  if (a.height <= 0 || a.width <= 0) return rectIntersects(b, a);
  for (const c of b.getPoints()) if (a.contains(c)) return true;
  for (const c of a.getPoints()) if (b.contains(c)) return true;
  const pts1 = a.getPoints();
  const pts2 = b.getPoints();
  for (let i = 0; i < pts1.length; i++) {
    const j = (i + 1) % pts1.length;
    for (let k = 0; k < pts2.length; k++) {
      const l = (k + 1) % pts2.length;
      if (intersects(pt(pts1, i), pt(pts1, j), pt(pts2, j), pt(pts2, l))) return true;
    }
  }
  return false;
}

/** Distance from `point` to the nearest edge of `rect`, and the nearest point. */
export function rectDistanceFrom(rect: Rect, point: Point): DistanceAndPoint {
  const { x, y, width: w, height: h } = rect;
  const edges: [Point, Point][] = [
    [new Point(x, y), new Point(x, y + h)],
    [new Point(x, y + h), new Point(x + w, y + h)],
    [new Point(x + w, y + h), new Point(x + w, y)],
    [new Point(x + w, y), new Point(x, y)],
  ];
  let dist = 2147483647;
  let minPoint = new Point();
  for (const [p1, p2] of edges) {
    const r = pointLineSegmentDistance(p1, p2, point);
    if (r.dist < dist) {
      dist = r.dist;
      minPoint = r.near;
    }
  }
  return { dist, near: minPoint };
}

/**
 * C++ `Rectangle::quickCheckRectangle`: are the four vertices an axis-aligned rectangle (within
 * 0.2)? If so, also the neighbours of vertex `cur` sharing its x and its y.
 */
export function quickCheckRectangle(vertices: readonly Point[], cur: number): { sameX: number; sameY: number } | null {
  if (vertices.length !== 4) return null;
  const smallDiff = 0.2;
  let lastX: boolean;
  const v = (i: number): Point => pt(vertices, i);
  if (Math.abs(v(0).x - v(1).x) < smallDiff) lastX = true;
  else if (Math.abs(v(0).y - v(1).y) < smallDiff) lastX = false;
  else return null;
  for (let i = 1; i < vertices.length; i++) {
    const j = (i + 1) % 4;
    if (lastX) {
      if (Math.abs(v(i).y - v(j).y) < smallDiff) lastX = false;
      else return null;
    } else if (Math.abs(v(i).x - v(j).x) < smallDiff) {
      lastX = true;
    } else {
      return null;
    }
  }
  let prev = cur - 1;
  let next = cur + 1;
  if (prev < 0) prev = vertices.length - 1;
  if (next === vertices.length) next = 0;
  if (Math.abs(v(prev).x - v(cur).x) < smallDiff) return { sameX: prev, sameY: next };
  return { sameX: next, sameY: prev };
}

/** All of the above as one object, for C++-style `GeoUtil.getDistance(…)` calls. */
export const GeoUtil = Object.freeze({
  rotate,
  rotatePoint,
  rotateAboutMid,
  translate,
  scale,
  scaleAnchored,
  zoomPoints,
  getDistance,
  getAngle,
  getAngle4,
  getSlope,
  getPointLineDistance,
  getAmplitudePointIndex,
  getPointsForArrow,
  isPointInsidePolygon,
  intersectionWithPolygon,
  normalizeAngleInPI,
  normalizeAngleIn2PI,
  normalizeInHalfPI,
  angleWithHorizontal,
  getMidPoint,
  intersects,
  isPointBetween,
  pointLineSegmentDistance,
  getPointAtDistance,
  getPerpendicularEquation,
  toDegreeReadable,
  toDegree,
  toRadian,
  preProcess,
  preProcess2,
  isInvalidPoint,
  getPointsBound,
  crossProduct,
  getTurnDir,
  areaOfConvexPolygon,
  isConvex,
  hasLoop,
  getShapePoint,
  rectIntersects,
  rectIntersectsSegment,
  rectDistanceFrom,
  quickCheckRectangle,
});
