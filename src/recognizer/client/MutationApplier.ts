// The mutation half of C++ `LekhCanvasDelegate` on the main thread (spec 07 §6.6): validates a
// job's `RecMutation`s against the board and applies them as engine actions, with today's undo
// granularity and `SessionStats` calls.
//
// | mutation              | C++ (`LekhCanvasDelegate.cpp`)                         | undo            |
// |-----------------------|--------------------------------------------------------|-----------------|
// | `convert`             | `convert` → ShapeToLekh + ConvertObjectsAction (:260)  | one step        |
// | `delete` then `add`   | `deleteShapes` (:300), `addShapes` (:280)              | two steps       |
// | `add`                 | `addShapes`                                            | one             |
// | `connect`             | `addConnection` (:343): line/auto choice on the main   | one             |
// |                       | thread, AddObjectAction or ConvertObjectsAction        |                 |
// | `doubleLineArrow`     | `addDoubleLineArrow` → ConvertObjectsAction (:479)     | one             |
// | `arrow`               | `changeArrow` → ArrowAddEraseAction (:550)             | one             |
// | `ink`                 | `addUnrecognizedShape` → AddObjectAction (:581)        | one             |
//
// Geometry arrives in VIEW coordinates of the job's captured transform and is mapped to canvas
// space with that transform (not the current one), replacing `LekhUtil::mapPoint/mapRect` and
// `CanvasWidget::zoomNewlyAddedObject`. One difference follows: C++ built a new shape in view
// space and then scaled it, so its grid snap (`snapToGridNewObject`) was applied to VIEW
// coordinates; here the canvas rect is snapped (they agree at zoom 1 and scroll 0).
//
// Validation (`rec_stale`): every object a mutation names must still be on the job's page with
// the `rev` the snapshot saw, or have been changed only by the session's own live edits during
// the hold. If any is not, nothing is applied and the caller turns the stroke into ink.
import { Ellipse, GeoShape, PathComponent, Point, Rect, SimplePath, LineSegment, BezierCurve } from '../../geometry';
import { AddObjectAction, ArrowAddEraseAction, ConvertObjectsAction, DeleteObjectAction } from '../../edit';
import {
  ArrowLocation,
  ConnectionObject,
  ConnectionType,
  OPEN_ARROW_ID,
  SOLID_ARROW_ID,
  TemplatedObject,
  UnrecognizedObject,
  type LekhObject,
  type ObjectEnv,
  type Params,
} from '../../model';
import type { CommandContext } from '../../session';
import type { Style } from '../../style';
import { BezierCurveTemplate, PathTemplate, PolygonTemplate, type TemplateEnv } from '../../template';
import { toCanvas } from '../delegate/SnapshotCanvasDelegate';
import type { ObjectId, Pt, RecMutation, RecShapeDTO } from '../delegate/RecMutation';
import type { RecViewTransform } from '../delegate/SceneStore';
import { shapeToLekh, type RecognizedObjectSpec } from './ShapeToLekh';

/** C++ `SessionStats::current()` calls of the delegate (the host brackets them per stroke). */
export interface RecognitionStats {
  markRecognized(): void;
  markInk(): void;
  onConnectorAdded(): void;
}

export const NO_STATS: RecognitionStats = Object.freeze({
  markRecognized(): void {},
  markInk(): void {},
  onConnectorAdded(): void {},
});

/** What the applier needs to know about the job a result belongs to. */
export interface AppliedJob {
  /** The transform the stroke was captured with (`JobMsg.view`). */
  readonly view: RecViewTransform;
  /** `rev` of every object the snapshot named. */
  readonly revs: ReadonlyMap<string, number>;
  /** The page the snapshot was taken on. */
  readonly pageId: string;
}

export interface MutationApplierOptions {
  /** The drawing style new shapes take (C++ `LekhGlobal::currentStyle`). */
  readonly currentStyle: () => Style;
  readonly stats?: RecognitionStats;
}

export type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly code: 'rec_stale' };

/** C++ `addConnection`'s line-vs-auto threshold (degrees). */
const LINE_VS_AUTO_DEG = 32;

/** The ids a mutation names on the board. */
export function referencedIds(m: RecMutation): readonly ObjectId[] {
  switch (m.op) {
    case 'convert':
      return m.deleteIds;
    case 'delete':
      return m.ids;
    case 'connect':
      return [m.obj1Id, m.obj2Id, ...m.deletedIds];
    case 'doubleLineArrow':
      return [m.obj1Id, m.obj2Id];
    case 'arrow':
      return [m.objId];
    case 'add':
    case 'ink':
      return [];
  }
}

function pt(view: RecViewTransform, p: Pt): Point {
  return toCanvas(view, new Point(p.x, p.y));
}

/** A recognised shape DTO (view coords) as a canvas-space `GeoShape`. */
export function shapeToCanvas(dto: RecShapeDTO, view: RecViewTransform): GeoShape {
  const shape = new GeoShape();
  if (dto.kind === 'ellipse') {
    shape.setEllipse(new Ellipse(pt(view, dto.center), dto.width / view.zoom, dto.height / view.zoom, dto.rotation));
  } else {
    const path = new SimplePath();
    for (const c of dto.components) {
      if (c.curve) {
        path.push(
          PathComponent.ofCurve(new BezierCurve(pt(view, c.p1), pt(view, c.c1), pt(view, c.c2), pt(view, c.p2))),
        );
      } else {
        path.push(PathComponent.ofSegment(new LineSegment(pt(view, c.p1), pt(view, c.p2))));
      }
    }
    path.setClosed(dto.closed);
    shape.setPath(path);
  }
  shape.setSnap(dto.snap);
  return shape;
}

/** The view rect `r` in canvas space (C++ `LekhUtil::mapRect`). */
function rectToCanvas(view: RecViewTransform, r: Rect): Rect {
  return new Rect((r.x - view.tx) / view.zoom, (r.y - view.ty) / view.zoom, r.width / view.zoom, r.height / view.zoom);
}

function objectEnvOf(ctx: CommandContext): ObjectEnv {
  return ctx.editor.env.codec.env.objects;
}

function templateEnvOf(ctx: CommandContext): TemplateEnv {
  return ctx.editor.env.codec.env.templates;
}

export class MutationApplier {
  private readonly o_: MutationApplierOptions;
  private readonly stats_: RecognitionStats;

  constructor(opts: MutationApplierOptions) {
    this.o_ = opts;
    this.stats_ = opts.stats ?? NO_STATS;
  }

  /** Whether every object `mutations` name is unchanged since the snapshot (or changed only by `touched`). */
  validate(
    ctx: CommandContext,
    mutations: readonly RecMutation[],
    job: AppliedJob,
    touched: ReadonlySet<string> = new Set(),
  ): boolean {
    if (ctx.page.id !== job.pageId) return mutations.every((m) => referencedIds(m).length === 0);
    const store = ctx.page.objectStore;
    for (const m of mutations) {
      for (const id of referencedIds(m)) {
        const o = store.getObject(id);
        if (o === null) return false;
        if (touched.has(id)) continue;
        const rev = job.revs.get(id);
        if (rev === undefined || rev !== o.rev) return false;
      }
    }
    return true;
  }

  /** Validates, then applies `mutations` in order; nothing is applied when stale. */
  apply(
    ctx: CommandContext,
    mutations: readonly RecMutation[],
    job: AppliedJob,
    touched?: ReadonlySet<string>,
  ): ApplyOutcome {
    if (!this.validate(ctx, mutations, job, touched)) return { ok: false, code: 'rec_stale' };
    for (const m of mutations) this.applyOne(ctx, m, job.view);
    return { ok: true };
  }

  /** The unrecognised fallback: the stroke's points (view coords of `view`) as one ink object. */
  applyInk(ctx: CommandContext, points: Float64Array, view: RecViewTransform): void {
    this.applyOne(ctx, { op: 'ink', points }, view);
  }

  private style(obj: LekhObject): void {
    obj.getDrawingProfile().copyFrom(this.o_.currentStyle());
  }

  private objectsOf(ctx: CommandContext, ids: readonly ObjectId[]): LekhObject[] {
    const store = ctx.page.objectStore;
    const out: LekhObject[] = [];
    for (const id of ids) {
      const o = store.getObject(id);
      if (o !== null) out.push(o);
    }
    return out;
  }

  /** C++ `ShapeToLekh::getLekhObject` → the object (canvas coords). */
  private buildShape(ctx: CommandContext, shape: GeoShape): LekhObject | null {
    const config = ctx.editor.env.codec.env.objects.config;
    const spec: RecognizedObjectSpec = shapeToLekh(shape, config.snapToGridNewObject);
    const oenv = objectEnvOf(ctx);
    const tenv = templateEnvOf(ctx);
    const snapStep = ctx.doc.snapStep();
    let obj: LekhObject | null = null;
    switch (spec.kind) {
      case 'ellipse': {
        const t = tenv.resolver.getTemplate(spec.templateId);
        if (t === null) return null;
        obj = new TemplatedObject(oenv, t, spec.rect, spec.angle, spec.snap ? snapStep : null);
        break;
      }
      case 'polygon': {
        const p = PolygonTemplate.getPolygonTemplate(tenv, spec.points, spec.closed, false);
        obj = new TemplatedObject(oenv, p.template, p.bound, p.angle, spec.snap ? snapStep : null);
        break;
      }
      case 'bezier':
        obj = new TemplatedObject(
          oenv,
          new BezierCurveTemplate(tenv, spec.curve, spec.bound),
          spec.bound,
          0,
          spec.snap ? snapStep : null,
        );
        break;
      case 'path': {
        const p = PathTemplate.from(tenv, spec.path);
        obj = new TemplatedObject(oenv, p.template, p.bound, 0, null);
        break;
      }
    }
    this.style(obj);
    return obj;
  }

  private applyOne(ctx: CommandContext, m: RecMutation, view: RecViewTransform): void {
    const ed = ctx.editor;
    switch (m.op) {
      case 'convert': {
        const o = this.buildShape(ctx, shapeToCanvas(m.shape, view));
        if (o === null) return;
        ed.tx.run(new ConvertObjectsAction(ed.env, ctx.doc, this.objectsOf(ctx, m.deleteIds), o));
        this.stats_.markRecognized();
        return;
      }
      case 'delete':
        ed.tx.run(new DeleteObjectAction(ed.env, ctx.doc, this.objectsOf(ctx, m.ids)));
        return;
      case 'add': {
        const objs: LekhObject[] = [];
        for (const s of m.shapes) {
          const o = this.buildShape(ctx, shapeToCanvas(s, view));
          if (o !== null) objs.push(o);
        }
        if (objs.length === 0) return;
        ed.tx.run(new AddObjectAction(ed.env, ctx.doc, objs));
        this.stats_.markRecognized();
        return;
      }
      case 'connect':
        this.connect(ctx, m);
        return;
      case 'doubleLineArrow':
        this.doubleLineArrow(ctx, m, view);
        return;
      case 'arrow':
        this.arrow(ctx, m, view);
        return;
      case 'ink': {
        const pts: Point[] = [];
        for (let i = 0; i + 1 < m.points.length; i += 2) {
          pts.push(toCanvas(view, new Point(m.points[i] ?? 0, m.points[i + 1] ?? 0)));
        }
        if (pts.length === 0) return;
        const obj = new UnrecognizedObject(objectEnvOf(ctx), pts);
        this.style(obj);
        ed.tx.run(new AddObjectAction(ed.env, ctx.doc, [obj]));
        this.stats_.markInk();
        return;
      }
    }
  }

  /** C++ `hasLineConnection`: a GenericLine connector already joins the two. */
  private hasLineConnection(ctx: CommandContext, a: LekhObject, b: LekhObject): boolean {
    for (const o of ctx.page.objectStore.objects) {
      if (!(o instanceof ConnectionObject) || o.getType() !== ConnectionType.GenericLine) continue;
      const [f, s] = o.endIds();
      if ((f === a.id && s === b.id) || (f === b.id && s === a.id)) return true;
    }
    return false;
  }

  /** C++ `getLineConnection`: the drawn line, or the automatic one when they point alike. */
  private lineConnection(
    ctx: CommandContext,
    a: LekhObject,
    b: LekhObject,
    autoType: number,
    params: Params,
  ): ConnectionObject {
    const env = objectEnvOf(ctx);
    const con = ConnectionObject.getConnection(env, a, b, ConnectionType.GenericLine, params);
    if (this.hasLineConnection(ctx, a, b)) return con;
    const autoCon = ConnectionObject.getAutoConnection(env, a, b, autoType);
    autoCon.updateConnection();
    const pts1 = autoCon.getInterestingPoints();
    con.updateConnection();
    const pts2 = con.getInterestingPoints();
    const [a1, a2] = pts1;
    const [b1, b2] = pts2;
    if (
      pts1.length !== 2 ||
      pts2.length !== 2 ||
      a1 === undefined ||
      a2 === undefined ||
      b1 === undefined ||
      b2 === undefined
    ) {
      return autoCon;
    }
    const angle1 = (Math.atan2(a2.point.y - a1.point.y, a2.point.x - a1.point.x) * 180) / Math.PI;
    const angle2 = (Math.atan2(b2.point.y - b1.point.y, b2.point.x - b1.point.x) * 180) / Math.PI;
    return Math.abs(angle1 - angle2) < LINE_VS_AUTO_DEG ? autoCon : con;
  }

  private connect(ctx: CommandContext, m: Extract<RecMutation, { op: 'connect' }>): void {
    const store = ctx.page.objectStore;
    const a = store.getObject(m.obj1Id);
    const b = store.getObject(m.obj2Id);
    if (a === null || b === null) return;
    const env = objectEnvOf(ctx);
    const params: Params = m.params.map((p) => ({ ...p }));
    let con: ConnectionObject;
    if (m.type === ConnectionType.MultiLine && m.autoType !== 0) {
      if (m.autoType === 1) con = this.lineConnection(ctx, a, b, m.autoType, params);
      else if (m.autoType === 6 || m.autoType === 7)
        con = ConnectionObject.getAutoConnection(env, a, b, m.autoType, m.val);
      else con = ConnectionObject.getAutoConnection(env, a, b, m.autoType);
    } else {
      con = ConnectionObject.getConnection(env, a, b, m.type as ConnectionType, params);
    }
    this.style(con);
    const arrowType = env.config.defaultArrowType;
    con.arrows.setEndKind(arrowType !== 0, arrowType === 2);
    const ed = ctx.editor;
    if (m.deletedIds.length === 0) ed.tx.run(new AddObjectAction(ed.env, ctx.doc, [con]));
    else ed.tx.run(new ConvertObjectsAction(ed.env, ctx.doc, this.objectsOf(ctx, m.deletedIds), con));
    this.stats_.markRecognized();
    this.stats_.onConnectorAdded();
  }

  /** C++ `addDoubleLineArrow`: the arrow shape between two strokes, replacing them. */
  private doubleLineArrow(
    ctx: CommandContext,
    m: Extract<RecMutation, { op: 'doubleLineArrow' }>,
    view: RecViewTransform,
  ): void {
    const w = m.len + (3 * m.lineDist) / 2;
    const h = 2 * m.lineDist;
    let rect = new Rect(m.center.x - w / 2, m.center.y - h / 2, w, h);
    const startP = m.firstSide ? m.seg1.p2 : m.seg1.p1;
    const endP = m.firstSide ? m.seg1.p1 : m.seg1.p2;
    let angle = Math.atan2(endP.y - startP.y, endP.x - startP.x);
    rect = rectToCanvas(view, rect);
    let inverted = false;
    if (Math.abs(Math.PI - angle) < 0.01) {
      inverted = true;
      angle = 0;
    }
    const tenv = templateEnvOf(ctx);
    const t = tenv.resolver.getTemplate(inverted ? 'avabodh.basic.arrow_backward' : 'avabodh.basic.arrow_forward');
    if (t === null) return;
    const config = objectEnvOf(ctx).config;
    const obj = new TemplatedObject(
      objectEnvOf(ctx),
      t,
      rect,
      angle,
      config.snapToGridNewObject ? ctx.doc.snapStep() : null,
    );
    this.style(obj);
    const ed = ctx.editor;
    ed.tx.run(new ConvertObjectsAction(ed.env, ctx.doc, this.objectsOf(ctx, [m.obj1Id, m.obj2Id]), obj));
    this.stats_.markRecognized();
  }

  /** C++ `changeArrow`: add or erase the arrowhead at an end. */
  private arrow(ctx: CommandContext, m: Extract<RecMutation, { op: 'arrow' }>, view: RecViewTransform): void {
    const obj = ctx.page.objectStore.getObject(m.objId);
    if (!(obj instanceof TemplatedObject) && !(obj instanceof ConnectionObject)) return;
    const at = toCanvas(view, new Point(m.at.x, m.at.y));
    this.stats_.markRecognized();
    const pts = obj.getArrowPoints();
    const info = obj.arrows.arrowAt(pts, at);
    if (info.location === ArrowLocation.None) return;
    const ed = ctx.editor;
    if (m.add) {
      // C++ `addAt` refuses an end that already has one.
      if (info.template !== null) return;
      const head = objectEnvOf(ctx).arrowhead(m.solid ? SOLID_ARROW_ID : OPEN_ARROW_ID);
      if (head === null) return;
      ed.tx.run(new ArrowAddEraseAction(ed.env, ctx.doc, obj, { template: head, location: info.location }, 'add'));
    } else {
      ed.tx.run(new ArrowAddEraseAction(ed.env, ctx.doc, obj, info, 'erase'));
    }
  }
}
