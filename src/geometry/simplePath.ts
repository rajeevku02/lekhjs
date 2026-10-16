// A path of line and cubic steps (port of C++ `geometry::SimplePath`, `PathComponent` and
// `PathStep`), used by connectors and the recognizer. Mutable like the C++ classes; copy with
// `clone()` where C++ copies by value.
import { BezierCurve } from './bezier';
import { LineSegment } from './lineSegment';
import { Point } from './point';
import { getDistance } from './primitives';
import { Rect } from './rect';

/** One step of a path: a segment, or a cubic when `isCurve`. */
export class PathComponent {
  isCurve: boolean;
  segment: LineSegment;
  curve: BezierCurve;

  constructor(isCurve = false, segment = new LineSegment(), curve = new BezierCurve()) {
    this.isCurve = isCurve;
    this.segment = segment;
    this.curve = curve;
  }

  static line(p1: Point, p2: Point): PathComponent {
    return new PathComponent(false, new LineSegment(p1, p2));
  }

  static ofSegment(seg: LineSegment): PathComponent {
    return new PathComponent(false, seg);
  }

  static ofCurve(curve: BezierCurve): PathComponent {
    return new PathComponent(true, new LineSegment(), curve);
  }

  clone(): PathComponent {
    return new PathComponent(this.isCurve, this.segment, this.curve.clone());
  }

  firstPoint(): Point {
    return this.isCurve ? this.curve.point1 : this.segment.p1;
  }

  lastPoint(): Point {
    return this.isCurve ? this.curve.point4 : this.segment.p2;
  }

  /** The step as segments: itself, or the curve's `approxLines`. */
  lines(result: LineSegment[] = []): LineSegment[] {
    if (!this.isCurve) result.push(this.segment);
    else this.curve.approxLines(result);
    return result;
  }

  setFirstPoint(pt: Point): void {
    if (this.isCurve) this.curve.point1 = pt;
    else this.segment = this.segment.withPoint1(pt);
  }

  setLastPoint(pt: Point): void {
    if (this.isCurve) this.curve.point4 = pt;
    else this.segment = this.segment.withPoint2(pt);
  }

  /** The parts of the step outside `rect` (C++ `PathComponent::clip`), appended to `result`. */
  clip(rect: Rect, result: PathComponent[] = []): PathComponent[] {
    const addCurve = (start: number, end: number): void => {
      result.push(PathComponent.ofCurve(this.curve.subCurve(start, end)));
    };
    const addSeg = (p1: Point, p2: Point): void => {
      result.push(PathComponent.line(p1, p2));
    };
    if (this.isCurve) {
      const ranges = this.curve.clip(rect);
      if (ranges.length === 0) {
        result.push(this.clone());
      } else {
        let last = 0;
        for (const r of ranges) {
          if (last !== r.start && r.start > 0) addCurve(last, r.start);
          last = r.end;
        }
        if (last !== 1) addCurve(last, 1);
      }
    } else {
      const clipped = this.segment.clip(rect);
      let last = this.segment.p1;
      const close = (p1: Point, p2: Point): boolean => getDistance(p1, p2) < 1.0;
      if (clipped.length > 0) {
        for (const c of clipped) {
          if (!close(last, c.p1)) addSeg(last, c.p1);
          last = c.p2;
        }
        if (!close(last, this.segment.p2)) addSeg(last, this.segment.p2);
      } else {
        addSeg(this.segment.p1, this.segment.p2);
      }
    }
    return result;
  }
}

/** C++ `PathStep::Type`. */
export const PathStepType = Object.freeze({ Move: 0, Line: 1, Quad: 2, Cubic: 3, Arc: 4, Close: 5 } as const);
export type PathStepType = (typeof PathStepType)[keyof typeof PathStepType];

/** A drawing step (C++ `PathStep`): what each field means depends on `type`. */
export interface PathStep {
  type: PathStepType;
  p1: Point;
  p2: Point;
  p3: Point;
  val1: number;
  val2: number;
  val3: number;
  flag1: boolean;
}

/** A `PathStep` with every field zeroed. */
export function pathStep(type: PathStepType, p1 = new Point()): PathStep {
  return { type, p1, p2: new Point(), p3: new Point(), val1: 0, val2: 0, val3: 0, flag1: false };
}

export class SimplePath {
  private components_: PathComponent[] = [];
  private closed_ = false;

  clone(): SimplePath {
    const p = new SimplePath();
    p.components_ = this.components_.map((c) => c.clone());
    p.closed_ = this.closed_;
    return p;
  }

  get components(): readonly PathComponent[] {
    return this.components_;
  }
  get size(): number {
    return this.components_.length;
  }
  closed(): boolean {
    return this.closed_;
  }
  setClosed(val: boolean): void {
    this.closed_ = val;
  }

  /** Component `idx` (throws outside the path). */
  at(idx: number): PathComponent {
    const c = this.components_[idx];
    if (c === undefined) throw new RangeError(`SimplePath index ${String(idx)} out of range`);
    return c;
  }
  front(): PathComponent {
    return this.at(0);
  }
  back(): PathComponent {
    return this.at(this.components_.length - 1);
  }

  push(pc: PathComponent): void {
    this.components_.push(pc);
  }

  /** C++ `add(p1, p2)`: a line step. */
  addLine(p1: Point, p2: Point): void {
    this.components_.push(PathComponent.line(p1, p2));
  }
  addSegment(seg: LineSegment): void {
    this.components_.push(PathComponent.ofSegment(seg));
  }
  addCurve(curve: BezierCurve): void {
    this.components_.push(PathComponent.ofCurve(curve));
  }

  /** Inserts the components of `path` before index `idx`. */
  insert(idx: number, path: SimplePath): void {
    this.components_.splice(idx, 0, ...path.components_);
  }

  clear(): void {
    this.components_ = [];
  }
  reset(): void {
    this.components_ = [];
    this.closed_ = false;
  }

  /** The length of the segment approximation. */
  length(): number {
    let len = 0;
    for (const cmp of this.components_) {
      for (const seg of cmp.lines()) len += seg.length();
    }
    return len;
  }

  curveCount(): number {
    return this.components_.filter((c) => c.isCurve).length;
  }

  /** The direction reversed. */
  reverse(): void {
    const cmps: PathComponent[] = [];
    for (let i = this.components_.length - 1; i >= 0; i--) {
      const pc = this.components_[i];
      if (pc === undefined) continue;
      if (pc.isCurve) {
        const c = pc.curve;
        cmps.push(PathComponent.ofCurve(new BezierCurve(c.point4, c.point3, c.point2, c.point1, c.numPoints)));
      } else {
        cmps.push(PathComponent.line(pc.segment.p2, pc.segment.p1));
      }
    }
    this.components_ = cmps;
  }

  /** The bounds of the segment approximation (a zero rect for an empty path). */
  bound(): Rect {
    if (this.components_.length === 0) return new Rect();
    let rect = Rect.fromCenter(this.front().firstPoint(), 0, 0);
    for (const pc of this.components_) {
      for (const seg of pc.lines()) {
        rect = rect.include(seg.p1);
        rect = rect.include(seg.p2);
      }
    }
    return rect;
  }

  /** The vertices of the segment approximation, appended to `result`. */
  points(result: Point[] = []): Point[] {
    for (const pc of this.components_) {
      for (const seg of pc.lines()) {
        if (result.length === 0) result.push(seg.p1);
        result.push(seg.p2);
      }
    }
    return result;
  }

  /** The path cut by every rect in turn (C++ `clip(rects, result)`). */
  clipAll(rects: readonly Rect[]): SimplePath[] {
    let result: SimplePath[] = [this.clone()];
    for (const rect of rects) {
      const tmp = result;
      result = [];
      for (const path of tmp) path.clip(rect, result);
    }
    return result;
  }

  /** The pieces of the path outside `rect`, appended to `result`. */
  clip(rect: Rect, result: SimplePath[] = []): SimplePath[] {
    const isClose = (pc1: PathComponent, pc2: PathComponent): boolean =>
      getDistance(pc1.lastPoint(), pc2.firstPoint()) < 0.2;
    let path = new SimplePath();
    for (const pc of this.components_) {
      for (const item of pc.clip(rect)) {
        if (path.size > 0 && !isClose(path.back(), item)) {
          result.push(path);
          path = new SimplePath();
          path.push(item);
        } else {
          path.push(item);
        }
      }
    }
    if (path.size > 0) result.push(path);
    return result;
  }

  /**
   * The first self-intersection of the polyline approximation: [the closed loop, the rest with
   * the loop taken out]; empty when there is none.
   */
  findFirstLoop(): SimplePath[] {
    const pts = this.points();
    if (pts.length < 4) return [];
    const p = (i: number): Point => pts[i] ?? new Point();
    for (let i = 2; i < pts.length - 1; i++) {
      const seg1 = new LineSegment(p(i), p(i + 1));
      for (let j = 0; j < i - 1; j++) {
        const at = seg1.getIntersection(new LineSegment(p(j), p(j + 1)));
        if (at === null) continue;
        const path1 = new SimplePath();
        const path2 = new SimplePath();
        for (let from = j; from <= i; from++) {
          path1.addLine(from === j ? at : p(from), from === i ? at : p(from + 1));
        }
        for (let from = 0; from <= j; from++) {
          path2.addLine(p(from), from === j ? at : p(from + 1));
        }
        for (let from = i; from < pts.length - 1; from++) {
          path2.addLine(from === i ? at : p(from), p(from + 1));
        }
        return [path1, path2];
      }
    }
    return [];
  }

  /** A closed rounded rectangle of four quarter-ellipse cubics and four lines. */
  static roundedRect(rect: Rect, radius: number): SimplePath {
    const path = new SimplePath();
    let rx = radius;
    let ry = radius;
    if (rx > rect.width / 2) rx = rect.width / 2;
    if (ry > rect.height / 2) ry = rect.height / 2;
    const K = 0.5522847498;
    const wd = rect.width / 2;
    const ht = rect.height / 2;
    const { x: cx, y: cy } = rect.center();
    const P = (x: number, y: number): Point => new Point(x, y);
    const curve = (a: Point, b: Point, c: Point, d: Point): void => {
      path.addCurve(new BezierCurve(a, b, c, d, 4));
    };
    // start from the top right corner
    curve(
      P(cx + wd - rx, cy - ht),
      P(cx + wd - rx * (1 - K), cy - ht),
      P(cx + wd, cy - ht + ry * (1 - K)),
      P(cx + wd, cy - ht + ry),
    );
    path.addLine(P(cx + wd, cy - ht + ry), P(cx + wd, cy + ht - ry));
    curve(
      P(cx + wd, cy + ht - ry),
      P(cx + wd, cy + ht - ry * (1 - K)),
      P(cx + wd - rx * (1 - K), cy + ht),
      P(cx + wd - rx, cy + ht),
    );
    path.addLine(P(cx + wd - rx, cy + ht), P(cx - wd + rx, cy + ht));
    curve(
      P(cx - wd + rx, cy + ht),
      P(cx - wd + rx * (1 - K), cy + ht),
      P(cx - wd, cy + ht - ry * (1 - K)),
      P(cx - wd, cy + ht - ry),
    );
    path.addLine(P(cx - wd, cy + ht - ry), P(cx - wd, cy - ht + ry));
    curve(
      P(cx - wd, cy - ht + ry),
      P(cx - wd, cy - ht + ry * (1 - K)),
      P(cx - wd + rx * (1 - K), cy - ht),
      P(cx - wd + rx, cy - ht),
    );
    path.addLine(P(cx - wd + rx, cy - ht), P(cx + wd - rx, cy - ht));
    path.setClosed(true);
    return path;
  }

  /** Move, three lines and close around `rect` (corners in `Rect.getPoints` order). */
  static rectPathSteps(rect: Rect): PathStep[] {
    return [
      pathStep(PathStepType.Move, rect.p1()),
      pathStep(PathStepType.Line, rect.p2()),
      pathStep(PathStepType.Line, rect.p3()),
      pathStep(PathStepType.Line, rect.p4()),
      pathStep(PathStepType.Close, rect.p4()),
    ];
  }
}
