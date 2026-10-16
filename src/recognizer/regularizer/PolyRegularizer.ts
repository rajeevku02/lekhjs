// The feature-matching base of the 2-to-8-line regularizers (port of C++
// `regularizer::PolyRegularizer`). A subclass lists candidate figures ("features", point lists
// built on the path's bounds); every feature is matched to the path's vertices by greedy
// nearest-pair assignment, and the cheapest accepted one replaces the path.
//
// Port notes (spec 07):
//  - B5: `findMin` keeps its best distance in a C++ `int`, so every pair cost is truncated
//    toward zero and a later pair only wins when it is below that truncated value. Replicated
//    with `Math.trunc`.
//  - B6: `match` loops until every feature point is used; when no unused pair is left (fewer
//    path points than feature points, or NaN distances) C++ never terminates. Here the loop is
//    bounded by feature.length × points.length and exceeding it throws `RecInternalError`.
//  - B7: the unsigned `size() - 1` loops have explicit empty guards.
//  - B8: the open-path sort is by feature index, which is unique; ties cannot occur.
import { getDistance, PathComponent, Point, Rect, type SimplePath } from '../../geometry';
import { at, RecInternalError } from '../lines/RecognizerUtil';
import { PolyLineRegularizer } from './PolyLineRegularizer';

/** One candidate figure: its vertices in path order. */
export type Feature = Point[];

/** C++ `INT_MAX`, the initial cost and best distance. */
const INT_MAX = 2147483647;

/** The open-path cost of a feature whose points match out of order (C++ "a big number"). */
const OUT_OF_ORDER_COST = 5000;

/** `regularize` result when the subclass offers no feature (the open path went to PolyLine). */
export const NO_FEATURES = -2;
/** `regularize` result when no feature was accepted (the path is unchanged). */
export const NONE_ACCEPTED = -1;

export abstract class PolyRegularizer {
  protected rect: Rect = new Rect();
  protected width = 0;
  protected height = 0;
  protected points: Point[] = [];
  protected closed = false;
  protected origPolyPoints: readonly Point[] = [];
  private readonly usedIndices1 = new Set<number>();
  private readonly usedIndices2 = new Set<number>();

  /**
   * C++ `regularize(path, pts)`: rewrites `path` in place with the best accepted feature.
   * Returns the chosen feature index, `NONE_ACCEPTED`, or `NO_FEATURES` (C++ returns nothing;
   * the index is for tracing and the goldens).
   */
  regularize(path: SimplePath, pts: readonly Point[]): number {
    this.origPolyPoints = pts.slice();
    this.init(path);

    const features: Feature[] = [];
    this.getFeatures(features);

    if (features.length === 0) {
      if (!this.closed) new PolyLineRegularizer().regularize(path);
      return NO_FEATURES;
    }

    // C++ also tracks the overall minimum cost, only for a commented-out log line.
    let cost = INT_MAX;
    let minIdx = -1;
    for (let idx = 0; idx < features.length; idx++) {
      const cst = this.match(at(features, idx), this.points);
      if (this.canAccept(idx, cst)) {
        if (cst < cost) {
          cost = cst;
          minIdx = idx;
        }
      }
    }

    if (minIdx >= 0) {
      const feature = at(features, minIdx);
      this.convertAfterDetection(minIdx, feature);
      path.clear();
      for (let i = 0; i + 1 < feature.length; i++) {
        path.push(PathComponent.line(at(feature, i), at(feature, i + 1)));
      }
      if (this.closed) {
        path.push(PathComponent.line(at(feature, feature.length - 1), at(feature, 0)));
      }
    }
    return minIdx;
  }

  /** Appends the candidate figures (C++ default: none; every subclass overrides it). */
  protected abstract getFeatures(result: Feature[]): void;

  /** Whether feature `fid` may be used at cost `cost` (C++ default: never; every subclass overrides it). */
  protected abstract canAccept(fid: number, cost: number): boolean;

  /** Rewrites the chosen feature in place before it replaces the path (nothing by default). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ default ignores its arguments
  protected convertAfterDetection(_fid: number, _feature: Feature): void {
    // C++ default: unchanged.
  }

  protected mid(p1: Point, p2: Point): Point {
    return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  }

  protected xval(ratio: number): number {
    return this.rect.x + this.width * ratio;
  }

  protected yval(ratio: number): number {
    return this.rect.y + this.height * ratio;
  }

  private init(path: SimplePath): void {
    this.rect = path.bound();
    this.closed = path.closed();
    this.points = path.points([]);
    this.width = this.rect.width;
    if (this.width < 1) this.width = 1;
    this.height = this.rect.height;
    if (this.height < 1) this.height = 1;
  }

  private match(feature: Feature, points: readonly Point[]): number {
    this.usedIndices1.clear();
    this.usedIndices2.clear();

    let sum = 0;
    const matchedIdx: [number, number][] = [];
    const limit = feature.length * points.length; // B6
    let steps = 0;
    while (this.usedIndices1.size < feature.length) {
      if (++steps > limit) {
        throw new RecInternalError(
          `PolyRegularizer.match: no unused pair after ${String(limit)} steps (C++ loops forever)`,
        );
      }
      const pr = this.findMin(feature, points);
      sum += pr.cost;
      this.usedIndices1.add(pr.i1);
      this.usedIndices2.add(pr.i2);
      matchedIdx.push([pr.i1, pr.i2]);
    }

    if (!this.closed) {
      // B8: the feature indices are distinct, so this order is total.
      matchedIdx.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < matchedIdx.length; i++) {
        if (Math.abs(at(matchedIdx, i)[1] - at(matchedIdx, i + 1)[1]) > 1) return OUT_OF_ORDER_COST;
      }
    }

    return sum / (this.width * this.height);
  }

  /** The nearest unused pair; its cost is the C++ `int` distance (B5). */
  private findMin(set1: readonly Point[], set2: readonly Point[]): { i1: number; i2: number; cost: number } {
    let i1 = 0;
    let i2 = 0;
    let d0 = INT_MAX;
    for (let i = 0; i < set1.length; i++) {
      if (this.usedIndices1.has(i)) continue;
      for (let j = 0; j < set2.length; j++) {
        if (this.usedIndices2.has(j)) continue;
        const d = getDistance(at(set1, i), at(set2, j));
        if (d < d0) {
          i1 = i;
          i2 = j;
          d0 = Math.trunc(d);
        }
      }
    }
    return { i1, i2, cost: d0 };
  }
}
