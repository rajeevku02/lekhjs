// A Bézier connector (port of C++ `CurveConnection`): each end's control point lies along its
// outline normal turned by `angle2`, at `cdist1` (× the end distance when automatic).
import {
  BezierCurve,
  Point,
  PointType,
  Rect,
  getDistance,
  getPointAtDistance,
  getAngle,
  getTurnDir,
  toRadian,
  TurnDir,
} from '../../geometry';
import { INT_MAX } from '../../base';
import type { InterestingPoint } from '../../template';
import { Connection } from './connection';
import { CurveConnectionEndPoint } from './end-point';
import {
  ConnectionParam as P,
  cloneParams,
  type ConnectionType,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './types';

export class CurveConnection extends Connection {
  private readonly ep1_: CurveConnectionEndPoint;
  private readonly ep2_: CurveConnectionEndPoint;
  private renderedPoints_: Point[] = [];
  private selectionRectangle_ = new Rect();
  private pointsUpdatedFor_ = new BezierCurve();
  private renderStep_ = 0;
  private savedParams_: Params = [];

  constructor(host: RouteHost, type: ConnectionType) {
    super(host, type);
    this.ep1_ = new CurveConnectionEndPoint(host.config);
    this.ep2_ = new CurveConnectionEndPoint(host.config);
  }

  override update(): void {
    this.host_.curves = [this.getCurve()];
  }

  /** C++ `getCurve`: both ends placed, then both control points. */
  private getCurve(): BezierCurve {
    const e1 = this.ep1_;
    const e2 = this.ep2_;
    e1.setObj(this.first_);
    e1.setStyle(this.host_.style);
    e2.setObj(this.second_);
    e2.setStyle(this.host_.style);
    e1.computeP1(e2);
    e2.computeP1(e1);
    e1.computeP2(e2);
    e2.computeP2(e1);
    return new BezierCurve(e1.p1(), e1.p2(), e2.p2(), e2.p1());
  }

  override setParams(params: Params): void {
    const first = params[0];
    if (first === undefined) return;
    if (params.length === 1) {
      for (const k of Object.keys(first).sort()) this.setParam(k, first[k] as number);
      return;
    }
    const set = (vals: ParamMap, ep: CurveConnectionEndPoint) => {
      for (const k of Object.keys(vals).sort()) {
        const v = vals[k] as number;
        if (k === P.angle1) ep.setAngle(v);
        else if (k === P.angle2) ep.setAngle2(v);
        else if (k === P.cdist1) ep.setDistParam(v);
        else if (k === P.angleauto) ep.setAuto(Math.trunc(v) !== 0);
        else if (k === P.cdistauto) ep.setDistParamAuto(Math.trunc(v) !== 0);
      }
    };
    set(first, this.ep1_);
    set(params[1] as ParamMap, this.ep2_);
  }

  override getParams(): Params {
    const get = (ep: CurveConnectionEndPoint): ParamMap => ({
      [P.angle1]: ep.angle(),
      [P.angle2]: ep.angle2(),
      [P.cdist1]: ep.distParam(),
      [P.angleauto]: ep.isAuto() ? 1 : 0,
      [P.cdistauto]: ep.isDistParamAuto() ? 1 : 0,
    });
    return [get(this.ep1_), get(this.ep2_)];
  }

  /** The one-map (old) form's keys. */
  private setParam(name: string, val: number): void {
    const e1 = this.ep1_;
    const e2 = this.ep2_;
    switch (name) {
      case P.angle1:
        e1.setAngle(val);
        break;
      case P.angle2:
        e2.setAngle(val);
        break;
      case P.angle3:
        e1.setAngle2(val);
        break;
      case P.angle4:
        e2.setAngle2(val);
        break;
      case P.cdist1:
        e1.setDistParam(val);
        break;
      case P.cdist2:
        e2.setDistParam(val);
        break;
      case P.angle1auto:
        e1.setAuto(Math.trunc(val) !== 0);
        break;
      case P.angle2auto:
        e2.setAuto(Math.trunc(val) !== 0);
        break;
      case P.cdist1auto:
        e1.setDistParamAuto(Math.trunc(val) !== 0);
        break;
      case P.cdist2auto:
        e2.setDistParamAuto(Math.trunc(val) !== 0);
        break;
    }
  }

  private updatePoints(): void {
    const curves = this.host_.curves;
    const c0 = curves[0];
    if (c0 === undefined) return;
    this.pointsUpdatedFor_ = c0.clone();
    this.renderedPoints_ = [];
    for (const c of curves) this.renderStep_ = c.render(this.renderedPoints_).step;
    const r0 = this.renderedPoints_[0] ?? new Point();
    let r = new Rect(r0.x, r0.y, 0, 0);
    for (let i = 1; i < this.renderedPoints_.length; i++) r = r.include(this.renderedPoints_[i] as Point);
    this.selectionRectangle_ = r;
  }

  private checkPointsUpdate(): boolean {
    const c = this.host_.curves[0];
    if (c === undefined) return false;
    if (this.renderedPoints_.length === 0) return true;
    const u = this.pointsUpdatedFor_;
    return (
      !c.point1.equals(u.point1) ||
      !c.point2.equals(u.point2) ||
      !c.point3.equals(u.point3) ||
      !c.point4.equals(u.point4)
    );
  }

  override getDistanceFrom(pt: Point): number {
    if (this.checkPointsUpdate()) this.updatePoints();
    let dist = INT_MAX;
    for (const p of this.renderedPoints_) {
      const d = getDistance(p, pt);
      if (d < dist) dist = d;
    }
    return dist;
  }

  override getSelectionRectangle(): Rect {
    if (this.checkPointsUpdate()) this.updatePoints();
    return this.selectionRectangle_;
  }

  override getTFor(pt: Point): { t: number; dist: number; at: Point } {
    if (this.checkPointsUpdate()) this.updatePoints();
    let dist = INT_MAX;
    let t = 0;
    let at = new Point();
    this.renderedPoints_.forEach((p, i) => {
      const d = getDistance(p, pt);
      if (d < dist) {
        dist = d;
        at = p;
        t = this.renderStep_ * i;
      }
    });
    return { t, dist, at };
  }

  /** C++ `getPointForT`: (0, 0) outside [0, 1]. */
  getPointForT(t: number): Point {
    const c = this.host_.curves[0];
    if (c !== undefined && t >= 0 && t <= 1) return c.getPoint(t);
    return new Point();
  }

  override getInterestingPoints(): InterestingPoint[] {
    if (this.host_.curves.length === 0) return [];
    const bz = this.getCurve();
    const d1 = getDistance(bz.point1, bz.point2);
    const d2 = getDistance(bz.point4, bz.point3);
    return [
      { point: bz.point1, type: PointType.Attr },
      { point: getPointAtDistance(bz.point1, bz.point2, d1 / 2), type: PointType.Attr },
      { point: getPointAtDistance(bz.point4, bz.point3, d2 / 2), type: PointType.Attr },
      { point: bz.point4, type: PointType.Attr },
    ];
  }

  override vertexEdit(): VertexEdit {
    return { params: this.getParams(), saved: cloneParams(this.savedParams_) };
  }

  override moveVertexTo(vid: number, pt: Point): Point {
    const curve = this.getCurve();
    const setAngle2AndParam = (c: CurveConnectionEndPoint, oc: CurveConnectionEndPoint, varPt: Point) => {
      const pDist = getDistance(c.p1(), varPt);
      c.setAngle2(0);
      c.computeP2(oc);
      let angle = Math.PI - toRadian(getAngle(c.p2(), c.p1(), varPt));
      if (getTurnDir(c.p2(), c.p1(), varPt) === TurnDir.Right) angle = -1 * angle;
      c.setDistParam(pDist);
      c.setDistParamAuto(false);
      c.setAngle2(angle);
      oc.setDistFixed(c);
    };
    if (vid === 0) {
      const at = this.ep1_.moveVertex(pt);
      if (at !== null) {
        this.ep2_.setAngleFixed(this.ep1_);
        return at;
      }
      return curve.point1;
    } else if (vid === 1) {
      const d = getDistance(curve.point1, pt);
      setAngle2AndParam(this.ep1_, this.ep2_, getPointAtDistance(curve.point1, pt, d * 2));
    } else if (vid === 2) {
      const d = getDistance(curve.point4, pt);
      setAngle2AndParam(this.ep2_, this.ep1_, getPointAtDistance(curve.point4, pt, d * 2));
    } else if (vid === 3) {
      const at = this.ep2_.moveVertex(pt);
      if (at !== null) {
        this.ep1_.setAngleFixed(this.ep2_);
        return at;
      }
      return curve.point4;
    }
    return pt;
  }

  override startModification(): void {
    this.ep1_.saveDistParam();
    this.ep2_.saveDistParam();
    this.savedParams_ = this.getParams();
  }

  override scale(fx: number): void {
    const tmp1 = this.ep1_.origDistParam() * fx;
    const tmp2 = this.ep2_.origDistParam() * fx;
    if (tmp1 < 0.001 || tmp2 < 0.001) return;
    this.ep1_.setDistParam(tmp1);
    this.ep2_.setDistParam(tmp2);
  }

  override finishScaling(): { x: number; y: number } {
    const f = this.ep1_.origDistParam() > 0 ? this.ep1_.distParam() / this.ep1_.origDistParam() : 1;
    return { x: f, y: f };
  }
}
