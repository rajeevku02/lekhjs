// The drag from a connect handle (port of C++ `ConnectDragger`, `ConnectPreview`
// (`SelectionDragger.cpp`) and the connect-drag half of `LekhCanvasDelegate`
// (`draggedConnectionType`, `buildDraggedConnection`, `draggedTargetAt`, `draggedPairNested`,
// `createDraggedConnection`, `LekhCanvasDelegate.cpp:700-990`); spec 02 `ConnectDragger`,
// `ConnectPreview`, `DraggedConnectionBuilder`).
//
// Per move it resolves what is under the pointer — another connectable shape (target mode), the
// source itself with the ends far enough apart (self-loop mode), or neither — and previews exactly
// the connector the drop would create there, with a translucent disc on the shape it would end
// on; over anything else, the configured connector type to the pointer. The drop creates it (one
// undo step, one `addobjects` frame), or opens the shape picker over empty canvas. `cancel()`
// (Escape, a cancelled gesture, a second finger) clears the preview and the drop creates nothing.
import type { Config } from '../../base';
import { AddObjectAction } from '../../edit';
import { BezierCurve, LineEquation, Point, getDistance, normalizeAngleIn2PI, toDegree } from '../../geometry';
import {
  AutoType,
  Bend,
  ConnectionObject,
  ConnectionParam as P,
  ConnectionType,
  LineGenerator,
  SelfLoopError,
  Side,
  attachPoint,
  selfLoopDefaults,
  selfLoopParams,
  sideAngle,
  sideOfAngle,
  stampNewContentFont,
  worldSideOf,
  type LekhObject,
  type ObjectEnv,
  type ObjectStore,
  type ParamMap,
  type Params,
} from '../../model';
import type { DrawingPlatform } from '../../render';
import { Style } from '../../style';
import type { CanvasView } from '../canvas-view';
import { BaseDragger } from '../drag-handler';
import { Movement } from '../gesture-listener';
import type { PointerEvent } from '../input-event';
import { OVERLAY_VALUES } from '../overlay-tokens';
import type { OverlayHost, OverlayPaint, Transient } from '../selection/types';

// ---- DraggedConnectionBuilder ----

function axisDirOf(side: Side): Point {
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

function axisSideOf(v: Point): Side {
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? Side.Right : Side.Left;
  return v.y >= 0 ? Side.Bottom : Side.Top;
}

function degreesOffAxis(v: Point): number {
  const deg = toDegree(Math.atan2(Math.abs(v.y), Math.abs(v.x)));
  return Math.min(deg, 90 - deg);
}

/** The world axis nearest `v` (+x for a zero vector). */
function dominantAxis(v: Point): Point {
  if (Math.abs(v.x) >= Math.abs(v.y)) return new Point(v.x >= 0 ? 1 : -1, 0);
  return new Point(0, v.y >= 0 ? 1 : -1);
}

/** C++ `ObjectStore::isConnectable`: a connectable kind that is not a group. */
export function isConnectable(obj: LekhObject | null): boolean {
  return obj !== null && obj.isConnectableKind() && obj.kind !== 'group';
}

/** C++ `ObjectStore::fullyContains`: `inner`'s outline (every 2°) inside `outer`'s body. */
export function fullyContains(outer: LekhObject, inner: LekhObject): boolean {
  if (outer === inner) return false;
  const orect = outer.selectionRect();
  const irect = inner.selectionRect();
  if (!orect.containsRect(irect)) return false;
  const c = irect.center();
  let outline: Point[] = [];
  for (let deg = 0; deg < 180; deg += 2) {
    const eq = LineEquation.fromAngle((deg * Math.PI) / 180, c);
    for (const ps of inner.getIntersection(eq)) outline.push(ps.point);
  }
  if (outline.length === 0) outline = irect.getPoints();
  return outline.every((p) => outer.isPointInside(p));
}

export function draggedPairNested(source: LekhObject, target: LekhObject): boolean {
  if (source === target) return false;
  return fullyContains(target, source) || fullyContains(source, target);
}

/**
 * C++ `draggedTargetAt`: the connectable object under `pt`, skipping shapes nested with the
 * source; `noTarget` when the source is reached only by skipping such a shape.
 */
export function draggedTargetAt(
  store: ObjectStore,
  source: LekhObject,
  pt: Point,
  zoom: number,
): { hit: LekhObject | null; noTarget: boolean } {
  const excludes = new Set<LekhObject>();
  for (;;) {
    const hit = store.hit.objectForConnection(pt, excludes, zoom);
    if (hit !== null && hit === source && excludes.size > 0) return { hit: null, noTarget: true };
    if (hit === null || hit === source || !draggedPairNested(source, hit)) return { hit, noTarget: false };
    excludes.add(hit);
  }
}

/** C++ `draggedConnectionType`. */
export function draggedConnectionType(config: Config, selfLoop: boolean): ConnectionType {
  let type = config.defaultConnectionType as ConnectionType;
  if (type !== ConnectionType.Curve && type !== ConnectionType.GenericLine && type !== ConnectionType.MultiLine) {
    type = ConnectionType.MultiLine;
  }
  if (selfLoop && type === ConnectionType.GenericLine) type = ConnectionType.MultiLine;
  return type;
}

function pinnedLine(
  env: ObjectEnv,
  source: LekhObject,
  angleFrom: number,
  target: LekhObject,
  angleTo: number,
): ConnectionObject {
  const params: Params = [{ [P.angle]: angleFrom, [P.autotype]: AutoType.NoAuto }, { [P.angle]: angleTo }];
  return ConnectionObject.getConnection(env, source, target, ConnectionType.GenericLine, params);
}

function curveEnd(angle: number): ParamMap {
  return { [P.angle1]: angle, [P.angle2]: 0, [P.cdist1]: 0.4, [P.angleauto]: 0, [P.cdistauto]: 1 };
}

function segment(dir: Point, step: number): ParamMap {
  return { [P.step]: step, [P.dx]: Math.trunc(dir.x), [P.dy]: Math.trunc(dir.y) };
}

function shouldStraighten(
  config: Config,
  con: ConnectionObject,
  source: LekhObject,
  exit: Side,
  target: LekhObject,
  entry: Side,
  zoom: number,
): boolean {
  const cs = source.connectionCentre();
  const ct = target.connectionCentre();
  const v = new Point(ct.x - cs.x, ct.y - cs.y);
  if (
    Math.abs(v.x) + Math.abs(v.y) > 0.001 &&
    axisSideOf(v) === exit &&
    degreesOffAxis(v) <= config.connectDragStraightenAngle + 1e-9
  ) {
    return true;
  }
  const de = axisDirOf(exit);
  const di = axisDirOf(entry);
  if (de.x !== -di.x || de.y !== -di.y) return false;
  con.updateConnection();
  const pts = con.routePoints();
  if (pts.length < 2) return false;
  const first = pts[0] as Point;
  const last = pts[pts.length - 1] as Point;
  const run = new Point(last.x - first.x, last.y - first.y);
  if (run.x * de.x + run.y * de.y <= 0) return false;
  if (pts.length === 2) return true;
  if (pts.length !== 4) return false;
  return getDistance(pts[1] as Point, pts[2] as Point) * zoom < config.connectDragStraightenMinSegment;
}

/** C++ `buildDraggedConnection`: the connector a drop at `targetAngle` of `target` creates. */
export function buildDraggedConnection(
  env: ObjectEnv,
  style: Style,
  source: LekhObject,
  sourceSide: Side,
  target: LekhObject,
  targetAngle: number,
  zoomIn: number,
): ConnectionObject | null {
  const config = env.config;
  const zoom = zoomIn <= 0 ? 1 : zoomIn;
  const angleFrom = sideAngle(source, sourceSide, 0.5);
  let con: ConnectionObject;
  if (source === target) {
    const type = draggedConnectionType(config, true);
    const opts = { ...selfLoopDefaults(config), minEndDist: config.selfLoopMinEndDistance / zoom, bend: Bend.Auto };
    const r = selfLoopParams(type, source, angleFrom, targetAngle, opts, config);
    if (r.error !== SelfLoopError.None) return null;
    con = ConnectionObject.getConnection(env, source, source, type, r.params);
  } else {
    const type = draggedConnectionType(config, false);
    if (type === ConnectionType.Curve) {
      con = ConnectionObject.getConnection(env, source, target, type, [curveEnd(angleFrom), curveEnd(targetAngle)]);
    } else if (type === ConnectionType.MultiLine) {
      const exit = worldSideOf(source, sourceSide);
      const entry = worldSideOf(target, sideOfAngle(target, targetAngle));
      const de = axisDirOf(exit);
      const di = axisDirOf(entry);
      const step = config.connectionDefaultParam;
      const p0: ParamMap = { ...segment(de, step), [P.autotype]: AutoType.NoAuto, [P.angle]: angleFrom };
      const p1: ParamMap = { ...segment(new Point(-di.x, -di.y), step), [P.angle]: targetAngle };
      con = ConnectionObject.getConnection(env, source, target, type, [p0, p1]);
      if (shouldStraighten(config, con, source, exit, target, entry, zoom)) {
        con = pinnedLine(env, source, angleFrom, target, targetAngle);
      }
    } else {
      con = pinnedLine(env, source, angleFrom, target, targetAngle);
    }
  }
  con.getDrawingProfile().copyFrom(style);
  const arrowType = config.defaultArrowType;
  con.arrows.setEndKind(arrowType !== 0, arrowType === 2);
  return con;
}

/**
 * C++ `canvasPreviewRoute`: the preview over empty canvas, view coordinates, from the handle's
 * attach point to the pointer. MultiLine: the `LineGenerator` route; Curve: one cubic with
 * control points at 40 % of the distance; else (or a zero distance) the straight line.
 */
export function canvasPreviewRoute(
  type: ConnectionType,
  from: Point,
  exitDir: Point,
  to: Point,
  stub: number,
): { points: Point[]; curves: BezierCurve[] } {
  const dist = getDistance(from, to);
  const endDir = dominantAxis(new Point(from.x - to.x, from.y - to.y));
  if (type === ConnectionType.Curve && dist > 1e-6) {
    const cd = dist * 0.4;
    return {
      points: [],
      curves: [
        new BezierCurve(
          from,
          new Point(from.x + exitDir.x * cd, from.y + exitDir.y * cd),
          new Point(to.x + endDir.x * cd, to.y + endDir.y * cd),
          to,
        ),
      ],
    };
  }
  if (type === ConnectionType.MultiLine && dist > 1e-6) {
    const lines = new LineGenerator(from, exitDir, stub, to, endDir, stub).generate();
    const first = lines[0];
    if (first !== undefined) return { points: [first.start, ...lines.map((l) => l.end)], curves: [] };
  }
  return { points: [from, to], curves: [] };
}

// ---- ConnectPreview ----

export class ConnectPreview implements Transient {
  route: Point[] = [];
  curves: BezierCurve[] = [];
  end: Point | null = null;
  targetCentre: Point | null = null;

  clear(): void {
    this.route = [];
    this.curves = [];
    this.end = null;
    this.targetCentre = null;
  }

  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    const color = paint.tokens.connectTargetColor;
    if (this.targetCentre !== null) {
      const cs = new Style();
      cs.setFillColor(color.withAlpha(Math.round(color.alpha * OVERLAY_VALUES.connectTargetOpacity)));
      cs.setStrokeWidth(0);
      dp.startDrawing(this.targetCentre, cs);
      dp.addCircle(this.targetCentre, OVERLAY_VALUES.connectTargetRadius);
      dp.endDrawing();
    }
    const ls = new Style();
    ls.setNoFill();
    ls.setStrokeColor(color);
    ls.setStrokeWidth(2);
    ls.setDashArray([6, 4]);
    if (this.route.length > 1) {
      dp.startDrawing(this.route[0] as Point, ls);
      for (let i = 1; i < this.route.length; i++) dp.addLineTo(this.route[i] as Point);
      dp.endDrawing();
    }
    for (const c of this.curves) {
      dp.startDrawing(c.point1, ls);
      dp.addCurve(c);
      dp.endDrawing();
    }
    if (this.end !== null) {
      const ds = new Style();
      ds.setFillColor(color);
      ds.setStrokeWidth(0);
      dp.startDrawing(this.end, ds);
      dp.addCircle(this.end, 4);
      dp.endDrawing();
    }
  }
}

// ---- ConnectDragger ----

export const ConnectMode = Object.freeze({ None: 0, Target: 1, SelfLoop: 2, Canvas: 3 } as const);
export type ConnectMode = (typeof ConnectMode)[keyof typeof ConnectMode];

export class ConnectDragger extends BaseDragger {
  override readonly kind: string = 'ConnectDragger';
  readonly preview = new ConnectPreview();
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private readonly source_: LekhObject;
  private readonly side_: Side;
  private cancelled_ = false;
  private shown_ = false;
  private mode_: ConnectMode = ConnectMode.None;
  private target_: LekhObject | null = null;
  private targetAngle_ = 0;

  constructor(overlay: OverlayHost, view: CanvasView, source: LekhObject, side: Side) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
    this.source_ = source;
    this.side_ = side;
  }

  get isCancelled(): boolean {
    return this.cancelled_;
  }

  get mode(): ConnectMode {
    return this.mode_;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    if (this.cancelled_) return;
    const board = this.overlay_.board;
    if (!board.page().objectStore.contains(this.source_) || board.readOnly()) {
      board.trace?.emit('connect.source_gone', { source: this.source_.id, readOnly: board.readOnly() });
      this.cancel();
      return;
    }
    if (m === Movement.Start) {
      this.showPreview();
      this.update(at);
    } else if (m === Movement.Move) {
      this.update(at);
    } else {
      this.drop(at);
    }
  }

  /** A second finger: not a connect any more. */
  override onScale(_at: Point, _ev: PointerEvent, _v: number, m: Movement): void {
    if (m === Movement.Start) this.cancel();
  }

  override cancel(): boolean {
    this.overlay_.board.trace?.emit('connect.cancel', { source: this.source_.id, mode: this.mode_ });
    this.cancelled_ = true;
    this.mode_ = ConnectMode.None;
    this.target_ = null;
    this.clearPreview();
    return true;
  }

  private showPreview(): void {
    if (this.shown_) return;
    this.overlay_.addTransient(this.preview);
    this.shown_ = true;
  }

  private clearPreview(): void {
    this.preview.clear();
    if (this.shown_) {
      this.overlay_.removeTransient(this.preview);
      this.overlay_.invalidate();
      this.shown_ = false;
    }
  }

  private update(viewPt: Point): void {
    const board = this.overlay_.board;
    const env = board.objectEnv();
    const zoom = board.view().zoom;
    const canvasPt = this.view_.toDoc(viewPt);
    const store = board.page().objectStore;
    const { hit, noTarget } = draggedTargetAt(store, this.source_, canvasPt, zoom);
    this.mode_ = noTarget ? ConnectMode.None : ConnectMode.Canvas;
    this.target_ = null;
    let con: ConnectionObject | null = null;
    if (hit !== null && (hit === this.source_ || isConnectable(hit))) {
      const c = hit.connectionCentre();
      const angle = normalizeAngleIn2PI(Math.atan2(canvasPt.y - c.y, canvasPt.x - c.x));
      con = buildDraggedConnection(env, board.currentStyle(), this.source_, this.side_, hit, angle, zoom);
      if (con !== null) {
        this.mode_ = hit === this.source_ ? ConnectMode.SelfLoop : ConnectMode.Target;
        this.target_ = hit;
        this.targetAngle_ = angle;
      } else if (hit === this.source_) {
        this.mode_ = ConnectMode.None;
      }
    }
    const pv = this.preview;
    pv.clear();
    if (con !== null && this.target_ !== null) {
      con.updateConnection();
      pv.route = con.routePoints().map((p) => this.view_.toView(p));
      pv.curves = con
        .routeCurves()
        .map(
          (c) =>
            new BezierCurve(
              this.view_.toView(c.point1),
              this.view_.toView(c.point2),
              this.view_.toView(c.point3),
              this.view_.toView(c.point4),
            ),
        );
      const lastRoute = pv.route[pv.route.length - 1];
      const lastCurve = pv.curves[pv.curves.length - 1];
      pv.end = lastRoute ?? lastCurve?.point4 ?? null;
      pv.targetCentre = this.view_.toView(this.target_.connectionCentre());
    } else {
      const angle = sideAngle(this.source_, this.side_, 0.5);
      const ap = attachPoint(this.source_, angle, board.config);
      const from = ap?.at ?? this.source_.connectionCentre();
      const normal = ap?.normalAngle ?? angle;
      const type = draggedConnectionType(board.config, false);
      const exitDir =
        type === ConnectionType.MultiLine
          ? axisDirOf(worldSideOf(this.source_, this.side_))
          : new Point(Math.cos(normal), Math.sin(normal));
      const stub = board.config.connectionDefaultParam * zoom;
      const r = canvasPreviewRoute(type, this.view_.toView(from), exitDir, viewPt, stub);
      pv.route = r.points;
      pv.curves = r.curves;
    }
    this.overlay_.invalidate();
  }

  private drop(viewPt: Point): void {
    this.update(viewPt);
    const mode = this.mode_;
    const target = this.target_;
    const angle = this.targetAngle_;
    this.overlay_.board.trace?.emit('connect.drop', {
      at: { x: Math.round(viewPt.x), y: Math.round(viewPt.y) },
      mode: ['none', 'target', 'selfLoop', 'canvas'][mode] ?? mode,
      target: target?.id ?? null,
    });
    this.clearPreview();
    if ((mode === ConnectMode.Target || mode === ConnectMode.SelfLoop) && target !== null) {
      this.create(target, angle);
    } else if (mode === ConnectMode.Canvas) {
      // The shape picker: picking places a shape at the drop point and connects it.
      this.overlay_.board.ui()?.shapePicker({
        at: this.view_.toDoc(viewPt),
        fromObjectId: this.source_.id,
        fromAnchor: sideName(this.side_),
      });
    }
    this.mode_ = ConnectMode.None;
    this.target_ = null;
  }

  /** C++ `createDraggedConnection`: nothing read-only, both ends present, never nested. */
  private create(target: LekhObject, angle: number): void {
    const board = this.overlay_.board;
    const source = this.source_;
    const side = this.side_;
    const out: { made: ConnectionObject | null } = { made: null };
    board.edit((ctx) => {
      if (board.readOnly()) return;
      const store = ctx.page.objectStore;
      if (!store.contains(source) || !store.contains(target)) return;
      if (draggedPairNested(source, target)) return;
      const con = buildDraggedConnection(
        board.objectEnv(),
        board.currentStyle(),
        source,
        side,
        target,
        angle,
        board.view().zoom,
      );
      if (con === null) return;
      stampNewContentFont(con);
      ctx.editor.tx.run(new AddObjectAction(ctx.editor.env, ctx.doc, [con]));
      out.made = con;
    });
    board.trace?.emit('connect.created', { connector: out.made?.id ?? null });
    if (out.made !== null) this.overlay_.select(out.made);
  }
}

function sideName(s: Side): string {
  return s === Side.Top ? 'top' : s === Side.Right ? 'right' : s === Side.Bottom ? 'bottom' : 'left';
}
