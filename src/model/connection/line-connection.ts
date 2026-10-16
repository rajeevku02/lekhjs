// An orthogonal connector (port of C++ `LineConnection`, `L/connection/LineConnection.cpp`): the
// stored segments (`origLines_`, one param map each) or an automatic type generate the legs
// (`lines_`); a vertex drag moves a leg or an end and consolidates short legs away.
//
// B18b fixed (DR-ENG-20): `getParams` on an empty route returns empty params (C++ read
// `origLines_[0]` of an empty vector). Everything else is ported as is, including writing the
// automatic directions into `origLines_` during `generate` (now only from `layout()`, B9).
import type { Point } from '../../geometry';
import { PointType, getDistance } from '../../geometry';
import type { InterestingPoint } from '../../template';
import { Connection } from './connection';
import { LineConnectionEndPoint } from './end-point';
import { LineGenerator } from './line-generator';
import { LineAlign, RouteLine } from './route-line';
import {
  AutoType,
  ConnectionParam as P,
  cloneParams,
  type ConnectionType,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './types';

function isDirEqual(p1: Point, p2: Point): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

export class LineConnection extends Connection {
  private readonly ep1_: LineConnectionEndPoint;
  private readonly ep2_: LineConnectionEndPoint;
  private savedParams_: Params = [];
  private autoType_: AutoType = AutoType.NoAuto;
  private origLines_: RouteLine[] = [];
  private savedLines_: RouteLine[] = [];
  private savedGeneratedLines_: RouteLine[] = [];
  private lines_: RouteLine[] = [];
  private consolidationRequired_ = false;
  private editingLineIndex_ = -1;
  private editingEndPointIndex_ = -1;

  constructor(host: RouteHost, type: ConnectionType, autoType: AutoType) {
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
    }
    this.setParam(P.autotype, autoType);
  }

  /** The legs of the last `update` (read-only). */
  lines(): readonly RouteLine[] {
    return this.lines_;
  }

  private setAutotype(val: number): void {
    if (val >= 0 && val <= AutoType.Auto3LineDTop) {
      const at = Math.trunc(val) as AutoType;
      let other: AutoType = at;
      if (other === AutoType.Auto2LineA) other = AutoType.Auto2LineB;
      else if (other === AutoType.Auto2LineB) other = AutoType.Auto2LineA;
      this.autoType_ = at;
      this.ep1_.setAutoType(at);
      this.ep2_.setAutoType(other);
      this.ep1_.setAuto(at !== AutoType.NoAuto);
      this.ep2_.setAuto(at !== AutoType.NoAuto);
    }
  }

  override getAutoType(): AutoType {
    return this.ep1_.isAuto() ? this.ep1_.autoType() : AutoType.NoAuto;
  }

  private setParam(name: string, val: number): void {
    if (name === P.param1) {
      const l = this.origLines_[0];
      if (l !== undefined) l.step = val;
    } else if (name === P.param2) {
      const l = this.origLines_[1];
      if (l !== undefined) l.step = val;
    } else if (name === P.angle1) {
      this.ep1_.setAngle(val);
    } else if (name === P.angle2) {
      this.ep2_.setAngle(val);
    } else if (name === P.autotype) {
      this.setAutotype(val);
    }
  }

  override setParams(params: Params): void {
    const first = params[0];
    if (first === undefined) return;
    this.origLines_ = [];
    if (params.length === 1) {
      this.origLines_.push(new RouteLine(), new RouteLine());
      for (const k of Object.keys(first).sort()) this.setParam(k, first[k] as number);
      return;
    }
    for (const pm of params) {
      const line = new RouteLine();
      {
        const v = pm[P.step];
        if (v !== undefined) line.step = v;
      }
      {
        const v = pm[P.dx];
        if (v !== undefined) line.dx = Math.trunc(v);
      }
      {
        const v = pm[P.dy];
        if (v !== undefined) line.dy = Math.trunc(v);
      }
      this.origLines_.push(line);
    }
    {
      const v = first[P.autotype];
      if (v !== undefined) this.setAutotype(v);
    }
    {
      const v = first[P.angle];
      if (v !== undefined) this.ep1_.setAngle(v);
    }
    const last = params[params.length - 1] as ParamMap;
    {
      const v = last[P.angle];
      if (v !== undefined) this.ep2_.setAngle(v);
    }
  }

  override getParams(): Params {
    const l0 = this.origLines_[0];
    if (l0 === undefined) return []; // B18b
    const params: Params = [
      { [P.autotype]: this.autoType_, [P.angle]: this.ep1_.angle(), [P.step]: l0.step, [P.dx]: l0.dx, [P.dy]: l0.dy },
    ];
    for (let i = 1; i < this.origLines_.length; i++) {
      const l = this.origLines_[i] as RouteLine;
      params.push({ [P.step]: l.step, [P.dx]: l.dx, [P.dy]: l.dy });
    }
    (params[params.length - 1] as ParamMap)[P.angle] = this.ep2_.angle();
    return params;
  }

  override update(): void {
    this.lines_ = [];
    this.ep1_.computeP1(this.ep2_);
    this.ep2_.computeP1(this.ep1_);
    this.generate();
    const pts: Point[] = [];
    const l0 = this.lines_[0];
    if (l0 !== undefined) {
      let lastPoint = l0.start;
      pts.push(lastPoint);
      for (const item of this.lines_) {
        if (getDistance(lastPoint, item.end) > 0.05) {
          pts.push(item.end);
          lastPoint = item.end;
        }
      }
    }
    this.host_.points = pts;
  }

  private generate(): void {
    const o = this.origLines_;
    const first = o[0];
    const last = o[o.length - 1];
    if (first === undefined || last === undefined) return;
    if (this.autoType_ === AutoType.NoAuto) {
      const dir = first.dir();
      if (dir.x === 0 && dir.y === 0) {
        // The case of beta 2.8.1 (C++ FIXME kept).
        this.ep1_.computeP1(this.ep2_);
        this.ep1_.computeDir();
        this.ep2_.computeP1(this.ep1_);
        this.ep2_.computeDir();
        first.setDir(this.ep1_.dir());
        (o[1] as RouteLine).setDir(this.ep2_.reverDir());
      } else {
        this.ep1_.setDir(first.dir());
        this.ep2_.setDir(last.reverseDir());
      }
    } else {
      this.ep1_.computeDir();
      this.ep2_.computeDir();
      first.dx = Math.trunc(this.ep1_.dir().x);
      first.dy = Math.trunc(this.ep1_.dir().y);
      last.dx = Math.trunc(this.ep2_.dir().x);
      last.dy = Math.trunc(this.ep2_.dir().y);
    }
    if (o.length < 2) return;
    if (o.length <= 3) this.generateForBaseCase();
    else this.generateForGenericCase();
  }

  private generateForBaseCase(): void {
    const o = this.origLines_;
    const first = o[0] as RouteLine;
    const last = o[o.length - 1] as RouteLine;
    if (this.autoType_ === AutoType.NoAuto) {
      this.lines_ = new LineGenerator(
        this.ep1_.p1(),
        first.dir(),
        first.step,
        this.ep2_.p1(),
        last.reverseDir(),
        last.step,
      ).generate();
    } else {
      this.lines_ = new LineGenerator(
        this.ep1_.p1(),
        this.ep1_.dir(),
        first.step,
        this.ep2_.p1(),
        this.ep2_.dir(),
        last.step,
      ).generate();
    }
  }

  private addConLine(p1: Point, p2: Point, align: LineAlign): void {
    const line = new RouteLine();
    line.start = p1;
    line.end = p2;
    line.computeParam(align);
    this.lines_.push(line);
  }

  private generateForGenericCase(): void {
    const o = this.origLines_;
    let prevPoint = this.ep1_.p1();
    const startTo = Math.trunc(o.length / 2) - 2;
    let endFrom = Math.trunc(o.length / 2) + 1;
    for (let i = 0; i <= startTo; i++) {
      const l = o[i] as RouteLine;
      l.computePoint(prevPoint);
      prevPoint = l.end;
      this.addConLine(l.start, l.end, l.align());
    }
    const p1 = prevPoint;
    prevPoint = this.ep2_.p1();
    for (let i = o.length - 1; i >= endFrom; i--) {
      const l = o[i] as RouteLine;
      l.computePointFromEnd(prevPoint);
      prevPoint = l.start;
    }
    let p2 = prevPoint;
    const mid1 = o[startTo + 1] as RouteLine;
    p2 = mid1.align() === LineAlign.AlongX ? p2.withY(p1.y) : p2.withX(p1.x);
    this.addConLine(p1, p2, mid1.align());
    this.addConLine(p2, prevPoint, (o[startTo + 2] as RouteLine).align());
    while (endFrom < o.length) {
      const l = o[endFrom] as RouteLine;
      this.addConLine(prevPoint, l.end, l.align());
      prevPoint = l.end;
      endFrom++;
    }
  }

  /** C++ `consolidate`: drops a leg the edit left near zero, merging its neighbours. */
  private consolidate(): void {
    if (this.editingEndPointIndex_ === 0 || this.editingEndPointIndex_ === 1) return;
    const o = this.origLines_;
    const delta = 1.0;
    const e = this.editingLineIndex_;
    if (e === 1 && Math.abs((o[0] as RouteLine).step) < delta) {
      o.splice(0, 1);
      return;
    } else if (e === o.length - 2 && Math.abs((o[o.length - 1] as RouteLine).step) < delta) {
      o.pop();
      return;
    }
    if (o.length <= 3) return;
    const cur = o[e] as RouteLine;
    const prev = o[e - 1] as RouteLine;
    const next = o[e + 1] as RouteLine;
    const snap = this.host_.config.connectionParamReduceDelta;
    const dist1 = Math.abs(prev.step);
    const dist2 = Math.abs(next.step);
    if (dist1 < dist2) {
      if (dist1 <= snap) {
        let newIndex = e;
        if (e - 1 > 0) {
          const pprev = o[e - 2] as RouteLine;
          pprev.end = cur.end;
          pprev.computeParam(pprev.align());
          o.splice(e, 1);
          newIndex--;
        }
        o.splice(e - 1, 1);
        this.editingLineIndex_ = newIndex - 1;
      }
    } else if (dist2 <= snap) {
      o.splice(e + 1, 1);
      if (e + 1 < o.length) {
        const nnext = o[e + 1] as RouteLine;
        nnext.start = cur.start;
        nnext.computeParam(nnext.align());
        o.splice(e, 1);
      }
    }
  }

  private consolidateBeforeModification(vid: number): void {
    this.ep1_.setAngleFixed(this.ep2_);
    this.ep2_.setAngleFixed(this.ep1_);
    this.autoType_ = AutoType.NoAuto;
    if (vid === 0) this.editingEndPointIndex_ = 0;
    else if (vid > this.lines_.length) this.editingEndPointIndex_ = 1;
    else this.editingLineIndex_ = vid - 1;
    if (this.editingEndPointIndex_ !== 0 && this.editingEndPointIndex_ !== 1) {
      this.origLines_ = [];
      const l0 = this.lines_[0];
      if (vid === 1 && l0 !== undefined) {
        const line = new RouteLine();
        line.start = l0.start;
        line.end = l0.start;
        line.computeParam(l0.perpAlign());
        this.origLines_.push(line);
        this.editingLineIndex_ = 1;
      }
      this.origLines_.push(...this.lines_.map((l) => l.clone()));
      const lb = this.lines_[this.lines_.length - 1];
      if (vid === this.lines_.length && lb !== undefined) {
        const line = new RouteLine();
        line.start = lb.end;
        line.end = lb.end;
        line.computeParam(lb.perpAlign());
        this.origLines_.push(line);
      }
    }
    this.consolidationRequired_ = false;
  }

  private moveEndPoint(pt: Point): Point {
    let at = pt;
    if (this.editingEndPointIndex_ === 0) {
      const r = this.ep1_.moveVertex(pt);
      if (r === null) return this.ep1_.p1();
      at = r;
      this.ep2_.setAngleFixed(this.ep1_);
    } else if (this.editingEndPointIndex_ === 1) {
      const r = this.ep2_.moveVertex(pt);
      if (r === null) return this.ep2_.p1();
      at = r;
      this.ep1_.setAngleFixed(this.ep2_);
    }
    this.onEndPointMove();
    return at;
  }

  private onEndPointMove(): void {
    const [ep1, ep2] = this.editingEndPointIndex_ === 0 ? [this.ep1_, this.ep2_] : [this.ep2_, this.ep1_];
    ep1.computeP1(ep2);
    ep1.computeDir();
    ep2.computeP1(ep1);
    ep2.computeDir();
    const defaultStep = this.host_.config.extraConnectionLineLength;
    const sl = this.savedLines_;
    const sg = this.savedGeneratedLines_;
    const o = this.origLines_;
    if (o.length < 4) {
      if (this.editingEndPointIndex_ === 0) {
        let step = (sl[0] as RouteLine).step;
        if (!isDirEqual(ep1.dir(), (sg[0] as RouteLine).dir())) step = defaultStep;
        const cp1 = ep1.pinfo();
        const cp2 = cp1.moveBy(step);
        const l0 = o[0] as RouteLine;
        l0.start = cp1.point();
        l0.end = cp2.point();
        l0.computeParam(ep1.dirAlign());
        (o[o.length - 1] as RouteLine).setDir(ep2.reverDir());
      } else {
        let step = (sl[sl.length - 1] as RouteLine).step;
        if (!isDirEqual(ep1.dir(), (sg[sg.length - 1] as RouteLine).reverseDir())) step = defaultStep;
        const cp1 = ep1.pinfo();
        const cp2 = cp1.moveBy(step);
        const lb = o[o.length - 1] as RouteLine;
        lb.start = cp2.point();
        lb.end = cp1.point();
        lb.computeParam(ep1.dirAlign());
        lb.setDir(ep1.reverDir());
        (o[0] as RouteLine).setDir(ep2.dir());
      }
      return;
    }
    if (this.editingEndPointIndex_ === 0) {
      const nextIndex = 2;
      let step = (sl[0] as RouteLine).step;
      if (!isDirEqual(ep1.dir(), (sg[0] as RouteLine).dir())) step = defaultStep;
      const g = sg[nextIndex] as RouteLine;
      const lines = new LineGenerator(
        ep1.p1(),
        ep1.pinfo().dir(),
        step,
        g.end,
        g.reverseDir(),
        (sl[nextIndex] as RouteLine).step,
      ).generate();
      this.origLines_ = [...lines, ...sl.slice(nextIndex + 1).map((l) => l.clone())];
    } else {
      const numLines = 3;
      const prevId = sg.length - numLines;
      const g = sg[prevId] as RouteLine;
      let step = (sl[sl.length - 1] as RouteLine).step;
      if (!isDirEqual(ep1.dir(), (sg[sg.length - 1] as RouteLine).reverseDir())) step = defaultStep;
      const lines = new LineGenerator(
        g.start,
        g.dir(),
        (sl[prevId] as RouteLine).step,
        ep1.p1(),
        ep1.pinfo().dir(),
        step,
      ).generate();
      this.origLines_ = [...sl.slice(0, sl.length - numLines).map((l) => l.clone()), ...lines];
    }
  }

  override moveVertexTo(vid: number, pt: Point): Point {
    if (this.consolidationRequired_) this.consolidateBeforeModification(vid);
    if (this.editingEndPointIndex_ === 0 || this.editingEndPointIndex_ === 1) return this.moveEndPoint(pt);
    const v = this.editingLineIndex_;
    let newPt = pt;
    const o = this.origLines_;
    if (v < o.length - 1) {
      const snap = this.host_.config.connectionParamSnapDelta;
      const snapToGrid = this.host_.config.snapToGrid;
      const cur = o[v] as RouteLine;
      const prev = o[v - 1] as RouteLine;
      const next = o[v + 1] as RouteLine;
      if (cur.dx === 1 || cur.dx === -1) {
        if (snapToGrid) {
          const d1 = Math.abs(prev.start.y - newPt.y);
          const d2 = Math.abs(next.end.y - newPt.y);
          if (d1 <= d2 && d1 < snap) newPt = newPt.withY(prev.start.y);
          else if (d2 <= d1 && d2 < snap) newPt = newPt.withY(next.end.y);
        }
        prev.end = prev.end.withY(newPt.y);
        prev.computeParam(LineAlign.AlongY);
        next.start = next.start.withY(newPt.y);
        next.computeParam(LineAlign.AlongY);
        newPt = pt.withX(cur.mid().x);
      } else {
        if (snapToGrid) {
          const d1 = Math.abs(prev.start.x - newPt.x);
          const d2 = Math.abs(next.end.x - newPt.x);
          if (d1 <= d2 && d1 < snap) newPt = newPt.withX(prev.start.x);
          else if (d2 <= d1 && d2 < snap) newPt = newPt.withX(next.end.x);
        }
        prev.end = prev.end.withX(newPt.x);
        prev.computeParam(LineAlign.AlongX);
        next.start = next.start.withX(newPt.x);
        next.computeParam(LineAlign.AlongX);
        newPt = pt.withY(cur.mid().y);
      }
    }
    return newPt;
  }

  override newVertexIndex(): number {
    if (this.editingEndPointIndex_ === 0) return 0;
    if (this.editingEndPointIndex_ === 1) return this.origLines_.length + 1;
    return this.editingLineIndex_ + 1;
  }

  /** C++ re-routed here; the route is the layout's (B9). */
  override getInterestingPoints(): InterestingPoint[] {
    const ret: InterestingPoint[] = [];
    const l0 = this.lines_[0];
    if (l0 !== undefined) {
      ret.push({ point: l0.start, type: PointType.Attr });
      for (const l of this.lines_) ret.push({ point: l.mid(), type: PointType.Attr });
      ret.push({ point: (this.lines_[this.lines_.length - 1] as RouteLine).end, type: PointType.Attr });
    }
    return ret;
  }

  override startModification(): void {
    this.savedParams_ = this.getParams();
    this.savedLines_ = this.origLines_.map((l) => l.clone());
    this.savedGeneratedLines_ = this.lines_.map((l) => l.clone());
    this.consolidationRequired_ = true;
    this.editingLineIndex_ = -1;
    this.editingEndPointIndex_ = -1;
  }

  override vertexEdit(): VertexEdit {
    this.consolidate();
    return { params: this.getParams(), saved: cloneParams(this.savedParams_) };
  }
}
