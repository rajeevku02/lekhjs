// The point-level operations the value classes share (distance, rotation, angle normalisation).
// They live here, importing only `Point`, so that the classes and `geo.ts` can both use them
// without an import cycle (spec 01 §3.1 C1). `geo.ts` re-exports them as part of `GeoUtil`.
import { Point } from './point';

/** Euclidean distance. */
export function getDistance(p1: Point, p2: Point): number {
  const x = p2.x - p1.x;
  const y = p2.y - p1.y;
  return Math.sqrt(x * x + y * y);
}

/**
 * C++ `GeoUtil::rotate(points, pivot, angle)`: every point rotated by `angle` radians about
 * `pivot`. A new array; with `angle` 0 or no points, a copy of the input.
 */
export function rotate(points: readonly Point[], pivot: Point, angle: number): Point[] {
  if (angle === 0 || points.length === 0) return points.slice();
  const ret: Point[] = [];
  for (const pt of points) {
    let dx = pt.x - pivot.x;
    let dy = pt.y - pivot.y;
    const ang = Math.atan2(dy, dx);
    const finalAng = ang + angle;
    const dist = getDistance(pt, pivot);
    dy = dist * Math.sin(finalAng);
    dx = dist * Math.cos(finalAng);
    ret.push(new Point(pivot.x + dx, pivot.y + dy));
  }
  return ret;
}

/** C++ `GeoUtil::rotate(point, pivot, angle)`. */
export function rotatePoint(point: Point, pivot: Point, angle: number): Point {
  return rotate([point], pivot, angle)[0] ?? point;
}

/** C++ `GeoUtil::rotate(points, angle)`: about the mean of the points. */
export function rotateAboutMid(points: readonly Point[], angle: number): Point[] {
  if (angle === 0 || points.length === 0) return points.slice();
  let mx = 0;
  let my = 0;
  for (const pt of points) {
    mx += pt.x;
    my += pt.y;
  }
  return rotate(points, new Point(mx / points.length, my / points.length), angle);
}

/** Into (-π, π]. */
export function normalizeAngleInPI(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Into [0, 2π]. */
export function normalizeAngleIn2PI(angle: number): number {
  let a = angle;
  while (a > 2 * Math.PI) a -= 2 * Math.PI;
  while (a < 0) a += 2 * Math.PI;
  return a;
}

/** Into [-π/2, π/2]: the slope of a line, direction ignored. */
export function normalizeInHalfPI(angle: number): number {
  let ang = normalizeAngleInPI(angle);
  if (ang > Math.PI / 2) ang = ang - Math.PI;
  if (ang < -(Math.PI / 2)) ang = Math.PI + ang;
  return ang;
}

export function toDegree(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function toRadian(deg: number): number {
  return (Math.PI * deg) / 180;
}
