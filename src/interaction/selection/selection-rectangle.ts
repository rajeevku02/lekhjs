// The selection rectangle with its corner handles and connect handles (port of C++
// `SelectionRectangleWidget` and `CornerWidget`, `L/object/widget/selection/`; spec 02
// `SelectionRectangle`, `CornerHandle`). Everything is in view coordinates (C++ kept the corners
// relative to the widget; the frame offsets cancel out).
//
// It draws the dashed rectangle, the rotation indicator and its line, the size / location / angle
// labels during drags, the corner glyphs (drawn directly, no icon widget) and the connect handles,
// and it moves, resizes and rotates its target live, recording one undo step at the End.
import { ExpandAction, MultiSelection, TranslateObjectAction, isMulti, type EditTarget } from '../../edit';
import {
  Point,
  PointType,
  Rect,
  getDistance,
  getMidPoint,
  getPointsBound,
  isPointInsidePolygon,
  normalizeAngleIn2PI,
  rotate,
  rotateAboutMid,
  toDegreeReadable,
} from '../../geometry';
import { TemplatedObject, snapNumber, type GroupObject, type LekhObject } from '../../model';
import type { DrawingPlatform } from '../../render';
import { Style, type Color } from '../../style';
import { dragContext } from '../board';
import type { CanvasView } from '../canvas-view';
import { ConnectDragger, isConnectable } from '../draggers/connect-dragger';
import { NoOpDragger } from '../drag-handler';
import {
  ResizeDragger,
  RotateDragger,
  SelectionDragger,
  TextDragger,
  VertexDragger,
} from '../draggers/selection-draggers';
import { EventName, Movement } from '../gesture-listener';
import { drawGlyph } from '../glyphs';
import { InputMode } from '../input-mode';
import { PointerType, type PointerEvent } from '../input-event';
import {
  ConnectHandle,
  canStartDrag,
  cornerHitRadius,
  handleCentres,
  hitRadius,
  overlapsCorner,
  shouldShow,
  type HandleSide,
  type Visibility,
} from './connect-handles';
import { ShapePointType, type OverlayHost, type OverlayPaint, type SelectionRectHost, type ShapePoint } from './types';

/** A corner of the rectangle: a rotater (corner 0), a resizer, or inert. */
export interface CornerHandle {
  readonly vid: number;
  readonly type: ShapePointType;
  centre: Point;
}

/** Whether `t` is a templated object or a multi-selection (C++ `is_instance_of<TemplatedObject>`). */
function templatedLike(t: EditTarget | null): boolean {
  return t instanceof TemplatedObject || isMulti(t);
}

export class SelectionRectangle implements SelectionRectHost {
  private readonly overlay_: OverlayHost;
  private readonly view_: CanvasView;
  private target_: EditTarget | null = null;
  private corners_: Point[] = [];
  private bounds_ = new Rect();
  private frame_ = new Rect();
  private selRectDiff_ = new Point();
  private origBounds_ = new Rect();
  private dragStart_ = new Point();
  private dragOpposite_ = new Point();
  private cornerHandles_: CornerHandle[] = [];
  private readonly connectHandles_: ConnectHandle[] = [0, 1, 2, 3].map((s) => new ConnectHandle(s as HandleSide));
  /** The temporary group a multi-selection moves as (C++ `MultiSelectedObjects::groupObject_`). */
  private moveGroup_: GroupObject | null = null;
  isResizing = false;
  isRotating = false;
  isMoving = false;
  isScaling = false;
  underVertexHandle = false;
  /** Whether the vertex handle shown is a rotater (the rotation-indicator line). */
  vertexHandleIsRotater = false;

  constructor(overlay: OverlayHost, view: CanvasView) {
    this.overlay_ = overlay;
    this.view_ = view;
  }

  target(): EditTarget | null {
    return this.target_;
  }

  corners(): readonly Point[] {
    return this.corners_;
  }

  /** The polygon's axis-aligned bounds, before the handle padding (the menu's anchor). */
  bounds(): Rect {
    return getPointsBound(this.corners_);
  }

  frame(): Rect {
    return this.frame_;
  }

  cornerHandles(): readonly CornerHandle[] {
    return this.cornerHandles_;
  }

  connectHandles(): readonly ConnectHandle[] {
    return this.connectHandles_;
  }

  private get padding(): number {
    return this.overlay_.board.config.closePointDistanceShort;
  }

  private canRotate(): boolean {
    return this.target_ instanceof TemplatedObject;
  }

  private canResize(): boolean {
    return this.target_ instanceof TemplatedObject;
  }

  /** C++ `update(target)`: a new target rebuilds the corners. */
  update(target: EditTarget | null): void {
    const changed = target !== this.target_;
    this.target_ = target;
    if (target === null) {
      this.cornerHandles_ = [];
      this.corners_ = [];
      return;
    }
    if (changed) {
      this.cornerHandles_ = [];
      if (this.canRotate() || this.canResize()) {
        for (let i = 0; i < 4; i++) {
          let type: ShapePointType = ShapePointType.Resizer;
          if (i === 0) type = this.canRotate() ? ShapePointType.Rotater : ShapePointType.None;
          else if (!this.canResize()) type = ShapePointType.None;
          this.cornerHandles_.push({ vid: i, type, centre: new Point() });
        }
      }
    }
  }

  private angle(): number {
    return this.target_ instanceof TemplatedObject ? this.target_.rotation() : 0;
  }

  private selRect(): Rect {
    const t = this.target_;
    if (t === null) return new Rect();
    if (t instanceof MultiSelection) {
      let out: Rect | null = null;
      for (const o of t.objects) {
        const r = o instanceof TemplatedObject ? o.unrotatedRect() : o.selectionRect();
        out = out === null ? r : out.includeRect(r);
      }
      return out ?? new Rect();
    }
    return t instanceof TemplatedObject ? t.unrotatedRect() : t.selectionRect();
  }

  private strokeWidth(): number {
    const t = this.target_;
    if (t === null) return 0;
    return t instanceof MultiSelection
      ? t.drawingProfile.effectiveStrokeWidth()
      : t.getDrawingProfile().effectiveStrokeWidth();
  }

  /** C++ `doLayout` → `updateCornerPoints` + the frame, then the handles. */
  layout(): void {
    if (this.target_ === null) return;
    const cfg = this.overlay_.board.config;
    const sel = this.selRect().inflate(this.strokeWidth());
    let corners = rectPoints(sel).map((p) => this.view_.toView(p));
    let b = getPointsBound(corners);
    if (this.isResizing) {
      b = new Rect(
        b.x - this.selRectDiff_.x / 2,
        b.y - this.selRectDiff_.y / 2,
        b.width + this.selRectDiff_.x,
        b.height + this.selRectDiff_.y,
      );
    } else {
      const orig = b;
      const adj = cfg.selectRectAdjustment;
      b = minSelRect(new Rect(b.x - adj, b.y - adj, b.width + adj * 2, b.height + adj * 2), cfg.minSelectRectDimention);
      this.selRectDiff_ = new Point(b.width - orig.width, b.height - orig.height);
    }
    this.bounds_ = b;
    corners = rectPoints(b);
    const a = this.target_ instanceof TemplatedObject ? this.target_.ds.angle() : 0;
    if (a !== 0) corners = rotateAboutMid(corners, a);
    this.corners_ = corners;
    this.frame_ = getPointsBound(corners).inflate(this.padding * 2);
    for (const c of this.cornerHandles_) c.centre = corners[c.vid] ?? new Point();
    const centres = handleCentres(corners);
    const visible = this.shouldShowConnectHandles();
    for (const h of this.connectHandles_) h.place(centres[h.side] ?? new Point(), visible);
  }

  // ---- connect handles ----

  private visibility(): Visibility | null {
    const t = this.target_;
    if (t === null || this.corners_.length !== 4) return null;
    const cfg = this.overlay_.board.config;
    if (!cfg.showConnectionHandles) {
      return {
        enabledInSettings: false,
        connectable: false,
        editable: false,
        interacting: false,
        editingText: false,
        overlapsCorners: false,
      };
    }
    const connectable = !isMulti(t) && isConnectable(t);
    const editable = !this.overlay_.board.readOnly();
    const interacting = this.isMoving || this.isResizing || this.isRotating || this.isScaling || this.underVertexHandle;
    const editingText = this.overlay_.isEditingText() || (!isMulti(t) && t.isEditingText());
    const pointer = this.overlay_.env.hasTouch ? PointerType.Finger : PointerType.Mouse;
    const overlaps =
      connectable &&
      editable &&
      !interacting &&
      !editingText &&
      overlapsCorner(handleCentres(this.corners_), this.corners_, hitRadius(cfg, pointer), cornerHitRadius(cfg));
    return { enabledInSettings: true, connectable, editable, interacting, editingText, overlapsCorners: overlaps };
  }

  shouldShowConnectHandles(): boolean {
    const v = this.visibility();
    return v !== null && shouldShow(v);
  }

  canStartConnectDrag(): boolean {
    const v = this.visibility();
    return v !== null && canStartDrag(v);
  }

  // ---- drawing ----

  draw(dp: DrawingPlatform, paint: OverlayPaint): void {
    if (this.target_ === null) return;
    if (this.isMoving) {
      this.drawLocationInfo(dp, paint);
      return;
    }
    if (this.isResizing) this.drawSizeInfo(dp, paint);
    if (this.isRotating) {
      this.drawLineToRotationIndicator(dp);
      this.drawForRotation(dp, paint);
      return;
    }
    const underRotater = this.underVertexHandle && this.vertexHandleIsRotater;
    if (underRotater) this.drawLineToRotationIndicator(dp);
    if (!underRotater && this.corners_.length > 0) {
      const s = dashedStyle(paint.tokens.selectionStroke);
      dp.startDrawing(this.corners_[0] as Point, s);
      for (let i = 1; i < this.corners_.length; i++) dp.addLineTo(this.corners_[i] as Point);
      dp.closePath();
      dp.endDrawing();
    }
    if (!this.underVertexHandle) {
      for (const c of this.cornerHandles_) this.drawCorner(dp, paint, c);
      if (this.shouldShowConnectHandles())
        for (const h of this.connectHandles_) if (h.visible) h.draw(dp, paint.tokens);
    }
  }

  /** `CornerWidget`: a filled 8 × 8 square for a resizer, the rotate glyph on a disc for corner 0. */
  private drawCorner(dp: DrawingPlatform, paint: OverlayPaint, c: CornerHandle): void {
    const cfg = this.overlay_.board.config;
    const angle = this.angle();
    if (c.type === ShapePointType.Resizer) {
      const sz = cfg.resizeIndicatorSize;
      const pts = rotate(rectPoints(Rect.fromCenter(c.centre, sz, sz)), c.centre, angle);
      const s = new Style();
      s.setFillColor(paint.tokens.resizeIndicatorColor);
      s.setStrokeColor(paint.tokens.cornerColor);
      s.setStrokeWidth(1);
      dp.startDrawing(pts[0] as Point, s);
      for (let i = 1; i < pts.length; i++) dp.addLineTo(pts[i] as Point);
      dp.closePath();
      dp.endDrawing();
    } else if (c.type === ShapePointType.Rotater) {
      const size = this.padding * 2;
      const bg = new Style();
      bg.setFillColor(paint.tokens.resizeIndicatorColor);
      bg.setStrokeWidth(0);
      dp.startDrawing(c.centre, bg);
      dp.addCircle(c.centre, size / 2);
      dp.endDrawing();
      drawGlyph(dp, 'lekhapp.ui.sel_rect_rotate', Rect.fromCenter(c.centre, size, size), angle, {
        stroke: paint.tokens.cornerColor,
      });
    }
  }

  private label(dp: DrawingPlatform, paint: OverlayPaint, text: string): void {
    // C++ `TextDrawParamInternal(text, 0, Rectangle((w/2, 0), w, h))`, `WrapMode::Float`: centred
    // on the top edge of the frame.
    const f = this.frame_;
    paint.text?.draw(dp, text, Rect.fromCenter(new Point(f.x + f.width / 2, f.y), f.width, f.height), {
      color: paint.tokens.cornerColor,
    });
  }

  private drawLocationInfo(dp: DrawingPlatform, paint: OverlayPaint): void {
    const t = this.target_;
    if (!this.overlay_.board.config.showPositionWhileMoving || !(t instanceof TemplatedObject)) return;
    const sc = this.overlay_.board.document().scaling;
    const ct = t.ds.getCenter();
    this.label(dp, paint, `x=${sc.pointToUnit(ct.x).toFixed(2)}, y=${sc.pointToUnit(ct.y).toFixed(2)}`);
  }

  private drawSizeInfo(dp: DrawingPlatform, paint: OverlayPaint): void {
    const t = this.target_;
    if (!this.overlay_.board.config.showSizeWhileResizing || !(t instanceof TemplatedObject)) return;
    const sc = this.overlay_.board.document().scaling;
    this.label(
      dp,
      paint,
      `width=${sc.pointToUnit(t.ds.width()).toFixed(2)}, height=${sc.pointToUnit(t.ds.height()).toFixed(2)}`,
    );
  }

  private drawForRotation(dp: DrawingPlatform, paint: OverlayPaint): void {
    const t = this.target_;
    if (!(t instanceof TemplatedObject)) return;
    if (this.overlay_.board.config.showSizeWhileResizing) {
      this.label(dp, paint, `angle=${toDegreeReadable(t.ds.angle()).toFixed(2)}`);
    }
    const c = this.cornerHandles_[0];
    if (c !== undefined) this.drawCorner(dp, paint, c);
  }

  private drawLineToRotationIndicator(dp: DrawingPlatform): void {
    const c = this.corners_[0];
    if (c === undefined) return;
    const s = new Style();
    s.setDashArray([2, 2]);
    s.setStrokeWidth(1);
    s.setNoFill();
    const to = getPointsBound(this.corners_).center();
    dp.startDrawing(c, s);
    dp.moveTo(c);
    dp.addLineTo(to);
    dp.endDrawing();
  }

  // ---- hit testing ----

  private cornerFrame(c: CornerHandle): Rect {
    return Rect.fromCenter(c.centre, this.padding * 2, this.padding * 2);
  }

  /** C++ `contains`: inside the polygon or a handle's frame. */
  contains(pt: Point): boolean {
    if (isPointInsidePolygon(this.corners_, pt)) return true;
    for (const c of this.cornerHandles_) if (this.cornerFrame(c).contains(pt)) return true;
    const cfg = this.overlay_.board.config;
    return this.connectHandles_.some((h) => h.frameContains(cfg, pt));
  }

  /** The handle under `at`, last child first (connect handles before corners). */
  childAt(at: Point): { kind: 'connect'; handle: ConnectHandle } | { kind: 'corner'; corner: CornerHandle } | null {
    const cfg = this.overlay_.board.config;
    for (let i = this.connectHandles_.length - 1; i >= 0; i--) {
      const h = this.connectHandles_[i] as ConnectHandle;
      if (h.frameContains(cfg, at)) return { kind: 'connect', handle: h };
    }
    for (let i = this.cornerHandles_.length - 1; i >= 0; i--) {
      const c = this.cornerHandles_[i] as CornerHandle;
      if (this.cornerFrame(c).contains(at)) return { kind: 'corner', corner: c };
    }
    return null;
  }

  /**
   * C++ `getShapePointNear(at, forObj)`: the nearest corner (when `withCorners`) or interesting
   * point of the target, and its distance. A multi-selection has none.
   */
  shapePointNear(at: Point, of: LekhObject | null, withCorners: boolean): { sp: ShapePoint; dist: number } {
    let sp: ShapePoint = { point: new Point(), type: ShapePointType.None, vid: 0 };
    let dist = Number.MAX_SAFE_INTEGER;
    if (withCorners) {
      this.corners_.forEach((c, i) => {
        const d = getDistance(c, at);
        if (d < dist) {
          dist = d;
          sp = { point: c, vid: i, type: i === 0 ? ShapePointType.Rotater : ShapePointType.Resizer };
        }
      });
    }
    const target = withCorners ? this.target_ : of;
    if (target === null || isMulti(target)) return { sp, dist };
    target.getInterestingPoints().forEach((ip, i) => {
      const v = this.view_.toView(ip.point);
      const d = getDistance(v, at);
      if (d < dist && ip.type !== PointType.Center && ip.type !== PointType.Focus) {
        dist = d;
        sp = { point: v, vid: i, type: shapePointTypeOf(ip.type) };
      }
    });
    return { sp, dist };
  }

  // ---- events ----

  /** C++ `SelectionRectangleWidget::onPan` (only called for a Start inside the frame). */
  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    const t = this.target_;
    if (t === null) return false;
    if (this.overlay_.modes.get() === InputMode.Scroll) return false;
    const child = this.childAt(at);
    if (child !== null && this.childPan(child, at, ev, m)) return true;
    if (m !== Movement.Start || !ev.likeMouseLeft()) return false;
    const board = this.overlay_.board;
    const close = board.config.closePointDistanceShort;
    if (ev.mods.alt) {
      this.overlay_.duplicate(t, false);
    } else {
      const { sp, dist } = this.shapePointNear(at, isMulti(t) ? null : t, false);
      if ((sp.type === ShapePointType.Attr || sp.type === ShapePointType.ControlAttr) && dist < close && !isMulti(t)) {
        const d = new VertexDragger(this.overlay_, this.view_, t, sp.vid, sp.type);
        d.onPan(at, ev, m);
        this.overlay_.setDragHandler(d);
        return true;
      }
      const mti = board.page().objectStore.hit.movableTextNear(this.view_.toDoc(at));
      if (mti !== null) {
        const d = new TextDragger(this.overlay_, this.view_, mti);
        d.onPan(at, ev, m);
        this.overlay_.setDragHandler(d);
        return true;
      }
    }
    if (templatedLike(this.target_)) {
      const d = new SelectionDragger(this);
      d.onPan(at, ev, m);
      this.overlay_.setDragHandler(d);
      return true;
    }
    this.overlay_.setDragHandler(new NoOpDragger());
    return true;
  }

  private childPan(
    child: NonNullable<ReturnType<SelectionRectangle['childAt']>>,
    at: Point,
    ev: PointerEvent,
    m: Movement,
  ): boolean {
    if (m !== Movement.Start || !ev.likeMouseLeft()) return false;
    const board = this.overlay_.board;
    if (child.kind === 'connect') {
      const h = child.handle;
      if (!h.visible || !h.isWithinHitArea(board.config, at, ev)) return false;
      // A handle still placed on a board that turned read-only: consumed, starts nothing.
      if (board.readOnly()) return true;
      if (!this.shouldShowConnectHandles()) return false;
      const t = this.target_;
      if (t === null || isMulti(t)) return false;
      if (!this.canStartConnectDrag()) return true;
      const d = new ConnectDragger(this.overlay_, this.view_, t, h.side);
      this.overlay_.setDragHandler(d);
      d.onPan(at, ev, m);
      return true;
    }
    const c = child.corner;
    if (c.type === ShapePointType.Resizer) {
      const d = new ResizeDragger(this, c.vid);
      d.onPan(at, ev, m);
      this.overlay_.setDragHandler(d);
      return true;
    }
    if (c.type === ShapePointType.Rotater) {
      const d = new RotateDragger(this.overlay_, this.view_, this);
      d.onPan(at, ev, m);
      this.overlay_.setDragHandler(d);
      return true;
    }
    return false;
  }

  /** C++ `SelectionRectangleWidget::onClick` (inside the frame). */
  onClick(at: Point, ev: PointerEvent): boolean {
    const close = this.overlay_.board.config.closePointDistanceShort;
    const { sp, dist } = this.shapePointNear(at, null, true);
    const t = this.target_;
    if (
      ev.likeMouseLeft() &&
      sp.type !== ShapePointType.None &&
      sp.type !== ShapePointType.Resizer &&
      sp.type !== ShapePointType.Rotater &&
      dist < close &&
      t !== null &&
      !isMulti(t)
    ) {
      this.overlay_.deselect();
      this.overlay_.updateVertexHandle(sp.type, sp.vid, t);
      return true;
    }
    const child = this.childAt(at);
    if (child !== null) {
      if (child.kind === 'connect') {
        if (this.shouldShowConnectHandles() && child.handle.isWithinHitArea(this.overlay_.board.config, at, ev))
          return true;
      } else if (child.corner.type !== ShapePointType.None && ev.likeMouseLeft()) {
        const type = child.corner.type === ShapePointType.Rotater ? ShapePointType.Rotater : ShapePointType.Resizer;
        this.overlay_.updateVertexHandle(type, child.corner.vid, 'rect');
        return true;
      }
    }
    if (ev.isMouseRight() || ev.mods.ctrl || ev.mods.cmd) return false;
    this.overlay_.deselect();
    return true;
  }

  /** C++ `handleOutsideEvent`: a press outside the rectangle. */
  handleOutsideEvent(at: Point, ev: PointerEvent, name: EventName): boolean {
    const t = this.target_;
    if (t === null) return false;
    if (!ev.likeMouseLeft()) {
      this.overlay_.deselect();
      return false;
    }
    if (name === EventName.Click && (ev.mods.cmd || ev.mods.ctrl)) return false;
    const { sp, dist } = this.shapePointNear(at, isMulti(t) ? null : t, false);
    const close = this.overlay_.board.config.closePointDistanceShort;
    if (name === EventName.Pan && sp.type === ShapePointType.Attr && dist < close && !isMulti(t)) {
      const d = new VertexDragger(this.overlay_, this.view_, t, sp.vid, sp.type);
      d.onPan(at, ev, Movement.Start);
      this.overlay_.setDragHandler(d);
      return true;
    }
    this.overlay_.deselect();
    if (name !== EventName.Click) return false;
    if (sp.type !== ShapePointType.None && dist < close && !isMulti(t))
      this.overlay_.updateVertexHandle(sp.type, sp.vid, t);
    return false;
  }

  // ---- live changes ----

  /** C++ `move(dx, dy, movement)`: view deltas, translated live, one step at the End. */
  move(dx: number, dy: number, m: Movement): void {
    const t = this.target_;
    if (t === null) return;
    if (m === Movement.Start) this.isMoving = true;
    if (m === Movement.End) this.isMoving = false;
    const board = this.overlay_.board;
    const zm = board.view().zoom;
    const res = { gone: false };
    board.edit((ctx) => {
      const mctx = dragContext(board, ctx.doc);
      const multi = isMulti(t) ? t : null;
      if (m === Movement.Start) {
        if (multi !== null) {
          const movable = multi.movableObjects();
          this.moveGroup_ = movable.length > 1 ? (mctx.makeGroup(movable) as GroupObject) : null;
          this.moveGroup_?.startModification(mctx);
        } else {
          (t as LekhObject).startModification(mctx);
        }
      }
      const mover: LekhObject | null = multi !== null ? this.moveGroup_ : (t as LekhObject);
      if (mover === null) return;
      mover.translate(dx / zm, dy / zm);
      if (m !== Movement.End) return;
      const fin = mover.finishTranslating();
      this.moveGroup_ = null;
      if (fin.x === 0 && fin.y === 0) return;
      const store = ctx.page.objectStore;
      if (multi !== null) {
        const objs = multi.movableObjects().filter((o) => store.contains(o));
        if (objs.length > 0)
          ctx.editor.tx.record(new TranslateObjectAction(ctx.editor.env, ctx.doc, objs, fin.x, fin.y));
      } else if (store.contains(t as LekhObject)) {
        const objs = t instanceof TemplatedObject ? t.translatedObjects() : [t as LekhObject];
        ctx.editor.tx.record(new TranslateObjectAction(ctx.editor.env, ctx.doc, objs, fin.x, fin.y));
      } else {
        res.gone = true;
      }
    });
    if (res.gone) this.overlay_.select(null);
    else this.overlay_.select(t);
    board.requestPaint('drawing');
  }

  /** C++ `moveResizer`: resizes the target from corner `vid` (view point `at`). */
  moveResizer(at: Point, m: Movement, vid: number): Point {
    const t = this.target_;
    if (!(t instanceof TemplatedObject)) return at;
    const board = this.overlay_.board;
    if (m === Movement.Start) {
      this.dragStart_ = this.corners_[vid] ?? at;
      this.dragOpposite_ = this.corners_[(vid + 2) % 4] ?? at;
      this.origBounds_ = t.ds.rect();
      this.isResizing = true;
      board.edit((ctx) => {
        t.startModification(dragContext(board, ctx.doc));
      });
    }
    const angle = this.angle();
    const pts1 = rotate([this.dragOpposite_, this.dragStart_], new Point(), -angle);
    const pts2Raw = [this.dragOpposite_, at];
    const pts2 = rotate(pts2Raw, new Point(), -angle);
    const a1 = pts1[0] as Point;
    const b1 = pts1[1] as Point;
    const a2 = pts2[0] as Point;
    const b2 = pts2[1] as Point;
    const zm = board.view().zoom;
    let dw = (Math.abs(a2.x - b2.x) - Math.abs(a1.x - b1.x)) / zm;
    let dh = (Math.abs(a2.y - b2.y) - Math.abs(a1.y - b1.y)) / zm;
    let doResize = true;
    const ob = this.origBounds_;
    if ((a1.x - b1.x) * (a2.x - b2.x) < 0 || ob.width + dw < 0) {
      dw = 0;
      doResize = false;
    }
    if ((a1.y - b1.y) * (a2.y - b2.y) < 0 || ob.height + dh < 0) {
      dh = 0;
      doResize = false;
    }
    if (doResize) {
      const cfg = board.config;
      const doc = board.document();
      let rect = Rect.fromCenter(this.view_.toDoc(getMidPoint(pts2Raw)), ob.width + dw, ob.height + dh);
      if (cfg.snapToGrid) {
        if (Math.abs(normalizeAngleIn2PI(angle)) > 0.0001) {
          const step = doc.snapStep();
          const nw = snapNumber(ob.width + dw, step, true);
          const nh = snapNumber(ob.height + dh, step, true);
          dw = nw - ob.width;
          dh = nh - ob.height;
          const ang = vid === 1 || vid === 3 ? -angle : angle;
          let ex = (Math.cos(ang) * dw) / 2 + (Math.sin(-ang) * dh) / 2;
          let ey = (Math.sin(ang) * dw) / 2 + (Math.cos(ang) * dh) / 2;
          if (vid === 0) {
            ex = -ex;
            ey = -ey;
          } else if (vid === 1) {
            ey = -ey;
          } else if (vid === 3) {
            ex = -ex;
          }
          const c = ob.center();
          rect = Rect.fromCenter(new Point(c.x + ex, c.y + ey), ob.width + dw, ob.height + dh);
        } else {
          // C++ snaps the dragged corner to the alignment points of other shapes and the grid;
          // here to the resize snap step of the grid.
          const points = rectPoints(rect);
          const step = doc.resizeSnapStep();
          const p = points[vid] as Point;
          const np = new Point(snapNumber(p.x, step, true), snapNumber(p.y, step, true));
          rect = getPointsBound([np, points[(vid + 2) % 4] as Point]);
        }
      }
      const r = rect;
      board.edit(() => {
        t.alignmentxDraw = [];
        t.alignmentyDraw = [];
        t.setRect(r);
      });
    }
    if (m === Movement.End) {
      this.isResizing = false;
      this.handleResizeEnd(t);
    }
    this.layout();
    this.overlay_.invalidate();
    board.requestPaint('drawing');
    return this.corners_[vid] ?? at;
  }

  private handleResizeEnd(t: TemplatedObject): void {
    const board = this.overlay_.board;
    if (!board.page().objectStore.contains(t)) {
      this.overlay_.select(null);
      return;
    }
    board.edit((ctx) => {
      const ds = t.ds;
      const old = Rect.fromCenter(new Point(ds.savedCx(), ds.savedCy()), ds.savedWidth(), ds.savedHeight());
      ctx.editor.tx.record(new ExpandAction(ctx.editor.env, ctx.doc, t, { old, cur: ds.rect() }));
    });
    this.overlay_.refreshSelection();
  }

  /** C++ `moveRotater`. */
  moveRotater(_at: Point, m: Movement): void {
    if (m === Movement.Start) this.isRotating = true;
    this.layout();
    if (m === Movement.End) {
      this.isRotating = false;
      this.overlay_.refreshSelection();
    }
    this.overlay_.invalidate();
  }

  setIsScaling(v: boolean): void {
    this.isScaling = v;
  }
}

export function rectPoints(r: Rect): Point[] {
  return [
    new Point(r.x, r.y),
    new Point(r.x + r.width, r.y),
    new Point(r.x + r.width, r.y + r.height),
    new Point(r.x, r.y + r.height),
  ];
}

/** C++ `checkForMinSelRect` (integer arithmetic as C++). */
function minSelRect(r: Rect, min: number): Rect {
  let { x, y, width, height } = r;
  if (width < min) {
    let diff = Math.trunc(min - width);
    diff = Math.trunc((diff * 2 + 1) / 2);
    x -= Math.trunc(diff / 2);
    width += diff;
  }
  if (height < min) {
    let diff = Math.trunc(min - height);
    diff = Math.trunc((diff * 2 + 1) / 2);
    y -= Math.trunc(diff / 2);
    height += diff;
  }
  return new Rect(x, y, width, height);
}

function dashedStyle(color: Color): Style {
  const s = new Style();
  s.setNoFill();
  s.setStrokeColor(color);
  s.setStrokeWidth(1);
  s.setDashArray([2, 2]);
  return s;
}

function shapePointTypeOf(t: PointType): ShapePointType {
  switch (t) {
    case PointType.Vertex:
      return ShapePointType.Vertex;
    case PointType.Control:
      return ShapePointType.Control;
    case PointType.Attr:
      return ShapePointType.Attr;
    case PointType.ControlAttr:
      return ShapePointType.ControlAttr;
    default:
      return ShapePointType.None;
  }
}
