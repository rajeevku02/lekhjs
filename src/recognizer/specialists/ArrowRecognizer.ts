// Arrow recognizer (port of C++ `recognizer/ArrowRecognizer`): a small stroke at a line end adds an
// arrowhead (open, or solid when the stroke closes), a stroke across an arrowhead erases it, and a
// chevron between two parallel lines of about equal length turns them into a double-line arrow.
import {
  getAmplitudePointIndex,
  getAngle,
  getDistance,
  getMidPoint,
  getPointAtDistance,
  getPointsBound,
  getPointsForArrow,
  hasLoop,
  LineEquation,
  LineSegment,
  Point,
  SimplePolygon,
  type SimplePath,
} from '../../geometry';
import { INT_MAX } from '../../base';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { FetchShapeType, type CanvasDelegate } from '../delegate/CanvasDelegate';
import type { ObjectId } from '../delegate/RecMutation';
import { Line2Line } from '../lines/Line2Line';
import { areAlmostEqual, at, getErrSize2 } from '../lines/RecognizerUtil';
import { PolyMatcher } from '../shapes/PolyMatcher';

const maxArrowBoundLimit = 250;
const maxEndPointDistForArrow = 50;

interface LineInfo {
  line: LineSegment;
  object: ObjectId | null;
}

export class ArrowRecognizer {
  private readonly config: RecognizerConfig;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  recognize(path: SimplePath, extendedPath: boolean, excludes: ReadonlySet<ObjectId>, canvas: CanvasDelegate): boolean {
    // TODO (C++): handle loop in the path
    if (this.recognizeDoubleLineArrow(path, excludes, canvas)) return true;
    // An extended path may itself be an arrow object, deleted later by the Recognizer; C++ cannot
    // match the IArrowObject pointer against it, so it gives up here.
    if (extendedPath) return false;
    if (this.recognizeArrow(path, canvas)) return true;
    if (this.recognizeArrowErase(path, canvas)) return true;
    return false;
  }

  private recognizeDoubleLineArrow(path: SimplePath, excluded: ReadonlySet<ObjectId>, canvas: CanvasDelegate): boolean {
    const cfg = this.config;
    const points = path.points();
    if (points.length < 3) return false;

    points.push(at(points, 0));
    if (!new SimplePolygon(points).canMakeConvex()) return false;
    points.pop();
    if (new SimplePolygon(points).canClose()) return false;

    const p0 = at(points, 0);
    const p2 = at(points, points.length - 1);
    const eq = LineEquation.through(p0, p2);
    const p1 = at(points, getAmplitudePointIndex(points, eq)); // the peak

    let bound = getPointsBound(points);
    bound = bound.inflate(Math.max(bound.width, bound.height));
    const shapes = canvas.getExistingShapes([bound], FetchShapeType.Line, excluded);
    if (shapes.length < 2) return false;

    const lines: [LineInfo, LineInfo][] = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const si = at(shapes, i);
        const sj = at(shapes, j);
        const line1 = si.path.at(0).segment;
        const line2 = sj.path.at(0).segment;
        if (this.isParallelForArrow(line1, line2) && this.almostSameLength(line1, line2)) {
          lines.push([
            { line: line1, object: si.object },
            { line: line2, object: sj.object },
          ]);
        }
      }
    }

    let found: { l1: LineInfo; l2: LineInfo; center: Point; lineDist: number; len: number; firstSide: boolean } | null =
      null;
    let minAngle = INT_MAX;
    const arrowCloseSeg = new LineSegment(p0, p2);

    for (const [line1, line2] of lines) {
      if (arrowCloseSeg.getIntersection(line1.line) === null && arrowCloseSeg.getIntersection(line2.line) === null) {
        continue;
      }
      const vtx = [line1.line.point1(), line1.line.point2(), line2.line.point1(), line2.line.point2()];
      const center = getMidPoint(vtx);
      const mid = new Point((p0.x + p2.x) / 2, (p0.y + p2.y) / 2);
      const angle = getAngle(center, mid, p1);

      if (angle < cfg.maxAngleFor2LinArrowRecognition && angle < minAngle) {
        const eq2 = LineEquation.through(line1.line.point1(), line1.line.point2());
        const lineDist = eq2.getDistanceFrom(line2.line.point2());
        if (lineDist + cfg.closePointDistanceShort > arrowCloseSeg.length()) continue;
        if (lineDist * 4 < arrowCloseSeg.length()) continue;

        const lineLength = Math.max(line1.line.length(), line2.line.length());
        let dist = lineLength / 2 + lineDist * 1.5;
        if (lineDist < cfg.endPointDistForArrow) dist = lineLength / 2 + cfg.endPointDistForArrow;
        dist += getErrSize2(dist);
        const distFromCenter = getDistance(center, p1);

        if (dist >= distFromCenter && distFromCenter > lineLength / 4) {
          const d1 = getDistance(p1, line1.line.point1());
          const d2 = getDistance(p1, line1.line.point2());
          minAngle = angle;
          found = { l1: line1, l2: line2, center, lineDist, len: lineLength, firstSide: d1 < d2 };
        }
      }
    }

    if (found !== null && found.l1.object !== null && found.l2.object !== null) {
      canvas.addDoubleLineArrow({
        center: found.center,
        firstSide: found.firstSide,
        len: found.len,
        lineDist: found.lineDist,
        obj1: found.l1.object,
        seg1: found.l1.line,
        obj2: found.l2.object,
        seg2: found.l2.line,
      });
      return true;
    }
    return false;
  }

  private recognizeArrow(path: SimplePath, canvas: CanvasDelegate): boolean {
    const cfg = this.config;
    const vertices = path.points();
    if (vertices.length < 3) return false;

    const bound = getPointsBound(vertices);
    const strokeWidth = canvas.currentStrokeWidth();
    const zoom = canvas.getZoom();

    let endPointDistForArrow = cfg.endPointDistForArrow;
    let arrowDrawBoundLimit = cfg.arrowDrawBoundLimit;
    if (zoom > 1.0) {
      arrowDrawBoundLimit *= zoom;
      if (arrowDrawBoundLimit > maxArrowBoundLimit) arrowDrawBoundLimit = maxArrowBoundLimit;
      endPointDistForArrow *= zoom;
      if (endPointDistForArrow > maxEndPointDistForArrow) endPointDistForArrow = maxEndPointDistForArrow;
    }

    const boundWidth = bound.width;
    const boundHeight = bound.height;
    if (boundWidth > arrowDrawBoundLimit + strokeWidth * 2 || boundHeight > arrowDrawBoundLimit + strokeWidth * 2) {
      return false;
    }

    let closed = new SimplePolygon(vertices).canClose();
    vertices.push(at(vertices, 0));
    if (!new SimplePolygon(vertices).canMakeConvex()) return false;
    vertices.pop();

    if (!closed) {
      const endPointDist = getDistance(at(vertices, 0), at(vertices, vertices.length - 1));
      if (endPointDist < Math.min(boundWidth / 2, boundHeight / 2) || hasLoop(vertices)) closed = true;
    }
    if (closed) {
      vertices.pop();
      return this.recognizeSolidArrow(vertices, canvas);
    }

    const first = at(vertices, 0);
    const last = at(vertices, vertices.length - 1);
    const peak = at(vertices, getAmplitudePointIndex(vertices, LineEquation.through(first, last)));
    // C++ then narrows `vertices` to {front, peak, back}; only `peak` and the ends are read below.

    const aobjs = canvas.getArrowObjects();
    let foundIdx = -1;
    let arrowAt = new Point();
    let angleWithFound = INT_MAX;
    const seg = new LineSegment(first, last);

    for (let i = 0; i < aobjs.length; i++) {
      const aobj = at(aobjs, i);
      for (const apt of aobj.points) {
        if (apt.hasArrow) continue;
        const ap1 = apt.p1;
        const ap2 = this.extendedArrowPt(ap1, apt.p2);
        const intersectPt = seg.getIntersectionWithLine(LineEquation.through(ap1, ap2));
        if (intersectPt === null) continue;
        const dist = getDistance(ap1, peak);
        if (dist < endPointDistForArrow + (aobj.strokeWidth + strokeWidth)) {
          const angle = getAngle(ap2, intersectPt, peak);
          const threshold = aobj.isSingleCurve ? cfg.maxAngleForArrowOnCurve : cfg.maxAngleForArrow;
          if (angle < threshold && angle < angleWithFound) {
            foundIdx = i;
            angleWithFound = angle;
            arrowAt = apt.p1;
          }
        }
      }
    }

    if (foundIdx >= 0) {
      canvas.changeArrow({ obj: at(aobjs, foundIdx).obj, add: true, at: arrowAt, solid: false });
      return true;
    }
    return false;
  }

  private recognizeSolidArrow(pts: readonly Point[], canvas: CanvasDelegate): boolean {
    const polym = new PolyMatcher(pts);
    polym.process();
    const vertices = polym.vertices();
    if (vertices.length > 4) return false;

    const center = getMidPoint(vertices);
    const bound = getPointsBound(vertices).inflate(this.config.closePointDistanceShort);

    const aobjs = canvas.getArrowObjects();
    let foundIdx = -1;
    let arrowAt = new Point();
    let dist = INT_MAX;
    for (let i = 0; i < aobjs.length; i++) {
      for (const apt of at(aobjs, i).points) {
        if (apt.hasArrow) continue;
        if (bound.contains(apt.p1)) {
          const tmp = getDistance(apt.p1, center);
          if (tmp < dist) {
            dist = tmp;
            foundIdx = i;
            arrowAt = apt.p1;
          }
        }
      }
    }
    if (foundIdx >= 0) {
      canvas.changeArrow({ obj: at(aobjs, foundIdx).obj, add: true, at: arrowAt, solid: true });
      return true;
    }
    return false;
  }

  private recognizeArrowErase(path: SimplePath, canvas: CanvasDelegate): boolean {
    const cfg = this.config;
    const sp1 = path.front().firstPoint();
    const sp2 = path.back().lastPoint();
    const eq = LineEquation.through(sp1, sp2);
    const endSeg = new LineSegment(sp1, sp2);
    const vertices = path.points();

    if (new SimplePolygon(vertices).canClose()) return false;
    const polym = new PolyMatcher(vertices);
    polym.process();
    if (polym.vertices().length > 3) return false;

    const strokeWidth = canvas.currentStrokeWidth();
    const zoom = canvas.getZoom();
    let arrowDrawBoundLimit = cfg.arrowDrawBoundLimit;
    if (zoom > 1.0) {
      arrowDrawBoundLimit *= zoom;
      if (arrowDrawBoundLimit > maxArrowBoundLimit) arrowDrawBoundLimit = maxArrowBoundLimit;
    }
    const bound = getPointsBound(vertices);
    if (bound.width > arrowDrawBoundLimit || bound.height > arrowDrawBoundLimit) return false;

    let amp = 0;
    for (const pt of vertices) {
      const tmp = eq.getDistanceFrom(pt);
      if (tmp > amp) amp = tmp;
    }
    if (amp > arrowDrawBoundLimit / 2) return false;

    let pr: { obj: ObjectId; at: Point } | null = null;
    let minDist = INT_MAX;
    for (const aobj of canvas.getArrowObjects()) {
      for (const apt of aobj.points) {
        if (!apt.hasArrow) continue;
        const alen = (cfg.minLenOfArrow + strokeWidth / 2) * zoom;
        const tri = getPointsForArrow(apt.p2, apt.p1, alen, alen);
        const triBound = getPointsBound(tri).inflate(28);
        const tbpts = triBound.getPoints();
        let consider = triBound.contains(sp1) || triBound.contains(sp2);
        for (let k = 0; k < tbpts.length; k++) {
          const l = (k + 1) % tbpts.length;
          if (new LineSegment(at(tbpts, k), at(tbpts, l)).getIntersection(endSeg) !== null) {
            consider = true;
            break;
          }
        }
        if (consider) {
          const tmpDist = eq.getDistanceFrom(apt.p1);
          if (tmpDist < minDist) {
            minDist = tmpDist;
            pr = { obj: aobj.obj, at: apt.p1 };
          }
        }
      }
    }

    if (minDist < INT_MAX && pr !== null) {
      // C++ leaves `aop.solid` uninitialised on an erase (unread there); false here.
      canvas.changeArrow({ obj: pr.obj, add: false, at: pr.at, solid: false });
      return true;
    }
    return false;
  }

  private isParallelForArrow(seg1: LineSegment, seg2: LineSegment): boolean {
    const l2l = new Line2Line(
      seg1.point1(),
      seg1.point2(),
      seg2.point1(),
      seg2.point2(),
      this.config.closePointDistance,
    );
    if (l2l.intersects) return false;
    if (l2l.parallel && l2l.connected) {
      const eq = LineEquation.through(seg1.point1(), seg1.point2());
      const dist = (eq.getDistanceFrom(seg2.point1()) + eq.getDistanceFrom(seg2.point2())) / 2;
      if (dist < this.config.minLineDistFor2LineArrow) return false;
    }
    if (l2l.parallel) return true;

    const eq = LineEquation.through(seg1.point1(), seg1.point2());
    let d1 = eq.getDistanceFrom(seg2.point1());
    let d2 = eq.getDistanceFrom(seg2.point2());
    if (d1 > d2) [d1, d2] = [d2, d1];
    return d1 > (2 * d2) / 3;
  }

  private almostSameLength(seg1: LineSegment, seg2: LineSegment): boolean {
    let d1 = getDistance(seg1.point1(), seg1.point2());
    let d2 = getDistance(seg2.point1(), seg2.point2());
    if (areAlmostEqual(d1, d2, 2)) return true;
    if (d1 > d2) [d1, d2] = [d2, d1];
    const d = LineEquation.through(seg1.point1(), seg1.point2()).getDistanceFrom(seg2.point1());
    let err = getErrSize2(d2);
    if (d > err) err *= 2;
    else err += d;
    return d2 - d1 <= err;
  }

  private extendedArrowPt(p1: Point, p2: Point): Point {
    const bigDist = 500;
    if (getDistance(p1, p2) < bigDist) return getPointAtDistance(p1, p2, bigDist);
    return p2;
  }
}
