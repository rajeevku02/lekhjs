// Where a connector end sits on its shape (port of C++ `ConnectionEndPoint`,
// `LineConnectionEndPoint` and `CurveConnectionEndPoint`, `L/connection/*EndPoint.{h,cpp}`).
//
// An end has an angle from its shape's connection centre (automatic: towards the other end); the
// ray at that angle cut by the outline, moved out by the stroke gap, is `p1`; `p2` is a point on
// the outline's normal there (curves: the control point). The defaults are C++'s in-class ones
// (KB "A partial curve route stores indeterminate control values", fixed): `angle 0`, `auto`,
// `slope 0`, `normalAngle 0`; curve `angle2 0`, `distParam 0.4`, auto distance.
import type { Config } from '../../base';
import {
  LineEquation,
  Point,
  TurnDir,
  getAngle,
  getDistance,
  getPointAtDistance,
  getTurnDir,
  normalizeAngleInPI,
  normalizeInHalfPI,
  rotate,
  toRadian,
} from '../../geometry';
import type { Style } from '../../style';
import type { LekhObject } from '../lekh-object';
import { ConnectionPoint, LineAlign } from './route-line';
import { AutoType, ConnectionType } from './types';

export class ConnectionEndPoint {
  protected readonly config_: Config;
  protected obj_: LekhObject | null = null;
  protected style_: Style | null = null;
  protected at_ = new Point();
  protected angle_ = 0;
  protected isAuto_ = true;
  protected p1_ = new Point();
  protected slope_ = 0;
  protected normalAngle_ = 0;
  protected p2_ = new Point();

  constructor(config: Config) {
    this.config_ = config;
  }

  setObj(obj: LekhObject | null): void {
    this.obj_ = obj;
  }
  setStyle(style: Style | null): void {
    this.style_ = style;
  }
  setPointAt(p: Point): void {
    this.at_ = p;
  }
  setAngle(angle: number): void {
    this.angle_ = angle;
  }
  setAuto(val: boolean): void {
    this.isAuto_ = val;
  }
  obj(): LekhObject | null {
    return this.obj_;
  }
  p1(): Point {
    return this.p1_;
  }
  p2(): Point {
    return this.p2_;
  }
  angle(): number {
    return this.angle_;
  }
  isAuto(): boolean {
    return this.isAuto_;
  }
  slope(): number {
    return this.slope_;
  }
  normalAngle(): number {
    return this.normalAngle_;
  }

  /** C++ `setAngleFixed`: an automatic end takes its current effective angle and stops being automatic. */
  setAngleFixed(other: ConnectionEndPoint): void {
    if (this.isAuto_) {
      this.angle_ = this.effectiveAngle(other);
      this.isAuto_ = false;
    }
  }

  /** C++ `computeP1`: the outline crossing at the effective angle, plus the stroke gap. */
  computeP1(other: ConnectionEndPoint): void {
    const width = this.objWidth();
    const c1 = this.center();
    const p2 = this.pointAt(c1, new Point(c1.x + 100, c1.y), this.effectiveAngle(other), width * 2);
    this.p1_ = c1;
    if (this.obj_ !== null) this.endPoint(p2, other);
    this.computeTmpP2();
    if (this.obj_ !== null) {
      const sw = this.style_?.effectiveStrokeWidth() ?? 0;
      const gap =
        sw / 2 +
        this.obj_.getDrawingProfile().effectiveStrokeWidth() / 2 +
        this.config_.connectionLineSeparationFromObject;
      this.p1_ = getPointAtDistance(this.p1_, this.p2_, gap);
    }
  }

  /** C++ `center`: the free point, or the shape's connection centre. */
  center(): Point {
    if (this.obj_ === null) return this.at_;
    return this.obj_.connectionCentre();
  }

  protected effectiveAngle(other: ConnectionEndPoint): number {
    if (this.isAuto_) {
      const c1 = this.center();
      const c2 = other.center();
      const p2 = rotate([c1, c2], c1, this.angle_)[1] as Point;
      return Math.atan2(p2.y - c1.y, p2.x - c1.x);
    }
    return this.angle_;
  }

  /** C++ `objWidth`: the larger side of the shape's box, 100 without one. */
  protected objWidth(): number {
    let wd = 100;
    const sz = this.obj_?.boxSize() ?? null;
    if (sz !== null) {
      if (sz.width > 1) wd = sz.width;
      if (wd < sz.height) wd = sz.height;
    }
    return wd;
  }

  /**
   * C++ `getEndPoint(from, &result, other)`: the outline crossing of the line centre → `from`
   * nearest `from`, into `p1`; false when the line misses the outline.
   */
  protected endPoint(from: Point, other: ConnectionEndPoint): boolean {
    if (this.obj_ === null) {
      this.p1_ = this.at_;
      return true;
    }
    const pts = this.obj_.getIntersection(LineEquation.through(this.center(), from));
    const first = pts[0];
    if (first === undefined) return false;
    let result = first.point;
    this.slope_ = first.slope;
    let dist = getDistance(result, from);
    for (let i = 1; i < pts.length; i++) {
      const ps = pts[i] as (typeof pts)[number];
      const tmp = getDistance(ps.point, from);
      if (tmp < dist) {
        dist = tmp;
        result = ps.point;
        this.slope_ = normalizeInHalfPI(ps.slope);
      }
    }
    this.p1_ = result;
    this.fixSlope(other);
    return true;
  }

  /** C++ `getSlope(other)`: a hook; the line end fixes the slope of automatic routes. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden with the parameter
  protected fixSlope(_other: ConnectionEndPoint): void {
    /* none */
  }

  /** C++ `getPoint(p1, p2, angle, at)`: `at` from p1 along p1→p2 turned by `angle`. */
  protected pointAt(p1: Point, p2: Point, angle: number, at: number): Point {
    const v = rotate([p1, p2], p1, angle);
    return getPointAtDistance(p1, v[1] as Point, at);
  }

  /** C++ `computeTmpP2`: the outward normal at `p1` (away from the centre), as `p2` and `normalAngle`. */
  protected computeTmpP2(): void {
    const width = this.objWidth();
    const ct = this.center();
    const tmp = new Point(this.p1_.x + width * 2, this.p1_.y);
    const candidate1 = rotate([this.p1_, tmp], this.p1_, this.slope_ + Math.PI / 2)[1] as Point;
    const candidate2 = rotate([this.p1_, tmp], this.p1_, this.slope_ - Math.PI / 2)[1] as Point;
    const ref = rotate([this.p1_, tmp], this.p1_, this.slope_)[1] as Point;
    const ctd = getTurnDir(ref, this.p1_, ct);
    const td = getTurnDir(ref, this.p1_, candidate1);
    this.p2_ = candidate1;
    this.normalAngle_ = this.slope_ + Math.PI / 2;
    if (td === ctd) {
      this.normalAngle_ = this.slope_ - Math.PI / 2;
      this.p2_ = candidate2;
    }
  }

  /** C++ `moveVertex(pt, &out)`: the end pinned where the line centre → `pt` crosses the outline. */
  moveVertex(pt: Point): Point | null {
    const p1 = this.center();
    const p2 = new Point(p1.x + 1000, p1.y);
    if (this.obj_ === null) {
      this.setPointAt(pt);
      return pt;
    }
    const pts = this.obj_.getIntersection(LineEquation.through(p1, pt));
    if (pts.length === 0) return null;
    let dist = 2147483647;
    let at = new Point();
    for (const ps of pts) {
      const d = getDistance(ps.point, pt);
      if (d < dist) {
        dist = d;
        at = ps.point;
      }
    }
    let angle = Math.PI - toRadian(getAngle(p2, p1, at));
    if (getTurnDir(p2, p1, at) === TurnDir.Right) angle = -1 * angle;
    this.setAngle(angle);
    this.setAuto(false);
    return at;
  }
}

/** The end of a line or orthogonal route (C++ `LineConnectionEndPoint`). */
export class LineConnectionEndPoint extends ConnectionEndPoint {
  private dir_ = new Point();
  private type_: ConnectionType = ConnectionType.GenericLine;
  private autoType_: AutoType = AutoType.NoAuto;

  setType(t: ConnectionType): void {
    this.type_ = t;
  }
  type(): ConnectionType {
    return this.type_;
  }
  setAutoType(t: AutoType): void {
    this.autoType_ = t;
  }
  autoType(): AutoType {
    return this.autoType_;
  }
  dir(): Point {
    return this.dir_;
  }
  setDir(p: Point): void {
    this.dir_ = p;
  }
  reverDir(): Point {
    return new Point(-this.dir_.x, -this.dir_.y);
  }
  dirAlign(): LineAlign {
    return this.dir_.x !== 0 ? LineAlign.AlongX : LineAlign.AlongY;
  }
  perpAlign(): LineAlign {
    return this.dir_.x !== 0 ? LineAlign.AlongY : LineAlign.AlongX;
  }
  pinfo(): ConnectionPoint {
    return new ConnectionPoint(this.p1_.x, this.p1_.y, this.dir_.x, this.dir_.y);
  }

  /** For automatic routes the slope is perpendicular to the effective angle. */
  protected override fixSlope(other: ConnectionEndPoint): void {
    if (this.autoType_ !== AutoType.NoAuto) this.slope_ = this.effectiveAngle(other) + Math.PI / 2;
  }

  protected override effectiveAngle(other: ConnectionEndPoint): number {
    if (this.autoType_ !== AutoType.NoAuto) {
      const c1 = this.center();
      const c2 = other.center();
      switch (this.autoType_) {
        case AutoType.AutoLine:
          return Math.atan2(c2.y - c1.y, c2.x - c1.x);
        case AutoType.Auto2LineA:
        case AutoType.Auto3LineA:
          return Math.atan2(0, c2.x - c1.x);
        case AutoType.Auto2LineB:
        case AutoType.Auto3LineB:
          // zero value special case
          if (Math.abs(c2.y - c1.y) < 0.0001) return Math.atan2(1, 0);
          return Math.atan2(c2.y - c1.y, 0);
        case AutoType.Auto3LineC:
          return Math.atan2(0, 1);
        case AutoType.Auto3LineCLeft:
          return Math.atan2(0, -1);
        case AutoType.Auto3LineD:
          return Math.atan2(1, 0);
        case AutoType.Auto3LineDTop:
          return Math.atan2(-1, 0);
      }
    }
    return this.angle_;
  }

  /** C++ `computeDir()`: the axis nearest the normal at `p1`. */
  computeDir(angle: number = this.normalAngle_): void {
    const ang = normalizeAngleInPI(angle);
    if (ang >= 0) {
      if (ang < Math.PI / 4) this.dir_ = new Point(1, 0);
      else if (ang < Math.PI * (3.0 / 4)) this.dir_ = new Point(0, 1);
      else this.dir_ = new Point(-1, 0);
    } else if (ang > -Math.PI / 4) {
      this.dir_ = new Point(1, 0);
    } else if (ang > -Math.PI * (3.0 / 4)) {
      this.dir_ = new Point(0, -1);
    } else {
      this.dir_ = new Point(-1, 0);
    }
  }

  override setAngleFixed(other: ConnectionEndPoint): void {
    super.setAngleFixed(other);
    this.changeType();
  }

  override setAuto(val: boolean): void {
    super.setAuto(val);
    if (!val) this.changeType();
  }

  private changeType(): void {
    if (this.autoType_ !== AutoType.NoAuto) {
      this.type_ = this.autoType_ === AutoType.AutoLine ? ConnectionType.GenericLine : ConnectionType.MultiLine;
      this.autoType_ = AutoType.NoAuto;
    }
  }
}

/** The end of a curve route (C++ `CurveConnectionEndPoint`): `p2` is the control point. */
export class CurveConnectionEndPoint extends ConnectionEndPoint {
  private angle2_ = 0;
  private distParam_ = 0.4;
  private isDistParamAuto_ = true;
  private origDistParam_ = 0.4;

  angle2(): number {
    return this.angle2_;
  }
  setAngle2(v: number): void {
    this.angle2_ = v;
  }
  distParam(): number {
    return this.distParam_;
  }
  setDistParam(v: number): void {
    this.distParam_ = v;
  }
  origDistParam(): number {
    return this.origDistParam_;
  }
  saveDistParam(): void {
    this.origDistParam_ = this.distParam_;
  }
  isDistParamAuto(): boolean {
    return this.isDistParamAuto_;
  }
  setDistParamAuto(v: boolean): void {
    this.isDistParamAuto_ = v;
  }

  /** Automatic distance: `distParam` × the distance between the two ends. */
  private effectiveDist(other: CurveConnectionEndPoint): number {
    if (this.isDistParamAuto_ && this.distParam_ > 0) return getDistance(this.p1_, other.p1_) * this.distParam_;
    return this.distParam_;
  }

  computeP2(other: CurveConnectionEndPoint): void {
    this.computeTmpP2();
    this.p2_ = this.pointAt(this.p1_, this.p2_, this.angle2_, this.effectiveDist(other));
  }

  setDistFixed(other: CurveConnectionEndPoint): void {
    if (this.isDistParamAuto_) {
      this.distParam_ = this.effectiveDist(other);
      this.isDistParamAuto_ = false;
    }
  }
}
