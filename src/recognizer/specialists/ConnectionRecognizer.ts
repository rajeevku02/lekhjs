// Connection recognizer (port of C++ `recognizer/ConnectionRecognizer`): a stroke from one shape to
// another becomes a connector. Straight or right-angled polylines become auto lines (autoType 1-7)
// or a stored orthogonal route; one convex curve a curved connector; an S of two curves an S
// connector; anything else a free path connector.
//
// Units are as C++: the params and `val` carry VIEW distances (the C++ never divides by the zoom
// here, unlike SelfLoopRecognizer).
import {
  getAngle,
  getDistance,
  LineEquation,
  LineSegment,
  normalizeAngleInPI,
  Point,
  Rect,
  type BezierCurve,
  type SimplePath,
} from '../../geometry';
import { INT_MAX } from '../../base';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { CanvasDelegate, ConnectionDetail, ObjectForConnection, ParamMap } from '../delegate/CanvasDelegate';
import type { ObjectId } from '../delegate/RecMutation';
import { at } from '../lines/RecognizerUtil';

interface PerpStep {
  dx: number;
  dy: number;
  val: number;
}

function newDetail(): ConnectionDetail {
  return { obj1: null, obj2: null, params: [], type: 0, autoType: 0, val: 0 };
}

export class ConnectionRecognizer {
  private readonly config: RecognizerConfig;
  // Per-recognize state, as the C++ members.
  private path: SimplePath | null = null;
  private lines: LineSegment[] = [];
  private curves: BezierCurve[] = [];
  private targetObjects: ObjectForConnection[] = [];
  private deletedObjects: ReadonlySet<ObjectId> = new Set();
  private canvas: CanvasDelegate | null = null;
  private convex = false;
  private poly = false;

  constructor(config: RecognizerConfig) {
    this.config = config;
  }

  /** C++ `recognize(SimplePath* path, SimplePath* recognizedPath, bool convex, excluded, canvas)`. */
  recognize(
    path: SimplePath,
    recognizedPath: SimplePath,
    convex: boolean,
    excluded: ReadonlySet<ObjectId>,
    canvas: CanvasDelegate,
  ): boolean {
    this.path = path;
    this.canvas = canvas;
    this.convex = convex;
    this.deletedObjects = new Set(excluded);

    if (!this.config.recognizeConnection) return false;

    this.targetObjects = canvas.getShapesForConnection(path.front().firstPoint(), path.back().lastPoint(), excluded);
    if (this.targetObjects.length !== 2) return false;

    this.init();
    if (this.poly) return this.makePolyConnection();
    this.path = recognizedPath;
    this.init();
    return this.makeCurveConnection();
  }

  private init(): void {
    this.lines = [];
    this.curves = [];
    for (const pc of this.thePath().components) {
      pc.lines(this.lines);
      if (pc.isCurve) this.curves.push(pc.curve);
    }
    this.poly = this.curves.length === 0;
  }

  private target(i: 0 | 1): ObjectForConnection {
    return at(this.targetObjects, i);
  }

  private makePolyConnection(): boolean {
    const cfg = this.config;
    const lines = this.lines;
    const pts: Point[] = [];
    // C++ `auto angleSum = 0;` is an int: every `+=` truncates toward zero.
    let angleSum = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const li = at(lines, i);
      const angle = getAngle(li.point1(), li.point2(), at(lines, i + 1).point2());
      if (angle < cfg.connectionLinesAngleRangeEnd) {
        angleSum = Math.trunc(angleSum + angle);
        if (angleSum > cfg.connectionLinesAngleRangeStart) {
          pts.push(li.point2());
          angleSum = 0;
        }
      } else {
        return this.makePolyPathConnection();
      }
    }

    const t0 = this.target(0);
    const t1 = this.target(1);
    if (pts.length === 0) {
      const first = at(lines, 0).point1();
      const second = at(lines, lines.length - 1).point2();
      const endAngle = (ofc: ObjectForConnection, other: Point): number => {
        const eq = LineEquation.through(first, second);
        const rpts = Rect.fromCenter(ofc.center, ofc.width, ofc.height).getPoints();
        let dist = INT_MAX;
        let atPt = new Point();
        let found = false;
        for (let i = 0; i < rpts.length; i++) {
          const j = (i + 1) % rpts.length;
          const tmpPt = new LineSegment(at(rpts, i), at(rpts, j)).getIntersectionWithLine(eq);
          if (tmpPt !== null) {
            const d = getDistance(tmpPt, other);
            if (d < dist) {
              dist = d;
              atPt = tmpPt;
              found = true;
            }
          }
        }
        if (!found) return 0;
        return Math.atan2(atPt.y - ofc.center.y, atPt.x - ofc.center.x);
      };
      const angle1 = endAngle(t0, second);
      const angle2 = endAngle(t1, first);
      const cd = newDetail();
      cd.obj1 = t0.object;
      cd.obj2 = t1.object;
      cd.autoType = 1;
      cd.type = 2;
      cd.params.push({ angle: angle1, autotype: 0 });
      cd.params.push({ angle: angle2, autotype: 0 });
      this.canvasOrThrow().addConnection(cd, this.deletedObjects);
      return true;
    } else if (pts.length === 1) {
      const type = this.getConnectTypeForTwoLine(t0.center, at(pts, 0), t1.center);
      if (type < 0) return this.makePolyPathConnection();
      const cd = newDetail();
      cd.obj1 = t0.object;
      cd.obj2 = t1.object;
      cd.autoType = type;
      cd.type = 2;
      return this.addPolyConnection(cd);
    } else if (pts.length === 2) {
      const q0 = at(pts, 0);
      const q1 = at(pts, 1);
      const type1 = this.getConnectTypeForTwoLine(t0.center, q0, q1);
      if (type1 < 0) return this.makePolyPathConnection();
      const type2 = this.getConnectTypeForTwoLine(q0, q1, t1.center);
      if (type2 < 0) return this.makePolyPathConnection();

      let type: number;
      if (type1 === 2 && type2 === 3) type = 4;
      else if (type1 === 3 && type2 === 2) type = 5;
      else return this.makePolyPathConnection();

      // type is 4 or 5 here
      const r = this.checkForType6Or7(type, t0.center, q0, q1, t1.center);
      type = r.type;
      let connectDist = r.connectDist;
      if (type === 6 || type === 7) {
        const diff = type === 6 ? Math.min(t0.width / 2, t1.width / 2) : Math.min(t0.height / 2, t1.height / 2);
        const ft = connectDist < 0 ? -1 : 1;
        connectDist = Math.abs(connectDist);
        connectDist -= diff;
        if (connectDist < 0) connectDist = 10;
        connectDist *= ft;
      }
      const cd = newDetail();
      cd.obj1 = t0.object;
      cd.obj2 = t1.object;
      cd.autoType = type;
      cd.type = 2;
      cd.val = connectDist;
      return this.addPolyConnection(cd);
    }
    return this.makePolyPathConnection();
  }

  private addPolyConnection(cd: ConnectionDetail): boolean {
    const canvas = this.canvasOrThrow();
    // obj1/obj2 are the two target objects, never null here.
    if (canvas.isAutoConnectionPresent(cd.obj1 as ObjectId, cd.obj2 as ObjectId, cd.autoType)) {
      return this.makePolyPathConnection();
    }
    canvas.addConnection(cd, this.deletedObjects);
    return true;
  }

  private makePolyPathConnection(): boolean {
    // check if we can make all lines perpendicular to the next line
    const lines = this.lines;
    let pts: Point[] = [at(lines, 0).point1()];
    let angle1 = 40;
    let angle2 = 135;
    for (let i = 0; i < lines.length - 1; i++) {
      const li = at(lines, i);
      const angle = getAngle(li.point1(), li.point2(), at(lines, i + 1).point2());
      if (angle > angle2) return this.makePathConnection();
      if (angle > angle1) pts.push(li.point2());
    }
    pts.push(at(lines, lines.length - 1).point2());

    const t0 = this.target(0);
    const t1 = this.target(1);
    this.clipAtIntersection(pts, t0.object);
    pts = pts.reverse();
    this.clipAtIntersection(pts, t1.object);
    pts = pts.reverse();

    if (pts.length < 3) return this.makePathConnection();

    const getStep = (p1: Point, p2: Point): PerpStep => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (Math.abs(dx) < Math.abs(dy)) return { dx: 0, dy: dy < 0 ? -1 : 1, val: Math.abs(dy) };
      return { dx: dx < 0 ? -1 : 1, dy: 0, val: Math.abs(dx) };
    };
    const steps: PerpStep[] = [];
    let lastPoint = at(pts, 0);
    for (let i = 1; i < pts.length; i++) {
      const step = getStep(lastPoint, at(pts, i));
      const prev = steps[steps.length - 1];
      if (prev === undefined || (step.dx !== prev.dx && step.dy !== prev.dy)) {
        steps.push(step);
        lastPoint = at(pts, i);
      }
    }

    const first = at(pts, 0);
    const last = at(pts, pts.length - 1);
    angle1 = Math.atan2(first.y - t0.center.y, first.x - t0.center.x);
    angle2 = Math.atan2(last.y - t1.center.y, last.x - t1.center.x);
    const cd = newDetail();
    for (const step of steps) cd.params.push({ step: step.val, dx: step.dx, dy: step.dy });
    // steps is not empty: pts has at least three points
    const front = at(cd.params, 0);
    front.angle = angle1;
    front.autotype = 0;
    const back = at(cd.params, cd.params.length - 1);
    back.angle = angle2;
    back.autotype = 0;
    cd.obj1 = t0.object;
    cd.obj2 = t1.object;
    cd.autoType = 0;
    cd.type = 2;
    this.canvasOrThrow().addConnection(cd, this.deletedObjects);
    return true;
  }

  private makeCurveConnection(): boolean {
    if (this.curves.length !== 1 || !this.convex) return this.makeSConnection();

    let finalAngle = Math.PI / 3;
    const path = this.thePath();
    const c1 = path.front().firstPoint();
    const c2 = path.back().lastPoint();
    const amp = at(this.curves, 0).getSingleControl();
    const angle1 = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const angle2 = Math.atan2(amp.y - c1.y, amp.x - c1.x);
    const diff = normalizeAngleInPI(angle2 - angle1);
    if (diff < 0) finalAngle = -Math.PI / 3;

    const cd = newDetail();
    cd.params.push({ angle1: finalAngle, angle2: 0, cdist1: 0.4, angleauto: 1, cdistauto: 1 });
    cd.params.push({ angle1: -finalAngle, angle2: 0, cdist1: 0.4, angleauto: 1, cdistauto: 1 });
    cd.obj1 = this.target(0).object;
    cd.obj2 = this.target(1).object;
    cd.autoType = 0;
    cd.type = 0;
    this.canvasOrThrow().addConnection(cd, this.deletedObjects);
    return true;
  }

  private makeSConnection(): boolean {
    if (this.convex || this.curves.length !== 2) return this.makePathConnection();

    const endAngle = (c1: Point, c2: Point, amp: Point): number => {
      const a1 = Math.atan2(c2.y - c1.y, c2.x - c1.x);
      const a2 = Math.atan2(amp.y - c1.y, amp.x - c1.x);
      let diff = normalizeAngleInPI(a2 - a1);
      if (diff < 0) diff = -Math.PI / 3;
      return diff;
    };
    const c1 = this.target(0).center;
    const c2 = this.target(1).center;
    const angle1 = endAngle(c1, c2, at(this.curves, 0).getSingleControl());
    const angle2 = endAngle(c2, c1, at(this.curves, 1).getSingleControl());

    const cd = newDetail();
    cd.params.push({ angle1, angle2: 0, cdist1: 0.4, angleauto: 1, cdistauto: 1 });
    cd.params.push({ angle1: angle2, angle2: 0, cdist1: 0.4, angleauto: 1, cdistauto: 1 });
    cd.obj1 = this.target(0).object;
    cd.obj2 = this.target(1).object;
    cd.autoType = 0;
    cd.type = 0;
    this.canvasOrThrow().addConnection(cd, this.deletedObjects);
    return true;
  }

  private makePathConnection(): boolean {
    const path = this.thePath();
    if (path.size < 2) return false;
    const firstSegs = path.front().lines();
    const secondPt = at(firstSegs, 0).point2();
    let lastPt = at(firstSegs, 0).point1();
    const lastSegs = path.back().lines();
    const secondLastPt = at(lastSegs, lastSegs.length - 1).point1();

    const t0 = this.target(0);
    const t1 = this.target(1);
    const angle1 = Math.atan2(secondPt.y - t0.center.y, secondPt.x - t0.center.x);
    const angle2 = Math.atan2(secondLastPt.y - t1.center.y, secondLastPt.x - t1.center.x);

    const cd = newDetail();
    for (const pc of path.components) {
      const pm: ParamMap = {};
      if (pc.isCurve) {
        pm.dx = pc.curve.point4.x - lastPt.x;
        pm.dy = pc.curve.point4.y - lastPt.y;
        pm.dc1x = pc.curve.point2.x - lastPt.x;
        pm.dc1y = pc.curve.point2.y - lastPt.y;
        pm.dc2x = pc.curve.point3.x - lastPt.x;
        pm.dc2y = pc.curve.point3.y - lastPt.y;
        lastPt = pc.curve.point4;
      } else {
        pm.dx = pc.segment.point2().x - lastPt.x;
        pm.dy = pc.segment.point2().y - lastPt.y;
        lastPt = pc.segment.point2();
      }
      cd.params.push(pm);
    }
    at(cd.params, 0).angle = angle1;
    at(cd.params, cd.params.length - 1).angle = angle2;
    cd.obj1 = t0.object;
    cd.obj2 = t1.object;
    cd.autoType = 0;
    cd.type = 3;
    this.canvasOrThrow().addConnection(cd, this.deletedObjects);
    return true;
  }

  private getConnectTypeForTwoLine(c1: Point, p: Point, c2: Point): number {
    const dx1 = Math.abs(p.x - c1.x);
    const dx2 = Math.abs(p.x - c2.x);
    const dy1 = Math.abs(p.y - c1.y);
    const dy2 = Math.abs(p.y - c2.y);
    if (dx1 > dx2 && dy1 < dy2) return 2;
    if (dx1 < dx2 && dy1 > dy2) return 3;
    return -1;
  }

  /** C++ `checkForType6Or7(type, c1, p1, p2, c2, &connectDist)`. */
  private checkForType6Or7(
    type: number,
    c1: Point,
    p1: Point,
    p2: Point,
    c2: Point,
  ): { type: number; connectDist: number } {
    const mid = new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    if (type === 4) {
      let calcX = 0.0;
      let t = type;
      if (mid.x < c1.x && mid.x < c2.x) {
        calcX = Math.min(c1.x, c2.x);
        t = 6;
      } else if (mid.x > c1.x && mid.x > c2.x) {
        calcX = Math.max(c1.x, c2.x);
        t = 6;
      }
      return { type: t, connectDist: mid.x - calcX };
    } else if (type === 5) {
      let calcY = 0.0;
      let t = type;
      if (mid.y < c1.y && mid.y < c2.y) {
        calcY = Math.min(c1.y, c2.y);
        t = 7;
      } else if (mid.y > c1.y && mid.y > c2.y) {
        calcY = Math.max(c1.y, c2.y);
        t = 7;
      }
      return { type: t, connectDist: mid.y - calcY };
    }
    // C++ leaves connectDist untouched (its caller's 0).
    return { type, connectDist: 0 };
  }

  /** Cuts `pts` (in place) at the first crossing of `obj`'s outline. */
  private clipAtIntersection(pts: Point[], obj: ObjectId): void {
    if (pts.length < 2) return;
    const canvas = this.canvasOrThrow();
    for (let i = 0; i < pts.length - 1; i++) {
      const ints = canvas.getIntersections(obj, new LineSegment(at(pts, i), at(pts, i + 1)));
      const first = ints[0];
      if (first !== undefined) {
        pts.splice(0, i + 1, first);
        break;
      }
    }
  }

  private thePath(): SimplePath {
    if (this.path === null) throw new Error('ConnectionRecognizer: no path outside recognize');
    return this.path;
  }

  private canvasOrThrow(): CanvasDelegate {
    if (this.canvas === null) throw new Error('ConnectionRecognizer: no canvas outside recognize');
    return this.canvas;
  }
}
