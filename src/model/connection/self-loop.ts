// Self-loops: a connector whose two ends are on one shape, stored with pinned params (port of the
// self-loop statics of C++ `ConnectionObject`, `ConnectionObject.cpp:289-760`, and its private
// `AttachProbe`). `selfLoopParams` is the one producer of those params from sides; the unchanged
// routing draws them. Angles are radians clockwise from +x: right 0, bottom π/2, left π, top 3π/2.
import type { Config } from '../../base';
import type { Rect } from '../../geometry';
import {
  Point,
  getDistance,
  getPointAtDistance,
  normalizeAngleIn2PI,
  normalizeAngleInPI,
  rotate,
  rotatePoint,
} from '../../geometry';
import { Style } from '../../style';
import type { LekhObject } from '../lekh-object';
import { ConnectionEndPoint } from './end-point';
import { AutoType, ConnectionParam as P, ConnectionType, type ParamMap, type Params } from './types';

/** C++ `ConnectionObject::Side`. */
export const Side = Object.freeze({ Top: 0, Right: 1, Bottom: 2, Left: 3 } as const);
export type Side = (typeof Side)[keyof typeof Side];

/** C++ `ConnectionObject::SideRelation`. */
export const SideRelation = Object.freeze({ Same: 0, Adjacent: 1, Opposite: 2 } as const);
export type SideRelation = (typeof SideRelation)[keyof typeof SideRelation];

/** C++ `ConnectionObject::Bend`: the side an opposite-side loop goes round. */
export const Bend = Object.freeze({ Auto: 0, Top: 1, Right: 2, Bottom: 3, Left: 4 } as const);
export type Bend = (typeof Bend)[keyof typeof Bend];

/** C++ `ConnectionObject::SelfLoopError`. */
export const SelfLoopError = Object.freeze({ None: 0, TypeNotAllowed: 1, EndsTooClose: 2 } as const);
export type SelfLoopError = (typeof SelfLoopError)[keyof typeof SelfLoopError];

/** C++ `ConnectionObject::SelfLoopOptions`. */
export interface SelfLoopOptions {
  /** Orthogonal: first and last leg beyond the shape's extent; canvas units. */
  readonly runOut: number;
  /** Orthogonal: how far the loop passes beyond the edge it rounds. */
  readonly clearance: number;
  /** Curve control distance; 0 = 0.8 × max(w, h). */
  readonly curveDistance: number;
  /** Curve, opposite sides: extra sideways shift. */
  readonly curveClearance: number;
  /** Canvas units; 0 = do not check. */
  readonly minEndDist: number;
  /** Opposite sides only. */
  readonly bend: Bend;
}

/** C++ `SelfLoopOptions::defaults()`: runOut, clearance and curveClearance from the config. */
export function selfLoopDefaults(config: Config): SelfLoopOptions {
  return {
    runOut: config.selfLoopRunOut,
    clearance: config.selfLoopClearance,
    curveDistance: 0,
    curveClearance: config.selfLoopCurveClearance,
    minEndDist: 0,
    bend: Bend.Auto,
  };
}

/**
 * Where the engine attaches an end at an angle (C++ `AttachProbe`): the ray from the end's centre
 * cut by the outline, moved out along the normal by the stroke gap, and the outward normal there.
 * The connector's own stroke is not known here: the default one is assumed.
 */
class AttachProbe extends ConnectionEndPoint {
  private readonly connectorStyle_ = new Style();

  constructor(shape: LekhObject, config: Config) {
    super(config);
    this.setObj(shape);
    this.setStyle(this.connectorStyle_);
  }

  attach(angle: number): { at: Point; normalAngle: number } | null {
    this.setAngle(angle);
    this.setAuto(false);
    const c = this.center();
    const far = this.pointAt(c, new Point(c.x + 100, c.y), angle, this.objWidth() * 2);
    this.p1_ = c;
    if (!this.endPoint(far, this)) return null;
    this.computeTmpP2();
    const obj = this.obj_ as LekhObject;
    const gap =
      this.connectorStyle_.effectiveStrokeWidth() / 2 +
      obj.getDrawingProfile().effectiveStrokeWidth() / 2 +
      this.config_.connectionLineSeparationFromObject;
    return { at: getPointAtDistance(this.p1_, this.p2_, gap), normalAngle: this.normalAngle_ };
  }
}

/** The shape's unrotated box, its rotation about the box centre, and its connection centre. */
interface ShapeFrame {
  readonly centre: Point;
  readonly rect: Rect;
  readonly rotation: number;
}

function frameOf(shape: LekhObject): ShapeFrame {
  return { centre: shape.connectionCentre(), rect: shape.unrotatedRect(), rotation: shape.rotation() };
}

function toLocal(f: ShapeFrame, p: Point): Point {
  return rotatePoint(p, f.rect.center(), -f.rotation);
}

function corners(f: ShapeFrame): Point[] {
  return rotate(f.rect.getPoints(), f.rect.center(), f.rotation);
}

function normalAngleOf(side: Side): number {
  switch (side) {
    case Side.Right:
      return 0;
    case Side.Bottom:
      return Math.PI / 2;
    case Side.Left:
      return Math.PI;
    case Side.Top:
      return -Math.PI / 2;
  }
}

/** The world axis nearest the direction `angle`. */
function sideOfDirection(angle: number): Side {
  const ang = normalizeAngleInPI(angle);
  if (Math.abs(ang) < Math.PI / 4) return Side.Right;
  if (Math.abs(ang) > (Math.PI * 3) / 4) return Side.Left;
  return ang > 0 ? Side.Bottom : Side.Top;
}

function dirOf(side: Side): Point {
  switch (side) {
    case Side.Right:
      return new Point(1, 0);
    case Side.Bottom:
      return new Point(0, 1);
    case Side.Left:
      return new Point(-1, 0);
    case Side.Top:
      return new Point(0, -1);
  }
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const add = (a: Point, b: Point, f = 1) => new Point(a.x + b.x * f, a.y + b.y * f);
const sub = (a: Point, b: Point) => new Point(a.x - b.x, a.y - b.y);
const isHorizontal = (s: Side) => s === Side.Left || s === Side.Right;

/**
 * The side an opposite-side loop leaving from `from` goes round; `entry` is the entry attach point
 * relative to the centre. An explicit bend that is not across the loop counts as Auto; Auto takes
 * the half the entry lies in (ties: top for a left/right loop, right for a top/bottom loop).
 */
function bendSide(bend: Bend, from: Side, entry: Point): Side {
  const eps = 0.001;
  const given: Side | null =
    bend === Bend.Top
      ? Side.Top
      : bend === Bend.Right
        ? Side.Right
        : bend === Bend.Bottom
          ? Side.Bottom
          : bend === Bend.Left
            ? Side.Left
            : null;
  if (given !== null && isHorizontal(given) !== isHorizontal(from)) return given;
  if (isHorizontal(from)) return entry.y > eps ? Side.Bottom : Side.Top;
  return entry.x < -eps ? Side.Left : Side.Right;
}

function extentAlong(pts: readonly Point[], dir: Point): number {
  let ext = dot(pts[0] as Point, dir);
  for (let i = 1; i < pts.length; i++) ext = Math.max(ext, dot(pts[i] as Point, dir));
  return ext;
}

/** C++ `segment`: `dx`/`dy` stored as `int`. */
function segment(dir: Point, step: number): ParamMap {
  return { [P.step]: Math.abs(step), [P.dx]: Math.trunc(dir.x), [P.dy]: Math.trunc(dir.y) };
}

/** The axis direction from `from` to `to` along `axis`, or `fallback` when level. */
function axisDir(from: Point, to: Point, axis: Point, fallback: Point): Point {
  const d = dot(sub(to, from), axis);
  if (Math.abs(d) < 0.001) return fallback;
  return d > 0 ? axis : new Point(-axis.x, -axis.y);
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return new Point(b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x, b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y);
}

function curveEnd(angle: number, angle2: number, dist: number): ParamMap {
  return { [P.angle1]: angle, [P.angle2]: angle2, [P.cdist1]: dist, [P.angleauto]: 0, [P.cdistauto]: 0 };
}

/** The pinned params of one curve end whose control point is `control`. */
function curveEndTo(angle: number, at: Point, normalAngle: number, control: Point): ParamMap {
  const v = sub(control, at);
  return curveEnd(angle, normalizeAngleInPI(Math.atan2(v.y, v.x) - normalAngle), getDistance(at, control));
}

/** C++ `allowsSelfLoop`. */
export function allowsSelfLoop(type: ConnectionType): boolean {
  return type === ConnectionType.Curve || type === ConnectionType.MultiLine;
}

/** C++ `sideOfAngle`: the side of the shape's rotated box the attach point at `angle` lies on. */
export function sideOfAngle(shape: LekhObject, angle: number): Side {
  const f = frameOf(shape);
  const c = toLocal(f, f.centre);
  const ang = angle - f.rotation;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const r = f.rect;
  const eps = 1e-9;
  let side: Side = Side.Right;
  let best = Number.MAX_VALUE;
  const consider = (t: number, s: Side) => {
    if (t >= 0 && t < best) {
      best = t;
      side = s;
    }
  };
  if (dx > eps) consider((r.right() - c.x) / dx, Side.Right);
  else if (dx < -eps) consider((r.x - c.x) / dx, Side.Left);
  if (dy > eps) consider((r.bottom() - c.y) / dy, Side.Bottom);
  else if (dy < -eps) consider((r.y - c.y) / dy, Side.Top);
  return side;
}

/** C++ `worldSideOf`: the world axis side nearest the outward normal of the rotated `side`. */
export function worldSideOf(shape: LekhObject, side: Side): Side {
  return sideOfDirection(normalAngleOf(side) + frameOf(shape).rotation);
}

/** C++ `relationOf`. */
export function relationOf(a: Side, b: Side): SideRelation {
  if (a === b) return SideRelation.Same;
  if (isHorizontal(a) === isHorizontal(b)) return SideRelation.Opposite;
  return SideRelation.Adjacent;
}

/**
 * C++ `sideAngle`: the angle (in [0, 2π)) from the connection centre to the point `along` (0 to 1)
 * of the rotated `side`, measured from the side's top (left/right) or left (top/bottom) end.
 */
export function sideAngle(shape: LekhObject, side: Side, along: number): number {
  const f = frameOf(shape);
  const r = f.rect;
  let p: Point;
  switch (side) {
    case Side.Right:
      p = new Point(r.right(), r.y + along * r.height);
      break;
    case Side.Left:
      p = new Point(r.x, r.y + along * r.height);
      break;
    case Side.Top:
      p = new Point(r.x + along * r.width, r.y);
      break;
    case Side.Bottom:
      p = new Point(r.x + along * r.width, r.bottom());
      break;
  }
  p = rotatePoint(p, r.center(), f.rotation);
  return normalizeAngleIn2PI(Math.atan2(p.y - f.centre.y, p.x - f.centre.x));
}

/** C++ `connectionCentre`. */
export function connectionCentre(shape: LekhObject): Point {
  return shape.connectionCentre();
}

/** C++ `attachPoint`: null when the ray misses the outline (a shape not yet laid out). */
export function attachPoint(
  shape: LekhObject,
  angle: number,
  config: Config,
): { at: Point; normalAngle: number } | null {
  return new AttachProbe(shape, config).attach(angle);
}

/**
 * C++ `selfLoopParams`: the pinned params of a self-loop of `type` on `shape` leaving at
 * `angleFrom` and entering at `angleTo`. Curve: both ends pinned; opposite sides bend round the
 * shape. MultiLine: 3, 4 or 5 stored segments for same, adjacent or opposite (world) sides.
 */
export function selfLoopParams(
  type: ConnectionType,
  shape: LekhObject,
  angleFrom: number,
  angleTo: number,
  opts: SelfLoopOptions,
  config: Config,
): { error: SelfLoopError; params: Params } {
  if (!allowsSelfLoop(type)) return { error: SelfLoopError.TypeNotAllowed, params: [] };
  const frame = frameOf(shape);
  const probe = new AttachProbe(shape, config);
  const ra = probe.attach(angleFrom);
  const rb = probe.attach(angleTo);
  const a = ra?.at ?? frame.centre;
  const na = ra?.normalAngle ?? angleFrom;
  const b = rb?.at ?? frame.centre;
  const nb = rb?.normalAngle ?? angleTo;

  // "At least minEndDist" is inclusive (C++ allowed float error).
  const endDistTolerance = 1e-3;
  if (opts.minEndDist > 0 && getDistance(a, b) < opts.minEndDist - endDistTolerance) {
    return { error: SelfLoopError.EndsTooClose, params: [] };
  }
  const params: Params = [];

  if (type === ConnectionType.Curve) {
    const sel = shape.selectionRect();
    const cdist = opts.curveDistance > 0 ? opts.curveDistance : 0.8 * Math.max(sel.width, sel.height);
    const sideA = sideOfAngle(shape, angleFrom);
    const sideB = sideOfAngle(shape, angleTo);
    if (relationOf(sideA, sideB) !== SideRelation.Opposite) {
      // control points along the normals: a teardrop or C loop
      params.push(curveEnd(angleFrom, 0, cdist), curveEnd(angleTo, 0, cdist));
      return { error: SelfLoopError.None, params };
    }
    // Opposite sides: both control points shifted sideways to the bend side, so the curve goes
    // round the shape (see the C++ comment for the geometry).
    const bend = bendSide(opts.bend, sideA, sub(toLocal(frame, b), toLocal(frame, frame.centre)));
    const bn = new Point(
      Math.cos(normalAngleOf(bend) + frame.rotation),
      Math.sin(normalAngleOf(bend) + frame.rotation),
    );
    const len = getDistance(a, b);
    const u = len > 0.001 ? new Point((a.x - b.x) / len, (a.y - b.y) / len) : new Point(-bn.y, bn.x);
    let v = new Point(-u.y, u.x);
    if (dot(v, bn) < 0) v = new Point(u.y, -u.x);
    const m = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const rel = corners(frame).map((p) => sub(p, m));
    const vmax = Math.max(extentAlong(rel, v), 1);
    const ua = Math.max(extentAlong(rel, u), len / 2);
    const ub = Math.max(extentAlong(rel, new Point(-u.x, -u.y)), len / 2);
    const clearance = Math.max(opts.curveClearance, 0);
    let sideShift = ((vmax + clearance) * 4) / 3;
    const sEdge = vmax / (3 * sideShift);
    const tEdge = (1 - Math.sqrt(Math.max(0, 1 - 4 * sEdge))) / 2;
    const k = Math.max(1 - 2 * tEdge, 0.05);
    const runOutFor = (extent: number) => {
      const l = len / 2;
      const r = (((extent + clearance / 2) / k - l) / sEdge - 2 * l) / 3;
      return Math.max(r, 0);
    };
    let raa = runOutFor(ua);
    let rbb = runOutFor(ub);
    let ca = new Point();
    let cb = new Point();
    const place = () => {
      ca = add(add(a, u, raa), v, sideShift);
      cb = add(add(b, u, -rbb), v, sideShift);
    };
    place();
    // Exact for a box seen square-on; for any other outline widen until no sample is inside.
    for (let iter = 0; iter < 12; iter++) {
      let inside = false;
      for (let i = 1; i < 64 && !inside; i++) inside = shape.isPointInside(bezierPoint(a, ca, cb, b, i / 64.0));
      if (!inside) break;
      raa = raa * 1.25 + 4;
      rbb = rbb * 1.25 + 4;
      sideShift *= 1.1;
      place();
    }
    params.push(curveEndTo(angleFrom, a, na, ca), curveEndTo(angleTo, b, nb, cb));
    return { error: SelfLoopError.None, params };
  }

  // Orthogonal: each end leaves along the world axis nearest its side's normal; the first and last
  // legs run `runOut` beyond the shape's axis-aligned extent.
  const box = shape.selectionRect().getPoints();
  const wa = worldSideOf(shape, sideOfAngle(shape, angleFrom));
  const wb = worldSideOf(shape, sideOfAngle(shape, angleTo));
  const da = dirOf(wa);
  const db = dirOf(wb);
  const legA = opts.runOut + Math.max(0, extentAlong(box, da) - dot(a, da));
  const legB = opts.runOut + Math.max(0, extentAlong(box, db) - dot(b, db));
  const a1 = add(a, da, legA);
  const b1 = add(b, db, legB);
  const acrossA = isHorizontal(wa) ? new Point(0, 1) : new Point(1, 0);
  const alongA = isHorizontal(wa) ? new Point(1, 0) : new Point(0, 1);
  params.push(segment(da, legA));
  const relation = relationOf(wa, wb);
  if (relation === SideRelation.Same) {
    params.push(segment(axisDir(a1, b1, acrossA, acrossA), dot(sub(b1, a1), acrossA)));
  } else if (relation === SideRelation.Adjacent) {
    const corner = isHorizontal(wa) ? new Point(a1.x, b1.y) : new Point(b1.x, a1.y);
    params.push(segment(axisDir(a1, corner, db, db), getDistance(a1, corner)));
    params.push(segment(axisDir(corner, b1, alongA, new Point(-da.x, -da.y)), getDistance(corner, b1)));
  } else {
    const bend = bendSide(opts.bend, wa, sub(b, frame.centre));
    const bnd = dirOf(bend);
    const edge = extentAlong(box, bnd) + opts.clearance;
    const l4 = edge - dot(b, bnd);
    params.push(segment(bnd, edge - dot(a1, bnd)));
    params.push(segment(axisDir(a1, b1, alongA, db), dot(sub(b1, a1), alongA)));
    params.push(segment(new Point(-bnd.x, -bnd.y), l4));
  }
  params.push(segment(new Point(-db.x, -db.y), legB));
  (params[0] as ParamMap)[P.autotype] = AutoType.NoAuto;
  (params[0] as ParamMap)[P.angle] = angleFrom;
  (params[params.length - 1] as ParamMap)[P.angle] = angleTo;
  return { error: SelfLoopError.None, params };
}
