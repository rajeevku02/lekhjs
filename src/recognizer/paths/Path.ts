// An open or closed path of line and curve parts assembled from polys (port of C++
// `recognizer::Path` and `PathPart`). `absorb` grows the path from its two ends with the polys
// that continue it; `finalize` melds curves, stretches them over short line ends, joins line
// pieces of one stroke line, then fits one cubic per curve run and smooths the joins.
import {
  BezierCurve,
  CurveFitter,
  getDistance,
  getPointAtDistance,
  LineSegment,
  PathComponent,
  Rect,
} from '../../geometry';
import type { Point, SimplePath } from '../../geometry';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { at } from '../lines/RecognizerUtil';
import { LinePart, LinePoint } from '../lines/StrokeLine';
import type { CxPoly } from '../polys/CxPoly';

/** C++ `PathPart`: a path component plus whether it should join its neighbours smoothly. */
export class PathPart {
  isCurve = false;
  segment: LineSegment = new LineSegment();
  curve: BezierCurve = new BezierCurve();
  smoothLeft = false;
  smoothRight = false;
}

/** C++ `Path::Part`: one line part of the path and the curve run it belongs to (0: none). */
interface Part {
  linePart: LinePart;
  curveId: number;
  /** Where a merged curve should extend to (C++ `curveExtendTo`, null `line` = unset). */
  curveExtendTo: LinePoint | null;
}

function part(lp: LinePart, cid = 0): Part {
  return { linePart: lp, curveId: cid, curveExtendTo: null };
}

/** `lp` with its ends swapped (C++ `std::swap(lp.start, lp.end)`). */
function swapped(lp: LinePart): LinePart {
  return new LinePart(lp.line, lp.end, lp.start);
}

const LEFT = 0;
const RIGHT = 1;

export class Path {
  private readonly config: RecognizerConfig;
  private parts: Part[] = [];
  private readonly polyIds = new Set<number>();
  private readonly out: PathPart[] = [];
  private bnd: Rect = new Rect();
  private nextCurveId = 1;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  path(): readonly PathPart[] {
    return this.out;
  }

  bound(): Rect {
    return this.bnd;
  }

  /** C++ static `Path::reverse(SimplePath*)`: the components reversed (the result is open). */
  static reverse(sp: SimplePath): void {
    const comps = sp.components.slice();
    sp.reset();
    for (let i = comps.length - 1; i >= 0; i--) {
      const c = comps[i] as PathComponent;
      if (c.isCurve) {
        sp.push(PathComponent.ofCurve(new BezierCurve(c.curve.point4, c.curve.point3, c.curve.point2, c.curve.point1)));
      } else {
        sp.push(PathComponent.line(c.segment.point2(), c.segment.point1()));
      }
    }
  }

  /** C++ `contains(LinePoint)`: the point lies on a part of the same line. */
  contains(lp: LinePoint): boolean {
    for (const p of this.parts) {
      const line = p.linePart;
      if (line.line.id === lp.line.id && line.line.gid === lp.line.gid) {
        if (new LineSegment(line.start, line.end).inRange(lp.point, this.config.linePartEqualityDelta)) return true;
      }
    }
    return false;
  }

  /** C++ `absorb`: takes `poly` when the path is empty or the poly continues one of its ends. */
  absorb(poly: CxPoly): boolean {
    if (this.parts.length === 0) {
      const isCurve = poly.shape().isCurve;
      this.bnd = poly.bound();
      let cid = 0;
      if (isCurve) {
        cid = this.nextCurveId;
        this.nextCurveId++;
      }
      this.addParts(RIGHT, poly.lines, cid);
      this.polyIds.add(poly.id);
      return true;
    }
    if (this.polyIds.has(poly.id)) return false;
    if (this.extend(poly, LEFT) || this.extend(poly, RIGHT)) {
      this.polyIds.add(poly.id);
      this.bnd = this.bnd.includeRect(poly.bound());
      return true;
    }
    return false;
  }

  private extend(poly: CxPoly, side: number): boolean {
    const end = side === LEFT ? at(this.parts, 0).linePart : at(this.parts, this.parts.length - 1).linePart;
    const endPt = side === LEFT ? end.start : end.end;
    const lid = end.line.id;
    const gid = end.line.gid;
    const delta = this.config.linePartEqualityDelta;
    const lines = poly.lines;

    let idx = 0;
    while (idx < lines.length) {
      const lp = at(lines, idx);
      if (lp.line.id !== lid || lp.line.gid !== gid) {
        idx++;
        continue;
      }
      if (new LineSegment(lp.start, lp.end).inRange(endPt, delta)) break;
      idx++;
    }
    if (idx >= lines.length) return false;

    // Are the parts before (after) idx already in the path?
    let prevFound = false;
    let prevAllFound = true;
    let checkIdx = idx;
    while (checkIdx >= 0) {
      if (checkIdx === idx && getDistance(endPt, at(lines, idx).start) < delta) {
        checkIdx--;
        continue;
      }
      const lp = at(lines, checkIdx);
      if (!this.contains(new LinePoint(lp.line, lp.start))) {
        prevAllFound = false;
        break;
      }
      prevFound = true;
      checkIdx--;
    }

    let nextFound = false;
    let nextAllFound = true;
    checkIdx = idx;
    while (checkIdx < lines.length) {
      if (checkIdx === idx && getDistance(endPt, at(lines, idx).end) < delta) {
        checkIdx++;
        continue;
      }
      const lp = at(lines, checkIdx);
      if (!this.contains(new LinePoint(lp.line, lp.end))) {
        nextAllFound = false;
        break;
      }
      nextFound = true;
      checkIdx++;
    }

    if (idx === 0 && nextFound && getDistance(endPt, at(lines, 0).start) < delta) return false;
    if (idx === lines.length - 1 && prevFound && getDistance(endPt, at(lines, lines.length - 1).end) < delta) {
      return false;
    }

    if (prevAllFound) {
      this.merge(side, poly, idx, endPt, 0);
      return true;
    }
    if (nextAllFound) {
      this.merge(side, poly, idx, endPt, 1);
      return true;
    }
    return false;
  }

  private merge(side: number, poly: CxPoly, idx: number, pt: Point, dir: number): void {
    const lines = this.getMergeLineParts(poly, idx, pt, dir);
    if (lines.length === 0) return;
    const isCurve = poly.shape().isCurve;
    if (!isCurve || lines.length === 1) {
      this.addParts(side, lines, 0);
      return;
    }
    const cid = this.nextCurveId;
    this.nextCurveId++;
    const first = lines.shift() as LinePart;
    const p = part(side === LEFT ? swapped(first) : first, cid);
    const plines = poly.lines;
    const ext = dir === 0 ? at(plines, 0) : at(plines, plines.length - 1);
    p.curveExtendTo = new LinePoint(ext.line, dir === 0 ? ext.start : ext.end);
    if (side === LEFT) this.parts.unshift(p);
    else this.parts.push(p);
    this.addParts(side, lines, cid);
  }

  private addParts(side: number, lps: readonly LinePart[], cid: number): void {
    for (const item of lps) {
      if (side === LEFT) this.parts.unshift(part(swapped(item), cid));
      else this.parts.push(part(item, cid));
    }
  }

  /** C++ `finalize`. */
  finalize(): void {
    if (this.parts.length === 0) return;

    // First meld the curves into their neighbours.
    const findCurveIdx = (from: number): number => {
      while (from < this.parts.length) {
        if ((this.parts[from] as Part).curveExtendTo !== null) return from;
        from++;
      }
      return from;
    };
    let next = findCurveIdx(1);
    while (next < this.parts.length) {
      const cur = at(this.parts, next);
      if (cur.curveId !== at(this.parts, next - 1).curveId) {
        this.mergeCurveLeft(next);
      } else if (next < this.parts.length - 1 && cur.curveId !== at(this.parts, next + 1).curveId) {
        this.mergeCurveRight(next);
      }
      next = findCurveIdx(next + 1);
    }

    let idx = 0;
    while (idx < this.parts.length) {
      if (at(this.parts, idx).curveId !== 0) idx = this.stretchCurve(idx);
      else idx++;
    }

    this.joinSingleLines();

    idx = 0;
    while (idx < this.parts.length) {
      if (at(this.parts, idx).curveId === 0) {
        this.addSegment(idx);
        idx++;
      } else {
        idx = this.addCurve(idx);
      }
    }
    this.smoothen();
  }

  private addSegment(idx: number): void {
    const lp = at(this.parts, idx).linePart;
    // Very small segments are not added.
    if (getDistance(lp.start, lp.end) < 1.0) return;
    const pp = new PathPart();
    pp.segment = new LineSegment(lp.start, lp.end);
    pp.isCurve = false;
    this.out.push(pp);
  }

  private addCurve(idx: number): number {
    const startIdx = idx;
    const lps: LinePart[] = [];
    const cid = at(this.parts, idx).curveId;
    const smoothLeft = this.isSmoothAt(idx, 0);
    while (idx < this.parts.length && at(this.parts, idx).curveId === cid) {
      lps.push(at(this.parts, idx).linePart);
      idx++;
    }
    const smoothRight = this.isSmoothAt(idx - 1, 1);
    const rawPoints: Point[] = [];
    for (const lp of lps) {
      const { points, reverse } = lp.points();
      if (reverse) {
        for (let j = points.size - 1; j >= 0; j--) rawPoints.push(points.at(j));
      } else {
        for (let j = 0; j < points.size; j++) rawPoints.push(points.at(j));
      }
    }
    const curves = CurveFitter.fitSingle(rawPoints, 70);
    const c = curves[0];
    if (curves.length === 1 && c !== undefined && c.numPoints === 4) {
      const pp = new PathPart();
      pp.smoothLeft = smoothLeft;
      pp.smoothRight = smoothRight;
      pp.curve = c.clone();
      pp.curve.point1 = at(lps, 0).start;
      pp.curve.point4 = at(lps, lps.length - 1).end;
      pp.isCurve = true;
      this.out.push(pp);
    } else {
      for (let i = startIdx; i < idx; i++) this.addSegment(i);
    }
    return idx;
  }

  private isSmoothAt(idx: number, dir: number): boolean {
    if (idx < 0 || idx >= this.parts.length) return false;
    const p = at(this.parts, idx);
    const delta = this.config.linePartEqualityDelta;
    const step = dir === 0 ? -1 : 1;
    for (let i = idx + step; i >= 0 && i < this.parts.length; i += step) {
      const other = at(this.parts, i).linePart;
      if (other.length() > delta) return p.linePart.line.id === other.line.id;
    }
    return false;
  }

  private mergeCurveLeft(idx: number): void {
    const linePoint = at(this.parts, idx).curveExtendTo as LinePoint;
    const curveId = at(this.parts, idx).curveId;
    const eqDelta = this.config.linePartEqualityDelta;
    idx--;
    while (idx >= 0) {
      const p = at(this.parts, idx);
      if (p.curveId !== 0) break;
      const seg = new LineSegment(p.linePart.start, p.linePart.end);
      if (seg.inRange(linePoint.point, eqDelta)) {
        if (getDistance(linePoint.point, p.linePart.start) < eqDelta) {
          p.curveId = curveId;
        } else if (getDistance(linePoint.point, p.linePart.end) > eqDelta) {
          // C++ cuts the part at the point and inserts the "right piece" with the already-cut end,
          // so the inserted piece is zero-length (`Path.cpp:383-389`); replicated.
          p.linePart = p.linePart.withEnd(linePoint.point);
          const piece = part(new LinePart(p.linePart.line, linePoint.point, p.linePart.end), curveId);
          this.parts.splice(idx + 1, 0, piece);
        }
        break;
      }
      p.curveId = curveId;
      idx--;
    }
  }

  private mergeCurveRight(idx: number): void {
    const linePoint = at(this.parts, idx).curveExtendTo as LinePoint;
    const curveId = at(this.parts, idx).curveId;
    const eqDelta = this.config.linePartEqualityDelta;
    idx++;
    while (idx < this.parts.length) {
      const p = at(this.parts, idx);
      if (p.curveId !== 0) break;
      const seg = new LineSegment(p.linePart.start, p.linePart.end);
      if (seg.inRange(linePoint.point, eqDelta)) {
        if (getDistance(linePoint.point, p.linePart.end) < eqDelta) {
          p.curveId = curveId;
        } else if (getDistance(linePoint.point, p.linePart.start) > eqDelta) {
          // Same zero-length piece as in mergeCurveLeft (`Path.cpp:417-423`); replicated.
          p.linePart = p.linePart.withStart(linePoint.point);
          const piece = part(new LinePart(p.linePart.line, p.linePart.start, linePoint.point), curveId);
          this.parts.splice(idx, 0, piece);
        }
        break;
      }
      p.curveId = curveId;
      idx++;
    }
  }

  private stretchCurve(idx: number): number {
    const ratio = this.config.curveSideStretchRatio;
    const firstPt = at(this.parts, idx).linePart.start;
    const cid = at(this.parts, idx).curveId;
    let lastId = idx + 1;
    while (lastId < this.parts.length && at(this.parts, lastId).curveId === cid) lastId++;
    lastId--;
    const lastPt = at(this.parts, lastId).linePart.end;
    const lidDist = getDistance(firstPt, lastPt);

    if (idx > 0) {
      const prev = at(this.parts, idx - 1);
      const cur = at(this.parts, idx);
      if (prev.curveId === 0 && cur.linePart.line.id === prev.linePart.line.id) {
        if (getDistance(cur.linePart.start, prev.linePart.start) < lidDist * ratio) prev.curveId = cid;
      }
    }
    if (lastId < this.parts.length - 1) {
      const nxt = at(this.parts, lastId + 1);
      const last = at(this.parts, lastId);
      if (nxt.curveId === 0 && last.linePart.line.id === nxt.linePart.line.id) {
        if (getDistance(lastPt, nxt.linePart.end) < lidDist * ratio) nxt.curveId = cid;
        lastId++;
      }
    }
    return lastId + 1;
  }

  private joinSingleLines(): void {
    const out: Part[] = [at(this.parts, 0)];
    for (let i = 1; i < this.parts.length; i++) {
      const back = out[out.length - 1] as Part;
      const cur = at(this.parts, i);
      if (back.curveId === 0 && cur.curveId === 0 && back.linePart.line.id === cur.linePart.line.id) {
        out[out.length - 1] = { ...back, linePart: back.linePart.withEnd(cur.linePart.end) };
      } else {
        out.push(cur);
      }
    }
    this.parts = out;
  }

  /** C++ `getMergeLineParts`: the poly's parts from `idx` on (dir 0) or back (dir 1), starting at `pt`. */
  private getMergeLineParts(poly: CxPoly, idx: number, pt: Point, dir: number): LinePart[] {
    const result: LinePart[] = [];
    const lines = poly.lines;
    if (dir === 0) {
      for (let cur = idx; cur < lines.length; cur++) {
        const lp = at(lines, cur);
        result.push(cur === idx ? lp.withStart(pt) : lp);
      }
    } else {
      for (let cur = idx; cur >= 0; cur--) {
        const lp = swapped(at(lines, cur));
        result.push(cur === idx ? lp.withStart(pt) : lp);
      }
    }
    return result;
  }

  private smoothen(): void {
    const path = this.out;
    for (let i = 0; i < path.length; i++) {
      const pp = path[i] as PathPart;
      if (!pp.isCurve) continue;
      const curve = pp.curve;
      if (i > 0 && pp.smoothLeft) {
        const prev = path[i - 1] as PathPart;
        const second = curve.point1;
        const first = prev.isCurve ? prev.curve.point3 : prev.segment.point1();
        const dist = getDistance(curve.point1, curve.point2) + getDistance(first, second);
        curve.point2 = getPointAtDistance(first, second, dist);
      }
      if (i < path.length - 1 && pp.smoothRight) {
        const nxt = path[i + 1] as PathPart;
        if (!(nxt.isCurve && nxt.smoothLeft)) {
          const second = curve.point4;
          const first = nxt.isCurve ? nxt.curve.point2 : nxt.segment.point2();
          const dist = getDistance(curve.point3, curve.point4) + getDistance(first, second);
          curve.point3 = getPointAtDistance(first, second, dist);
        }
      }
    }
  }
}
