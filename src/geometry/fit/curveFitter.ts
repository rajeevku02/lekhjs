// Bézier curve fitting of a point run (port of C++ `fitter::CurveFitObject`, with `FitPoint` and
// `Path` merged in). Only `FitSingle` is live: one cubic through the whole run, Graphics Gems I
// least squares over at most seven sampled points. C++ `int` arithmetic (the chord-length
// approximation, the tangent sampling, the fallback length) is reproduced with truncation.
import { toInt } from '../../base';
import { BezierCurve } from '../bezier';
import { isInvalidPoint } from '../geo';
import { Point } from '../point';

const STEP_SIZE = 6;

/** A 2-D vector with the C++ `FitPoint` operations. */
class FitPoint {
  readonly x: number;
  readonly y: number;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  static of(p: Point): FitPoint {
    return new FitPoint(p.x, p.y);
  }
  add(o: FitPoint): FitPoint {
    return new FitPoint(this.x + o.x, this.y + o.y);
  }
  sub(o: FitPoint): FitPoint {
    return new FitPoint(this.x - o.x, this.y - o.y);
  }
  mul(f: number): FitPoint {
    return new FitPoint(this.x * f, this.y * f);
  }
  /** The same direction with length `newLen` (unchanged when zero). */
  setLength(newLen: number): FitPoint {
    let len = this.length();
    if (len === 0.0) return new FitPoint(this.x, this.y);
    len = newLen / len;
    return new FitPoint(this.x * len, this.y * len);
  }
  squaredLength(): number {
    return this.x * this.x + this.y * this.y;
  }
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  dot(o: FitPoint): number {
    return o.x * this.x + o.y * this.y;
  }
}

function bezier0(u: number): number {
  const t = 1.0 - u;
  return t * t * t;
}
function bezier1(u: number): number {
  const t = 1.0 - u;
  return 3 * u * t * t;
}
function bezier2(u: number): number {
  const t = 1.0 - u;
  return 3 * u * u * t;
}
function bezier3(u: number): number {
  return u * u * u;
}

export class CurveFitter {
  /** The fitted curves (C++ `Path::bzCurves` of the output path). */
  readonly curves: BezierCurve[] = [];
  /** C++ `Error`: the accuracy of the fit (unused by `fitSingle`, kept for the callers' 70). */
  readonly error: number;
  private points: readonly Point[] = [];
  private distances: number[] = [];
  private totalCoords = 0;

  constructor(maxError: number) {
    this.error = maxError;
  }

  /** One cubic fitted through `points` (the C++ call sequence `Initialise` + `FitSingle`). */
  static fitSingle(points: readonly Point[], maxError = 70): BezierCurve[] {
    const f = new CurveFitter(maxError);
    f.initialise(points, points.length);
    f.fitSingle();
    return f.curves;
  }

  /** Takes the first `numPoints` points; false (and nothing to fit) below two. */
  initialise(points: readonly Point[], numPoints: number): boolean {
    this.points = points;
    if (numPoints < 2) {
      this.points = [];
      return false;
    }
    // Chord lengths by an integer approximation of the square root (C++ `int` arithmetic).
    const d: number[] = [0];
    for (let i = 1; i < numPoints; i++) {
      const a = this.at(i);
      const b = this.at(i - 1);
      const dx = toInt(Math.abs(a.x - b.x));
      const dy = toInt(Math.abs(a.y - b.y));
      const min = dx > dy ? dy >> 1 : dx >> 1;
      d.push((d[i - 1] ?? 0) + dx + dy - min);
    }
    this.distances = d;
    this.totalCoords = numPoints;
    return true;
  }

  /** Fits one cubic to all the points (needs at least eight). */
  fitSingle(): void {
    if (this.totalCoords < 8) return;
    let err = toInt(this.totalCoords / 12.0);
    if (err === 0) err = 1;
    const p1 = this.at(0);
    const p2 = this.at(err);
    const p3 = this.at(this.totalCoords - err - 1);
    const p4 = this.at(this.totalCoords - 1);
    const tangent1 = new FitPoint(p2.x - p1.x, p2.y - p1.y);
    const tangent2 = new FitPoint(p3.x - p4.x, p3.y - p4.y);
    this.insertBezier(this.generateBezier(0, this.totalCoords - 1, tangent1, tangent2));
  }

  private at(i: number): Point {
    const p = this.points[i];
    if (p === undefined) throw new RangeError(`point ${String(i)} out of range`);
    return p;
  }

  private dist(i: number): number {
    return this.distances[i] ?? 0;
  }

  private generateBezier(first: number, last: number, tangent1: FitPoint, tangent2: FitPoint): FitPoint[] {
    const numPoints = last - first + 1;
    const A: [FitPoint, FitPoint][] = [];
    const offsets: number[] = [];
    const step = toInt((numPoints + STEP_SIZE) / STEP_SIZE);
    const distToEnd = this.dist(last) - this.dist(first);
    for (let i = first; i < last + 1; i += step) {
      const off = (this.dist(i) - this.dist(first)) / distToEnd;
      offsets.push(off);
      A.push([tangent1.setLength(bezier1(off)), tangent2.setLength(bezier2(off))]);
    }

    let c00 = 0.0;
    let c01 = 0.0;
    let c11 = 0.0;
    let x0 = 0.0;
    let x1 = 0.0;
    const firstCoord = FitPoint.of(this.at(first));
    const lastCoord = FitPoint.of(this.at(last));
    let pos = 0;
    for (let i = 0; i < numPoints; i += step) {
      const [a0, a1] = A[pos] ?? [new FitPoint(), new FitPoint()];
      const off = offsets[pos] ?? 0;
      c00 += a0.squaredLength();
      c01 += a0.dot(a1);
      c11 += a1.squaredLength();
      const thisCoord = FitPoint.of(this.at(first + i));
      const combo = thisCoord.sub(
        firstCoord
          .mul(bezier0(off))
          .add(firstCoord.mul(bezier1(off)))
          .add(lastCoord.mul(bezier2(off)))
          .add(lastCoord.mul(bezier3(off))),
      );
      x0 += a0.dot(combo);
      x1 += a1.dot(combo);
      pos++;
    }
    const c10 = c01;
    let detC0C1 = c00 * c11 - c10 * c01;
    const detC0X = c00 * x1 - c01 * x0;
    const detXC1 = x0 * c11 - x1 * c01;
    if (detC0C1 === 0.0) detC0C1 = c00 * c11 * 10e-12;
    const alphaLeft = detXC1 / detC0C1;
    const alphaRight = detC0X / detC0C1;

    const b0 = FitPoint.of(this.at(first));
    const b3 = FitPoint.of(this.at(last));
    if (alphaLeft < 0.0 || alphaRight < 0.0) {
      // a third of the chord length, in C++ int arithmetic
      const distance = toInt((this.dist(last) - this.dist(first)) / 3);
      return [b0, b0.add(tangent1.setLength(distance)), b3.add(tangent2.setLength(distance)), b3];
    }
    return [b0, b0.add(tangent1.setLength(alphaLeft)), b3.add(tangent2.setLength(alphaRight)), b3];
  }

  private insertBezier(bz: FitPoint[]): void {
    const p = bz.map((b) => new Point(b.x, b.y));
    const [a, b, c, d] = p;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    const curve = new BezierCurve(a, b, c, d, 4);
    if (!(isInvalidPoint(a) || isInvalidPoint(b) || isInvalidPoint(c) || isInvalidPoint(d))) {
      this.curves.push(curve);
    }
  }
}
