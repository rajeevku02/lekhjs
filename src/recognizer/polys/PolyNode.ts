// A growing convex poly as a persistent, shared-tail node (speed-ups R3, R4, R5; spec 07 §4.1).
//
// C++ `CxPoly::newPoly` clones the whole parent (its part vector and line-id set) for every
// candidate extension, then most candidates are thrown away as duplicates. Here a candidate is one
// small node: its parent, the side it extends (0 = before the first part, 1 = after the last),
// the new part, and — for an inward or outward turn that trims the other end — the replacement of
// the parent's part at that other end. The full part list is built (`materialize`) only for polys
// that reach the result. The extension rules are C++ `CxPoly::extend`, `extendTo`,
// `extendInwardTurn`, `extendOutwardTurn` and `tdf1-3`, unchanged.
import { crossProduct, getDistance, LineEquation, LineSegment, Point, toRadian, TurnDir } from '../../geometry';
import type { LineColl } from '../lines/LineColl';
import { LinePart, type LinePoint } from '../lines/StrokeLine';
import { lineBit, type LineIdMask } from './LineIdMask';

/** C++ `CxPoly.cpp` `minLineLen`: a line end nearer than this to the join point is not extended to. */
const MIN_LINE_LEN = 15;
/** C++ `CxPoly.cpp` `angleDelta` (degrees): turns within it count as none / as a U-turn. */
const ANGLE_DELTA = 0.1;
/** R5: `getAngle(…) < ANGLE_DELTA` ⟺ cos > COS_DELTA; `> 180 - ANGLE_DELTA` ⟺ cos < -COS_DELTA. */
const COS_DELTA = Math.cos(toRadian(ANGLE_DELTA));

/**
 * `GeoUtil.getTurnDir(p1, p2, p3, 0.1)` without `acos` (R5): the cosine of the turn is compared
 * with the precomputed cosine of the threshold. Equal to the `acos` form except possibly at the
 * exact threshold (an ulp; accepted under the doubles decision, OQ-46). A degenerate turn (a zero
 * leg, cosine NaN) is neither none nor a U-turn, as in C++ (whose `acos(NaN)` becomes 90°).
 */
export function turnDirFast(p1: Point, p2: Point, p3: Point): TurnDir {
  const ax = p2.x - p1.x;
  const ay = p2.y - p1.y;
  const bx = p3.x - p2.x;
  const by = p3.y - p2.y;
  const d1 = Math.sqrt(ax * ax + ay * ay);
  const d2 = Math.sqrt(bx * bx + by * by);
  const cos = (ax * bx + ay * by) / (d1 * d2);
  if (cos > COS_DELTA) return TurnDir.NoTurn;
  if (cos < -COS_DELTA) return TurnDir.UTurn;
  const cp = crossProduct(new Point(ax, ay), new Point(bx, by));
  return cp < 0 ? TurnDir.Left : TurnDir.Right;
}

/** A candidate extension (C++ `PolyExtension`). */
export interface NodeExtension {
  readonly poly: PolyNode;
  readonly byTrimming: boolean;
}

export class PolyNode {
  readonly parent: PolyNode | null;
  /** 0: `part` was put before the parent's first part; 1: after its last. */
  readonly side: 0 | 1;
  readonly part: LinePart;
  /** The parent's part at the other end, trimmed by this extension (C++ rewrites it in place). */
  readonly otherEndReplacement: LinePart | null;
  readonly mask: LineIdMask;
  readonly first: LinePart;
  readonly last: LinePart;
  /** Number of parts. */
  readonly count: number;
  readonly turnDir: TurnDir;
  readonly closed: boolean;
  /** Parts indexed by line id (R4), built on first comparison. */
  private byIdCache: (LinePart | undefined)[] | null = null;

  constructor(
    parent: PolyNode | null,
    side: 0 | 1,
    part: LinePart,
    otherEndReplacement: LinePart | null,
    turnDir: TurnDir,
    closed: boolean,
  ) {
    this.parent = parent;
    this.side = side;
    this.part = part;
    this.otherEndReplacement = otherEndReplacement;
    this.turnDir = turnDir;
    this.closed = closed;
    if (parent === null) {
      this.mask = lineBit(part.line.id);
      this.first = part;
      this.last = part;
      this.count = 1;
    } else {
      this.mask = parent.mask | lineBit(part.line.id);
      this.count = parent.count + 1;
      if (side === 0) {
        this.first = part;
        this.last = otherEndReplacement ?? parent.last;
      } else {
        this.first = otherEndReplacement ?? parent.first;
        this.last = part;
      }
    }
  }

  /** C++ `CxPoly(Line::Ptr)`: a one-line poly. */
  static root(part: LinePart): PolyNode {
    return new PolyNode(null, 1, part, null, TurnDir.NoTurn, false);
  }

  firstPoint(): Point {
    return this.first.start;
  }
  secondPoint(): Point {
    return this.first.end;
  }
  lastPoint(): Point {
    return this.last.end;
  }
  secondLastPoint(): Point {
    return this.last.start;
  }

  /** `node` and its ancestors, leaf first. */
  private static chain(node: PolyNode): PolyNode[] {
    const out: PolyNode[] = [];
    for (let n: PolyNode | null = node; n !== null; n = n.parent) out.push(n);
    return out;
  }

  /** The parts in order (C++ `lines()`). */
  materialize(): LinePart[] {
    const chain = PolyNode.chain(this);
    const parts: LinePart[] = [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i] as PolyNode;
      if (n.parent === null) {
        parts.push(n.part);
      } else if (n.side === 0) {
        if (n.otherEndReplacement !== null) parts[parts.length - 1] = n.otherEndReplacement;
        parts.unshift(n.part);
      } else {
        if (n.otherEndReplacement !== null) parts[0] = n.otherEndReplacement;
        parts.push(n.part);
      }
    }
    return parts;
  }

  /** The current part of each line, indexed by line id. */
  private byId(): (LinePart | undefined)[] {
    if (this.byIdCache !== null) return this.byIdCache;
    const out: (LinePart | undefined)[] = [];
    for (const n of PolyNode.chain(this)) {
      // A node's own part and its replacement shadow whatever its ancestors hold for those ids.
      if (out[n.part.line.id] === undefined) out[n.part.line.id] = n.part;
      const r = n.otherEndReplacement;
      if (r !== null && out[r.line.id] === undefined) out[r.line.id] = r;
    }
    this.byIdCache = out;
    return out;
  }

  /**
   * C++ `CxPoly::equals` in O(k) (R4): with equal masks, each part is compared only with the
   * other poly's part of the same line (a poly never holds a line twice).
   */
  equals(other: PolyNode, delta: number): boolean {
    if (other.mask !== this.mask) return false;
    const mine = this.byId();
    const theirs = other.byId();
    for (let id = 1; id < mine.length; id++) {
      const a = mine[id];
      if (a === undefined) continue;
      const b = theirs[id];
      if (b === undefined || !a.equals(b, delta)) return false;
    }
    return true;
  }

  /** C++ `CxPoly::extend`: every convex extension at the first end, then at the last end. */
  extend(coll: LineColl): NodeExtension[] {
    const ex: NodeExtension[] = [];
    for (const side of [0, 1] as const) {
      const ep =
        side === 0
          ? { linePoint: { line: this.first.line, point: this.first.start, t: 0 }, towards: -1 }
          : { linePoint: { line: this.last.line, point: this.last.end, t: 0 }, towards: 1 };
      const linePoints = coll.getLinesNear(ep, this.mask);
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

  private extendTo(side: 0 | 1, lp: LinePoint, endPoint: Point): NodeExtension | null {
    const td = this.tdf1(side, lp, endPoint);
    if (td === TurnDir.UTurn) return null;
    if (this.turnDir === TurnDir.NoTurn) {
      // Still a line: any turn sets the poly's direction.
      return { poly: this.newPoly(side, lp, endPoint, null, td, false), byTrimming: false };
    }
    if (td === this.turnDir || td === TurnDir.NoTurn) {
      const td2 = this.tdf2(side, lp, endPoint);
      const td3 = this.tdf3(side, lp, endPoint);
      if (td2 === this.turnDir || td2 === TurnDir.NoTurn) {
        if (td3 === this.turnDir || td3 === TurnDir.NoTurn) {
          return { poly: this.newPoly(side, lp, endPoint, null, this.turnDir, false), byTrimming: false };
        }
        return this.extendOutwardTurn(side, lp, endPoint);
      }
      return this.extendInwardTurn(side, lp, endPoint);
    }
    // Turns the other way: not convex (C++ leaves "check next line with concave error" undone).
    return null;
  }

  private extendInwardTurn(side: 0 | 1, lp: LinePoint, endPoint: Point): NodeExtension | null {
    const eq = LineEquation.through(lp.point, endPoint);
    const olp = side === 0 ? this.last : this.first;
    const intersect = new LineSegment(olp.start, olp.end).getIntersectionWithLine(eq);
    if (intersect === null) return null;
    let isClosed = false;
    let newEndPoint = endPoint;
    if (new LineSegment(lp.point, endPoint).inRange(intersect)) {
      isClosed = true;
      newEndPoint = intersect;
    }
    // The other end is trimmed to the intersection.
    const replacement = side === 0 ? olp.withEnd(intersect) : olp.withStart(intersect);
    return {
      poly: this.newPoly(side, lp, newEndPoint, replacement, this.turnDir, isClosed),
      byTrimming: true,
    };
  }

  private extendOutwardTurn(side: 0 | 1, lp: LinePoint, endPoint: Point): NodeExtension | null {
    const olp = side === 0 ? this.last : this.first;
    const eq = LineEquation.through(olp.start, olp.end);
    const intersect = new LineSegment(lp.point, endPoint).getIntersectionWithLine(eq);
    if (intersect === null) return null;
    // The new part runs from the intersection instead of from the line's end.
    const part = side === 0 ? new LinePart(lp.line, intersect, lp.point) : new LinePart(lp.line, lp.point, intersect);
    return { poly: new PolyNode(this, side, part, null, this.turnDir, false), byTrimming: false };
  }

  /** C++ `newPoly`: the part from the join point to `endPoint`, put on `side`. */
  private newPoly(
    side: 0 | 1,
    lp: LinePoint,
    endPoint: Point,
    replacement: LinePart | null,
    turnDir: TurnDir,
    closed: boolean,
  ): PolyNode {
    const part = side === 0 ? new LinePart(lp.line, endPoint, lp.point) : new LinePart(lp.line, lp.point, endPoint);
    return new PolyNode(this, side, part, replacement, turnDir, closed);
  }

  private tdf1(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return turnDirFast(endPoint, lp.point, this.secondPoint());
    return turnDirFast(this.secondLastPoint(), lp.point, endPoint);
  }

  private tdf2(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return turnDirFast(this.lastPoint(), endPoint, lp.point);
    return turnDirFast(lp.point, endPoint, this.firstPoint());
  }

  private tdf3(side: 0 | 1, lp: LinePoint, endPoint: Point): TurnDir {
    if (side === 0) return turnDirFast(this.secondLastPoint(), this.lastPoint(), endPoint);
    return turnDirFast(endPoint, this.firstPoint(), this.secondPoint());
  }
}
