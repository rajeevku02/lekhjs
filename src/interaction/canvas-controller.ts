// The drawing surface's behaviour per input mode (port of the input half of C++ `CanvasWidget`,
// `L/object/widget/CanvasWidget.cpp`: `canDoAt`, `onClick`, `onDoubleClick`, `onPan` (the mode
// table, `:179-257`), `onScale`, `onLongPress`, `editTextAt`, `onScroll`, `onRotate`,
// `showContextMenuAt`, `dropLibraryShapeAt`; spec 05 §4.3, spec 02 `CanvasController`).
//
// The branch order of `onPan` is C++'s: read-only → Text → Scroll → Draw/SmartDraw (eraser tip →
// erase; `onlyDrawWithPencil` and not a pen → scroll; Cmd/Ctrl mouse → scroll; else draw) →
// Select (eraser; pen draws in selection mode; Cmd/Ctrl mouse → scroll; a movable label → move
// it; a shape → select it (Alt duplicates) and move; else the rubber band) → Erase → Laser →
// anything else scrolls. `lastPanBranch` names the branch taken (the mode-table test checks every
// one). The controller never changes the document itself: every change is a `board.edit`.
import type { EditTarget } from '../edit';
import { AddObjectAction, RotateAction } from '../edit';
import type { Point } from '../geometry';
import { Rect } from '../geometry';
import { TemplatedObject, type LekhObject } from '../model';
import { PencilBehavior } from '../base';
import { dragContext, type InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import { ContextMenuModel } from './context-menu';
import { BaseDragger, NoOpDragger, type DragHandler } from './drag-handler';
import { CanvasScaleScrollDragger, DrawingDragger, EraseDragger, LaserDragger } from './draggers/canvas-draggers';
import { MultiSelectDragger, SelectionDragger, TextDragger } from './draggers/selection-draggers';
import { EventName, Movement, check, type EventCheck } from './gesture-listener';
import { PointerType, type PointerEvent } from './input-event';
import { InputMode, type InputModeState } from './input-mode';
import type { OverlayLayer } from './overlay-layer';
import type { ClickTarget, RouterLayer, WheelInput } from './router-layer';
import type { TextEditSession } from './text-edit-session';

/** Every branch of C++ `CanvasWidget::onPan` (`:179-257`), in source order. */
export const ON_PAN_BRANCHES = Object.freeze([
  'not-start',
  'three-pointers',
  'two-pointers',
  'not-mouse-left',
  'read-only',
  'text',
  'scroll',
  'draw-eraser',
  'draw-pencil-only-touch',
  'draw-cmd-scroll',
  'draw',
  'select-eraser',
  'select-pen-draws',
  'select-cmd-scroll',
  'select-movable-text',
  'select-shape',
  'select-shape-alt-duplicate',
  'select-rubber-band',
  'erase-cmd-scroll',
  'erase',
  'laser',
  'other-mode',
] as const);
export type OnPanBranch = (typeof ON_PAN_BRANCHES)[number];

export interface CanvasControllerOptions {
  readonly board: InteractionBoard;
  readonly view: CanvasView;
  readonly overlay: OverlayLayer;
  readonly modes: InputModeState;
  readonly textEdit: TextEditSession;
  readonly setDragHandler: (d: DragHandler) => void;
  readonly duplicate: (t: EditTarget, displace: boolean) => void;
  readonly zoomBy: (delta: number, at?: Point) => void;
}

export class CanvasController implements RouterLayer {
  private readonly o_: CanvasControllerOptions;
  readonly contextMenu: ContextMenuModel;
  /** The `onPan` branch the last pan Start took. */
  lastPanBranch: OnPanBranch | null = null;

  constructor(opts: CanvasControllerOptions) {
    this.o_ = opts;
    this.contextMenu = new ContextMenuModel(opts.overlay, opts.view);
  }

  private get board(): InteractionBoard {
    return this.o_.board;
  }

  private get mode(): InputMode {
    return this.o_.modes.get();
  }

  /** C++ `isEventToScrollByMouse`. */
  private scrollByMouse(ev: PointerEvent): boolean {
    return ev.isMouseDevice() && (ev.mods.cmd || ev.mods.ctrl);
  }

  canDoAt(name: EventName, _at: Point, ev: PointerEvent): EventCheck {
    if (this.board.readOnly() || !ev.likeMouseLeft()) return check(false, false);
    const m = this.mode;
    const tapModes = m === InputMode.SmartDraw || m === InputMode.Select || m === InputMode.Scroll;
    if ((name === EventName.DoubleClick || name === EventName.LongPress) && tapModes) return check(true, true);
    if (
      name === EventName.Rotate &&
      (m === InputMode.SmartDraw || m === InputMode.Select) &&
      this.o_.overlay.isSelectionActive()
    ) {
      return check(true, true);
    }
    return check(false, false);
  }

  findGeneric(): ClickTarget {
    return { contains: () => true, click: (p, e) => this.onClick(p, e) };
  }

  isDrawingSurfaceAt(): boolean {
    return true;
  }

  onDown(): boolean {
    return false;
  }

  private selectableAt(at: Point): LekhObject | null {
    const b = this.board;
    return b.page().objectStore.hit.selectableAt(this.o_.view.toDoc(at), b.config.tapToSelectDistance / b.view().zoom);
  }

  /** C++ `CanvasWidget::onClick`. */
  onClick(at: Point, ev: PointerEvent): boolean {
    const b = this.board;
    if (b.readOnly()) return false;
    if (!ev.likeMouseLeft()) {
      if (ev.isMouseRight()) return this.onLongPress(at, ev, Movement.Start);
      return false;
    }
    const m = this.mode;
    if (m === InputMode.Text) return this.editTextAt(at, true);
    b.clipboard().setPastePoint(this.o_.view.toDoc(at));
    const ignoreFinger = b.config.onlyDrawWithPencil && !ev.isPencil();
    if (ignoreFinger && (m === InputMode.SmartDraw || m === InputMode.Draw)) return false;
    const onCanvas = this.o_.view.isPointOnCanvas(at);
    if (m === InputMode.Draw && onCanvas) {
      this.addDot(at);
      return true;
    }
    if (m === InputMode.Erase && onCanvas) {
      b.ui()?.toast({ message: 'Erase mode is on', kind: 'info' });
      return false;
    }
    if (m === InputMode.Laser && onCanvas) {
      b.ui()?.toast({ message: 'Laser mode is on', kind: 'info' });
      return false;
    }
    const obj = this.selectableAt(at);
    const multi = ev.mods.cmd || ev.mods.ctrl;
    if (obj !== null) {
      this.o_.overlay.select(obj, multi);
      return true;
    }
    if (multi) {
      this.o_.overlay.deselect();
      return true;
    }
    return false;
  }

  /** A tap in Draw mode: a dot of the stroke colour (C++ an `avabodh.basic.ellipse`). */
  private addDot(at: Point): void {
    const b = this.board;
    const pt = this.o_.view.toDoc(at);
    b.edit((ctx) => {
      const tmpl = b.template('avabodh.basic.ellipse');
      if (tmpl === null) return;
      const style = b.currentStyle();
      const w = style.effectiveStrokeWidth();
      const color = style.effectiveStrokePaint().solidColor;
      const obj = new TemplatedObject(b.objectEnv(), tmpl, Rect.fromCenter(pt, w, w), 0, null);
      const p = obj.getDrawingProfile();
      p.setFillColor(color);
      p.setStrokeColor(color);
      p.setStrokeWidth(1);
      ctx.editor.tx.run(new AddObjectAction(ctx.editor.env, ctx.doc, [obj]));
    });
  }

  onDoubleClick(at: Point): boolean {
    if (this.board.readOnly()) return false;
    return this.editTextAt(at, true);
  }

  /** C++ `CanvasWidget::onPan` (a Start; the dragger then owns the gesture). */
  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m !== Movement.Start) {
      this.lastPanBranch = 'not-start';
      return false;
    }
    const r = this.panDragger(at, ev);
    this.lastPanBranch = r.branch;
    if (r.dragger === null) return false;
    r.dragger.onPan(at, ev, m);
    this.o_.setDragHandler(r.dragger);
    return true;
  }

  private scroller(): CanvasScaleScrollDragger {
    return new CanvasScaleScrollDragger(this.o_.overlay, this.o_.view);
  }

  private panDragger(at: Point, ev: PointerEvent): { branch: OnPanBranch; dragger: DragHandler | null } {
    const b = this.board;
    const n = ev.points.length;
    if (n === 3) return { branch: 'three-pointers', dragger: null };
    if (n === 2) return { branch: 'two-pointers', dragger: this.scroller() };
    if (!ev.likeMouseLeft()) return { branch: 'not-mouse-left', dragger: null };
    if (b.readOnly()) return { branch: 'read-only', dragger: this.scroller() };
    const overlay = this.o_.overlay;
    const view = this.o_.view;
    switch (this.mode) {
      case InputMode.Text:
        this.editTextAt(at, true);
        return { branch: 'text', dragger: new NoOpDragger() };
      case InputMode.Scroll:
        overlay.deselect();
        return { branch: 'scroll', dragger: this.scroller() };
      case InputMode.Draw:
      case InputMode.SmartDraw:
        if (ev.isEraser()) return { branch: 'draw-eraser', dragger: new EraseDragger(overlay, view) };
        if (b.config.onlyDrawWithPencil && !ev.isPencil())
          return { branch: 'draw-pencil-only-touch', dragger: this.scroller() };
        if (this.scrollByMouse(ev)) return { branch: 'draw-cmd-scroll', dragger: this.scroller() };
        return { branch: 'draw', dragger: new DrawingDragger(overlay) };
      case InputMode.Select: {
        if (ev.isEraser()) return { branch: 'select-eraser', dragger: new EraseDragger(overlay, view) };
        if (
          b.config.pencilBehavior === PencilBehavior.DrawInSelectionMode &&
          ev.points[0]?.pointerType === PointerType.Pen
        ) {
          return { branch: 'select-pen-draws', dragger: new DrawingDragger(overlay) };
        }
        if (this.scrollByMouse(ev)) return { branch: 'select-cmd-scroll', dragger: this.scroller() };
        const mti = b.page().objectStore.hit.movableTextNear(view.toDoc(at));
        if (mti !== null) return { branch: 'select-movable-text', dragger: new TextDragger(overlay, view, mti) };
        const obj = this.selectableAt(at);
        if (obj !== null) {
          overlay.select(obj);
          const alt = ev.isMouseDevice() && ev.mods.alt;
          if (alt) this.o_.duplicate(obj, false);
          return {
            branch: alt ? 'select-shape-alt-duplicate' : 'select-shape',
            dragger: new SelectionDragger(overlay.rect),
          };
        }
        return { branch: 'select-rubber-band', dragger: new MultiSelectDragger(overlay, view) };
      }
      case InputMode.Erase:
        if (this.scrollByMouse(ev)) return { branch: 'erase-cmd-scroll', dragger: this.scroller() };
        return { branch: 'erase', dragger: new EraseDragger(overlay, view) };
      case InputMode.Laser:
        return { branch: 'laser', dragger: new LaserDragger(overlay, view) };
      default:
        return { branch: 'other-mode', dragger: this.scroller() };
    }
  }

  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): boolean {
    if (m !== Movement.Start) return false;
    const d = this.scroller();
    d.onScale(at, ev, value, m);
    this.o_.setDragHandler(d);
    return true;
  }

  /** C++ `CanvasWidget::onLongPress`: the context menu. */
  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m !== Movement.Start) return false;
    if (this.board.readOnly()) return false;
    if (!this.o_.view.isPointOnCanvas(at)) return false;
    if (this.mode === InputMode.Text) return this.editTextAt(at, true);
    if (!ev.isMouseRight() && !ev.likeMouseLeft()) return false;
    this.showContextMenuAt(at);
    return true;
  }

  onContextMenu(at: Point): boolean {
    this.showContextMenuAt(at);
    return true;
  }

  showContextMenuAt(at: Point): void {
    if (this.board.readOnly()) return;
    const items = this.contextMenu.actionsAt(at);
    if (items.length === 0) return;
    this.board.ui()?.contextMenu(at, items);
  }

  /** C++ `CanvasWidget::onScroll`: Cmd/Ctrl zooms about the pointer, else pans. */
  onScroll(at: Point, w: WheelInput): boolean {
    if (w.cmdOrCtrl) this.o_.zoomBy(w.dy / 100, at);
    else this.o_.view.scrollDelta(w.dx, w.dy);
    this.o_.overlay.flashScrollIndicator();
    this.o_.overlay.refreshSelection();
    this.board.requestPaint('grid');
    return true;
  }

  /** C++ `CanvasWidget::onRotate`: two fingers rotate the selected shape. */
  onRotate(at: Point, ev: PointerEvent, value: number, m: Movement): boolean {
    const overlay = this.o_.overlay;
    const t = overlay.selectionTarget();
    if (m !== Movement.Start || t === null || !(t instanceof TemplatedObject)) return false;
    const b = this.board;
    const id = t.id;
    const d = new (class extends BaseDragger {
      override readonly kind: string = 'RotateGestureDragger';
      override onRotate(p: Point, _e: PointerEvent, v: number, mv: Movement): void {
        b.edit((ctx) => {
          const o = ctx.page.objectStore.getObject(id);
          if (o === null) return;
          if (mv === Movement.Start) o.startModification(dragContext(b, ctx.doc));
          else o.rotate(v);
          if (mv === Movement.End) {
            const angle = o.finishRotating();
            if (angle !== 0) ctx.editor.tx.record(new RotateAction(ctx.editor.env, ctx.doc, o, angle));
          }
        });
        overlay.rect.moveRotater(p, mv);
        overlay.refreshSelection();
      }
    })();
    this.o_.setDragHandler(d);
    d.onRotate(at, ev, value, m);
    return true;
  }

  /**
   * C++ `editTextAt`: edits the text under `at` (or, with none, a new text object there). Text
   * mode ends with it.
   */
  editTextAt(at: Point, checkExisting: boolean): boolean {
    const b = this.board;
    if (!this.o_.view.isPointOnCanvas(at)) return true;
    if (this.mode === InputMode.Text) this.o_.modes.set(InputMode.Select);
    this.o_.overlay.deselect();
    const npt = this.o_.view.toDoc(at);
    const textEdit = this.o_.textEdit;
    b.edit((ctx) => {
      let obj = checkExisting ? ctx.page.objectStore.hit.editableAt(npt) : null;
      if (obj === null) {
        const tmpl = b.template('avabodh.basic.text');
        if (tmpl === null) return;
        const snap = b.config.snapToGridNewObject ? ctx.doc.snapStep() : null;
        const tobj = new TemplatedObject(b.objectEnv(), tmpl, Rect.fromCenter(npt, 1, 1), 0, snap);
        tobj.getDrawingProfile().copyFrom(b.currentStyle());
        const te = tmpl.texts()[0];
        if (te !== undefined) te.setStyle(tobj.getDrawingProfile());
        ctx.editor.tx.run(new AddObjectAction(ctx.editor.env, ctx.doc, [tobj]));
        obj = tobj;
      }
      obj.startTextEditing(npt);
      textEdit.began(obj);
    });
    this.board.requestPaint('drawing');
    return true;
  }
}
