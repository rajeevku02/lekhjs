// The corner relation of two consecutive line parts and the smoothing factors built from it
// (port of C++ `recognizer::LineRelation`). The two C++ statics of `LineAggregator` it calls
// (`getCost`, `isSingleLine`) come from the injected `LineAggregatorModule` (AC-REC-06): this file
// has no import of a concrete aggregator.
import { Span } from '../../base';
import { getAngle, getDistance, LineSegment, type Point } from '../../geometry';
import type { LineAggregatorModule } from './LineAggregatorModule';
import { getErrSize } from './RecognizerUtil';
import type { LinePart, Points } from './StrokeLine';

/** C++ `addPoints`: `points[from..to]`, counted from the far end when `reverse`. */
function addPoints(into: Point[], points: Points, reverse: boolean, from: number, to: number): void {
  const size = points.size;
  for (let f = from; f <= to && f < size; f++) {
    const idx = reverse ? size - 1 - f : f;
    if (idx >= 0 && idx < size) into.push(points.at(idx));
  }
}

/** The nearest point to `pt` on the part's chord. */
function pointOnLine(part: LinePart, pt: Point): Point {
  return new LineSegment(part.start, part.end).getDistanceFrom(pt).near;
}

/** C++ `(int)` of a non-negative count. */
function toIntCount(v: number): number {
  return Math.trunc(v);
}

export class LineRelation {
  private readonly line1: LinePart;
  private readonly line2: LinePart;
  private readonly agg: LineAggregatorModule;
  numPointsForProcess = 0;
  stepProcessed = 0;
  lineProcessed: LineSegment = new LineSegment();

  constructor(line1: LinePart, line2: LinePart, agg: LineAggregatorModule) {
    this.line1 = line1;
    this.line2 = line2;
    this.agg = agg;
  }

  /**
   * Grows a window across the corner (the end of part 1 and the start of part 2) step by step
   * while one straight line still fits it no worse than either line's own cost; yields the
   * number of steps (`process`) or the joined segment (`process2`).
   */
  private grow(onStep: (first: Point, last: Point) => void): void {
    const pair1 = this.line1.points();
    const pair2 = this.line2.points();
    const points1 = pair1.points;
    const points2 = pair2.points;
    const minp = Math.min(points1.size, points2.size);
    this.numPointsForProcess = 2 * minp;
    this.stepProcessed = 0;
    let step = toIntCount(getErrSize(minp));
    if (step === 0) step = 1;
    if (minp === 0) return;

    // Build the largest window once (what the inc = minp iteration would produce): the last minp
    // points of part 1, then points 0..minp of part 2. C++ takes part 2's points 0..inc inclusive
    // (LineRelation.cpp:69 and :184, addPoints(.., 0, inc)), so the window holds inc + 1 of them
    // and the inc = minp step reaches point minp when part 2 has more than minp points. Every
    // smaller inc is a contiguous sub-range [mid - inc, mid + inc] of it.
    const buf: Point[] = [];
    addPoints(buf, points1, pair1.reverse, points1.size - minp, points1.size - 1);
    const mid = buf.length; // == minp; boundary between the two segments
    addPoints(buf, points2, pair2.reverse, 0, minp);
    const lastIdx = buf.length - 1;

    for (let inc = step; inc <= minp; inc += step) {
      const lo = Math.max(mid - inc, 0);
      const hi = Math.min(mid + inc, lastIdx);
      const cost = this.agg.getCost(new Span(buf, lo, hi));
      if (cost.greaterThan(this.line1.line.cost).boolValue() && cost.greaterThan(this.line2.line.cost).boolValue()) {
        break;
      }
      onStep(buf[lo] as Point, buf[hi] as Point);
    }
  }

  /** C++ `process()`: count the steps the join can grow (`stepProcessed`). */
  process(): void {
    this.grow(() => {
      this.stepProcessed++;
    });
  }

  /** C++ `process2()`: the longest join that still fits, as `lineProcessed`. */
  process2(): void {
    const pair1 = this.line1.points();
    let tmpFirst = pair1.reverse ? pair1.points.first() : pair1.points.last();
    let tmpLast = tmpFirst;
    this.grow((first, last) => {
      tmpFirst = first;
      tmpLast = last;
    });
    this.lineProcessed = new LineSegment(pointOnLine(this.line1, tmpFirst), pointOnLine(this.line2, tmpLast));
  }

  /**
   * C++ `getSmoothingFactor`: the points-weighted share of each corner that one straight line
   * can bridge (1 for one part, or when every corner is a single line).
   */
  static getSmoothingFactor(entities: readonly LinePart[], agg: LineAggregatorModule): number {
    if (entities.length <= 1) return 1;
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < entities.length - 1; i++) {
      const a = entities[i] as LinePart;
      const b = entities[i + 1] as LinePart;
      if (agg.isSingleLine(a, b)) continue;
      const rel = new LineRelation(a, b, agg);
      rel.process();
      sum += rel.numPointsForProcess;
      wsum += rel.numPointsForProcess * rel.stepProcessed;
    }
    // Not processed: all single lines.
    if (sum === 0) return 1;
    return wsum / (sum * 12);
  }

  /** C++ `getSmoothingFactor2`: the angle-weighted share of the parts' length the joins cover. */
  static getSmoothingFactor2(entities: readonly LinePart[], agg: LineAggregatorModule): number {
    if (entities.length <= 1) return 1;
    interface CornerInfo {
      len1: number;
      len2: number;
      part1: number;
      part2: number;
      angle: number;
    }
    const corners: CornerInfo[] = [];
    for (let i = 0; i < entities.length - 1; i++) {
      const a = entities[i] as LinePart;
      const b = entities[i + 1] as LinePart;
      const rel = new LineRelation(a, b, agg);
      rel.process2();
      const ci: CornerInfo = {
        len1: new LineSegment(a.start, a.end).length(),
        len2: new LineSegment(b.start, b.end).length(),
        angle: getAngle(a.start, b.start, b.end),
        part1: 0,
        part2: 0,
      };
      if (rel.lineProcessed.length() > 0.1) {
        const mid = a.end;
        ci.part1 = getDistance(rel.lineProcessed.point1(), mid);
        ci.part2 = getDistance(mid, rel.lineProcessed.point2());
      }
      corners.push(ci);
    }
    for (let i = 0; i < corners.length - 1; i++) {
      const cur = corners[i] as CornerInfo;
      const next = corners[i + 1] as CornerInfo;
      const len = cur.len2;
      const join1 = cur.part2;
      const join2 = next.part1;
      if (join1 + join2 > len) {
        if (cur.angle > next.angle) next.part1 = len - join1;
        else cur.part2 = len - join2;
      }
    }
    let totalLen = 0;
    let weightedSum = 0;
    let angleSum = 0;
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i] as CornerInfo;
      totalLen += c.len1;
      if (i === corners.length - 1) totalLen += c.len2;
      weightedSum += (c.part1 + c.part2) * c.angle;
      angleSum += c.angle;
    }
    if (angleSum < 0.1 || totalLen < 0.1) return 1;
    return (weightedSum * corners.length) / (angleSum * totalLen);
  }
}
