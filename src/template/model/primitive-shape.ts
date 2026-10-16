// One parsed draw command of a template path (port of C++ `PrimitiveShape` and its ten
// subclasses, `L/PrimitiveShape.{h,cpp}`). Every number of a command is an index into the
// instance's evaluated data (`DataStore.values`).
//
// C++ `draw()` both computed and painted, and geometry queries later read what it computed. Here
// that is split (spec 03 §5.1): `layout(ds)` is the computing half of `draw` (the points, the
// Bézier, the `lastPoint` chain), and `paint(dp)` issues the draw calls from it. `computePoints`
// is kept as C++ has it (no relative offset), for the queries that call it directly.
//
// C++ read `ds->values()[i]` unchecked; an out-of-range index reads 0 here (`DataStore.value`).
// A command with no predecessor where C++ dereferenced one (H, V, C, Q first) reads (0, 0).
/* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */
import { INT_MAX } from '../../base';
import {
  BezierCurve,
  Ellipse,
  Point,
  QuadBezier,
  getDistance,
  intersectionWithPolygon,
  pointLineSegmentDistance,
  rotate,
  type LineEquation,
  type PointAndSlope,
} from '../../geometry';
import type { DrawingPlatform } from '../../render';
import type { DataStore } from '../expr/data-store';

export abstract class PrimitiveShape {
  protected readonly prevShape: PrimitiveShape | null;
  protected readonly relative: boolean;
  protected lastPoint_ = new Point();

  constructor(prev: PrimitiveShape | null, relative: boolean) {
    this.prevShape = prev;
    this.relative = relative;
  }

  /** The command letter (for `isLine`, `getType` and debugging). */
  abstract readonly command: string;

  /** C++ `lastPoint(Point*)`. `fallback` is what the caller's out-parameter held. */
  lastPoint(_fallback: Point = new Point()): Point {
    return this.lastPoint_;
  }

  abstract computePoints(ds: DataStore): void;
  /** The computing half of C++ `draw`. */
  abstract layout(ds: DataStore): void;
  /** The drawing half of C++ `draw`: draw calls from the last `layout`. */
  abstract paint(dp: DrawingPlatform): void;
  /** Data indices that position this command (C++ `getPositionPoints`), appended to `pts`. */
  abstract getPositionPoints(pts: number[]): void;

  isPointInside(_pt: Point, _ds: DataStore): boolean {
    return false;
  }
  updatePoints(_ds: DataStore): void {
    /* nothing by default */
  }
  distanceFrom(_pt: Point, _ds: DataStore): number {
    return INT_MAX;
  }
  intersectionWith(_eq: LineEquation, _ds: DataStore, _pts: PointAndSlope[]): void {
    /* nothing by default */
  }

  /** The predecessor's last point, or `fallback` when there is none. */
  protected prevLast(fallback: Point): Point {
    return this.prevShape !== null ? this.prevShape.lastPoint(fallback) : fallback;
  }

  protected addPositionPoint(pts: number[], x: number, y: number): void {
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i - 1] === x && pts[i] === y) return;
    }
    pts.push(x, y);
  }
}

/** `M x y` / `m x y`. */
export class MoveToCommand extends PrimitiveShape {
  readonly command = 'M';
  private readonly tox: number;
  private readonly toy: number;

  constructor(tox: number, toy: number, relative: boolean, prev: PrimitiveShape | null) {
    super(prev, relative);
    this.tox = tox;
    this.toy = toy;
  }

  computePoints(ds: DataStore): void {
    this.lastPoint_ = new Point(ds.value(this.tox), ds.value(this.toy));
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
    if (this.relative && this.prevShape !== null) {
      const p = this.prevShape.lastPoint();
      this.lastPoint_ = this.lastPoint_.withDelta(p.x, p.y);
    }
  }
  paint(dp: DrawingPlatform): void {
    dp.moveTo(this.lastPoint_);
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.tox, this.toy);
  }
}

/** `Z` / `z`. */
export class CloseCommand extends PrimitiveShape {
  readonly command = 'Z';

  computePoints(): void {
    /* nothing */
  }
  layout(): void {
    /* nothing */
  }
  paint(dp: DrawingPlatform): void {
    dp.closePath();
  }
  getPositionPoints(): void {
    /* nothing */
  }
}

/** `L x y` / `l x y`. */
export class LineShape extends PrimitiveShape {
  readonly command = 'L';
  private readonly tox: number;
  private readonly toy: number;

  constructor(tox: number, toy: number, relative: boolean, prev: PrimitiveShape | null) {
    super(prev, relative);
    this.tox = tox;
    this.toy = toy;
  }

  computePoints(ds: DataStore): void {
    this.lastPoint_ = new Point(ds.value(this.tox), ds.value(this.toy));
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
    if (this.relative && this.prevShape !== null) {
      const p = this.prevShape.lastPoint();
      this.lastPoint_ = this.lastPoint_.withDelta(p.x, p.y);
    }
  }
  paint(dp: DrawingPlatform): void {
    dp.addLineTo(this.lastPoint_);
  }
  override distanceFrom(pt: Point, ds: DataStore): number {
    const p1 = this.prevLast(new Point());
    this.computePoints(ds);
    return pointLineSegmentDistance(p1, this.lastPoint_, pt).dist;
  }
  override intersectionWith(eq: LineEquation, ds: DataStore, pts: PointAndSlope[]): void {
    const p1 = this.prevLast(new Point());
    this.computePoints(ds);
    // C++ inserts at the front of the list.
    pts.unshift(...intersectionWithPolygon([p1, this.lastPoint_], eq, false));
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.tox, this.toy);
  }
}

/** `H x` / `h dx`. */
export class HorizontalLineShape extends PrimitiveShape {
  readonly command = 'H';
  private readonly tox: number;

  constructor(tox: number, relative: boolean, prev: PrimitiveShape | null) {
    super(prev, relative);
    this.tox = tox;
  }

  computePoints(ds: DataStore): void {
    const p = this.prevLast(this.lastPoint_);
    this.lastPoint_ = this.relative ? p.withX(p.x + ds.value(this.tox)) : p.withX(ds.value(this.tox));
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
  }
  paint(dp: DrawingPlatform): void {
    dp.addLineTo(this.lastPoint_);
  }
  getPositionPoints(): void {
    /* C++: none */
  }
}

/** `V y` / `v dy`. */
export class VerticalLineShape extends PrimitiveShape {
  readonly command = 'V';
  private readonly toy: number;

  constructor(toy: number, relative: boolean, prev: PrimitiveShape | null) {
    super(prev, relative);
    this.toy = toy;
  }

  computePoints(ds: DataStore): void {
    const p = this.prevLast(this.lastPoint_);
    this.lastPoint_ = this.relative ? p.withY(p.y + ds.value(this.toy)) : p.withY(ds.value(this.toy));
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
  }
  paint(dp: DrawingPlatform): void {
    dp.addLineTo(this.lastPoint_);
  }
  getPositionPoints(): void {
    /* C++: none */
  }
}

/** `C x1 y1 x2 y2 x y`: a cubic from the previous point. */
export class BezierCurveShape extends PrimitiveShape {
  readonly command = 'C';
  private readonly x1: number;
  private readonly y1: number;
  private readonly x2: number;
  private readonly y2: number;
  private readonly x: number;
  private readonly y: number;
  private readonly bz = new BezierCurve();
  private renderedPoints: Point[] = [];
  private modified = true;

  constructor(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number,
    relative: boolean,
    prev: PrimitiveShape | null,
  ) {
    super(prev, relative);
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.x = x;
    this.y = y;
  }

  /** The curve as last computed (C++ `curve()`). */
  curve(): BezierCurve {
    return this.bz;
  }

  computePoints(ds: DataStore): void {
    this.bz.point1 = this.prevLast(this.bz.point1);
    this.bz.point2 = new Point(ds.value(this.x1), ds.value(this.y1));
    this.bz.point3 = new Point(ds.value(this.x2), ds.value(this.y2));
    this.lastPoint_ = new Point(ds.value(this.x), ds.value(this.y));
    this.bz.point4 = this.lastPoint_;
    this.bz.numPoints = 4;
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
  }
  paint(dp: DrawingPlatform): void {
    dp.addCurve(this.bz.clone());
  }
  override updatePoints(ds: DataStore): void {
    this.prevShape?.computePoints(ds);
    this.computePoints(ds);
    this.modified = true;
  }
  override distanceFrom(pt: Point, ds: DataStore): number {
    if (this.modified) {
      this.computePoints(ds);
      this.renderedPoints = this.bz.render([]).points;
      this.modified = false;
    }
    let dist = INT_MAX;
    for (const p of this.renderedPoints) {
      const d = getDistance(p, pt);
      if (d < dist) dist = d;
    }
    return dist;
  }
  /** On the curve as last computed (C++ does not recompute here). */
  override intersectionWith(eq: LineEquation, _ds: DataStore, pts: PointAndSlope[]): void {
    for (const t of this.bz.intersectLine(eq)) {
      pts.push({ point: this.bz.getPoint(t), slope: this.bz.slopeAt(t) });
    }
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.x1, this.y1);
    this.addPositionPoint(pts, this.x2, this.y2);
    this.addPositionPoint(pts, this.x, this.y);
  }
}

/** `Q x1 y1 x y`: a quadratic from the previous point. */
export class QuadBezierCurveShape extends PrimitiveShape {
  readonly command = 'Q';
  private readonly x1: number;
  private readonly y1: number;
  private readonly x2: number;
  private readonly y2: number;
  private readonly curve_ = new QuadBezier();

  constructor(x1: number, y1: number, x2: number, y2: number, relative: boolean, prev: PrimitiveShape | null) {
    super(prev, relative);
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  curve(): QuadBezier {
    return this.curve_;
  }

  computePoints(ds: DataStore): void {
    this.lastPoint_ = new Point(ds.value(this.x2), ds.value(this.y2));
    this.curve_.point1 = this.prevLast(this.curve_.point1);
    this.curve_.point2 = new Point(ds.value(this.x1), ds.value(this.y1));
    this.curve_.point3 = this.lastPoint_;
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
  }
  paint(dp: DrawingPlatform): void {
    dp.addCurve(new BezierCurve(this.curve_.point1, this.curve_.point2, this.curve_.point3, new Point(), 3));
  }
  override distanceFrom(): number {
    return INT_MAX;
  }
  override intersectionWith(eq: LineEquation, ds: DataStore, pts: PointAndSlope[]): void {
    this.computePoints(ds);
    pts.push(...this.curve_.intersect(eq));
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.x1, this.y1);
    this.addPositionPoint(pts, this.x2, this.y2);
  }
}

/** `A …`: parsed and kept, but C++ never implemented it: it draws nothing and has no last point. */
export class ArcShape extends PrimitiveShape {
  readonly command = 'A';
  readonly rx: number;
  readonly ry: number;
  readonly large: number;
  readonly sweep: number;
  readonly tox: number;
  readonly toy: number;

  constructor(
    rx: number,
    ry: number,
    large: number,
    sweep: number,
    tox: number,
    toy: number,
    relative: boolean,
    prev: PrimitiveShape | null,
  ) {
    super(prev, relative);
    this.rx = rx;
    this.ry = ry;
    this.large = large;
    this.sweep = sweep;
    this.tox = tox;
    this.toy = toy;
  }

  /** C++ leaves the caller's point untouched. */
  override lastPoint(fallback: Point = new Point()): Point {
    return fallback;
  }
  computePoints(): void {
    /* C++: empty */
  }
  layout(): void {
    /* C++: empty */
  }
  paint(): void {
    /* C++: empty */
  }
  getPositionPoints(): void {
    /* C++: none */
  }
}

/** `E cx cy w h r`: an ellipse (rotation `d(r)` plus the instance angle). */
export class EllipseShape extends PrimitiveShape {
  readonly command = 'E';
  private readonly cx: number;
  private readonly cy: number;
  private readonly width: number;
  private readonly height: number;
  private readonly rotation: number;
  private laid = { w: 0, h: 0, r: 0 };

  constructor(cx: number, cy: number, w: number, h: number, r: number) {
    super(null, false);
    this.cx = cx;
    this.cy = cy;
    this.width = w;
    this.height = h;
    this.rotation = r;
  }

  computePoints(ds: DataStore): void {
    this.lastPoint_ = new Point(ds.value(this.cx), ds.value(this.cy));
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
    this.laid = {
      w: ds.value(this.width),
      h: ds.value(this.height),
      r: ds.value(this.rotation) + ds.angle(),
    };
  }
  paint(dp: DrawingPlatform): void {
    dp.addEllipse(this.lastPoint_, this.laid.w, this.laid.h, this.laid.r);
  }
  override isPointInside(pt: Point, ds: DataStore): boolean {
    return this.ellipse(ds).isInside(pt);
  }
  override distanceFrom(pt: Point, ds: DataStore): number {
    return this.ellipse(ds).getDistanceFrom(pt);
  }
  /** C++ assigns the result: it replaces whatever earlier commands found. */
  override intersectionWith(eq: LineEquation, ds: DataStore, pts: PointAndSlope[]): void {
    const found = this.ellipse(ds).getIntersection(eq);
    pts.length = 0;
    pts.push(...found);
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.cx, this.cy);
  }

  private ellipse(ds: DataStore): Ellipse {
    return new Ellipse(
      new Point(ds.value(this.cx), ds.value(this.cy)),
      ds.value(this.width),
      ds.value(this.height),
      ds.value(this.rotation) + ds.angle(),
    );
  }
}

/** C++ `K`: the cubic approximation constant of a quarter circle. */
const K = 0.5522847498;

/** `R x y w h rx ry r`: a rounded rectangle centred at (x, y); radius `min(w, h) / 5` when rx = ry = 0. */
export class RoundedRectShape extends PrimitiveShape {
  readonly command = 'R';
  private readonly x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly h: number;
  private readonly rx: number;
  private readonly ry: number;
  private readonly rotation: number;
  private points: Point[] = [];

  constructor(x: number, y: number, w: number, h: number, rx: number, ry: number, r: number) {
    super(null, false);
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.rx = rx;
    this.ry = ry;
    this.rotation = r;
  }

  computePoints(ds: DataStore): void {
    const wd = ds.value(this.w) / 2;
    const ht = ds.value(this.h) / 2;
    let rx = ds.value(this.rx);
    let ry = ds.value(this.ry);
    const cx = ds.value(this.x);
    const cy = ds.value(this.y);
    if (rx === 0 && ry === 0) {
      const minv = Math.min(wd, ht) * 2;
      rx = minv / 5;
      ry = minv / 5;
    }
    const pts = [
      new Point(cx + wd - rx, cy - ht),
      new Point(cx + wd - rx * (1 - K), cy - ht),
      new Point(cx + wd, cy - ht + ry * (1 - K)),
      new Point(cx + wd, cy - ht + ry),
      new Point(cx + wd, cy + ht - ry),
      new Point(cx + wd, cy + ht - ry * (1 - K)),
      new Point(cx + wd - rx * (1 - K), cy + ht),
      new Point(cx + wd - rx, cy + ht),
      new Point(cx - wd + rx, cy + ht),
      new Point(cx - wd + rx * (1 - K), cy + ht),
      new Point(cx - wd, cy + ht - ry * (1 - K)),
      new Point(cx - wd, cy + ht - ry),
      new Point(cx - wd, cy - ht + ry),
      new Point(cx - wd, cy - ht + ry * (1 - K)),
      new Point(cx - wd + rx * (1 - K), cy - ht),
      new Point(cx - wd + rx, cy - ht),
    ];
    const angle = ds.value(this.rotation) + ds.angle();
    this.points = angle !== 0 ? rotate(pts, new Point(cx, cy), angle) : pts;
  }
  layout(ds: DataStore): void {
    this.computePoints(ds);
  }
  paint(dp: DrawingPlatform): void {
    const p = (i: number) => this.points[i] ?? new Point();
    dp.moveTo(p(0));
    for (let i = 0; i < 4; i++) {
      dp.addCurve(new BezierCurve(p(i * 4), p(i * 4 + 1), p(i * 4 + 2), p(i * 4 + 3), 4));
      if (i < 3) dp.addLineTo(p(i * 4 + 4));
    }
    dp.addLineTo(p(0));
    dp.closePath();
  }
  getPositionPoints(pts: number[]): void {
    this.addPositionPoint(pts, this.x, this.y);
  }
}
