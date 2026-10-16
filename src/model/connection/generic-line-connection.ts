// A straight connector between the two ends (port of C++ `GenericLineConnection`).
import type { Point } from '../../geometry';
import { PointType } from '../../geometry';
import type { InterestingPoint } from '../../template';
import { Connection } from './connection';
import { LineConnectionEndPoint } from './end-point';
import {
  AutoType,
  ConnectionParam as P,
  ConnectionType,
  cloneParams,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './types';

export class GenericLineConnection extends Connection {
  private readonly ep1_: LineConnectionEndPoint;
  private readonly ep2_: LineConnectionEndPoint;
  private savedParams_: Params = [];

  constructor(host: RouteHost, isAuto: boolean) {
    super(host, ConnectionType.GenericLine);
    this.ep1_ = new LineConnectionEndPoint(host.config);
    this.ep2_ = new LineConnectionEndPoint(host.config);
    for (const [ep, obj] of [
      [this.ep1_, this.first_],
      [this.ep2_, this.second_],
    ] as const) {
      ep.setType(ConnectionType.GenericLine);
      ep.setStyle(host.style);
      ep.setObj(obj);
    }
    this.setAuto(isAuto);
  }

  private setAuto(val: boolean): void {
    this.ep1_.setAutoType(AutoType.AutoLine);
    this.ep2_.setAutoType(AutoType.AutoLine);
    this.ep1_.setAuto(val);
    this.ep2_.setAuto(val);
  }

  override getAutoType(): AutoType {
    return this.ep1_.isAuto() ? AutoType.AutoLine : AutoType.NoAuto;
  }

  override setParams(params: Params): void {
    const pm = params[0];
    if (pm === undefined) return;
    this.ep1_.setType(ConnectionType.GenericLine);
    this.ep2_.setType(ConnectionType.GenericLine);
    const autoLine = (m: ParamMap) => {
      const at = m[P.autotype];
      return at !== undefined && Math.trunc(at) === AutoType.AutoLine;
    };
    if (params.length === 1) {
      const a1 = pm[P.angle1];
      if (a1 !== undefined) this.ep1_.setAngle(a1);
      const a2 = pm[P.angle2];
      if (a2 !== undefined) this.ep2_.setAngle(a2);
      this.setAuto(false);
      if (autoLine(pm)) this.setAuto(true);
      return;
    }
    const a1 = pm[P.angle];
    if (a1 !== undefined) this.ep1_.setAngle(a1);
    this.setAuto(false);
    if (autoLine(pm)) this.setAuto(true);
    const a2 = (params[1] as ParamMap)[P.angle];
    if (a2 !== undefined) this.ep2_.setAngle(a2);
  }

  override getParams(): Params {
    return [
      { [P.angle]: this.ep1_.angle(), [P.autotype]: this.ep1_.isAuto() ? AutoType.AutoLine : AutoType.NoAuto },
      { [P.angle]: this.ep2_.angle() },
    ];
  }

  override update(): void {
    this.ep1_.computeP1(this.ep2_);
    this.ep2_.computeP1(this.ep1_);
    this.host_.points = [this.ep1_.p1(), this.ep2_.p1()];
  }

  override moveVertexTo(vid: number, pt: Point): Point {
    let newPt = pt;
    if (vid === 0) newPt = this.ep1_.moveVertex(pt) ?? pt;
    else if (vid === 1) newPt = this.ep2_.moveVertex(pt) ?? pt;
    else return newPt;
    this.ep1_.setAngleFixed(this.ep2_);
    this.ep2_.setAngleFixed(this.ep1_);
    return newPt;
  }

  override getInterestingPoints(): InterestingPoint[] {
    return [
      { point: this.ep1_.p1(), type: PointType.Attr },
      { point: this.ep2_.p1(), type: PointType.Attr },
    ];
  }

  override startModification(): void {
    this.savedParams_ = this.getParams();
  }

  override vertexEdit(): VertexEdit {
    return { params: this.getParams(), saved: cloneParams(this.savedParams_) };
  }
}
