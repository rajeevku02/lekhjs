// Router position 3 (spec 05 §5): a shape that supplies a `ShapeInteraction` gets the tap,
// double tap, drag, long press and hover over it — after the drag handler and the overlay (handles
// win), before the mode table; in Select mode on an editable board only. Each call runs inside one
// `board.edit`, so a change the shape makes through its context (`beginChange` … `commit`) is one
// undo step and one `changeattr` frame.
import type { Point } from '../geometry';
import type { LekhObject } from '../model';
import type { CommandContext } from '../session';
import type { InteractionBoard } from './board';
import type { CanvasView } from './canvas-view';
import type { CursorKind } from './cursor';
import { BaseDragger, type DragHandler } from './drag-handler';
import { EventName, Movement, check, type EventCheck } from './gesture-listener';
import { PointerType, type PointerEvent } from './input-event';
import { InputMode, type InputModeState } from './input-mode';
import type { ClickTarget, RouterLayer } from './router-layer';
import {
  shapeHandles,
  type InputInfo,
  type InteractionCtx,
  type InteractionEventName,
  type ShapeDragHandler,
  type ShapeInteraction,
  type ShapeInteractionRegistry,
} from './shape-interaction';

export interface ShapeLayerOptions {
  readonly board: InteractionBoard;
  readonly view: CanvasView;
  readonly modes: InputModeState;
  readonly registry: ShapeInteractionRegistry;
  readonly setDragHandler: (d: DragHandler) => void;
  readonly setCursor: (c: CursorKind) => void;
}

function infoOf(ev: PointerEvent, viewPt: Point): InputInfo {
  const t = ev.points[0]?.pointerType;
  const kind = t === PointerType.Mouse ? 'mouse' : t === PointerType.Pen || t === PointerType.Eraser ? 'pen' : 'touch';
  const b = ev.points[0]?.button ?? 0;
  return {
    kind,
    mods: { shift: ev.mods.shift, ctrl: ev.mods.ctrl, alt: ev.mods.alt, meta: ev.mods.meta },
    buttons: b,
    viewPt,
  };
}

/** A shape's drag wrapped as a router drag handler. */
class ShapeDrag extends BaseDragger {
  override readonly kind: string = 'ShapeDrag';
  private readonly inner_: ShapeDragHandler;
  private readonly layer_: ShapeInteractionLayer;

  constructor(inner: ShapeDragHandler, layer: ShapeInteractionLayer) {
    super();
    this.inner_ = inner;
    this.layer_ = layer;
  }

  override onPan(at: Point, ev: PointerEvent, m: Movement): void {
    if (m === Movement.Start) return;
    const pt = this.layer_.toDoc(at);
    const info = infoOf(ev, at);
    this.layer_.run(() => {
      if (m === Movement.End) this.inner_.end(pt, info);
      else this.inner_.move(pt, info);
      return true;
    });
  }

  override onLongPress(at: Point, ev: PointerEvent, m: Movement): void {
    this.onPan(at, ev, m);
  }

  override cancel(): boolean {
    let r = false;
    this.layer_.run(() => (r = this.inner_.cancel()));
    return r;
  }
}

export class ShapeInteractionLayer implements RouterLayer {
  private readonly o_: ShapeLayerOptions;
  private hovered_: { obj: LekhObject; si: ShapeInteraction } | null = null;

  constructor(opts: ShapeLayerOptions) {
    this.o_ = opts;
  }

  toDoc(at: Point): Point {
    return this.o_.view.toDoc(at);
  }

  private active(): boolean {
    return this.o_.modes.get() === InputMode.Select && !this.o_.board.readOnly();
  }

  /** The shape under `at` with an interaction, in Select mode on an editable board. */
  private shapeAt(at: Point): { obj: LekhObject; si: ShapeInteraction } | null {
    if (!this.active()) return null;
    const b = this.o_.board;
    const obj = b.page().objectStore.hit.selectableAt(this.toDoc(at), b.config.tapToSelectDistance / b.view().zoom);
    if (obj === null) return null;
    const si = this.o_.registry.get(obj);
    return si === undefined ? null : { obj, si };
  }

  private handles(s: { si: ShapeInteraction }, e: InteractionEventName, at: Point, ev: PointerEvent): boolean {
    return shapeHandles(s.si, e, this.toDoc(at), infoOf(ev, at), {
      selectMode: this.active(),
      readOnly: this.o_.board.readOnly(),
    });
  }

  /** Runs `fn` with an interaction context as one command; its result (false when it was queued). */
  run<T>(fn: (ctx: InteractionCtx) => T): T | undefined {
    let out: T | undefined;
    const b = this.o_.board;
    b.edit((cc: CommandContext) => {
      const ctx: InteractionCtx = {
        session: { objectById: (id) => cc.page.objectStore.getObject(id) ?? undefined },
        readOnly: b.readOnly(),
        beginChange: (id) => {
          cc.editor.tx.begin(cc.doc, [id]);
        },
        commit: () => {
          cc.editor.tx.commit();
        },
        cancel: () => {
          cc.editor.tx.cancel();
        },
        invalidate: () => {
          b.requestPaint('drawing');
          b.requestPaint('middle');
        },
        setCursor: (c) => {
          this.o_.setCursor(c);
        },
      };
      out = fn(ctx);
    });
    return out;
  }

  canDoAt(name: EventName, at: Point, ev: PointerEvent): EventCheck {
    const e: InteractionEventName | null =
      name === EventName.DoubleClick ? 'doubleTap' : name === EventName.LongPress ? 'longPress' : null;
    if (e === null) return check(false, false);
    const s = this.shapeAt(at);
    if (s === null || !this.handles(s, e, at, ev)) return check(false, false);
    const ms = s.si.hitTest?.(e, this.toDoc(at), infoOf(ev, at)).longPressMs ?? 0;
    return check(true, true, ms);
  }

  findGeneric(): ClickTarget | null {
    return null;
  }

  isDrawingSurfaceAt(): boolean {
    return false;
  }

  onDown(): boolean {
    return false;
  }

  onClick(at: Point, ev: PointerEvent): boolean {
    const s = this.shapeAt(at);
    if (s === null || s.si.onTap === undefined || !this.handles(s, 'tap', at, ev)) return false;
    const tap = s.si.onTap.bind(s.si);
    return this.run((ctx) => tap(this.toDoc(at), infoOf(ev, at), ctx)) === true;
  }

  onDoubleClick(at: Point, ev: PointerEvent): boolean {
    const s = this.shapeAt(at);
    if (s === null || s.si.onDoubleTap === undefined || !this.handles(s, 'doubleTap', at, ev)) return false;
    const dbl = s.si.onDoubleTap.bind(s.si);
    return this.run((ctx) => dbl(this.toDoc(at), infoOf(ev, at), ctx)) === true;
  }

  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m !== Movement.Start || !ev.likeMouseLeft()) return false;
    const s = this.shapeAt(at);
    if (s === null || s.si.onDragStart === undefined || !this.handles(s, 'drag', at, ev)) return false;
    const start = s.si.onDragStart.bind(s.si);
    const inner = this.run((ctx) => start(this.toDoc(at), infoOf(ev, at), ctx)) ?? null;
    if (inner === null) return false;
    this.o_.setDragHandler(new ShapeDrag(inner, this));
    return true;
  }

  onScale(): boolean {
    return false;
  }

  onRotate(): boolean {
    return false;
  }

  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m !== Movement.Start) return false;
    const s = this.shapeAt(at);
    if (s === null || s.si.onLongPress === undefined || !this.handles(s, 'longPress', at, ev)) return false;
    const lp = s.si.onLongPress.bind(s.si);
    const r = this.run((ctx) => lp(this.toDoc(at), infoOf(ev, at), ctx));
    if (r === undefined || r === false) return false;
    if (r !== true) this.o_.setDragHandler(new ShapeDrag(r, this));
    return true;
  }

  onScroll(): boolean {
    return false;
  }

  onContextMenu(): boolean {
    return false;
  }

  /** Hover over a shape with an `onHover`; true when it took it (its cursor shows). */
  onHover(at: Point, m: Movement): boolean {
    const s = m === Movement.End ? null : this.shapeAt(at);
    const prev = this.hovered_;
    if (prev !== null && (s === null || s.obj !== prev.obj)) {
      const leave = prev.si.onHover?.bind(prev.si);
      if (leave !== undefined) this.run((ctx) => leave(this.toDoc(at), 'leave', ctx));
      this.hovered_ = null;
    }
    if (s === null || s.si.onHover === undefined) return false;
    const phase = prev?.obj === s.obj ? 'move' : 'enter';
    this.hovered_ = s;
    const hov = s.si.onHover.bind(s.si);
    const c = this.run((ctx) => hov(this.toDoc(at), phase, ctx));
    if (c !== undefined) this.o_.setCursor(c);
    return true;
  }
}
