// The input dispatch (port of C++ `event::InputHandler`, `L/event/InputHandler.cpp`; spec 05 §4.2,
// spec 02 `InputRouter`). The host's `InputEvent`s go through the `GestureRecognizer`; the
// recognised gestures go, in order, to:
//   1. the active `DragHandler` (it owns the rest of a gesture once it took the Start);
//   2. the overlay (handles, the rectangle body, the outside-tap filters);
//   3. the `ShapeInteraction` layer (Select mode, editable boards);
//   4. the `CanvasController` (the mode table).
// Pan-to-click (a left-mouse drag nobody claimed becomes a click if it ends on the same target),
// hover routing, `canDoAt` arbitration (`DoubleClick` / `LongPress` / `Rotate`), scale forwarding
// to the drag handler first, and "a press while editing text finishes the edit first" are C++'s.
import { Point } from '../geometry';
import type { DragHandler } from './drag-handler';
import type { HostEnvironment } from './env';
import type { EventName } from './gesture-listener';
import {
  Movement,
  check,
  mergeCheck,
  type EventCheck,
  type GestureListener,
  type GestureTimers,
} from './gesture-listener';
import { GestureRecognizer } from './gesture-recognizer';
import {
  MouseButton,
  PointState,
  PointerEvent,
  eventPoint,
  mouseButtonOf,
  pointerTypeOf,
  type InputEvent,
  type PointerInput,
} from './input-event';
import type { ClickTarget, RouterLayer } from './router-layer';

export interface InputRouterOptions {
  readonly env: HostEnvironment;
  readonly timers: GestureTimers;
  /** Overlay, shape interaction, canvas controller — in that order. */
  readonly layers: readonly RouterLayer[];
  /** `ToolMenu` mode is Draw (C++ `isDrawOnlyMode`'s first test). */
  readonly isDrawMode: () => boolean;
  readonly onlyDrawWithPencil: () => boolean;
  readonly isEditingText: () => boolean;
  readonly finishTextEditing: () => void;
  /** Hover: the shape layer first, else the overlay's mode cursor. */
  readonly onHover: (at: Point, m: Movement) => void;
  /** C++ `setIgnoreMouseRightClick`. */
  readonly ignoreMouseRightClick?: boolean;
}

export class InputRouter implements GestureListener {
  readonly recognizer: GestureRecognizer;
  private readonly o_: InputRouterOptions;
  private drag_: DragHandler | null = null;
  private panToClick_: ClickTarget | null = null;
  private hovering_ = false;

  constructor(opts: InputRouterOptions) {
    this.o_ = opts;
    this.recognizer = new GestureRecognizer(this, opts.timers, { onlyDrawWithPencil: opts.onlyDrawWithPencil });
  }

  hasDragHandler(): boolean {
    return this.drag_ !== null;
  }

  dragHandler(): DragHandler | null {
    return this.drag_;
  }

  setDragHandler(d: DragHandler | null): void {
    this.drag_ = d;
  }

  /** C++ `cancelDrag`: a handler that cancelled is dropped; the rest of the gesture reaches nobody. */
  cancelDrag(): void {
    if (this.drag_ === null) return;
    if (this.drag_.cancel()) this.drag_ = null;
  }

  /** C++ `resetGestureState` / the host's `resetPointerInputState`. */
  reset(): void {
    this.recognizer.reset();
  }

  /** The host entry point. Returns true when the event was used (the host may `preventDefault`). */
  handle(e: InputEvent): boolean {
    switch (e.type) {
      case 'pointer':
        return this.onPointer(e);
      case 'wheel': {
        const at = new Point(e.x, e.y);
        const w = { x: e.x, y: e.y, dx: e.dx, dy: e.dy, cmdOrCtrl: e.mods.cmd || e.mods.ctrl };
        for (const l of this.o_.layers) if (l.onScroll(at, w)) return true;
        return false;
      }
      case 'scale': {
        const m = e.phase === 'start' ? Movement.Start : e.phase === 'move' ? Movement.Move : Movement.End;
        return this.onScale(new Point(e.x, e.y), new PointerEvent([], undefined, true), e.scale, m);
      }
      case 'contextmenu': {
        if (this.recognizer.inProgress() || this.o_.isEditingText()) return false;
        const at = new Point(e.x, e.y);
        for (const l of this.o_.layers) if (l.onContextMenu(at)) return true;
        return true;
      }
      case 'reset':
        this.reset();
        return true;
    }
  }

  /** One `PointerEvent` (a point per sample) from a host pointer event. */
  static toPointerEvent(e: PointerInput): PointerEvent {
    const state = e.phase === 'down' ? PointState.Down : e.phase === 'move' ? PointState.Move : PointState.Up;
    const type = pointerTypeOf(e.kind, e.eraser);
    const button = e.hover ? MouseButton.None : mouseButtonOf(e.kind, e.button, e.buttons, e.phase);
    const pts = e.samples.map((s) =>
      eventPoint({
        x: s.x,
        y: s.y,
        pointerId: e.id,
        state,
        pressure: s.pressure,
        timestamp: s.t,
        pointerType: type,
        button,
      }),
    );
    return new PointerEvent(pts, e.mods, e.kind === 'mouse');
  }

  private onPointer(e: PointerInput): boolean {
    if (e.phase === 'cancel') {
      this.reset();
      return true;
    }
    const ev = InputRouter.toPointerEvent(e);
    const p0 = ev.points[0];
    if (p0 === undefined) return false;
    if (e.hover || ev.isMouseMove()) {
      if (this.recognizer.inProgress()) return false;
      this.o_.onHover(new Point(p0.x, p0.y), this.hovering_ ? Movement.Move : Movement.Start);
      this.hovering_ = true;
      if (e.hover && e.kind !== 'mouse') return true;
    }
    // A press while editing text finishes the edit first, and is used up.
    if (this.o_.isEditingText() && p0.state === PointState.Down) {
      this.o_.finishTextEditing();
      return false;
    }
    this.recognizer.onPointerEvent(ev);
    return true;
  }

  /** The pointer left the board: the hover cursor resets. */
  hoverEnd(at: Point): void {
    if (!this.hovering_) return;
    this.hovering_ = false;
    this.o_.onHover(at, Movement.End);
  }

  // ---- GestureListener (C++ InputHandler) ----

  canDoAt(name: EventName, at: Point, ev: PointerEvent): EventCheck {
    const r = check(false, false);
    for (const l of this.o_.layers) {
      mergeCheck(r, l.canDoAt(name, at, ev));
      if (r.shouldBlock) break;
    }
    return r;
  }

  isDrawOnlyMode(at: Point): boolean {
    if (!this.o_.isDrawMode()) return false;
    for (const l of this.o_.layers) {
      if (l.findGeneric(at) !== null) return l.isDrawingSurfaceAt(at);
    }
    return false;
  }

  onDown(at: Point, ev: PointerEvent): boolean {
    for (const l of this.o_.layers) if (l.onDown(at, ev)) return true;
    return false;
  }

  onUp(): boolean {
    return false;
  }

  onClick(at: Point, ev: PointerEvent): boolean {
    if (ev.isMouseRight() && this.o_.ignoreMouseRightClick === true) return false;
    // On Apple hosts Ctrl + click is the context menu.
    if (this.o_.env.isApple && ev.likeMouseLeft() && ev.isMouseDevice() && ev.mods.ctrl) return false;
    for (const l of this.o_.layers) if (l.onClick(at, ev)) return true;
    return false;
  }

  onDoubleClick(at: Point, ev: PointerEvent): boolean {
    for (const l of this.o_.layers) if (l.onDoubleClick(at, ev)) return true;
    return false;
  }

  onPan(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m === Movement.Start) {
      let handled = false;
      for (const l of this.o_.layers) {
        if (l.onPan(at, ev, m)) {
          handled = true;
          break;
        }
      }
      if (ev.likeMouseLeft() && this.drag_ === null) {
        for (const l of this.o_.layers) {
          const t = l.findGeneric(at);
          if (t !== null) {
            this.panToClick_ = t;
            break;
          }
        }
      }
      return handled;
    }
    this.drag_?.onPan(at, ev, m);
    if (m === Movement.End) {
      const t = this.panToClick_;
      if (this.drag_ === null && t !== null && ev.likeMouseLeft() && t.contains(at)) t.click(at, ev);
      this.drag_ = null;
      this.panToClick_ = null;
    }
    return false;
  }

  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): boolean {
    if (m === Movement.Start) {
      // A second finger during a drag: the drag handler sees the scale start first.
      this.drag_?.onScale(at, ev, value, m);
      for (const l of this.o_.layers) if (l.onScale(at, ev, value, m)) return true;
      return false;
    }
    this.drag_?.onScale(at, ev, value, m);
    if (m === Movement.End) this.drag_ = null;
    return false;
  }

  onRotate(at: Point, ev: PointerEvent, value: number, m: Movement): boolean {
    if (m === Movement.Start) {
      for (const l of this.o_.layers) if (l.onRotate(at, ev, value, m)) return true;
      return false;
    }
    this.drag_?.onRotate(at, ev, value, m);
    if (m === Movement.End) this.drag_ = null;
    return false;
  }

  onLongPress(at: Point, ev: PointerEvent, m: Movement): boolean {
    if (m === Movement.Start) {
      for (const l of this.o_.layers) if (l.onLongPress(at, ev, m)) return true;
      return false;
    }
    this.drag_?.onLongPress(at, ev, m);
    if (m === Movement.End) this.drag_ = null;
    return false;
  }
}
