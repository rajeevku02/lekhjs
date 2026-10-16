// The eager reference for the differential test (spec 07 §7.3, AC-REC-08): C++
// `CxPolyAggregator` + `CxPoly::extend` translated as they are — every candidate clones its
// parent's whole part list and line-id set, turn tests use `acos` (`GeoUtil.getTurnDir`), and the
// next generation is deduplicated by a linear scan over every accepted poly with the full C++
// `equals` (set equality, then each part searched in the other poly). None of R1-R5 is in here.
import { getDistance, getTurnDir, LineEquation, LineSegment, TurnDir, type Point } from '../../../src/geometry';
import type { LineColl } from '../../../src/recognizer/lines';
import { LinePart, LinePoint } from '../../../src/recognizer/lines';

const MIN_LINE_LEN = 15;
const ANGLE_DELTA = 0.1;

export class EagerPoly {
  lines: LinePart[];
  lineIds: Set<number>;
  turnDir: TurnDir;
  closed: boolean;

  constructor(lines: LinePart[], lineIds: Set<number>, turnDir: TurnDir, closed: boolean) {
    this.lines = lines;
    this.lineIds = lineIds;
    this.turnDir = turnDir;
    this.closed = closed;
  }

  clone(): EagerPoly {
    return new EagerPoly(this.lines.slice(), new Set(this.lineIds), this.turnDir, this.closed);
  }

  private front(): LinePart {
    return this.lines[0] as LinePart;
  }
  private back(): LinePart {
    return this.lines[this.lines.length - 1] as LinePart;
  }
  firstPoint(): Point {
    return this.front().start;
  }
  secondPoint(): Point {
    return this.front().end;
  }
  lastPoint(): Point {
    return this.back().end;
  }
  secondLastPoint(): Point {
    return this.back().start;
  }

  private maskOfIds(): number {
    let m = 0;
    for (const id of this.lineIds) m |= 1 << (id - 1);
    return m;
  }

  extend(coll: LineColl): { poly: EagerPoly; byTrimming: boolean }[] {
    const ex: { poly: EagerPoly; byTrimming: boolean }[] = [];
    for (const side of [0, 1] as const) {
      const ep =
        side === 0
          ? { linePoint: new LinePoint(this.front().line, this.front().start), towards: -1 }
          : { linePoint: new LinePoint(this.back().line, this.back().end), towards: 1 };
      const linePoints = coll.getLinesNear(ep, this.maskOfIds());
      for (const lp of linePoints) {
        for (const endPoint of [lp.line.firstPoint(), lp.line.lastPoint()]) {
          if (getDistance(endPoint, lp.point) > MIN_LINE_LEN) {
            const np = this.extendTo(side, lp, endPoint);
            if (np !== null) ex.push(np);
          }
        }
      }
    }
    return ex;
  }

  private extendTo(side: 0 | 1, lp: LinePoint, endPoint: Point): { poly: EagerPoly; byTrimming: boolean } | null {
    const td = this.tdf1(side, lp, endPoint);
    if (td === TurnDir.UTurn) return null;
    if (this.turnDir === TurnDir.NoTurn) {
      const poly = this.newPoly(side, lp, endPoint);
      poly.turnDir = td;
      return { poly, byTrimming: false };
    }
    if (td === this.turnDir || td === TurnDir.NoTurn) {
      const td2 = this.tdf2(side, lp, endPoint);
      const td3 = this.tdf3(side, lp, endPoint);
      if (td2 === this.turnDir || td2 === TurnDir.NoTurn) {
        if (td3 === this.turnDir || td3 === TurnDir.NoTurn) {
          return { poly: this.newPoly(side, lp, endPoint), byTrimming: false };
        }
        return this.extendOutwardTurn(side, lp, endPoint);
      }
      return this.extendInwardTurn(side, lp, endPoint);
    }
    return null;
  }

  private otherEnd(side: 0 | 1): number {
    return side === 0 ? this.lines.length - 1 : 0;
  }

  private extendInwardTurn(
    side: 0 | 1,
    lp: LinePoint,
    endPoint: Point,
  ): { poly: EagerPoly; byTrimming: boolean } | null {
    const eq = LineEquation.through(lp.point, endPoint);
    const olp = this.lines[this.otherEnd(side)] as LinePart;
    const intersect = new LineSegment(olp.start, olp.end).getIntersectionWithLine(eq);
    if (intersect === null) return null;
    let isClosed = false;
    let newEndPoint = endPoint;
    if (new LineSegment(lp.point, endPoint).inRange(intersect)) {
      isClosed = true;
      newEndPoint = intersect;
    }
    const poly = this.newPoly(side, lp, newEndPoint);
    poly.closed = isClosed;
    if (side === 0) {
      const i = poly.lines.length - 1;
      poly.lines[i] = (poly.lines[i] as LinePart).withEnd(intersect);
    } else {
      poly.lines[0] = (poly.lines[0] as LinePart).withStart(intersect);
    }
    return { poly, byTrimming: true };
  }

  private extendOutwardTurn(
    side: 0 | 1,
    lp: LinePoint,
    endPoint: Point,
  ): { poly: EagerPoly; byTrimming: boolean } | null {
    const olp = this.lines[this.otherEnd(side)] as LinePart;
    const eq = LineEquation.through(olp.start, olp.end);
    const intersect = new LineSegment(lp.point, endPoint).getIntersectionWithLine(eq);
    if (intersect === null) return null;
    const poly = this.newPoly(side, lp, endPoint);
    if (side === 0) {
      poly.lines[0] = (poly.lines[0] as LinePart).withStart(intersect);
    } else {
      const i = poly.lines.length - 1;
      poly.lines[i] = (poly.lines[i] as LinePart).withEnd(intersect);
    }
    return { poly, byTrimming: false };
  }

  private newPoly(side: 0 | 1, lp: LinePoint, endPoint: Point): EagerPoly {
    const np = this.clone();
    if (side === 0) np.lines.unshift(new LinePart(lp.line, endPoint, lp.point));
    else np.lines.push(new LinePart(lp.line, lp.point, endPoint));
    np.lineIds.add(lp.line.id);
    return np;
  }

  private tdf1(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return getTurnDir(endPoint, lp.point, this.secondPoint(), ANGLE_DELTA);
    return getTurnDir(this.secondLastPoint(), lp.point, endPoint, ANGLE_DELTA);
  }
  private tdf2(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return getTurnDir(this.lastPoint(), endPoint, lp.point, ANGLE_DELTA);
    return getTurnDir(lp.point, endPoint, this.firstPoint(), ANGLE_DELTA);
  }
  private tdf3(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return getTurnDir(this.secondLastPoint(), this.lastPoint(), endPoint, ANGLE_DELTA);
    return getTurnDir(endPoint, this.firstPoint(), this.secondPoint(), ANGLE_DELTA);
  }

  /** C++ `CxPoly::equals`. */
  equals(other: EagerPoly, delta: number): boolean {
    if (other.lineIds.size !== this.lineIds.size) return false;
    for (const id of this.lineIds) if (!other.lineIds.has(id)) return false;
    for (const line of this.lines) {
      if (!other.lines.some((o) => line.equals(o, delta))) return false;
    }
    return true;
  }
}

/** C++ `CxPolyAggregator::process()` before any speed-up, with the count budget. */
export function eagerAggregate(
  coll: LineColl,
  maxPolys: number,
  equalityDelta: number,
): { polys: EagerPoly[]; budgetExceeded: boolean; produced: number } {
  let cur = coll.lines().map((l) => new EagerPoly([new LinePart(l)], new Set([l.id]), TurnDir.NoTurn, false));
  const done: EagerPoly[] = [];
  let produced = cur.length;
  let exceeded = false;
  for (;;) {
    const next: EagerPoly[] = [];
    for (const poly of cur) {
      const extended = poly.extend(coll);
      let byTrimming = true;
      for (const item of extended) {
        if (item.poly.closed) {
          done.push(item.poly);
          produced++;
        } else if (!next.some((p) => p.equals(item.poly, equalityDelta))) {
          next.push(item.poly);
          produced++;
        }
        byTrimming = byTrimming && item.byTrimming;
      }
      if (extended.length === 0 || byTrimming) done.push(poly);
      if (produced > maxPolys) {
        exceeded = true;
        break;
      }
    }
    if (exceeded) break;
    cur = next;
    if (cur.length === 0) break;
  }
  return { polys: done, budgetExceeded: exceeded, produced };
}
