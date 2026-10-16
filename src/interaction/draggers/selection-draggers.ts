// The draggers of the selection (port of C++ `L/object/widget/selection/SelectionDragger.cpp`):
// move, pinch-scale, resize from a corner, rotate, vertex edit, move a label, and the rubber band.
// Each changes its objects live through `board.edit` (one queued command per step) and records
// its one undo step, with its one update, at the End (C++ `addAction(act, true)`).
import {
  ConnectionVertexEditAction,
  RotateAction,
  ScaleAction,
  TemplateModificationAction,
  TextMoveAction,
  VertexEditAction,
  isMulti,
  selectionOf,
  type EditTarget,
} from '../../edit';
import { Point, PointType, Rect, getDistance, getPointAtDistance } from '../../geometry';
import { ConnectionObject, TemplatedObject, type LekhObject, type MovableTextInfo } from '../../model';
import type { DrawingPlatform } from '../../render';
import { Style } from '../../style';
import { dragContext } from '../board';
import type { CanvasView } from '../canvas-view';
import { BaseDragger } from '../drag-handler';
import { Movement } from '../gesture-listener';
import type { PointerEvent } from '../input-event';
import {
  ShapePointType,
  type OverlayHost,
  type OverlayPaint,
  type SelectionRectHost,
  type Transient,
  type VertexHandleHost,
} from '../selection/types';

/** True when `t` is still on the active page (every object of a multi-selection). */
export function onPage(overlay: OverlayHost, t: EditTarget | null): boolean {
  if (t === null) return false;
  const store = overlay.board.page().objectStore;
  return isMulti(t) ? t.objects.every((o) => store.contains(o)) : store.contains(t);
}

export class SelectionDragger extends BaseDragger {
  override readonly kind: string = 'SelectionDragger';
  private readonly rect_: SelectionRectHost;
  private last_ = new Point();

  constructor(rect: SelectionRectHost) {
    super();
    this.rect_ = rect;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    if (m === Movement.Start) {
      this.last_ = at;
      this.rect_.move(0, 0, m);
    } else {
      this.rect_.move(at.x - this.last_.x, at.y - this.last_.y, m);
    }
    this.last_ = at;
  }
}

export class ShapeScaleDragger extends BaseDragger {
  override readonly kind: string = 'ShapeScaleDragger';
  private readonly overlay_: OverlayHost;
  private readonly targetId_: string;

  constructor(overlay: OverlayHost, target: LekhObject) {
    super();
    this.overlay_ = overlay;
    this.targetId_ = target.id;
  }

  override onScale(_at: Point, _ev: PointerEvent, value: number, m: Movement): void {
    const board = this.overlay_.board;
    const id = this.targetId_;
    if (m === Movement.Start) {
      board.edit((ctx) => {
        ctx.page.objectStore.getObject(id)?.startModification(dragContext(board, ctx.doc));
      });
      this.overlay_.selectionRect().setIsScaling(true);
      this.overlay_.invalidate();
      return;
    }
    board.edit((ctx) => {
      const t = ctx.page.objectStore.getObject(id);
      if (t === null) return;
      t.scale(value, value);
      if (m === Movement.End) {
        const f = t.finishScaling();
        if (f.x !== 1 && f.x !== 0) ctx.editor.tx.record(new ScaleAction(ctx.editor.env, ctx.doc, t, f.x));
      }
    });
    if (m === Movement.End) {
      this.overlay_.selectionRect().setIsScaling(false);
      this.overlay_.refreshSelection();
    }
    board.requestPaint('drawing');
  }
}

export class ResizeDragger extends BaseDragger {
  override readonly kind: string = 'ResizeDragger';
  private readonly rect_: SelectionRectHost;
  private readonly handle_: VertexHandleHost | null;
  private readonly vid_: number;

  constructor(rect: SelectionRectHost, vid: number, handle: VertexHandleHost | null = null) {
    super();
    this.rect_ = rect;
    this.vid_ = vid;
    this.handle_ = handle;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    this.rect_.moveResizer(at, m, this.vid_);
    this.handle_?.update(at, m);
  }
}

export class RotateDragger extends BaseDragger {
  override readonly kind: string = 'RotateDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private readonly rect_: SelectionRectHost | null;
  private readonly handle_: VertexHandleHost | null;
  private targetId_: string | null = null;
  private centre_ = new Point();
  private angle_ = 0;
  private radius_ = 0;

  constructor(
    overlay: OverlayHost,
    view: CanvasView,
    rect: SelectionRectHost | null,
    handle: VertexHandleHost | null = null,
  ) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
    this.rect_ = rect;
    this.handle_ = handle;
  }

  private callOnOwner(at: Point, m: Movement): void {
    this.rect_?.moveRotater(at, m);
    this.handle_?.update(at, m);
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    const board = this.overlay_.board;
    if (m === Movement.Start) {
      const t = this.rect_ !== null ? this.rect_.target() : (this.handle_?.target() ?? null);
      const obj = t !== null && !isMulti(t) ? t : null;
      if (obj !== null && board.page().objectStore.contains(obj)) {
        this.targetId_ = obj.id;
        this.centre_ = this.view_.toView(obj.getCenter());
        this.angle_ = Math.atan2(at.y - this.centre_.y, at.x - this.centre_.x);
        this.radius_ = getDistance(this.centre_, at);
        board.edit((ctx) => {
          ctx.page.objectStore.getObject(obj.id)?.startModification(dragContext(board, ctx.doc));
        });
        this.callOnOwner(at, m);
      } else {
        this.targetId_ = null;
      }
      return;
    }
    const id = this.targetId_;
    if (id === null) return;
    const p = getPointAtDistance(this.centre_, at, this.radius_);
    const cur = Math.atan2(p.y - this.centre_.y, p.x - this.centre_.x);
    const res = { gone: false };
    board.edit((ctx) => {
      const t = ctx.page.objectStore.getObject(id);
      if (t === null) {
        res.gone = true;
        return;
      }
      t.rotate(cur - this.angle_);
      if (m === Movement.End) {
        const total = t.finishRotating();
        ctx.editor.tx.record(new RotateAction(ctx.editor.env, ctx.doc, t, total));
      }
    });
    this.callOnOwner(at, m);
    if (m === Movement.End) {
      if (res.gone) this.overlay_.deselect();
      this.targetId_ = null;
    }
    board.requestPaint('drawing');
  }
}

export class VertexDragger extends BaseDragger {
  override readonly kind: string = 'VertexDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private readonly targetId_: string;
  private readonly vid_: number;
  private readonly type_: ShapePointType;
  private delta_ = new Point();
  private from_ = new Point();

  constructor(overlay: OverlayHost, view: CanvasView, target: LekhObject, vid: number, type: ShapePointType) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
    this.targetId_ = target.id;
    this.vid_ = vid;
    this.type_ = type;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    const board = this.overlay_.board;
    const id = this.targetId_;
    const target = board.page().objectStore.getObject(id);
    if (target === null) return;
    if (m === Movement.Start) {
      const pts = target.getInterestingPoints();
      const ip = pts[this.vid_];
      if (ip !== undefined) {
        const v = this.view_.toView(ip.point);
        this.from_ = ip.point;
        this.delta_ = new Point(at.x - v.x, at.y - v.y);
      }
      const type = this.type_;
      board.edit((ctx) => {
        const t = ctx.page.objectStore.getObject(id);
        if (t === null) return;
        t.startModification(dragContext(board, ctx.doc));
        if (t instanceof TemplatedObject && type !== ShapePointType.Attr) t.saveDataExprs();
      });
      this.overlay_.moveVertexHandle(at, m);
      return;
    }
    let npt = this.view_.toDoc(new Point(at.x - this.delta_.x, at.y - this.delta_.y));
    const vid = this.vid_;
    const type = this.type_;
    const from = this.from_;
    const snapDist = board.config.vertexEditSnapDistance;
    board.edit((ctx) => {
      const t = ctx.page.objectStore.getObject(id);
      if (t === null) return;
      t.moveVertexTo(vid, npt);
      if (m !== Movement.End) return;
      const env = ctx.editor.env;
      if (type === ShapePointType.Attr) {
        const ve = t instanceof ConnectionObject ? t.vertexEdit() : null;
        if (t instanceof ConnectionObject && ve !== null) {
          ctx.editor.tx.record(new ConnectionVertexEditAction(env, ctx.doc, t, ve.params, ve.saved));
        } else {
          ctx.editor.tx.record(new VertexEditAction(env, ctx.doc, t, vid, from, npt));
        }
      } else if (t instanceof TemplatedObject) {
        // Snap to the nearest vertex or centre of another shape.
        let best = Number.MAX_SAFE_INTEGER;
        let near: Point | null = null;
        for (const o of ctx.page.objectStore.objects) {
          if (o === t) continue;
          for (const ip of o.getInterestingPoints()) {
            if (ip.type !== PointType.Vertex && ip.type !== PointType.Center) continue;
            const d = getDistance(ip.point, npt);
            if (d < best) {
              best = d;
              near = ip.point;
            }
          }
        }
        if (near !== null && best < snapDist) npt = t.moveVertexTo(vid, near);
        t.endVertexEditing();
        const ds = t.ds;
        const stl = t.shapeTemplate();
        const oldRect = Rect.fromCenter(new Point(ds.savedCx(), ds.savedCy()), ds.savedWidth(), ds.savedHeight());
        ctx.editor.tx.record(
          new TemplateModificationAction(
            env,
            ctx.doc,
            t,
            { exprs: ds.savedDataExprs(), rect: oldRect, angle: ds.savedAngle() },
            { exprs: stl?.dataExprs() ?? [], rect: ds.rect(), angle: ds.angle() },
          ),
        );
      }
    });
    this.overlay_.refreshSelection();
    this.overlay_.moveVertexHandle(at, m);
    board.requestPaint('drawing');
  }
}

export class TextDragger extends BaseDragger {
  override readonly kind: string = 'TextDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private readonly mti_: MovableTextInfo;
  private newParam_ = 0;

  constructor(overlay: OverlayHost, view: CanvasView, mti: MovableTextInfo) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
    this.mti_ = mti;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    const pt = this.view_.toDoc(at);
    const mti = this.mti_;
    this.overlay_.board.edit((ctx) => {
      const obj = ctx.page.objectStore.getObject(mti.obj.id) ?? mti.obj;
      const param = obj.moveTextNear(mti.index, pt);
      if (param !== null) this.newParam_ = param;
      if (m === Movement.End)
        ctx.editor.tx.record(new TextMoveAction(ctx.editor.env, ctx.doc, { ...mti, obj }, this.newParam_));
    });
    this.overlay_.board.requestPaint('drawing');
    this.overlay_.refreshSelection();
  }
}

/** The rubber band (C++ `SelectDragObject`), in view coordinates. */
export class SelectDragObject implements Transient {
  first = new Point();
  last = new Point();

  handleDrag(at: Point, m: Movement): void {
    if (m === Movement.Start) this.first = at;
    this.last = at;
  }

  rect(): Rect {
    return new Rect(this.first.x, this.first.y, 0, 0).include(this.last);
  }

  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    const s = new Style();
    s.setStrokeColor(paint.tokens.rubberBandStroke);
    s.setFillColor(paint.tokens.rubberBandFill);
    s.setStrokeWidth(1);
    const pts = this.rect().getPoints();
    const p0 = pts[0] as Point;
    dp.startDrawing(p0, s);
    dp.moveTo(p0);
    for (let i = 1; i < pts.length; i++) dp.addLineTo(pts[i] as Point);
    dp.closePath();
    dp.endDrawing();
  }
}

export class MultiSelectDragger extends BaseDragger {
  override readonly kind: string = 'MultiSelectDragger';
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private drag_: SelectDragObject | null = null;

  constructor(overlay: OverlayHost, view: CanvasView) {
    super();
    this.overlay_ = overlay;
    this.view_ = view;
  }

  /** The rubber band in progress (tests). */
  get band(): SelectDragObject | null {
    return this.drag_;
  }

  override onPan(at: Point, _ev: PointerEvent, m: Movement): void {
    if (m === Movement.Start) {
      this.overlay_.deselect();
      this.drag_ = new SelectDragObject();
      this.overlay_.addTransient(this.drag_);
    }
    this.drag_?.handleDrag(at, m);
    this.overlay_.invalidate();
    if (m === Movement.End && this.drag_ !== null) {
      this.selectObjects(this.drag_);
      this.overlay_.removeTransient(this.drag_);
      this.drag_ = null;
    }
  }

  private selectObjects(d: SelectDragObject): void {
    const a = this.view_.toDoc(d.first);
    const b = this.view_.toDoc(d.last);
    const rect = new Rect(a.x, a.y, 0, 0).include(b);
    const objs = this.overlay_.board.page().objectStore.objectsIn(rect);
    const t = selectionOf(objs);
    if (t !== null) this.overlay_.select(t);
  }
}
