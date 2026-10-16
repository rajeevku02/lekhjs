// The Middle layer (port of C++ `MiddleWidget` + `SelectionWidget`, `L/object/widget/`; spec 02
// `OverlayLayer`, `SelectionOverlay`, `SelectionAnchor`, `ScrollIndicator`,
// `AlignmentGuidePainter`). It owns the selection rectangle with its handles, the vertex handle,
// the transient previews (ink, eraser, laser, rubber band, connect preview, zoom badge) and the
// scroll indicator, and draws them all on the Middle canvas through a `DrawingPlatform` in view
// coordinates (spec 05 §4.4, R4: no DOM element per handle). As a router layer it takes presses on
// the handles first and runs the selection's and vertex handle's outside-tap filters.
//
// The selection itself is the session's (`BoardSession.selection`, ids): `select()` sets it, and
// `syncSelection()` follows it when undo, a remote delete or a command changes it.
import { MultiSelection, isMulti, selectionOf, type EditTarget } from '../edit';
import { Point, PointType, Rect } from '../geometry';
import { TemplatedObject, type LekhObject } from '../model';
import type { DrawingPlatform } from '../render';
import { Color, Style } from '../style';
import { objectsOf, type InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import type { CursorState } from './cursor';
import { cursorForMode, type CursorKind } from './cursor';
import type { DragHandler } from './drag-handler';
import { ShapeScaleDragger } from './draggers/selection-draggers';
import type { HostEnvironment } from './env';
import { EventName, Movement, check, type EventCheck } from './gesture-listener';
import { InputMode, type InputModeState } from './input-mode';
import type { PointerEvent } from './input-event';
import { OVERLAY_VALUES, overlayTokens, type OverlayTheme } from './overlay-tokens';
import type { ClickTarget, RouterLayer } from './router-layer';
import { SelectionRectangle } from './selection/selection-rectangle';
import {
  ShapePointType,
  type OverlayHost,
  type OverlayPaint,
  type OverlayTextPainter,
  type SelectionRectHost,
  type Transient,
} from './selection/types';
import { VertexHandles } from './selection/vertex-handles';

/** Where finished strokes go (`RecognitionController`). */
export interface StrokeSink {
  /** View points of a finished stroke on the canvas. */
  addStroke(points: readonly Point[]): void;
}

/** What the overlay needs from its owner (`BoardView`). */
export interface OverlayOptions {
  readonly board: InteractionBoard;
  readonly env: HostEnvironment;
  readonly modes: InputModeState;
  readonly view: CanvasView;
  readonly cursor: CursorState;
  readonly setDragHandler: (d: DragHandler) => void;
  readonly duplicate: (t: EditTarget, displace: boolean) => void;
  readonly isEditingText: () => boolean;
  readonly strokes?: StrokeSink;
  readonly text?: OverlayTextPainter;
  readonly theme?: () => OverlayTheme;
  /** Called after the selection changed (the React menu anchor follows). */
  readonly onSelectionLayout?: () => void;
}

/** C++ `Scroll::getScrollPos`. */
export function scrollPos(viewport: number, content: number, at: number): { pos: number; size: number } {
  const v1 = at < 0 ? -at : 0;
  const end = at + content;
  const v3 = end > viewport ? end - viewport : 0;
  const total = v1 + viewport + v3;
  if (total < 0.1 || total < viewport + 0.1) return { pos: 0, size: 0 };
  let size = (viewport / total) * viewport;
  if (size < 12) size = 12;
  const pos = (viewport - size) * (v1 / (v1 + v3));
  return { pos, size };
}

export class OverlayLayer implements OverlayHost, RouterLayer {
  readonly board: InteractionBoard;
  readonly env: HostEnvironment;
  readonly modes: InputModeState;
  readonly rect: SelectionRectangle;
  readonly vertex: VertexHandles;
  private readonly opts_: OverlayOptions;
  private readonly view_: CanvasView;
  private readonly transients_: Transient[] = [];
  private pendingRemoval_: { stroke: Transient; points: readonly Point[] }[] = [];
  private drawing_ = false;
  private nextRemovalTime_ = 0;
  private target_: EditTarget | null = null;
  private highlighted_: LekhObject[] = [];
  private showingIndicator_ = false;
  private lastScrollTime_ = 0;
  private indicatorTimer_: number | null = null;
  private removalTimer_: number | null = null;

  constructor(opts: OverlayOptions) {
    this.opts_ = opts;
    this.board = opts.board;
    this.env = opts.env;
    this.modes = opts.modes;
    this.view_ = opts.view;
    this.rect = new SelectionRectangle(this, opts.view);
    this.vertex = new VertexHandles(this, opts.view, this.rect);
  }

  dispose(): void {
    if (this.indicatorTimer_ !== null) this.board.timers.clearTimer(this.indicatorTimer_);
    if (this.removalTimer_ !== null) this.board.timers.clearTimer(this.removalTimer_);
    this.indicatorTimer_ = null;
    this.removalTimer_ = null;
    this.transients_.length = 0;
    this.pendingRemoval_ = [];
  }

  // ---- OverlayHost ----

  setDragHandler(d: DragHandler): void {
    this.opts_.setDragHandler(d);
  }

  setCursor(c: CursorKind): void {
    this.opts_.cursor.set(c);
  }

  duplicate(t: EditTarget, displace: boolean): void {
    this.opts_.duplicate(t, displace);
  }

  isEditingText(): boolean {
    return this.opts_.isEditingText();
  }

  selectionTarget(): EditTarget | null {
    return this.target_;
  }

  selectionRect(): SelectionRectHost {
    return this.rect;
  }

  isSelectionActive(): boolean {
    return this.target_ !== null;
  }

  invalidate(): void {
    this.board.requestPaint('middle');
  }

  /**
   * C++ `updateSelectionRectangle(toSelect, multiSelectAction)`: with `multiSelectAction` (Cmd/Ctrl
   * click) and an active selection, `toSelect` is toggled in or out of a multi-selection.
   */
  select(toSelect: EditTarget | null, multiSelectAction = false): void {
    if (!multiSelectAction || this.target_ === null || toSelect === null || isMulti(toSelect)) {
      this.setTarget(toSelect);
      return;
    }
    const cur = this.target_;
    const objs: LekhObject[] = isMulti(cur) ? [...cur.objects] : [cur];
    const i = objs.indexOf(toSelect);
    if (i >= 0) objs.splice(i, 1);
    else objs.push(toSelect);
    if (objs.length === 0) {
      this.deselect();
      return;
    }
    const movable = new MultiSelection(objs).movableObjects();
    if (movable.length > 1) this.setTarget(new MultiSelection(objs));
    else if (movable.length === 1) this.setTarget(movable[0] as TemplatedObject);
    else this.setTarget(toSelect);
  }

  private setTarget(t: EditTarget | null): void {
    const prevIds = this.idsOf(this.target_);
    this.target_ = t;
    this.rect.update(t);
    this.setHighlight(t);
    this.layout();
    const ids = this.idsOf(t);
    if (!sameIds(prevIds, ids) || !sameIds(ids, this.board.selection())) this.board.select(ids);
    this.invalidate();
    this.opts_.onSelectionLayout?.();
  }

  /** `MultiSelectedObjects` marks its members selected (they paint a highlight). */
  private setHighlight(t: EditTarget | null): void {
    const next = isMulti(t) && t.movableObjects().length > 1 ? [...t.objects] : [];
    if (next.length === 0 && this.highlighted_.length === 0) return;
    for (const o of this.highlighted_) o.getDrawingProfile().setIsSelected(false);
    for (const o of next) o.getDrawingProfile().setIsSelected(true);
    this.highlighted_ = next;
    this.board.requestPaint('drawing');
  }

  private idsOf(t: EditTarget | null): string[] {
    if (t === null) return [];
    return isMulti(t) ? t.objects.map((o) => o.id) : [t.id];
  }

  /** Follows the session's selection (undo, remote deletes, commands). */
  syncSelection(ids: readonly string[]): void {
    if (sameIds(ids, this.idsOf(this.target_))) {
      // C++ `onObjectsRemovedByUpdate`: the target left the page.
      if (this.target_ !== null && !this.onPage(this.target_)) this.deselect();
      else this.refreshSelection();
      return;
    }
    const objs = objectsOf(this.board, ids);
    const t: EditTarget | null =
      objs.length === 0 ? null : objs.length === 1 ? (objs[0] as LekhObject) : selectionOf(objs);
    this.target_ = t;
    this.rect.update(t);
    this.setHighlight(t);
    if (t === null && this.vertex.isActive() && !this.onPage(this.vertex.target()))
      this.updateVertexHandle(ShapePointType.Vertex, 0, null);
    this.layout();
    this.invalidate();
    this.opts_.onSelectionLayout?.();
  }

  private onPage(t: EditTarget | null): boolean {
    if (t === null) return false;
    const store = this.board.page().objectStore;
    return isMulti(t) ? t.objects.every((o) => store.contains(o)) : store.contains(t);
  }

  refreshSelection(): void {
    this.layout();
    this.invalidate();
    this.opts_.onSelectionLayout?.();
  }

  deselect(): void {
    if (this.target_ !== null) this.setTarget(null);
    if (this.vertex.isActive()) this.updateVertexHandle(ShapePointType.Vertex, 0, null);
  }

  updateVertexHandle(type: ShapePointType, vid: number, target: LekhObject | 'rect' | null): void {
    this.vertex.updateTarget(type, vid, target);
    this.rect.underVertexHandle = target === 'rect';
    this.rect.vertexHandleIsRotater = target === 'rect' && type === ShapePointType.Rotater;
    this.layout();
    this.invalidate();
    this.opts_.onSelectionLayout?.();
  }

  moveVertexHandle(at: Point, m: Movement): void {
    this.vertex.update(at, m);
    this.invalidate();
  }

  addTransient(t: Transient): void {
    this.transients_.push(t);
    this.invalidate();
  }

  removeTransient(t: Transient): void {
    const i = this.transients_.indexOf(t);
    if (i >= 0) this.transients_.splice(i, 1);
    this.invalidate();
  }

  transients(): readonly Transient[] {
    return this.transients_;
  }

  drawingStarted(): void {
    this.drawing_ = true;
  }

  /** C++ `onTmpDrawingEnd`: in Draw mode the ink stays 500 ms, so quick strokes batch. */
  onTmpDrawingEnd(stroke: Transient, points: readonly Point[]): void {
    this.drawing_ = false;
    this.pendingRemoval_.push({ stroke, points });
    if (this.modes.get() === InputMode.Draw) this.setTimerToRemoveTransient();
    else this.removePendingTransient();
  }

  private setTimerToRemoveTransient(): void {
    const after = 500;
    this.nextRemovalTime_ = this.board.now() + after;
    if (this.removalTimer_ !== null) this.board.timers.clearTimer(this.removalTimer_);
    this.removalTimer_ = this.board.timers.setTimer(after + 5, () => {
      this.removalTimer_ = null;
      if (this.board.now() < this.nextRemovalTime_) return;
      if (this.drawing_) this.setTimerToRemoveTransient();
      else this.removePendingTransient();
    });
  }

  private removePendingTransient(): void {
    const pending = this.pendingRemoval_;
    this.pendingRemoval_ = [];
    for (const p of pending) {
      this.removeTransient(p.stroke);
      if (p.points.length > 0) this.addTmpDrawing(p.points);
    }
    this.board.requestPaint('drawing');
    this.invalidate();
  }

  beforeCanvasScaleOrScroll(): void {
    if (this.pendingRemoval_.length > 0) this.removePendingTransient();
  }

  /** C++ `addTmpDrawing`: on the canvas, not a dot in SmartDraw, then to the recogniser gate. */
  private addTmpDrawing(pts: readonly Point[]): void {
    const first = pts[0];
    if (first === undefined) return;
    let r = new Rect(first.x, first.y, 0, 0);
    for (const p of pts) r = r.include(p);
    if (!this.view_.isPointOnCanvas(r.center())) {
      this.board.ui()?.toast({ message: 'Outside of canvas', kind: 'info' });
      return;
    }
    if (this.modes.get() === InputMode.SmartDraw && r.width < 6 && r.height < 6) return;
    this.opts_.strokes?.addStroke(pts);
  }

  flashScrollIndicator(): void {
    this.lastScrollTime_ = this.board.now();
    this.showHideScrollIndicator();
  }

  private showHideScrollIndicator(): void {
    const dur = OVERLAY_VALUES.scrollIndicatorShowMs;
    if (this.board.now() - this.lastScrollTime_ >= dur) {
      this.showingIndicator_ = false;
      this.invalidate();
      return;
    }
    if (this.showingIndicator_) return;
    this.invalidate();
    this.showingIndicator_ = true;
    this.indicatorTimer_ = this.board.timers.setTimer(dur, () => {
      this.indicatorTimer_ = null;
      this.showingIndicator_ = false;
      this.showHideScrollIndicator();
      this.invalidate();
    });
  }

  get showingScrollIndicator(): boolean {
    return this.showingIndicator_;
  }

  /** The anchor of the React selection menu, view px (spec 02 `SelectionAnchor`). */
  anchorRect(): Rect | null {
    if (this.target_ === null) return null;
    return this.rect.bounds();
  }

  // ---- layout and drawing ----

  layout(): void {
    if (this.target_ !== null) this.rect.layout();
    if (this.vertex.isActive()) this.vertex.layout();
  }

  private paint(): OverlayPaint {
    return { tokens: overlayTokens(this.opts_.theme?.() ?? 'light'), text: this.opts_.text ?? null };
  }

  /** Draws the whole Middle layer (C++ `MiddleWidget::draw` + `LekhCore::draw`'s overlay half). */
  draw(dp: DrawingPlatform): void {
    const paint = this.paint();
    this.layout();
    this.drawSelectionExtras(dp);
    for (const t of this.transients_) t.draw(dp, paint);
    this.drawScrollIndicator(dp, paint);
    if (this.target_ !== null && !this.rect.isScaling) this.rect.draw(dp, paint);
    if (this.vertex.isActive()) this.vertex.draw(dp, paint);
  }

  /**
   * C++ `LekhCore::draw`: the selected shape's vertices, or its alignment guides while it moves,
   * resizes or rotates (drawn there on the Drawing canvas in document units; here in view units
   * scaled by the zoom, which looks the same).
   */
  private drawSelectionExtras(dp: DrawingPlatform): void {
    const zoom = this.board.view().zoom;
    const vt = this.vertex.isActive() ? this.vertex.target() : null;
    const t = this.target_;
    const interacting = this.rect.isMoving || this.rect.isResizing || this.rect.isRotating;
    const drawGuides = (o: TemplatedObject): void => {
      const s = new Style();
      s.setStrokeWidth(1);
      s.setNoFill();
      s.setDashArray([4, 4]);
      for (const [a, b] of [...o.alignmentxDraw, ...o.alignmentyDraw]) {
        dp.startDrawing(this.view_.toView(a), s);
        dp.addLineTo(this.view_.toView(b));
        dp.endDrawing();
      }
    };
    if (t !== null && !isMulti(t)) {
      if (interacting) {
        if (t instanceof TemplatedObject) drawGuides(t);
      } else if (!t.isEditingText()) {
        this.drawVertices(dp, t, zoom);
      }
    }
    if (vt !== null) this.drawVertices(dp, vt, zoom);
  }

  private drawVertices(dp: DrawingPlatform, o: LekhObject, zoom: number): void {
    const cfg = this.board.config;
    const ctrl = { r: 0, g: 140, b: 230 };
    for (const ip of o.getInterestingPoints()) {
      const pt = this.view_.toView(ip.point);
      const s = new Style();
      s.setStrokeWidth(zoom);
      if (ip.type === PointType.Attr || ip.type === PointType.ControlAttr) {
        const sz = cfg.resizeIndicatorSize * zoom;
        s.setFillColor(
          ip.type === PointType.Attr ? overlayTokens('light').resizeIndicatorColor : rgb(ctrl.r, ctrl.g, ctrl.b),
        );
        const r = Rect.fromCenter(pt, sz, sz);
        dp.startDrawing(new Point(r.x, r.y), s);
        dp.addLineTo(new Point(r.x + r.width, r.y));
        dp.addLineTo(new Point(r.x + r.width, r.y + r.height));
        dp.addLineTo(new Point(r.x, r.y + r.height));
        dp.closePath();
        dp.endDrawing();
        continue;
      }
      let radius = cfg.vertexDrawingRadius;
      if (ip.type === PointType.Center || (ip.type === PointType.Control && this.rect.isMoving)) radius = 1;
      else if (ip.type === PointType.Control) radius = cfg.vertexDrawingRadiusBig;
      if (ip.type === PointType.Control) {
        s.setFillColor(rgb(ctrl.r, ctrl.g, ctrl.b));
        s.setStrokeColor(rgb(ctrl.r, ctrl.g, ctrl.b));
      } else {
        s.setFillColor(rgb(0, 0, 0));
      }
      dp.startDrawing(pt, s);
      dp.addCircle(pt, radius * zoom);
      dp.endDrawing();
    }
  }

  /** C++ `drawScrollIndicator` with `CanvasWidget::scrollIndicatorPos`. */
  private drawScrollIndicator(dp: DrawingPlatform, paint: OverlayPaint): void {
    if (!this.showingIndicator_) return;
    const v = this.board.view();
    let x: { pos: number; size: number };
    let y: { pos: number; size: number };
    if (this.view_.isInfinite()) {
      const b = this.board.page().objectStore.hit.boundsOfAll();
      const p1 = this.view_.toView(b.bottomLeft());
      const p2 = this.view_.toView(b.topRight());
      const p3 = this.view_.toView(b.bottomRight());
      x = scrollPos(v.canvasW, p3.x - p1.x, p1.x);
      y = scrollPos(v.canvasH, p3.y - p2.y, p2.y);
    } else {
      const c = this.view_.canvasRect();
      x = scrollPos(v.canvasW, c.width, c.x);
      y = scrollPos(v.canvasH, c.height, c.y);
    }
    if (x.pos === 0 && x.size === 0) x = { pos: 0, size: v.canvasW };
    if (y.pos === 0 && y.size === 0) y = { pos: 0, size: v.canvasH };
    const small = this.env.isSmallScreen;
    const gap = small ? OVERLAY_VALUES.scrollIndicatorGap.small : OVERLAY_VALUES.scrollIndicatorGap.big;
    const s = new Style();
    s.setStrokeWidth(small ? OVERLAY_VALUES.scrollIndicatorWidth.small : OVERLAY_VALUES.scrollIndicatorWidth.big);
    s.setStrokeColor(paint.tokens.scrollIndicatorColor);
    s.setNoFill();
    const bottom = v.canvasH - gap;
    const right = v.canvasW - gap;
    dp.startDrawing(new Point(x.pos, bottom), s);
    dp.addLineTo(new Point(x.pos + x.size, bottom));
    dp.endDrawing();
    dp.startDrawing(new Point(right, y.pos), s);
    dp.addLineTo(new Point(right, y.pos + y.size));
    dp.endDrawing();
  }

  // ---- RouterLayer (C++ HandlerWithFilter(MiddleWidget)) ----

  /** The selection's outside-tap filter (C++ `SelectionWidget::initialize`). */
  private selectionFilter(at: Point, ev: PointerEvent, name: EventName): boolean | null {
    const mode = this.modes.get();
    const outside =
      this.target_ === null || mode === InputMode.Draw || mode === InputMode.Erase
        ? true
        : this.rect.underVertexHandle
          ? false
          : !this.rect.contains(at);
    if (!outside) return null;
    if (mode === InputMode.Scroll || mode === InputMode.Draw || mode === InputMode.Erase) {
      this.deselect();
      return false;
    }
    return this.rect.handleOutsideEvent(at, ev, name);
  }

  /** The filters, last added first: the vertex handle's, then the selection's. */
  private runFilters(at: Point, ev: PointerEvent, name: EventName, m: Movement | null): boolean {
    // `OutsideClickHandler`: a pan or long press only at its Start; a pan with one pointer.
    if (name === EventName.Pan && (m !== Movement.Start || ev.points.length > 1)) return false;
    if (name === EventName.LongPress && m !== Movement.Start) return false;
    if (name === EventName.Scale || name === EventName.Rotate) return false;
    if (this.vertex.isOutside(at) && this.vertex.handleOutsideEvent(at, ev, name)) return true;
    return this.selectionFilter(at, ev, name) === true;
  }

  /** The child under `at`, vertex handle first (it was added last). */
  private childAt(at: Point): 'vertex' | 'rect' | null {
    if (this.vertex.isActive() && this.vertex.frame().contains(at)) return 'vertex';
    if (this.target_ !== null && this.rect.frame().contains(at)) return 'rect';
    return null;
  }

  canDoAt(): EventCheck {
    return check(false, false);
  }

  findGeneric(at: Point): ClickTarget | null {
    const c = this.childAt(at);
    if (c === 'vertex') {
      return { contains: (p) => this.vertex.frame().contains(p), click: (p, e) => this.vertex.onClick(p, e) };
    }
    if (c === 'rect')
      return { contains: (p) => this.rect.frame().contains(p), click: (p, e) => this.rect.onClick(p, e) };
    return null;
  }

  isDrawingSurfaceAt(): boolean {
    return false;
  }

  onDown(): boolean {
    return false;
  }

  onClick(at: Point, ev: PointerEvent): boolean {
    if (this.runFilters(at, ev, EventName.Click, null)) return true;
    const c = this.childAt(at);
    if (c === 'vertex') return this.vertex.onClick(at, ev);
    if (c === 'rect') return this.rect.onClick(at, ev);
    return false;
  }

  onDoubleClick(at: Point, ev: PointerEvent): boolean {
    return this.runFilters(at, ev, EventName.DoubleClick, null);
  }

  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (this.runFilters(at, ev, EventName.Pan, m)) return true;
    if (m !== Movement.Start) return false;
    const c = this.childAt(at);
    if (c === 'vertex') return this.vertex.onPan(at, ev, m);
    if (c === 'rect') return this.rect.onPan(at, ev, m);
    return false;
  }

  /** C++ `MiddleWidget::onScale`: resize by pinch when the setting is on and a shape is selected. */
  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): boolean {
    const t = this.target_;
    if (
      m === Movement.Start &&
      this.board.config.resizeShapeByZoomGesture &&
      t !== null &&
      !isMulti(t) &&
      !this.rect.underVertexHandle
    ) {
      const d = new ShapeScaleDragger(this, t);
      this.setDragHandler(d);
      d.onScale(at, ev, value, m);
      return true;
    }
    return false;
  }

  onRotate(): boolean {
    return false;
  }

  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean {
    return this.runFilters(at, ev, EventName.LongPress, m);
  }

  onScroll(): boolean {
    return false;
  }

  onContextMenu(): boolean {
    return false;
  }

  /** C++ `MiddleWidget::onPointerMove` (the hover handler): the cursor of the mode. */
  onHover(m: Movement): void {
    if (m === Movement.End) this.setCursor('default');
    else this.setCursor(cursorForMode(this.modes.get()));
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function rgb(r: number, g: number, b: number): Color {
  return new Color(r, g, b);
}
