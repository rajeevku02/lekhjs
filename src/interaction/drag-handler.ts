// The owner of a continuous gesture (port of C++ `event::DragHandler`, `L/event/DragHandler.h`):
// once a layer takes a pan, scale, rotate or long press at its Start, the rest of the gesture goes
// to it. `cancel()` abandons it (Escape, a cancelled gesture, a second finger): a handler that can
// be cancelled undoes its feedback, commits nothing and returns true; the default returns false.
import type { Point } from '../geometry';
import type { Movement } from './gesture-listener';
import type { PointerEvent } from './input-event';

export interface DragHandler {
  /** The class name (tests and diagnostics). */
  readonly kind: string;
  onPan(at: Point, ev: PointerEvent, m: Movement): void;
  onScale(at: Point, ev: PointerEvent, value: number, m: Movement): void;
  onRotate(at: Point, ev: PointerEvent, value: number, m: Movement): void;
  onLongPress(at: Point, ev: PointerEvent, m: Movement): void;
  cancel(): boolean;
}

/** Default no-op bodies (C++ `DragHandler` with no handler functions set). */
/* eslint-disable @typescript-eslint/no-unused-vars -- the interface's signatures */
export class BaseDragger implements DragHandler {
  readonly kind: string = 'DragHandler';
  onPan(_at: Point, _ev: PointerEvent, _m: Movement): void {
    /* no-op */
  }
  onScale(_at: Point, _ev: PointerEvent, _value: number, _m: Movement): void {
    /* no-op */
  }
  onRotate(_at: Point, _ev: PointerEvent, _value: number, _m: Movement): void {
    /* no-op */
  }
  onLongPress(_at: Point, _ev: PointerEvent, _m: Movement): void {
    /* no-op */
  }
  cancel(): boolean {
    return false;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/** Swallows a gesture (C++ `NoOpDragger`, and a bare `new DragHandler()`). */
export class NoOpDragger extends BaseDragger {
  override readonly kind: string = 'NoOpDragger';
}
