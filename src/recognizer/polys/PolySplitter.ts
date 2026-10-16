// Splits an open poly where it doubles back over itself (port of C++ `recognizer::PolySplitter`).
// It works on the poly's main segments (one per main angle), and maps the cut back to the
// original segments and parts.
import { INT_MAX } from '../../base';
import { getDistance, LineSegment, Vector, type Point } from '../../geometry';
import { at } from '../lines/RecognizerUtil';
import { CxPoly } from './CxPoly';

/** C++ `lenDelta`: pieces shorter than this are not split off. */
const LEN_DELTA = 8;

export class PolySplitter {
  private readonly poly: CxPoly;
  private segments: readonly LineSegment[];
  private readonly mainSegments: LineSegment[] = [];
  private readonly segmentMap: (readonly [number, number])[] = [];
  private curSegment = 0;
  private left1: Point;
  private left2: Point;
  private right: Point;

  constructor(poly: CxPoly) {
    this.poly = poly;
    const features = poly.features();
    this.segments = features.segments;
    const first = at(this.segments, 0);
    this.left1 = first.point1();
    this.left2 = first.point2();
    this.right = first.point1();
    if (poly.closed() || poly.almostClosed()) return;

    // The main segments: from one main angle to the next.
    const angles = features.mainAngles.slice().sort((a, b) => a.segId - b.segId);
    let lastId = 0;
    let lastPoint = first.point1();
    for (const angle of angles) {
      this.mainSegments.push(new LineSegment(lastPoint, at(this.segments, angle.segId - 1).point2()));
      this.segmentMap.push([lastId, angle.segId - 1]);
      lastPoint = at(this.segments, angle.segId).point1();
      lastId = angle.segId;
    }
    this.mainSegments.push(new LineSegment(lastPoint, at(this.segments, this.segments.length - 1).point2()));
    this.segmentMap.push([lastId, this.segments.length - 1]);
    // Split on the main segments.
    this.segments = this.mainSegments;
  }

  /** C++ `split()`: the pieces, or `[]` when the poly is not split. */
  split(): CxPoly[] {
    const polys: CxPoly[] = [];
    const segs = this.segments;
    if (segs.length < 2) return polys;
    if (this.poly.closed() || this.poly.almostClosed()) return polys;

    this.curSegment = 0;
    this.left1 = at(segs, 0).point1();
    this.left2 = at(segs, 0).point2();
    this.right = at(segs, 1).point1();

    while (this.curSegment < segs.length - 1) {
      if (!this.coverLeft()) return this.splitHere();
      this.coverRight();
      if (this.allFinished()) return polys;
      this.curSegment++;
      this.left1 = this.right;
      this.left2 = at(segs, this.curSegment).point2();
      if (this.curSegment === segs.length - 1) return this.splitHere();
      this.right = at(segs, this.curSegment + 1).point1();
    }
    return polys;
  }

  private splitHere(): CxPoly[] {
    const polys: CxPoly[] = [];
    if (this.curSegment >= this.segments.length) return polys;
    if (getDistance(this.left1, this.left2) < LEN_DELTA) return polys;

    // Map to the original segments.
    let left2SegId = this.curSegment;
    const pair = at(this.segmentMap, this.curSegment);
    this.segments = this.poly.features().segments;
    const segs = this.segments;
    if (pair[0] === pair[1]) {
      this.curSegment = pair[0];
      left2SegId = this.curSegment;
    } else {
      // C++ keeps these distances in ints: `int dist1 = INT_MAX; … dist1 = tmp` truncates.
      let dist1 = INT_MAX;
      let dist2 = INT_MAX;
      const tmpLeft1 = this.left1;
      const tmpLeft2 = this.left2;
      for (let from = pair[0]; from <= pair[1]; from++) {
        const seg = at(segs, from);
        let r = seg.getDistanceFrom(tmpLeft1);
        if (r.dist < dist1) {
          this.curSegment = from;
          dist1 = Math.trunc(r.dist);
          this.left1 = r.near;
        }
        r = seg.getDistanceFrom(tmpLeft2);
        if (r.dist < dist2) {
          left2SegId = from;
          dist2 = Math.trunc(r.dist);
          this.left2 = r.near;
        }
      }
    }

    const lines = this.poly.lines;
    const cur = this.curSegment;
    // The part before the cut.
    if (cur > 0) {
      const poly = new CxPoly(this.poly.env, [], this.poly.turnDir);
      for (let id = 0; id < cur; id++) poly.push(at(lines, id));
      poly.push(at(lines, cur).withEnd(this.left1));
      polys.push(poly);
    }

    // The gap.
    const polym = new CxPoly(this.poly.env);
    for (let gapId = cur; gapId <= left2SegId; gapId++) {
      let lpm = at(lines, gapId);
      if (gapId === cur) lpm = lpm.withStart(this.left1);
      if (gapId === left2SegId) lpm = lpm.withEnd(this.left2);
      polym.push(lpm);
    }
    if (polym.lines.length > 0) polys.push(polym);

    if (left2SegId === segs.length - 1) {
      if (getDistance(this.left2, at(segs, left2SegId).point2()) < LEN_DELTA) return polys;
    }
    // The part after the cut.
    if (left2SegId < segs.length) {
      const poly = new CxPoly(this.poly.env);
      poly.push(at(lines, left2SegId).withStart(this.left2));
      for (let id = left2SegId + 1; id < segs.length; id++) poly.push(at(lines, id));
      polys.push(poly);
    }
    return polys;
  }

  private allFinished(): boolean {
    const segs = this.segments;
    if (this.curSegment >= segs.length - 1) return true;
    if (this.curSegment === segs.length - 2) {
      if (getDistance(at(segs, this.curSegment + 1).point2(), this.right) < LEN_DELTA) return true;
    }
    return false;
  }

  private coverLeft(): boolean {
    const segs = this.segments;
    if (this.curSegment === segs.length) return false;
    const leftEnd = at(segs, this.curSegment).point2();
    for (let nextIndex = this.curSegment + 1; nextIndex < segs.length; nextIndex++) {
      if (getDistance(this.left1, this.left2) < LEN_DELTA) return true;
      const curSeg = at(segs, this.curSegment);
      const seg2 = at(segs, nextIndex);
      const seg1 = new LineSegment(curSeg.point2(), curSeg.point1());
      const cutAt = PolySplitter.cut(seg2, seg1);
      if (cutAt === null) return true;
      const dist1 = getDistance(leftEnd, cutAt);
      const dist2 = getDistance(leftEnd, this.left1);
      if (dist1 >= dist2) {
        this.left1 = seg1.point2();
        this.left2 = seg1.point2();
        return true;
      }
      if (getDistance(this.left1, this.left2) > getDistance(this.left1, cutAt)) this.left2 = cutAt;
    }
    return false;
  }

  private coverRight(): boolean {
    const delta = 0.5;
    const segs = this.segments;
    const seg2 = at(segs, this.curSegment + 1);
    for (let prevIndex = this.curSegment; prevIndex >= 0; prevIndex--) {
      const seg = at(segs, prevIndex);
      const seg1 = new LineSegment(seg.point2(), seg.point1());
      const cutAt = PolySplitter.cut(seg1, seg2);
      if (cutAt === null) {
        this.right = seg2.point2();
        return true;
      }
      const dist1 = getDistance(seg2.point2(), cutAt);
      if (dist1 < delta) {
        this.right = cutAt;
        return true;
      }
      if (dist1 < getDistance(seg2.point2(), this.right)) this.right = cutAt;
    }
    return false;
  }

  /** C++ `cut`: where `seg2` meets the perpendicular at `seg1`'s end to the bisector of the two. */
  private static cut(seg1: LineSegment, seg2: LineSegment): Point | null {
    const vec1 = Vector.between(seg1.point1(), seg1.point2()).normalize();
    const vec2 = Vector.between(seg2.point1(), seg2.point2()).normalize();
    const eq = vec1.sum(vec2).lineEquation(seg1.point1());
    const perpEq = eq.getPerpendicularPassingThrough(seg1.point2());
    return seg2.getIntersectionWithLine(perpEq);
  }
}
