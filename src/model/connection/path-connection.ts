// A free path connector (port of C++ `PathConnection`): stored per-component offsets (`dx`/`dy`,
// and `dc1x…dc2y` for a curve component) laid from both ends towards the middle.
import {
  BezierCurve,
  LineSegment,
  Point,
  PointType,
  Rect,
  SimplePath,
  getDistance,
  getPointAtDistance,
  type PathComponent,
  distanceToSegment,
} from '../../geometry';
import type { InterestingPoint } from '../../template';
import { Connection } from './connection';
import { LineConnectionEndPoint } from './end-point';
import {
  ConnectionParam as P,
  cloneParams,
  type ConnectionType,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './types';

/** C++ `PathConnection::PathPart`. */
interface PathPart {
  readonly segments: LineSegment[];
  readonly len: number;
  startT: number;
  endT: number;
}

/** C++ `PathConnection::Vertex`. */
interface Vertex {
  pcId: number;
  pid: number;
  point: Point;
  type: PointType;
}

function has(m: ParamMap | undefined, k: string): boolean {
  return m !== undefined && m[k] !== undefined;
}

export class PathConnection extends Connection {
  private readonly ep1_: LineConnectionEndPoint;
  private readonly ep2_: LineConnectionEndPoint;
  private params_: Params = [];
  private savedParams_: Params = [];

  constructor(host: RouteHost, type: ConnectionType) {
    super(host, type);
    this.ep1_ = new LineConnectionEndPoint(host.config);
    this.ep2_ = new LineConnectionEndPoint(host.config);
    for (const [ep, obj] of [
      [this.ep1_, this.first_],
      [this.ep2_, this.second_],
    ] as const) {
      ep.setType(type);
      ep.setStyle(host.style);
      ep.setObj(obj);
      ep.setAuto(false);
    }
  }

  private static isParamsValid(params: Params): boolean {
    if (params.length < 2) return false;
    if (!has(params[0], P.angle) || !has(params[params.length - 1], P.angle)) return false;
    for (const pm of params) {
      if (!has(pm, P.dx) || !has(pm, P.dy)) return false;
      if (has(pm, P.dc1x) && (!has(pm, P.dc1y) || !has(pm, P.dc2x) || !has(pm, P.dc2y))) return false;
    }
    return true;
  }

  override setParams(params: Params): void {
    if (!PathConnection.isParamsValid(params)) return;
    this.params_ = cloneParams(params);
    this.ep1_.setAngle((this.params_[0] as ParamMap)[P.angle] as number);
    this.ep2_.setAngle((this.params_[this.params_.length - 1] as ParamMap)[P.angle] as number);
  }

  override getParams(): Params {
    return cloneParams(this.params_);
  }

  override update(): void {
    const path = new SimplePath();
    this.host_.paths = [path];
    this.ep1_.computeP1(this.ep2_);
    this.ep2_.computeP1(this.ep1_);
    const ps = this.params_;
    const mid = Math.trunc(ps.length / 2);
    const v = (i: number, k: string) => (ps[i] as ParamMap)[k] ?? 0;
    const points1: Point[] = [];
    let last = this.ep1_.p1();
    points1.push(last);
    for (let i = 0; i < mid; i++) {
      last = last.withDelta(v(i, P.dx), v(i, P.dy));
      points1.push(last);
    }
    const points2: Point[] = [];
    last = this.ep2_.p1();
    points2.push(last);
    for (let i = ps.length - 1; i > mid; i--) {
      last = last.withDelta(-v(i, P.dx), -v(i, P.dy));
      points2.push(last);
    }
    points1.push(...points2.reverse());
    for (let i = 0; i < points1.length - 1; i++) {
      const a = points1[i] as Point;
      const b = points1[i + 1] as Point;
      if (i < ps.length && has(ps[i], P.dc1x)) {
        const curve = new BezierCurve(
          a,
          a.withDelta(v(i, P.dc1x), v(i, P.dc1y)),
          a.withDelta(v(i, P.dc2x), v(i, P.dc2y)),
          b,
          4,
        );
        path.addCurve(curve);
      } else {
        path.addSegment(new LineSegment(a, b));
      }
    }
  }

  private moveEndPointFallback(ep: LineConnectionEndPoint, pt: Point): Point {
    return ep.moveVertex(pt) ?? ep.p1();
  }

  override moveVertexTo(vid: number, pt: Point): Point {
    const path = this.host_.paths[0];
    if (path === undefined) return pt;
    if (vid === 0) return this.moveEndPointFallback(this.ep1_, pt);
    const vertices = this.vertices();
    if (vid === vertices.length - 1) return this.moveEndPointFallback(this.ep2_, pt);
    const vtx = vertices[vid] as Vertex;
    const pcId = vtx.pcId;
    const prev = (vtx.pid === 2 ? vertices[vid - 2] : vertices[vid - 1]) as Vertex;
    const nextV = vertices[vid + 1] as Vertex;
    const next = (nextV.pid === 1 ? vertices[vid + 2] : nextV) as Vertex;
    const ps = this.params_;
    if (vtx.pid === 0 || vtx.pid === 2) {
      const a = ps[pcId] as ParamMap;
      a[P.dx] = pt.x - prev.point.x;
      a[P.dy] = pt.y - prev.point.y;
      const b = ps[pcId + 1] as ParamMap;
      b[P.dx] = next.point.x - pt.x;
      b[P.dy] = next.point.y - pt.y;
    } else {
      const pc = path.at(pcId);
      if (pc.isCurve) {
        const bz = pc.curve.clone();
        bz.moveSingleControlPoint(pt);
        const a = ps[pcId] as ParamMap;
        a[P.dc1x] = bz.point2.x - prev.point.x;
        a[P.dc1y] = bz.point2.y - prev.point.y;
        a[P.dc2x] = bz.point3.x - prev.point.x;
        a[P.dc2y] = bz.point3.y - prev.point.y;
      }
    }
    return pt;
  }

  private vertices(): Vertex[] {
    const result: Vertex[] = [];
    const path = this.host_.paths[0];
    if (path === undefined) return result;
    path.components.forEach((pc, i) => {
      if (pc.isCurve) {
        if (result.length === 0) result.push({ pcId: i, pid: 0, point: pc.curve.point1, type: PointType.Attr });
        result.push({ pcId: i, pid: 1, point: pc.curve.getSingleControl(), type: PointType.ControlAttr });
        result.push({ pcId: i, pid: 2, point: pc.curve.point4, type: PointType.Attr });
      } else {
        // C++ left `pid` as the previous vertex's for the first one.
        if (result.length === 0) result.push({ pcId: i, pid: 0, point: pc.segment.point1(), type: PointType.Attr });
        result.push({ pcId: i, pid: 0, point: pc.segment.point2(), type: PointType.Attr });
      }
    });
    return result;
  }

  /** C++ re-routed here; the route is the layout's (B9). */
  override getInterestingPoints(): InterestingPoint[] {
    return this.vertices().map((v) => ({ point: v.point, type: v.type }));
  }

  private lines(): LineSegment[] {
    const segs: LineSegment[] = [];
    const path = this.host_.paths[0];
    if (path === undefined) return segs;
    for (const pc of path.components) {
      if (pc.isCurve) pc.curve.approxLines(segs, this.host_.config.tapToSelectDistance);
      else segs.push(pc.segment);
    }
    return segs;
  }

  /** C++ held the distance in an `int`: truncated. */
  override getDistanceFrom(pt: Point): number {
    let dist = 2147483647;
    for (const seg of this.lines()) {
      const tmp = distanceToSegment(seg.p1, seg.p2, pt);
      if (tmp < dist) dist = Math.trunc(tmp);
    }
    return dist;
  }

  override getSelectionRectangle(): Rect {
    const segs = this.lines();
    const s0 = segs[0];
    if (s0 === undefined) return new Rect();
    let rect = Rect.fromCenter(s0.point1(), 1, 1);
    for (const seg of segs) rect = rect.include(seg.point1()).include(seg.point2());
    return rect;
  }

  private parts(): PathPart[] {
    const parts: PathPart[] = [];
    const path = this.host_.paths[0];
    if (path === undefined) return parts;
    let len = 0;
    for (const pc of path.components) {
      const p = makePart(pc, this.host_.config.tapToSelectDistance);
      parts.push(p);
      len += p.len;
    }
    if (len <= 0.001) return parts;
    let tSum = 0;
    for (const part of parts) {
      part.startT = tSum / len;
      tSum += part.len;
      part.endT = tSum / len;
    }
    return parts;
  }

  override getTFor(pt: Point): { t: number; dist: number; at: Point } | null {
    const path = this.host_.paths[0];
    if (path === undefined) return null;
    let dist = 2147483647;
    let at = new Point();
    let atT = 0;
    const parts = this.parts();
    const totalLen = parts.reduce((s, p) => s + p.len, 0);
    if (totalLen === 0) return { t: 0, dist, at };
    let partSum = 0;
    parts.forEach((part, i) => {
      let sum = 0;
      let foundSum = 0;
      let found = false;
      for (const seg of part.segments) {
        const r = seg.getDistanceFrom(pt);
        if (r.dist < dist) {
          dist = r.dist;
          at = r.near;
          found = true;
          foundSum = sum + getDistance(seg.point1(), r.near);
        }
        sum += seg.length();
      }
      if (found) {
        atT = (foundSum + partSum) / totalLen;
        const deltaT = part.endT - part.startT;
        const pc = path.at(i);
        if (pc.isCurve && deltaT > 0) at = pc.curve.getPoint((atT - part.startT) / deltaT);
      }
      partSum += part.len;
    });
    return { t: atT, dist, at };
  }

  override updateTextCenters(): void {
    const path = this.host_.paths[0];
    if (path === undefined) return;
    this.parts().forEach((part, i) => {
      const { startT, endT } = part;
      if (endT - startT <= 0) return;
      for (const ti of this.host_.texts) {
        if (ti.param >= startT && ti.param < endT) {
          const t = (ti.param - startT) / (endT - startT);
          const pc = path.at(i);
          ti.center = pc.isCurve
            ? pc.curve.getPoint(t)
            : getPointAtDistance(pc.segment.point1(), pc.segment.point2(), part.len * t);
        }
      }
    });
  }

  override startModification(): void {
    this.savedParams_ = cloneParams(this.params_);
  }

  override vertexEdit(): VertexEdit {
    return { params: this.getParams(), saved: cloneParams(this.savedParams_) };
  }
}

function makePart(pc: PathComponent, minErr: number): PathPart {
  const segments: LineSegment[] = pc.isCurve ? pc.curve.approxLines([], minErr) : [pc.segment];
  let len = 0;
  for (const s of segments) len += s.length();
  return { segments, len, startT: 0, endT: 0 };
}
