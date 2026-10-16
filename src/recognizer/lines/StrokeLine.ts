// A stroke line and its parts (port of C++ `recognizer/Line.{h,cpp}`: `Line`, `LinePart`, `Parts`,
// `LinePoint`, `ExtensionPoint`). `recognizer::Line` is renamed `StrokeLine` (OQ-08).
//
// `StrokeLine` keeps its points as a `Span<Point>` (C++ `geometry::Points`, a `base::Coll`; OQ-10)
// over the stroke's pre-processed point array. The span is copied in, so a line never aliases a
// span someone else may move. `LinePart`, `LinePoint` and `ExtensionPoint` are immutable values:
// where C++ assigns `part.start = …; part.computeT()`, TS builds a new part (`withStart`, `withEnd`).
import { INT_MAX, Span } from '../../base';
import { getDistance, LineSegment, type Point } from '../../geometry';
import { RangeNumber } from './RangeNumber';

/** C++ `geometry::Points`: an inclusive index range over a point array. */
export type Points = Span<Point>;

/** A copy of `pts` (same array, same range). */
export function copyPoints(pts: Points): Points {
  return new Span(pts.items, pts.startIndex, pts.endIndex);
}

/** C++ `Line::SegmentDir`. */
export const SegmentDir = Object.freeze({ Forward: 0, Backward: 1 } as const);
export type SegmentDir = (typeof SegmentDir)[keyof typeof SegmentDir];

/**
 * One line of a stroke: a contiguous run of the stroke's points, its fitting cost, and (for a line
 * made by `merge`) the two lines it was merged from. `id` is assigned by `LineColl.addLines`
 * (1, 2, … in drawing order); `gid` is free for the line aggregator's own use.
 */
export class StrokeLine {
  private pts: Points;
  readonly cost: RangeNumber;
  readonly subLines: readonly StrokeLine[];
  /** 1-based position in the stroke's `LineColl` (0 until added). */
  id = 0;
  /** Group id, for the line aggregator (C++ `gid`); 0 by default. */
  gid = 0;

  constructor(points: Points, cost: RangeNumber = new RangeNumber(), subLines: readonly StrokeLine[] = []) {
    this.pts = copyPoints(points);
    this.cost = cost;
    this.subLines = subLines;
  }

  /** The line's points. Do not mutate the returned span; use the setters below. */
  points(): Points {
    return this.pts;
  }

  /** C++ `points(const Points&)`: replace the range. */
  setPoints(points: Points): void {
    this.pts = copyPoints(points);
  }

  setPointsStartIndex(idx: number): void {
    this.pts.setStartIndex(idx);
  }

  setPointsEndIndex(idx: number): void {
    this.pts.setEndIndex(idx);
  }

  firstPoint(): Point {
    return this.pts.first();
  }

  lastPoint(): Point {
    return this.pts.last();
  }

  /** Forward when `start` is not farther from the first point than `end` is. */
  getSegmentDir(start: Point, end: Point): SegmentDir {
    const d1 = getDistance(start, this.firstPoint());
    const d2 = getDistance(end, this.firstPoint());
    return d1 <= d2 ? SegmentDir.Forward : SegmentDir.Backward;
  }

  /**
   * C++ `Line::merge`: one line over `first`'s start to `second`'s end (same point array), with the
   * two as its sub-lines.
   */
  static merge(first: StrokeLine, second: StrokeLine, cost: RangeNumber): StrokeLine {
    const pts = new Span(first.pts.items, first.pts.startIndex, second.pts.endIndex);
    return new StrokeLine(pts, cost, [first, second]);
  }
}

/** The parameters of `start`/`end` along the line's chord (0 and 1 for a near-zero chord). */
function computeT(line: StrokeLine, start: Point, end: Point): { t1: number; t2: number } {
  const dist = getDistance(line.firstPoint(), line.lastPoint());
  if (dist > 0.01) {
    return { t1: getDistance(line.firstPoint(), start) / dist, t2: getDistance(line.firstPoint(), end) / dist };
  }
  return { t1: 0, t2: 1 };
}

/** C++ `LinePart`: the sub-range `start`→`end` of a line, as one side of a poly. Immutable. */
export class LinePart {
  readonly line: StrokeLine;
  readonly start: Point;
  readonly end: Point;
  readonly t1: number;
  readonly t2: number;

  /** With no points, the whole line (first to last point). */
  constructor(line: StrokeLine, start?: Point, end?: Point) {
    this.line = line;
    this.start = start ?? line.points().first();
    this.end = end ?? line.points().last();
    const t = computeT(line, this.start, this.end);
    this.t1 = t.t1;
    this.t2 = t.t2;
  }

  withStart(start: Point): LinePart {
    return new LinePart(this.line, start, this.end);
  }

  withEnd(end: Point): LinePart {
    return new LinePart(this.line, this.start, end);
  }

  /**
   * C++ `LinePart::equals`: same line id, and the two ends within `delta` of the other's ends
   * in either direction. `delta` is `RecognizerConfig.linePartEqualityDelta`.
   */
  equals(other: LinePart, delta: number): boolean {
    if (this.line.id !== other.line.id) return false;
    const d1 = getDistance(this.start, other.start);
    const d2 = getDistance(this.start, other.end);
    const d3 = getDistance(this.end, other.start);
    const d4 = getDistance(this.end, other.end);
    return (d1 < delta && d4 < delta) || (d2 < delta && d3 < delta);
  }

  /**
   * C++ `LinePart::points`: the line's points nearest `start` and `end`, as a span in index order,
   * and whether the part runs against that order.
   */
  points(): { points: Points; reverse: boolean } {
    const pts = this.line.points();
    let startIndex = 0;
    const last = pts.size - 1;
    let endIndex = last;
    let dist1 = getDistance(this.line.firstPoint(), this.start);
    let dist2 = getDistance(this.line.lastPoint(), this.end);
    for (let cur = 0; cur <= last; cur++) {
      const p = pts.at(cur);
      let tmp = getDistance(p, this.start);
      if (tmp < dist1) {
        dist1 = tmp;
        startIndex = cur;
      }
      tmp = getDistance(p, this.end);
      if (tmp < dist2) {
        dist2 = tmp;
        endIndex = cur;
      }
    }
    let reverse = false;
    if (endIndex < startIndex) {
      [startIndex, endIndex] = [endIndex, startIndex];
      reverse = true;
    }
    return { points: pts.slice(startIndex, endIndex), reverse };
  }

  /** C++ `LinePart::overlapSize`: the length the two parts of one line share (0 otherwise). */
  overlapSize(other: LinePart): number {
    if (other.line.id !== this.line.id || other.line.gid !== this.line.gid) return 0;
    const seg1 = new LineSegment(this.start, this.end);
    const seg2 = new LineSegment(other.start, other.end);
    if (seg1.inRange(other.start)) {
      if (seg1.inRange(other.end)) return getDistance(other.start, other.end);
      const d1 = getDistance(this.start, other.end);
      const d2 = getDistance(this.end, other.end);
      if (d1 < d2) return getDistance(this.start, other.start);
      return getDistance(this.end, other.start);
    } else if (seg1.inRange(other.end)) {
      // C++ re-tests seg1.inRange(other.start) here; it is false on this branch.
      const d1 = getDistance(this.start, other.start);
      const d2 = getDistance(this.end, other.start);
      if (d1 < d2) return getDistance(this.start, other.end);
      return getDistance(this.end, other.end);
    } else if (seg2.inRange(this.start) && seg2.inRange(this.end)) {
      return getDistance(this.start, this.end);
    }
    return 0;
  }

  /**
   * C++ `LinePart::getSegments`: the part as segments, descending into sub-lines whose cost start
   * exceeds `cost`; appended to `out` in the part's direction.
   */
  getSegments(out: LineSegment[], cost: number): void {
    const lines: StrokeLine[] = [];
    const addLine = (cur: StrokeLine): void => {
      if (cur.cost.start > cost && cur.subLines.length > 0) {
        for (const ln of cur.subLines) addLine(ln);
      } else {
        lines.push(cur);
      }
    };
    addLine(this.line);

    let startIndex = -1;
    let endIndex = -1;
    let startDist = INT_MAX;
    let endDist = INT_MAX;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i] as StrokeLine;
      const seg = new LineSegment(ln.firstPoint(), ln.lastPoint());
      let tmp = seg.getDistanceFrom(this.start).dist;
      if (tmp < startDist) {
        startIndex = i;
        startDist = tmp;
      }
      tmp = seg.getDistanceFrom(this.end).dist;
      if (tmp < endDist) {
        endIndex = i;
        endDist = tmp;
      }
    }
    let curIndex = startIndex;
    if (curIndex < endIndex) {
      while (curIndex <= endIndex) {
        const ln = lines[curIndex] as StrokeLine;
        const p1 = curIndex === startIndex ? this.start : ln.firstPoint();
        const p2 = curIndex === endIndex ? this.end : ln.lastPoint();
        out.push(new LineSegment(p1, p2));
        curIndex++;
      }
    } else if (curIndex > endIndex) {
      while (curIndex >= endIndex) {
        const ln = lines[curIndex] as StrokeLine;
        const p1 = curIndex === startIndex ? this.start : ln.lastPoint();
        const p2 = curIndex === endIndex ? this.end : ln.firstPoint();
        out.push(new LineSegment(p1, p2));
        curIndex--;
      }
    } else {
      out.push(new LineSegment(this.start, this.end));
    }
  }

  dir(): SegmentDir {
    return this.line.getSegmentDir(this.start, this.end);
  }

  length(): number {
    return getDistance(this.start, this.end);
  }
}

/** One used range `[first, second]` of a line (C++ `std::pair<Point, Point>`). */
export type PartRange = readonly [Point, Point];

/** C++ `Parts`: the ranges of one line already used by a taken-out poly. */
export class Parts {
  parts: PartRange[] = [];

  /**
   * C++ `Parts::split`: what is left of `lp` once the used ranges are cut out, as parts longer
   * than 2 px.
   */
  split(lp: LinePart): LinePart[] {
    const result: LinePart[] = [];
    if (this.parts.length === 0) {
      result.push(lp);
      return result;
    }
    const tmp = new Parts();
    tmp.parts = this.parts.slice();
    tmp.combine(lp);

    const delta = 2.0;
    const add = (a: Point, b: Point): void => {
      if (getDistance(a, b) > delta) result.push(new LinePart(lp.line, a, b));
    };
    const near = (a: Point, b: Point): boolean => getDistance(a, b) <= delta;

    let lastPoint = lp.start;
    const seg = new LineSegment(lp.start, lp.end);
    for (const [first, second] of tmp.parts) {
      if (seg.inRange(second)) {
        if (seg.inRange(first)) add(lastPoint, first);
        lastPoint = second;
      } else if (seg.inRange(first)) {
        add(lastPoint, first);
        lastPoint = second;
        break;
      } else {
        const seg2 = new LineSegment(first, second);
        if (
          seg2.inRange(lp.start) ||
          seg2.inRange(lp.end) ||
          (near(seg2.point1(), lp.start) && near(seg2.point2(), lp.end))
        ) {
          lastPoint = second;
          break;
        }
      }
    }
    if (seg.inRange(lastPoint) || near(lp.start, lastPoint)) add(lastPoint, lp.end);
    return result;
  }

  /**
   * C++ `Parts::combine`: orient every range like `ctx`, sort by distance from `ctx.start` (a
   * stable sort: ties keep their order, B8), and merge overlapping ranges.
   */
  combine(ctx: LinePart): void {
    const forward = ctx.dir() === SegmentDir.Forward;
    const lineFirst = ctx.line.firstPoint();
    const oriented = this.parts.map(([a, b]): PartRange => {
      const d1 = getDistance(lineFirst, a);
      const d2 = getDistance(lineFirst, b);
      if (forward ? d2 < d1 : d2 > d1) return [b, a];
      return [a, b];
    });
    const keyed = oriented.map((r) => ({ r, d: getDistance(ctx.start, r[0]) }));
    keyed.sort((a, b) => a.d - b.d);
    const sorted = keyed.map((k) => k.r);

    const combined: PartRange[] = [];
    let idx = 0;
    const delta = 0.1;
    while (idx < sorted.length) {
      const cur = sorted[idx] as PartRange;
      const first = cur[0];
      let second = cur[1];
      let next = idx + 1;
      while (next < sorted.length) {
        const n = sorted[next] as PartRange;
        const d1 = getDistance(first, second);
        const d2 = getDistance(first, n[0]);
        if (d2 <= d1 + delta) {
          second = n[1];
          next++;
        } else {
          break;
        }
      }
      combined.push([first, second]);
      idx = next;
    }
    this.parts = combined;
  }
}

/** C++ `LinePoint`: a point on a line and its parameter along the chord. Immutable. */
export class LinePoint {
  readonly line: StrokeLine;
  readonly point: Point;
  readonly t: number;

  /** With no point, the line's first point. */
  constructor(line: StrokeLine, point?: Point) {
    this.line = line;
    this.point = point ?? line.points().first();
    const dist = getDistance(line.firstPoint(), line.lastPoint());
    this.t = dist > 0.01 ? getDistance(line.firstPoint(), this.point) / dist : 0;
  }
}

/**
 * C++ `ExtensionPoint`: an end of a poly to extend from. `towards` is -1 at the poly's first end,
 * +1 at its last end (0: no direction; the in-order search then falls back to all-nearby).
 */
export interface ExtensionPoint {
  readonly linePoint: LinePoint;
  readonly towards: number;
}
