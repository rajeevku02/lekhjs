// A convex poly: a chain of line parts that turns one way (port of C++ `recognizer::CxPoly`).
//
// The search that grows polys works on `PolyNode`s (shared tails, R3); a `CxPoly` is the
// materialised result the later stages read. Each `CxPoly` owns its features and basic shape
// (no aliasing with the poly it was grown from, R12). C2 (DR-REC-02) is fixed here:
// `computeBasicFeatures` takes the width from x, not y (`quirks.legacyWidthBug` restores the bug).
// Dropped: `dumpFeatures`, `dumpPoints`, `toStr`.
import { areaOfConvexPolygon, getAngle, getDistance, LineSegment, Rect, TurnDir, type Point } from '../../geometry';
import { LineRelation } from '../lines/LineRelation';
import { at, canClose, RecInternalError } from '../lines/RecognizerUtil';
import { LinePart, type Parts, type StrokeLine } from '../lines/StrokeLine';
import { lineBit, maskIds, type LineIdMask } from './LineIdMask';
import { PolyFeatures, type BasicShape, type PolyAngle, type PolyEnv } from './PolyFeatures';

/** The line-id mask of `lines`. */
function maskOf(lines: readonly LinePart[]): LineIdMask {
  let m = 0;
  for (const lp of lines) m |= lineBit(lp.line.id);
  return m;
}

/** Angle descending; `Array.prototype.sort` is stable, so ties keep their order (B8). */
function byAngleDesc(a: PolyAngle, b: PolyAngle): number {
  return b.angle - a.angle;
}

function bySegId(a: PolyAngle, b: PolyAngle): number {
  return a.segId - b.segId;
}

export class CxPoly {
  readonly env: PolyEnv;
  /** The parts in order. Mutated only while a poly is being built (split, PolySplitter). */
  readonly lines: LinePart[];
  /** C++ `lineIds()`: the ids of the lines the parts belong to. */
  lineIds: LineIdMask;
  turnDir: TurnDir;
  id = 0;
  private isClosed: boolean;
  private isAlmostClosed = false;
  private feats: PolyFeatures | null = null;
  private basic: BasicShape | null = null;

  constructor(env: PolyEnv, lines: LinePart[] = [], turnDir: TurnDir = TurnDir.NoTurn, closed = false) {
    this.env = env;
    this.lines = lines;
    this.lineIds = maskOf(lines);
    this.turnDir = turnDir;
    this.isClosed = closed;
  }

  /** C++ `CxPoly(Line::Ptr)`: a one-line poly over the whole line. */
  static ofLine(env: PolyEnv, line: StrokeLine): CxPoly {
    return new CxPoly(env, [new LinePart(line)]);
  }

  /** Appends a part (while building a poly). */
  push(part: LinePart): void {
    this.lines.push(part);
    this.lineIds |= lineBit(part.line.id);
  }

  /** The line ids, ascending. */
  lineIdList(): number[] {
    return maskIds(this.lineIds);
  }

  /** Closed: set by an inward turn that met the other end, or by `features()` (ends < 6 px apart). */
  closed(): boolean {
    return this.isClosed;
  }

  /** Set by `features()`: the end gap could close the figure (`RecognizerUtil.canClose`). */
  almostClosed(): boolean {
    return this.isAlmostClosed;
  }

  firstPoint(): Point {
    return this.front().start;
  }

  lastPoint(): Point {
    return this.back().end;
  }

  private front(): LinePart {
    return at(this.lines, 0);
  }

  private back(): LinePart {
    return at(this.lines, this.lines.length - 1);
  }

  /** C++ `equals`: same line ids, and each part equal to the other's part of the same line. */
  equals(other: CxPoly): boolean {
    if (other.lineIds !== this.lineIds) return false;
    const delta = this.env.config.linePartEqualityDelta;
    return this.lines.every((line) => other.lines.some((o) => line.equals(o, delta)));
  }

  /** C++ `features()`: computed on first use. */
  features(): PolyFeatures {
    if (this.feats === null) this.computeFeatures();
    return this.feats as PolyFeatures;
  }

  smoothness(): number {
    const f = this.features();
    if (f.smoothness < 0) f.smoothness = LineRelation.getSmoothingFactor(this.lines, this.env.lineAggregator);
    return f.smoothness;
  }

  smoothness2(): number {
    const f = this.features();
    if (f.smoothness2 < 0) f.smoothness2 = LineRelation.getSmoothingFactor2(this.lines, this.env.lineAggregator);
    return f.smoothness2;
  }

  /** C++ `shape()`: the basic shape, classified on first use with the regular thresholds. */
  shape(): BasicShape {
    if (this.basic === null) {
      const classify = this.env.classifyBasicShape;
      if (classify === undefined) throw new RecInternalError('CxPoly.shape(): no basic-shape classifier in the env');
      this.basic = classify(this);
    }
    return this.basic;
  }

  /** C++ `recognize(RecognitionConfig*)`: classify now with the given classifier. */
  recognize(classify: (poly: CxPoly) => BasicShape): void {
    this.basic = classify(this);
  }

  /** The basic shape if one was classified, else null (never classifies). */
  basicShape(): BasicShape | null {
    return this.basic;
  }

  /** C++ `bound()`: the box of the part ends (an empty rect without parts). */
  bound(): Rect {
    const first = this.lines[0];
    if (first === undefined) return new Rect();
    let rect = new Rect(first.start.x, first.start.y, 0, 0);
    for (const ln of this.lines) {
      rect = rect.include(ln.start);
      rect = rect.include(ln.end);
    }
    return rect;
  }

  /** C++ `getAmplitudePoint()`: the part end farthest from the first-to-last chord. */
  getAmplitudePoint(): Point {
    const seg = new LineSegment(this.firstPoint(), this.lastPoint());
    let pt = this.firstPoint();
    let dist = 0;
    for (const line of this.lines) {
      const tmp = seg.getDistanceFrom(line.end).dist;
      if (tmp > dist) {
        dist = tmp;
        pt = line.end;
      }
    }
    return pt;
  }

  /** C++ `getRawPoints`: the stroke points under each part, in poly order. */
  getRawPoints(): Point[] {
    const output: Point[] = [];
    for (const lp of this.lines) {
      const { points, reverse } = lp.points();
      if (reverse) {
        for (let j = points.size - 1; j >= 0; j--) output.push(points.at(j));
      } else {
        for (let j = 0; j < points.size; j++) output.push(points.at(j));
      }
    }
    return output;
  }

  private computeFeatures(): void {
    const f = new PolyFeatures();
    this.feats = f;
    this.computeBasicFeatures(f);

    const minCost = this.env.config.lineAggregatorMaxJoinCost + 2;
    for (const lp of this.lines) lp.getSegments(f.segments, minCost);

    const segments = f.segments;
    let numSegments = segments.length;
    if (this.isClosed && this.lines.length > 2) numSegments++;

    f.totalAngle = 0;
    for (let i = 1; i < numSegments; i++) {
      const p1 = at(segments, i - 1).point1();
      const segId = i === segments.length ? 0 : i;
      const seg = at(segments, segId);
      const step = getAngle(p1, seg.point1(), seg.point2());
      f.totalAngle += step;
      f.angles.push({ angle: step, len: seg.length(), segId: i });
    }
    this.updateCorners(f);
  }

  /** C++ `updateCorners`: the main angles (90 % of the turning, then until the area holds). */
  private updateCorners(f: PolyFeatures): void {
    const angles = f.angles.slice().sort(byAngleDesc);
    const totalPct = 90;
    let pct = 0;
    let index = 0;
    let sum = 0;
    while (pct < totalPct && index < angles.length) {
      const a = at(angles, index);
      f.mainAngles.push(a);
      sum += a.angle;
      pct = (sum / f.totalAngle) * 100;
      index++;
    }
    const getArea = (list: readonly PolyAngle[]): number => areaOfConvexPolygon(f.getPoints(this.isClosed, list));
    const totalArea = getArea(f.angles);
    while (f.mainAngles.length < f.angles.length && totalArea > 0) {
      // Stop once the main angles keep enough of the area.
      const area = getArea(f.mainAngles);
      if (area === 0) break;
      if (area / totalArea > this.env.config.angleReductionAreaThreshold) break;
      f.mainAngles.push(at(angles, index));
      index++;
    }
    f.mainAngles.sort(bySegId);
  }

  /** C++ `computeBasicFeatures`: perimeter, width/height (C2 fixed), almost-closed, closed. */
  private computeBasicFeatures(f: PolyFeatures): void {
    const config = this.env.config;
    const legacyWidth = this.env.quirks.legacyWidthBug === true;
    f.perimeter = 0;
    const pt = this.front().start;
    let minx = pt.x;
    let maxx = pt.x;
    let miny = pt.y;
    let maxy = pt.y;
    const update = (p: Point): void => {
      if (minx > p.x) minx = p.x;
      // DR-REC-02: C++ assigns p.y here (CxPoly.cpp:455-456).
      if (maxx < p.x) maxx = legacyWidth ? p.y : p.x;
      if (miny > p.y) miny = p.y;
      if (maxy < p.y) maxy = p.y;
    };
    for (const lp of this.lines) {
      f.perimeter += getDistance(lp.start, lp.end);
      update(lp.start);
      update(lp.end);
    }
    f.width = maxx - minx;
    f.height = maxy - miny;
    if (f.width < 1.0) f.width = 1.0;
    if (f.height < 1.0) f.height = 1.0;
    const gap = getDistance(this.front().start, this.back().end);
    this.isAlmostClosed = canClose(gap, f.width + f.height, config);
    if (!this.isClosed) this.isClosed = gap < config.polygonSmallClosingDist;
  }

  /**
   * C++ `CxPoly::split`: `poly` with the used ranges of line `lineId` cut out, as the pieces
   * before, the left-over parts of that line, and the piece after. `[poly]` when nothing is cut.
   */
  static split(poly: CxPoly, lineId: number, used: Parts): CxPoly[] {
    const polys: CxPoly[] = [];
    const lines = poly.lines;
    const idx = lines.findIndex((lp) => lp.line.id === lineId);
    if (idx < 0) {
      polys.push(poly);
      return polys;
    }
    const near = (a: Point, b: Point): boolean => getDistance(a, b) <= 1.0;
    const target = at(lines, idx);
    const split = used.split(target);
    if (split.length === 1) {
      const only = at(split, 0);
      if (near(only.start, target.start) && near(only.end, target.end)) {
        polys.push(poly);
        return polys;
      }
    }

    let partsStart = 0;
    if (idx > 0) {
      const np = new CxPoly(poly.env);
      for (let i = 0; i < idx; i++) np.push(at(lines, i));
      const first = split[0];
      if (first !== undefined && near(np.back().end, first.start)) {
        np.push(first);
        partsStart++;
      }
      if (idx > 1) np.turnDir = poly.turnDir;
      polys.push(np);
    }
    let partsEnd = split.length - 1;
    const lastSplit = split[split.length - 1];
    const after = lines[idx + 1];
    if (lastSplit !== undefined && after !== undefined && near(lastSplit.end, after.start)) partsEnd--;
    for (let i = partsStart; i <= partsEnd; i++) {
      const np = new CxPoly(poly.env);
      np.push(at(split, i));
      polys.push(np);
    }

    const lastPoly = new CxPoly(poly.env);
    if (partsEnd < split.length - 1 && lastSplit !== undefined) lastPoly.push(lastSplit);
    for (let i = idx + 1; i < lines.length; i++) lastPoly.push(at(lines, i));
    if (lastPoly.lines.length > 0) {
      if (lastPoly.lines.length > 1) lastPoly.turnDir = poly.turnDir;
      polys.push(lastPoly);
    }
    return polys;
  }
}
